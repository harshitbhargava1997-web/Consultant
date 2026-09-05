# ============================================================
# TEACHER DAILY IMPLEMENTATION PORTAL
# ============================================================
#
# Features:
# - Supabase teacher_records integration
# - Cloudflare R2 file uploads
# - Teacher roster selection
# - Multiple implementation groups
# - Direct voice-note recording
# - Existing voice-note file upload
# - Voice-note reflection guidelines in dropdown
# - Lesson plan evidence
# - Activity video evidence
# - Student Written Work
# - Student Assessment
# - Phonics / Phonetics
# - Teacher Portfolio
# - No transcription
# - No teacher_submissions table
# - No submission tracker
#
# ============================================================

import os
import io
import uuid
import time
import mimetypes
from datetime import datetime, date

import streamlit as st
from supabase import create_client, Client

import boto3
from botocore.config import Config
from boto3.s3.transfer import TransferConfig


# ============================================================
# PAGE CONFIG
# ============================================================

st.set_page_config(
    page_title="Teacher Daily Implementation Portal",
    page_icon="🎓",
    layout="wide",
    initial_sidebar_state="collapsed",
)


# ============================================================
# CUSTOM CSS
# ============================================================

st.markdown(
    """
    <style>

    /* Main page */
    .main {
        padding-top: 1rem;
    }

    .block-container {
        max-width: 1200px;
        padding-top: 1.5rem;
        padding-bottom: 3rem;
    }

    /* Header */
    .portal-header {
        padding: 1.4rem 1.6rem;
        border-radius: 18px;
        background: linear-gradient(
            135deg,
            rgba(99,102,241,0.12),
            rgba(59,130,246,0.08)
        );
        border: 1px solid rgba(99,102,241,0.15);
        margin-bottom: 1.25rem;
    }

    .portal-title {
        font-size: 2rem;
        font-weight: 750;
        margin-bottom: 0.25rem;
    }

    .portal-subtitle {
        color: #64748b;
        font-size: 0.98rem;
    }

    /* Section cards */
    .section-card {
        padding: 1rem 1.15rem;
        border-radius: 14px;
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        margin-bottom: 1rem;
    }

    .section-title {
        font-size: 1.08rem;
        font-weight: 700;
        margin-bottom: 0.5rem;
    }

    /* Instruction box */
    .reflection-note {
        padding: 1rem 1.1rem;
        border-radius: 12px;
        background: #f8fafc;
        border-left: 4px solid #6366f1;
        margin-bottom: 0.75rem;
    }

    .reflection-note strong {
        color: #1e293b;
    }

    /* Implementation header */
    .implementation-header {
        padding: 0.85rem 1rem;
        border-radius: 12px;
        background: rgba(99,102,241,0.08);
        border: 1px solid rgba(99,102,241,0.14);
        margin-bottom: 1rem;
    }

    /* Small information text */
    .small-muted {
        color: #64748b;
        font-size: 0.85rem;
    }

    /* Success box */
    .success-box {
        padding: 1rem;
        border-radius: 12px;
        background: #f0fdf4;
        border: 1px solid #bbf7d0;
        color: #166534;
    }

    /* Warning */
    .warning-box {
        padding: 1rem;
        border-radius: 12px;
        background: #fffbeb;
        border: 1px solid #fde68a;
        color: #92400e;
    }

    /* Buttons */
    div.stButton > button {
        border-radius: 10px;
        font-weight: 600;
    }

    </style>
    """,
    unsafe_allow_html=True,
)


# ============================================================
# CONFIGURATION
# ============================================================

MAX_FILE_SIZE_MB = 50
MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024

MAX_IMPLEMENTATIONS = 10

GRADE_OPTIONS = [
    "Nursery",
    "LKG",
    "UKG",
    "Grade 1",
    "Grade 2",
    "Grade 3",
    "Grade 4",
    "Grade 5",
]

SUBJECT_OPTIONS = [
    "All Subjects Together",
    "Phonics / Literacy",
    "Mathematics",
    "Numeracy",
    "English",
    "Hindi",
    "EVS",
    "Science",
    "GK",
    "English Grammar",
    "Computer",
    "Play Activity",
    "Play Time",
    "Play Based",
]

ROLE_OPTIONS = [
    "teacher",
]


# ============================================================
# SUPABASE
# ============================================================

@st.cache_resource
def get_supabase() -> Client:

    url = st.secrets["supabase"]["url"]
    key = st.secrets["supabase"]["key"]

    return create_client(url, key)


supabase = get_supabase()


# ============================================================
# CLOUDFLARE R2
# ============================================================

@st.cache_resource
def get_r2_client():

    r2_account_id = st.secrets["r2"]["account_id"]
    r2_access_key = st.secrets["r2"]["access_key"]
    r2_secret_key = st.secrets["r2"]["secret_key"]

    endpoint_url = (
        st.secrets["r2"].get(
            "endpoint",
            f"https://{r2_account_id}.r2.cloudflarestorage.com"
        )
    )

    client = boto3.client(
        "s3",
        endpoint_url=endpoint_url,
        aws_access_key_id=r2_access_key,
        aws_secret_access_key=r2_secret_key,
        region_name="auto",
        config=Config(
            signature_version="s3v4",
            max_pool_connections=10,
        ),
    )

    return client


r2 = get_r2_client()

R2_BUCKET = st.secrets["r2"]["bucket"]


# ============================================================
# R2 TRANSFER CONFIG
# ============================================================

R2_TRANSFER_CONFIG = TransferConfig(
    multipart_threshold=8 * 1024 * 1024,
    multipart_chunksize=8 * 1024 * 1024,
    max_concurrency=5,
    use_threads=True,
)


# ============================================================
# SESSION STATE
# ============================================================

if "implementation_count" not in st.session_state:
    st.session_state.implementation_count = 1


if "submitted" not in st.session_state:
    st.session_state.submitted = False


# ============================================================
# HELPERS
# ============================================================

def safe_filename(filename: str) -> str:
    """
    Creates a reasonably safe filename for object storage.
    """

    if not filename:
        return "file"

    filename = os.path.basename(filename)

    allowed = (
        "abcdefghijklmnopqrstuvwxyz"
        "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
        "0123456789"
        "-_."
    )

    cleaned = "".join(
        char if char in allowed else "_"
        for char in filename
    )

    return cleaned[:180]


def school_path_part(value: str) -> str:
    """
    Safe path component.
    """

    if value is None:
        return "unknown"

    value = str(value).strip()

    allowed = (
        "abcdefghijklmnopqrstuvwxyz"
        "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
        "0123456789"
        "-_."
    )

    cleaned = "".join(
        char if char in allowed else "_"
        for char in value
    )

    return cleaned[:120]


def validate_file_size(uploaded_file) -> bool:

    if uploaded_file is None:
        return True

    try:
        size = uploaded_file.size
    except Exception:
        return True

    return size <= MAX_FILE_SIZE_BYTES


def upload_file_to_r2(
    uploaded_file,
    object_key: str,
) -> str:
    """
    Uploads a Streamlit UploadedFile to Cloudflare R2.

    Returns the R2 object key.

    The object key is stored in the database rather than exposing
    a permanent public R2 URL.
    """

    if uploaded_file is None:
        return ""

    if not validate_file_size(uploaded_file):
        raise ValueError(
            f"{uploaded_file.name} exceeds the "
            f"{MAX_FILE_SIZE_MB} MB file-size limit."
        )

    data = uploaded_file.getvalue()

    content_type = (
        getattr(uploaded_file, "type", None)
        or mimetypes.guess_type(uploaded_file.name)[0]
        or "application/octet-stream"
    )

    file_obj = io.BytesIO(data)

    r2.upload_fileobj(
        file_obj,
        R2_BUCKET,
        object_key,
        ExtraArgs={
            "ContentType": content_type
        },
        Config=R2_TRANSFER_CONFIG,
    )

    return object_key


def build_object_key(
    school_name: str,
    teacher_name: str,
    implementation_date: date,
    submission_id: str,
    implementation_number: int,
    category: str,
    filename: str,
) -> str:

    school_part = school_path_part(school_name)
    teacher_part = school_path_part(teacher_name)

    date_part = implementation_date.strftime("%Y-%m-%d")

    filename_part = safe_filename(filename)

    return (
        f"schools/{school_part}/"
        f"teachers/{teacher_part}/"
        f"{date_part}/"
        f"submission_{submission_id}/"
        f"implementation_{implementation_number}/"
        f"{category}/"
        f"{uuid.uuid4().hex[:10]}_{filename_part}"
    )


def upload_multiple_files(
    files,
    school_name,
    teacher_name,
    implementation_date,
    submission_id,
    implementation_number,
    category,
):

    uploaded_keys = []

    if not files:
        return uploaded_keys

    for file in files:

        if not validate_file_size(file):
            raise ValueError(
                f"{file.name} is larger than "
                f"{MAX_FILE_SIZE_MB} MB."
            )

        object_key = build_object_key(
            school_name=school_name,
            teacher_name=teacher_name,
            implementation_date=implementation_date,
            submission_id=submission_id,
            implementation_number=implementation_number,
            category=category,
            filename=file.name,
        )

        uploaded_key = upload_file_to_r2(
            uploaded_file=file,
            object_key=object_key,
        )

        uploaded_keys.append(uploaded_key)

    return uploaded_keys


def join_links(values):

    values = [
        str(v).strip()
        for v in values
        if v and str(v).strip()
    ]

    return ", ".join(values)


def get_name_parts(full_name):

    full_name = (full_name or "").strip()

    parts = full_name.split()

    if not parts:
        return "", ""

    if len(parts) == 1:
        return parts[0], ""

    return parts[0], " ".join(parts[1:])


# ============================================================
# ROSTER
# ============================================================

@st.cache_data(ttl=300)
def load_roster():

    response = (
        supabase
        .table("teacher_records")
        .select(
            "State_Zone,Uploaded_By,Institution,FullName,Role"
        )
        .execute()
    )

    return response.data or []


try:
    roster = load_roster()

except Exception as e:

    st.error(
        "Unable to load the teacher roster from Supabase."
    )

    st.code(str(e))

    st.stop()


if not roster:

    st.warning(
        "No teacher records were found in the teacher_records table."
    )

    st.stop()


# ============================================================
# HEADER
# ============================================================

st.markdown(
    """
    <div class="portal-header">
        <div class="portal-title">
            🎓 Teacher Daily Implementation Portal
        </div>
        <div class="portal-subtitle">
            Record your lesson implementation, reflection and evidence.
        </div>
    </div>
    """,
    unsafe_allow_html=True,
)


# ============================================================
# BASIC TEACHER SELECTION
# ============================================================

st.markdown(
    '<div class="section-title">👤 Teacher Details</div>',
    unsafe_allow_html=True,
)


states = sorted(
    {
        str(row.get("State_Zone", "")).strip()
        for row in roster
        if row.get("State_Zone")
    }
)

selected_state = st.selectbox(
    "State / Zone",
    states,
    key="state_zone",
)


state_rows = [
    row
    for row in roster
    if str(row.get("State_Zone", "")).strip()
    == selected_state
]


consultants = sorted(
    {
        str(row.get("Uploaded_By", "")).strip()
        for row in state_rows
        if row.get("Uploaded_By")
    }
)

selected_consultant = st.selectbox(
    "Consultant",
    consultants,
    key="consultant",
)


consultant_rows = [
    row
    for row in state_rows
    if str(row.get("Uploaded_By", "")).strip()
    == selected_consultant
]


schools = sorted(
    {
        str(row.get("Institution", "")).strip()
        for row in consultant_rows
        if row.get("Institution")
    }
)

selected_school = st.selectbox(
    "School",
    schools,
    key="school",
)


school_rows = [
    row
    for row in consultant_rows
    if str(row.get("Institution", "")).strip()
    == selected_school
]


teachers = sorted(
    {
        str(row.get("FullName", "")).strip()
        for row in school_rows
        if row.get("FullName")
    }
)


selected_teacher = st.selectbox(
    "Teacher Name",
    teachers,
    key="teacher_name",
)


implementation_date = st.date_input(
    "Implementation Date",
    value=date.today(),
    key="implementation_date",
)


# ============================================================
# VOICE NOTE GUIDELINES
# ============================================================

st.markdown("### 🎙️ Voice Note Reflection")


with st.expander(
    "📋 View Instructions — How should I record my voice note?",
    expanded=False,
):

    st.markdown(
        """
        <div class="reflection-note">

        <strong>Let's follow a structured approach for your
        voice note reflection.</strong>

        <br><br>

        <strong>1. 📌 What — Lesson Details</strong>

        Mention:

        <ul>
            <li>Grade / Class</li>
            <li>Subject</li>
            <li>Lesson Plan No.</li>
            <li>Topic / Chapter</li>
        </ul>

        <strong>2. 🎯 Why — Skill / Learning Objective</strong>

        What do I want students to learn or be able to do
        through this lesson?

        <br><br>

        Think about <strong>Bloom's Taxonomy</strong>:

        <ul>
            <li>Remembering</li>
            <li>Understanding</li>
            <li>Applying</li>
            <li>Analysing</li>
            <li>Evaluating</li>
            <li>Creating</li>
        </ul>

        <strong>3. 👩‍🏫 Teacher Activity — How will I teach?</strong>

        Briefly explain:

        <ul>
            <li>How will I teach the lesson?</li>
            <li>Which digital / physical resources will I use?</li>
        </ul>

        <strong>4. 👧🧒 Student Activity</strong>

        What will students do or participate in?

        <br><br>

        Think about what students will:

        <ul>
            <li>Do</li>
            <li>Discuss</li>
            <li>Practise</li>
            <li>Respond to</li>
            <li>Demonstrate</li>
        </ul>

        <strong>5. ✏️ Practice & Apply</strong>

        What will students do in the
        <strong>Course Book / Workbook</strong>?

        Mention the relevant:

        <ul>
            <li>Topic / Section</li>
            <li>Page number</li>
            <li>Classwork / Homework activity</li>
        </ul>

        <strong>6. 🔄 Review</strong>

        How will I check students' learning?

        <br><br>

        <strong>Remember:</strong>

        The purpose is not just to tell what we are going
        to do, but to think about <strong>why</strong> we are
        doing it and <strong>how it will support student
        learning.</strong>

        </div>
        """,
        unsafe_allow_html=True,
    )


st.caption(
    "🎙️ You can record your voice note directly below, "
    "or upload an existing recording."
)


# ============================================================
# NUMBER OF IMPLEMENTATIONS
# ============================================================

st.markdown("### 📚 Lesson Implementations")


implementation_count = st.number_input(
    "How many implementations are you submitting?",
    min_value=1,
    max_value=MAX_IMPLEMENTATIONS,
    value=st.session_state.implementation_count,
    step=1,
    key="implementation_count",
)


# ============================================================
# IMPLEMENTATION FORM
# ============================================================

implementation_data = []


for implementation_number in range(
    1,
    int(implementation_count) + 1
):

    st.markdown(
        f"""
        <div class="implementation-header">
            <strong>
                Implementation {implementation_number}
            </strong>
        </div>
        """,
        unsafe_allow_html=True,
    )

    # --------------------------------------------------------
    # BASIC DETAILS
    # --------------------------------------------------------

    col1, col2 = st.columns(2)

    with col1:

        grade = st.selectbox(
            "Grade / Class",
            GRADE_OPTIONS,
            key=f"grade_{implementation_number}",
        )

    with col2:

        subject = st.selectbox(
            "Subject",
            SUBJECT_OPTIONS,
            key=f"subject_{implementation_number}",
        )

    lesson = st.text_input(
        "Chapter / Lesson / Activity Name",
        placeholder="Enter chapter, lesson or activity name",
        key=f"lesson_{implementation_number}",
    )

    lesson_plan_number = st.text_input(
        "Lesson Plan No.",
        placeholder="e.g. LP-05",
        key=f"lesson_plan_number_{implementation_number}",
    )


    # --------------------------------------------------------
    # VOICE NOTE
    # --------------------------------------------------------

    st.markdown("#### 🎙️ Voice Note Reflection")

    st.caption(
        "Record your reflection directly or upload an existing "
        "voice note. You may use either or both."
    )


    recorded_voice = st.audio_input(
        "🎙️ Record Voice Note",
        sample_rate=16000,
        key=f"recorded_voice_{implementation_number}",
    )


    if recorded_voice is not None:

        st.success(
            "Voice note recorded successfully. "
            "You can listen to it below before submitting."
        )

        st.audio(
            recorded_voice,
            format="audio/wav",
        )


    uploaded_voice_notes = st.file_uploader(
        "Or upload existing Voice Note(s)",
        type=[
            "mp3",
            "wav",
            "m4a",
            "ogg",
            "aac",
        ],
        accept_multiple_files=True,
        key=f"voice_upload_{implementation_number}",
    )


    if uploaded_voice_notes:

        st.caption(
            f"{len(uploaded_voice_notes)} existing "
            f"voice note(s) selected."
        )

        for voice_file in uploaded_voice_notes:

            st.audio(
                voice_file,
                format=voice_file.type
                or "audio/mpeg",
            )


    # --------------------------------------------------------
    # LESSON PLAN
    # --------------------------------------------------------

    st.markdown("#### 📋 Lesson Plan Evidence")

    lesson_plan_files = st.file_uploader(
        "Upload Lesson Plan",
        type=[
            "pdf",
            "png",
            "jpg",
            "jpeg",
        ],
        accept_multiple_files=True,
        key=f"lesson_plan_{implementation_number}",
    )


    # --------------------------------------------------------
    # ACTIVITY VIDEO
    # --------------------------------------------------------

    st.markdown("#### 🎥 Activity Video Evidence")

    activity_video_files = st.file_uploader(
        "Upload Activity Video(s)",
        type=[
            "mp4",
            "mov",
            "avi",
        ],
        accept_multiple_files=True,
        key=f"activity_video_{implementation_number}",
    )


    # --------------------------------------------------------
    # STUDENT WRITTEN WORK
    # --------------------------------------------------------

    st.markdown("#### ✍️ Student Written Work")

    student_written_work_files = st.file_uploader(
        "Upload Student Written Work",
        type=[
            "pdf",
            "png",
            "jpg",
            "jpeg",
        ],
        accept_multiple_files=True,
        key=f"student_written_work_{implementation_number}",
    )


    # --------------------------------------------------------
    # STUDENT ASSESSMENT
    # --------------------------------------------------------

    st.markdown("#### 📝 Student Assessment")

    student_assessment_files = st.file_uploader(
        "Upload Student Assessment",
        type=[
            "pdf",
            "png",
            "jpg",
            "jpeg",
            "mp4",
        ],
        accept_multiple_files=True,
        key=f"student_assessment_{implementation_number}",
    )


    # --------------------------------------------------------
    # PHONICS
    # --------------------------------------------------------

    st.markdown("#### 🔤 Phonics / Phonetics Evidence")

    phonics_files = st.file_uploader(
        "Upload Phonics / Phonetics Evidence",
        type=[
            "mp4",
            "mov",
            "mp3",
            "wav",
            "png",
            "jpg",
            "jpeg",
            "pdf",
        ],
        accept_multiple_files=True,
        key=f"phonics_{implementation_number}",
    )


    # --------------------------------------------------------
    # TEACHER PORTFOLIO
    # --------------------------------------------------------

    st.markdown("#### 📁 Teacher Portfolio")

    portfolio_files = st.file_uploader(
        "Upload Teacher Portfolio Evidence",
        type=[
            "pdf",
            "png",
            "jpg",
            "jpeg",
            "mp4",
        ],
        accept_multiple_files=True,
        key=f"portfolio_{implementation_number}",
    )


    implementation_data.append(
        {
            "implementation_number": implementation_number,
            "grade": grade,
            "subject": subject,
            "lesson": lesson,
            "lesson_plan_number": lesson_plan_number,
            "recorded_voice": recorded_voice,
            "uploaded_voice_notes": uploaded_voice_notes,
            "lesson_plan_files": lesson_plan_files,
            "activity_video_files": activity_video_files,
            "student_written_work_files": student_written_work_files,
            "student_assessment_files": student_assessment_files,
            "phonics_files": phonics_files,
            "portfolio_files": portfolio_files,
        }
    )


# ============================================================
# VALIDATION
# ============================================================

def validate_implementation(implementation):

    errors = []

    if not implementation["grade"]:
        errors.append("Grade / Class is required.")

    if not implementation["subject"]:
        errors.append("Subject is required.")

    if not implementation["lesson"].strip():
        errors.append(
            "Chapter / Lesson / Activity Name is required."
        )

    has_recorded_voice = (
        implementation["recorded_voice"] is not None
    )

    has_uploaded_voice = bool(
        implementation["uploaded_voice_notes"]
    )

    if not has_recorded_voice and not has_uploaded_voice:
        errors.append(
            "Please record or upload at least one voice note."
        )

    return errors


# ============================================================
# SUBMIT BUTTON
# ============================================================

st.markdown("---")


submit_col1, submit_col2 = st.columns(
    [3, 1]
)


with submit_col1:

    st.markdown(
        """
        <div class="small-muted">
        Please review your voice note and evidence before
        submitting. Once submitted, the evidence will be
        uploaded and saved to the teacher_records database.
        </div>
        """,
        unsafe_allow_html=True,
    )


with submit_col2:

    submit_button = st.button(
        "🚀 Submit Implementation",
        type="primary",
        use_container_width=True,
    )


# ============================================================
# SUBMISSION
# ============================================================

if submit_button:

    # --------------------------------------------------------
    # VALIDATE
    # --------------------------------------------------------

    all_errors = []

    for implementation in implementation_data:

        errors = validate_implementation(
            implementation
        )

        for error in errors:

            all_errors.append(
                f"Implementation "
                f"{implementation['implementation_number']}: "
                f"{error}"
            )


    if all_errors:

        st.error(
            "Please correct the following before submitting:"
        )

        for error in all_errors:

            st.write(f"• {error}")

        st.stop()


    # --------------------------------------------------------
    # SUBMISSION ID
    # --------------------------------------------------------

    submission_id = uuid.uuid4().hex


    # --------------------------------------------------------
    # NAME
    # --------------------------------------------------------

    first_name, last_name = get_name_parts(
        selected_teacher
    )


    # --------------------------------------------------------
    # PROGRESS
    # --------------------------------------------------------

    total_steps = max(
        1,
        len(implementation_data)
    )

    progress = st.progress(0)

    status_text = st.empty()


    try:

        for index, implementation in enumerate(
            implementation_data
        ):

            number = implementation[
                "implementation_number"
            ]


            status_text.info(
                f"Uploading Implementation {number}..."
            )


            # =================================================
            # VOICE NOTES
            # =================================================

            voice_keys = []


            # -------------------------------------------------
            # DIRECTLY RECORDED VOICE NOTE
            # -------------------------------------------------

            recorded_voice = implementation[
                "recorded_voice"
            ]


            if recorded_voice is not None:

                voice_key = build_object_key(
                    school_name=selected_school,
                    teacher_name=selected_teacher,
                    implementation_date=implementation_date,
                    submission_id=submission_id,
                    implementation_number=number,
                    category="voice_notes",
                    filename=(
                        f"recorded_voice_"
                        f"{datetime.now().strftime('%H%M%S')}.wav"
                    ),
                )


                upload_file_to_r2(
                    uploaded_file=recorded_voice,
                    object_key=voice_key,
                )


                voice_keys.append(
                    voice_key
                )


            # -------------------------------------------------
            # EXISTING UPLOADED VOICE NOTES
            # -------------------------------------------------

            uploaded_voice_notes = implementation[
                "uploaded_voice_notes"
            ]


            if uploaded_voice_notes:

                uploaded_voice_keys = (
                    upload_multiple_files(
                        files=uploaded_voice_notes,
                        school_name=selected_school,
                        teacher_name=selected_teacher,
                        implementation_date=implementation_date,
                        submission_id=submission_id,
                        implementation_number=number,
                        category="voice_notes",
                    )
                )


                voice_keys.extend(
                    uploaded_voice_keys
                )


            # =================================================
            # LESSON PLANS
            # =================================================

            lesson_plan_keys = (
                upload_multiple_files(
                    files=implementation[
                        "lesson_plan_files"
                    ],
                    school_name=selected_school,
                    teacher_name=selected_teacher,
                    implementation_date=implementation_date,
                    submission_id=submission_id,
                    implementation_number=number,
                    category="lesson_plans",
                )
            )


            # =================================================
            # ACTIVITY VIDEOS
            # =================================================

            activity_video_keys = (
                upload_multiple_files(
                    files=implementation[
                        "activity_video_files"
                    ],
                    school_name=selected_school,
                    teacher_name=selected_teacher,
                    implementation_date=implementation_date,
                    submission_id=submission_id,
                    implementation_number=number,
                    category="activity_videos",
                )
            )


            # =================================================
            # STUDENT WRITTEN WORK
            # =================================================

            student_work_keys = (
                upload_multiple_files(
                    files=implementation[
                        "student_written_work_files"
                    ],
                    school_name=selected_school,
                    teacher_name=selected_teacher,
                    implementation_date=implementation_date,
                    submission_id=submission_id,
                    implementation_number=number,
                    category="student_work",
                )
            )


            # =================================================
            # STUDENT ASSESSMENT
            # =================================================

            student_assessment_keys = (
                upload_multiple_files(
                    files=implementation[
                        "student_assessment_files"
                    ],
                    school_name=selected_school,
                    teacher_name=selected_teacher,
                    implementation_date=implementation_date,
                    submission_id=submission_id,
                    implementation_number=number,
                    category="student_assessments",
                )
            )


            # =================================================
            # PHONICS
            # =================================================

            phonics_keys = (
                upload_multiple_files(
                    files=implementation[
                        "phonics_files"
                    ],
                    school_name=selected_school,
                    teacher_name=selected_teacher,
                    implementation_date=implementation_date,
                    submission_id=submission_id,
                    implementation_number=number,
                    category="phonics",
                )
            )


            # =================================================
            # TEACHER PORTFOLIO
            # =================================================

            portfolio_keys = (
                upload_multiple_files(
                    files=implementation[
                        "portfolio_files"
                    ],
                    school_name=selected_school,
                    teacher_name=selected_teacher,
                    implementation_date=implementation_date,
                    submission_id=submission_id,
                    implementation_number=number,
                    category="teacher_portfolio",
                )
            )


            # =================================================
            # DATABASE VALUES
            # =================================================

            voice_note_link = join_links(
                voice_keys
            )


            lesson_plan_picture = join_links(
                lesson_plan_keys
            )


            writing_sample_link = join_links(
                student_work_keys
            )


            student_assessment_link = join_links(
                student_assessment_keys
            )


            phonics_evidence_link = join_links(
                phonics_keys
            )


            portfolio_evidence_link = join_links(
                portfolio_keys
            )


            # Existing teacher_records schema only has
            # Video_Evidence_1 / 2 / 3.
            #
            # Therefore we deliberately DO NOT use:
            # Activity_Video_Links
            #
            # This avoids the previous Supabase schema error.

            video_evidence_values = [
                "",
                "",
                "",
            ]


            for video_index, video_key in enumerate(
                activity_video_keys[:3]
            ):

                video_evidence_values[
                    video_index
                ] = video_key


            # =================================================
            # TEACHER RECORD
            # =================================================

            record = {
                "State_Zone": selected_state,
                "Uploaded_By": selected_consultant,
                "Institution": selected_school,
                "Center": selected_school,
                "FirstName": first_name,
                "LastName": last_name,
                "FullName": selected_teacher,
                "Role": "teacher",
                "Type": "lessonDelivery",

                "Grade": implementation[
                    "grade"
                ],

                "Subject": implementation[
                    "subject"
                ],

                "Book": implementation[
                    "lesson"
                ],

                "StartTime": None,
                "EndTime": None,

                "Duration_Min": 0.0,

                "Voice_Note_Link": voice_note_link,

                "Lesson_Plan_Picture":
                    lesson_plan_picture,

                "Video_Evidence_1":
                    video_evidence_values[0],

                "Video_Evidence_2":
                    video_evidence_values[1],

                "Video_Evidence_3":
                    video_evidence_values[2],

                "Writing_Sample_Link":
                    writing_sample_link,

                "Student_Assessment_Link":
                    student_assessment_link,

                "Phonics_Evidence_Link":
                    phonics_evidence_link,

                "Portfolio_Evidence_Link":
                    portfolio_evidence_link,

                "Assessment_Score_Pct": None,
            }


            # =================================================
            # INSERT INTO EXISTING TABLE
            # =================================================

            response = (
                supabase
                .table("teacher_records")
                .insert(record)
                .execute()
            )


            if not response.data:

                raise RuntimeError(
                    "The teacher record could not be saved."
                )


            progress.progress(
                int(
                    (
                        (index + 1)
                        / total_steps
                    ) * 100
                )
            )


        # =====================================================
        # SUCCESS
        # =====================================================

        status_text.empty()

        progress.progress(100)

        st.success(
            "✅ Your implementation has been submitted "
            "successfully."
        )


        st.markdown(
            """
            <div class="success-box">

            <strong>Submission complete.</strong>

            <br><br>

            Your voice note and submitted evidence have been
            uploaded successfully.

            <br><br>

            The admin team can review the implementation and
            play the submitted voice note from the admin portal.

            </div>
            """,
            unsafe_allow_html=True,
        )


        st.session_state.submitted = True


    except Exception as e:

        status_text.empty()

        st.error(
            "❌ Submission could not be saved."
        )

        st.code(
            str(e)
        )

        st.warning(
            "Please check your internet connection and try again. "
            "If the problem continues, share this error with the "
            "technical/admin team."
        )


# ============================================================
# FOOTER
# ============================================================

st.markdown("---")

st.caption(
    "Teacher Daily Implementation Portal • "
    "Lesson evidence & voice-note reflection"
)
