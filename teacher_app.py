import streamlit as st
import pandas as pd
import re
import uuid
import hashlib
import mimetypes
from datetime import datetime, date
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
from queue import Queue, Empty
from threading import Lock

import boto3
from boto3.s3.transfer import TransferConfig
from supabase import create_client


# ============================================================
# PAGE CONFIG
# ============================================================

st.set_page_config(
    page_title="Teacher Evidence Submission Portal",
    page_icon="📝",
    layout="centered",
    initial_sidebar_state="collapsed",
)


# ============================================================
# CONSTANTS
# ============================================================

MAX_FILE_SIZE_MB = 50
MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024

# Number of files uploaded simultaneously
MAX_PARALLEL_UPLOADS = 5

# R2 multipart settings
R2_MULTIPART_THRESHOLD = 8 * 1024 * 1024
R2_MULTIPART_CHUNK_SIZE = 8 * 1024 * 1024

# Maximum implementation cards
MAX_IMPLEMENTATION_ITEMS = 15

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

EVIDENCE_TYPES = [
    "📚 Lesson Plan",
    "🎯 Classroom Activity / Implementation",
    "📝 Student Writing",
    "🔤 Phonics / Phonetics",
    "📁 Teacher Portfolio",
    "📊 Assessment",
    "📎 Other Evidence",
]

EVIDENCE_TYPE_KEYS = {
    "📚 Lesson Plan": "lesson_plan",
    "🎯 Classroom Activity / Implementation": "classroom_activity",
    "📝 Student Writing": "student_writing",
    "🔤 Phonics / Phonetics": "phonics_phonetics",
    "📁 Teacher Portfolio": "teacher_portfolio",
    "📊 Assessment": "assessment",
    "📎 Other Evidence": "other_evidence",
}


# ============================================================
# SESSION STATE
# ============================================================

# IMPORTANT:
# Start directly with Implementation 1.
if "implementation_items" not in st.session_state:
    st.session_state.implementation_items = [1]

if "submission_in_progress" not in st.session_state:
    st.session_state.submission_in_progress = False


# ============================================================
# SECRETS
# ============================================================

def get_secret(section, key):
    try:
        return st.secrets[section][key]
    except Exception:
        return None


SUPABASE_URL = get_secret("supabase", "url")
SUPABASE_KEY = get_secret("supabase", "key")

R2_ACCOUNT_ID = get_secret("r2", "R2_ACCOUNT_ID")
R2_ACCESS_KEY_ID = get_secret("r2", "R2_ACCESS_KEY_ID")
R2_SECRET_ACCESS_KEY = get_secret("r2", "R2_SECRET_ACCESS_KEY")
R2_BUCKET_NAME = get_secret("r2", "R2_BUCKET_NAME")
R2_ENDPOINT_URL = get_secret("r2", "R2_ENDPOINT_URL")


# ============================================================
# VALIDATE CONFIGURATION
# ============================================================

missing = []

if not SUPABASE_URL:
    missing.append("supabase.url")

if not SUPABASE_KEY:
    missing.append("supabase.key")

if not R2_ACCOUNT_ID:
    missing.append("r2.R2_ACCOUNT_ID")

if not R2_ACCESS_KEY_ID:
    missing.append("r2.R2_ACCESS_KEY_ID")

if not R2_SECRET_ACCESS_KEY:
    missing.append("r2.R2_SECRET_ACCESS_KEY")

if not R2_BUCKET_NAME:
    missing.append("r2.R2_BUCKET_NAME")

if not R2_ENDPOINT_URL:
    missing.append("r2.R2_ENDPOINT_URL")


if missing:
    st.error(
        "Configuration missing from Streamlit secrets:\n\n"
        + "\n".join(f"- `{x}`" for x in missing)
    )
    st.stop()


# ============================================================
# CLIENTS
# ============================================================

@st.cache_resource
def get_supabase_client():
    return create_client(
        SUPABASE_URL,
        SUPABASE_KEY,
    )


@st.cache_resource
def get_r2_client():
    return boto3.client(
        "s3",
        endpoint_url=R2_ENDPOINT_URL,
        aws_access_key_id=R2_ACCESS_KEY_ID,
        aws_secret_access_key=R2_SECRET_ACCESS_KEY,
        region_name="auto",
    )


supabase = get_supabase_client()
r2_client = get_r2_client()


# ============================================================
# R2 TRANSFER CONFIG
# ============================================================

R2_TRANSFER_CONFIG = TransferConfig(
    multipart_threshold=R2_MULTIPART_THRESHOLD,
    multipart_chunksize=R2_MULTIPART_CHUNK_SIZE,
    max_concurrency=MAX_PARALLEL_UPLOADS,
    use_threads=True,
)


# ============================================================
# TEXT / FILE HELPERS
# ============================================================

def clean_text(value):
    if value is None:
        return ""

    value = str(value).strip()

    if value.lower() in {
        "nan",
        "none",
        "null",
    }:
        return ""

    return value


def sanitize_path(value):
    """
    Make a safe R2 folder/file path component.
    """

    value = clean_text(value)

    value = re.sub(
        r"[^\w\s\-().&]+",
        "",
        value,
        flags=re.UNICODE,
    )

    value = re.sub(
        r"\s+",
        "_",
        value,
    )

    return value.strip("_") or "unknown"


def safe_filename(filename):
    """
    Keep original filename readable while removing unsafe characters.
    """

    filename = clean_text(filename)

    filename = re.sub(
        r"[^\w\s\-().]+",
        "",
        filename,
        flags=re.UNICODE,
    )

    filename = re.sub(
        r"\s+",
        "_",
        filename,
    )

    return filename[:180] or "file"


def format_bytes(num_bytes):

    if num_bytes < 1024:
        return f"{num_bytes} B"

    if num_bytes < 1024 * 1024:
        return f"{num_bytes / 1024:.1f} KB"

    if num_bytes < 1024 * 1024 * 1024:
        return f"{num_bytes / 1024 / 1024:.1f} MB"

    return f"{num_bytes / 1024 / 1024 / 1024:.2f} GB"


def get_content_type(filename):

    content_type, _ = mimetypes.guess_type(
        filename
    )

    return content_type or "application/octet-stream"


# ============================================================
# FILE VALIDATION
# ============================================================

def validate_files(files):

    errors = []

    for uploaded_file in files:

        size = uploaded_file.size

        if size > MAX_FILE_SIZE_BYTES:
            errors.append(
                f"{uploaded_file.name} is "
                f"{format_bytes(size)}. "
                f"Maximum allowed is "
                f"{MAX_FILE_SIZE_MB} MB."
            )

        if size <= 0:
            errors.append(
                f"{uploaded_file.name} appears to be empty."
            )

    return errors


# ============================================================
# FILE HASH
# ============================================================

def sha256_uploaded_file(uploaded_file):
    """
    Calculate SHA-256 without loading entire file into memory.
    """

    h = hashlib.sha256()

    uploaded_file.seek(0)

    while True:

        chunk = uploaded_file.read(
            1024 * 1024
        )

        if not chunk:
            break

        h.update(chunk)

    uploaded_file.seek(0)

    return h.hexdigest()


# ============================================================
# ROSTER
# ============================================================

@st.cache_data(ttl=300)
def load_roster():

    rows = []

    start = 0
    page_size = 1000

    while True:

        response = (
            supabase
            .table("teacher_records")
            .select(
                "State_Zone,Uploaded_By,"
                "Institution,FullName,Role"
            )
            .range(
                start,
                start + page_size - 1,
            )
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

    for col in [
        "State_Zone",
        "Uploaded_By",
        "Institution",
        "FullName",
        "Role",
    ]:

        if col not in df.columns:
            df[col] = ""

        df[col] = (
            df[col]
            .fillna("")
            .astype(str)
            .str.strip()
        )

    df = df[
        df["FullName"] != ""
    ]

    return df.drop_duplicates()


# ============================================================
# EVIDENCE FILE TYPES
# ============================================================

def allowed_types_for_evidence(
    evidence_type
):

    if evidence_type == "📚 Lesson Plan":

        return [
            "pdf",
            "doc",
            "docx",
            "jpg",
            "jpeg",
            "png",
            "webp",
            "mp3",
            "m4a",
            "wav",
            "aac",
            "mp4",
        ]

    if (
        evidence_type
        == "🎯 Classroom Activity / Implementation"
    ):

        return [
            "mp4",
            "mov",
            "m4v",
            "webm",
            "avi",
        ]

    if evidence_type == "📝 Student Writing":

        return [
            "jpg",
            "jpeg",
            "png",
            "webp",
            "pdf",
        ]

    if evidence_type == "🔤 Phonics / Phonetics":

        return [
            "mp3",
            "m4a",
            "wav",
            "aac",
            "mp4",
            "mov",
            "jpg",
            "jpeg",
            "png",
            "pdf",
        ]

    if evidence_type == "📁 Teacher Portfolio":

        return [
            "pdf",
            "jpg",
            "jpeg",
            "png",
            "webp",
            "mp4",
            "mov",
        ]

    if evidence_type == "📊 Assessment":

        return [
            "pdf",
            "jpg",
            "jpeg",
            "png",
            "webp",
            "mp4",
            "mov",
            "mp3",
            "m4a",
        ]

    return [
        "pdf",
        "doc",
        "docx",
        "jpg",
        "jpeg",
        "png",
        "webp",
        "mp3",
        "m4a",
        "wav",
        "mp4",
        "mov",
        "webm",
    ]


def extension_filter_text(
    extensions
):

    return ", ".join(
        f".{x}"
        for x in extensions
    )


# ============================================================
# UPLOAD PROGRESS CALLBACK
# ============================================================

class ProgressCallback:

    def __init__(
        self,
        file_id,
        total_bytes,
        progress_queue,
    ):

        self.file_id = file_id
        self.total_bytes = total_bytes
        self.progress_queue = progress_queue

        self.transferred = 0
        self.lock = Lock()

    def __call__(
        self,
        bytes_amount
    ):

        with self.lock:

            self.transferred += bytes_amount

            self.progress_queue.put(
                {
                    "file_id": self.file_id,
                    "transferred": self.transferred,
                    "total": self.total_bytes,
                }
            )


# ============================================================
# PARALLEL R2 UPLOAD
# ============================================================

def upload_files_parallel(
    upload_jobs,
    progress_placeholder,
):

    if not upload_jobs:
        return [], []

    progress_queue = Queue()

    total_bytes = sum(
        job["uploaded_file"].size
        for job in upload_jobs
    )

    total_files = len(upload_jobs)

    file_progress = {}

    for job in upload_jobs:

        file_id = str(uuid.uuid4())

        file_progress[file_id] = {
            "name": job["uploaded_file"].name,
            "total": job["uploaded_file"].size,
            "transferred": 0,
        }

        job["_progress_file_id"] = file_id

    completed_files = 0

    results = []

    uploaded_keys = []

    # --------------------------------------------------------
    # Worker
    # --------------------------------------------------------

    def worker(job):

        file_id = job[
            "_progress_file_id"
        ]

        callback = ProgressCallback(
            file_id=file_id,
            total_bytes=job[
                "uploaded_file"
            ].size,
            progress_queue=progress_queue,
        )

        uploaded_file = job[
            "uploaded_file"
        ]

        uploaded_file.seek(0)

        r2_client.upload_fileobj(
            Fileobj=uploaded_file,
            Bucket=R2_BUCKET_NAME,
            Key=job["r2_key"],
            ExtraArgs={
                "ContentType": get_content_type(
                    uploaded_file.name
                ),
            },
            Config=R2_TRANSFER_CONFIG,
            Callback=callback,
        )

        return {
            "file_id": file_id,
            "r2_key": job["r2_key"],
            "filename": uploaded_file.name,
            "size": uploaded_file.size,
            "evidence_number": job[
                "evidence_number"
            ],
        }

    # --------------------------------------------------------
    # Execute parallel uploads
    # --------------------------------------------------------

    futures = {}

    with ThreadPoolExecutor(
        max_workers=MAX_PARALLEL_UPLOADS
    ) as executor:

        for job in upload_jobs:

            future = executor.submit(
                worker,
                job,
            )

            futures[future] = job

        pending = set(
            futures.keys()
        )

        while pending:

            # Drain progress queue
            while True:

                try:

                    event = (
                        progress_queue
                        .get_nowait()
                    )

                    fid = event[
                        "file_id"
                    ]

                    if fid in file_progress:

                        file_progress[
                            fid
                        ]["transferred"] = min(
                            event["transferred"],
                            event["total"],
                        )

                except Empty:

                    break

            done, pending = wait(
                pending,
                timeout=0.20,
                return_when=FIRST_COMPLETED,
            )

            for future in done:

                result = future.result()

                results.append(result)

                uploaded_keys.append(
                    result["r2_key"]
                )

                completed_files += 1

                fid = result[
                    "file_id"
                ]

                if fid in file_progress:

                    file_progress[
                        fid
                    ]["transferred"] = (
                        file_progress[
                            fid
                        ]["total"]
                    )

            current_bytes = sum(
                item["transferred"]
                for item in file_progress.values()
            )

            overall_progress = (
                current_bytes / total_bytes
                if total_bytes > 0
                else 0
            )

            overall_progress = max(
                0,
                min(
                    1,
                    overall_progress,
                ),
            )

            # ------------------------------------------------
            # Progress UI
            # ------------------------------------------------

            with progress_placeholder.container():

                st.markdown(
                    f"### ⬆️ Uploading "
                    f"{total_files} file(s)"
                )

                st.progress(
                    overall_progress,
                    text=(
                        f"Overall: "
                        f"{overall_progress * 100:.0f}%"
                    ),
                )

                st.caption(
                    f"{completed_files}/"
                    f"{total_files} "
                    f"files completed"
                )

                for (
                    fid,
                    info,
                ) in file_progress.items():

                    file_percent = (
                        info["transferred"]
                        / info["total"]
                        if info["total"] > 0
                        else 0
                    )

                    file_percent = max(
                        0,
                        min(
                            1,
                            file_percent,
                        ),
                    )

                    st.progress(
                        file_percent,
                        text=(
                            f"{info['name']} — "
                            f"{file_percent * 100:.0f}% "
                            f"("
                            f"{format_bytes(info['transferred'])}"
                            f" / "
                            f"{format_bytes(info['total'])}"
                            f")"
                        ),
                    )

    # --------------------------------------------------------
    # Final progress
    # --------------------------------------------------------

    while True:

        try:

            event = (
                progress_queue
                .get_nowait()
            )

            fid = event["file_id"]

            if fid in file_progress:

                file_progress[
                    fid
                ]["transferred"] = min(
                    event["transferred"],
                    event["total"],
                )

        except Empty:

            break

    with progress_placeholder.container():

        st.markdown(
            "### ⬆️ Upload complete"
        )

        st.progress(
            1.0,
            text="All files uploaded successfully",
        )

        for info in file_progress.values():

            st.progress(
                1.0,
                text=(
                    f"{info['name']} — 100% "
                    f"("
                    f"{format_bytes(info['total'])}"
                    f")"
                ),
            )

    return (
        results,
        uploaded_keys,
    )


# ============================================================
# R2 CLEANUP
# ============================================================

def delete_r2_keys(keys):

    if not keys:
        return

    for key in keys:

        try:

            r2_client.delete_object(
                Bucket=R2_BUCKET_NAME,
                Key=key,
            )

        except Exception:
            pass


# ============================================================
# INSERT TEACHER RECORD
# ============================================================

def insert_teacher_record(
    teacher_info,
    submission_date,
    evidence_number,
    evidence,
    uploaded_results,
):
    """
    Stores one implementation/evidence item
    as one row in teacher_records.

    No teacher_submissions table.
    No teacher_evidence table.
    """

    key_map = {
        "lesson_plan": [],
        "classroom_activity": [],
        "student_writing": [],
        "phonics_phonetics": [],
        "teacher_portfolio": [],
        "assessment": [],
        "other_evidence": [],
    }

    evidence_key = EVIDENCE_TYPE_KEYS[
        evidence["evidence_type"]
    ]

    for result in uploaded_results:

        key_map[
            evidence_key
        ].append(
            result["r2_key"]
        )

    video_keys = key_map[
        "classroom_activity"
    ]

    row = {
        # ----------------------------------------------------
        # Teacher information
        # ----------------------------------------------------

        "State_Zone": teacher_info[
            "State_Zone"
        ],

        "Uploaded_By": teacher_info[
            "Uploaded_By"
        ],

        "Institution": teacher_info[
            "Institution"
        ],

        "Center": teacher_info[
            "Institution"
        ],

        "FirstName": (
            teacher_info["FullName"]
            .split(" ")[0]
            if teacher_info["FullName"]
            else ""
        ),

        "LastName": (
            " ".join(
                teacher_info[
                    "FullName"
                ].split(" ")[1:]
            )
            if len(
                teacher_info[
                    "FullName"
                ].split()
            ) > 1
            else ""
        ),

        "FullName": teacher_info[
            "FullName"
        ],

        "Role": (
            teacher_info["Role"]
            or "teacher"
        ),

        # ----------------------------------------------------
        # Existing compatibility fields
        # ----------------------------------------------------

        "Type": "Teacher Evidence",

        "Grade": evidence[
            "grade"
        ],

        "Subject": evidence[
            "subject"
        ],

        "Book": evidence[
            "chapter_lesson"
        ],

        # These remain for compatibility
        "StartTime": "09:00",

        "EndTime": "09:45",

        "Duration_Min": 0.0,

        # ----------------------------------------------------
        # R2 object keys
        # ----------------------------------------------------

        "Voice_Note_Link": "",

        "Lesson_Plan_Picture": (
            ",".join(
                key_map[
                    "lesson_plan"
                ]
            )
        ),

        "Video_Evidence_1": (
            video_keys[0]
            if len(video_keys) >= 1
            else ""
        ),

        "Video_Evidence_2": (
            video_keys[1]
            if len(video_keys) >= 2
            else ""
        ),

        "Video_Evidence_3": (
            video_keys[2]
            if len(video_keys) >= 3
            else ""
        ),

        "Writing_Sample_Link": (
            ",".join(
                key_map[
                    "student_writing"
                ]
            )
        ),

        "Phonics_Evidence_Link": (
            ",".join(
                key_map[
                    "phonics_phonetics"
                ]
            )
        ),

        "Portfolio_Evidence_Link": (
            ",".join(
                key_map[
                    "teacher_portfolio"
                ]
            )
        ),

        "Activity_Video_Links": (
            ",".join(
                video_keys
            )
        ),

        # ----------------------------------------------------
        # Implementation information
        # ----------------------------------------------------

        "Evidence_Group": evidence_number,

        "Evidence_Type": evidence[
            "evidence_type"
        ],

        # ----------------------------------------------------
        # Submission date
        # ----------------------------------------------------

        "Submission_Date": str(
            submission_date
        ),

        # ----------------------------------------------------
        # Timestamp
        # ----------------------------------------------------

        "Submitted_At": datetime.utcnow().isoformat(),
    }

    response = (
        supabase
        .table("teacher_records")
        .insert(row)
        .execute()
    )

    return (
        response.data[0]
        if response.data
        else row
    )


# ============================================================
# RENDER IMPLEMENTATION CARD
# ============================================================

def render_implementation_card(
    number
):

    st.markdown(
        f"### 📌 Implementation {number}"
    )

    col1, col2 = st.columns(2)

    with col1:

        grade = st.selectbox(
            "Grade / Class",
            GRADE_OPTIONS,
            key=f"grade_{number}",
        )

    with col2:

        subject = st.selectbox(
            "Subject",
            SUBJECT_OPTIONS,
            key=f"subject_{number}",
        )

    chapter_lesson = st.text_input(
        "Chapter / Lesson",
        placeholder=(
            "Example: Plants – Chapter 4"
        ),
        key=f"chapter_{number}",
    )

    evidence_type = st.selectbox(
        "What are you submitting?",
        EVIDENCE_TYPES,
        key=f"evidence_type_{number}",
    )

    extensions = (
        allowed_types_for_evidence(
            evidence_type
        )
    )

    st.caption(
        f"Upload: "
        f"{extension_filter_text(extensions)} "
        f"• Maximum "
        f"{MAX_FILE_SIZE_MB} MB per file"
    )

    files = st.file_uploader(
        "Upload evidence",
        type=extensions,
        accept_multiple_files=True,
        key=f"files_{number}",
        help=(
            "You can upload multiple files. "
            f"Each file can be up to "
            f"{MAX_FILE_SIZE_MB} MB."
        ),
    )

    if files:

        total_size = sum(
            f.size
            for f in files
        )

        st.caption(
            f"📎 {len(files)} file(s) selected "
            f"• {format_bytes(total_size)}"
        )

        for f in files:

            st.caption(
                f"• {f.name} — "
                f"{format_bytes(f.size)}"
            )

    return {
        "number": number,
        "grade": grade,
        "subject": subject,
        "chapter_lesson": (
            chapter_lesson.strip()
        ),
        "evidence_type": evidence_type,
        "files": files or [],
    }


# ============================================================
# PAGE HEADER
# ============================================================

st.title(
    "📝 Teacher Evidence Submission Portal"
)

st.caption(
    "Submit your lesson planning and "
    "classroom evidence in one simple submission."
)

st.divider()


# ============================================================
# TEACHER DETAILS
# ============================================================

st.subheader(
    "👩‍🏫 Teacher Details"
)

roster = load_roster()

if roster.empty:

    st.error(
        "No teacher roster data was found "
        "in `teacher_records`."
    )

    st.stop()


# ------------------------------------------------------------
# State / Zone
# ------------------------------------------------------------

state_options = sorted(
    [
        x
        for x in roster[
            "State_Zone"
        ].unique()
        if clean_text(x)
    ]
)

selected_state = st.selectbox(
    "State / Zone",
    state_options,
)


state_df = roster[
    roster["State_Zone"]
    == selected_state
].copy()


# ------------------------------------------------------------
# Consultant
# ------------------------------------------------------------

consultant_options = sorted(
    [
        x
        for x in state_df[
            "Uploaded_By"
        ].unique()
        if clean_text(x)
    ]
)

if not consultant_options:

    st.warning(
        "No consultant is available "
        "for this State / Zone."
    )

    st.stop()


selected_consultant = st.selectbox(
    "Consultant",
    consultant_options,
)


consultant_df = state_df[
    state_df["Uploaded_By"]
    == selected_consultant
].copy()


# ------------------------------------------------------------
# School
# ------------------------------------------------------------

school_options = sorted(
    [
        x
        for x in consultant_df[
            "Institution"
        ].unique()
        if clean_text(x)
    ]
)

if not school_options:

    st.warning(
        "No school is available "
        "for this consultant."
    )

    st.stop()


selected_school = st.selectbox(
    "School",
    school_options,
)


school_df = consultant_df[
    consultant_df["Institution"]
    == selected_school
].copy()


# ------------------------------------------------------------
# Teacher
# ------------------------------------------------------------

teacher_options = sorted(
    [
        x
        for x in school_df[
            "FullName"
        ].unique()
        if clean_text(x)
    ]
)

if not teacher_options:

    st.warning(
        "No teacher is available "
        "for this school."
    )

    st.stop()


selected_teacher = st.selectbox(
    "Teacher",
    teacher_options,
)


teacher_rows = school_df[
    school_df["FullName"]
    == selected_teacher
]


teacher_row = (
    teacher_rows.iloc[0].to_dict()
    if not teacher_rows.empty
    else {}
)


# ============================================================
# SUBMISSION DATE
# ============================================================

st.divider()

st.subheader(
    "📅 Submission Date"
)

submission_date = st.date_input(
    "Date",
    value=date.today(),
    max_value=date.today(),
)


# ============================================================
# IMPLEMENTATIONS
# ============================================================

st.divider()

st.subheader(
    "📚 Implementations"
)

st.caption(
    "Add each lesson, classroom activity, "
    "or other evidence separately. "
    "For each implementation, select what "
    "you are submitting and upload the evidence."
)


implementation_data = []


for number in (
    st.session_state
    .implementation_items
):

    implementation = (
        render_implementation_card(
            number
        )
    )

    implementation_data.append(
        implementation
    )

    if (
        number
        != st.session_state
        .implementation_items[-1]
    ):

        st.divider()


# ============================================================
# ADD ANOTHER IMPLEMENTATION
# ============================================================

if (
    len(
        st.session_state
        .implementation_items
    )
    < MAX_IMPLEMENTATION_ITEMS
):

    if st.button(
        "➕ Add Another Implementation",
        use_container_width=True,
    ):

        next_number = (
            max(
                st.session_state
                .implementation_items
            )
            + 1
        )

        st.session_state \
            .implementation_items \
            .append(
                next_number
            )

        st.rerun()


# ============================================================
# REMOVE LAST IMPLEMENTATION
# ============================================================

if (
    len(
        st.session_state
        .implementation_items
    )
    > 1
):

    if st.button(
        "➖ Remove Last Implementation",
        use_container_width=True,
    ):

        removed = (
            st.session_state
            .implementation_items
            .pop()
        )

        keys_to_remove = [
            f"grade_{removed}",
            f"subject_{removed}",
            f"chapter_{removed}",
            f"evidence_type_{removed}",
            f"files_{removed}",
        ]

        for key in keys_to_remove:

            st.session_state.pop(
                key,
                None,
            )

        st.rerun()


# ============================================================
# SUBMISSION SUMMARY
# ============================================================

st.divider()

total_files = sum(
    len(item["files"])
    for item in implementation_data
)

total_size = sum(
    f.size
    for item in implementation_data
    for f in item["files"]
)


st.markdown(
    "### 📋 Submission Summary"
)


summary_col1, summary_col2 = (
    st.columns(2)
)


with summary_col1:

    st.metric(
        "Implementations",
        len(implementation_data),
    )


with summary_col2:

    st.metric(
        "Files",
        total_files,
    )


if total_files:

    st.caption(
        f"Total upload size: "
        f"{format_bytes(total_size)}"
    )


# ============================================================
# SUBMIT
# ============================================================

st.divider()

submit = st.button(
    "🚀 Submit Evidence",
    type="primary",
    use_container_width=True,
    disabled=(
        st.session_state
        .submission_in_progress
    ),
)


if submit:

    st.session_state \
        .submission_in_progress = True

    try:

        # ====================================================
        # VALIDATE
        # ====================================================

        validation_errors = []

        for item in implementation_data:

            if not item[
                "chapter_lesson"
            ]:

                validation_errors.append(
                    f"Implementation "
                    f"{item['number']}: "
                    "Please enter Chapter / "
                    "Lesson."
                )

            if not item["files"]:

                validation_errors.append(
                    f"Implementation "
                    f"{item['number']}: "
                    "Please upload at least "
                    "one file."
                )

            file_errors = (
                validate_files(
                    item["files"]
                )
            )

            validation_errors.extend(
                [
                    (
                        f"Implementation "
                        f"{item['number']}: "
                        f"{error}"
                    )
                    for error in file_errors
                ]
            )

        if validation_errors:

            st.error(
                "Please correct the following:\n\n"
                + "\n".join(
                    f"• {error}"
                    for error in validation_errors
                )
            )

            st.session_state \
                .submission_in_progress = False

            st.stop()


        # ====================================================
        # CREATE UNIQUE SUBMISSION FOLDER
        # ====================================================

        submission_id = (
            datetime.now().strftime(
                "%Y%m%d%H%M%S"
            )
            + "_"
            + uuid.uuid4().hex[:8]
        )


        # ====================================================
        # PREPARE TEACHER INFO
        # ====================================================

        teacher_info = {

            "State_Zone": clean_text(
                teacher_row.get(
                    "State_Zone",
                    selected_state,
                )
            ),

            "Uploaded_By": clean_text(
                teacher_row.get(
                    "Uploaded_By",
                    selected_consultant,
                )
            ),

            "Institution": clean_text(
                teacher_row.get(
                    "Institution",
                    selected_school,
                )
            ),

            "FullName": selected_teacher,

            "Role": clean_text(
                teacher_row.get(
                    "Role",
                    "teacher",
                )
            ),
        }


        # ====================================================
        # HASH + PREPARE UPLOAD JOBS
        # ====================================================

        upload_jobs = []


        with st.spinner(
            "Preparing files securely..."
        ):

            for item in implementation_data:

                for uploaded_file in item[
                    "files"
                ]:

                    file_hash = (
                        sha256_uploaded_file(
                            uploaded_file
                        )
                    )

                    original_name = (
                        safe_filename(
                            uploaded_file.name
                        )
                    )

                    unique_prefix = (
                        uuid.uuid4()
                        .hex[:8]
                    )

                    object_name = (
                        f"{unique_prefix}_"
                        f"{original_name}"
                    )


                    evidence_key = (
                        EVIDENCE_TYPE_KEYS[
                            item[
                                "evidence_type"
                            ]
                        ]
                    )


                    evidence_folder = (
                        sanitize_path(
                            evidence_key
                        )
                    )


                    r2_key = (
                        "schools/"
                        + sanitize_path(
                            selected_school
                        )
                        + "/teachers/"
                        + sanitize_path(
                            selected_teacher
                        )
                        + "/"
                        + str(
                            submission_date
                        )
                        + "/submission_"
                        + submission_id
                        + "/"
                        + evidence_folder
                        + "/"
                        + object_name
                    )


                    upload_jobs.append(
                        {
                            "uploaded_file":
                                uploaded_file,

                            "r2_key":
                                r2_key,

                            "evidence_number":
                                item[
                                    "number"
                                ],

                            "evidence_type":
                                item[
                                    "evidence_type"
                                ],

                            "filename":
                                uploaded_file.name,

                            "sha256":
                                file_hash,
                        }
                    )


        # ====================================================
        # PARALLEL R2 UPLOAD
        # ====================================================

        progress_placeholder = (
            st.empty()
        )

        uploaded_results = []
        uploaded_keys = []


        try:

            (
                uploaded_results,
                uploaded_keys,
            ) = upload_files_parallel(
                upload_jobs,
                progress_placeholder,
            )

        except Exception as upload_error:

            delete_r2_keys(
                uploaded_keys
            )

            st.error(
                "❌ File upload failed.\n\n"
                f"{upload_error}"
            )

            st.session_state \
                .submission_in_progress = False

            st.stop()


        # ====================================================
        # VERIFY UPLOAD COUNT
        # ====================================================

        if (
            len(uploaded_results)
            != len(upload_jobs)
        ):

            delete_r2_keys(
                uploaded_keys
            )

            st.error(
                "❌ Not all files were "
                "uploaded successfully."
            )

            st.session_state \
                .submission_in_progress = False

            st.stop()


        # ====================================================
        # MAP FILES TO IMPLEMENTATIONS
        # ====================================================

        results_by_implementation = {}


        for result in uploaded_results:

            implementation_number = (
                result[
                    "evidence_number"
                ]
            )

            results_by_implementation \
                .setdefault(
                    implementation_number,
                    [],
                ) \
                .append(result)


        # ====================================================
        # INSERT INTO TEACHER_RECORDS
        # ====================================================

        inserted_rows = []

        try:

            for item in implementation_data:

                implementation_number = (
                    item["number"]
                )

                item_results = (
                    results_by_implementation
                    .get(
                        implementation_number,
                        [],
                    )
                )


                inserted_row = (
                    insert_teacher_record(
                        teacher_info=teacher_info,

                        submission_date=(
                            submission_date
                        ),

                        evidence_number=(
                            implementation_number
                        ),

                        evidence=item,

                        uploaded_results=(
                            item_results
                        ),
                    )
                )


                inserted_rows.append(
                    inserted_row
                )


        except Exception as db_error:

            # Database failed after R2 upload.
            # Delete the uploaded files.

            delete_r2_keys(
                uploaded_keys
            )

            st.error(
                "❌ Submission could not "
                "be saved.\n\n"
                f"{db_error}"
            )

            st.session_state \
                .submission_in_progress = False

            st.stop()


        # ====================================================
        # SUCCESS
        # ====================================================

        st.success(
            "🎉 Evidence submitted successfully!"
        )

        st.info(
            f"Submission ID: "
            f"`{submission_id}`"
        )

        st.write(
            f"**Teacher:** "
            f"{selected_teacher}"
        )

        st.write(
            f"**Date:** "
            f"{submission_date}"
        )

        st.write(
            f"**Implementations:** "
            f"{len(implementation_data)}"
        )

        st.write(
            f"**Files Uploaded:** "
            f"{len(upload_jobs)}"
        )

        st.caption(
            "Your evidence has been "
            "securely stored."
        )


        # ====================================================
        # RESET FORM
        # ====================================================

        st.session_state \
            .implementation_items = [1]


        keys_to_clear = []

        for key in list(
            st.session_state.keys()
        ):

            if (
                key.startswith("grade_")
                or key.startswith("subject_")
                or key.startswith("chapter_")
                or key.startswith(
                    "evidence_type_"
                )
                or key.startswith("files_")
            ):

                keys_to_clear.append(
                    key
                )


        for key in keys_to_clear:

            st.session_state.pop(
                key,
                None,
            )


    except Exception as e:

        st.error(
            "❌ Something went wrong "
            "while processing the submission."
        )

        st.exception(e)


    finally:

        st.session_state \
            .submission_in_progress = False
