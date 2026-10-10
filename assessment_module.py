"""School-scoped literacy assessment Streamlit interface; Supabase Auth + RLS.
No service-role credentials are used by this module.
"""
import csv
import io
import uuid
from datetime import date
import pandas as pd
import streamlit as st
from supabase import create_client

GRADES = ('Nursery','LKG','UKG','Grade 1','Grade 2','Grade 3','Grade 4')
RATINGS = ('Not Assessed','Emerging','Developing','Independent')
MANAGERS = ('owner','principal','coordinator')
ALL_ROLES = MANAGERS + ('teacher',)


def _conn():
    cfg = st.secrets['supabase']
    # Must be publishable/anon key; service_role must never be used in assessment UI.
    key = cfg.get('anon_key') or cfg.get('publishable_key') or cfg.get('key') or cfg.get('ANON_KEY') or cfg.get('PUBLISHABLE_KEY') or cfg.get('KEY')
    if not key:
        st.error('Configure [supabase] anon_key (or publishable_key) to use assessments. Do not use the service-role key.')
        st.stop()
    return create_client((cfg.get('url') or cfg.get('URL')), key)


def _db(token, table):
    # Per-session PostgREST client. Every request carries the authenticated user's JWT.
    client = _conn()
    client.postgrest.auth(token)
    return client.table(table)


def _query(token, table, columns='*', **equalities):
    q = _db(token, table).select(columns)
    for field, value in equalities.items():
        q = q.eq(field, value)
    return q.execute().data or []


def _public_auth():
    """Return an independent anon-key client; never use service role in user flows."""
    return _conn()


def _forgot_password():
    st.subheader('Reset your password')
    st.info('Enter your registered email to receive a six-digit recovery code.')
    with st.form('request_recovery'):
        email = st.text_input('Registered email', key='recovery_email')
        send = st.form_submit_button('Send recovery code')
    if send:
        try:
            _public_auth().auth.reset_password_for_email(email.strip().lower())
        except Exception:
            pass
        st.info('If the email is registered, a recovery message will be sent.')
    with st.form('confirm_recovery'):
        code = st.text_input('Recovery code', key='recovery_code')
        new_password = st.text_input('New password (12+ characters)', type='password', key='recovery_new')
        confirm = st.text_input('Confirm new password', type='password', key='recovery_confirm')
        reset = st.form_submit_button('Set new password')
    if reset:
        if len(new_password) < 12 or new_password != confirm:
            st.error('Use matching passwords of at least 12 characters.')
            return
        try:
            auth = _public_auth()
            verified = auth.auth.verify_otp({'email': email.strip().lower(), 'token': code.strip(), 'type': 'recovery'})
            if not verified.session:
                raise ValueError('Could not verify code')
            auth.auth.update_user({'password': new_password})
            auth.auth.sign_out()
            st.success('Password updated. Return to Sign In.')
        except Exception:
            st.error('Invalid or expired recovery code. Request a new one.')


def _require_password_change(token, user_id):
    """Enforce the admin-managed first-login flag in the Streamlit interface."""
    from platform_admin_module import account_requires_password_change, complete_first_password_change
    if not account_requires_password_change(token, user_id):
        return
    st.warning('Please change the initial password before accessing the platform.')
    with st.form('first_login_password'):
        new = st.text_input('New password (12+ characters)', type='password')
        confirm = st.text_input('Confirm password', type='password')
        save = st.form_submit_button('Change password')
    if save:
        if len(new) < 12 or new != confirm:
            st.error('Use matching passwords of at least 12 characters.')
        else:
            try:
                complete_first_password_change(token, user_id, new)
                st.success('Password changed. Sign in again with the new password.')
                st.session_state.pop('lit_auth', None)
                st.stop()
            except Exception:
                st.error('Password change failed. Try again or contact an administrator.')
    st.stop()


def _login():
    if 'lit_auth' not in st.session_state:
        mode = st.radio('Account Access', ['Sign In', 'Forgot Password'], horizontal=True)
        if mode == 'Forgot Password':
            _forgot_password()
            st.stop()
        st.subheader('Literacy Assessment Sign In')
        with st.form('lit_login'):
            email = st.text_input('Email')
            password = st.text_input('Password', type='password')
            submitted = st.form_submit_button('Sign in')
        if submitted:
            try:
                result = _public_auth().auth.sign_in_with_password({'email': email.strip(), 'password': password})
                if not result.session or not result.user:
                    raise ValueError('Missing authenticated session')
                st.session_state['lit_auth'] = {'access_token': result.session.access_token,
                    'refresh_token': result.session.refresh_token, 'user_id': str(result.user.id)}
                st.rerun()
            except Exception:
                st.error('Sign in failed. Verify your account credentials.')
        st.stop()
    auth = st.session_state['lit_auth']
    try:
        session = _public_auth().auth.refresh_session(auth['refresh_token'])
        if not session.session or str(session.user.id) != str(auth['user_id']):
            raise ValueError('Session identity mismatch')
        auth.update(access_token=session.session.access_token, refresh_token=session.session.refresh_token)
    except Exception:
        st.session_state.pop('lit_auth', None)
        st.warning('Session expired. Please sign in again.')
        st.stop()
    if st.button('Sign out', key='lit_signout'):
        st.session_state.pop('lit_auth', None)
        st.rerun()
    _require_password_change(auth['access_token'], auth['user_id'])
    return auth['access_token'], auth['user_id']


def _school(token, user_id):
    memberships = _query(token, 'literacy_memberships','school_id,role,user_id', user_id=user_id)
    memberships = [m for m in memberships if m['role'] in ALL_ROLES]
    if not memberships:
        st.warning('No assessment-school role is assigned to this login. An administrator must invite and assign you.')
        st.stop()
    allowed_ids = [m['school_id'] for m in memberships]
    schools = [s for s in _query(token, 'literacy_schools','id,name') if s['id'] in allowed_ids]
    if not schools:
        st.warning('No accessible school exists.')
        st.stop()
    names = {s['id']:s['name'] for s in schools}
    selected = st.selectbox('School', options=list(names), format_func=lambda sid:names[sid], key='lit_school')
    role = next(m['role'] for m in memberships if m['school_id']==selected)
    st.caption('Signed in as: ' + role.title())
    return selected, role, names[selected]


def _classes(token, school_id, user_id, role):
    classes = _query(token, 'literacy_classes', 'id,school_id,grade,section,academic_year', school_id=school_id)
    if role == 'teacher':
        assigned = {r['class_id'] for r in _query(token,'literacy_teacher_classes','class_id',teacher_user_id=user_id)}
        classes = [c for c in classes if c['id'] in assigned]
    return sorted(classes, key=lambda c:(c['academic_year'], GRADES.index(c['grade']) if c['grade'] in GRADES else 99,c['section']), reverse=True)


def _class_picker(classes, key):
    options = {c['id']:f"{c['grade']} - {c['section']} ({c['academic_year']})" for c in classes}
    if not options:
        st.info('No classes assigned to this account.')
        return None
    cid = st.selectbox('Class / Section', list(options), format_func=lambda x:options[x], key=key)
    return next(c for c in classes if c['id']==cid)


def _criteria(token, grade):
    # Spiral assessment: include every published skill from Nursery through enrolled grade.
    # Grade 3/4 may have no own skills yet; previous-stage skills remain assessable.
    if grade not in GRADES:
        return []
    allowed = set(GRADES[:GRADES.index(grade)+1])
    return sorted([c for c in _query(token,'literacy_competencies','id,code,grade,strand,title,description,sequence,active')
                   if c['active'] and c['grade'] in allowed],
                  key=lambda c:(GRADES.index(c['grade']), c['sequence'], c['code']))


def _assessment_form(token, school_id, class_obj, subject_type, subject_id, assessor_id, name):
    criteria = _criteria(token, class_obj['grade'])
    if not criteria:
        st.info('No active competencies have been published for this or earlier levels yet.')
        return
    st.write('Assessing:', name, '—', class_obj['grade'])
    with st.form(f'lit_form_{subject_type}_{subject_id}_{class_obj["id"]}'):
        assessment_date = st.date_input('Assessment date', value=date.today())
        grades = {}
        evidence = {}
        previous_stage = None
        for item in criteria:
            if item['grade'] != previous_stage:
                st.markdown(f"### {item['grade']} competencies")
                previous_stage = item['grade']
            st.markdown(f"**{item['title']}**  ·  {item['code']}")
            if item.get('description'):
                st.caption(item['description'])
            grades[item['id']] = st.selectbox('Observed level', RATINGS, key=f"r_{subject_type}_{subject_id}_{item['id']}")
            evidence[item['id']] = st.text_input('Observation / example (optional)', key=f"e_{subject_type}_{subject_id}_{item['id']}")
        notes = st.text_area('Assessment summary / recommended support')
        confirm = st.checkbox('I confirm that these results reflect my own assessment.')
        save = st.form_submit_button('Save assessment', disabled=not confirm)
    if not save:
        return
    if all(v=='Not Assessed' for v in grades.values()):
        st.error('Assess at least one competency before submitting.')
        return
    # Use a SECURITY DEFINER RPC with transactional header+results insert and server-side authorization.
    items = [{'competency_id':i,'rating':v,'evidence_notes':evidence[i]} for i,v in grades.items()]
    try:
        client = _conn()
        client.postgrest.auth(token)
        result = client.rpc('literacy_submit_assessment', {
            'p_school_id':school_id,'p_class_id':class_obj['id'], 'p_subject_type':subject_type,
            'p_subject_id':subject_id,'p_assessment_date':assessment_date.isoformat(),
            'p_notes':notes,'p_results':items}).execute()
        st.success(f'Assessment saved. Reference: {result.data}')
    except Exception as exc:
        st.error('Could not save assessment. Check permissions and database migration.')
        st.caption(str(exc))


def _student_assessments(token, school_id, classes, user_id):
    st.subheader('🧒 Student Competency Assessment')
    target = _class_picker(classes,'lit_student_class')
    if not target:
        return
    students = sorted(_query(token,'literacy_students','id,class_id,admission_number,student_name,active',class_id=target['id']),key=lambda x:x['student_name'])
    students = [s for s in students if s['active']]
    if not students:
        st.info('Upload the class roster in Assessment Admin to begin.')
        return
    student_ids = {s['id']:f"{s['student_name']} ({s['admission_number']})" for s in students}
    sid = st.selectbox('Student',list(student_ids),format_func=lambda x:student_ids[x])
    _assessment_form(token,school_id,target,'student',sid,user_id,student_ids[sid])


def _teacher_assessments(token, school_id, classes, user_id, role):
    st.subheader('👩‍🏫 Teacher Reading-Competency Assessment')
    if role not in MANAGERS:
        st.info('Teacher competency assessments can be submitted by a coordinator, principal or owner.')
        return
    target = _class_picker(classes,'lit_teacher_class')
    if not target:
        return
    links = _query(token,'literacy_teacher_classes','class_id,teacher_user_id',class_id=target['id'])
    userids = list(dict.fromkeys(l['teacher_user_id'] for l in links))
    if not userids:
        st.info('Assign teachers to this class in the admin module first.')
        return
    teachers = _query(token,'literacy_memberships','user_id,display_name,role',school_id=school_id)
    labels = {t['user_id']:(t.get('display_name') or t['user_id']) for t in teachers if t['user_id'] in userids and t['role']=='teacher'}
    if not labels:
        st.info('No assigned teacher accounts are available.')
        return
    tid = st.selectbox('Teacher', list(labels), format_func=lambda uid:labels[uid])
    st.caption('Review every published level from Nursery through the assigned class. Rate the teacher’s explanation, demonstration and application; record observations.')
    _assessment_form(token,school_id,target,'teacher',tid,user_id,labels[tid])


def _parse_roster(file):
    df = pd.read_csv(file, dtype=str, keep_default_na=False).fillna('')
    columns = {'admission_number','student_name'}
    if not columns.issubset(set(df.columns)):
        raise ValueError('CSV must contain admission_number, student_name')
    clean = []
    seen = set()
    for i,row in df.iterrows():
        number,name = str(row['admission_number']).strip(),str(row['student_name']).strip()
        if not number or not name or len(number)>100 or len(name)>200:
            raise ValueError(f'Invalid admission number or name in CSV row {i+2}')
        if number in seen:
            raise ValueError(f'Duplicate admission number in CSV row {i+2}: {number}')
        seen.add(number)
        clean.append({'admission_number':number,'student_name':name})
    if len(clean)>2000:
        raise ValueError('Maximum 2000 students per upload')
    return clean


def _admin(token,school_id,classes,role):
    if role not in MANAGERS:
        st.error('Only school leadership may open Assessment Admin.')
        return
    st.subheader('🏫 Assessment Administration')
    create, roster, assignments, library = st.tabs(['Classes','Roster Upload','Teacher Assignments','Competency Library'])
    with create:
        with st.form('lit_new_class'):
            grade=st.selectbox('Grade',GRADES)
            section=st.text_input('Section',value='A')
            year=st.text_input('Academic year',value='2026-27')
            clicked=st.form_submit_button('Create class')
        if clicked:
            try:
                if not section.strip() or not year.strip(): raise ValueError('Section and academic year required')
                _db(token,'literacy_classes').insert({'school_id':school_id,'grade':grade,'section':section.strip(), 'academic_year':year.strip()}).execute()
                st.success('Class created. Refresh the page to see it.')
            except Exception as exc: st.error(str(exc))
    with roster:
        target=_class_picker(classes,'lit_admin_class')
        if target:
            uploaded=st.file_uploader('CSV: admission_number,student_name (use internally generated IDs; do not use OneLern IDs)',type='csv')
            if uploaded:
                try:
                    records=_parse_roster(uploaded)
                    st.dataframe(pd.DataFrame(records).head(20),hide_index=True)
                    st.caption(f'{len(records)} validated students. Re-import with the SAME generated IDs to update existing students without duplicates.')
                    if st.button('Confirm roster import'):
                        entries=[dict(class_id=target['id'],**r) for r in records]
                        for n in range(0,len(entries),200):
                            _db(token,'literacy_students').upsert(entries[n:n+200],on_conflict='class_id,admission_number').execute()
                        st.success(f'Imported/updated {len(entries)} students.')
                except Exception as exc: st.error(str(exc))
            template=pd.DataFrame([{'admission_number':'S001','student_name':'Sample Student'}]).to_csv(index=False)
            st.download_button('Download roster CSV template',template,'student_roster_template.csv','text/csv')
    with assignments:
        target=_class_picker(classes,'lit_assignment_class')
        members=_query(token,'literacy_memberships','user_id,display_name,role',school_id=school_id)
        teachers={m['user_id']:(m.get('display_name') or m['user_id']) for m in members if m['role']=='teacher'}
        if target and teachers:
            uid=st.selectbox('Teacher account',list(teachers),format_func=lambda u:teachers[u])
            if st.button('Assign teacher to class'):
                try:
                    _db(token,'literacy_teacher_classes').upsert({'class_id':target['id'],'teacher_user_id':uid},on_conflict='class_id,teacher_user_id').execute()
                    st.success('Teacher assigned.')
                except Exception as exc: st.error(str(exc))
        elif not teachers:
            st.info('Invite teachers using Supabase Auth and assign their school memberships first.')
    with library:
        grade=st.selectbox('Competency grade',GRADES,key='lit_library_grade')
        data=_criteria(token,grade)
        st.dataframe(pd.DataFrame(data),hide_index=True)
        with st.form('lit_add_competency'):
            code=st.text_input('Unique code (e.g. G3_001)')
            strand=st.text_input('Strand')
            title=st.text_input('Competency title')
            description=st.text_area('Description / demonstration criterion')
            if st.form_submit_button('Add competency'):
                try:
                    if not all(x.strip() for x in (code,strand,title)):
                        raise ValueError('Code, strand, and title are required')
                    _db(token,'literacy_competencies').insert({'code':code.strip(),'grade':grade,'strand':strand.strip(),'title':title.strip(), 'description':description.strip(),'sequence':len(data)+1}).execute()
                    st.success('Competency created.')
                except Exception as exc: st.error(str(exc))
        if data:
            items={d['id']:f"{d['code']} — {d['title']}" for d in data}
            cid=st.selectbox('Edit competency',list(items),format_func=lambda k:items[k])
            current=next(c for c in data if c['id']==cid)
            with st.form('lit_edit_competency'):
                newtitle=st.text_input('Title',value=current['title'])
                newdescription=st.text_area('Description',value=current['description'])
                save=st.form_submit_button('Save revision')
            if save:
                try:
                    _db(token,'literacy_competencies').update({'title':newtitle.strip(),'description':newdescription.strip()}).eq('id',cid).execute()
                    st.success('Updated. Previously saved assessments retain their referenced competency ID.')
                except Exception as exc: st.error(str(exc))


def calculate_demonstrated_level(latest_results, competencies, enrolled_grade, min_coverage=0.8, min_independent=0.8):
    """Conservative, sequential proficiency estimate; never equates missing evidence with failure.

    latest_results: mapping competency_id -> rating (most recent assessment only).
    A level is mastered only when >=80% of its competencies have been assessed,
    and >=80% of assessed competencies are rated Independent. Earlier levels must
    also be mastered. Cutoffs are proposed product settings, not sourced standards.
    """
    highest = None
    level_details = []
    consecutive = True
    for level in GRADES[:GRADES.index(enrolled_grade)+1]:
        skills = [c for c in competencies if c['grade'] == level and c.get('active', True)]
        if not skills:
            level_details.append({'Level':level, 'Competencies':0,'Assessed':0,'Independent':0,'Coverage':None,'Independent rate':None,'Mastered':False})
            consecutive = False
            continue
        ratings = [latest_results.get(c['id'],'Not Assessed') for c in skills]
        assessed = [r for r in ratings if r!='Not Assessed']
        n_independent = assessed.count('Independent')
        coverage = len(assessed)/len(skills)
        rate = n_independent/len(assessed) if assessed else 0.0
        mastered = coverage>=min_coverage and rate>=min_independent
        if consecutive and mastered:
            highest = level
        else:
            consecutive = False
        level_details.append({'Level':level,'Competencies':len(skills),'Assessed':len(assessed),'Independent':n_independent,'Coverage':round(coverage*100,1),'Independent rate':round(rate*100,1) if assessed else None,'Mastered':mastered})
    return highest, level_details


def _reports(token,school_id,classes):
    st.subheader('📊 Assessment Progress')
    ids={c['id'] for c in classes}
    assessments=[a for a in _query(token,'literacy_assessments','id,class_id,subject_type,student_id,teacher_user_id,assessment_date,created_at',school_id=school_id) if a['class_id'] in ids]
    if not assessments:
        st.info('No assessments are available for your permitted classes.')
        return
    st.metric('Assessment sessions', len(assessments))
    df=pd.DataFrame(assessments)
    st.dataframe(df.groupby(['assessment_date','subject_type']).size().reset_index(name='Sessions'),hide_index=True)
    target=_class_picker(classes,'lit_report_class')
    if not target: return
    students=[s for s in _query(token,'literacy_students','id,student_name,admission_number,active',class_id=target['id']) if s.get('active',True)]
    if not students:
        st.info('No students enrolled in this class.')
        return
    labels={s['id']:f"{s['student_name']} ({s['admission_number']})" for s in students}
    student_id=st.selectbox('Student progress',list(labels),format_func=lambda i:labels[i],key='lit_report_student')
    history=sorted([a for a in assessments if a['subject_type']=='student' and a['student_id']==student_id],key=lambda a:(a['assessment_date'],a['created_at']),reverse=True)
    if not history:
        st.info('This student has not been assessed yet.')
        return
    # Paginate assessment retrieval with one query per session; latest observed
    # rating wins. Not Assessed is ignored when carrying forward prior evidence.
    latest={}
    for assessment in history:
        items=_query(token,'literacy_assessment_results','competency_id,rating,evidence_notes',assessment_id=assessment['id'])
        for item in items:
            if item['competency_id'] not in latest and item['rating']!='Not Assessed':
                latest[item['competency_id']]=item['rating']
    criteria=_criteria(token,target['grade'])
    level,details=calculate_demonstrated_level(latest,criteria,target['grade'])
    c1,c2=st.columns(2)
    c1.metric('Enrolled grade',target['grade'])
    c2.metric('Demonstrated literacy level',level or 'Not established')
    st.caption('Provisional rules: 80% of each level assessed and 80% of assessed skills Independent, with all earlier levels mastered in order. Missing assessments never count as failure. Grade levels without published competencies cannot be certified.')
    st.dataframe(pd.DataFrame(details),hide_index=True)
    next_level=next((d for d in details if not d['Mastered']),None)
    if next_level:
        st.info(f"Next learning target: {next_level['Level']} competencies. Review the unmastered or unassessed skills before planning remediation.")
    skill_rows=[{'Origin level':c['grade'],'Competency':c['title'],'Status':latest.get(c['id'],'Not Assessed')} for c in criteria]
    st.dataframe(pd.DataFrame(skill_rows),hide_index=True)
    st.download_button('Download student competency report (CSV)',pd.DataFrame(skill_rows).to_csv(index=False).encode('utf-8-sig'),f"literacy_progress_{student_id}.csv",'text/csv')

def render_assessment_module():
    st.title('📚 Foundational Literacy Assessments')
    token,uid=_login()
    from platform_admin_module import is_platform_admin, render_platform_admin
    if is_platform_admin(token, uid):
        mode=st.radio('Workspace', ['Platform Super Admin','School Assessments'], horizontal=True)
        if mode=='Platform Super Admin':
            render_platform_admin(token,uid)
            return
    school_id,role,school_name=_school(token,uid)
    classes=_classes(token,school_id,uid,role)
    tabs=['Student Assessments','Teacher Assessments','Progress Reports']
    if role in MANAGERS:
        tabs.append('Assessment Admin')
    selected=st.radio('Module',tabs,horizontal=True)
    if selected=='Student Assessments': _student_assessments(token,school_id,classes,uid)
    elif selected=='Teacher Assessments': _teacher_assessments(token,school_id,classes,uid,role)
    elif selected=='Progress Reports': _reports(token,school_id,classes)
    else: _admin(token,school_id,classes,role)
