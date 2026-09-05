import streamlit as st
import pandas as pd
import re
import uuid
import concurrent.futures
from io import BytesIO

from supabase import create_client
import boto3
from boto3.s3.transfer import TransferConfig


# ============================================================
# PAGE CONFIG
# ============================================================

st.set_page_config(
    page_title="Teacher Daily Implementation Portal",
    page_icon="📝",
    layout="centered"
)


# ============================================================
# CONFIGURATION
# ============================================================

MAX_FILE_SIZE_MB = 50
MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024

MAX_PARALLEL_UPLOADS = 5

R2_MULTIPART_THRESHOLD = 8 * 1024 * 1024
R2_MULTIPART_CHUNK_SIZE = 8 * 1024 * 1024

MAX_IMPLEMENTATION_GROUPS = 10

TEACHER_RECORDS_TABLE = "teacher_records"


# ============================================================
# SUPABASE CONFIG
# ============================================================

SUPABASE_URL = st.secrets["supabase"]["url"]
SUPABASE_KEY = st.secrets["supabase"]["key"]

supabase = create_client(
    SUPABASE_URL,
    SUPABASE_KEY
)


# ============================================================
# CLOUDFLARE R2 CONFIG
# ============================================================

r2_secrets = st.secrets["r2"]

R2_ACCOUNT_ID = r2_secrets["R2_ACCOUNT_ID"]
R2_ACCESS_KEY_ID = r2_secrets["R2_ACCESS_KEY_ID"]
R2_SECRET_ACCESS_KEY = r2_secrets["R2_SECRET_ACCESS_KEY"]
R2_BUCKET_NAME = r2_secrets["R2_BUCKET_NAME"]
R2_ENDPOINT_URL = r2_secrets["R2_ENDPOINT_URL"]


r2_client = boto3.client(
    "s3",
    endpoint_url=R2_ENDPOINT_URL,
    aws_access_key_id=R2_ACCESS_KEY_ID,
    aws_secret_access_key=R2_SECRET_ACCESS_KEY,
    region_name="auto"
)


R2_TRANSFER_CONFIG = TransferConfig(
    multipart_threshold=R2_MULTIPART_THRESHOLD,
    multipart_chunksize=R2_MULTIPART_CHUNK_SIZE,
    max_concurrency=5,
    use_threads=True
)


# ============================================================
# MASTER ROSTER COLUMNS
# ============================================================

ROSTER_COLUMNS = [
    "State_Zone",
    "Uploaded_By",
    "Institution",
    "FullName",
    "Role"
]


# ============================================================
# OPTIONS
# ============================================================

GRADE_OPTIONS = [
    "Nursery",
    "LKG",
    "UKG",
    "Grade 1",
    "Grade 2",
    "Grade 3",
    "Grade 4",
    "Grade 5"
]


SUBJECT_OPTIONS = [
    "All Subjects Together",
    "Phonics / Literacy",
    "Mathematics",
    "Numeracy",
    "English",
    "Hindi",
    "Environmental Studies (EVS)",
    "Science",
    "General Knowledge (GK)",
    "English Grammar",
    "Computer",
    "Play Activity",
    "Play Time",
    "Play Based"
]


EVIDENCE_TYPES = [
    "Classroom Activity",
    "Student Written Work",
    "Phonics / Phonetics Implementation",
    "Student Assessment",
    "Teacher Portfolio"
]


# ============================================================
# HELPER FUNCTIONS
# ============================================================

def sanitize_path_component(value):
    """
    Convert a value into a safe R2 path component.
    """
    value = str(value or "").strip()
    value = re.sub(r"\s+", "_", value)
    value = re.sub(r"[^A-Za-z0-9_\-\.]", "_", value)
    return value[:150]


def get_file_size_mb(uploaded_file):
    """
    Return uploaded file size in MB.
    """
    try:
        return len(uploaded_file.getvalue()) / (1024 * 1024)
    except Exception:
        return 0


def split_teacher_name(full_name):
    """
    Split teacher name into FirstName and LastName.
    """
    parts = str(full_name or "").strip().split()

    if not parts:
        return "", ""

    if len(parts) == 1:
        return parts[0], ""

    return parts[0], " ".join(parts[1:])


# ============================================================
# FETCH MASTER DATABASE
# ============================================================

@st.cache_data(ttl=300)
def fetch_master_db_from_supabase():

    rows = []

    page_size = 1000
    offset = 0

    while True:

        response = (
            supabase
            .table(TEACHER_RECORDS_TABLE)
            .select(",".join(ROSTER_COLUMNS))
            .range(offset, offset + page_size - 1)
            .execute()
        )

        batch = response.data or []

        if not batch:
            break

        rows.extend(batch)

        if len(batch) < page_size:
            break

        offset += page_size

    df = pd.DataFrame(rows)

    if df.empty:
        return pd.DataFrame(columns=ROSTER_COLUMNS)

    for col in ROSTER_COLUMNS:
        if col not in df.columns:
            df[col] = ""

        df[col] = (
            df[col]
            .fillna("")
            .astype(str)
            .str.strip()
        )

    df = df.drop_duplicates()

    return df


# ============================================================
# R2 UPLOAD WORKER
# ============================================================

def upload_file_to_r2(
    uploaded_file,
    folder_name,
    category,
    group_number
):
    """
    Upload one file to Cloudflare R2.
    """

    try:

        file_size = get_file_size_mb(uploaded_file)

        if file_size > MAX_FILE_SIZE_MB:

            return {
                "success": False,
                "file_name": getattr(uploaded_file, "name", "unknown"),
                "category": category,
                "group_number": group_number,
                "path": None,
                "error": (
                    f"File exceeds {MAX_FILE_SIZE_MB} MB "
                    f"limit."
                )
            }

        original_name = getattr(
            uploaded_file,
            "name",
            "voice_note.wav"
        )

        safe_name = sanitize_path_component(
            original_name
        )

        unique_prefix = uuid.uuid4().hex[:12]

        final_filename = (
            f"{unique_prefix}_{safe_name}"
        )

        object_key = (
            f"{folder_name}/{final_filename}"
        )

        uploaded_file.seek(0)

        content_type = getattr(
            uploaded_file,
            "type",
            None
        ) or "application/octet-stream"

        r2_client.upload_fileobj(
            uploaded_file,
            R2_BUCKET_NAME,
            object_key,
            ExtraArgs={
                "ContentType": content_type
            },
            Config=R2_TRANSFER_CONFIG
        )

        return {
            "success": True,
            "file_name": original_name,
            "category": category,
            "group_number": group_number,
            "path": object_key,
            "error": None
        }

    except Exception as e:

        return {
            "success": False,
            "file_name": getattr(
                uploaded_file,
                "name",
                "unknown"
            ),
            "category": category,
            "group_number": group_number,
            "path": None,
            "error": str(e)
        }


# ============================================================
# PARALLEL UPLOAD
# ============================================================

def upload_all_files_parallel(upload_jobs):

    if not upload_jobs:
        return []

    results = []

    with concurrent.futures.ThreadPoolExecutor(
        max_workers=MAX_PARALLEL_UPLOADS
    ) as executor:

        futures = [
            executor.submit(
                upload_file_to_r2,
                job["file"],
                job["folder"],
                job["category"],
                job["group_number"]
            )
            for job in upload_jobs
        ]

        for future in concurrent.futures.as_completed(futures):

            results.append(
                future.result()
            )

    return results


# ============================================================
# DATABASE INSERT
# ============================================================

def insert_implementation_to_db(entry):

    response = (
        supabase
        .table(TEACHER_RECORDS_TABLE)
        .insert(entry)
        .execute()
    )

    return response


# ============================================================
# PAGE HEADER
# ============================================================

st.title("📝 Teacher Daily Implementation Portal")

st.markdown(
    """
Use this portal to record your daily classroom implementation,
lesson planning, voice reflection and classroom evidence.
"""
)

st.info(
    """
📌 **Important**

For every implementation, first select the Grade, Subject and
Lesson / Chapter.

You can then:

- 🎙️ Record a voice note directly
- 📁 Upload an existing voice note
- ▶️ Play your voice note
- 📚 Upload the Lesson Plan
- 📎 Upload classroom implementation evidence
"""
)


# ============================================================
# VOICE NOTE INSTRUCTIONS
# ============================================================

with st.expander(
    "📋 View Instructions — How should I record my voice note?"
):

    st.markdown(
        """
### 🎙️ Voice Reflection Structure

Please use the following structure while recording your voice note.

#### 1. What
- Grade
- Subject
- Lesson Plan No.
- Topic / Chapter

#### 2. Why — Skill / Learning Objective
What do I want students to learn or be able to do
through this lesson?

Think about the learning level:

- Remembering
- Understanding
- Applying
- Analysing
- Evaluating
- Creating

#### 3. Teacher Activity — How
How will I teach?

Mention the digital and/or physical resources
you will use.

#### 4. Student Activity
What will students do or participate in?

#### 5. Practice & Apply
What will students do in the Course Book / Workbook?

Mention the specific:

- Topic / Section
- Page number
- Classwork
- Homework
- Practice activity

#### 6. Review
How will I check students' learning?

---

### 💡 Remember

The purpose is not just to tell **what we are going to do**.

Think about:

**Why are we doing it?**

and

**How will it support student learning?**
"""
    )


# ============================================================
# LOAD MASTER DATA
# ============================================================

try:

    master_df = fetch_master_db_from_supabase()

except Exception as e:

    st.error(
        f"Unable to load teacher database: {e}"
    )

    st.stop()


if master_df.empty:

    st.warning(
        "No teacher data is available."
    )

    st.stop()


# ============================================================
# STATE / ZONE
# ============================================================

state_options = sorted(
    [
        x for x in
        master_df["State_Zone"].dropna().unique()
        if str(x).strip()
    ]
)

selected_state = st.selectbox(
    "📍 State / Zone",
    ["Select State / Zone"] + state_options
)


if selected_state == "Select State / Zone":

    st.stop()


# ============================================================
# CONSULTANT
# ============================================================

consultant_df = master_df[
    master_df["State_Zone"] == selected_state
].copy()


consultant_options = sorted(
    [
        x for x in
        consultant_df["Uploaded_By"].dropna().unique()
        if str(x).strip()
    ]
)


selected_consultant = st.selectbox(
    "👤 Consultant",
    ["Select Consultant"] + consultant_options
)


if selected_consultant == "Select Consultant":

    st.stop()


# ============================================================
# SCHOOL
# ============================================================

school_df = consultant_df[
    consultant_df["Uploaded_By"] == selected_consultant
].copy()


school_options = sorted(
    [
        x for x in
        school_df["Institution"].dropna().unique()
        if str(x).strip()
    ]
)


selected_school = st.selectbox(
    "🏫 School",
    ["Select School"] + school_options
)


if selected_school == "Select School":

    st.stop()


# ============================================================
# TEACHER
# ============================================================

teacher_df = school_df[
    school_df["Institution"] == selected_school
].copy()


teacher_df = teacher_df[
    teacher_df["Role"]
    .str.lower()
    .isin(["teacher", "teachers"])
]


teacher_options = sorted(
    [
        x for x in
        teacher_df["FullName"].dropna().unique()
        if str(x).strip()
    ]
)


selected_teacher = st.selectbox(
    "👩‍🏫 Teacher",
    ["Select Teacher"] + teacher_options
)


if selected_teacher == "Select Teacher":

    st.stop()


# ============================================================
# DATE
# ============================================================

implementation_date = st.date_input(
    "📅 Implementation Date"
)


# ============================================================
# IMPLEMENTATION GROUP COUNT
# ============================================================

if "implementation_group_count" not in st.session_state:

    st.session_state.implementation_group_count = 1


st.markdown("---")

st.subheader("📚 Classroom Implementations")


# ============================================================
# GROUP UI
# ============================================================

group_states = []


for group_number in range(
    1,
    st.session_state.implementation_group_count + 1
):

    st.markdown("---")

    st.markdown(
        f"### 📘 Implementation {group_number}"
    )

    col1, col2 = st.columns(2)

    with col1:

        grade = st.selectbox(
            "Grade",
            GRADE_OPTIONS,
            key=f"group_{group_number}_grade"
        )

    with col2:

        subject = st.selectbox(
            "Subject",
            SUBJECT_OPTIONS,
            key=f"group_{group_number}_subject"
        )

    lesson_name = st.text_input(
        "📖 Chapter / Lesson / Activity Name",
        key=f"group_{group_number}_lesson"
    )


    # ========================================================
    # VOICE NOTE
    # ========================================================

    st.markdown("#### 🎙️ Voice Note")

    st.caption(
        "You can record a new voice note, upload an existing "
        "voice note, or use both."
    )


    # --------------------------------------------------------
    # NATIVE RECORDER
    # --------------------------------------------------------

    recorded_voice = st.audio_input(
        "🎤 Record Voice Note",
        sample_rate=16000,
        key=f"group_{group_number}_voice_record"
    )


    if recorded_voice is not None:

        st.success(
            "Voice note recorded successfully."
        )

        st.audio(
            recorded_voice,
            format="audio/wav"
        )


    # --------------------------------------------------------
    # EXISTING VOICE NOTE UPLOAD
    # --------------------------------------------------------

    uploaded_voice_notes = st.file_uploader(
        "📁 Upload Existing Voice Note",
        type=[
            "mp3",
            "wav",
            "m4a",
            "ogg"
        ],
        accept_multiple_files=True,
        key=f"group_{group_number}_voice_upload"
    )


    if uploaded_voice_notes:

        st.markdown(
            "**▶️ Uploaded Voice Notes**"
        )

        for idx, voice_file in enumerate(
            uploaded_voice_notes,
            start=1
        ):

            st.caption(
                f"Voice Note {idx}: {voice_file.name}"
            )

            st.audio(
                voice_file
            )


    # ========================================================
    # LESSON PLAN
    # ========================================================

    st.markdown("#### 📚 Lesson Plan")

    lesson_plan_files = st.file_uploader(
        "Upload Lesson Plan",
        type=[
            "png",
            "jpg",
            "jpeg",
            "pdf"
        ],
        accept_multiple_files=True,
        key=f"group_{group_number}_lesson_plan"
    )


    # ========================================================
    # CLASSROOM IMPLEMENTATION EVIDENCE
    # ========================================================

    st.markdown(
        "#### 📎 Classroom Implementation Evidence"
    )

    evidence_type = st.selectbox(
        "Select Evidence Type",
        ["Select Evidence"] + EVIDENCE_TYPES,
        key=f"group_{group_number}_evidence_type"
    )


    evidence_files = []

    if evidence_type != "Select Evidence":

        if evidence_type == "Classroom Activity":

            st.caption(
                "Upload classroom activity implementation videos."
            )

            evidence_files = st.file_uploader(
                "Upload Classroom Activity Evidence",
                type=[
                    "mp4",
                    "mov",
                    "avi"
                ],
                accept_multiple_files=True,
                key=f"group_{group_number}_activity_evidence"
            )


        elif evidence_type == "Student Written Work":

            st.caption(
                "Upload photographs or PDFs of student written work."
            )

            evidence_files = st.file_uploader(
                "Upload Student Written Work",
                type=[
                    "pdf",
                    "png",
                    "jpg",
                    "jpeg"
                ],
                accept_multiple_files=True,
                key=f"group_{group_number}_writing_evidence"
            )


        elif evidence_type == "Phonics / Phonetics Implementation":

            st.caption(
                "Upload evidence of phonics / phonetics implementation."
            )

            evidence_files = st.file_uploader(
                "Upload Phonics / Phonetics Evidence",
                type=[
                    "mp4",
                    "mov",
                    "mp3",
                    "wav",
                    "png",
                    "jpg",
                    "jpeg",
                    "pdf"
                ],
                accept_multiple_files=True,
                key=f"group_{group_number}_phonics_evidence"
            )


        elif evidence_type == "Student Assessment":

            st.caption(
                "Upload student assessment evidence."
            )

            evidence_files = st.file_uploader(
                "Upload Student Assessment",
                type=[
                    "pdf",
                    "png",
                    "jpg",
                    "jpeg",
                    "mp4"
                ],
                accept_multiple_files=True,
                key=f"group_{group_number}_assessment_evidence"
            )


        elif evidence_type == "Teacher Portfolio":

            st.caption(
                "Upload evidence for the teacher portfolio."
            )

            evidence_files = st.file_uploader(
                "Upload Teacher Portfolio Evidence",
                type=[
                    "pdf",
                    "png",
                    "jpg",
                    "jpeg",
                    "mp4"
                ],
                accept_multiple_files=True,
                key=f"group_{group_number}_portfolio_evidence"
            )


    # ========================================================
    # SAVE GROUP STATE
    # ========================================================

    group_states.append(
        {
            "group_number": group_number,
            "grade": grade,
            "subject": subject,
            "lesson_name": lesson_name.strip(),
            "recorded_voice": recorded_voice,
            "uploaded_voice_notes": uploaded_voice_notes or [],
            "lesson_plan_files": lesson_plan_files or [],
            "evidence_type": evidence_type,
            "evidence_files": evidence_files or []
        }
    )


# ============================================================
# ADD / REMOVE IMPLEMENTATION
# ============================================================

st.markdown("---")

button_col1, button_col2 = st.columns(2)


with button_col1:

    if (
        st.session_state.implementation_group_count
        < MAX_IMPLEMENTATION_GROUPS
    ):

        if st.button(
            "➕ Add Implementation",
            use_container_width=True
        ):

            st.session_state.implementation_group_count += 1

            st.rerun()


with button_col2:

    if (
        st.session_state.implementation_group_count
        > 1
    ):

        if st.button(
            "➖ Remove Last Implementation",
            use_container_width=True
        ):

            st.session_state.implementation_group_count -= 1

            st.rerun()


# ============================================================
# SUBMIT
# ============================================================

st.markdown("---")

submit_button = st.button(
    "🚀 Submit Implementation",
    type="primary",
    use_container_width=True
)


# ============================================================
# SUBMISSION PROCESS
# ============================================================

if submit_button:

    # --------------------------------------------------------
    # BASIC VALIDATION
    # --------------------------------------------------------

    if selected_state == "Select State / Zone":

        st.error(
            "Please select State / Zone."
        )

        st.stop()


    if selected_consultant == "Select Consultant":

        st.error(
            "Please select Consultant."
        )

        st.stop()


    if selected_school == "Select School":

        st.error(
            "Please select School."
        )

        st.stop()


    if selected_teacher == "Select Teacher":

        st.error(
            "Please select Teacher."
        )

        st.stop()


    if not group_states:

        st.error(
            "Please add at least one implementation."
        )

        st.stop()


    # --------------------------------------------------------
    # VALIDATE LESSON NAMES
    # --------------------------------------------------------

    for group in group_states:

        if not group["lesson_name"]:

            st.error(
                f"Please enter Chapter / Lesson / Activity "
                f"Name for Implementation "
                f"{group['group_number']}."
            )

            st.stop()


    # --------------------------------------------------------
    # SUBMISSION ID
    # --------------------------------------------------------

    submission_id = uuid.uuid4().hex[:12]


    # --------------------------------------------------------
    # BASE R2 PATH
    # --------------------------------------------------------

    safe_school = sanitize_path_component(
        selected_school
    )

    safe_teacher = sanitize_path_component(
        selected_teacher
    )

    date_string = implementation_date.strftime(
        "%Y-%m-%d"
    )


    submission_base = (
        f"schools/{safe_school}"
        f"/teachers/{safe_teacher}"
        f"/{date_string}"
        f"/submission_{submission_id}"
    )


    # --------------------------------------------------------
    # BUILD UPLOAD JOBS
    # --------------------------------------------------------

    upload_jobs = []


    for group in group_states:

        group_number = group["group_number"]

        implementation_base = (
            f"{submission_base}"
            f"/implementation_{group_number}"
        )


        # ====================================================
        # VOICE NOTES
        # ====================================================

        voice_folder = (
            f"{implementation_base}"
            f"/voice_notes"
        )


        # Recorded voice note
        if group["recorded_voice"] is not None:

            upload_jobs.append(
                {
                    "file": group["recorded_voice"],
                    "folder": voice_folder,
                    "category": "voice",
                    "group_number": group_number
                }
            )


        # Uploaded voice notes
        for voice_file in group[
            "uploaded_voice_notes"
        ]:

            upload_jobs.append(
                {
                    "file": voice_file,
                    "folder": voice_folder,
                    "category": "voice",
                    "group_number": group_number
                }
            )


        # ====================================================
        # LESSON PLAN
        # ====================================================

        lesson_plan_folder = (
            f"{implementation_base}"
            f"/lesson_plans"
        )


        for lesson_file in group[
            "lesson_plan_files"
        ]:

            upload_jobs.append(
                {
                    "file": lesson_file,
                    "folder": lesson_plan_folder,
                    "category": "picture",
                    "group_number": group_number
                }
            )


        # ====================================================
        # CLASSROOM EVIDENCE
        # ====================================================

        evidence_type = group[
            "evidence_type"
        ]

        evidence_files = group[
            "evidence_files"
        ]


        if evidence_type == "Classroom Activity":

            evidence_folder = (
                f"{implementation_base}"
                f"/activity_videos"
            )

            evidence_category = "video"


        elif evidence_type == "Student Written Work":

            evidence_folder = (
                f"{implementation_base}"
                f"/student_work"
            )

            evidence_category = "writing"


        elif evidence_type == (
            "Phonics / Phonetics Implementation"
        ):

            evidence_folder = (
                f"{implementation_base}"
                f"/phonics"
            )

            evidence_category = "phonics"


        elif evidence_type == "Student Assessment":

            evidence_folder = (
                f"{implementation_base}"
                f"/student_assessments"
            )

            evidence_category = "assessment"


        elif evidence_type == "Teacher Portfolio":

            evidence_folder = (
                f"{implementation_base}"
                f"/teacher_portfolio"
            )

            evidence_category = "portfolio"


        else:

            evidence_folder = None
            evidence_category = None


        if (
            evidence_folder
            and evidence_category
        ):

            for evidence_file in evidence_files:

                upload_jobs.append(
                    {
                        "file": evidence_file,
                        "folder": evidence_folder,
                        "category": evidence_category,
                        "group_number": group_number
                    }
                )


    # ========================================================
    # FILE SIZE VALIDATION
    # ========================================================

    oversized_files = []


    for job in upload_jobs:

        size_mb = get_file_size_mb(
            job["file"]
        )

        if size_mb > MAX_FILE_SIZE_MB:

            oversized_files.append(
                (
                    getattr(
                        job["file"],
                        "name",
                        "Unknown file"
                    ),
                    size_mb
                )
            )


    if oversized_files:

        st.error(
            f"Some files exceed the "
            f"{MAX_FILE_SIZE_MB} MB limit."
        )

        for filename, size_mb in oversized_files:

            st.write(
                f"- {filename}: "
                f"{size_mb:.2f} MB"
            )

        st.stop()


    # ========================================================
    # UPLOAD FILES
    # ========================================================

    if upload_jobs:

        progress_placeholder = st.empty()

        progress_placeholder.info(
            f"Uploading {len(upload_jobs)} file(s)..."
        )


        upload_results = upload_all_files_parallel(
            upload_jobs
        )


        failed_uploads = [
            result
            for result in upload_results
            if not result["success"]
        ]


        if failed_uploads:

            progress_placeholder.empty()

            st.error(
                "Some files could not be uploaded. "
                "No database records were created."
            )


            for failed in failed_uploads:

                st.write(
                    f"❌ {failed['file_name']} — "
                    f"{failed['error']}"
                )

            st.stop()


        progress_placeholder.success(
            f"Successfully uploaded "
            f"{len(upload_results)} file(s)."
        )

    else:

        upload_results = []


    # ========================================================
    # GROUP PATH HELPER
    # ========================================================

    def get_paths(
        group_number,
        category
    ):

        return [
            result["path"]
            for result in upload_results
            if (
                result["group_number"]
                == group_number
                and result["category"]
                == category
                and result["path"]
            )
        ]


    # ========================================================
    # TEACHER NAME
    # ========================================================

    first_name, last_name = split_teacher_name(
        selected_teacher
    )


    # ========================================================
    # INSERT EACH IMPLEMENTATION
    # ========================================================

    inserted_count = 0


    try:

        for group in group_states:

            group_number = group[
                "group_number"
            ]


            # ----------------------------------------------
            # FILE PATHS
            # ----------------------------------------------

            voice_paths = get_paths(
                group_number,
                "voice"
            )


            lesson_plan_paths = get_paths(
                group_number,
                "picture"
            )


            activity_video_paths = get_paths(
                group_number,
                "video"
            )


            writing_paths = get_paths(
                group_number,
                "writing"
            )


            assessment_paths = get_paths(
                group_number,
                "assessment"
            )


            phonics_paths = get_paths(
                group_number,
                "phonics"
            )


            portfolio_paths = get_paths(
                group_number,
                "portfolio"
            )


            # ----------------------------------------------
            # DB ENTRY
            # ----------------------------------------------

            entry = {

                "State_Zone":
                    selected_state,

                "Uploaded_By":
                    selected_consultant,

                "Institution":
                    selected_school,

                "Center":
                    selected_school,

                "FirstName":
                    first_name,

                "LastName":
                    last_name,

                "FullName":
                    selected_teacher,

                "Role":
                    "Teacher",

                "Type":
                    "Implementation",

                "Grade":
                    group["grade"],

                "Subject":
                    group["subject"],

                "Book":
                    group["lesson_name"],

                "StartTime":
                    "09:00",

                "EndTime":
                    "09:45",

                "Duration_Min":
                    0.0,

                "Voice_Note_Link":
                    ",".join(voice_paths)
                    if voice_paths
                    else None,

                "Lesson_Plan_Picture":
                    ",".join(lesson_plan_paths)
                    if lesson_plan_paths
                    else None,

                "Video_Evidence_1":
                    activity_video_paths[0]
                    if len(activity_video_paths) > 0
                    else None,

                "Video_Evidence_2":
                    activity_video_paths[1]
                    if len(activity_video_paths) > 1
                    else None,

                "Video_Evidence_3":
                    activity_video_paths[2]
                    if len(activity_video_paths) > 2
                    else None,

                "Writing_Sample_Link":
                    ",".join(writing_paths)
                    if writing_paths
                    else None,

                "Student_Assessment_Link":
                    ",".join(assessment_paths)
                    if assessment_paths
                    else None,

                "Phonics_Evidence_Link":
                    ",".join(phonics_paths)
                    if phonics_paths
                    else None,

                "Portfolio_Evidence_Link":
                    ",".join(portfolio_paths)
                    if portfolio_paths
                    else None,

                "Assessment_Score_Pct":
                    None
            }


            # ----------------------------------------------
            # INSERT
            # ----------------------------------------------

            insert_implementation_to_db(
                entry
            )

            inserted_count += 1


        # ====================================================
        # SUCCESS
        # ====================================================

        st.success(
            f"✅ Successfully submitted "
            f"{inserted_count} implementation(s)."
        )


        st.info(
            f"Submission ID: `{submission_id}`"
        )


        # Clear cached master data if necessary
        st.cache_data.clear()


    except Exception as e:

        st.error(
            "Submission could not be saved."
        )

        st.code(
            str(e)
        )
