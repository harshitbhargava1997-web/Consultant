
"""
Platform Super Admin module.

Requires:
- Streamlit
- supabase-py
- literacy_platform_admins table
- literacy_schools table
- literacy_memberships table

The service-role key must be stored ONLY in
private Streamlit server-side secrets.
"""

import streamlit as st
from supabase import create_client

ROLES = (
    "owner",
    "principal",
    "coordinator",
    "teacher",
)


def _admin_client():
    cfg = st.secrets["supabase"]
    service_key = cfg.get("service_role_key")

    if not service_key:
        st.error(
            "Missing Supabase service_role_key "
            "in Streamlit Secrets."
        )
        st.stop()

    return create_client(
        cfg["url"],
        service_key,
    )


def _identity_verified(token, user_id):
    """
    Verify both the Supabase Auth identity
    and membership in the platform-admin registry.
    Never authorize by email alone.
    """

    admin = _admin_client()

    result = admin.auth.get_user(token)
    user = result.user

    if not user:
        raise PermissionError(
            "Authentication required."
        )

    if str(user.id) != str(user_id):
        raise PermissionError(
            "Session identity verification failed."
        )

    if not user.email_confirmed_at:
        raise PermissionError(
            "Email confirmation required."
        )

    rows = (
        admin.table("literacy_platform_admins")
        .select("user_id")
        .eq("user_id", str(user.id))
        .limit(1)
        .execute()
        .data
    )

    if not rows:
        raise PermissionError(
            "Not authorized as Platform Super Admin."
        )

    return admin


def is_platform_admin(token, user_id):
    try:
        _identity_verified(token, user_id)
        return True
    except Exception:
        return False


def _school_list(admin):
    return (
        admin.table("literacy_schools")
        .select("id,name,created_at")
        .order("name")
        .execute()
        .data
    ) or []


def _existing_auth_user(admin, email):
    """
    Find an existing Supabase Auth user.
    Paginate so users after page 1 are included.
    """

    page = 1

    while True:
        response = admin.auth.admin.list_users(
            page=page,
            per_page=200,
        )

        users = (
            response
            if isinstance(response, list)
            else getattr(response, "users", [])
        )

        for user in users:
            if (
                (user.email or "").strip().lower()
                == email.strip().lower()
            ):
                return user

        if len(users) < 200:
            return None

        page += 1


def render_platform_admin(token, user_id):

    try:
        admin = _identity_verified(token, user_id)
    except Exception:
        st.error(
            "You do not have verified "
            "Platform Super Admin access."
        )
        st.stop()

    st.title("Platform Super Admin")

    st.caption(
        "Manage schools, user invitations "
        "and school-specific permissions."
    )

    schools = _school_list(admin)

    tab_schools, tab_invite, tab_users = st.tabs([
        "School Management",
        "Create User Accounts",
        "Users & Roles",
    ])

    # --------------------------
    # SCHOOL MANAGEMENT
    # --------------------------

    with tab_schools:

        st.subheader("Registered Schools")

        st.dataframe(
            [
                {
                    "School Name": s["name"],
                    "School ID": s["id"],
                }
                for s in schools
            ],
            hide_index=True,
            use_container_width=True,
        )

        st.subheader("Add New School")

        with st.form("create_school_form"):

            name = st.text_input(
                "School Name",
                placeholder="Enter school name",
            )

            submitted = st.form_submit_button(
                "Create School"
            )

        if submitted:

            if not name.strip() or len(name.strip()) > 200:
                st.error(
                    "Enter a school name "
                    "up to 200 characters."
                )
            else:
                try:
                    admin.table(
                        "literacy_schools"
                    ).insert({
                        "name": name.strip()
                    }).execute()

                    st.success(
                        "School created successfully. "
                        "Refresh to update the school list."
                    )

                except Exception as exc:
                    st.error(
                        f"School creation failed: {exc}"
                    )

    # --------------------------
    # USER MANAGEMENT
    # --------------------------

    with tab_invite:

        st.subheader("Create School User")

        if not schools:

            st.info(
                "Create a school before "
                "inviting users."
            )

        else:

            school_labels = {
                s["id"]: s["name"]
                for s in schools
            }

            with st.form("invite_school_user"):

                school_id = st.selectbox(
                    "Select School",
                    list(school_labels),
                    format_func=lambda sid:
                        school_labels[sid],
                )

                full_name = st.text_input(
                    "Full Name"
                )

                email = st.text_input(
                    "Login Email Address"
                )

                role = st.selectbox(
                    "User Role",
                    ROLES,
                )

                confirmed = st.checkbox(
                    "I confirm this user is "
                    "authorized for the selected "
                    "school and role."
                )

                submitted = st.form_submit_button(
                    "Invite / Assign User"
                )

            if submitted:

                if (
                    not confirmed
                    or not full_name.strip()
                    or "@" not in email
                ):
                    st.error(
                        "Enter valid user details "
                        "and confirm authorization."
                    )

                else:

                    try:

                        normalized_email = (
                            email.strip().lower()
                        )

                        user = _existing_auth_user(
                            admin,
                            normalized_email,
                        )

                        invited = False

                        if user is None:

                            response = (
                                admin.auth.admin
                                .invite_user_by_email(
                                    normalized_email
                                )
                            )

                            user = response.user
                            invited = True

                        if user is None:
                            raise RuntimeError(
                                "User ID was not returned."
                            )

                        admin.table(
                            "literacy_memberships"
                        ).upsert({
                            "school_id": school_id,
                            "user_id": str(user.id),
                            "display_name":
                                full_name.strip(),
                            "role": role,
                        }, on_conflict=(
                            "school_id,user_id"
                        )).execute()

                        if invited:

                            st.success(
                                "Invitation created. "
                                "The user can check "
                                "their email for the "
                                "account setup link."
                            )

                        else:

                            st.success(
                                "Existing user assigned "
                                "to the selected school. "
                                "Their password was "
                                "not changed."
                            )

                    except Exception as exc:

                        st.error(
                            f"User setup failed: {exc}"
                        )

                        st.warning(
                            "If an invitation succeeded "
                            "but role assignment failed, "
                            "check memberships before "
                            "retrying."
                        )

    # --------------------------
    # VIEW USERS AND ROLES
    # --------------------------

    with tab_users:

        st.subheader("School Users")

        if not schools:

            st.info("No registered schools.")

        else:

            school_labels = {
                s["id"]: s["name"]
                for s in schools
            }

            selected_id = st.selectbox(
                "Select School",
                list(school_labels),
                format_func=lambda sid:
                    school_labels[sid],
                key="view_school_users",
            )

            members = (
                admin.table(
                    "literacy_memberships"
                )
                .select(
                    "user_id,display_name,role"
                )
                .eq("school_id", selected_id)
                .execute()
                .data
            ) or []

            st.dataframe(
                members,
                hide_index=True,
                use_container_width=True,
            )

            st.caption(
                "Access revocation and user "
                "suspension will be added in "
                "a subsequent update."
            )
