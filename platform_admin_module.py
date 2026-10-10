"""Server-side multi-school admin panel. NEVER expose service_role_key to clients.
This is intended for PRIVATE Streamlit Cloud deployments only.
"""
import streamlit as st
import secrets
import string
from supabase import create_client

ROLES = ('owner', 'principal', 'coordinator', 'teacher')

def _admin_client():
    cfg = st.secrets['supabase']
    service_key = cfg.get('service_role_key') or cfg.get('SERVICE_ROLE_KEY')
    if not service_key:
        st.error('Missing server-only [supabase] service_role_key in Streamlit secrets.')
        st.stop()
    return create_client(cfg.get('url') or cfg.get('URL'), service_key)

def _identity_verified(token, user_id):
    # NEVER use user-submitted email, session_state user_id or a hardcoded address
    # as authorization. Verify access token with Supabase Auth every time.
    admin = _admin_client()
    user_response = admin.auth.get_user(token)
    authenticated_user = user_response.user
    if not authenticated_user or str(authenticated_user.id) != str(user_id):
        raise PermissionError('Session identity failed verification')
    if not authenticated_user.email_confirmed_at:
        raise PermissionError('Email confirmation is required')
    row = admin.table('literacy_platform_admins').select('user_id').eq('user_id', str(authenticated_user.id)).limit(1).execute().data
    if not row:
        raise PermissionError('Not a platform administrator')
    return admin

def is_platform_admin(token, user_id):
    try:
        _identity_verified(token, user_id)
        return True
    except Exception:
        return False

def _verified_user(token, user_id):
    admin = _admin_client()
    response = admin.auth.get_user(token)
    user = response.user
    if not user or str(user.id) != str(user_id):
        raise PermissionError('Authentication failed')
    return admin, user


def account_requires_password_change(token, user_id):
    admin, user = _verified_user(token, user_id)
    return bool((user.app_metadata or {}).get('lit_password_change_required', False))


def complete_first_password_change(token, user_id, password):
    if len(password) < 12:
        raise ValueError('Password too short')
    admin, user = _verified_user(token, user_id)
    if not (user.app_metadata or {}).get('lit_password_change_required', False):
        raise PermissionError('Password change not pending')
    # Supabase Auth validates user token for the password update.
    from supabase import create_client
    cfg = st.secrets['supabase']
    public_key = next((cfg.get(k) for k in ('anon_key','publishable_key','key','ANON_KEY','PUBLISHABLE_KEY','KEY') if cfg.get(k)), None)
    if not public_key:
        raise RuntimeError('Missing public Supabase key')
    personal = create_client(cfg.get('url') or cfg.get('URL'), public_key)
    personal.postgrest.auth(token)
    personal.auth.set_session(st.session_state['lit_auth']['access_token'], st.session_state['lit_auth']['refresh_token'])
    personal.auth.update_user({'password': password})
    metadata = dict(user.app_metadata or {})
    metadata.pop('lit_password_change_required', None)
    admin.auth.admin.update_user_by_id(str(user.id), {'app_metadata': metadata})
    st.session_state.pop('lit_auth', None)


def _make_password():
    alphabet = string.ascii_letters + string.digits + '!@#$%&*'
    # Guarantee coverage of character types.
    base = [secrets.choice(string.ascii_uppercase),secrets.choice(string.ascii_lowercase),
            secrets.choice(string.digits),secrets.choice('!@#$%&*')]
    base += [secrets.choice(alphabet) for _ in range(16)]
    secrets.SystemRandom().shuffle(base)
    return ''.join(base)

def _school_list(admin):
    return admin.table('literacy_schools').select('id,name,created_at').order('name').execute().data or []

def _existing_auth_user(admin, email):
    # Supabase client list_users can paginate. Do not search only page 1.
    page = 1
    while True:
        response = admin.auth.admin.list_users(page=page, per_page=200)
        users = response if isinstance(response, list) else getattr(response, 'users', [])
        for u in users:
            if (u.email or '').strip().lower() == email.strip().lower():
                return u
        if len(users) < 200:
            return None
        page += 1

def render_platform_admin(token, user_id):
    try:
        admin = _identity_verified(token,user_id)
    except Exception:
        st.error('You do not have verified platform Super Admin access.')
        st.stop()
    st.title('🛡️ Platform Super Admin')
    st.caption('Create school accounts with one-time temporary passwords; users must change them on first sign-in.')
    schools = _school_list(admin)
    t1,t2,t3 = st.tabs(['Schools','Create / Assign Users','Users & Memberships'])
    with t1:
        st.dataframe([{'School':s['name'],'ID':s['id']} for s in schools],hide_index=True)
        with st.form('platform_new_school'):
            name = st.text_input('New school name')
            save = st.form_submit_button('Create school')
        if save:
            if not name.strip() or len(name.strip()) > 200:
                st.error('Enter a school name up to 200 characters.')
            else:
                try:
                    # Service-role write is allowed only after checking the caller's token above.
                    admin.table('literacy_schools').insert({'name':name.strip()}).execute()
                    st.success('School created. Refresh to see the updated list.')
                except Exception as exc:
                    st.error(f'Could not create school: {exc}')
    with t2:
        if not schools:
            st.info('Create a school first.')
        else:
            labels = {s['id']:s['name'] for s in schools}
            with st.form('platform_invite'):
                school_id = st.selectbox('School',list(labels),format_func=lambda x:labels[x])
                display_name = st.text_input('Full name')
                email = st.text_input('Email address')
                role = st.selectbox('Role',ROLES)
                confirmed = st.checkbox('I confirm this person is authorized for the selected school and role.')
                submit = st.form_submit_button('Create account / assign existing user')
            if submit:
                if not confirmed or not display_name.strip() or '@' not in email or not email.strip():
                    st.error('Valid email, name and authorization confirmation required.')
                else:
                    try:
                        normalized = email.strip().lower()
                        user = _existing_auth_user(admin,normalized)
                        created = False
                        temporary_password = None
                        if user is None:
                            temporary_password = _make_password()
                            # Administrative provisioning; confirmation here is not
                            # proof that the person owns this email address.
                            response = admin.auth.admin.create_user({
                                'email': normalized,
                                'password': temporary_password,
                                'email_confirm': True,
                                'user_metadata': {'full_name': display_name.strip()},
                                'app_metadata': {'lit_password_change_required': True},
                            })
                            user = response.user
                            created = True
                        if user is None:
                            raise RuntimeError('Supabase Auth did not return a user ID.')
                        admin.table('literacy_memberships').upsert({
                            'school_id': school_id, 'user_id': str(user.id),
                            'display_name': display_name.strip(), 'role': role,
                        }, on_conflict='school_id,user_id').execute()
                        if created:
                            st.session_state['just_created_credentials'] = {
                                'email': normalized,
                                'password': temporary_password,
                                'school': labels[school_id],
                            }
                            st.success('Account created and school role assigned.')
                        else:
                            st.success('Existing user assigned to the school. Their password was unchanged.')
                    except Exception as exc:
                        st.error(f'Account provisioning failed: {exc}')
                        st.warning('If Auth user creation succeeded but membership assignment failed, check the membership list before retrying.')
            credentials = st.session_state.pop('just_created_credentials', None)
            if credentials:
                st.warning('Copy the temporary password now. It will not be shown again. Share privately.')
                st.code(f"Email: {credentials['email']}\nTemporary password: {credentials['password']}", language=None)
                st.caption('Do not send this password in public groups.')
    with t3:
        if schools:
            labels={s['id']:s['name'] for s in schools}
            sid=st.selectbox('View school',list(labels),format_func=lambda x:labels[x],key='platform_view_school')
            members=admin.table('literacy_memberships').select('user_id,display_name,role').eq('school_id',sid).execute().data or []
            st.dataframe(members,hide_index=True)
            st.caption('To revoke access, remove the school membership in a future dedicated confirmation workflow. Do not delete Auth users to remove one school membership.')
