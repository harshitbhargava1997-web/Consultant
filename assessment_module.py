
"""School-scoped literacy assessment Streamlit interface.

Uses Supabase Authentication and Row Level Security.
Never uses the service-role key for ordinary assessments.
"""

import io
from datetime import date

import pandas as pd
import streamlit as st
from supabase import create_client


GRADES = (
    "Nursery",
    "LKG",
    "UKG",
    "Grade 1",
    "Grade 2",
    "Grade 3",
    "Grade 4",
)

RATINGS = (
    "Not Assessed",
    "Emerging",
    "Developing",
    "Independent",
)

MANAGERS = ("owner", "principal", "coordinator")
ALL_ROLES = MANAGERS + ("teacher",)


# =====================================================
# SUPABASE CONNECTION
# =====================================================

def _conn():
    cfg = st.secrets["supabase"]

    key = (
        cfg.get("anon_key")
        or cfg.get("publishable_key")
    )

    if not key:
        st.error(
            "Configure [supabase] anon_key or "
            "publishable_key in Streamlit Secrets."
        )
        st.stop()

    return create_client(cfg["url"], key)


def _db(token, table):
    client = _conn()
    client.postgrest.auth(token)
    return client.table(table)


def _query(token, table, columns="*", **equalities):
    query = _db(token, table).select(columns)

    for field, value in equalities.items():
        query = query.eq(field, value)

    return query.execute().data or []


# =====================================================
# AUTHENTICATION
# =====================================================

def _login():
    st.subheader("Literacy Assessment Sign In")

    if "lit_auth" not in st.session_state:

        with st.form("lit_login"):
            email = st.text_input("Email")
            password = st.text_input(
                "Password",
                type="password"
            )
            submitted = st.form_submit_button("Sign in")

        if submitted:
            try:
                result = _conn().auth.sign_in_with_password({
                    "email": email.strip(),
                    "password": password,
                })

                if not result.session or not result.user:
                    raise ValueError("No authenticated session")

                st.session_state["lit_auth"] = {
                    "access_token": result.session.access_token,
                    "refresh_token": result.session.refresh_token,
                    "user_id": str(result.user.id),
                }

                st.rerun()

            except Exception:
                st.error(
                    "Sign in failed. Check credentials "
                    "or contact your administrator."
                )

        st.stop()

    auth = st.session_state["lit_auth"]

    try:
        result = _conn().auth.refresh_session(
            auth["refresh_token"]
        )

        if str(result.user.id) != str(auth["user_id"]):
            raise ValueError("Session identity mismatch")

        auth.update({
            "access_token": result.session.access_token,
            "refresh_token": result.session.refresh_token,
        })

    except Exception:
        st.session_state.pop("lit_auth", None)
        st.warning("Session expired. Please sign in again.")
        st.stop()

    if st.button("Sign out", key="lit_signout"):
        st.session_state.pop("lit_auth", None)
        st.rerun()

    return auth["access_token"], auth["user_id"]


# =====================================================
# SCHOOL ACCESS
# =====================================================

def _school(token, user_id):

    memberships = _query(
        token,
        "literacy_memberships",
        "school_id,role,user_id",
        user_id=user_id,
    )

    memberships = [
        membership
        for membership in memberships
        if membership["role"] in ALL_ROLES
    ]

    if not memberships:
        st.warning(
            "No school is assigned to this account. "
            "Contact your platform administrator."
        )
        st.stop()

    allowed_ids = {
        membership["school_id"]
        for membership in memberships
    }

    schools = [
        school
        for school in _query(
            token,
            "literacy_schools",
            "id,name",
        )
        if school["id"] in allowed_ids
    ]

    if not schools:
        st.warning("No accessible schools found.")
        st.stop()

    names = {
        school["id"]: school["name"]
        for school in schools
    }

    selected_id = st.selectbox(
        "School",
        options=list(names),
        format_func=lambda school_id: names[school_id],
        key="lit_school",
    )

    role = next(
        membership["role"]
        for membership in memberships
        if membership["school_id"] == selected_id
    )

    st.caption(f"Signed in as: {role.title()}")

    return selected_id, role, names[selected_id]


def _classes(token, school_id, user_id, role):

    classes = _query(
        token,
        "literacy_classes",
        "id,school_id,grade,section,academic_year",
        school_id=school_id,
    )

    if role == "teacher":

        assignments = _query(
            token,
            "literacy_teacher_classes",
            "class_id",
            teacher_user_id=user_id,
        )

        assigned = {
            item["class_id"]
            for item in assignments
        }

        classes = [
            item
            for item in classes
            if item["id"] in assigned
        ]

    return sorted(
        classes,
        key=lambda item: (
            item["academic_year"],
            GRADES.index(item["grade"])
            if item["grade"] in GRADES else 99,
            item["section"],
        ),
        reverse=True,
    )


def _class_picker(classes, key):

    options = {
        item["id"]: (
            f"{item['grade']} - {item['section']} "
            f"({item['academic_year']})"
        )
        for item in classes
    }

    if not options:
        st.info("No classes are assigned to this account.")
        return None

    selected_id = st.selectbox(
        "Class / Section",
        list(options),
        format_func=lambda item_id: options[item_id],
        key=key,
    )

    return next(
        item
        for item in classes
        if item["id"] == selected_id
    )


# =====================================================
# CUMULATIVE COMPETENCIES
# =====================================================

def _criteria(token, grade):

    if grade not in GRADES:
        return []

    allowed_grades = set(
        GRADES[:GRADES.index(grade) + 1]
    )

    competencies = _query(
        token,
        "literacy_competencies",
        "id,code,grade,strand,title,"
        "description,sequence,active",
    )

    return sorted(
        [
            item
            for item in competencies
            if item["active"]
            and item["grade"] in allowed_grades
        ],
        key=lambda item: (
            GRADES.index(item["grade"]),
            item["sequence"],
            item["code"],
        ),
    )


# =====================================================
# STUDENT / TEACHER ASSESSMENT FORM
# =====================================================

def _assessment_form(
    token,
    school_id,
    class_obj,
    subject_type,
    subject_id,
    assessor_id,
    name,
):

    criteria = _criteria(token, class_obj["grade"])

    if not criteria:
        st.info(
            "No active competencies have been published "
            "for this or earlier levels."
        )
        return

    st.write(
        "Assessing:",
        name,
        "—",
        class_obj["grade"],
    )

    form_key = (
        f"lit_form_{subject_type}_"
        f"{subject_id}_{class_obj['id']}"
    )

    with st.form(form_key):

        assessment_date = st.date_input(
            "Assessment date",
            value=date.today(),
        )

        grades = {}
        evidence = {}
        previous_stage = None

        for item in criteria:

            if item["grade"] != previous_stage:
                st.markdown(
                    f"### {item['grade']} competencies"
                )
                previous_stage = item["grade"]

            st.markdown(
                f"**{item['title']}** · {item['code']}"
            )

            if item.get("description"):
                st.caption(item["description"])

            rating_key = (
                f"r_{subject_type}_{subject_id}_"
                f"{item['id']}"
            )

            evidence_key = (
                f"e_{subject_type}_{subject_id}_"
                f"{item['id']}"
            )

            grades[item["id"]] = st.selectbox(
                "Observed level",
                RATINGS,
                key=rating_key,
            )

            evidence[item["id"]] = st.text_input(
                "Observation / example (optional)",
                key=evidence_key,
            )

        notes = st.text_area(
            "Assessment summary / recommended support"
        )

        confirm = st.checkbox(
            "I confirm these results reflect "
            "my own assessment."
        )

        save = st.form_submit_button(
            "Save assessment",
            disabled=not confirm,
        )

    if not save:
        return

    if all(
        rating == "Not Assessed"
        for rating in grades.values()
    ):
        st.error(
            "Assess at least one competency "
            "before submitting."
        )
        return

    results = [
        {
            "competency_id": competency_id,
            "rating": rating,
            "evidence_notes": evidence[competency_id],
        }
        for competency_id, rating in grades.items()
    ]

    try:
        client = _conn()
        client.postgrest.auth(token)

        response = client.rpc(
            "literacy_submit_assessment",
            {
                "p_school_id": school_id,
                "p_class_id": class_obj["id"],
                "p_subject_type": subject_type,
                "p_subject_id": subject_id,
                "p_assessment_date":
                    assessment_date.isoformat(),
                "p_notes": notes,
                "p_results": results,
            },
        ).execute()

        st.success(
            f"Assessment saved. Reference: "
            f"{response.data}"
        )

    except Exception as exc:
        st.error(
            "Could not save the assessment. "
            "Check permissions and database migration."
        )
        st.caption(str(exc))


# =====================================================
# STUDENT ASSESSMENTS
# =====================================================

def _student_assessments(
    token,
    school_id,
    classes,
    user_id,
):

    st.subheader("Student Competency Assessment")

    target = _class_picker(
        classes,
        "lit_student_class",
    )

    if not target:
        return

    students = _query(
        token,
        "literacy_students",
        "id,class_id,admission_number,"
        "student_name,active",
        class_id=target["id"],
    )

    students = sorted(
        [
            student
            for student in students
            if student["active"]
        ],
        key=lambda item: item["student_name"],
    )

    if not students:
        st.info(
            "Upload a student roster in "
            "Assessment Administration first."
        )
        return

    labels = {
        student["id"]: (
            f"{student['student_name']} "
            f"({student['admission_number']})"
        )
        for student in students
    }

    student_id = st.selectbox(
        "Student",
        list(labels),
        format_func=lambda item_id: labels[item_id],
    )

    _assessment_form(
        token,
        school_id,
        target,
        "student",
        student_id,
        user_id,
        labels[student_id],
    )


# =====================================================
# TEACHER ASSESSMENTS
# =====================================================

def _teacher_assessments(
    token,
    school_id,
    classes,
    user_id,
    role,
):

    st.subheader(
        "Teacher Reading Competency Assessment"
    )

    if role not in MANAGERS:
        st.info(
            "Only school leadership can submit "
            "teacher competency assessments."
        )
        return

    target = _class_picker(
        classes,
        "lit_teacher_class",
    )

    if not target:
        return

    assignments = _query(
        token,
        "literacy_teacher_classes",
        "class_id,teacher_user_id",
        class_id=target["id"],
    )

    assigned_ids = {
        item["teacher_user_id"]
        for item in assignments
    }

    if not assigned_ids:
        st.info(
            "Assign teachers to this class first."
        )
        return

    members = _query(
        token,
        "literacy_memberships",
        "user_id,display_name,role",
        school_id=school_id,
    )

    teachers = {
        member["user_id"]:
            member.get("display_name")
            or member["user_id"]
        for member in members
        if member["user_id"] in assigned_ids
        and member["role"] == "teacher"
    }

    if not teachers:
        st.info(
            "No assigned teacher accounts are available."
        )
        return

    teacher_id = st.selectbox(
        "Teacher",
        list(teachers),
        format_func=lambda item_id: teachers[item_id],
    )

    st.caption(
        "Assess the teacher's ability to explain, "
        "demonstrate and apply the competencies."
    )

    _assessment_form(
        token,
        school_id,
        target,
        "teacher",
        teacher_id,
        user_id,
        teachers[teacher_id],
    )


# =====================================================
# STUDENT ROSTER VALIDATION
# =====================================================

def _parse_roster(file):

    df = pd.read_csv(
        file,
        dtype=str,
        keep_default_na=False,
    ).fillna("")

    required = {
        "admission_number",
        "student_name",
    }

    if not required.issubset(set(df.columns)):
        raise ValueError(
            "CSV must contain admission_number "
            "and student_name."
        )

    records = []
    seen = set()

    for index, row in df.iterrows():

        number = str(
            row["admission_number"]
        ).strip()

        name = str(
            row["student_name"]
        ).strip()

        if (
            not number
            or not name
            or len(number) > 100
            or len(name) > 200
        ):
            raise ValueError(
                f"Invalid student record "
                f"in CSV row {index + 2}."
            )

        if number in seen:
            raise ValueError(
                f"Duplicate assessment ID "
                f"in CSV row {index + 2}: {number}"
            )

        seen.add(number)

        records.append({
            "admission_number": number,
            "student_name": name,
        })

    if len(records) > 2000:
        raise ValueError(
            "Maximum 2,000 students per upload."
        )

    return records


# =====================================================
# SCHOOL ASSESSMENT ADMINISTRATION
# =====================================================

def _admin(token, school_id, classes, role):

    if role not in MANAGERS:
        st.error(
            "Only school leadership may open "
            "Assessment Administration."
        )
        return

    st.subheader("Assessment Administration")

    create, roster, assignments, library = st.tabs([
        "Classes",
        "Roster Upload",
        "Teacher Assignments",
        "Competency Library",
    ])

    with create:

        with st.form("lit_new_class"):

            grade = st.selectbox(
                "Grade",
                GRADES,
            )

            section = st.text_input(
                "Section",
                value="A",
            )

            year = st.text_input(
                "Academic year",
                value="2026-27",
            )

            clicked = st.form_submit_button(
                "Create class"
            )

        if clicked:
            try:
                if not section.strip() or not year.strip():
                    raise ValueError(
                        "Section and academic year required."
                    )

                _db(
                    token,
                    "literacy_classes",
                ).insert({
                    "school_id": school_id,
                    "grade": grade,
                    "section": section.strip(),
                    "academic_year": year.strip(),
                }).execute()

                st.success(
                    "Class created. Refresh to see it."
                )

            except Exception as exc:
                st.error(str(exc))

    with roster:

        target = _class_picker(
            classes,
            "lit_admin_class",
        )

        if target:

            uploaded = st.file_uploader(
                "CSV: admission_number, student_name. "
                "Use your independent assessment IDs.",
                type="csv",
            )

            if uploaded:

                try:
                    records = _parse_roster(uploaded)

                    st.dataframe(
                        pd.DataFrame(records).head(20),
                        hide_index=True,
                    )

                    st.caption(
                        f"{len(records)} students validated. "
                        "Use the same assessment IDs "
                        "for future uploads."
                    )

                    if st.button(
                        "Confirm roster import"
                    ):

                        entries = [
                            dict(
                                class_id=target["id"],
                                **record,
                            )
                            for record in records
                        ]

                        for index in range(
                            0,
                            len(entries),
                            200,
                        ):
                            batch = entries[
                                index:index + 200
                            ]

                            _db(
                                token,
                                "literacy_students",
                            ).upsert(
                                batch,
                                on_conflict=(
                                    "class_id,admission_number"
                                ),
                            ).execute()

                        st.success(
                            f"Imported/updated "
                            f"{len(entries)} students."
                        )

                except Exception as exc:
                    st.error(str(exc))

            template = pd.DataFrame([
                {
                    "admission_number": "S001",
                    "student_name": "Sample Student",
                }
            ]).to_csv(index=False)

            st.download_button(
                "Download roster CSV template",
                template,
                "student_roster_template.csv",
                "text/csv",
            )

    with assignments:

        target = _class_picker(
            classes,
            "lit_assignment_class",
        )

        members = _query(
            token,
            "literacy_memberships",
            "user_id,display_name,role",
            school_id=school_id,
        )

        teachers = {
            member["user_id"]:
                member.get("display_name")
                or member["user_id"]
            for member in members
            if member["role"] == "teacher"
        }

        if target and teachers:

            teacher_id = st.selectbox(
                "Teacher account",
                list(teachers),
                format_func=lambda item_id:
                    teachers[item_id],
            )

            if st.button(
                "Assign teacher to class"
            ):
                try:
                    _db(
                        token,
                        "literacy_teacher_classes",
                    ).upsert(
                        {
                            "class_id": target["id"],
                            "teacher_user_id": teacher_id,
                        },
                        on_conflict=(
                            "class_id,teacher_user_id"
                        ),
                    ).execute()

                    st.success(
                        "Teacher assigned."
                    )

                except Exception as exc:
                    st.error(str(exc))

        elif not teachers:
            st.info(
                "Invite teacher accounts from "
                "the Super Admin dashboard first."
            )

    with library:

        st.info(
            "The competency library is shared "
            "across schools. Only the Platform "
            "Super Admin may publish or edit it."
        )

        grade = st.selectbox(
            "View competencies up to grade",
            GRADES,
            key="lit_library_grade",
        )

        data = _criteria(token, grade)

        if data:
            st.dataframe(
                pd.DataFrame(data),
                hide_index=True,
                use_container_width=True,
            )
        else:
            st.caption(
                "No published competencies "
                "at these levels."
            )


# =====================================================
# DEMONSTRATED LITERACY LEVEL
# =====================================================

def calculate_demonstrated_level(
    latest_results,
    competencies,
    enrolled_grade,
    min_coverage=0.8,
    min_independent=0.8,
):
    """
    Calculate the highest consecutively mastered level.

    Each level requires:
      - At least 80% competency assessment coverage.
      - At least 80% Independent among assessed skills.

    Missing assessments are not counted as failures.
    Thresholds are provisional product rules.
    """

    highest = None
    details = []
    consecutive = True

    if enrolled_grade not in GRADES:
        return None, []

    levels = GRADES[
        :GRADES.index(enrolled_grade) + 1
    ]

    for level in levels:

        skills = [
            competency
            for competency in competencies
            if competency["grade"] == level
            and competency.get("active", True)
        ]

        if not skills:

            details.append({
                "Level": level,
                "Competencies": 0,
                "Assessed": 0,
                "Independent": 0,
                "Coverage": None,
                "Independent rate": None,
                "Mastered": False,
            })

            consecutive = False
            continue

        ratings = [
            latest_results.get(
                competency["id"],
                "Not Assessed",
            )
            for competency in skills
        ]

        assessed = [
            rating
            for rating in ratings
            if rating != "Not Assessed"
        ]

        independent_count = assessed.count(
            "Independent"
        )

        coverage = len(assessed) / len(skills)

        independent_rate = (
            independent_count / len(assessed)
            if assessed else 0.0
        )

        mastered = (
            coverage >= min_coverage
            and independent_rate >= min_independent
        )

        if consecutive and mastered:
            highest = level
        else:
            consecutive = False

        details.append({
            "Level": level,
            "Competencies": len(skills),
            "Assessed": len(assessed),
            "Independent": independent_count,
            "Coverage": round(
                coverage * 100,
                1,
            ),
            "Independent rate": (
                round(independent_rate * 100, 1)
                if assessed else None
            ),
            "Mastered": mastered,
        })

    return highest, details


# =====================================================
# PROGRESS REPORTS
# =====================================================

def _reports(token, school_id, classes):

    st.subheader("Assessment Progress")

    allowed_ids = {
        item["id"]
        for item in classes
    }

    assessments = [
        item
        for item in _query(
            token,
            "literacy_assessments",
            "id,class_id,subject_type,student_id,"
            "teacher_user_id,assessment_date,created_at",
            school_id=school_id,
        )
        if item["class_id"] in allowed_ids
    ]

    if not assessments:
        st.info(
            "No assessments are available "
            "for your permitted classes."
        )
        return

    st.metric(
        "Assessment sessions",
        len(assessments),
    )

    df = pd.DataFrame(assessments)

    summary = (
        df.groupby([
            "assessment_date",
            "subject_type",
        ])
        .size()
        .reset_index(name="Sessions")
    )

    st.dataframe(
        summary,
        hide_index=True,
    )

    target = _class_picker(
        classes,
        "lit_report_class",
    )

    if not target:
        return

    students = [
        student
        for student in _query(
            token,
            "literacy_students",
            "id,student_name,admission_number,active",
            class_id=target["id"],
        )
        if student.get("active", True)
    ]

    if not students:
        st.info("No students enrolled in this class.")
        return

    labels = {
        student["id"]: (
            f"{student['student_name']} "
            f"({student['admission_number']})"
        )
        for student in students
    }

    student_id = st.selectbox(
        "Student progress",
        list(labels),
        format_func=lambda item_id: labels[item_id],
        key="lit_report_student",
    )

    history = sorted(
        [
            item
            for item in assessments
            if item["subject_type"] == "student"
            and item["student_id"] == student_id
        ],
        key=lambda item: (
            item["assessment_date"],
            item["created_at"],
        ),
        reverse=True,
    )

    if not history:
        st.info(
            "This student has not been assessed yet."
        )
        return

    latest = {}

    for assessment in history:

        results = _query(
            token,
            "literacy_assessment_results",
            "competency_id,rating,evidence_notes",
            assessment_id=assessment["id"],
        )

        for result in results:

            competency_id = result["competency_id"]

            if (
                competency_id not in latest
                and result["rating"] != "Not Assessed"
            ):
                latest[competency_id] = result["rating"]

    criteria = _criteria(
        token,
        target["grade"],
    )

    level, details = calculate_demonstrated_level(
        latest,
        criteria,
        target["grade"],
    )

    left, right = st.columns(2)

    left.metric(
        "Enrolled grade",
        target["grade"],
    )

    right.metric(
        "Demonstrated literacy level",
        level or "Not established",
    )

    st.caption(
        "Provisional thresholds: 80% competency "
        "coverage and 80% Independent performance "
        "at each successive level. Unassessed "
        "competencies are not treated as failures."
    )

    st.dataframe(
        pd.DataFrame(details),
        hide_index=True,
    )

    next_level = next(
        (
            item
            for item in details
            if not item["Mastered"]
        ),
        None,
    )

    if next_level:

        st.info(
            f"Next learning target: "
            f"{next_level['Level']} competencies."
        )

    skill_rows = [
        {
            "Origin level": item["grade"],
            "Competency": item["title"],
            "Status": latest.get(
                item["id"],
                "Not Assessed",
            ),
        }
        for item in criteria
    ]

    report = pd.DataFrame(skill_rows)

    st.dataframe(
        report,
        hide_index=True,
    )

    st.download_button(
        "Download student competency report (CSV)",
        report.to_csv(
            index=False
        ).encode("utf-8-sig"),
        f"literacy_progress_{student_id}.csv",
        "text/csv",
    )


# =====================================================
# MAIN APPLICATION ROUTER
# =====================================================

def render_assessment_module():

    st.title("Foundational Literacy Assessments")

    token, user_id = _login()

    from platform_admin_module import (
        is_platform_admin,
        render_platform_admin,
    )

    if is_platform_admin(token, user_id):

        workspace = st.radio(
            "Workspace",
            [
                "Platform Super Admin",
                "School Assessments",
            ],
            horizontal=True,
        )

        if workspace == "Platform Super Admin":
            render_platform_admin(
                token,
                user_id,
            )
            return

    school_id, role, school_name = _school(
        token,
        user_id,
    )

    classes = _classes(
        token,
        school_id,
        user_id,
        role,
    )

    tabs = [
        "Student Assessments",
        "Teacher Assessments",
        "Progress Reports",
    ]

    if role in MANAGERS:
        tabs.append("Assessment Admin")

    selected = st.radio(
        "Module",
        tabs,
        horizontal=True,
    )

    if selected == "Student Assessments":
        _student_assessments(
            token,
            school_id,
            classes,
            user_id,
        )

    elif selected == "Teacher Assessments":
        _teacher_assessments(
            token,
            school_id,
            classes,
            user_id,
            role,
        )

    elif selected == "Progress Reports":
        _reports(
            token,
            school_id,
            classes,
        )

    else:
        _admin(
            token,
            school_id,
            classes,
            role,
        )

