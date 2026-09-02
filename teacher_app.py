import streamlit as st
import pandas as pd
import re
import uuid
import hashlib
import mimetypes
import time
from datetime import datetime, date
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
from queue import Queue, Empty
from threading import Lock
import boto3
from boto3.s3.transfer import TransferConfig
from botocore.exceptions import BotoCoreError, ClientError
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
# Maximum evidence cards in one submission
MAX_EVIDENCE_ITEMS = 15
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
# Internal values used for storage
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
if "evidence_items" not in st.session_state:
    st.session_state.evidence_items = [1]
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
    return create_client(SUPABASE_URL, SUPABASE_KEY)
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
# HELPERS
# ============================================================
def clean_text(value):
    if value is None:
        return ""
    value = str(value).strip()
    if value.lower() in {"nan", "none", "null"}:
        return ""
    return value
def sanitize_path(value):
    """
    Make a safe R2 folder/file path component.
    """
    value = clean_text(value)
    value = re.sub(r"[^\w\s\-().&]+", "", value, flags=re.UNICODE)
    value = re.sub(r"\s+", "_", value)
    return value.strip("_") or "unknown"
def safe_filename(filename):
    """
    Keep the original filename readable while removing unsafe characters.
    """
    filename = clean_text(filename)
    filename = re.sub(
        r"[^\w\s\-().]+",
        "",
        filename,
        flags=re.UNICODE,
    )
    filename = re.sub(r"\s+", "_", filename)
    return filename[:180] or "file"
def get_file_extension(filename):
    filename = clean_text(filename)
    if "." not in filename:
        return ""
    return filename.rsplit(".", 1)[1].lower()
def format_bytes(num_bytes):
    if num_bytes < 1024:
        return f"{num_bytes} B"
    if num_bytes < 1024 * 1024:
        return f"{num_bytes / 1024:.1f} KB"
    if num_bytes < 1024 * 1024 * 1024:
        return f"{num_bytes / 1024 / 1024:.1f} MB"
    return f"{num_bytes / 1024 / 1024 / 1024:.2f} GB"
def get_content_type(filename):
    content_type, _ = mimetypes.guess_type(filename)
    return content_type or "application/octet-stream"
def sha256_uploaded_file(uploaded_file):
    """
    Calculate SHA-256 without loading the entire file into memory.
    """
    h = hashlib.sha256()
    uploaded_file.seek(0)
    while True:
        chunk = uploaded_file.read(1024 * 1024)
        if not chunk:
            break
        h.update(chunk)
    uploaded_file.seek(0)
    return h.hexdigest()
def validate_files(files):
    """
    Validate every file BEFORE any R2 upload starts.
    """
    errors = []
    for uploaded_file in files:
        size = uploaded_file.size
        if size > MAX_FILE_SIZE_BYTES:
            errors.append(
                f"{uploaded_file.name} is {format_bytes(size)}. "
                f"Maximum allowed is {MAX_FILE_SIZE_MB} MB."
            )
        if size <= 0:
            errors.append(
                f"{uploaded_file.name} appears to be empty."
            )
    return errors
def make_submission_fingerprint(
    teacher_name,
    submission_date,
    evidence_data,
):
    """
    Creates a deterministic fingerprint for the entire submission.
    Uses:
    - Teacher
    - Date
    - Grade
    - Subject
    - Chapter/Lesson
    - Evidence type
    - Filename
    - File size
    - File SHA-256
    Evidence order is sorted so rearranging Evidence 1 / Evidence 2
    does not create a different submission.
    """
    components = []
    for item in evidence_data:
        files = []
        for f in item["files"]:
            files.append(
                (
                    f["name"],
                    f["size"],
                    f["sha256"],
                )
            )
        files.sort()
        components.append(
            (
                clean_text(item["grade"]),
                clean_text(item["subject"]),
                clean_text(item["chapter_lesson"]),
                clean_text(item["evidence_type"]),
                tuple(files),
            )
        )
    components.sort(
        key=lambda x: (
            x[0],
            x[1],
            x[2],
            x[3],
        )
    )
    raw = repr(
        (
            clean_text(teacher_name),
            str(submission_date),
            tuple(components),
        )
    )
    return hashlib.sha256(
        raw.encode("utf-8")
    ).hexdigest()
# ============================================================
# ROSTER
# ============================================================
@st.cache_data(ttl=300)
def load_roster():
    """
    Loads teacher roster from teacher_records.
    Existing roster fields remain compatible.
    """
    rows = []
    start = 0
    page_size = 1000
    while True:
        response = (
            supabase
            .table("teacher_records")
            .select(
                "State_Zone,Uploaded_By,Institution,FullName,Role"
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
    for col in [
        "State_Zone",
        "Uploaded_By",
        "Institution",
        "FullName",
        "Role",
    ]:
        if col not in df.columns:
            df[col] = ""
        df[col] = df[col].fillna("").astype(str).str.strip()
    # Remove completely blank teacher rows
    df = df[df["FullName"] != ""]
    return df.drop_duplicates()
# ============================================================
# FILE UPLOAD CALLBACK
# ============================================================
class ProgressCallback:
    """
    Thread-safe boto3 callback.
    Each uploaded file has its own callback and therefore its own
    progress counter.
    """
    def __init__(self, file_id, total_bytes, progress_queue):
        self.file_id = file_id
        self.total_bytes = total_bytes
        self.progress_queue = progress_queue
        self.transferred = 0
        self.lock = Lock()
    def __call__(self, bytes_amount):
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
# SINGLE R2 FILE UPLOAD
# ============================================================
def upload_one_file(
    uploaded_file,
    r2_key,
    progress_queue,
):
    """
    Upload one file to Cloudflare R2.
    This function runs inside a worker thread.
    """
    file_id = str(uuid.uuid4())
    callback = ProgressCallback(
        file_id=file_id,
        total_bytes=uploaded_file.size,
        progress_queue=progress_queue,
    )
    uploaded_file.seek(0)
    r2_client.upload_fileobj(
        Fileobj=uploaded_file,
        Bucket=R2_BUCKET_NAME,
        Key=r2_key,
        ExtraArgs={
            "ContentType": get_content_type(uploaded_file.name),
        },
        Config=R2_TRANSFER_CONFIG,
        Callback=callback,
    )
    return {
        "file_id": file_id,
        "r2_key": r2_key,
        "filename": uploaded_file.name,
        "size": uploaded_file.size,
    }
# ============================================================
# PARALLEL UPLOAD ENGINE
# ============================================================
def upload_files_parallel(upload_jobs, progress_placeholder):
    """
    Upload multiple files concurrently.
    upload_jobs:
        [
            {
                "uploaded_file": UploadedFile,
                "r2_key": "...",
            }
        ]
    Returns:
        successful upload records
        uploaded R2 keys
    """
    if not upload_jobs:
        return [], []
    progress_queue = Queue()
    total_bytes = sum(
        job["uploaded_file"].size
        for job in upload_jobs
    )
    total_files = len(upload_jobs)
    file_progress = {}
    file_names = {}
    for job in upload_jobs:
        file_id = str(uuid.uuid4())
        file_progress[file_id] = {
            "name": job["uploaded_file"].name,
            "total": job["uploaded_file"].size,
            "transferred": 0,
        }
        file_names[id(job)] = file_id
        job["_progress_file_id"] = file_id
    uploaded_bytes = 0
    completed_files = 0
    results = []
    uploaded_keys = []
    # --------------------------------------------------------
    # Worker wrapper
    # --------------------------------------------------------
    def worker(job):
        file_id = job["_progress_file_id"]
        callback = ProgressCallback(
            file_id=file_id,
            total_bytes=job["uploaded_file"].size,
            progress_queue=progress_queue,
        )
        job["uploaded_file"].seek(0)
        r2_client.upload_fileobj(
            Fileobj=job["uploaded_file"],
            Bucket=R2_BUCKET_NAME,
            Key=job["r2_key"],
            ExtraArgs={
                "ContentType": get_content_type(
                    job["uploaded_file"].name
                )
            },
            Config=R2_TRANSFER_CONFIG,
            Callback=callback,
        )
        return {
            "file_id": file_id,
            "r2_key": job["r2_key"],
            "filename": job["uploaded_file"].name,
            "size": job["uploaded_file"].size,
        }
    # --------------------------------------------------------
    # Parallel execution
    # --------------------------------------------------------
    futures = {}
    with ThreadPoolExecutor(
        max_workers=MAX_PARALLEL_UPLOADS
    ) as executor:
        for job in upload_jobs:
            future = executor.submit(worker, job)
            futures[future] = job
        pending = set(futures.keys())
        while pending:
            # Drain all currently available progress events
            while True:
                try:
                    event = progress_queue.get_nowait()
                    fid = event["file_id"]
                    if fid in file_progress:
                        file_progress[fid]["transferred"] = min(
                            event["transferred"],
                            event["total"],
                        )
                except Empty:
                    break
            # Check completed futures
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
            # ------------------------------------------------
            # Calculate overall progress
            # ------------------------------------------------
            current_bytes = sum(
                item["transferred"]
                for item in file_progress.values()
            )
            # If a file is completed, ensure it reaches 100%
            for result in results:
                fid = result["file_id"]
                if fid in file_progress:
                    file_progress[fid]["transferred"] = (
                        file_progress[fid]["total"]
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
                min(1, overall_progress),
            )
            # ------------------------------------------------
            # Render progress
            # ------------------------------------------------
            with progress_placeholder.container():
                st.markdown(
                    f"### ⬆️ Uploading {total_files} file(s)"
                )
                st.progress(
                    overall_progress,
                    text=(
                        f"Overall: "
                        f"{overall_progress * 100:.0f}%"
                    ),
                )
                st.caption(
                    f"{completed_files}/{total_files} "
                    "files completed"
                )
                for fid, info in file_progress.items():
                    file_percent = (
                        info["transferred"]
                        / info["total"]
                        if info["total"] > 0
                        else 0
                    )
                    file_percent = max(
                        0,
                        min(1, file_percent),
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
    # Drain final events
    while True:
        try:
            event = progress_queue.get_nowait()
            fid = event["file_id"]
            if fid in file_progress:
                file_progress[fid]["transferred"] = min(
                    event["transferred"],
                    event["total"],
                )
        except Empty:
            break
    # Final 100% UI
    with progress_placeholder.container():
        st.markdown("### ⬆️ Upload complete")
        st.progress(
            1.0,
            text="All files uploaded successfully",
        )
        for fid, info in file_progress.items():
            st.progress(
                1.0,
                text=(
                    f"{info['name']} — 100% "
                    f"({format_bytes(info['total'])})"
                ),
            )
    return results, uploaded_keys
# ============================================================
# DATABASE HELPERS
# ============================================================
def check_duplicate_submission(fingerprint):
    """
    Check dedicated submission table first.
    """
    try:
        response = (
            supabase
            .table("teacher_submissions")
            .select(
                "Submission_ID,Submission_Status,Submitted_At"
            )
            .eq(
                "Submission_Fingerprint",
                fingerprint,
            )
            .limit(1)
            .execute()
        )
        return response.data[0] if response.data else None
    except Exception:
        # If the dedicated table is unavailable,
        # check teacher_records.
        try:
            response = (
                supabase
                .table("teacher_records")
                .select(
                    "Submission_ID,Submission_Status,Submitted_At"
                )
                .eq(
                    "Submission_Fingerprint",
                    fingerprint,
                )
                .limit(1)
                .execute()
            )
            return (
                response.data[0]
                if response.data
                else None
            )
        except Exception:
            return None
def create_submission_record(
    submission_id,
    fingerprint,
    teacher_info,
    submission_date,
    evidence_count,
    file_count,
):
    """
    Creates the submission tracking row BEFORE file upload.
    Status:
        uploading
    """
    row = {
        "Submission_ID": submission_id,
        "Submission_Fingerprint": fingerprint,
        "State_Zone": teacher_info["State_Zone"],
        "Uploaded_By": teacher_info["Uploaded_By"],
        "Institution": teacher_info["Institution"],
        "Center": teacher_info["Institution"],
        "FirstName": (
            teacher_info["FullName"].split(" ")[0]
            if teacher_info["FullName"]
            else ""
        ),
        "LastName": (
            " ".join(
                teacher_info["FullName"].split(" ")[1:]
            )
            if len(
                teacher_info["FullName"].split()
            ) > 1
            else ""
        ),
        "FullName": teacher_info["FullName"],
        "Role": teacher_info["Role"] or "teacher",
        "Submission_Date": str(submission_date),
        "Evidence_Group_Count": evidence_count,
        "File_Count": file_count,
        "Submission_Status": "uploading",
    }
    response = (
        supabase
        .table("teacher_submissions")
        .insert(row)
        .execute()
    )
    return response.data[0] if response.data else row
def mark_submission_completed(
    submission_id,
):
    (
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
            submission_id,
        )
        .execute()
    )
def mark_submission_failed(
    submission_id,
    error_message,
):
    try:
        (
            supabase
            .table("teacher_submissions")
            .update(
                {
                    "Submission_Status": "failed",
                    "Error_Message": str(
                        error_message
                    )[:2000],
                }
            )
            .eq(
                "Submission_ID",
                submission_id,
            )
            .execute()
        )
    except Exception:
        pass
def insert_teacher_evidence(
    submission_id,
    evidence_number,
    evidence,
    uploaded_results,
):
    """
    Insert one evidence item.
    Database stores R2 object keys, NOT public URLs.
    """
    links = {
        "voice": [],
        "lesson_plan": [],
        "video": [],
        "writing": [],
        "phonics": [],
        "portfolio": [],
        "assessment": [],
        "other": [],
    }
    for result in uploaded_results:
        evidence_type = evidence["evidence_type"]
        key = EVIDENCE_TYPE_KEYS[evidence_type]
        if key == "lesson_plan":
            links["lesson_plan"].append(
                result["r2_key"]
            )
        elif key == "classroom_activity":
            links["video"].append(
                result["r2_key"]
            )
        elif key == "student_writing":
            links["writing"].append(
                result["r2_key"]
            )
        elif key == "phonics_phonetics":
            links["phonics"].append(
                result["r2_key"]
            )
        elif key == "teacher_portfolio":
            links["portfolio"].append(
                result["r2_key"]
            )
        elif key == "assessment":
            links["assessment"].append(
                result["r2_key"]
            )
        elif key == "other_evidence":
            links["other"].append(
                result["r2_key"]
            )
    row = {
        "Evidence_ID": str(uuid.uuid4()),
        "Submission_ID": submission_id,
        # Internal number only.
        # Teacher sees "Evidence", never "Group".
        "Evidence_Group": evidence_number,
        "Grade": evidence["grade"],
        "Subject": evidence["subject"],
        "Chapter_Lesson": evidence["chapter_lesson"],
        "Evidence_Type": evidence["evidence_type"],
        "Voice_Note_Links": ",".join(
            links["voice"]
        ),
        "Lesson_Plan_Picture_Links": ",".join(
            links["lesson_plan"]
        ),
        "Video_Evidence_1": (
            links["video"][0]
            if len(links["video"]) >= 1
            else ""
        ),
        "Video_Evidence_2": (
            links["video"][1]
            if len(links["video"]) >= 2
            else ""
        ),
        "Video_Evidence_3": (
            links["video"][2]
            if len(links["video"]) >= 3
            else ""
        ),
        "Activity_Video_Links": ",".join(
            links["video"]
        ),
        "Writing_Sample_Links": ",".join(
            links["writing"]
        ),
        "Phonics_Evidence_Links": ",".join(
            links["phonics"]
        ),
        "Portfolio_Evidence_Links": ",".join(
            links["portfolio"]
        ),
        # These require the corresponding columns
        # in teacher_evidence.
        "Assessment_Evidence_Links": ",".join(
            links["assessment"]
        ),
        "Other_Evidence_Links": ",".join(
            links["other"]
        ),
    }
    response = (
        supabase
        .table("teacher_evidence")
        .insert(row)
        .execute()
    )
    return response.data[0] if response.data else row
def insert_legacy_teacher_record(
    teacher_info,
    submission_date,
    submission_id,
    fingerprint,
    evidence_number,
    evidence,
    uploaded_results,
):
    """
    Keeps teacher_records compatible with the existing system.
    This creates one legacy record for each evidence item.
    R2 object KEYS are stored instead of public URLs.
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
    for result in uploaded_results:
        evidence_key = EVIDENCE_TYPE_KEYS[
            evidence["evidence_type"]
        ]
        key_map[evidence_key].append(
            result["r2_key"]
        )
    video_keys = key_map["classroom_activity"]
    row = {
        "State_Zone": teacher_info["State_Zone"],
        "Uploaded_By": teacher_info["Uploaded_By"],
        "Institution": teacher_info["Institution"],
        "Center": teacher_info["Institution"],
        "FirstName": (
            teacher_info["FullName"].split(" ")[0]
            if teacher_info["FullName"]
            else ""
        ),
        "LastName": (
            " ".join(
                teacher_info["FullName"].split(" ")[1:]
            )
            if len(
                teacher_info["FullName"].split()
            ) > 1
            else ""
        ),
        "FullName": teacher_info["FullName"],
        "Role": teacher_info["Role"] or "teacher",
        "Type": "Teacher Evidence",
        "Grade": evidence["grade"],
        "Subject": evidence["subject"],
        "Book": evidence["chapter_lesson"],
        # Kept for existing compatibility.
        "StartTime": "09:00",
        "EndTime": "09:45",
        "Duration_Min": 0.0,
        "Voice_Note_Link": "",
        "Lesson_Plan_Picture": (
            ",".join(
                key_map["lesson_plan"]
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
                key_map["student_writing"]
            )
        ),
        "Phonics_Evidence_Link": (
            ",".join(
                key_map["phonics_phonetics"]
            )
        ),
        "Portfolio_Evidence_Link": (
            ",".join(
                key_map["teacher_portfolio"]
            )
        ),
        "Submission_ID": submission_id,
        "Evidence_Group": evidence_number,
        "Evidence_Type": evidence[
            "evidence_type"
        ],
        "Activity_Video_Links": ",".join(
            video_keys
        ),
        "Submission_Fingerprint": fingerprint,
        "Submission_Status": "completed",
        "Submitted_At": datetime.utcnow().isoformat(),
    }
    # Assessment / Other are represented in the dedicated
    # teacher_evidence table. We do not invent old columns
    # that may not exist in teacher_records.
    (
        supabase
        .table("teacher_records")
        .insert(row)
        .execute()
    )
# ============================================================
# R2 CLEANUP
# ============================================================
def delete_r2_keys(keys):
    """
    Delete uploaded R2 objects if submission fails.
    """
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
# FILE ACCEPTANCE RULES
# ============================================================
def allowed_types_for_evidence(evidence_type):
    """
    Keep the teacher experience simple.
    These are intentionally broad because evidence may be:
    audio, video, image or document depending on the evidence.
    """
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
    if evidence_type == "🎯 Classroom Activity / Implementation":
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
    # Other Evidence
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
def extension_filter_text(extensions):
    return ", ".join(
        f".{x}"
        for x in extensions
    )
# ============================================================
# EVIDENCE CARD
# ============================================================
def render_evidence_card(number):
    st.markdown(
        f"### 📌 Evidence {number}"
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
        "Chapter / Lesson Plan / Activity Name or Number",
        placeholder="Example: Plants – LP 4",
        key=f"chapter_{number}",
    )
    evidence_type = st.selectbox(
        "What are you submitting?",
        EVIDENCE_TYPES,
        key=f"evidence_type_{number}",
    )
    extensions = allowed_types_for_evidence(
        evidence_type
    )
    st.caption(
        f"Upload: {extension_filter_text(extensions)} "
        f"• Maximum {MAX_FILE_SIZE_MB} MB per file"
    )
    files = st.file_uploader(
        "Upload evidence",
        type=extensions,
        accept_multiple_files=True,
        key=f"files_{number}",
        help=(
            f"You can upload multiple files. "
            f"Each file can be up to {MAX_FILE_SIZE_MB} MB."
        ),
    )
    if files:
        total_size = sum(
            f.size for f in files
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
        "chapter_lesson": chapter_lesson.strip(),
        "evidence_type": evidence_type,
        "files": files or [],
    }
# ============================================================
# UI
# ============================================================
st.title("📝 Teacher Evidence Submission Portal")
st.caption(
    "Submit your lesson planning and classroom evidence "
    "in one simple submission."
)
st.divider()
# ============================================================
# TEACHER SELECTION
# ============================================================
st.subheader("👩‍🏫 Teacher Details")
roster = load_roster()
if roster.empty:
    st.error(
        "No teacher roster data was found in "
        "`teacher_records`."
    )
    st.stop()
# ------------------------------------------------------------
# State / Zone
# ------------------------------------------------------------
state_options = sorted(
    [
        x for x in roster["State_Zone"].unique()
        if clean_text(x)
    ]
)
selected_state = st.selectbox(
    "State / Zone",
    state_options,
)
state_df = roster[
    roster["State_Zone"] == selected_state
].copy()
# ------------------------------------------------------------
# Consultant
# ------------------------------------------------------------
consultant_options = sorted(
    [
        x for x in state_df["Uploaded_By"].unique()
        if clean_text(x)
    ]
)
if not consultant_options:
    st.warning(
        "No consultant is available for this State / Zone."
    )
    st.stop()
selected_consultant = st.selectbox(
    "Consultant",
    consultant_options,
)
consultant_df = state_df[
    state_df["Uploaded_By"] == selected_consultant
].copy()
# ------------------------------------------------------------
# School
# ------------------------------------------------------------
school_options = sorted(
    [
        x for x in consultant_df["Institution"].unique()
        if clean_text(x)
    ]
)
if not school_options:
    st.warning(
        "No school is available for this consultant."
    )
    st.stop()
selected_school = st.selectbox(
    "School",
    school_options,
)
school_df = consultant_df[
    consultant_df["Institution"] == selected_school
].copy()
# ------------------------------------------------------------
# Teacher
# ------------------------------------------------------------
teacher_options = sorted(
    [
        x for x in school_df["FullName"].unique()
        if clean_text(x)
    ]
)
if not teacher_options:
    st.warning(
        "No teacher is available for this school."
    )
    st.stop()
selected_teacher = st.selectbox(
    "Teacher",
    teacher_options,
)
teacher_rows = school_df[
    school_df["FullName"] == selected_teacher
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
st.subheader("📅 Submission Date")
submission_date = st.date_input(
    "Date",
    value=date.today(),
    max_value=date.today(),
)
# ============================================================
# EVIDENCE
# ============================================================
st.divider()
st.subheader("📚 Evidence")
st.caption(
    "Add as many evidence items as needed. "
    "For each item, select what you are submitting "
    "and upload only that evidence."
)
evidence_data = []
for number in st.session_state.evidence_items:
    evidence = render_evidence_card(number)
    evidence_data.append(evidence)
    if number != st.session_state.evidence_items[-1]:
        st.divider()
# ============================================================
# ADD ANOTHER EVIDENCE
# ============================================================
if len(st.session_state.evidence_items) < MAX_EVIDENCE_ITEMS:
    if st.button(
        "➕ Add Another Evidence",
        use_container_width=True,
    ):
        next_number = (
            max(st.session_state.evidence_items)
            + 1
        )
        st.session_state.evidence_items.append(
            next_number
        )
        st.rerun()
# ============================================================
# REMOVE LAST EVIDENCE
# ============================================================
if len(st.session_state.evidence_items) > 1:
    if st.button(
        "➖ Remove Last Evidence",
        use_container_width=True,
    ):
        removed = (
            st.session_state.evidence_items.pop()
        )
        # Remove old widget state
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
    for item in evidence_data
)
total_size = sum(
    f.size
    for item in evidence_data
    for f in item["files"]
)
st.markdown("### 📋 Submission Summary")
summary_col1, summary_col2 = st.columns(2)
with summary_col1:
    st.metric(
        "Evidence Items",
        len(evidence_data),
    )
with summary_col2:
    st.metric(
        "Files",
        total_files,
    )
if total_files:
    st.caption(
        f"Total upload size: {format_bytes(total_size)}"
    )
# ============================================================
# SUBMIT
# ============================================================
st.divider()
submit = st.button(
    "🚀 Submit Evidence",
    type="primary",
    use_container_width=True,
    disabled=st.session_state.submission_in_progress,
)
if submit:
    st.session_state.submission_in_progress = True
    try:
        # ====================================================
        # VALIDATE EVIDENCE
        # ====================================================
        validation_errors = []
        for item in evidence_data:
            if not item["chapter_lesson"]:
                validation_errors.append(
                    f"Evidence {item['number']}: "
                    "Please enter Chapter / Lesson Plan / "
                    "Activity Name or Number."
                )
            if not item["files"]:
                validation_errors.append(
                    f"Evidence {item['number']}: "
                    "Please upload at least one file."
                )
            file_errors = validate_files(
                item["files"]
            )
            validation_errors.extend(
                [
                    f"Evidence {item['number']}: {error}"
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
            st.session_state.submission_in_progress = False
            st.stop()
        # ====================================================
        # HASH FILES BEFORE UPLOAD
        # ====================================================
        with st.spinner(
            "Preparing files securely..."
        ):
            for item in evidence_data:
                file_metadata = []
                for uploaded_file in item["files"]:
                    file_hash = sha256_uploaded_file(
                        uploaded_file
                    )
                    file_metadata.append(
                        {
                            "name": uploaded_file.name,
                            "size": uploaded_file.size,
                            "sha256": file_hash,
                            "uploaded_file": uploaded_file,
                        }
                    )
                item["file_metadata"] = file_metadata
        # ====================================================
        # DUPLICATE FINGERPRINT
        # ====================================================
        fingerprint = make_submission_fingerprint(
            selected_teacher,
            submission_date,
            [
                {
                    **item,
                    "files": item["file_metadata"],
                }
                for item in evidence_data
            ],
        )
        existing_submission = (
            check_duplicate_submission(
                fingerprint
            )
        )
        if existing_submission:
            existing_id = existing_submission.get(
                "Submission_ID",
                "already submitted",
            )
            status = existing_submission.get(
                "Submission_Status",
                "",
            )
            if status in {
                "uploading",
                "completed",
            }:
                st.warning(
                    "⚠️ This submission appears to "
                    "have already been submitted."
                )
                st.info(
                    f"Submission ID: `{existing_id}`"
                )
                st.session_state.submission_in_progress = False
                st.stop()
        # ====================================================
        # CREATE SUBMISSION ID
        # ====================================================
        submission_id = (
            datetime.now().strftime("%Y%m%d%H%M%S")
            + "_"
            + uuid.uuid4().hex[:8]
        )
        # ====================================================
        # PREPARE ALL UPLOAD JOBS
        # ====================================================
        upload_jobs = []
        for item in evidence_data:
            evidence_key = EVIDENCE_TYPE_KEYS[
                item["evidence_type"]
            ]
            evidence_folder = sanitize_path(
                evidence_key
            )
            for file_meta in item["file_metadata"]:
                original_name = safe_filename(
                    file_meta["name"]
                )
                unique_prefix = uuid.uuid4().hex[:8]
                object_name = (
                    f"{unique_prefix}_"
                    f"{original_name}"
                )
                r2_key = (
                    "schools/"
                    + sanitize_path(selected_school)
                    + "/teachers/"
                    + sanitize_path(selected_teacher)
                    + "/"
                    + str(submission_date)
                    + "/submission_"
                    + submission_id
                    + "/"
                    + evidence_folder
                    + "/"
                    + object_name
                )
                upload_jobs.append(
                    {
                        "uploaded_file": file_meta[
                            "uploaded_file"
                        ],
                        "r2_key": r2_key,
                        "evidence_number": item[
                            "number"
                        ],
                        "evidence_type": item[
                            "evidence_type"
                        ],
                        "filename": file_meta[
                            "name"
                        ],
                    }
                )
        # ====================================================
        # CREATE SUBMISSION TRACKING RECORD
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
        try:
            create_submission_record(
                submission_id=submission_id,
                fingerprint=fingerprint,
                teacher_info=teacher_info,
                submission_date=submission_date,
                evidence_count=len(
                    evidence_data
                ),
                file_count=len(
                    upload_jobs
                ),
            )
        except Exception as e:
            error_text = str(e)
            # If unique constraint caught a race-condition
            # duplicate, stop safely.
            if (
                "duplicate"
                in error_text.lower()
                or "unique"
                in error_text.lower()
            ):
                st.warning(
                    "⚠️ This submission has already "
                    "been submitted."
                )
                st.session_state.submission_in_progress = False
                st.stop()
            raise
        # ====================================================
        # PARALLEL R2 UPLOAD
        # ====================================================
        progress_placeholder = st.empty()
        uploaded_results = []
        uploaded_keys = []
        try:
            uploaded_results, uploaded_keys = (
                upload_files_parallel(
                    upload_jobs,
                    progress_placeholder,
                )
            )
        except Exception as upload_error:
            delete_r2_keys(
                uploaded_keys
            )
            mark_submission_failed(
                submission_id,
                upload_error,
            )
            st.error(
                "❌ File upload failed.\n\n"
                f"{upload_error}"
            )
            st.session_state.submission_in_progress = False
            st.stop()
        # ====================================================
        # VERIFY ALL FILES
        # ====================================================
        if len(uploaded_results) != len(
            upload_jobs
        ):
            delete_r2_keys(
                uploaded_keys
            )
            error_message = (
                "Not all files were uploaded successfully."
            )
            mark_submission_failed(
                submission_id,
                error_message,
            )
            st.error(
                f"❌ {error_message}"
            )
            st.session_state.submission_in_progress = False
            st.stop()
        # ====================================================
        # MAP UPLOADED FILES TO EVIDENCE ITEMS
        # ====================================================
        results_by_evidence = {}
        for result in uploaded_results:
            # Find corresponding upload job
            matching_job = next(
                (
                    job
                    for job in upload_jobs
                    if (
                        job["r2_key"]
                        == result["r2_key"]
                    )
                ),
                None,
            )
            if matching_job is None:
                continue
            evidence_number = (
                matching_job[
                    "evidence_number"
                ]
            )
            results_by_evidence.setdefault(
                evidence_number,
                [],
            ).append(result)
        # ====================================================
        # DATABASE INSERTS
        # ====================================================
        try:
            for item in evidence_data:
                evidence_number = item[
                    "number"
                ]
                item_results = (
                    results_by_evidence.get(
                        evidence_number,
                        [],
                    )
                )
                # Dedicated evidence table
                insert_teacher_evidence(
                    submission_id=submission_id,
                    evidence_number=evidence_number,
                    evidence=item,
                    uploaded_results=item_results,
                )
                # Existing teacher_records table
                insert_legacy_teacher_record(
                    teacher_info=teacher_info,
                    submission_date=submission_date,
                    submission_id=submission_id,
                    fingerprint=fingerprint,
                    evidence_number=evidence_number,
                    evidence=item,
                    uploaded_results=item_results,
                )
        except Exception as db_error:
            # Remove R2 files because database write failed.
            delete_r2_keys(
                uploaded_keys
            )
            mark_submission_failed(
                submission_id,
                db_error,
            )
            st.error(
                "❌ Submission could not be saved.\n\n"
                f"{db_error}"
            )
            st.session_state.submission_in_progress = False
            st.stop()
        # ====================================================
        # MARK COMPLETE
        # ====================================================
        try:
            mark_submission_completed(
                submission_id
            )
        except Exception as status_error:
            # Files and evidence are already saved.
            # Do not delete R2 objects here.
            st.warning(
                "Evidence was saved, but the final "
                "submission status update needs attention."
            )
            st.caption(
                str(status_error)
            )
        # ====================================================
        # SUCCESS
        # ====================================================
        st.success(
            "🎉 Evidence submitted successfully!"
        )
        st.info(
            f"Submission ID: `{submission_id}`"
        )
        st.write(
            f"**Teacher:** {selected_teacher}"
        )
        st.write(
            f"**Date:** {submission_date}"
        )
        st.write(
            f"**Evidence Items:** "
            f"{len(evidence_data)}"
        )
        st.write(
            f"**Files Uploaded:** "
            f"{len(upload_jobs)}"
        )
        st.caption(
            "Your evidence has been securely stored."
        )
        # Reset evidence cards for the next submission.
        st.session_state.evidence_items = [1]
        # Clear old widget state
        keys_to_clear = []
        for key in list(
            st.session_state.keys()
        ):
            if (
                key.startswith("grade_")
                or key.startswith("subject_")
                or key.startswith("chapter_")
                or key.startswith("evidence_type_")
                or key.startswith("files_")
            ):
                keys_to_clear.append(key)
        for key in keys_to_clear:
            st.session_state.pop(
                key,
                None,
            )
    except Exception as e:
        st.error(
            "❌ Something went wrong while processing "
            "the submission."
        )
        st.exception(e)
    finally:
        st.session_state.submission_in_progress = False
