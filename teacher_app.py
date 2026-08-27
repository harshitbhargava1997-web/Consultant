import streamlit as st
import pandas as pd
import numpy as np
import re
import concurrent.futures
from io import BytesIO
from supabase import create_client

st.set_page_config(page_title="Teacher Daily Evidence Portal", page_icon="📝", layout="centered")

# --- SUPABASE SETUP ---
try:
    SUPABASE_URL = st.secrets["supabase"]["url"].rstrip('/')
    SUPABASE_KEY = st.secrets["supabase"]["key"]
    BUCKET_NAME = st.secrets["supabase"]["bucket_name"]

    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
except Exception as e:
    st.error(f"⚠️ Cloud connection configuration is missing: {e}")

# Must match the Admin Dashboard's teacher_records schema exactly.
TEACHER_RECORDS_TABLE = "teacher_records"
ROSTER_COLUMNS = ["State_Zone", "Uploaded_By", "Institution", "FullName", "Role"]


@st.cache_data(ttl=300, show_spinner=False)
def fetch_master_db_from_supabase():
    """Fetches the live roster (State/Zone, Consultant, School, Teacher) directly
    from the same PostgreSQL 'teacher_records' table the Admin Dashboard reads from,
    so newly added schools/teachers (e.g. via the admin app's Excel bulk uploader)
    show up here immediately instead of relying on a stale parquet snapshot."""
    try:
        all_rows = []
        page_size = 1000
        start = 0
        while True:
            resp = (
                supabase.table(TEACHER_RECORDS_TABLE)
                .select(",".join(ROSTER_COLUMNS))
                .range(start, start + page_size - 1)
                .execute()
            )
            batch = resp.data or []
            all_rows.extend(batch)
            if len(batch) < page_size:
                break
            start += page_size

        if not all_rows:
            return pd.DataFrame(columns=ROSTER_COLUMNS)

        df = pd.DataFrame(all_rows)
        for col in ROSTER_COLUMNS:
            if col not in df.columns:
                df[col] = ""
            df[col] = df[col].fillna('').astype(str).str.replace(r'\s+', ' ', regex=True).str.strip()
        return df.drop_duplicates()
    except Exception as e:
        st.error(f"⚠️ Could not load roster from database: {e}")
        return pd.DataFrame(columns=ROSTER_COLUMNS)


def upload_single_file_worker(args):
    uploaded_file, folder_name = args
    try:
        clean_filename = re.sub(r'[^a-zA-Z0-9_.-]', '_', uploaded_file.name)
        file_path = f"{folder_name}/{np.random.randint(10000, 99999)}_{clean_filename}"
        file_bytes = uploaded_file.getvalue()

        supabase.storage.from_(BUCKET_NAME).upload(
            path=file_path,
            file=file_bytes,
            file_options={"upsert": "true", "content-type": uploaded_file.type}
        )
        return f"{SUPABASE_URL}/storage/v1/object/public/{BUCKET_NAME}/{file_path}"
    except Exception:
        return None


def upload_files_to_supabase(uploaded_files, folder_name="teacher_uploads"):
    """Uploads multiple files concurrently to Supabase Storage."""
    if not uploaded_files:
        return None
    if not isinstance(uploaded_files, list):
        uploaded_files = [uploaded_files]

    tasks = [(f, folder_name) for f in uploaded_files]
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
        results = list(executor.map(upload_single_file_worker, tasks))

    urls = [url for url in results if url is not None]
    return ", ".join(urls) if urls else None


def insert_submission_to_db(entry_dict):
    """Inserts a submission row directly into the SAME PostgreSQL table
    (teacher_records) that the Admin Dashboard reads from, so it appears
    immediately in Tab 4, the Live Evidence Feed, and all PDF reports —
    without needing any manual re-import step."""
    supabase.table(TEACHER_RECORDS_TABLE).insert(entry_dict).execute()


# --- LOAD MASTER ROSTER ---
master_df = fetch_master_db_from_supabase()

st.title("📝 Teacher Daily Evidence Portal")
st.markdown("Select your region, consultant, school, and name to submit lesson logs, qualitative media, phonics implementation evidence, and portfolio artifacts.")

# --- 1. DYNAMIC CASCADING SELECTION HIERARCHY ---
st.subheader("1. Region, Consultant & School Selection")

all_states = sorted([s for s in master_df['State_Zone'].unique() if s and s.lower() not in ['nan', 'none', '']]) if not master_df.empty and 'State_Zone' in master_df.columns else []
if not all_states:
    all_states = ["Madhya Pradesh (MP)"]

sub_state = st.selectbox("Select State / Zone *", options=["-- Select State / Zone --"] + all_states)

filtered_consultants = []
if sub_state != "-- Select State / Zone --" and not master_df.empty and 'Uploaded_By' in master_df.columns:
    c_subset = master_df[master_df['State_Zone'].str.lower() == sub_state.lower()]
    filtered_consultants = sorted([c for c in c_subset['Uploaded_By'].unique() if c and c.lower() not in ['nan', 'none', '']])

sub_consultant = st.selectbox(
    "Select Consultant / Academic Manager *",
    options=["-- Select Consultant --"] + filtered_consultants,
    help="Populates based on the selected state/zone."
)

filtered_schools = []
if sub_consultant != "-- Select Consultant --" and not master_df.empty and 'Institution' in master_df.columns:
    s_subset = master_df[
        (master_df['State_Zone'].str.lower() == sub_state.lower()) &
        (master_df['Uploaded_By'].str.lower() == sub_consultant.lower())
    ]
    filtered_schools = sorted([s for s in s_subset['Institution'].unique() if s and s.lower() not in ['nan', 'unknown school', 'default school', '']])

sub_school = st.selectbox(
    "Select School / Institution *",
    options=["-- Select School --"] + filtered_schools,
    help="Populates based on the selected consultant and state."
)

filtered_teachers = []
if sub_school != "-- Select School --" and not master_df.empty and 'FullName' in master_df.columns:
    t_subset = master_df[
        (master_df['State_Zone'].str.lower() == sub_state.lower()) &
        (master_df['Uploaded_By'].str.lower() == sub_consultant.lower()) &
        (master_df['Institution'].str.lower() == sub_school.lower())
    ]
    # Only show actual teachers in the roster dropdown -- exclude Principals,
    # Owners, Coordinators, or any other non-teacher roles that may share
    # the same teacher_records table.
    if 'Role' in t_subset.columns:
        role_lower = t_subset['Role'].astype(str).str.lower()
        teacher_mask = role_lower.isin(['teacher', 'teachers'])
        if teacher_mask.any():
            t_subset = t_subset[teacher_mask]
    raw_names = t_subset['FullName'].astype(str).unique().tolist()
    filtered_teachers = sorted([n for n in raw_names if n and n.lower() not in ['nan', 'unknown teacher', 'none', '']])

sub_teacher_name = st.selectbox(
    "Select Your Name *", 
    options=["-- Select Your Name --"] + filtered_teachers,
    help="Populates based on the selected school roster."
)

# --- 2. SUBMISSION FORM ---
with st.form("evidence_submission_form", clear_on_submit=True):
    sub_date = st.date_input("Submission Date *")

    st.subheader("2. Academic Lesson Details")
    col_a1, col_a2 = st.columns(2)
    with col_a1:
        grade_options = ["Nursery", "LKG", "UKG", "Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5"]
        sub_grade = st.selectbox("Select Grade *", options=grade_options)
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
        sub_subject = st.selectbox("Select Subject *", options=subject_options)

    sub_lesson_num = st.text_input("Chapter Name and Lesson Plan Number (e.g., Chapter 2 - Plants / Lesson Plan #4) *")

    st.info("📌 **Note:** You can upload **multiple files** (images, videos, audio notes, or PDFs) across all sections below simultaneously.")

    st.subheader("3. Core Qualitative Evidence Uploads")
    uploaded_voice = st.file_uploader("🎤 Upload Lesson Plan Voice Note(s) (Audio / PDF)", type=["mp3", "wav", "m4a", "ogg", "pdf"], accept_multiple_files=True)
    uploaded_pic = st.file_uploader("🖼️ Upload Lesson Plan Picture(s) / Document(s)", type=["png", "jpg", "jpeg", "pdf"], accept_multiple_files=True)

    col_v1, col_v2 = st.columns(2)
    with col_v1:
        uploaded_vid1 = st.file_uploader("🎥 Classroom Activity Video(s) 1", type=["mp4", "mov", "avi", "pdf"], accept_multiple_files=True)
        uploaded_vid2 = st.file_uploader("🎥 Classroom Activity Video(s) 2", type=["mp4", "mov", "avi", "pdf"], accept_multiple_files=True)
    with col_v2:
        uploaded_vid3 = st.file_uploader("🎥 Classroom Activity Video(s) 3", type=["mp4", "mov", "avi", "pdf"], accept_multiple_files=True)
        uploaded_writing = st.file_uploader("📝 Upload Student Writing Sample(s)", type=["pdf", "png", "jpg", "jpeg"], accept_multiple_files=True)

    st.subheader("4. Specialized Phonics & Portfolio Evidences")
    col_s1, col_s2 = st.columns(2)
    with col_s1:
        uploaded_phonics = st.file_uploader("🔤 Phonics / Phonetics Implementation Evidence(s)", type=["mp4", "mov", "mp3", "wav", "png", "jpg", "jpeg", "pdf"], accept_multiple_files=True)
    with col_s2:
        uploaded_portfolio = st.file_uploader("📁 Teacher Portfolio Evidence(s)", type=["pdf", "png", "jpg", "jpeg", "mp4"], accept_multiple_files=True)

    submitted = st.form_submit_button("🚀 Upload Evidence & Submit Log")

    if submitted:
        if sub_state == "-- Select State / Zone --":
            st.error("Please select a State / Zone above.")
        elif sub_consultant == "-- Select Consultant --":
            st.error("Please select a Consultant Name above.")
        elif sub_school == "-- Select School --":
            st.error("Please select a School Name above.")
        elif sub_teacher_name == "-- Select Your Name --":
            st.error("Please select your name from the roster above.")
        elif not sub_lesson_num.strip():
            st.error("Please provide the Chapter Name and Lesson Plan Number.")
        else:
            try:
                with st.spinner("Uploading evidence files securely to storage..."):
                    voice_url = upload_files_to_supabase(uploaded_voice, "voice_notes")
                    pic_url = upload_files_to_supabase(uploaded_pic, "pictures")
                    vid1_url = upload_files_to_supabase(uploaded_vid1, "videos")
                    vid2_url = upload_files_to_supabase(uploaded_vid2, "videos")
                    vid3_url = upload_files_to_supabase(uploaded_vid3, "videos")
                    writing_url = upload_files_to_supabase(uploaded_writing, "writing_samples")
                    phonics_url = upload_files_to_supabase(uploaded_phonics, "phonics_evidences")
                    portfolio_url = upload_files_to_supabase(uploaded_portfolio, "portfolio_evidences")

                name_parts = sub_teacher_name.split(" ", 1)
                f_name = name_parts[0]
                l_name = name_parts[1] if len(name_parts) > 1 else ""

                # NOTE: keys here must exactly match the columns the Admin Dashboard's
                # teacher_records table actually has. Do NOT add 'Duration (Minutes)' or
                # 'Duration (HH:MM:SS)' — those are Excel-import-only helper columns,
                # not real database columns, and including them will make this insert fail.
                entry_dict = {
                    'State_Zone': sub_state,
                    'Uploaded_By': sub_consultant,
                    'Institution': sub_school,
                    'Center': sub_school,
                    'FirstName': f_name,
                    'LastName': l_name,
                    'FullName': sub_teacher_name,
                    'Role': 'teacher',
                    'Type': 'lessonDelivery',
                    'Grade': sub_grade,
                    'Subject': sub_subject,
                    'Book': sub_lesson_num.strip(),
                    'StartTime': pd.to_datetime(sub_date).strftime('%Y-%m-%d 09:00:00'),
                    'EndTime': pd.to_datetime(sub_date).strftime('%Y-%m-%d 09:45:00'),
                    'Duration_Min': 0.0,
                    'Voice_Note_Link': voice_url,
                    'Lesson_Plan_Picture': pic_url,
                    'Video_Evidence_1': vid1_url,
                    'Video_Evidence_2': vid2_url,
                    'Video_Evidence_3': vid3_url,
                    'Writing_Sample_Link': writing_url,
                    'Phonics_Evidence_Link': phonics_url,
                    'Portfolio_Evidence_Link': portfolio_url,
                    'Assessment_Score_Pct': None
                }

                with st.spinner("Saving submission to database..."):
                    insert_submission_to_db(entry_dict)

                st.success(f"✅ Success! Submission for {sub_teacher_name} ({sub_school}) has been saved and will appear in the Admin Dashboard.")
            except Exception as e:
                st.error(f"❌ Upload and submission error: {e}")
