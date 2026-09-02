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
# UPLOAD LIMIT
# ============================================================
MAX_FILE_SIZE_MB = 50
MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024
# ============================================================
# SUPABASE SETUP - DATABASE ONLY
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
        f"⚠️ Cloud connection configuration is missing: {e}"
    )
    st.stop()
# ============================================================
# CLOUDFLARE R2 SETUP - FILE STORAGE
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
# FAST MULTIPART UPLOAD CONFIGURATION
# ============================================================
# Files above 8 MB use multipart upload.
# Files below this threshold are uploaded normally.
R2_TRANSFER_CONFIG = TransferConfig(
    multipart_threshold=8 * 1024 * 1024,
    multipart_chunksize=8 * 1024 * 1024,
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
# FETCH MASTER ROSTER FROM SUPABASE
# ============================================================
@st.cache_data(ttl=300, show_spinner=False)
def fetch_master_db_from_supabase():
    try:
        all_rows = []
        page_size = 1000
        start = 0
        while True:
            resp = (
                supabase
                .table(TEACHER_RECORDS_TABLE)
                .select(",".join(ROSTER_COLUMNS))
                .range(
                    start,
                    start + page_size - 1
                )
                .execute()
            )
            batch = resp.data or []
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
            f"⚠️ Could not load roster from database: {e}"
        )
        return pd.DataFrame(
            columns=ROSTER_COLUMNS
        )
# ============================================================
# R2 PATH SANITIZATION
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
# FILE SIZE VALIDATION
# ============================================================
def validate_file_size(uploaded_file):
    if uploaded_file is None:
        return True
    if uploaded_file.size > MAX_FILE_SIZE_BYTES:
        size_mb = uploaded_file.size / (
            1024 * 1024
        )
        st.error(
            f"❌ {uploaded_file.name} is "
            f"{size_mb:.1f} MB. "
            f"Maximum allowed file size is "
            f"{MAX_FILE_SIZE_MB} MB."
        )
        return False
    return True
# ============================================================
# FAST SINGLE FILE R2 UPLOAD
# ============================================================
def upload_single_file_worker(args):
    uploaded_file, folder_name = args
    try:
        # ----------------------------------------------------
        # Validate size
        # ----------------------------------------------------
        if uploaded_file.size > MAX_FILE_SIZE_BYTES:
            return {
                "success": False,
                "file_name": uploaded_file.name,
                "path": None,
                "error": (
                    f"File exceeds {MAX_FILE_SIZE_MB} MB"
                )
            }
        # ----------------------------------------------------
        # Clean filename
        # ----------------------------------------------------
        clean_filename = re.sub(
            r"[^a-zA-Z0-9_.-]",
            "_",
            uploaded_file.name
        )
        # ----------------------------------------------------
        # Unique filename
        # ----------------------------------------------------
        unique_file_id = uuid.uuid4().hex[:12]
        final_filename = (
            f"{unique_file_id}_{clean_filename}"
        )
        # ----------------------------------------------------
        # Complete R2 object key
        # ----------------------------------------------------
        file_path = (
            f"{folder_name}/{final_filename}"
        )
        # ----------------------------------------------------
        # IMPORTANT:
        # Do NOT use getvalue().
        #
        # Streamlit UploadedFile is already file-like.
        # We send it directly to boto3.
        # ----------------------------------------------------
        uploaded_file.seek(0)
        # ----------------------------------------------------
        # FAST MULTIPART R2 UPLOAD
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
            "path": file_path,
            "error": None
        }
    except Exception as e:
        return {
            "success": False,
            "file_name": uploaded_file.name,
            "path": None,
            "error": str(e)
        }
# ============================================================
# FAST PARALLEL MULTI-FILE UPLOAD
# ============================================================
def upload_files_parallel(
    upload_jobs,
    max_workers=5
):
    if not upload_jobs:
        return {
            "success": True,
            "paths": [],
            "errors": []
        }
    # --------------------------------------------------------
    # Upload multiple files simultaneously
    # --------------------------------------------------------
    with concurrent.futures.ThreadPoolExecutor(
        max_workers=max_workers
    ) as executor:
        results = list(
            executor.map(
                upload_single_file_worker,
                upload_jobs
            )
        )
    successful_paths = [
        result["path"]
        for result in results
        if result["success"]
        and result["path"]
    ]
    errors = [
        result
        for result in results
        if not result["success"]
    ]
    return {
        "success": len(errors) == 0,
        "paths": successful_paths,
        "errors": errors
    }
# ============================================================
# INSERT SUBMISSION INTO SUPABASE
# ============================================================
def insert_submission_to_db(entry_dict):
    response = (
        supabase
        .table(TEACHER_RECORDS_TABLE)
        .insert(entry_dict)
        .execute()
    )
    return response
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
    "Select your region, consultant, school, and name "
    "to submit lesson logs, qualitative media, "
    "phonics implementation evidence, and portfolio artifacts."
)
st.info(
    f"📦 Maximum file size: **{MAX_FILE_SIZE_MB} MB per file**. "
    "Multiple files can be uploaded together."
)
# ============================================================
# STATE / ZONE
# ============================================================
all_states = (
    sorted(
        [
            s
            for s in master_df["State_Zone"].unique()
            if s
            and s.lower()
            not in [
                "nan",
                "none",
                ""
            ]
        ]
    )
    if not master_df.empty
    and "State_Zone" in master_df.columns
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
    ] + all_states
)
# ============================================================
# CONSULTANT
# ============================================================
filtered_consultants = []
if (
    sub_state != "-- Select State / Zone --"
    and not master_df.empty
    and "Uploaded_By" in master_df.columns
):
    c_subset = master_df[
        master_df["State_Zone"].str.lower()
        == sub_state.lower()
    ]
    filtered_consultants = sorted(
        [
            c
            for c in c_subset["Uploaded_By"].unique()
            if c
            and c.lower()
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
    help="Populates based on the selected state/zone."
)
# ============================================================
# SCHOOL
# ============================================================
filtered_schools = []
if (
    sub_consultant != "-- Select Consultant --"
    and not master_df.empty
    and "Institution" in master_df.columns
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
            s
            for s in s_subset["Institution"].unique()
            if s
            and s.lower()
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
    help="Populates based on the selected consultant and state."
)
# ============================================================
# TEACHER
# ============================================================
filtered_teachers = []
if (
    sub_school != "-- Select School --"
    and not master_df.empty
    and "FullName" in master_df.columns
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
    if "Role" in t_subset.columns:
        role_lower = (
            t_subset["Role"]
            .astype(str)
            .str.lower()
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
            n
            for n in raw_names
            if n
            and n.lower()
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
    help="Populates based on the selected school roster."
)
# ============================================================
# SUBMISSION FORM
# ============================================================
with st.form(
    "evidence_submission_form",
    clear_on_submit=True
):
    sub_date = st.date_input(
        "Submission Date *"
    )
    # ========================================================
    # ACADEMIC LESSON DETAILS
    # ========================================================
    st.subheader(
        "2. Academic Lesson Details"
    )
    col_a1, col_a2 = st.columns(2)
    with col_a1:
        grade_options = [
            "Nursery",
            "LKG",
            "UKG",
            "Grade 1",
            "Grade 2",
            "Grade 3",
            "Grade 4",
            "Grade 5"
        ]
        sub_grade = st.selectbox(
            "Select Grade *",
            options=grade_options
        )
    with col_a2:
        subject_options = [
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
        sub_subject = st.selectbox(
            "Select Subject *",
            options=subject_options
        )
    sub_lesson_num = st.text_input(
        "Chapter Name and Lesson Plan Number "
        "(e.g., Chapter 2 - Plants / Lesson Plan #4) *"
    )
    st.info(
        f"📌 You can upload multiple files across all sections. "
        f"Maximum **{MAX_FILE_SIZE_MB} MB per file**."
    )
    # ========================================================
    # CORE QUALITATIVE EVIDENCE
    # ========================================================
    st.subheader(
        "3. Core Qualitative Evidence Uploads"
    )
    uploaded_voice = st.file_uploader(
        "🎤 Upload Lesson Plan Voice Note(s) "
        "(Audio / PDF)",
        type=[
            "mp3",
            "wav",
            "m4a",
            "ogg",
            "pdf"
        ],
        accept_multiple_files=True,
        key="voice_upload"
    )
    uploaded_pic = st.file_uploader(
        "🖼️ Upload Lesson Plan Picture(s) / Document(s)",
        type=[
            "png",
            "jpg",
            "jpeg",
            "pdf"
        ],
        accept_multiple_files=True,
        key="picture_upload"
    )
    col_v1, col_v2 = st.columns(2)
    with col_v1:
        uploaded_vid1 = st.file_uploader(
            "🎥 Classroom Activity Video(s) 1",
            type=[
                "mp4",
                "mov",
                "avi",
                "pdf"
            ],
            accept_multiple_files=True,
            key="video1_upload"
        )
        uploaded_vid2 = st.file_uploader(
            "🎥 Classroom Activity Video(s) 2",
            type=[
                "mp4",
                "mov",
                "avi",
                "pdf"
            ],
            accept_multiple_files=True,
            key="video2_upload"
        )
    with col_v2:
        uploaded_vid3 = st.file_uploader(
            "🎥 Classroom Activity Video(s) 3",
            type=[
                "mp4",
                "mov",
                "avi",
                "pdf"
            ],
            accept_multiple_files=True,
            key="video3_upload"
        )
        uploaded_writing = st.file_uploader(
            "📝 Upload Student Writing Sample(s)",
            type=[
                "pdf",
                "png",
                "jpg",
                "jpeg"
            ],
            accept_multiple_files=True,
            key="writing_upload"
        )
    # ========================================================
    # SPECIALIZED EVIDENCE
    # ========================================================
    st.subheader(
        "4. Specialized Phonics & Portfolio Evidences"
    )
    col_s1, col_s2 = st.columns(2)
    with col_s1:
        uploaded_phonics = st.file_uploader(
            "🔤 Phonics / Phonetics Implementation Evidence(s)",
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
            key="phonics_upload"
        )
    with col_s2:
        uploaded_portfolio = st.file_uploader(
            "📁 Teacher Portfolio Evidence(s)",
            type=[
                "pdf",
                "png",
                "jpg",
                "jpeg",
                "mp4"
            ],
            accept_multiple_files=True,
            key="portfolio_upload"
        )
    # ========================================================
    # SUBMIT
    # ========================================================
    submitted = st.form_submit_button(
        "🚀 Upload Evidence & Submit Log"
    )
    # ========================================================
    # SUBMISSION PROCESSING
    # ========================================================
    if submitted:
        # ----------------------------------------------------
        # VALIDATE REQUIRED FIELDS
        # ----------------------------------------------------
        if sub_state == "-- Select State / Zone --":
            st.error(
                "Please select a State / Zone above."
            )
            st.stop()
        if sub_consultant == "-- Select Consultant --":
            st.error(
                "Please select a Consultant Name above."
            )
            st.stop()
        if sub_school == "-- Select School --":
            st.error(
                "Please select a School Name above."
            )
            st.stop()
        if sub_teacher_name == "-- Select Your Name --":
            st.error(
                "Please select your name from the roster above."
            )
            st.stop()
        if not sub_lesson_num.strip():
            st.error(
                "Please provide the Chapter Name and "
                "Lesson Plan Number."
            )
            st.stop()
        # ====================================================
        # CREATE SUBMISSION ID
        # ====================================================
        submission_id = uuid.uuid4().hex[:12]
        # ====================================================
        # CREATE R2 FOLDER HIERARCHY
        # ====================================================
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
        # ====================================================
        # BUILD ALL UPLOAD JOBS
        # ====================================================
        upload_jobs = []
        def add_upload_jobs(
            files,
            folder
        ):
            if not files:
                return
            if not isinstance(files, list):
                files = [files]
            for file in files:
                upload_jobs.append(
                    (
                        file,
                        folder
                    )
                )
        add_upload_jobs(
            uploaded_voice,
            f"{submission_base}/voice_notes"
        )
        add_upload_jobs(
            uploaded_pic,
            f"{submission_base}/pictures"
        )
        add_upload_jobs(
            uploaded_vid1,
            f"{submission_base}/videos"
        )
        add_upload_jobs(
            uploaded_vid2,
            f"{submission_base}/videos"
        )
        add_upload_jobs(
            uploaded_vid3,
            f"{submission_base}/videos"
        )
        add_upload_jobs(
            uploaded_writing,
            f"{submission_base}/writing_samples"
        )
        add_upload_jobs(
            uploaded_phonics,
            f"{submission_base}/phonics_evidences"
        )
        add_upload_jobs(
            uploaded_portfolio,
            f"{submission_base}/portfolio_evidences"
        )
        # ====================================================
        # CHECK FILE SIZES BEFORE STARTING UPLOAD
        # ====================================================
        oversized_files = []
        for file, folder in upload_jobs:
            if file.size > MAX_FILE_SIZE_BYTES:
                oversized_files.append(
                    (
                        file.name,
                        file.size / (
                            1024 * 1024
                        )
                    )
                )
        if oversized_files:
            st.error(
                f"❌ Some files exceed the "
                f"{MAX_FILE_SIZE_MB} MB limit:"
            )
            for filename, size_mb in oversized_files:
                st.write(
                    f"• {filename}: "
                    f"{size_mb:.1f} MB"
                )
            st.warning(
                "Please remove or compress these files "
                "and submit again."
            )
            st.stop()
        # ====================================================
        # UPLOAD FILES
        # ====================================================
        uploaded_paths = []
        if upload_jobs:
            total_files = len(upload_jobs)
            progress_bar = st.progress(
                0
            )
            status_text = st.empty()
            with st.spinner(
                f"Uploading {total_files} file(s) "
                "using fast parallel upload..."
            ):
                # --------------------------------------------
                # FAST PARALLEL UPLOAD
                # --------------------------------------------
                upload_result = upload_files_parallel(
                    upload_jobs,
                    max_workers=5
                )
            progress_bar.progress(
                100
            )
            uploaded_paths = (
                upload_result["paths"]
            )
            # ------------------------------------------------
            # HANDLE FAILED UPLOADS
            # ------------------------------------------------
            if upload_result["errors"]:
                st.error(
                    "❌ One or more files could not be uploaded."
                )
                for error in upload_result["errors"]:
                    st.write(
                        f"• {error['file_name']}: "
                        f"{error['error']}"
                    )
                st.warning(
                    "The database submission was NOT created. "
                    "Please try again."
                )
                st.stop()
            status_text.success(
                f"✅ All {total_files} file(s) uploaded successfully."
            )
        else:
            st.info(
                "No evidence files were selected. "
                "Saving the lesson log only."
            )
        # ====================================================
        # MAP UPLOADED FILES TO DATABASE COLUMNS
        # ====================================================
        def get_paths_for_folder(
            folder_name
        ):
            prefix = (
                f"{submission_base}/{folder_name}/"
            )
            return [
                path
                for path in uploaded_paths
                if path.startswith(prefix)
            ]
        voice_paths = get_paths_for_folder(
            "voice_notes"
        )
        picture_paths = get_paths_for_folder(
            "pictures"
        )
        video_paths = get_paths_for_folder(
            "videos"
        )
        writing_paths = get_paths_for_folder(
            "writing_samples"
        )
        phonics_paths = get_paths_for_folder(
            "phonics_evidences"
        )
        portfolio_paths = get_paths_for_folder(
            "portfolio_evidences"
        )
        # ----------------------------------------------------
        # Store multiple object keys as comma-separated values
        # ----------------------------------------------------
        voice_url = (
            ", ".join(voice_paths)
            if voice_paths
            else None
        )
        pic_url = (
            ", ".join(picture_paths)
            if picture_paths
            else None
        )
        writing_url = (
            ", ".join(writing_paths)
            if writing_paths
            else None
        )
        phonics_url = (
            ", ".join(phonics_paths)
            if phonics_paths
            else None
        )
        portfolio_url = (
            ", ".join(portfolio_paths)
            if portfolio_paths
            else None
        )
        # ----------------------------------------------------
        # Separate videos into Video 1 / Video 2 / Video 3
        # ----------------------------------------------------
        video_url_1 = (
            video_paths[0]
            if len(video_paths) >= 1
            else None
        )
        video_url_2 = (
            video_paths[1]
            if len(video_paths) >= 2
            else None
        )
        video_url_3 = (
            video_paths[2]
            if len(video_paths) >= 3
            else None
        )
        # ====================================================
        # SPLIT TEACHER NAME
        # ====================================================
        name_parts = sub_teacher_name.split(
            " ",
            1
        )
        f_name = name_parts[0]
        l_name = (
            name_parts[1]
            if len(name_parts) > 1
            else ""
        )
        # ====================================================
        # DATABASE ENTRY
        # ====================================================
        entry_dict = {
            "State_Zone": sub_state,
            "Uploaded_By": sub_consultant,
            "Institution": sub_school,
            "Center": sub_school,
            "FirstName": f_name,
            "LastName": l_name,
            "FullName": sub_teacher_name,
            "Role": "teacher",
            "Type": "lessonDelivery",
            "Grade": sub_grade,
            "Subject": sub_subject,
            "Book": sub_lesson_num.strip(),
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
            # ----------------------------------------------
            # R2 OBJECT KEYS
            # ----------------------------------------------
            "Voice_Note_Link": voice_url,
            "Lesson_Plan_Picture": pic_url,
            "Video_Evidence_1": video_url_1,
            "Video_Evidence_2": video_url_2,
            "Video_Evidence_3": video_url_3,
            "Writing_Sample_Link": writing_url,
            "Phonics_Evidence_Link": phonics_url,
            "Portfolio_Evidence_Link": portfolio_url,
            "Assessment_Score_Pct": None
        }
        # ====================================================
        # SAVE TO SUPABASE
        # ====================================================
        with st.spinner(
            "Saving submission to database..."
        ):
            insert_submission_to_db(
                entry_dict
            )
        # ====================================================
        # SUCCESS
        # ====================================================
        st.success(
            f"✅ Success! Submission for "
            f"{sub_teacher_name} ({sub_school}) "
            f"has been saved and will appear in "
            f"the Admin Dashboard."
        )
        st.info(
            f"📁 Submission ID: "
            f"submission_{submission_id}"
        )
        if uploaded_paths:
            st.caption(
                f"☁️ {len(uploaded_paths)} file(s) "
                "uploaded to secure R2 storage."
            )

One important Streamlit setting

Because you specifically want a 50 MB maximum, I recommend also putting this in your Streamlit configuration:

[server]
maxUploadSize = 50

If you are deploying on Streamlit Community Cloud, create:

.streamlit/config.toml

and put the above inside it.

That gives you a true application-level limit instead of merely checking the size after the files reach the app.

What changes in speed?

Your old system was essentially:

File → Streamlit → getvalue() → upload → wait → next file → upload → wait…

The new system is:

File 1 ─┐
File 2 ─┤
File 3 ─┤ → parallel R2 uploads → Supabase
File 4 ─┤
File 5 ─┘

And each large file uses multipart transfer, so a 30–40 MB video is broken into chunks and uploaded concurrently by boto3.

One caveat: internet upload speed is still the ultimate limit. If a teacher has a 5 Mbps upload connection, no Python optimization can make a 30 MB video upload instantly. But this removes several unnecessary bottlenecks in your current implementation.

Also, don’t put the R2 access keys or secret key into this code directly—your existing st.secrets["r2"] approach is the correct one.
