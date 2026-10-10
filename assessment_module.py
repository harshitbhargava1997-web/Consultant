
import streamlit as st
import pandas as pd
from datetime import date
from supabase import create_client

GRADES = (
    "Nursery", "LKG", "UKG",
    "Grade 1", "Grade 2", "Grade 3", "Grade 4"
)

RATINGS = (
    "Not Assessed",
    "Emerging",
    "Developing",
    "Independent"
)

MANAGERS = ("owner", "principal", "coordinator")
ALL_ROLES = MANAGERS + ("teacher",)


# =====================================================
# SUPABASE CONFIGURATION
# =====================================================

def _conn():
    cfg = st.secrets["supabase"]

    url = cfg.get("url") or cfg.get("URL")

    key = next(
        (
            cfg.get(name)
            for name in (
                "anon_key",
                "publishable_key",
                "key",
                "ANON_KEY",
                "PUBLISHABLE_KEY",
                "KEY",
            )
            if cfg.get(name)
        ),
        None,
    )

    if not url or not key:
        st.error(
            "Missing Supabase URL or public key. "
            "Check [supabase] in Streamlit Secrets."
        )
        st.stop()

    # Only use a publishable/anon key.
    # Never use the service-role key here.
    return create_client(url, key)


def _db(token, table):
    client = _conn()
    client.postgrest.auth(token)
    return client.table(table)


def _query(token, table, columns="*", **filters):
    query = _db(token, table).select(columns)

    for field, value in filters.items():
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
                "Password", type="password"
            )
            submitted = st.form_submit_button("Sign In")

        if submitted:
            try:
                result = _conn().auth.sign_in_with_password({
                    "email": email.strip(),
                    "password": password
                })

                if not result.session or not result.user:
                    raise ValueError("Authentication failed")

                st.session_state["lit_auth"] = {
                    "access_token": result.session.access_token,
                    "refresh_token": result.session.refresh_token,
                    "user_id": str(result.user.id)
                }

                st.rerun()

            except Exception:
                st.error(
                    "Sign in failed. Check your "
                    "email address and password."
                )

        st.stop()

    auth = st.session_state["lit_auth"]

    try:
        result = _conn().auth.refresh_session(
            auth["refresh_token"]
        )

        if str(result.user.id) != str(auth["user_id"]):
            raise ValueError("Session identity mismatch")

        auth["access_token"] = (
            result.session.access_token
        )

        auth["refresh_token"] = (
            result.session.refresh_token
        )

    except Exception:
        st.session_state.pop("lit_auth", None)
        st.warning("Session expired. Sign in again.")
        st.stop()

    if st.button("Sign Out", key="lit_signout"):
        st.session_state.pop("lit_auth", None)
        st.rerun()

    return auth["access_token"], auth["user_id"]


# =====================================================
# SCHOOL PERMISSIONS
# =====================================================

def _school(token, user_id):

    memberships = _query(
        token,
        "literacy_memberships",
        "school_id,role,user_id",
        user_id=user_id,
    )

    memberships = [
        item for item in memberships
        if item["role"] in ALL_ROLES
    ]

    if not memberships:
        st.warning(
            "No school membership assigned. "
            "Contact your administrator."
        )
        st.stop()

    allowed_ids = {
        item["school_id"]
        for item in memberships
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

    school_id = st.selectbox(
        "Select School",
        list(names),
        format_func=lambda sid: names[sid],
        key="lit_school",
    )

    role = next(
        item["role"]
        for item in memberships
        if item["school_id"] == school_id
    )

    st.caption(f"Logged in as: {role.title()}")

    return school_id, role, names[school_id]


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

        allowed = {
            item["class_id"]
            for item in assignments
        }

        classes = [
            item for item in classes
            if item["id"] in allowed
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
        st.info("No classes available.")
        return None

    selected = st.selectbox(
        "Class / Section",
        list(options),
        format_func=lambda cid: options[cid],
        key=key,
    )

    return next(
        item for item in classes
        if item["id"] == selected
    )


# =====================================================
# CUMULATIVE COMPETENCIES
# =====================================================

def _criteria(token, grade):

    if grade not in GRADES:
        return []

    allowed = set(
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
            and item["grade"] in allowed
        ],
        key=lambda item: (
            GRADES.index(item["grade"]),
            item["sequence"],
            item["code"],
        ),
    )


# =====================================================
# COMPETENCY ASSESSMENT FORM
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
            "No published competencies available "
            "for this level."
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
            "Assessment Date",
            value=date.today(),
        )

        scores = {}
        evidence = {}
        previous_grade = None

        for item in criteria:

            if item["grade"] != previous_grade:
                st.markdown(
                    f"### {item['grade']} Competencies"
                )
                previous_grade = item["grade"]

            st.markdown(
                f"**{item['title']}** — {item['code']}"
            )

            if item.get("description"):
                st.caption(item["description"])

            scores[item["id"]] = st.selectbox(
                "Competency Level",
                RATINGS,
                key=(
                    f"rating_{subject_type}_"
                    f"{subject_id}_{item['id']}"
                ),
            )

            evidence[item["id"]] = st.text_input(
                "Observation / Evidence",
                key=(
                    f"evidence_{subject_type}_"
                    f"{subject_id}_{item['id']}"
                ),
            )

        notes = st.text_area(
            "Assessment Summary / Recommendations"
        )

        confirmed = st.checkbox(
            "I confirm these assessment results."
        )

        submitted = st.form_submit_button(
            "Save Assessment",
            disabled=not confirmed,
        )

    if not submitted:
        return

    if all(
        score == "Not Assessed"
        for score in scores.values()
    ):
        st.error(
            "Assess at least one competency."
        )
        return

    results = [
        {
            "competency_id": competency_id,
            "rating": rating,
            "evidence_notes": evidence[competency_id],
        }
        for competency_id, rating in scores.items()
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
            f"Assessment saved: {response.data}"
        )

    except Exception as exc:
        st.error("Assessment could not be saved.")
        st.caption(str(exc))


# =====================================================
# STUDENT ASSESSMENT
# =====================================================

def _student_assessments(
    token, school_id, classes, user_id
):

    st.subheader("Student Competency Assessment")

    target = _class_picker(
        classes, "student_class"
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
            "Upload the student roster "
            "in Assessment Administration."
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
        "Select Student",
        list(labels),
        format_func=lambda sid: labels[sid],
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
# TEACHER ASSESSMENT
# =====================================================

def _teacher_assessments(
    token, school_id, classes, user_id, role
):

    st.subheader("Teacher Competency Assessment")

    if role not in MANAGERS:
        st.warning(
            "Teacher assessments require "
            "school leadership access."
        )
        return

    target = _class_picker(
        classes, "teacher_class"
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
        st.info("No teachers assigned to this class.")
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
        st.info("No teacher accounts available.")
        return

    teacher_id = st.selectbox(
        "Select Teacher",
        list(teachers),
        format_func=lambda tid: teachers[tid],
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
# STUDENT ROSTER IMPORT
# =====================================================

def _parse_roster(uploaded_file):

    df = pd.read_csv(
        uploaded_file,
        dtype=str,
        keep_default_na=False,
    ).fillna("")

    required = {
        "admission_number",
        "student_name",
    }

    if not required.issubset(df.columns):
        raise ValueError(
            "CSV requires admission_number "
            "and student_name columns."
        )

    records = []
    seen = set()

    for index, row in df.iterrows():

        student_id = str(
            row["admission_number"]
        ).strip()

        name = str(
            row["student_name"]
        ).strip()

        if (
            not student_id
            or not name
            or len(student_id) > 100
            or len(name) > 200
        ):
            raise ValueError(
                f"Invalid student in row {index + 2}"
            )

        if student_id in seen:
            raise ValueError(
                f"Duplicate student ID: {student_id}"
            )

        seen.add(student_id)

        records.append({
            "admission_number": student_id,
            "student_name": name,
        })

    if len(records) > 2000:
        raise ValueError(
            "Maximum 2,000 students per import."
        )

    return records


# =====================================================
# ASSESSMENT ADMINISTRATION
# =====================================================

def _admin(token, school_id, classes, role):

    if role not in MANAGERS:
        st.error("Administrator access required.")
        return

    st.subheader("Assessment Administration")

    tab1, tab2, tab3, tab4 = st.tabs([
        "Classes",
        "Student Roster",
        "Teacher Assignments",
        "Competency Library",
    ])

    # CREATE CLASS
    with tab1:

        with st.form("create_class"):

            grade = st.selectbox(
                "Grade", GRADES
            )

            section = st.text_input(
                "Section", value="A"
            )

            academic_year = st.text_input(
                "Academic Year",
                value="2026-27",
            )

            save = st.form_submit_button(
                "Create Class"
            )

        if save:

            try:
                if not section.strip() or not academic_year.strip():
                    raise ValueError(
                        "Enter section and academic year."
                    )

                _db(
                    token, "literacy_classes"
                ).insert({
                    "school_id": school_id,
                    "grade": grade,
                    "section": section.strip(),
                    "academic_year": academic_year.strip(),
                }).execute()

                st.success(
                    "Class created. Refresh the page."
                )

            except Exception as exc:
                st.error(str(exc))

    # STUDENT ROSTER
    with tab2:

        target = _class_picker(
            classes, "admin_roster_class"
        )

        if target:

            uploaded = st.file_uploader(
                "Upload Student CSV",
                type="csv",
            )

            if uploaded:

                try:
                    records = _parse_roster(uploaded)

                    st.dataframe(
                        pd.DataFrame(records).head(20),
                        hide_index=True,
                    )

                    st.info(
                        f"{len(records)} students validated."
                    )

                    if st.button("Import Student Roster"):

                        entries = [
                            {
                                "class_id": target["id"],
                                **record,
                            }
                            for record in records
                        ]

                        for index in range(
                            0, len(entries), 200
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
                            f"{len(entries)} students imported."
                        )

                except Exception as exc:
                    st.error(str(exc))

            template = pd.DataFrame([{
                "admission_number": "S001",
                "student_name": "Sample Student",
            }]).to_csv(index=False)

            st.download_button(
                "Download CSV Template",
                template,
                "student_roster_template.csv",
                "text/csv",
            )

    # TEACHER ASSIGNMENTS
    with tab3:

        target = _class_picker(
            classes, "admin_teacher_class"
        )

        memberships = _query(
            token,
            "literacy_memberships",
            "user_id,display_name,role",
            school_id=school_id,
        )

        teachers = {
            member["user_id"]:
                member.get("display_name")
                or member["user_id"]
            for member in memberships
            if member["role"] == "teacher"
        }

        if target and teachers:

            selected_teacher = st.selectbox(
                "Teacher",
                list(teachers),
                format_func=lambda tid:
                    teachers[tid],
            )

            if st.button("Assign Teacher"):

                try:
                    _db(
                        token,
                        "literacy_teacher_classes",
                    ).upsert({
                        "class_id": target["id"],
                        "teacher_user_id": selected_teacher,
                    }, on_conflict=(
                        "class_id,teacher_user_id"
                    )).execute()

                    st.success("Teacher assigned.")

                except Exception as exc:
                    st.error(str(exc))

        elif not teachers:
            st.info(
                "Invite teachers from the "
                "Super Admin dashboard first."
            )

    # READ-ONLY CURRICULUM
    with tab4:

        st.info(
            "The competency library is managed "
            "by the Platform Super Admin."
        )

        grade = st.selectbox(
            "View Competencies Through",
            GRADES,
        )

        competencies = _criteria(token, grade)

        if competencies:

            st.dataframe(
                pd.DataFrame(competencies),
                hide_index=True,
                use_container_width=True,
            )

        else:
            st.info("No competencies published.")


# =====================================================
# DEMONSTRATED LITERACY LEVEL
# =====================================================

def calculate_demonstrated_level(
    latest_results,
    competencies,
    enrolled_grade,
    min_coverage=0.80,
    min_independent=0.80,
):

    highest = None
    details = []
    consecutive = True

    if enrolled_grade not in GRADES:
        return None, []

    for grade in GRADES[
        :GRADES.index(enrolled_grade) + 1
    ]:

        skills = [
            item for item in competencies
            if item["grade"] == grade
            and item.get("active", True)
        ]

        if not skills:

            details.append({
                "Level": grade,
                "Competencies": 0,
                "Assessed": 0,
                "Independent": 0,
                "Coverage": None,
                "Independent Rate": None,
                "Mastered": False,
            })

            consecutive = False
            continue

        ratings = [
            latest_results.get(
                skill["id"], "Not Assessed"
            )
            for skill in skills
        ]

        assessed = [
            rating for rating in ratings
            if rating != "Not Assessed"
        ]

        independent = assessed.count(
            "Independent"
        )

        coverage = len(assessed) / len(skills)

        rate = (
            independent / len(assessed)
            if assessed else 0
        )

        mastered = (
            coverage >= min_coverage
            and rate >= min_independent
        )

        if consecutive and mastered:
            highest = grade
        else:
            consecutive = False

        details.append({
            "Level": grade,
            "Competencies": len(skills),
            "Assessed": len(assessed),
            "Independent": independent,
            "Coverage": round(coverage * 100, 1),
            "Independent Rate": round(rate * 100, 1),
            "Mastered": mastered,
        })

    return highest, details


# =====================================================
# STUDENT PROGRESS REPORT
# =====================================================

def _reports(token, school_id, classes):

    st.subheader("Literacy Progress Reports")

    allowed_ids = {
        item["id"] for item in classes
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
        st.info("No assessment records found.")
        return

    st.metric(
        "Assessment Sessions",
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
        classes, "report_class"
    )

    if not target:
        return

    students = _query(
        token,
        "literacy_students",
        "id,student_name,admission_number,active",
        class_id=target["id"],
    )

    students = [
        student for student in students
        if student.get("active", True)
    ]

    if not students:
        st.info("No students registered.")
        return

    labels = {
        student["id"]: (
            f"{student['student_name']} "
            f"({student['admission_number']})"
        )
        for student in students
    }

    student_id = st.selectbox(
        "Select Student",
        list(labels),
        format_func=lambda sid: labels[sid],
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
        st.info("Student not yet assessed.")
        return

    latest = {}

    for assessment in history:

        results = _query(
            token,
            "literacy_assessment_results",
            "competency_id,rating,evidence_notes",
            assessment_id=assessment["id"],
        )

        for item in results:

            competency_id = item["competency_id"]

            if (
                competency_id not in latest
                and item["rating"] != "Not Assessed"
            ):
                latest[competency_id] = item["rating"]

    competencies = _criteria(
        token, target["grade"]
    )

    level, details = calculate_demonstrated_level(
        latest,
        competencies,
        target["grade"],
    )

    left, right = st.columns(2)

    left.metric(
        "Enrolled Grade",
        target["grade"],
    )

    right.metric(
        "Demonstrated Literacy Level",
        level or "Not Established",
    )

    st.caption(
        "Provisional thresholds: 80% assessment "
        "coverage and 80% Independent performance "
        "at each successive level."
    )

    st.dataframe(
        pd.DataFrame(details),
        hide_index=True,
    )

    next_level = next(
        (
            item for item in details
            if not item["Mastered"]
        ),
        None,
    )

    if next_level:
        st.info(
            f"Next Learning Target: "
            f"{next_level['Level']}"
        )

    report = pd.DataFrame([
        {
            "Origin Level": item["grade"],
            "Competency": item["title"],
            "Status": latest.get(
                item["id"], "Not Assessed"
            ),
        }
        for item in competencies
    ])

    st.dataframe(
        report,
        hide_index=True,
    )

    st.download_button(
        "Download Student Report",
        report.to_csv(index=False).encode("utf-8-sig"),
        f"literacy_report_{student_id}.csv",
        "text/csv",
    )


# =====================================================
# MAIN APPLICATION
# =====================================================

def render_assessment_module():

    st.title(
        "Foundational Literacy Assessment Platform"
    )

    token, user_id = _login()

    from platform_admin_module import (
        is_platform_admin,
        render_platform_admin,
    )

    if is_platform_admin(token, user_id):

        workspace = st.radio(
            "Select Workspace",
            [
                "Platform Super Admin",
                "School Assessments",
            ],
            horizontal=True,
        )

        if workspace == "Platform Super Admin":

            render_platform_admin(
                token, user_id
            )

            return

    school_id, role, school_name = _school(
        token, user_id
    )

    st.caption(f"School: {school_name}")

    classes = _classes(
        token,
        school_id,
        user_id,
        role,
    )

    modules = [
        "Student Assessments",
        "Teacher Assessments",
        "Progress Reports",
    ]

    if role in MANAGERS:
        modules.append("Assessment Admin")

    selected = st.radio(
        "Module",
        modules,
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

    elif selected == "Assessment Admin":

        _admin(
            token,
            school_id,
            classes,
            role,
        )
