import streamlit as st
import pandas as pd
import numpy as np
import re
import concurrent.futures
import uuid
import boto3

from supabase import create_client
from botocore.exceptions import ClientError, BotoCoreError


# =========================================================
# PAGE CONFIGURATION
# =========================================================

st.set_page_config(
    page_title="Teacher Daily Evidence Portal",
    page_icon="📝",
    layout="centered"
)


# =========================================================
# SUPABASE SETUP
# =========================================================

try:
    SUPABASE_URL = st.secrets["supabase"]["url"].rstrip("/")
    SUPABASE_KEY = st.secrets["supabase"]["key"]

    supabase = create_client(
        SUPABASE_URL,
        SUPABASE_KEY
    )

except Exception as e:
    st.error(
        f"⚠️ Supabase database configuration is missing: {e}"
    )
    st.stop()


# =========================================================
# CLOUDFLARE R2 SETUP
# =========================================================

try:
    r2_secrets = st.secrets["r2"]

    R2_ACCOUNT_ID = r2_secrets["R2_ACCOUNT_ID"]
    R2_ACCESS_KEY_ID = r2_secrets["R2_ACCESS_KEY_ID"]
    R2_SECRET_ACCESS_KEY = r2_secrets["R2_SECRET_ACCESS_KEY"]
    R2_BUCKET_NAME = r2_secrets["R2_BUCKET_NAME"]
    R2_ENDPOINT_URL = r2_secrets["R2_ENDPOINT_URL"]

except Exception as e:
    st.error(
        f"⚠️ Cloudflare R2 configuration is missing: {e}"
    )
    st.stop()


# Create R2 client
try:

    r2 = boto3.client(
        "s3",
        endpoint_url=R2_ENDPOINT_URL,
        aws_access_key_id=R2_ACCESS_KEY_ID,
        aws_secret_access_key=R2_SECRET_ACCESS_KEY,
        region_name="auto",
    )

except Exception as e:

    st.error(
        f"⚠️ Could not connect to Cloudflare R2: {e}"
    )

    st.stop()


# =========================================================
# DATABASE TABLE
# =========================================================

TEACHER_RECORDS_TABLE = "teacher_records"

ROSTER_COLUMNS = [
    "State_Zone",
    "Uploaded_By",
    "Institution",
    "FullName",
    "Role"
]


# =========================================================
# FETCH MASTER ROSTER
# =========================================================

@st.cache_data(ttl=300, show_spinner=False)
def fetch_master_db_from_supabase():

    """
    Fetches the live roster from the same PostgreSQL
    teacher_records table used by the Admin Dashboard.
    """

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


# =========================================================
# R2 SINGLE FILE UPLOAD
# =========================================================

def upload_single_file_worker(args):

    """
    Uploads one file to Cloudflare R2.

    Returns:
        R2 object key if successful
        None if upload fails
    """

    uploaded_file, folder_name = args

    try:

        # Clean original filename
        clean_filename = re.sub(
            r"[^a-zA-Z0-9_.-]",
            "_",
            uploaded_file.name
        )

        # Unique ID prevents filename collisions
        unique_id = uuid.uuid4().hex[:12]

        # Example:
        # voice_notes/a83f29d1c4e2_lesson_note.m4a
        file_path = (
            f"{folder_name}/"
            f"{unique_id}_"
            f"{clean_filename}"
        )

        file_bytes = uploaded_file.getvalue()


        # Upload to Cloudflare R2
        r2.put_object(
            Bucket=R2_BUCKET_NAME,
            Key=file_path,
            Body=file_bytes,
            ContentType=uploaded_file.type or "application/octet-stream"
        )


        # IMPORTANT:
        # We return the R2 OBJECT KEY, not a public URL.
        return file_path


    except Exception as e:

        print(
            f"R2 upload failed for "
            f"{getattr(uploaded_file, 'name', 'unknown file')}: "
            f"{e}"
        )

        return None


# =========================================================
# MULTIPLE FILE UPLOAD TO R2
# =========================================================

def upload_files_to_r2(
    uploaded_files,
    folder_name="teacher_uploads"
):

    """
    Uploads multiple files concurrently to Cloudflare R2.

    Returns:
        Comma-separated R2 object keys.
    """

    if not uploaded_files:
        return None


    if not isinstance(uploaded_files, list):
        uploaded_files = [uploaded_files]


    tasks = [
        (f, folder_name)
        for f in uploaded_files
    ]


    with concurrent.futures.ThreadPoolExecutor(
        max_workers=5
    ) as executor:

        results = list(
            executor.map(
                upload_single_file_worker,
                tasks
            )
        )


    # Keep only successful uploads
    r2_paths = [
        path
        for path in results
        if path is not None
    ]


    if not r2_paths:
        return None


    return ", ".join(r2_paths)


# =========================================================
# INSERT SUBMISSION INTO SUPABASE DATABASE
# =========================================================

def insert_submission_to_db(entry_dict):

    """
    Inserts the submission record into the SAME
    PostgreSQL teacher_records table used by
    the Admin Dashboard.
    """

    supabase \
        .table(TEACHER_RECORDS_TABLE) \
        .insert(entry_dict) \
        .execute()


# =========================================================
# LOAD MASTER ROSTER
# =========================================================

master_df = fetch_master_db_from_supabase()


# =========================================================
# PAGE TITLE
# =========================================================

st.title(
    "📝 Teacher Daily Evidence Portal"
)

st.markdown(
    "Select your region, consultant, school, and name "
    "to submit lesson logs, qualitative media, "
    "phonics implementation evidence, and portfolio artifacts."
)


# =========================================================
# 1. DYNAMIC CASCADING SELECTION
# =========================================================

st.subheader(
    "1. Region, Consultant & School Selection"
)


# ---------------------------------------------------------
# STATE / ZONE
# ---------------------------------------------------------

all_states = (
    sorted([
        s
        for s in master_df["State_Zone"].unique()
        if s
        and s.lower() not in [
            "nan",
            "none",
            ""
        ]
    ])
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


# ---------------------------------------------------------
# CONSULTANT
# ---------------------------------------------------------

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


    filtered_consultants = sorted([
        c
        for c in c_subset["Uploaded_By"].unique()
        if c
        and c.lower() not in [
            "nan",
            "none",
            ""
        ]
    ])


sub_consultant = st.selectbox(
    "Select Consultant / Academic Manager *",
    options=[
        "-- Select Consultant --"
    ] + filtered_consultants,
    help="Populates based on the selected state/zone."
)


# ---------------------------------------------------------
# SCHOOL
# ---------------------------------------------------------

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


    filtered_schools = sorted([
        s
        for s in s_subset["Institution"].unique()
        if s
        and s.lower() not in [
            "nan",
            "unknown school",
            "default school",
            ""
        ]
    ])


sub_school = st.selectbox(
    "Select School / Institution *",
    options=[
        "-- Select School --"
    ] + filtered_schools,
    help="Populates based on the selected consultant and state."
)


# ---------------------------------------------------------
# TEACHER
# ---------------------------------------------------------

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


    # Only show actual teachers
    if "Role" in t_subset.columns:

        role_lower = (
            t_subset["Role"]
            .astype(str)
            .str.lower()
        )

        teacher_mask = role_lower.isin([
            "teacher",
            "teachers"
        ])

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


    filtered_teachers = sorted([
        n
        for n in raw_names
        if n
        and n.lower() not in [
            "nan",
            "unknown teacher",
            "none",
            ""
        ]
    ])


sub_teacher_name = st.selectbox(
    "Select Your Name *",
    options=[
        "-- Select Your Name --"
    ] + filtered_teachers,
    help="Populates based on the selected school roster."
)


# =========================================================
# 2. SUBMISSION FORM
# =========================================================

with st.form(
    "evidence_submission_form",
    clear_on_submit=True
):

    sub_date = st.date_input(
        "Submission Date *"
    )


    # -----------------------------------------------------
    # ACADEMIC DETAILS
    # -----------------------------------------------------

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
        "📌 **Note:** You can upload **multiple files** "
        "(images, videos, audio notes, or PDFs) across "
        "all sections below simultaneously."
    )


    # -----------------------------------------------------
    # CORE EVIDENCE
    # -----------------------------------------------------

    st.subheader(
        "3. Core Qualitative Evidence Uploads"
    )


    uploaded_voice = st.file_uploader(
        "🎤 Upload Lesson Plan Voice Note(s) (Audio / PDF)",
        type=[
            "mp3",
            "wav",
            "m4a",
            "ogg",
            "pdf"
        ],
        accept_multiple_files=True
    )


    uploaded_pic = st.file_uploader(
        "🖼️ Upload Lesson Plan Picture(s) / Document(s)",
        type=[
            "png",
            "jpg",
            "jpeg",
            "pdf"
        ],
        accept_multiple_files=True
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
            accept_multiple_files=True
        )


        uploaded_vid2 = st.file_uploader(
            "🎥 Classroom Activity Video(s) 2",
            type=[
                "mp4",
                "mov",
                "avi",
                "pdf"
            ],
            accept_multiple_files=True
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
            accept_multiple_files=True
        )


        uploaded_writing = st.file_uploader(
            "📝 Upload Student Writing Sample(s)",
            type=[
                "pdf",
                "png",
                "jpg",
                "jpeg"
            ],
            accept_multiple_files=True
        )


    # -----------------------------------------------------
    # PHONICS & PORTFOLIO
    # -----------------------------------------------------

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
            accept_multiple_files=True
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
            accept_multiple_files=True
        )


    # -----------------------------------------------------
    # SUBMIT
    # -----------------------------------------------------

    submitted = st.form_submit_button(
        "🚀 Upload Evidence & Submit Log"
    )


    # =====================================================
    # PROCESS SUBMISSION
    # =====================================================

    if submitted:

        # -------------------------------------------------
        # VALIDATION
        # -------------------------------------------------

        if sub_state == "-- Select State / Zone --":

            st.error(
                "Please select a State / Zone above."
            )

        elif sub_consultant == "-- Select Consultant --":

            st.error(
                "Please select a Consultant Name above."
            )

        elif sub_school == "-- Select School --":

            st.error(
                "Please select a School Name above."
            )

        elif sub_teacher_name == "-- Select Your Name --":

            st.error(
                "Please select your name from the roster above."
            )

        elif not sub_lesson_num.strip():

            st.error(
                "Please provide the Chapter Name and Lesson Plan Number."
            )

        else:

            try:

                # =========================================
                # UPLOAD ALL MEDIA TO R2
                # =========================================

                with st.spinner(
                    "☁️ Uploading evidence files securely to Cloudflare R2..."
                ):

                    voice_url = upload_files_to_r2(
                        uploaded_voice,
                        "voice_notes"
                    )


                    pic_url = upload_files_to_r2(
                        uploaded_pic,
                        "pictures"
                    )


                    vid1_url = upload_files_to_r2(
                        uploaded_vid1,
                        "videos"
                    )


                    vid2_url = upload_files_to_r2(
                        uploaded_vid2,
                        "videos"
                    )


                    vid3_url = upload_files_to_r2(
                        uploaded_vid3,
                        "videos"
                    )


                    writing_url = upload_files_to_r2(
                        uploaded_writing,
                        "writing_samples"
                    )


                    phonics_url = upload_files_to_r2(
                        uploaded_phonics,
                        "phonics_evidences"
                    )


                    portfolio_url = upload_files_to_r2(
                        uploaded_portfolio,
                        "portfolio_evidences"
                    )


                # =========================================
                # NAME SPLIT
                # =========================================

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


                # =========================================
                # DATABASE ENTRY
                # =========================================

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

                    "StartTime": (
                        pd.to_datetime(sub_date)
                        .strftime(
                            "%Y-%m-%d 09:00:00"
                        )
                    ),

                    "EndTime": (
                        pd.to_datetime(sub_date)
                        .strftime(
                            "%Y-%m-%d 09:45:00"
                        )
                    ),

                    "Duration_Min": 0.0,

                    # R2 OBJECT PATHS
                    "Voice_Note_Link": voice_url,

                    "Lesson_Plan_Picture": pic_url,

                    "Video_Evidence_1": vid1_url,

                    "Video_Evidence_2": vid2_url,

                    "Video_Evidence_3": vid3_url,

                    "Writing_Sample_Link": writing_url,

                    "Phonics_Evidence_Link": phonics_url,

                    "Portfolio_Evidence_Link": portfolio_url,

                    "Assessment_Score_Pct": None
                }


                # =========================================
                # SAVE DATABASE RECORD
                # =========================================

                with st.spinner(
                    "💾 Saving submission to database..."
                ):

                    insert_submission_to_db(
                        entry_dict
                    )


                # =========================================
                # SUCCESS
                # =========================================

                st.success(
                    f"✅ Success! Submission for "
                    f"{sub_teacher_name} "
                    f"({sub_school}) has been saved."
                )


                st.info(
                    "☁️ Your evidence files have been "
                    "stored securely in Cloudflare R2, "
                    "while the submission details have "
                    "been saved in the database."
                )


            except ClientError as e:

                st.error(
                    "❌ Cloudflare R2 upload error."
                )

                error = e.response.get(
                    "Error",
                    {}
                )

                st.write(
                    "**Error Code:**",
                    error.get("Code")
                )

                st.write(
                    "**Message:**",
                    error.get("Message")
                )


            except BotoCoreError as e:

                st.error(
                    "❌ Cloudflare R2 connection error."
                )

                st.code(str(e))


            except Exception as e:

                st.error(
                    f"❌ Upload and submission error: {e}"
                )
