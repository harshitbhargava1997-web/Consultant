import streamlit as st
import pandas as pd
import re
import uuid
import hashlib
import mimetypes
import time
from datetime import datetime, date
from concurrent.futures import ThreadPoolExecutor, as_completed
from queue import Queue, Empty
from supabase import create_client
import boto3
from boto3.s3.transfer import TransferConfig
# ============================================================
# PAGE CONFIG
# ============================================================
st.set_page_config(
    page_title="Teacher Daily Evidence Portal",
    page_icon="📝",
    layout="centered",
)
# ============================================================
# CONFIGURATION
# ============================================================
MAX_FILE_SIZE_MB = 50
MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024
MAX_PARALLEL_UPLOADS = 5
R2_MULTIPART_THRESHOLD = 8 * 1024 * 1024
R2_MULTIPART_CHUNK_SIZE = 8 * 1024 * 1024
MAX_EVIDENCE_GROUPS = 10
MAX_ACTIVITY_VIDEOS = 3
# ============================================================
# SUPABASE
# ============================================================
@st.cache_resource
def get_supabase_client():
    url = st.secrets["supabase"]["url"]
    key = st.secrets["supabase"]["key"]
    return create_client(url, key)
supabase = get_supabase_client()
# ============================================================
# CLOUDFLARE R2
# ============================================================
@st.cache_resource
def get_r2_client():
    endpoint_url = st.secrets["r2"]["R2_ENDPOINT_URL"]
    return boto3.client(
        "s3",
        endpoint_url=endpoint_url,
        aws_access_key_id=st.secrets["r2"]["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=st.secrets["r2"]["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
    )
r2_client = get_r2_client()
R2_BUCKET_NAME = st.secrets["r2"]["R2_BUCKET_NAME"]
r2_transfer_config = TransferConfig(
    multipart_threshold=R2_MULTIPART_THRESHOLD,
    multipart_chunksize=R2_MULTIPART_CHUNK_SIZE,
    max_concurrency=MAX_PARALLEL_UPLOADS,
    use_threads=True,
)
# ============================================================
# SESSION STATE
# ============================================================
if "evidence_group_count" not in st.session_state:
    st.session_state.evidence_group_count = 1
if "submission_in_progress" not in st.session_state:
    st.session_state.submission_in_progress = False
# ============================================================
# CONSTANTS
# ============================================================
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
    "Environmental Studies (EVS)",
    "Science",
    "General Knowledge (GK)",
    "English Grammar",
    "Computer",
    "Play Activity",
    "Play Time",
    "Play Based",
]
EVIDENCE_TYPE_OPTIONS = [
    "Lesson Plan",
    "Classroom Activity",
    "Phonics / Phonetics",
    "Student Writing",
    "Teacher Portfolio",
    "Other",
]
# ============================================================
# UTILITY FUNCTIONS
# ============================================================
def clean_name(value):
    """Make a safe R2 path component."""
    value = str(value or "").strip()
    value = re.sub(
        r"[^A-Za-z0-9._-]+",
        "_",
        value
    )
    value = re.sub(
        r"_+",
        "_",
        value
    )
    return value.strip("_") or "unknown"
def normalize_text(value):
    return re.sub(
        r"\s+",
        " ",
        str(value or "").strip().lower()
    )
def get_file_size(uploaded_file):
    """
    Avoid getvalue() because it creates another copy of
    potentially large files.
    """
    try:
        current_position = uploaded_file.tell()
        uploaded_file.seek(0, 2)
        size = uploaded_file.tell()
        uploaded_file.seek(current_position)
        return size
    except Exception:
        return 0
def format_bytes(size):
    if size < 1024:
        return f"{size} B"
    if size < 1024 * 1024:
        return f"{size / 1024:.1f} KB"
    if size < 1024 * 1024 * 1024:
        return f"{size / (1024 * 1024):.1f} MB"
    return f"{size / (1024 * 1024 * 1024):.2f} GB"
def calculate_fingerprint(
    teacher_name,
    submission_date,
    groups
):
    """
    Creates a deterministic SHA-256 fingerprint.
    Same teacher + same date + same group metadata +
    same filenames = duplicate.
    """
    parts = [
        normalize_text(teacher_name),
        submission_date.isoformat(),
    ]
    for group_index, group in enumerate(groups, start=1):
        parts.extend([
            str(group_index),
            normalize_text(group["grade"]),
            normalize_text(group["subject"]),
            normalize_text(group["evidence_type"]),
            normalize_text(group["lesson"]),
        ])
        for category in [
            "voice",
            "pictures",
            "videos",
            "writing",
            "phonics",
            "portfolio",
        ]:
            files = group.get(category, [])
            file_names = sorted(
                normalize_text(file.name)
                for file in files
            )
            parts.extend(file_names)
    canonical_string = "|".join(parts)
    return hashlib.sha256(
        canonical_string.encode("utf-8")
    ).hexdigest()
def get_mime_type(filename):
    mime_type, _ = mimetypes.guess_type(filename)
    return mime_type or "application/octet-stream"
# ============================================================
# ROSTER
# ============================================================
@st.cache_data(ttl=300)
def fetch_roster():
    rows = []
    start = 0
    page_size = 1000
    while True:
        response = (
            supabase
            .table("teacher_records")
            .select(
                "State_Zone,Uploaded_By,Institution,"
                "FullName,Role"
            )
            .range(start, start + page_size - 1)
            .execute()
        )
        batch = response.data or []
        if not batch:
            break
        rows.extend(batch)
        if len(batch) < page_size:
            break
        start += page_size
    if not rows:
        return pd.DataFrame(
            columns=[
                "State_Zone",
                "Uploaded_By",
                "Institution",
                "FullName",
                "Role",
            ]
        )
    df = pd.DataFrame(rows)
    for column in [
        "State_Zone",
        "Uploaded_By",
        "Institution",
        "FullName",
        "Role",
    ]:
        if column not in df.columns:
            df[column] = ""
    df["Role_Normalized"] = (
        df["Role"]
        .fillna("")
        .astype(str)
        .str.strip()
        .str.lower()
    )
    df = df[
        df["Role_Normalized"].isin(
            ["teacher", "teachers"]
        )
    ]
    df = df.drop_duplicates(
        subset=[
            "State_Zone",
            "Uploaded_By",
            "Institution",
            "FullName",
        ]
    )
    return df
roster_df = fetch_roster()
# ============================================================
# HEADER
# ============================================================
st.title("📝 Teacher Daily Evidence Portal")
st.caption(
    "Submit lesson plans and classroom evidence "
    "with secure R2 storage and submission tracking."
)
# ============================================================
# ROSTER SELECTORS
# ============================================================
if roster_df.empty:
    st.error(
        "No teacher roster was found in Supabase."
    )
    st.stop()
state_options = sorted(
    roster_df["State_Zone"]
    .dropna()
    .astype(str)
    .unique()
    .tolist()
)
selected_state = st.selectbox(
    "State / Zone",
    state_options,
)
consultant_df = roster_df[
    roster_df["State_Zone"] == selected_state
]
consultant_options = sorted(
    consultant_df["Uploaded_By"]
    .dropna()
    .astype(str)
    .unique()
    .tolist()
)
if not consultant_options:
    st.warning(
        "No consultants found for the selected State / Zone."
    )
    st.stop()
selected_consultant = st.selectbox(
    "Consultant",
    consultant_options,
)
school_df = consultant_df[
    consultant_df["Uploaded_By"] == selected_consultant
]
school_options = sorted(
    school_df["Institution"]
    .dropna()
    .astype(str)
    .unique()
    .tolist()
)
if not school_options:
    st.warning(
        "No schools found for the selected consultant."
    )
    st.stop()
selected_school = st.selectbox(
    "School",
    school_options,
)
teacher_df = school_df[
    school_df["Institution"] == selected_school
]
teacher_options = sorted(
    teacher_df["FullName"]
    .dropna()
    .astype(str)
    .unique()
    .tolist()
)
if not teacher_options:
    st.warning(
        "No teachers found for the selected school."
    )
    st.stop()
selected_teacher = st.selectbox(
    "Teacher",
    teacher_options,
)
# ============================================================
# SUBMISSION DATE
# ============================================================
submission_date = st.date_input(
    "Submission Date",
    value=date.today(),
    max_value=date.today(),
)
st.divider()
# ============================================================
# EVIDENCE GROUP HELPERS
# ============================================================
def render_file_uploader(
    label,
    key,
    accepted_types,
    help_text=None,
):
    return st.file_uploader(
        label,
        type=accepted_types,
        accept_multiple_files=True,
        key=key,
        help=help_text,
    )
# ============================================================
# EVIDENCE GROUPS
# ============================================================
st.subheader("📚 Evidence Groups")
st.info(
    "Create one evidence group for each lesson/classroom "
    "activity. Each group can have its own Grade, Subject "
    "and Chapter/Lesson."
)
groups = []
for group_number in range(
    1,
    st.session_state.evidence_group_count + 1
):
    st.markdown(
        f"### Evidence Group {group_number}"
    )
    with st.container(border=True):
        col1, col2 = st.columns(2)
        with col1:
            grade = st.selectbox(
                "Grade / Class",
                GRADE_OPTIONS,
                key=f"group_{group_number}_grade",
            )
        with col2:
            subject = st.selectbox(
                "Subject",
                SUBJECT_OPTIONS,
                key=f"group_{group_number}_subject",
            )
        evidence_type = st.selectbox(
            "Evidence Type",
            EVIDENCE_TYPE_OPTIONS,
            key=f"group_{group_number}_type",
        )
        lesson = st.text_input(
            "Chapter / Lesson / Activity Name",
            key=f"group_{group_number}_lesson",
            placeholder=(
                "Example: Plants – Lesson Plan 4"
            ),
        )
        st.markdown("#### 📎 Evidence Files")
        voice_files = render_file_uploader(
            "🎙️ Lesson Plan Voice Note(s)",
            f"group_{group_number}_voice",
            ["mp3", "wav", "m4a", "ogg", "pdf"],
        )
        picture_files = render_file_uploader(
            "📄 Lesson Plan Picture(s) / Document(s)",
            f"group_{group_number}_pictures",
            ["png", "jpg", "jpeg", "pdf"],
        )
        video_files = render_file_uploader(
            (
                "🎥 Classroom Activity Video(s) "
                f"(maximum {MAX_ACTIVITY_VIDEOS})"
            ),
            f"group_{group_number}_videos",
            ["mp4", "mov", "avi"],
        )
        if len(video_files) > MAX_ACTIVITY_VIDEOS:
            st.error(
                f"Evidence Group {group_number}: "
                f"maximum {MAX_ACTIVITY_VIDEOS} activity "
                "videos are allowed."
            )
        writing_files = render_file_uploader(
            "📝 Student Writing Sample(s)",
            f"group_{group_number}_writing",
            ["pdf", "png", "jpg", "jpeg"],
        )
        phonics_files = render_file_uploader(
            "🔤 Phonics / Phonetics Evidence(s)",
            f"group_{group_number}_phonics",
            [
                "mp4",
                "mov",
                "mp3",
                "wav",
                "png",
                "jpg",
                "jpeg",
                "pdf",
            ],
        )
        portfolio_files = render_file_uploader(
            "📁 Teacher Portfolio Evidence(s)",
            f"group_{group_number}_portfolio",
            [
                "pdf",
                "png",
                "jpg",
                "jpeg",
                "mp4",
            ],
        )
        groups.append(
            {
                "group_number": group_number,
                "grade": grade,
                "subject": subject,
                "evidence_type": evidence_type,
                "lesson": lesson.strip(),
                "voice": voice_files or [],
                "pictures": picture_files or [],
                "videos": video_files or [],
                "writing": writing_files or [],
                "phonics": phonics_files or [],
                "portfolio": portfolio_files or [],
            }
        )
# ============================================================
# ADD / REMOVE GROUP
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
            use_container_width=True,
        ):
            st.session_state.evidence_group_count += 1
            st.rerun()
with button_col2:
    if st.session_state.evidence_group_count > 1:
        if st.button(
            "➖ Remove Last Evidence Group",
            use_container_width=True,
        ):
            last_group = (
                st.session_state.evidence_group_count
            )
            # Remove widget state for the deleted group.
            prefixes = [
                f"group_{last_group}_grade",
                f"group_{last_group}_subject",
                f"group_{last_group}_type",
                f"group_{last_group}_lesson",
                f"group_{last_group}_voice",
                f"group_{last_group}_pictures",
                f"group_{last_group}_videos",
                f"group_{last_group}_writing",
                f"group_{last_group}_phonics",
                f"group_{last_group}_portfolio",
            ]
            for key in prefixes:
                if key in st.session_state:
                    del st.session_state[key]
            st.session_state.evidence_group_count -= 1
            st.rerun()
# ============================================================
# FILE SUMMARY
# ============================================================
total_files = sum(
    len(group["voice"])
    + len(group["pictures"])
    + len(group["videos"])
    + len(group["writing"])
    + len(group["phonics"])
    + len(group["portfolio"])
    for group in groups
)
total_size = sum(
    get_file_size(file)
    for group in groups
    for category in [
        "voice",
        "pictures",
        "videos",
        "writing",
        "phonics",
        "portfolio",
    ]
    for file in group[category]
)
if total_files:
    st.info(
        f"📦 {total_files} file(s) selected "
        f"• {format_bytes(total_size)} total"
    )
# ============================================================
# SUPABASE DUPLICATE CHECK
# ============================================================
def check_duplicate_submission(
    fingerprint
):
    try:
        response = (
            supabase
            .table("teacher_submissions")
            .select(
                "Submission_ID,Submission_Status,"
                "Submitted_At"
            )
            .eq(
                "Submission_Fingerprint",
                fingerprint
            )
            .limit(1)
            .execute()
        )
        return response.data or []
    except Exception as exc:
        raise RuntimeError(
            f"Could not check duplicate submission: {exc}"
        )
# ============================================================
# R2 PROGRESS CALLBACK
# ============================================================
class UploadProgress:
    """
    Thread-safe progress reporter.
    boto3 invokes the callback from its upload thread.
    The callback only places progress information into a Queue.
    The Streamlit main thread consumes that queue and updates UI.
    """
    def __init__(
        self,
        file_id,
        file_name,
        total_size,
        progress_queue,
    ):
        self.file_id = file_id
        self.file_name = file_name
        self.total_size = total_size
        self.progress_queue = progress_queue
        self.transferred = 0
    def __call__(self, bytes_amount):
        self.transferred += bytes_amount
        percentage = 0
        if self.total_size > 0:
            percentage = min(
                100,
                int(
                    self.transferred
                    / self.total_size
                    * 100
                )
            )
        self.progress_queue.put(
            {
                "type": "progress",
                "file_id": self.file_id,
                "file_name": self.file_name,
                "transferred": self.transferred,
                "total": self.total_size,
                "percentage": percentage,
            }
        )
# ============================================================
# R2 UPLOAD WORKER
# ============================================================
def upload_single_file(
    uploaded_file,
    r2_path,
    group_number,
    category,
    progress_queue,
):
    file_id = uuid.uuid4().hex[:10]
    file_name = uploaded_file.name
    file_size = get_file_size(uploaded_file)
    mime_type = get_mime_type(file_name)
    try:
        uploaded_file.seek(0)
        callback = UploadProgress(
            file_id=file_id,
            file_name=file_name,
            total_size=file_size,
            progress_queue=progress_queue,
        )
        r2_client.upload_fileobj(
            Fileobj=uploaded_file,
            Bucket=R2_BUCKET_NAME,
            Key=r2_path,
            ExtraArgs={
                "ContentType": mime_type
            },
            Config=r2_transfer_config,
            Callback=callback,
        )
        progress_queue.put(
            {
                "type": "completed",
                "file_id": file_id,
                "file_name": file_name,
                "transferred": file_size,
                "total": file_size,
                "percentage": 100,
                "group_number": group_number,
                "category": category,
                "path": r2_path,
            }
        )
        return {
            "success": True,
            "file_id": file_id,
            "file_name": file_name,
            "category": category,
            "group_number": group_number,
            "path": r2_path,
            "size": file_size,
        }
    except Exception as exc:
        progress_queue.put(
            {
                "type": "failed",
                "file_id": file_id,
                "file_name": file_name,
                "error": str(exc),
            }
        )
        return {
            "success": False,
            "file_id": file_id,
            "file_name": file_name,
            "category": category,
            "group_number": group_number,
            "path": r2_path,
            "error": str(exc),
            "size": file_size,
        }
# ============================================================
# FILE JOB CREATION
# ============================================================
def build_upload_jobs(
    groups,
    school_name,
    teacher_name,
    submission_date,
    submission_id,
):
    base_path = (
        f"schools/"
        f"{clean_name(school_name)}/"
        f"teachers/"
        f"{clean_name(teacher_name)}/"
        f"{submission_date.isoformat()}/"
        f"submission_{submission_id}"
    )
    jobs = []
    category_folders = {
        "voice": "voice_notes",
        "pictures": "pictures",
        "videos": "videos",
        "writing": "writing_samples",
        "phonics": "phonics_evidences",
        "portfolio": "portfolio_evidences",
    }
    for group in groups:
        group_number = group["group_number"]
        for category, folder in category_folders.items():
            for uploaded_file in group[category]:
                safe_file_name = clean_name(
                    uploaded_file.name
                )
                unique_file_name = (
                    f"{uuid.uuid4().hex[:8]}_"
                    f"{safe_file_name}"
                )
                r2_path = (
                    f"{base_path}/"
                    f"evidence_{group_number}/"
                    f"{folder}/"
                    f"{unique_file_name}"
                )
                jobs.append(
                    {
                        "uploaded_file": uploaded_file,
                        "r2_path": r2_path,
                        "group_number": group_number,
                        "category": category,
                    }
                )
    return jobs
# ============================================================
# DELETE R2 OBJECTS
# ============================================================
def delete_r2_objects(paths):
    for path in paths:
        try:
            r2_client.delete_object(
                Bucket=R2_BUCKET_NAME,
                Key=path,
            )
        except Exception:
            pass
# ============================================================
# DATABASE INSERT HELPERS
# ============================================================
def create_submission_record(
    submission_id,
    fingerprint,
    state,
    consultant,
    school,
    teacher,
    submission_date,
    group_count,
    file_count,
):
    teacher_parts = teacher.strip().split()
    first_name = (
        teacher_parts[0]
        if teacher_parts
        else ""
    )
    last_name = (
        " ".join(teacher_parts[1:])
        if len(teacher_parts) > 1
        else ""
    )
    data = {
        "Submission_ID": submission_id,
        "Submission_Fingerprint": fingerprint,
        "State_Zone": state,
        "Uploaded_By": consultant,
        "Institution": school,
        "Center": school,
        "FirstName": first_name,
        "LastName": last_name,
        "FullName": teacher,
        "Role": "teacher",
        "Submission_Date": submission_date.isoformat(),
        "Evidence_Group_Count": group_count,
        "File_Count": file_count,
        "Submission_Status": "uploading",
    }
    return (
        supabase
        .table("teacher_submissions")
        .insert(data)
        .execute()
    )
def mark_submission_completed(
    submission_id
):
    return (
        supabase
        .table("teacher_submissions")
        .update(
            {
                "Submission_Status": "completed",
                "Completed_At": datetime.utcnow().isoformat(),
            }
        )
        .eq(
            "Submission_ID",
            submission_id
        )
        .execute()
    )
def mark_submission_failed(
    submission_id,
    error_message,
):
    return (
        supabase
        .table("teacher_submissions")
        .update(
            {
                "Submission_Status": "failed",
                "Error_Message": str(
                    error_message
                )[:4000],
            }
        )
        .eq(
            "Submission_ID",
            submission_id
        )
        .execute()
    )
# ============================================================
# BUILD EVIDENCE LINKS
# ============================================================
def get_group_paths(
    upload_results,
    group_number,
    category,
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
# ============================================================
# INSERT EVIDENCE GROUP
# ============================================================
def insert_evidence_group(
    submission_id,
    group,
    upload_results,
):
    group_number = group["group_number"]
    voice_paths = get_group_paths(
        upload_results,
        group_number,
        "voice",
    )
    picture_paths = get_group_paths(
        upload_results,
        group_number,
        "pictures",
    )
    video_paths = get_group_paths(
        upload_results,
        group_number,
        "videos",
    )
    writing_paths = get_group_paths(
        upload_results,
        group_number,
        "writing",
    )
    phonics_paths = get_group_paths(
        upload_results,
        group_number,
        "phonics",
    )
    portfolio_paths = get_group_paths(
        upload_results,
        group_number,
        "portfolio",
    )
    evidence_id = uuid.uuid4().hex[:12]
    evidence_data = {
        "Evidence_ID": evidence_id,
        "Submission_ID": submission_id,
        "Evidence_Group": group_number,
        "Grade": group["grade"],
        "Subject": group["subject"],
        "Chapter_Lesson": group["lesson"],
        "Evidence_Type": group["evidence_type"],
        "Voice_Note_Links": (
            ",".join(voice_paths)
            if voice_paths
            else None
        ),
        "Lesson_Plan_Picture_Links": (
            ",".join(picture_paths)
            if picture_paths
            else None
        ),
        "Video_Evidence_1": (
            video_paths[0]
            if len(video_paths) > 0
            else None
        ),
        "Video_Evidence_2": (
            video_paths[1]
            if len(video_paths) > 1
            else None
        ),
        "Video_Evidence_3": (
            video_paths[2]
            if len(video_paths) > 2
            else None
        ),
        "Activity_Video_Links": (
            ",".join(video_paths)
            if video_paths
            else None
        ),
        "Writing_Sample_Links": (
            ",".join(writing_paths)
            if writing_paths
            else None
        ),
        "Phonics_Evidence_Links": (
            ",".join(phonics_paths)
            if phonics_paths
            else None
        ),
        "Portfolio_Evidence_Links": (
            ",".join(portfolio_paths)
            if portfolio_paths
            else None
        ),
    }
    return (
        supabase
        .table("teacher_evidence")
        .insert(evidence_data)
        .execute()
    )
# ============================================================
# INSERT LEGACY TEACHER_RECORDS ROW
# ============================================================
def insert_legacy_teacher_record(
    state,
    consultant,
    school,
    teacher,
    group,
    upload_results,
    submission_id,
    fingerprint,
):
    group_number = group["group_number"]
    voice_paths = get_group_paths(
        upload_results,
        group_number,
        "voice",
    )
    picture_paths = get_group_paths(
        upload_results,
        group_number,
        "pictures",
    )
    video_paths = get_group_paths(
        upload_results,
        group_number,
        "videos",
    )
    writing_paths = get_group_paths(
        upload_results,
        group_number,
        "writing",
    )
    phonics_paths = get_group_paths(
        upload_results,
        group_number,
        "phonics",
    )
    portfolio_paths = get_group_paths(
        upload_results,
        group_number,
        "portfolio",
    )
    teacher_parts = teacher.strip().split()
    first_name = (
        teacher_parts[0]
        if teacher_parts
        else ""
    )
    last_name = (
        " ".join(teacher_parts[1:])
        if len(teacher_parts) > 1
        else ""
    )
    data = {
        "State_Zone": state,
        "Uploaded_By": consultant,
        "Institution": school,
        "Center": school,
        "FirstName": first_name,
        "LastName": last_name,
        "FullName": teacher,
        "Role": "teacher",
        "Type": "lessonDelivery",
        "Grade": group["grade"],
        "Subject": group["subject"],
        # Kept in Book for backwards compatibility
        "Book": group["lesson"],
        # Existing application fields retained
        "StartTime": (
            f"{submission_date.isoformat()}T09:00:00"
        ),
        "EndTime": (
            f"{submission_date.isoformat()}T09:45:00"
        ),
        "Duration_Min": 0.0,
        "Voice_Note_Link": (
            ",".join(voice_paths)
            if voice_paths
            else None
        ),
        "Lesson_Plan_Picture": (
            ",".join(picture_paths)
            if picture_paths
            else None
        ),
        "Video_Evidence_1": (
            video_paths[0]
            if len(video_paths) > 0
            else None
        ),
        "Video_Evidence_2": (
            video_paths[1]
            if len(video_paths) > 1
            else None
        ),
        "Video_Evidence_3": (
            video_paths[2]
            if len(video_paths) > 2
            else None
        ),
        "Writing_Sample_Link": (
            ",".join(writing_paths)
            if writing_paths
            else None
        ),
        "Phonics_Evidence_Link": (
            ",".join(phonics_paths)
            if phonics_paths
            else None
        ),
        "Portfolio_Evidence_Link": (
            ",".join(portfolio_paths)
            if portfolio_paths
            else None
        ),
        "Assessment_Score_Pct": None,
        # New tracking fields
        "Submission_ID": submission_id,
        "Evidence_Group": group_number,
        "Evidence_Type": group["evidence_type"],
        "Activity_Video_Links": (
            ",".join(video_paths)
            if video_paths
            else None
        ),
        "Submission_Fingerprint": fingerprint,
        "Submission_Status": "completed",
        "Submitted_At": datetime.utcnow().isoformat(),
    }
    return (
        supabase
        .table("teacher_records")
        .insert(data)
        .execute()
    )
# ============================================================
# VALIDATION
# ============================================================
def validate_groups(groups):
    errors = []
    for group in groups:
        group_number = group["group_number"]
        if not group["lesson"]:
            errors.append(
                f"Evidence Group {group_number}: "
                "Chapter / Lesson / Activity Name is required."
            )
        if len(group["videos"]) > MAX_ACTIVITY_VIDEOS:
            errors.append(
                f"Evidence Group {group_number}: "
                f"maximum {MAX_ACTIVITY_VIDEOS} "
                "activity videos are allowed."
            )
        for category in [
            "voice",
            "pictures",
            "videos",
            "writing",
            "phonics",
            "portfolio",
        ]:
            for uploaded_file in group[category]:
                file_size = get_file_size(
                    uploaded_file
                )
                if file_size > MAX_FILE_SIZE_BYTES:
                    errors.append(
                        f"Evidence Group {group_number}: "
                        f"{uploaded_file.name} is "
                        f"{format_bytes(file_size)}. "
                        f"Maximum allowed is "
                        f"{MAX_FILE_SIZE_MB} MB."
                    )
    if total_files_from_groups(groups) == 0:
        errors.append(
            "Please upload at least one evidence file."
        )
    return errors
def total_files_from_groups(groups):
    return sum(
        len(group["voice"])
        + len(group["pictures"])
        + len(group["videos"])
        + len(group["writing"])
        + len(group["phonics"])
        + len(group["portfolio"])
        for group in groups
    )
# ============================================================
# SUBMISSION BUTTON
# ============================================================
st.divider()
submit_button = st.button(
    "🚀 Submit Evidence",
    type="primary",
    use_container_width=True,
    disabled=st.session_state.submission_in_progress,
)
# ============================================================
# SUBMISSION PROCESS
# ============================================================
if submit_button:
    st.session_state.submission_in_progress = True
    try:
        # ----------------------------------------------------
        # 1. VALIDATE
        # ----------------------------------------------------
        validation_errors = validate_groups(groups)
        if validation_errors:
            for error in validation_errors:
                st.error(error)
            st.session_state.submission_in_progress = False
            st.stop()
        # ----------------------------------------------------
        # 2. CREATE FINGERPRINT
        # ----------------------------------------------------
        fingerprint = calculate_fingerprint(
            teacher_name=selected_teacher,
            submission_date=submission_date,
            groups=groups,
        )
        # ----------------------------------------------------
        # 3. CHECK DUPLICATE BEFORE UPLOAD
        # ----------------------------------------------------
        with st.spinner(
            "Checking for duplicate submission..."
        ):
            existing = check_duplicate_submission(
                fingerprint
            )
        if existing:
            existing_submission = existing[0]
            existing_id = existing_submission.get(
                "Submission_ID"
            )
            existing_status = existing_submission.get(
                "Submission_Status"
            )
            st.error(
                "⚠️ Duplicate submission detected."
            )
            st.warning(
                f"This evidence has already been submitted "
                f"under Submission ID: `{existing_id}` "
                f"(Status: {existing_status})."
            )
            st.session_state.submission_in_progress = False
            st.stop()
        # ----------------------------------------------------
        # 4. CREATE SUBMISSION ID
        # ----------------------------------------------------
        submission_id = uuid.uuid4().hex[:12]
        # ----------------------------------------------------
        # 5. BUILD UPLOAD JOBS
        # ----------------------------------------------------
        jobs = build_upload_jobs(
            groups=groups,
            school_name=selected_school,
            teacher_name=selected_teacher,
            submission_date=submission_date,
            submission_id=submission_id,
        )
        # ----------------------------------------------------
        # 6. CREATE TRACKING RECORD
        # ----------------------------------------------------
        try:
            create_submission_record(
                submission_id=submission_id,
                fingerprint=fingerprint,
                state=selected_state,
                consultant=selected_consultant,
                school=selected_school,
                teacher=selected_teacher,
                submission_date=submission_date,
                group_count=len(groups),
                file_count=len(jobs),
            )
        except Exception as exc:
            # A unique constraint violation here means another
            # browser/session won the race and submitted the
            # exact same evidence first.
            error_text = str(exc).lower()
            if (
                "duplicate"
                in error_text
                or "unique"
                in error_text
                or "23505"
                in error_text
            ):
                st.error(
                    "⚠️ Duplicate submission detected. "
                    "The same evidence was submitted "
                    "from another session."
                )
                st.session_state.submission_in_progress = False
                st.stop()
            raise
        # ----------------------------------------------------
        # 7. PROGRESS UI
        # ----------------------------------------------------
        st.success(
            f"Submission created: `{submission_id}`"
        )
        st.subheader(
            "📤 Uploading Evidence"
        )
        overall_progress = st.progress(
            0,
            text="Preparing uploads..."
        )
        status_text = st.empty()
        progress_queue = Queue()
        progress_bars = {}
        progress_labels = {}
        for index, job in enumerate(jobs):
            file_id = f"pending_{index}"
            label = st.empty()
            progress_bar = st.progress(
                0,
                text=(
                    f"⏳ {job['uploaded_file'].name}"
                )
            )
            progress_labels[file_id] = label
            progress_bars[file_id] = progress_bar
        # ----------------------------------------------------
        # 8. PARALLEL R2 UPLOADS
        # ----------------------------------------------------
        upload_results = []
        completed_count = 0
        futures = {}
        with ThreadPoolExecutor(
            max_workers=MAX_PARALLEL_UPLOADS
        ) as executor:
            for index, job in enumerate(jobs):
                future = executor.submit(
                    upload_single_file,
                    uploaded_file=job["uploaded_file"],
                    r2_path=job["r2_path"],
                    group_number=job["group_number"],
                    category=job["category"],
                    progress_queue=progress_queue,
                )
                futures[future] = index
            while futures:
                # --------------------------------------------
                # Consume progress events
                # --------------------------------------------
                try:
                    event = progress_queue.get(
                        timeout=0.15
                    )
                    event_type = event.get(
                        "type"
                    )
                    if event_type == "progress":
                        file_id = event["file_id"]
                        # Find the corresponding visual slot.
                        # File IDs are assigned inside worker, so
                        # dynamically create a bar if necessary.
                        if file_id not in progress_bars:
                            progress_labels[file_id] = (
                                st.empty()
                            )
                            progress_bars[file_id] = (
                                st.progress(
                                    0,
                                    text=(
                                        f"⏳ "
                                        f"{event['file_name']}"
                                    )
                                )
                            )
                        percentage = event[
                            "percentage"
                        ]
                        progress_bars[file_id].progress(
                            percentage,
                            text=(
                                f"⬆️ "
                                f"{event['file_name']} "
                                f"— {percentage}% "
                                f"({format_bytes(event['transferred'])} / "
                                f"{format_bytes(event['total'])})"
                            )
                        )
                    elif event_type == "completed":
                        file_id = event["file_id"]
                        if file_id not in progress_bars:
                            progress_labels[file_id] = (
                                st.empty()
                            )
                            progress_bars[file_id] = (
                                st.progress(
                                    100,
                                    text=""
                                )
                            )
                        progress_bars[file_id].progress(
                            100,
                            text=(
                                f"✅ "
                                f"{event['file_name']} "
                                f"— 100%"
                            )
                        )
                    elif event_type == "failed":
                        file_id = event["file_id"]
                        if file_id not in progress_bars:
                            progress_labels[file_id] = (
                                st.empty()
                            )
                            progress_bars[file_id] = (
                                st.progress(
                                    0,
                                    text=""
                                )
                            )
                        progress_bars[file_id].progress(
                            0,
                            text=(
                                f"❌ "
                                f"{event['file_name']} "
                                f"— Upload failed"
                            )
                        )
                except Empty:
                    pass
                # --------------------------------------------
                # Check completed futures
                # --------------------------------------------
                completed_futures = []
                for future in futures:
                    if future.done():
                        completed_futures.append(
                            future
                        )
                for future in completed_futures:
                    index = futures.pop(
                        future
                    )
                    result = future.result()
                    upload_results.append(
                        result
                    )
                    completed_count += 1
                    overall_percentage = int(
                        completed_count
                        / len(jobs)
                        * 100
                    )
                    overall_progress.progress(
                        overall_percentage,
                        text=(
                            f"Overall upload progress: "
                            f"{completed_count}/{len(jobs)} "
                            f"files completed"
                        )
                    )
                time.sleep(0.05)
        # ----------------------------------------------------
        # 9. CHECK UPLOAD RESULTS
        # ----------------------------------------------------
        failed_uploads = [
            result
            for result in upload_results
            if not result["success"]
        ]
        successful_paths = [
            result["path"]
            for result in upload_results
            if result["success"]
        ]
        if failed_uploads:
            failure_messages = "\n".join(
                f"- {result['file_name']}: "
                f"{result.get('error', 'Unknown error')}"
                for result in failed_uploads
            )
            # Delete successfully uploaded files so a failed
            # submission does not leave orphaned R2 objects.
            delete_r2_objects(
                successful_paths
            )
            mark_submission_failed(
                submission_id,
                failure_messages,
            )
            st.error(
                "❌ Submission failed. "
                "Successfully uploaded files have been "
                "removed from storage."
            )
            st.code(
                failure_messages
            )
            st.session_state.submission_in_progress = False
            st.stop()
        overall_progress.progress(
            100,
            text=(
                f"✅ All {len(jobs)} files uploaded successfully"
            )
        )
        # ----------------------------------------------------
        # 10. SAVE EVIDENCE GROUPS
        # ----------------------------------------------------
        status_text.info(
            "Saving evidence records to Supabase..."
        )
        try:
            for group in groups:
                # New dedicated evidence table
                insert_evidence_group(
                    submission_id=submission_id,
                    group=group,
                    upload_results=upload_results,
                )
                # Existing teacher_records table for
                # dashboard compatibility
                insert_legacy_teacher_record(
                    state=selected_state,
                    consultant=selected_consultant,
                    school=selected_school,
                    teacher=selected_teacher,
                    group=group,
                    upload_results=upload_results,
                    submission_id=submission_id,
                    fingerprint=fingerprint,
                )
        except Exception as exc:
            # If database save fails after R2 upload,
            # clean up R2 files and mark submission failed.
            delete_r2_objects(
                successful_paths
            )
            mark_submission_failed(
                submission_id,
                str(exc),
            )
            st.error(
                "❌ Evidence was uploaded but the "
                "database save failed."
            )
            st.exception(exc)
            st.session_state.submission_in_progress = False
            st.stop()
        # ----------------------------------------------------
        # 11. MARK SUBMISSION COMPLETED
        # ----------------------------------------------------
        mark_submission_completed(
            submission_id
        )
        # ----------------------------------------------------
        # 12. FINAL SUCCESS
        # ----------------------------------------------------
        status_text.empty()
        st.balloons()
        st.success(
            "🎉 Evidence submitted successfully!"
        )
        st.markdown(
            f"""
            ### Submission Details
            **Submission ID:** `{submission_id}`
            **Teacher:** {selected_teacher}
            **School:** {selected_school}
            **Evidence Groups:** {len(groups)}
            **Files Uploaded:** {len(jobs)}
            **Status:** ✅ Completed
            """
        )
        st.info(
            "Please keep the Submission ID for reference."
        )
        # Clear uploader/group state after successful submission.
        for group_number in range(
            1,
            st.session_state.evidence_group_count + 1
        ):
            for key in [
                f"group_{group_number}_lesson",
                f"group_{group_number}_voice",
                f"group_{group_number}_pictures",
                f"group_{group_number}_videos",
                f"group_{group_number}_writing",
                f"group_{group_number}_phonics",
                f"group_{group_number}_portfolio",
            ]:
                if key in st.session_state:
                    del st.session_state[key]
        st.session_state.evidence_group_count = 1
    except Exception as exc:
        st.error(
            "❌ An unexpected error occurred."
        )
        st.exception(exc)
    finally:
        st.session_state.submission_in_progress = False
