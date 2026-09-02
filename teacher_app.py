import streamlit as st
import pandas as pd
import re
import uuid
import concurrent.futures
from supabase import create_client
import boto3
from boto3.s3.transfer import TransferConfig
# ============================================================
# STREAMLIT CONFIGURATION
# ============================================================
st.set_page_config(
    page_title="Teacher Daily Evidence Portal",
    page_icon="📝",
    layout="centered"
)
# ============================================================
# UPLOAD CONFIGURATION
# ============================================================
MAX_FILE_SIZE_MB = 50
MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024
MAX_PARALLEL_UPLOADS = 5
R2_MULTIPART_THRESHOLD = 8 * 1024 * 1024
R2_MULTIPART_CHUNK_SIZE = 8 * 1024 * 1024
MAX_EVIDENCE_GROUPS = 10
# ============================================================
# SUPABASE SETUP
# ============================================================
try:
    SUPABASE_URL = st.secrets["supabase"]["url"].rstrip("/")
    SUPABASE_KEY = st.secrets["supabase"]["key"]
    supabase = create_client(
        SUPABASE_URL,
        SUPABASE_KEY
    )
except Exception as e:
    st.error(
        f"⚠️ Supabase configuration is missing: {e}"
    )
    st.stop()
# ============================================================
# CLOUDFLARE R2 SETUP
# ============================================================
try:
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
except Exception as e:
    st.error(
        f"⚠️ R2 storage configuration is missing: {e}"
    )
    st.stop()
# ============================================================
# R2 TRANSFER CONFIGURATION
# ============================================================
R2_TRANSFER_CONFIG = TransferConfig(
    multipart_threshold=R2_MULTIPART_THRESHOLD,
    multipart_chunksize=R2_MULTIPART_CHUNK_SIZE,
    max_concurrency=5,
    use_threads=True
)
# ============================================================
# DATABASE CONFIGURATION
# ============================================================
TEACHER_RECORDS_TABLE = "teacher_records"
ROSTER_COLUMNS = [
    "State_Zone",
    "Uploaded_By",
    "Institution",
    "FullName",
    "Role"
]
# ============================================================
# GRADE OPTIONS
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
# ============================================================
# SUBJECT OPTIONS
# ============================================================
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
# ============================================================
# EVIDENCE TYPE OPTIONS
# ============================================================
EVIDENCE_TYPE_OPTIONS = [
    "Lesson Plan",
    "Classroom Activity",
    "Phonics / Phonetics",
    "Student Writing",
    "Teacher Portfolio",
    "Other"
]
# ============================================================
# FETCH MASTER TEACHER ROSTER
# ============================================================
@st.cache_data(ttl=300, show_spinner=False)
def fetch_master_db_from_supabase():
    try:
        all_rows = []
        page_size = 1000
        start = 0
        while True:
            response = (
                supabase
                .table(TEACHER_RECORDS_TABLE)
                .select(",".join(ROSTER_COLUMNS))
                .range(
                    start,
                    start + page_size - 1
                )
                .execute()
            )
            batch = response.data or []
            all_rows.extend(batch)
            if len(batch) < page_size:
                break
            start += page_size
        if not all_rows:
            return pd.DataFrame(
                columns=ROSTER_COLUMNS
            )
        df = pd.DataFrame(all_rows)
        for col in ROSTER_COLUMNS:
            if col not in df.columns:
                df[col] = ""
            df[col] = (
                df[col]
                .fillna("")
                .astype(str)
                .str.replace(
                    r"\s+",
                    " ",
                    regex=True
                )
                .str.strip()
            )
        return df.drop_duplicates()
    except Exception as e:
        st.error(
            f"⚠️ Could not load teacher roster: {e}"
        )
        return pd.DataFrame(
            columns=ROSTER_COLUMNS
        )
# ============================================================
# SANITIZE R2 PATH COMPONENT
# ============================================================
def sanitize_path_component(value):
    value = str(value).strip()
    value = re.sub(
        r"\s+",
        "_",
        value
    )
    value = re.sub(
        r"[^a-zA-Z0-9_-]",
        "_",
        value
    )
    value = re.sub(
        r"_+",
        "_",
        value
    )
    value = value.strip("_")
    return value or "unknown"
# ============================================================
# FILE SIZE
# ============================================================
def get_file_size_mb(uploaded_file):
    return uploaded_file.size / (
        1024 * 1024
    )
# ============================================================
# R2 SINGLE FILE UPLOAD WORKER
# ============================================================
def upload_single_file_worker(args):
    uploaded_file, folder_name, category, group_number = args
    try:
        # ----------------------------------------------------
        # FILE SIZE CHECK
        # ----------------------------------------------------
        if uploaded_file.size > MAX_FILE_SIZE_BYTES:
            return {
                "success": False,
                "file_name": uploaded_file.name,
                "category": category,
                "group_number": group_number,
                "path": None,
                "error": (
                    f"File exceeds "
                    f"{MAX_FILE_SIZE_MB} MB."
                )
            }
        # ----------------------------------------------------
        # CLEAN FILE NAME
        # ----------------------------------------------------
        clean_filename = re.sub(
            r"[^a-zA-Z0-9_.-]",
            "_",
            uploaded_file.name
        )
        # ----------------------------------------------------
        # UNIQUE FILE NAME
        # ----------------------------------------------------
        unique_file_id = uuid.uuid4().hex[:12]
        final_filename = (
            f"{unique_file_id}_{clean_filename}"
        )
        # ----------------------------------------------------
        # R2 OBJECT KEY
        # ----------------------------------------------------
        file_path = (
            f"{folder_name}/{final_filename}"
        )
        # ----------------------------------------------------
        # RESET FILE POINTER
        # ----------------------------------------------------
        uploaded_file.seek(0)
        # ----------------------------------------------------
        # R2 UPLOAD
        # ----------------------------------------------------
        r2_client.upload_fileobj(
            Fileobj=uploaded_file,
            Bucket=R2_BUCKET_NAME,
            Key=file_path,
            ExtraArgs={
                "ContentType": (
                    uploaded_file.type
                    or "application/octet-stream"
                )
            },
            Config=R2_TRANSFER_CONFIG
        )
        return {
            "success": True,
            "file_name": uploaded_file.name,
            "category": category,
            "group_number": group_number,
            "path": file_path,
            "error": None
        }
    except Exception as e:
        return {
            "success": False,
            "file_name": uploaded_file.name,
            "category": category,
            "group_number": group_number,
            "path": None,
            "error": str(e)
        }
# ============================================================
# PARALLEL R2 UPLOAD
# ============================================================
def upload_all_files_parallel(upload_jobs):
    if not upload_jobs:
        return []
    with concurrent.futures.ThreadPoolExecutor(
        max_workers=MAX_PARALLEL_UPLOADS
    ) as executor:
        results = list(
            executor.map(
                upload_single_file_worker,
                upload_jobs
            )
        )
    return results
# ============================================================
# SUPABASE INSERT
# ============================================================
def insert_submission_to_db(entry_dict):
    return (
        supabase
        .table(TEACHER_RECORDS_TABLE)
        .insert(entry_dict)
        .execute()
    )
# ============================================================
# SESSION STATE
# ============================================================
if "evidence_group_count" not in st.session_state:
    st.session_state.evidence_group_count = 1
# ============================================================
# LOAD MASTER DATABASE
# ============================================================
master_df = fetch_master_db_from_supabase()
# ============================================================
# PAGE HEADER
# ============================================================
st.title(
    "📝 Teacher Daily Evidence Portal"
)
st.markdown(
    "Submit lesson plans, classroom activities, "
    "student work, phonics evidence and other "
    "teaching evidence."
)
st.info(
    f"📦 **Maximum file size: {MAX_FILE_SIZE_MB} MB per file**\n\n"
    "You can add multiple lesson or evidence groups "
    "in one submission. The 50 MB limit applies to "
    "each individual file, not the complete submission."
)
# ============================================================
# STATE / ZONE
# ============================================================
all_states = (
    sorted(
        [
            state
            for state in master_df["State_Zone"].unique()
            if state
            and state.lower()
            not in [
                "nan",
                "none",
                ""
            ]
        ]
    )
    if (
        not master_df.empty
        and "State_Zone" in master_df.columns
    )
    else []
)
if not all_states:
    all_states = [
        "Madhya Pradesh (MP)"
    ]
sub_state = st.selectbox(
    "Select State / Zone *",
    options=[
        "-- Select State / Zone --"
    ] + all_states,
    key="state_selection"
)
# ============================================================
# CONSULTANT
# ============================================================
filtered_consultants = []
if (
    sub_state != "-- Select State / Zone --"
    and not master_df.empty
):
    c_subset = master_df[
        master_df["State_Zone"].str.lower()
        == sub_state.lower()
    ]
    filtered_consultants = sorted(
        [
            consultant
            for consultant
            in c_subset["Uploaded_By"].unique()
            if consultant
            and consultant.lower()
            not in [
                "nan",
                "none",
                ""
            ]
        ]
    )
sub_consultant = st.selectbox(
    "Select Consultant / Academic Manager *",
    options=[
        "-- Select Consultant --"
    ] + filtered_consultants,
    key="consultant_selection"
)
# ============================================================
# SCHOOL
# ============================================================
filtered_schools = []
if (
    sub_consultant != "-- Select Consultant --"
    and not master_df.empty
):
    s_subset = master_df[
        (
            master_df["State_Zone"].str.lower()
            == sub_state.lower()
        )
        &
        (
            master_df["Uploaded_By"].str.lower()
            == sub_consultant.lower()
        )
    ]
    filtered_schools = sorted(
        [
            school
            for school
            in s_subset["Institution"].unique()
            if school
            and school.lower()
            not in [
                "nan",
                "unknown school",
                "default school",
                ""
            ]
        ]
    )
sub_school = st.selectbox(
    "Select School / Institution *",
    options=[
        "-- Select School --"
    ] + filtered_schools,
    key="school_selection"
)
# ============================================================
# TEACHER
# ============================================================
filtered_teachers = []
if (
    sub_school != "-- Select School --"
    and not master_df.empty
):
    t_subset = master_df[
        (
            master_df["State_Zone"].str.lower()
            == sub_state.lower()
        )
        &
        (
            master_df["Uploaded_By"].str.lower()
            == sub_consultant.lower()
        )
        &
        (
            master_df["Institution"].str.lower()
            == sub_school.lower()
        )
    ]
    # --------------------------------------------------------
    # FILTER TO TEACHERS WHEN ROLE DATA EXISTS
    # --------------------------------------------------------
    if "Role" in t_subset.columns:
        role_lower = (
            t_subset["Role"]
            .astype(str)
            .str.lower()
            .str.strip()
        )
        teacher_mask = role_lower.isin(
            [
                "teacher",
                "teachers"
            ]
        )
        if teacher_mask.any():
            t_subset = t_subset[
                teacher_mask
            ]
    raw_names = (
        t_subset["FullName"]
        .astype(str)
        .unique()
        .tolist()
    )
    filtered_teachers = sorted(
        [
            name
            for name in raw_names
            if name
            and name.lower()
            not in [
                "nan",
                "unknown teacher",
                "none",
                ""
            ]
        ]
    )
sub_teacher_name = st.selectbox(
    "Select Your Name *",
    options=[
        "-- Select Your Name --"
    ] + filtered_teachers,
    key="teacher_selection"
)
# ============================================================
# SUBMISSION DATE
# ============================================================
sub_date = st.date_input(
    "Submission Date *",
    key="submission_date"
)
# ============================================================
# EVIDENCE SECTION
# ============================================================
st.divider()
st.header(
    "📚 Lesson & Evidence Submission"
)
st.caption(
    "Create one Evidence Group for each lesson, "
    "activity or classroom evidence."
)
# ============================================================
# EVIDENCE GROUP UI
# ============================================================
for group_number in range(
    1,
    st.session_state.evidence_group_count + 1
):
    st.markdown(
        f"### Evidence Group {group_number}"
    )
    with st.container(border=True):
        # ----------------------------------------------------
        # GRADE AND SUBJECT
        # ----------------------------------------------------
        col1, col2 = st.columns(2)
        with col1:
            st.selectbox(
                "Grade / Class *",
                options=GRADE_OPTIONS,
                key=f"group_{group_number}_grade"
            )
        with col2:
            st.selectbox(
                "Subject *",
                options=SUBJECT_OPTIONS,
                key=f"group_{group_number}_subject"
            )
        # ----------------------------------------------------
        # EVIDENCE TYPE
        # ----------------------------------------------------
        st.selectbox(
            "Evidence Type *",
            options=EVIDENCE_TYPE_OPTIONS,
            key=f"group_{group_number}_type"
        )
        # ----------------------------------------------------
        # LESSON / ACTIVITY
        # ----------------------------------------------------
        st.text_input(
            "Chapter / Lesson / Activity Name *",
            placeholder=(
                "Example: Chapter 2 - Plants / "
                "Lesson Plan #4"
            ),
            key=f"group_{group_number}_lesson"
        )
        st.caption(
            "Upload only the evidence related to this "
            "lesson or activity."
        )
        # ----------------------------------------------------
        # VOICE NOTE
        # ----------------------------------------------------
        st.file_uploader(
            "🎤 Voice Note(s)",
            type=[
                "mp3",
                "wav",
                "m4a",
                "ogg"
            ],
            accept_multiple_files=True,
            key=f"group_{group_number}_voice"
        )
        # ----------------------------------------------------
        # LESSON PLAN
        # ----------------------------------------------------
        st.file_uploader(
            "📄 Lesson Plan Picture(s) / Document(s)",
            type=[
                "png",
                "jpg",
                "jpeg",
                "pdf"
            ],
            accept_multiple_files=True,
            key=f"group_{group_number}_picture"
        )
        # ----------------------------------------------------
        # CLASSROOM ACTIVITY VIDEO
        # ----------------------------------------------------
        st.file_uploader(
            "🎥 Classroom Activity Video(s)",
            type=[
                "mp4",
                "mov",
                "avi"
            ],
            accept_multiple_files=True,
            key=f"group_{group_number}_video"
        )
        # ----------------------------------------------------
        # STUDENT WRITING
        # ----------------------------------------------------
        st.file_uploader(
            "📝 Student Writing Sample(s)",
            type=[
                "pdf",
                "png",
                "jpg",
                "jpeg"
            ],
            accept_multiple_files=True,
            key=f"group_{group_number}_writing"
        )
        # ----------------------------------------------------
        # PHONICS
        # ----------------------------------------------------
        st.file_uploader(
            "🔤 Phonics / Phonetics Evidence(s)",
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
            key=f"group_{group_number}_phonics"
        )
        # ----------------------------------------------------
        # TEACHER PORTFOLIO
        # ----------------------------------------------------
        st.file_uploader(
            "📁 Teacher Portfolio Evidence(s)",
            type=[
                "pdf",
                "png",
                "jpg",
                "jpeg",
                "mp4"
            ],
            accept_multiple_files=True,
            key=f"group_{group_number}_portfolio"
        )
# ============================================================
# ADD / REMOVE EVIDENCE GROUPS
# ============================================================
st.divider()
button_col1, button_col2 = st.columns(2)
with button_col1:
    if (
        st.session_state.evidence_group_count
        < MAX_EVIDENCE_GROUPS
    ):
        if st.button(
            "➕ Add Another Lesson / Evidence",
            use_container_width=True
        ):
            st.session_state.evidence_group_count += 1
            st.rerun()
with button_col2:
    if (
        st.session_state.evidence_group_count
        > 1
    ):
        if st.button(
            "➖ Remove Last Evidence Group",
            use_container_width=True
        ):
            st.session_state.evidence_group_count -= 1
            st.rerun()
# ============================================================
# SUBMIT BUTTON
# ============================================================
st.divider()
submit_button = st.button(
    "🚀 Upload All Evidence & Submit",
    type="primary",
    use_container_width=True
)
# ============================================================
# SUBMISSION PROCESSING
# ============================================================
if submit_button:
    # ========================================================
    # REQUIRED FIELD VALIDATION
    # ========================================================
    if sub_state == "-- Select State / Zone --":
        st.error(
            "Please select a State / Zone."
        )
        st.stop()
    if sub_consultant == "-- Select Consultant --":
        st.error(
            "Please select a Consultant."
        )
        st.stop()
    if sub_school == "-- Select School --":
        st.error(
            "Please select a School."
        )
        st.stop()
    if sub_teacher_name == "-- Select Your Name --":
        st.error(
            "Please select your name."
        )
        st.stop()
    # ========================================================
    # MASTER SUBMISSION ID
    # ========================================================
    submission_id = uuid.uuid4().hex[:12]
    # ========================================================
    # R2 BASE PATH
    # ========================================================
    clean_school = sanitize_path_component(
        sub_school
    )
    clean_teacher = sanitize_path_component(
        sub_teacher_name
    )
    submission_date_folder = (
        sub_date.strftime("%Y-%m-%d")
    )
    submission_base = (
        f"schools/"
        f"{clean_school}/"
        f"teachers/"
        f"{clean_teacher}/"
        f"{submission_date_folder}/"
        f"submission_{submission_id}"
    )
    # ========================================================
    # COLLECT EVIDENCE GROUPS
    # ========================================================
    evidence_groups = []
    for group_number in range(
        1,
        st.session_state.evidence_group_count + 1
    ):
        group_grade = st.session_state[
            f"group_{group_number}_grade"
        ]
        group_subject = st.session_state[
            f"group_{group_number}_subject"
        ]
        group_evidence_type = st.session_state[
            f"group_{group_number}_type"
        ]
        group_lesson = st.session_state[
            f"group_{group_number}_lesson"
        ]
        group_voice = st.session_state.get(
            f"group_{group_number}_voice",
            []
        )
        group_picture = st.session_state.get(
            f"group_{group_number}_picture",
            []
        )
        group_video = st.session_state.get(
            f"group_{group_number}_video",
            []
        )
        group_writing = st.session_state.get(
            f"group_{group_number}_writing",
            []
        )
        group_phonics = st.session_state.get(
            f"group_{group_number}_phonics",
            []
        )
        group_portfolio = st.session_state.get(
            f"group_{group_number}_portfolio",
            []
        )
        # ----------------------------------------------------
        # LESSON VALIDATION
        # ----------------------------------------------------
        if not group_lesson.strip():
            st.error(
                f"Please enter the Chapter / Lesson / "
                f"Activity name for Evidence Group "
                f"{group_number}."
            )
            st.stop()
        # ----------------------------------------------------
        # STORE GROUP
        # ----------------------------------------------------
        evidence_groups.append(
            {
                "group_number": group_number,
                "grade": group_grade,
                "subject": group_subject,
                "evidence_type": group_evidence_type,
                "lesson": group_lesson.strip(),
                "voice": group_voice,
                "picture": group_picture,
                "video": group_video,
                "writing": group_writing,
                "phonics": group_phonics,
                "portfolio": group_portfolio
            }
        )
    # ========================================================
    # BUILD ALL R2 UPLOAD JOBS
    # ========================================================
    upload_jobs = []
    for group in evidence_groups:
        group_number = group["group_number"]
        group_base = (
            f"{submission_base}/"
            f"evidence_{group_number}"
        )
        # ----------------------------------------------------
        # VOICE NOTES
        # ----------------------------------------------------
        for file in group["voice"]:
            upload_jobs.append(
                (
                    file,
                    f"{group_base}/voice_notes",
                    "voice",
                    group_number
                )
            )
        # ----------------------------------------------------
        # LESSON PLAN DOCUMENTS
        # ----------------------------------------------------
        for file in group["picture"]:
            upload_jobs.append(
                (
                    file,
                    f"{group_base}/lesson_plans",
                    "picture",
                    group_number
                )
            )
        # ----------------------------------------------------
        # CLASSROOM VIDEOS
        # ----------------------------------------------------
        for file in group["video"]:
            upload_jobs.append(
                (
                    file,
                    f"{group_base}/videos",
                    "video",
                    group_number
                )
            )
        # ----------------------------------------------------
        # WRITING SAMPLES
        # ----------------------------------------------------
        for file in group["writing"]:
            upload_jobs.append(
                (
                    file,
                    f"{group_base}/writing_samples",
                    "writing",
                    group_number
                )
            )
        # ----------------------------------------------------
        # PHONICS
        # ----------------------------------------------------
        for file in group["phonics"]:
            upload_jobs.append(
                (
                    file,
                    f"{group_base}/phonics_evidences",
                    "phonics",
                    group_number
                )
            )
        # ----------------------------------------------------
        # TEACHER PORTFOLIO
        # ----------------------------------------------------
        for file in group["portfolio"]:
            upload_jobs.append(
                (
                    file,
                    f"{group_base}/portfolio_evidences",
                    "portfolio",
                    group_number
                )
            )
    # ========================================================
    # CHECK INDIVIDUAL FILE SIZE
    # ========================================================
    oversized_files = []
    for (
        file,
        folder,
        category,
        group_number
    ) in upload_jobs:
        if file.size > MAX_FILE_SIZE_BYTES:
            oversized_files.append(
                {
                    "name": file.name,
                    "size": get_file_size_mb(file),
                    "group": group_number
                }
            )
    if oversized_files:
        st.error(
            f"❌ One or more files exceed the "
            f"{MAX_FILE_SIZE_MB} MB individual file limit."
        )
        for item in oversized_files:
            st.write(
                f"• Evidence Group {item['group']}: "
                f"{item['name']} — "
                f"{item['size']:.1f} MB"
            )
        st.warning(
            "Please compress or remove the oversized "
            "file(s), then submit again."
        )
        st.stop()
    # ========================================================
    # UPLOAD FILES TO R2
    # ========================================================
    upload_results = []
    if upload_jobs:
        total_files = len(upload_jobs)
        progress_bar = st.progress(0)
        status_text = st.empty()
        status_text.info(
            f"⚡ Uploading {total_files} file(s) "
            f"to cloud storage..."
        )
        upload_results = upload_all_files_parallel(
            upload_jobs
        )
        progress_bar.progress(100)
        # ----------------------------------------------------
        # CHECK FAILED UPLOADS
        # ----------------------------------------------------
        failed_uploads = [
            result
            for result in upload_results
            if not result["success"]
        ]
        if failed_uploads:
            st.error(
                "❌ Some files failed to upload."
            )
            for result in failed_uploads:
                st.write(
                    f"• Evidence Group "
                    f"{result['group_number']} — "
                    f"{result['file_name']}: "
                    f"{result['error']}"
                )
            st.warning(
                "The database records were NOT created. "
                "Please correct the failed files and "
                "submit again."
            )
            st.stop()
        status_text.success(
            f"✅ All {total_files} file(s) "
            f"uploaded successfully."
        )
    # ========================================================
    # CREATE PATH LOOKUP FUNCTION
    # ========================================================
    def get_paths(
        group_number,
        category
    ):
        return [
            result["path"]
            for result in upload_results
            if (
                result["success"]
                and result["group_number"] == group_number
                and result["category"] == category
            )
        ]
    # ========================================================
    # SPLIT TEACHER NAME
    # ========================================================
    name_parts = sub_teacher_name.split(
        " ",
        1
    )
    first_name = name_parts[0]
    last_name = (
        name_parts[1]
        if len(name_parts) > 1
        else ""
    )
    # ========================================================
    # CREATE ONE DATABASE ROW PER EVIDENCE GROUP
    # ========================================================
    database_entries = []
    for group in evidence_groups:
        group_number = group["group_number"]
        voice_paths = get_paths(
            group_number,
            "voice"
        )
        picture_paths = get_paths(
            group_number,
            "picture"
        )
        video_paths = get_paths(
            group_number,
            "video"
        )
        writing_paths = get_paths(
            group_number,
            "writing"
        )
        phonics_paths = get_paths(
            group_number,
            "phonics"
        )
        portfolio_paths = get_paths(
            group_number,
            "portfolio"
        )
        # ----------------------------------------------------
        # EXISTING DATABASE COLUMNS
        # ----------------------------------------------------
        voice_link = (
            ", ".join(voice_paths)
            if voice_paths
            else None
        )
        picture_link = (
            ", ".join(picture_paths)
            if picture_paths
            else None
        )
        writing_link = (
            ", ".join(writing_paths)
            if writing_paths
            else None
        )
        phonics_link = (
            ", ".join(phonics_paths)
            if phonics_paths
            else None
        )
        portfolio_link = (
            ", ".join(portfolio_paths)
            if portfolio_paths
            else None
        )
        # ----------------------------------------------------
        # MAXIMUM 3 VIDEO COLUMNS
        # ----------------------------------------------------
        video_1 = (
            video_paths[0]
            if len(video_paths) >= 1
            else None
        )
        video_2 = (
            video_paths[1]
            if len(video_paths) >= 2
            else None
        )
        video_3 = (
            video_paths[2]
            if len(video_paths) >= 3
            else None
        )
        # ----------------------------------------------------
        # DATABASE ENTRY
        # ----------------------------------------------------
        entry_dict = {
            "State_Zone": sub_state,
            "Uploaded_By": sub_consultant,
            "Institution": sub_school,
            "Center": sub_school,
            "FirstName": first_name,
            "LastName": last_name,
            "FullName": sub_teacher_name,
            "Role": "teacher",
            "Type": "lessonDelivery",
            "Grade": group["grade"],
            "Subject": group["subject"],
            "Book": group["lesson"],
            "StartTime": pd.to_datetime(
                sub_date
            ).strftime(
                "%Y-%m-%d 09:00:00"
            ),
            "EndTime": pd.to_datetime(
                sub_date
            ).strftime(
                "%Y-%m-%d 09:45:00"
            ),
            "Duration_Min": 0.0,
            "Voice_Note_Link": voice_link,
            "Lesson_Plan_Picture": picture_link,
            "Video_Evidence_1": video_1,
            "Video_Evidence_2": video_2,
            "Video_Evidence_3": video_3,
            "Writing_Sample_Link": writing_link,
            "Phonics_Evidence_Link": phonics_link,
            "Portfolio_Evidence_Link": portfolio_link,
            "Assessment_Score_Pct": None
        }
        database_entries.append(
            entry_dict
        )
    # ========================================================
    # SAVE DATABASE RECORDS
    # ========================================================
    try:
        with st.spinner(
            f"Saving {len(database_entries)} "
            f"evidence group(s) to database..."
        ):
            for entry in database_entries:
                insert_submission_to_db(
                    entry
                )
    except Exception as e:
        st.error(
            "❌ Files were uploaded successfully, "
            "but database saving failed."
        )
        st.code(
            str(e)
        )
        st.warning(
            "Please contact the administrator before "
            "submitting the same evidence again."
        )
        st.stop()
    # ========================================================
    # SUCCESS MESSAGE
    # ========================================================
    st.success(
        f"🎉 Submission successful! "
        f"{len(database_entries)} evidence group(s) "
        f"submitted for {sub_teacher_name}."
    )
    st.info(
        f"📁 Submission ID: "
        f"submission_{submission_id}"
    )
    if upload_results:
        successful_count = len(
            [
                result
                for result in upload_results
                if result["success"]
            ]
        )
        st.caption(
            f"☁️ {successful_count} file(s) "
            f"uploaded successfully to Cloudflare R2."
        )
