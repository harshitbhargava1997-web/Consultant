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

# Number of files uploaded simultaneously
MAX_PARALLEL_UPLOADS = 5

# Files larger than 8 MB use multipart upload
R2_MULTIPART_THRESHOLD = 8 * 1024 * 1024
R2_MULTIPART_CHUNK_SIZE = 8 * 1024 * 1024


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
# R2 MULTIPART TRANSFER CONFIGURATION
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
# FETCH MASTER ROSTER
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
            f"⚠️ Could not load roster from database: {e}"
        )

        return pd.DataFrame(
            columns=ROSTER_COLUMNS
        )


# ============================================================
# SANITIZE R2 PATH
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
# VALIDATE FILE SIZE
# ============================================================

def file_size_mb(uploaded_file):

    return uploaded_file.size / (
        1024 * 1024
    )


def validate_all_files(upload_jobs):

    oversized = []

    for uploaded_file, folder in upload_jobs:

        if uploaded_file.size > MAX_FILE_SIZE_BYTES:

            oversized.append(
                (
                    uploaded_file.name,
                    file_size_mb(uploaded_file)
                )
            )

    return oversized


# ============================================================
# SINGLE R2 FILE UPLOAD
# ============================================================

def upload_single_file_worker(args):

    uploaded_file, folder_name = args

    try:

        # ----------------------------------------------------
        # Validate file size
        # ----------------------------------------------------

        if uploaded_file.size > MAX_FILE_SIZE_BYTES:

            return {
                "success": False,
                "file_name": uploaded_file.name,
                "path": None,
                "error": (
                    f"File exceeds "
                    f"{MAX_FILE_SIZE_MB} MB limit."
                )
            }


        # ----------------------------------------------------
        # Sanitize filename
        # ----------------------------------------------------

        clean_filename = re.sub(
            r"[^a-zA-Z0-9_.-]",
            "_",
            uploaded_file.name
        )


        # ----------------------------------------------------
        # Create unique filename
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
        # IMPORTANT
        #
        # Do not use uploaded_file.getvalue().
        # Upload directly from the file object.
        # ----------------------------------------------------

        uploaded_file.seek(0)


        # ----------------------------------------------------
        # MULTIPART / STREAMING UPLOAD
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
# PARALLEL R2 UPLOAD
# ============================================================

def upload_files_parallel(upload_jobs):

    if not upload_jobs:

        return {
            "success": True,
            "paths": [],
            "errors": []
        }


    with concurrent.futures.ThreadPoolExecutor(
        max_workers=MAX_PARALLEL_UPLOADS
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
# INSERT INTO SUPABASE
# ============================================================

def insert_submission_to_db(entry_dict):

    return (
        supabase
        .table(TEACHER_RECORDS_TABLE)
        .insert(entry_dict)
        .execute()
    )


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
    "Multiple files can be uploaded in one submission."
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
        f"📌 Multiple files are allowed. "
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
    # SUBMIT BUTTON
    # ========================================================

    submitted = st.form_submit_button(
        "🚀 Upload Evidence & Submit Log"
    )


    # ========================================================
    # PROCESS SUBMISSION
    # ========================================================

    if submitted:


        # ====================================================
        # REQUIRED FIELD VALIDATION
        # ====================================================

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
        # CREATE R2 FOLDER STRUCTURE
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
        # BUILD UPLOAD JOBS
        #
        # Each job contains:
        #
        # 1. File
        # 2. R2 folder
        # 3. Evidence category
        # ====================================================

        upload_jobs = []


        def add_upload_jobs(
            files,
            folder,
            category
        ):

            if not files:
                return

            if not isinstance(files, list):

                files = [files]

            for file in files:

                upload_jobs.append(
                    (
                        file,
                        folder,
                        category
                    )
                )


        add_upload_jobs(
            uploaded_voice,
            f"{submission_base}/voice_notes",
            "voice"
        )


        add_upload_jobs(
            uploaded_pic,
            f"{submission_base}/pictures",
            "picture"
        )


        add_upload_jobs(
            uploaded_vid1,
            f"{submission_base}/videos",
            "video1"
        )


        add_upload_jobs(
            uploaded_vid2,
            f"{submission_base}/videos",
            "video2"
        )


        add_upload_jobs(
            uploaded_vid3,
            f"{submission_base}/videos",
            "video3"
        )


        add_upload_jobs(
            uploaded_writing,
            f"{submission_base}/writing_samples",
            "writing"
        )


        add_upload_jobs(
            uploaded_phonics,
            f"{submission_base}/phonics_evidences",
            "phonics"
        )


        add_upload_jobs(
            uploaded_portfolio,
            f"{submission_base}/portfolio_evidences",
            "portfolio"
        )


        # ====================================================
        # VALIDATE 50 MB LIMIT
        # ====================================================

        oversized_files = []

        for file, folder, category in upload_jobs:

            if file.size > MAX_FILE_SIZE_BYTES:

                oversized_files.append(
                    (
                        file.name,
                        file_size_mb(file)
                    )
                )


        if oversized_files:

            st.error(
                f"❌ File size limit exceeded. "
                f"Maximum allowed size is "
                f"{MAX_FILE_SIZE_MB} MB per file."
            )

            for filename, size_mb in oversized_files:

                st.write(
                    f"• {filename} — "
                    f"{size_mb:.1f} MB"
                )

            st.warning(
                "Please remove or compress the oversized "
                "file(s) and submit again."
            )

            st.stop()


        # ====================================================
        # PREPARE SIMPLE JOBS FOR UPLOAD WORKERS
        # ====================================================

        worker_jobs = [
            (
                file,
                folder
            )
            for file, folder, category
            in upload_jobs
        ]


        # ====================================================
        # UPLOAD ALL FILES IN PARALLEL
        # ====================================================

        uploaded_paths = []


        if worker_jobs:

            total_files = len(worker_jobs)

            progress = st.progress(
                0
            )

            status = st.empty()


            status.info(
                f"⚡ Uploading {total_files} file(s) "
                f"using fast parallel multipart upload..."
            )


            upload_result = upload_files_parallel(
                worker_jobs
            )


            progress.progress(
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
                    "❌ Some files could not be uploaded."
                )

                for error in upload_result["errors"]:

                    st.write(
                        f"• {error['file_name']}: "
                        f"{error['error']}"
                    )

                st.warning(
                    "The database record was NOT created. "
                    "Please try submitting again."
                )

                st.stop()


            status.success(
                f"✅ All {total_files} file(s) "
                "uploaded successfully."
            )


        else:

            st.info(
                "No evidence files selected. "
                "Saving the lesson log only."
            )


        # ====================================================
        # IDENTIFY FILES BY FOLDER
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


        # ====================================================
        # MULTIPLE FILE OBJECT KEYS
        # ====================================================

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


        # ====================================================
        # PRESERVE VIDEO 1 / VIDEO 2 / VIDEO 3
        # ====================================================

        video1_paths = []

        video2_paths = []

        video3_paths = []


        for file, folder, category in upload_jobs:

            if category == "video1":

                matching_paths = [
                    path
                    for path in uploaded_paths
                    if path.startswith(
                        f"{folder}/"
                    )
                    and path.endswith(
                        re.sub(
                            r"[^a-zA-Z0-9_.-]",
                            "_",
                            file.name
                        )
                    )
                ]

                video1_paths.extend(
                    matching_paths
                )


            elif category == "video2":

                matching_paths = [
                    path
                    for path in uploaded_paths
                    if path.startswith(
                        f"{folder}/"
                    )
                    and path.endswith(
                        re.sub(
                            r"[^a-zA-Z0-9_.-]",
                            "_",
                            file.name
                        )
                    )
                ]

                video2_paths.extend(
                    matching_paths
                )


            elif category == "video3":

                matching_paths = [
                    path
                    for path in uploaded_paths
                    if path.startswith(
                        f"{folder}/"
                    )
                    and path.endswith(
                        re.sub(
                            r"[^a-zA-Z0-9_.-]",
                            "_",
                            file.name
                        )
                    )
                ]

                video3_paths.extend(
                    matching_paths
                )


        video_url_1 = (
            ", ".join(video1_paths)
            if video1_paths
            else None
        )


        video_url_2 = (
            ", ".join(video2_paths)
            if video2_paths
            else None
        )


        video_url_3 = (
            ", ".join(video3_paths)
            if video3_paths
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

            # R2 OBJECT KEYS
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
        # SUCCESS MESSAGE
        # ====================================================

        st.success(
            f"✅ Success! Submission for "
            f"{sub_teacher_name} ({sub_school}) "
            "has been saved and will appear in "
            "the Admin Dashboard."
        )


        st.info(
            f"📁 Submission ID: "
            f"submission_{submission_id}"
        )


        if uploaded_paths:

            st.caption(
                f"☁️ {len(uploaded_paths)} file(s) "
                "uploaded to Cloudflare R2."
            )
