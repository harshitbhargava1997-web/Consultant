import streamlit as st
import pandas as pd
import numpy as np
import plotly.express as px
import plotly.graph_objects as go
import os
import re
import json
import uuid
import hashlib
import urllib.parse
import time
from io import BytesIO
from sqlalchemy import text
from supabase import create_client
from pydantic import BaseModel, Field
from typing import List, Literal

# Google GenAI SDK (Requires package 'google-genai')
from google import genai
from google.genai import errors

# ReportLab PDF Libraries
from reportlab.lib.pagesizes import letter
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable, PageBreak
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors

# Page layout configuration
st.set_page_config(page_title="Academic Manager Portfolio & Teacher Performance Indicator Review Dashboard", layout="wide")

# --- NATIVE POSTGRESQL & SUPABASE CLOUD SETUP ---
conn = st.connection("postgresql", type="sql")

try:
    SUPABASE_URL = st.secrets["supabase"]["url"].rstrip('/')
    SUPABASE_KEY = st.secrets["supabase"]["key"]
    BUCKET_NAME = st.secrets["supabase"]["bucket_name"]
    CRM_FILE_NAME = "school_crm_data.json"
    CALL_LOGS_FILE_NAME = "school_call_logs_store.json"
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
except Exception as e:
    st.error(f"Supabase credentials missing or misconfigured in Streamlit Secrets: {e}")

# --- CLOUDFLARE R2 (PUBLIC EVIDENCE BUCKET) SETUP ---
R2_ENABLED = False
try:
    R2_PUBLIC_BASE_URL = st.secrets["r2"]["public_base_url"].rstrip('/')
    R2_ENABLED = True
except Exception as e:
    R2_PUBLIC_BASE_URL = None
    st.warning(f"R2 public base URL missing or misconfigured in Streamlit Secrets — evidence files will not load: {e}")

try:
    GEMINI_API_KEY = st.secrets["gemini"]["api_key"]
    ai_client = genai.Client(api_key=GEMINI_API_KEY)
except Exception:
    ai_client = None

# --- 12 PARAMETER CLASSROOM OBSERVATION RUBRIC DEFINITIONS ---
OBSERVATION_RUBRIC_CONFIG = {
    "Lesson plan": {
        "A": "The teacher modifies the OneLern lesson plan and adds their input and suggestions.",
        "B": "The teacher follows the lesson plan exactly as recommended by OneLern.",
        "C": "The teacher does not refer to the OneLern lesson plans and conducts the class impromptu."
    },
    "Material and resource management": {
        "A": "The Teacher is well-prepared and previews the OneLern print and digital resources before the class. Adds additional resources to the plan.",
        "B": "The Teacher is well-prepared and previews the OneLern print and digital resources before the class. But does not make further additions.",
        "C": "The teacher does not seem prepared and has not previewed the print and digital assets."
    },
    "Pedagogy": {
        "A": "Creates an active, engaging, collaborative, and student-centered environment. Connects real-life experiences to the content.",
        "B": "Creates a student-centred classroom but is unable to stimulate the student's interest.",
        "C": "The class is mostly teacher-centered and students do not have the opportunity to be active participants."
    },
    "Warm-Up and Wrap-Up": {
        "A": "Always starts with a quick recap of previous knowledge, closes by summarizing key points, and adds custom thoughts to the task.",
        "B": "Starts by recapitulating the previous class and ends with a quick summary strictly following OneLern recommendations.",
        "C": "Does not pay too much attention to warm-up or wrap-up activities. Main focus is on completing the plan."
    },
    "Comprehension checks and Interaction": {
        "A": "Comprehension checks at regular intervals. Encourages healthy debates and discussion by asking probing questions.",
        "B": "Asks questions as recommended in books and lesson plans. However, does not engage in deep discussions.",
        "C": "Does not encourage questions, and does not allow students to have opinions or discussions."
    },
    "Digital Preparedness": {
        "A": "Comfortable with using the digital content and tools seamlessly along with the print content provided.",
        "B": "Uses the content effectively and uses some of the tools.",
        "C": "Needs more support in managing the digital tools and content provided."
    },
    "Classroom instruction": {
        "A": "The instructions are clear, precise and communicated properly.",
        "B": "The instructions are clear but need further explanation.",
        "C": "The instructions need to be more clear and more precise."
    },
    "Discussion and Interaction with students": {
        "A": "Able to stimulate curiosity in learners and encourages students to engage in discussions and share independent viewpoints.",
        "B": "Creates a conducive environment with basic interaction with learners.",
        "C": "Focuses on only completing book content. Limited interaction with learners."
    },
    "Classroom Management while conducting the class": {
        "A": "Shares good rapport with students and conducts all activities easily. Manages discipline and learner interest.",
        "B": "Comfortable with students, however, is unable to conduct activities with ease.",
        "C": "Does not connect with students and is unable to conduct activities comfortably."
    },
    "Feedback to students (Coursebook, Workbook, Notebook)": {
        "A": "Constructive and timely feedback on student work. Tracks improvement, follows differentiated practices and remedial classes.",
        "B": "Targeted and timely feedback on student work.",
        "C": "Provides general feedback on student work. Course material not checked."
    },
    "Student Portfolio & Assessment Booklet": {
        "A": "Portfolio and Assessment Booklet are updated regularly and used during teaching.",
        "B": "Portfolio and Assessment Booklet are available but updated irregularly.",
        "C": "Portfolio and Assessment Booklet are not maintained or used."
    },
    "Learning Outcome": {
        "A": "Most students achieve the lesson objective. Students confidently demonstrate understanding through responses or classwork.",
        "B": "Some students achieve the lesson objective and demonstrate understanding.",
        "C": "Few students achieve the lesson objective. Students struggle to demonstrate understanding."
    }
}


def _norm_text(value):
    if pd.isna(value):
        return ""
    return re.sub(r"\s+", " ", str(value)).strip()[span_0](start_span)[span_0](end_span)


def _norm_key(value):
    return _norm_text(value).casefold()[span_1](start_span)[span_1](end_span)


def compute_record_hash(row):
    def _s(v):
        if v is None or (isinstance(v, float) and pd.isna(v)) or pd.isna(v):
            return ""
        return _norm_key(v)

    def _t(v):
        ts = pd.to_datetime(v, errors='coerce')
        return "" if pd.isna(ts) else ts.strftime("%Y-%m-%d %H:%M:%S")

    def _n(v):
        try:
            if v is None or pd.isna(v):
                return "0.00"
            return f"{float(v):.2f}"
        except (TypeError, ValueError):
            return "0.00"

    parts = [
        _s(row.get("Uploaded_By")), _s(row.get("FullName")), _s(row.get("Institution")),
        _s(row.get("Center")), _s(row.get("Type")), _s(row.get("Grade")),
        _s(row.get("Subject")), _s(row.get("Book")),
        _t(row.get("StartTime")), _t(row.get("EndTime")), _n(row.get("Duration_Min")),
    ]
    return hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()[span_2](start_span)[span_2](end_span)


def normalize_identity_columns(df):
    if df is None:
        return pd.DataFrame()
    out = df.copy()

    col_map = {}
    for c in list(out.columns):
        c_low = str(c).strip().lower()
        if c_low in ['institution', 'school', 'school name', 'schoolname']:
            col_map[c] = 'Institution'
        elif c_low in ['center', 'centre']:
            col_map[c] = 'Center'
        elif c_low in ['firstname', 'first name']:
            col_map[c] = 'FirstName'
        elif c_low in ['lastname', 'last name']:
            col_map[c] = 'LastName'
        elif c_low in ['fullname', 'full name', 'teacher', 'teacher name']:
            col_map[c] = 'FullName'
        elif c_low in ['role', 'designation']:
            col_map[c] = 'Role'
        elif c_low in ['starttime', 'start time', 'date', 'created_at', 'timestamp']:
            col_map[c] = 'StartTime'
        elif c_low in ['endtime', 'end time']:
            col_map[c] = 'EndTime'
        elif c_low in ['type', 'activity type', 'module']:
            col_map[c] = 'Type'
    out = out.rename(columns=col_map)

    for col in ["Institution", "Center", "FirstName", "LastName", "FullName", "Role", "Uploaded_By", "State_Zone"]:
        if col not in out.columns:
            out[col] = ""
        out[col] = out[col].fillna('').astype(str).str.replace(r'\s+', ' ', regex=True).str.strip()

    out.loc[out["State_Zone"].eq(""), "State_Zone"] = "Madhya Pradesh (MP)"
    out.loc[out["Uploaded_By"].eq(""), "Uploaded_By"] = "Harshit Bhargava"

    calculated_full = (
        out["FirstName"].fillna("") + " " + out["LastName"].fillna("")
    ).str.replace(r'\s+', ' ', regex=True).str.strip()
    empty_full = out["FullName"].eq("")
    out.loc[empty_full, "FullName"] = calculated_full.loc[empty_full]

    out.loc[out["FullName"].eq(""), "FullName"] = "Unknown Teacher"
    return out[span_3](start_span)[span_3](end_span)


# --- CALCULATION & WORKING DAYS HELPERS ---
def get_working_days(start_date, end_date, excluded_dates_list=None, exclude_sundays=True):
    try:
        if start_date is None or end_date is None or pd.isna(start_date) or pd.isna(end_date):
            return 0
        start = pd.Timestamp(start_date).normalize()
        end = pd.Timestamp(end_date).normalize()
        if end < start:
            return 0
        holidays = []
        for d in (excluded_dates_list or []):
            try:
                holidays.append(np.datetime64(pd.Timestamp(d).date()))
            except Exception:
                continue
        weekmask = '1111110' if exclude_sundays else '1111111'
        return max(0, int(np.busday_count(np.datetime64(start.date()), np.datetime64((end + pd.Timedelta(days=1)).date()), weekmask=weekmask, holidays=holidays)))
    except Exception:
        return 0[span_4](start_span)[span_4](end_span)


def safe_percentage(numerator, denominator):
    if denominator is None or denominator <= 0:
        return 0.0
    return float(numerator) / float(denominator) * 100.0[span_5](start_span)[span_5](end_span)


def get_period_bounds_for_view(selected_month, view_mode, month_filtered_df, custom_start=None, custom_end=None):
    if view_mode == "Full Month Summary":
        try:
            start = pd.to_datetime(selected_month, format="%B %Y").normalize()
            return start.date(), (start + pd.offsets.MonthEnd(1)).date()
        except Exception:
            pass
    if view_mode == "Custom Date Range":
        return custom_start, custom_end
    if month_filtered_df is not None and not month_filtered_df.empty:
        return month_filtered_df['Date'].min(), month_filtered_df['Date'].max()
    return None, None[span_6](start_span)[span_6](end_span)


def get_teacher_eligible_working_days(teacher_df, period_start, period_end, excluded_dates=None, exclude_sundays=True):
    if teacher_df is None or teacher_df.empty or period_start is None or period_end is None:
        return 0
    dates = pd.to_datetime(teacher_df['Date'], errors='coerce').dropna()
    if dates.empty:
        return 0
    dates = dates[(dates.dt.date >= pd.Timestamp(period_start).date()) & (dates.dt.date <= pd.Timestamp(period_end).date())]
    if dates.empty:
        return 0
    return get_working_days(dates.min().date(), dates.max().date(), excluded_dates, exclude_sundays)[span_7](start_span)[span_7](end_span)


def teacher_days_map(roster_df, activity_df, period_start, period_end, excluded_dates=None, exclude_sundays=True):
    result = {}
    if roster_df is None or roster_df.empty:
        return result
    for _, row in roster_df[['Institution','FullName']].drop_duplicates().iterrows():
        inst, teacher = row['Institution'], row['FullName']
        tdf = activity_df[(activity_df['Institution'] == inst) & (activity_df['FullName'] == teacher)] if activity_df is not None and not activity_df.empty else pd.DataFrame()
        result[(inst, teacher)] = get_teacher_eligible_working_days(tdf, period_start, period_end, excluded_dates, exclude_sundays)
    return result[span_8](start_span)[span_8](end_span)


def duration_sum(df, mask=None):
    if df is None or df.empty:
        return 0.0
    work = df if mask is None else df.loc[mask]
    if 'Duration_Min' not in work.columns:
        return 0.0
    vals = pd.to_numeric(work['Duration_Min'], errors='coerce').replace([np.inf, -np.inf], np.nan).fillna(0.0)
    return max(0.0, float(vals.sum()))[span_9](start_span)[span_9](end_span)


def calculate_kpi_target(daily_target, working_days, enabled=True):
    if not enabled:
        return 0.0
    return max(0.0, float(daily_target)) * max(0, int(working_days))[span_10](start_span)[span_10](end_span)


def calculate_kpi_status(minutes, target, enabled=True, break_period=False):
    minutes = max(0.0, float(minutes or 0.0))
    if break_period:
        return '🏖️ Scheduled Break / No Working Days'
    if not enabled or target <= 0:
        return 'Activity Logged' if minutes > 0 else 'No Activity Logged'
    if minutes >= target:
        return f'✅ Met Performance Indicator (>= {target:.0f}m)'
    if minutes > 0:
        return f'⚠️ Below Performance Indicator (< {target:.0f}m)'
    return '❌ Inactive (0 Mins)[span_11](start_span)'[span_11](end_span)


# --- DATABASE FUNCTIONS ---
def init_observation_db():
    create_query = """
        CREATE TABLE IF NOT EXISTS classroom_observations (
            id SERIAL PRIMARY KEY,
            school VARCHAR(255),
            teacher VARCHAR(255),
            class_section VARCHAR(100),
            subject VARCHAR(100),
            topic VARCHAR(255),
            visit_date DATE,
            duration VARCHAR(50),
            students_present INT,
            print_displayed VARCHAR(10),
            academic_mentor VARCHAR(255),
            rubric_json JSONB,
            flow_of_class TEXT,
            high_points TEXT,
            recommendations TEXT,
            pdf_url TEXT,
            evidence_links TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    """
    try:
        with conn.engine.begin() as c:
            c.execute(text(create_query))
            # Auto-migrate if column evidence_links does not exist
            c.execute(text('ALTER TABLE classroom_observations ADD COLUMN IF NOT EXISTS evidence_links TEXT;'))
    except Exception:
        pass[span_12](start_span)[span_12](end_span)

init_observation_db()[span_13](start_span)[span_13](end_span)


def init_teacher_records_hash_column():
    try:
        with conn.engine.begin() as c:
            c.execute(text('ALTER TABLE teacher_records ADD COLUMN IF NOT EXISTS "Record_Hash" TEXT;'))
            c.execute(text('CREATE INDEX IF NOT EXISTS idx_teacher_records_hash ON teacher_records ("Record_Hash");'))
    except Exception:
        pass[span_14](start_span)[span_14](end_span)

init_teacher_records_hash_column()[span_15](start_span)[span_15](end_span)


def backfill_teacher_records_hash():
    try:
        with conn.engine.begin() as c:
            legacy = pd.read_sql(
                text('''
                    SELECT ctid, "Uploaded_By","FullName","Institution","Center","Type",
                           "Grade","Subject","Book","StartTime","EndTime","Duration_Min"
                    FROM teacher_records WHERE "Record_Hash" IS NULL
                '''),
                con=c
            )
            if legacy.empty:
                return 0
            legacy['Record_Hash'] = legacy.apply(compute_record_hash, axis=1)
            for _, r in legacy.iterrows():
                c.execute(
                    text('UPDATE teacher_records SET "Record_Hash" = :h WHERE ctid = :ctid'),
                    {"h": r['Record_Hash'], "ctid": r['ctid']}
                )
            return len(legacy)
    except Exception:
        return 0[span_16](start_span)[span_16](end_span)

backfill_teacher_records_hash()[span_17](start_span)[span_17](end_span)


def save_observation_to_db(meta, rubrics, narratives, pdf_url="", evidence_links=""):
    insert_query = text("""
        INSERT INTO classroom_observations (
            school, teacher, class_section, subject, topic,
            visit_date, duration, students_present, print_displayed,
            academic_mentor, rubric_json, flow_of_class, high_points,
            recommendations, pdf_url, evidence_links
        ) VALUES (
            :school, :teacher, :class_section, :subject, :topic,
            :visit_date, :duration, :students_present, :print_displayed,
            :academic_mentor, :rubric_json, :flow_of_class, :high_points,
            :recommendations, :pdf_url, :evidence_links
        )
    """)
    try:
        with conn.engine.begin() as c:
            c.execute(insert_query, {
                "school": meta.get("School", ""),
                "teacher": meta.get("Teacher", ""),
                "class_section": meta.get("Class", ""),
                "subject": meta.get("Subject", ""),
                "topic": meta.get("Topic", ""),
                "visit_date": meta.get("Date", pd.Timestamp.now().date()),
                "duration": meta.get("Duration", "40 Min"),
                "students_present": int(meta.get("Students", 0)),
                "print_displayed": meta.get("PrintDisplay", "Yes"),
                "academic_mentor": meta.get("Mentor", "Harshit Bhargava"),
                "rubric_json": json.dumps(rubrics),
                "flow_of_class": narratives.get("Flow", ""),
                "high_points": narratives.get("HighPoints", ""),
                "recommendations": narratives.get("Recommendations", ""),
                "pdf_url": pdf_url,
                "evidence_links": evidence_links
            })
        return True
    except Exception as e:
        st.error(f"Error saving visit observation to database: {e}")
        return False[span_18](start_span)[span_18](end_span)


def update_observation_in_db(obs_id, meta, rubrics, narratives, pdf_url="", evidence_links=""):
    update_query = text("""
        UPDATE classroom_observations SET
            school = :school,
            teacher = :teacher,
            class_section = :class_section,
            subject = :subject,
            topic = :topic,
            visit_date = :visit_date,
            duration = :duration,
            students_present = :students_present,
            print_displayed = :print_displayed,
            academic_mentor = :academic_mentor,
            rubric_json = :rubric_json,
            flow_of_class = :flow_of_class,
            high_points = :high_points,
            recommendations = :recommendations,
            pdf_url = COALESCE(NULLIF(:pdf_url, ''), pdf_url),
            evidence_links = :evidence_links
        WHERE id = :obs_id
    """)
    try:
        with conn.engine.begin() as c:
            c.execute(update_query, {
                "obs_id": int(obs_id),
                "school": meta.get("School", ""),
                "teacher": meta.get("Teacher", ""),
                "class_section": meta.get("Class", ""),
                "subject": meta.get("Subject", ""),
                "topic": meta.get("Topic", ""),
                "visit_date": meta.get("Date", pd.Timestamp.now().date()),
                "duration": meta.get("Duration", "40 Min"),
                "students_present": int(meta.get("Students", 0)),
                "print_displayed": meta.get("PrintDisplay", "Yes"),
                "academic_mentor": meta.get("Mentor", "Harshit Bhargava"),
                "rubric_json": json.dumps(rubrics),
                "flow_of_class": narratives.get("Flow", ""),
                "high_points": narratives.get("HighPoints", ""),
                "recommendations": narratives.get("Recommendations", ""),
                "pdf_url": pdf_url,
                "evidence_links": evidence_links
            })
        return True
    except Exception as e:
        st.error(f"Error updating visit observation in database: {e}")
        return False


def fetch_observation_history(teacher_name=None, school_name=None):
    query = 'SELECT * FROM classroom_observations'
    conditions = []
    params = {}
    if teacher_name and teacher_name != "All Teachers":
        conditions.append('LOWER("teacher") = LOWER(:teacher)')
        params["teacher"] = teacher_name
    if school_name and school_name != "All Schools":
        conditions.append('LOWER("school") = LOWER(:school)')
        params["school"] = school_name

    if conditions:
        query += " WHERE " + " AND ".join(conditions)
    query += ' ORDER BY "visit_date" DESC, "id" DESC;'

    try:
        with conn.engine.connect() as c:
            return pd.read_sql(text(query), con=c, params=params)
    except Exception:
        return pd.DataFrame()[span_19](start_span)[span_19](end_span)


@st.cache_data(ttl=60, show_spinner=False)
def fetch_master_db_from_supabase():
    query = """
        SELECT 
            "State_Zone", "Uploaded_By", "Institution", "Center",
            "FirstName", "LastName", "FullName", "Role", "Type",
            "Grade", "Subject", "Book", "StartTime", "EndTime",
            COALESCE("Duration_Min", 0.0) AS "Duration_Min",
            "Voice_Note_Link", "Lesson_Plan_Picture",
            "Video_Evidence_1", "Video_Evidence_2", "Video_Evidence_3",
            "Writing_Sample_Link", "Phonics_Evidence_Link", "Portfolio_Evidence_Link",
            "Record_Hash"
        FROM teacher_records
        ORDER BY "StartTime" DESC;
    """
    try:
        df_raw = conn.query(query, ttl=0)
    except Exception as e:
        st.error(f"Error fetching from PostgreSQL: {e}")
        df_raw = pd.DataFrame()

    if not df_raw.empty:
        for dt_col in ['StartTime', 'EndTime']:
            if dt_col in df_raw.columns:
                df_raw[dt_col] = pd.to_datetime(df_raw[dt_col], errors='coerce')

    sub_records = []
    try:
        file_list = supabase.storage.from_(BUCKET_NAME).list("submissions", {"limit": 10000})
        if file_list:
            for item in file_list:
                fname = item.get('name', '')
                if fname.endswith('.json'):
                    raw_data = supabase.storage.from_(BUCKET_NAME).download(f"submissions/{fname}")
                    if raw_data:
                        sub_records.append(json.loads(raw_data.decode('utf-8')))
    except Exception:
        pass

    if sub_records:
        subs_df = pd.DataFrame(sub_records)
        for dt_col in ['StartTime', 'EndTime']:
            if dt_col in subs_df.columns:
                subs_df[dt_col] = pd.to_datetime(subs_df[dt_col], errors='coerce')
        if not subs_df.empty:
            if 'Record_Hash' not in subs_df.columns:
                subs_df['Record_Hash'] = None
            missing_hash = subs_df['Record_Hash'].isna() | (subs_df['Record_Hash'].astype(str).str.strip() == '')
            if missing_hash.any():
                subs_df.loc[missing_hash, 'Record_Hash'] = subs_df.loc[missing_hash].apply(compute_record_hash, axis=1)

        combined = pd.concat([df_raw, subs_df], ignore_index=True) if not df_raw.empty else subs_df

        if 'Record_Hash' in combined.columns:
            has_hash = combined['Record_Hash'].notna() & (combined['Record_Hash'].astype(str).str.strip() != '')
        else:
            has_hash = pd.Series(False, index=combined.index)

        hashed_part = combined.loc[has_hash].drop_duplicates(subset=['Record_Hash'], keep='last')
        unhashed_part = combined.loc[~has_hash]
        combined = pd.concat([hashed_part, unhashed_part], ignore_index=True)

        df_raw = combined

    if df_raw.empty:
        return pd.DataFrame()

    return normalize_identity_columns(df_raw)[span_20](start_span)[span_20](end_span)


@st.cache_data(ttl=600, show_spinner=False)
def load_crm_data_from_supabase():
    try:
        response = supabase.storage.from_(BUCKET_NAME).download(CRM_FILE_NAME)
        if response:
            return json.loads(response.decode('utf-8'))
    except Exception:
        pass
    return {"contacts": {}}[span_21](start_span)[span_21](end_span)


def save_crm_data_to_supabase(crm_data):
    try:
        crm_buffer = BytesIO(json.dumps(crm_data, indent=2).encode('utf-8'))
        supabase.storage.from_(BUCKET_NAME).upload(
            path=CRM_FILE_NAME,
            file=crm_buffer.getvalue(),
            file_options={"upsert": "true", "content-type": "application/json"}
        )
        load_crm_data_from_supabase.clear()
    except Exception as e:
        st.error(f"Could not sync CRM data to Supabase: {e}")[span_22](start_span)[span_22](end_span)


@st.cache_data(ttl=600, show_spinner=False)
def load_call_logs_from_supabase():
    try:
        response = supabase.storage.from_(BUCKET_NAME).download(CALL_LOGS_FILE_NAME)
        if response:
            return json.loads(response.decode('utf-8'))
    except Exception:
        pass
    return [][span_23](start_span)[span_23](end_span)


def save_call_logs_to_supabase(logs_list):
    try:
        logs_buffer = BytesIO(json.dumps(logs_list, indent=2).encode('utf-8'))
        supabase.storage.from_(BUCKET_NAME).upload(
            path=CALL_LOGS_FILE_NAME,
            file=logs_buffer.getvalue(),
            file_options={"upsert": "true", "content-type": "application/json"}
        )
        load_call_logs_from_supabase.clear()
    except Exception as e:
        st.error(f"Could not sync call discussion logs to Supabase: {e}")[span_24](start_span)[span_24](end_span)


def upload_pdf_to_supabase(pdf_buffer, school_name, subfolder="reports", file_suffix="_Comprehensive_Audit"):
    try:
        clean_name = re.sub(r'[^a-zA-Z0-9_-]', '_', school_name)
        remote_path = f"{subfolder}/{clean_name}{file_suffix}.pdf"
        
        supabase.storage.from_(BUCKET_NAME).upload(
            path=remote_path,
            file=pdf_buffer.getvalue(),
            file_options={"upsert": "true", "content-type": "application/pdf"}
        )
        public_url = f"{SUPABASE_URL}/storage/v1/object/public/{BUCKET_NAME}/{remote_path}"
        return public_url
    except Exception:
        return None[span_25](start_span)[span_25](end_span)


def upload_generic_file_to_supabase(file_obj, filename, subfolder="visit_evidences"):
    try:
        clean_filename = re.sub(r'[^a-zA-Z0-9_.-]', '_', filename)
        remote_path = f"{subfolder}/{int(time.time())}_{clean_filename}"
        supabase.storage.from_(BUCKET_NAME).upload(
            path=remote_path,
            file=file_obj.getvalue(),
            file_options={"upsert": "true"}
        )
        return f"{SUPABASE_URL}/storage/v1/object/public/{BUCKET_NAME}/{remote_path}"
    except Exception as e:
        st.error(f"Upload error: {e}")
        return None


@st.cache_data(show_spinner=False)
def build_teacher_roster_cached(df):
    if df is None or df.empty:
        return pd.DataFrame(columns=["Institution", "Center", "FirstName", "LastName", "FullName", "Role", "Uploaded_By", "State_Zone"])

    roster = normalize_identity_columns(df)

    role_key = roster["Role"].map(_norm_key)
    teacher_mask = role_key.isin({"teacher", "teachers"})
    candidate = roster.loc[teacher_mask].copy() if teacher_mask.any() else roster.copy()

    candidate = candidate[
        candidate["Institution"].ne("")
        & ~candidate["Institution"].map(_norm_key).isin({"nan", "unknown school", "default school"})
        & candidate["FullName"].ne("")
        & ~candidate["FullName"].map(_norm_key).isin({"nan", "unknown teacher", "none"})
    ]

    candidate["_institution_key"] = candidate["Institution"].map(_norm_key)
    candidate["_teacher_key"] = candidate["FullName"].map(_norm_key)
    candidate = candidate.drop_duplicates(
        subset=["_institution_key", "_teacher_key"], keep="last"
    ).sort_values(["Institution", "FullName"], kind="stable")

    return candidate.reset_index(drop=True)[span_26](start_span)[span_26](end_span)


def get_gemini_summary(context_prompt, audio_file_obj=None):
    if not ai_client:
        return "⚠️ Gemini API key not found in Streamlit secrets."
    
    contents_payload = [context_prompt]
    if audio_file_obj is not None:
        try:
            audio_bytes = audio_file_obj.read()
            contents_payload.append(
                genai.types.Part.from_bytes(
                    data=audio_bytes,
                    mime_type="audio/wav"
                )
            )
        except Exception:
            pass

    models_to_try = ["gemini-3.6-flash", "gemini-3.7-flash", "gemini-3.8-flash", "gemini-3.5-flash"]
    for m in models_to_try:
        try:
            response = ai_client.models.generate_content(
                model=m,
                contents=contents_payload
            )
            return response.text
        except Exception:
            time.sleep(1)
            continue
            
    return "AI Generation Notice: Service temporarily busy. Please retry shortly."


# --- STRUCTURED OBSERVATION AI HELPER (COMPLIANT WITH DEVELOPER API & RETRY LOGIC) ---
class RubricEvaluationItem(BaseModel):
    category: str = Field(description="The exact category name from the 12 rubric parameters.")
    grade: Literal["A", "B", "C", "NA"] = Field(description="Assigned grade based on OneLern rubric: A, B, C, or NA.")
    remarks: str = Field(description="Specific, constructive remark explaining this grade.")

class ClassroomObservationAIOutput(BaseModel):
    flow_of_class: str = Field(description="Numbered step-by-step chronology of how the teacher conducted the class.")
    high_points: str = Field(description="Numbered bullet points highlighting strong pedagogical moments.")
    recommendations: str = Field(description="Actionable, prioritized recommendations for the teacher.")
    rubrics: List[RubricEvaluationItem] = Field(description="Evaluations for each of the 12 rubric categories.")


def generate_structured_observation_ai(audio_file_obj=None, text_transcript="", max_retries=3):
    """Extracts observation narratives and 12-rubric ratings with automatic fallback and retries."""
    if not ai_client:
        return None, "Gemini API client is not initialized in Streamlit secrets."

    rubric_guidelines_str = json.dumps(OBSERVATION_RUBRIC_CONFIG, indent=2)

    prompt = f"""
    You are an expert Academic Consultant and Classroom Observer evaluating a school teacher.
    Analyze the voice debrief or rough field notes provided by the mentor.

    Here are the official 12 rubric categories and their descriptions:
    {rubric_guidelines_str}

    Mentor's Field Notes / Instructions:
    {text_transcript if text_transcript.strip() else 'Analyze the attached voice note recording.'}

    Your Task:
    1. Chronologically reconstruct 'flow_of_class' as numbered steps.
    2. Extract key positive practices into 'high_points' as numbered points.
    3. Formulate actionable, constructive 'recommendations' as numbered points.
    4. For all 12 rubric categories, include an entry in 'rubrics' with the exact category name, assigned grade ('A', 'B', 'C', or 'NA'), and a 1-sentence specific observation remark. If a category was not observed, assign 'B' or 'NA' with a neutral remark.
    """

    contents_payload = [prompt]
    if audio_file_obj is not None:
        try:
            audio_bytes = audio_file_obj.read()
            contents_payload.append(
                genai.types.Part.from_bytes(data=audio_bytes, mime_type="audio/wav")
            )
        except Exception as e:
            return None, f"Could not read audio bytes: {e}"

    candidate_models = ["gemini-3.6-flash", "gemini-3.7-flash", "gemini-3.8-flash", "gemini-3.5-flash"]
    last_exception = None

    for model_name in candidate_models:
        for attempt in range(1, max_retries + 1):
            try:
                response = ai_client.models.generate_content(
                    model=model_name,
                    contents=contents_payload,
                    config={
                        "response_mime_type": "application/json",
                        "response_schema": ClassroomObservationAIOutput,
                    }
                )
                return json.loads(response.text), None
            except errors.APIError as e:
                last_exception = e
                if getattr(e, "code", None) in [503, 429] or "503" in str(e):
                    time.sleep(2 ** attempt)
                    continue
                else:
                    break
            except Exception as e:
                last_exception = e
                time.sleep(1.5)

    return None, f"Temporarily unable to process request: {last_exception}"


# --- REPORTLAB PDF GENERATORS ---
def generate_classroom_observation_visit_pdf(metadata, rubric_scores, narratives, evidence_urls=None):
    buffer = BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=letter, leftMargin=24, rightMargin=24, topMargin=24, bottomMargin=24)
    story = []
    styles = getSampleStyleSheet()

    header_blue = colors.HexColor('#0284C7')
    dark_neutral = colors.HexColor('#0F172A')
    light_bg = colors.HexColor('#F8FAFC')
    border_color = colors.HexColor('#CBD5E1')
    highlight_yellow = colors.HexColor('#FEF08A')

    title_style = ParagraphStyle('ObsTitle', parent=styles['Heading1'], fontSize=12, leading=15, textColor=header_blue, fontName='Helvetica-Bold')
    sub_title = ParagraphStyle('ObsSub', parent=styles['Normal'], fontSize=8, leading=11, textColor=dark_neutral)
    cell_bold = ParagraphStyle('CellB', parent=styles['Normal'], fontSize=7.5, leading=10, textColor=dark_neutral, fontName='Helvetica-Bold')
    cell_norm = ParagraphStyle('CellN', parent=styles['Normal'], fontSize=6.5, leading=8.5, textColor=dark_neutral)
    header_style = ParagraphStyle('HeadS', parent=styles['Normal'], fontSize=7.5, leading=10, textColor=colors.white, fontName='Helvetica-Bold', alignment=1)
    sec_head = ParagraphStyle('SecH', parent=styles['Heading2'], fontSize=9, leading=12, textColor=header_blue, fontName='Helvetica-Bold', spaceBefore=8, spaceAfter=4)
    narrative_p = ParagraphStyle('NarrP', parent=styles['Normal'], fontSize=7.5, leading=10.5, textColor=dark_neutral)
    link_p = ParagraphStyle('LinkP', parent=styles['Normal'], fontSize=7.5, leading=10.5, textColor=colors.HexColor('#0284C7'))

    story.append(Paragraph(f"<b>OneLern Classroom Observation :- {metadata.get('School', 'N/A')}</b>", title_style))[span_27](start_span)[span_27](end_span)
    story.append(Spacer(1, 4))[span_28](start_span)[span_28](end_span)
    story.append(HRFlowable(width="100%", thickness=1.5, color=header_blue, spaceAfter=8))[span_29](start_span)[span_29](end_span)

    meta_data = [
        [Paragraph("<b>Name of the Teacher</b>", cell_bold), Paragraph(metadata.get("Teacher", ""), sub_title), Paragraph("<b>Date</b>", cell_bold), Paragraph(str(metadata.get("Date", "")), sub_title)],
        [Paragraph("<b>Class and section</b>", cell_bold), Paragraph(metadata.get("Class", ""), sub_title), Paragraph("<b>Total Duration of Observation</b>", cell_bold), Paragraph(metadata.get("Duration", ""), sub_title)],
        [Paragraph("<b>Subject</b>", cell_bold), Paragraph(metadata.get("Subject", ""), sub_title), Paragraph("<b>Total Students Present</b>", cell_bold), Paragraph(str(metadata.get("Students", "")), sub_title)],
        [Paragraph("<b>Topic</b>", cell_bold), Paragraph(metadata.get("Topic", ""), sub_title), Paragraph("<b>Print displayed in class</b>", cell_bold), Paragraph(metadata.get("PrintDisplay", "Yes"), sub_title)],
        [Paragraph("<b>Academic Mentor</b>", cell_bold), Paragraph(metadata.get("Mentor", "Harshit Bhargava"), sub_title), Paragraph("", sub_title), Paragraph("", sub_title)]
    ][span_30](start_span)[span_30](end_span)
    meta_table = Table(meta_data, colWidths=[100, 182, 120, 162])[span_31](start_span)[span_31](end_span)
    meta_table.setStyle(TableStyle([
        ('GRID', (0, 0), (-1, -1), 0.5, border_color),
        ('BACKGROUND', (0, 0), (0, -1), light_bg),
        ('BACKGROUND', (2, 0), (2, -1), light_bg),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
    ]))[span_32](start_span)[span_32](end_span)
    story.append(meta_table)[span_33](start_span)[span_33](end_span)
    story.append(Spacer(1, 8))[span_34](start_span)[span_34](end_span)

    rubric_rows = [[
        Paragraph("Category", header_style),
        Paragraph("A", header_style),
        Paragraph("B", header_style),
        Paragraph("C", header_style),
        Paragraph("A/B/C", header_style),
        Paragraph("Remarks", header_style)
    ]][span_35](start_span)[span_35](end_span)

    custom_table_styles = [
        ('BACKGROUND', (0, 0), (-1, 0), header_blue),
        ('GRID', (0, 0), (-1, -1), 0.4, border_color),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
    ][span_36](start_span)[span_36](end_span)

    col_map = {"A": 1, "B": 2, "C": 3}[span_37](start_span)[span_37](end_span)

    for idx, (cat_name, desc_dict) in enumerate(OBSERVATION_RUBRIC_CONFIG.items(), start=1):[span_38](start_span)[span_38](end_span)
        res = rubric_scores.get(cat_name, {"Grade": "NA", "Remarks": ""})[span_39](start_span)[span_39](end_span)
        awarded_grade = res.get("Grade", "NA")[span_40](start_span)[span_40](end_span)

        rubric_rows.append([
            Paragraph(cat_name, cell_bold),
            Paragraph(desc_dict.get("A", ""), cell_norm),
            Paragraph(desc_dict.get("B", ""), cell_norm),
            Paragraph(desc_dict.get("C", ""), cell_norm),
            Paragraph(f"<b>{awarded_grade}</b>", ParagraphStyle('Ctr', parent=cell_bold, alignment=1)),
            Paragraph(res.get("Remarks", ""), cell_norm)
        ])[span_41](start_span)[span_41](end_span)

        base_bg = colors.white if idx % 2 != 0 else light_bg[span_42](start_span)[span_42](end_span)
        custom_table_styles.append(('BACKGROUND', (0, idx), (-1, idx), base_bg))[span_43](start_span)[span_43](end_span)

        if awarded_grade in col_map:[span_44](start_span)[span_44](end_span)
            target_col = col_map[awarded_grade][span_45](start_span)[span_45](end_span)
            custom_table_styles.append(('BACKGROUND', (target_col, idx), (target_col, idx), highlight_yellow))[span_46](start_span)[span_46](end_span)
            custom_table_styles.append(('BACKGROUND', (4, idx), (4, idx), highlight_yellow))[span_47](start_span)[span_47](end_span)

    rubric_table = Table(rubric_rows, colWidths=[80, 130, 130, 110, 34, 80], repeatRows=1)[span_48](start_span)[span_48](end_span)
    rubric_table.setStyle(TableStyle(custom_table_styles))[span_49](start_span)[span_49](end_span)
    story.append(rubric_table)[span_50](start_span)[span_50](end_span)
    story.append(Spacer(1, 10))[span_51](start_span)[span_51](end_span)

    story.append(Paragraph("<b>Flow of the class</b>", sec_head))[span_52](start_span)[span_52](end_span)
    story.append(HRFlowable(width="100%", thickness=0.5, color=border_color, spaceAfter=4))[span_53](start_span)[span_53](end_span)
    story.append(Paragraph(narratives.get("Flow", "N/A").replace('\n', '<br/>'), narrative_p))[span_54](start_span)[span_54](end_span)
    story.append(Spacer(1, 8))[span_55](start_span)[span_55](end_span)

    story.append(Paragraph("<b>High Points of the class</b>", sec_head))[span_56](start_span)[span_56](end_span)
    story.append(HRFlowable(width="100%", thickness=0.5, color=border_color, spaceAfter=4))[span_57](start_span)[span_57](end_span)
    story.append(Paragraph(narratives.get("HighPoints", "N/A").replace('\n', '<br/>'), narrative_p))[span_58](start_span)[span_58](end_span)
    story.append(Spacer(1, 8))[span_59](start_span)[span_59](end_span)

    story.append(Paragraph("<b>Recommendations by the Academic Mentor</b>", sec_head))[span_60](start_span)[span_60](end_span)
    story.append(HRFlowable(width="100%", thickness=0.5, color=border_color, spaceAfter=4))[span_61](start_span)[span_61](end_span)
    story.append(Paragraph(narratives.get("Recommendations", "N/A").replace('\n', '<br/>'), narrative_p))[span_62](start_span)[span_62](end_span)

    if evidence_urls:
        story.append(Spacer(1, 8))
        story.append(Paragraph("<b>Classroom Activity Evidences & Visual Records</b>", sec_head))
        story.append(HRFlowable(width="100%", thickness=0.5, color=border_color, spaceAfter=4))
        for i, u in enumerate(evidence_urls, 1):
            story.append(Paragraph(f"• 📷 <a href='{u}'><u>Click to View Classroom Activity Evidence #{i}</u></a>", link_p))

    doc.build(story)[span_63](start_span)[span_63](end_span)
    buffer.seek(0)[span_64](start_span)[span_64](end_span)
    return buffer[span_65](start_span)[span_65](end_span)


def render_school_audit_crm_box(tab_name, active_school, current_filter_description, school_audit_whatsapp_message):
    st.markdown("---")[span_66](start_span)[span_66](end_span)
    st.subheader(f"📞 School & Coordinator CRM, Call Notes & WhatsApp Generators ({tab_name})")[span_67](start_span)[span_67](end_span)
    
    if "crm_global_data" not in st.session_state:[span_68](start_span)[span_68](end_span)
        st.session_state["crm_global_data"] = load_crm_data_from_supabase()[span_69](start_span)[span_69](end_span)

    if "crm_call_logs_store" not in st.session_state:[span_70](start_span)[span_70](end_span)
        st.session_state["crm_call_logs_store"] = load_call_logs_from_supabase()[span_71](start_span)[span_71](end_span)

    crm_data = st.session_state["crm_global_data"][span_72](start_span)[span_72](end_span)
    if "contacts" not in crm_data:[span_73](start_span)[span_73](end_span)
        crm_data["contacts"] = {}[span_74](start_span)[span_74](end_span)

    target_crm_school = active_school[span_75](start_span)[span_75](end_span)

    c_col1, c_col2 = st.columns([1, 2])[span_76](start_span)[span_76](end_span)
    with c_col1:[span_77](start_span)[span_77](end_span)
        st.write(f"🏫 **Target School:** `{target_crm_school}`")[span_78](start_span)[span_78](end_span)
        
        if target_crm_school not in crm_data["contacts"]:[span_79](start_span)[span_79](end_span)
            crm_data["contacts"][target_crm_school] = {
                "Principal": {"name": "", "phone": ""},
                "Owner": {"name": "", "phone": ""},
                "Coordinator": {"name": "", "phone": ""}
            }[span_80](start_span)[span_80](end_span)

        st.markdown("##### 👥 Select Entity & Contact Details")[span_81](start_span)[span_81](end_span)
        selected_entity_type = st.selectbox("Target Entity Type:", options=["Principal", "Owner", "Coordinator"], key=f"entity_type_{tab_name}_{target_crm_school}")[span_82](start_span)[span_82](end_span)
        
        current_entity_data = crm_data["contacts"][target_crm_school].get(selected_entity_type, {"name": "", "phone": ""})[span_83](start_span)[span_83](end_span)
        
        input_contact_name = st.text_input(f"{selected_entity_type} Name:", value=current_entity_data.get("name", ""), key=f"cname_{tab_name}_{target_crm_school}_{selected_entity_type}")[span_84](start_span)[span_84](end_span)
        input_phone = st.text_input(f"{selected_entity_type} Mobile (+91...):", value=current_entity_data.get("phone", ""), key=f"cphone_{tab_name}_{target_crm_school}_{selected_entity_type}")[span_85](start_span)[span_85](end_span)

        if st.button(f"💾 Save {selected_entity_type} Contact to Supabase", key=f"save_contact_btn_{tab_name}_{target_crm_school}_{selected_entity_type}"):[span_86](start_span)[span_86](end_span)
            crm_data["contacts"][target_crm_school][selected_entity_type] = {
                "name": input_contact_name,
                "phone": input_phone
            }[span_87](start_span)[span_87](end_span)
            save_crm_data_to_supabase(crm_data)[span_88](start_span)[span_88](end_span)
            st.success(f"Successfully saved {selected_entity_type} details for {target_crm_school} to Supabase!")[span_89](start_span)[span_89](end_span)

        active_phone = input_phone.strip()[span_90](start_span)[span_90](end_span)
        if active_phone:[span_91](start_span)[span_91](end_span)
            clean_phone = re.sub(r'[^0-9+]', '', active_phone)[span_92](start_span)[span_92](end_span)
            contact_greeting = input_contact_name if input_contact_name else selected_entity_type[span_93](start_span)[span_93](end_span)
            quick_wa = urllib.parse.quote(f"Namaste {contact_greeting} ji, checking in from Onelearn Academic Team regarding school audit metrics for {target_crm_school} - {current_filter_description}.")[span_94](start_span)[span_94](end_span)
            st.markdown(f'<a href="tel:{active_phone}" target="_blank" style="text-decoration:none;"><button style="background-color:#2CA02C;color:white;padding:8px 14px;border:none;border-radius:4px;cursor:pointer;font-weight:bold;margin-bottom:6px;width:100%;">📞 Call {selected_entity_type}</button></a>', unsafe_allow_html=True)[span_95](start_span)[span_95](end_span)
            st.markdown(f'<a href="https://wa.me/{clean_phone}?text={quick_wa}" target="_blank" style="text-decoration:none;"><button style="background-color:#25D366;color:white;padding:8px 14px;border:none;border-radius:4px;cursor:pointer;font-weight:bold;width:100%;">📱 Quick WhatsApp Message</button></a>', unsafe_allow_html=True)[span_96](start_span)[span_96](end_span)
        else:
            st.warning(f"Please enter and save a mobile number for the selected {selected_entity_type}.")[span_97](start_span)[span_97](end_span)

    with c_col2:[span_98](start_span)[span_98](end_span)
        st.markdown("##### 💬 WhatsApp & Calling Generators (Indian Context)")[span_99](start_span)[span_99](end_span)
        
        custom_tone = st.selectbox("Select Message Tone:", ["Encouraging & Supportive", "Constructive & Corrective", "Executive Summary"], key=f"tone_{tab_name}_{target_crm_school}")[span_100](start_span)[span_100](end_span)
        
        with st.expander("✨ AI-Driven Calling Script & Smart Message Generator (Voice & Text)"):[span_101](start_span)[span_101](end_span)
            manager_voice_audio = st.audio_input(
                "🎙️ Record Voice Instructions (Speak your custom prompt):",
                key=f"voice_input_{tab_name}_{target_crm_school}"
            )[span_102](start_span)[span_102](end_span)
            user_custom_instruction = st.text_area(
                "Or Type Custom Instructions (Alternative to voice):",
                placeholder="e.g., Focus heavily on improving content book delivery and phonics submissions...",
                key=f"ai_custom_prompt_{tab_name}_{target_crm_school}"
            )[span_103](start_span)[span_103](end_span)
            
            if st.button("Generate AI Script & Message", key=f"gen_ai_both_{tab_name}_{target_crm_school}"):[span_104](start_span)[span_104](end_span)
                if not ai_client:[span_105](start_span)[span_105](end_span)
                    st.error("Gemini API client is not initialized.")[span_106](start_span)[span_106](end_span)
                else:
                    ai_prompt = f"""
                    You are an expert Academic Consultant. 
                    Based on these school audit metrics for {target_crm_school} ({current_filter_description}):
                    Metrics & Breakdown: {school_audit_whatsapp_message}
                    Target Entity: {selected_entity_type} named {input_contact_name or 'Sir/Madam'}
                    Tone: {custom_tone}
                    Text Instructions Provided: {user_custom_instruction if user_custom_instruction else 'None'}
                    
                    Generate two distinct outputs:
                    1. **Calling Script**: A structured phone conversation script calling out specific teacher data points, praises, and areas of concern to discuss with this {selected_entity_type}.
                    2. **AI WhatsApp Follow-up Message**: A concise, professional message summarizing these exact findings and action items to send on WhatsApp afterward. Sign off with 'Onelearn Academic Team'.
                    ""[span_107](start_span)"[span_107](end_span)
                    with st.spinner("Processing voice/text instructions with Gemini..."):[span_108](start_span)[span_108](end_span)
                        try:
                            ai_result = get_gemini_summary(ai_prompt, audio_file_obj=manager_voice_audio)[span_109](start_span)[span_109](end_span)
                            st.session_state[f"ai_gen_output_{tab_name}_{target_crm_school}"] = ai_result[span_110](start_span)[span_110](end_span)
                        except Exception as e:
                            st.error(f"Error generating AI content: {e}")[span_111](start_span)[span_111](end_span)
            
            if f"ai_gen_output_{tab_name}_{target_crm_school}" in st.session_state:[span_112](start_span)[span_112](end_span)
                st.markdown(st.session_state[f"ai_gen_output_{tab_name}_{target_crm_school}"])[span_113](start_span)[span_113](end_span)

        st.markdown("##### 📝 Quick WhatsApp Message Draft (Full School Audit)")[span_114](start_span)[span_114](end_span)
        draft_state_key = f"wa_draft_text_{tab_name}_{target_crm_school}_{selected_entity_type}[span_115](start_span)"[span_115](end_span)
        sync_track_key = f"last_raw_msg_{tab_name}_{target_crm_school}_{selected_entity_type}[span_116](start_span)"[span_116](end_span)
        
        if draft_state_key not in st.session_state or st.session_state.get(sync_track_key) != school_audit_whatsapp_message:[span_117](start_span)[span_117](end_span)
            st.session_state[draft_state_key] = school_audit_whatsapp_message[span_118](start_span)[span_118](end_span)
            st.session_state[sync_track_key] = school_audit_whatsapp_message[span_119](start_span)[span_119](end_span)

        editable_wa_area = st.text_area(
            "Confirm or Edit Final WhatsApp Message Draft:",
            value=st.session_state[draft_state_key],
            height=220,
            key=f"wa_textarea_{tab_name}_{target_crm_school}_{selected_entity_type}"
        )[span_120](start_span)[span_120](end_span)
        st.session_state[draft_state_key] = editable_wa_area[span_121](start_span)[span_121](end_span)

        if active_phone:[span_122](start_span)[span_122](end_span)
            clean_phone = re.sub(r'[^0-9+]', '', active_phone)[span_123](start_span)[span_123](end_span)
            encoded_final_text = urllib.parse.quote(editable_wa_area)[span_124](start_span)[span_124](end_span)
            st.markdown(f'<a href="https://wa.me/{clean_phone}?text={encoded_final_text}" target="_blank" style="text-decoration:none;"><button style="background-color:#25D366;color:white;padding:10px 18px;border:none;border-radius:4px;cursor:pointer;font-weight:bold;width:100%;">🚀 Send Final WhatsApp Message</button></a>', unsafe_allow_html=True)[span_125](start_span)[span_125](end_span)

    st.markdown("---")[span_126](start_span)[span_126](end_span)
    st.markdown(f"##### 📝 Post-Call Discussion Notes & Follow-up Scheduler ({target_crm_school} - {selected_entity_type})")[span_127](start_span)[span_127](end_span)
    
    with st.form(key=f"call_log_form_{tab_name}_{target_crm_school}_{selected_entity_type}"):[span_128](start_span)[span_128](end_span)
        col_f1, col_f2 = st.columns(2)[span_129](start_span)[span_129](end_span)
        with col_f1:[span_130](start_span)[span_130](end_span)
            call_date_punched = st.date_input("Call Conducted Date:", value=pd.Timestamp.now().date(), key=f"cdate_{tab_name}_{target_crm_school}")[span_131](start_span)[span_131](end_span)
        with col_f2:[span_132](start_span)[span_132](end_span)
            next_followup_date = st.date_input("Next Scheduled Follow-up Date:", value=pd.Timestamp.now().date() + pd.Timedelta(days=7), key=f"fdate_{tab_name}_{target_crm_school}")[span_133](start_span)[span_133](end_span)
            
        discussion_notes = st.text_area("Discussion Summary / Notes from Call:", placeholder="Punch key talking points, agreed commitments, and action items...", key=f"dnotes_{tab_name}_{target_crm_school}")[span_134](start_span)[span_134](end_span)
        call_status_opt = st.selectbox("Call Status / Resolution:", options=["Open Action Item", "In Progress", "Successfully Resolved"], key=f"cstat_{tab_name}_{target_crm_school}")[span_135](start_span)[span_135](end_span)
        
        submit_call_log = st.form_submit_button("💾 Save Call Note & Sync to Supabase Cloud")[span_136](start_span)[span_136](end_span)
        
        if submit_call_log:[span_137](start_span)[span_137](end_span)
            if discussion_notes.strip():[span_138](start_span)[span_138](end_span)
                new_log_entry = {
                    "School": target_crm_school,
                    "Entity Type": selected_entity_type,
                    "Contact Name": input_contact_name or "N/A",
                    "Module Tab": tab_name,
                    "Filter Window": current_filter_description,
                    "Call Date": str(call_date_punched),
                    "Discussion Notes": discussion_notes.strip(),
                    "Next Follow-up Date": str(next_followup_date),
                    "Status": call_status_opt
                }[span_139](start_span)[span_139](end_span)
                st.session_state["crm_call_logs_store"].append(new_log_entry)[span_140](start_span)[span_140](end_span)
                save_call_logs_to_supabase(st.session_state["crm_call_logs_store"])[span_141](start_span)[span_141](end_span)
                st.success("✅ Call notes and follow-up schedule successfully saved and synced to Supabase Cloud!")[span_142](start_span)[span_142](end_span)
            else:
                st.warning("Please enter discussion notes before saving.")[span_143](start_span)[span_143](end_span)

    if st.session_state["crm_call_logs_store"]:[span_144](start_span)[span_144](end_span)
        st.markdown(f"##### 📊 Filterable Call Discussion Logs & Audit Trail for {target_crm_school}")[span_145](start_span)[span_145](end_span)
        logs_df = pd.DataFrame(st.session_state["crm_call_logs_store"])[span_146](start_span)[span_146](end_span)
        
        if 'School' in logs_df.columns:[span_147](start_span)[span_147](end_span)
            logs_df = logs_df[logs_df['School'] == target_crm_school][span_148](start_span)[span_148](end_span)

        if not logs_df.empty:[span_149](start_span)[span_149](end_span)
            desired_cols = ['School', 'Entity Type', 'Contact Name', 'Module Tab', 'Filter Window', 'Call Date', 'Discussion Notes', 'Next Follow-up Date', 'Status'][span_150](start_span)[span_150](end_span)
            available_log_cols = [c for c in desired_cols if c in logs_df.columns][span_151](start_span)[span_151](end_span)
            
            st.dataframe(logs_df[available_log_cols], use_container_width=True)[span_152](start_span)[span_152](end_span)
            
            dl_col1, dl_col2 = st.columns(2)[span_153](start_span)[span_153](end_span)
            with dl_col1:[span_154](start_span)[span_154](end_span)
                output_buffer = BytesIO()[span_155](start_span)[span_155](end_span)
                with pd.ExcelWriter(output_buffer, engine='openpyxl') as writer:[span_156](start_span)[span_156](end_span)
                    logs_df[available_log_cols].to_excel(writer, index=False, sheet_name='Call_Discussion_Logs')[span_157](start_span)[span_157](end_span)
                output_buffer.seek(0)[span_158](start_span)[span_158](end_span)
                
                st.download_button(
                    label="📥 Download Filtered Call Logs (Excel)",
                    data=output_buffer,
                    file_name=f"School_CRM_Call_Logs_{target_crm_school.replace(' ', '_')}.xlsx",
                    mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    key=f"dl_excel_{tab_name}_{target_crm_school}"
                )[span_159](start_span)[span_159](end_span)
            with dl_col2:[span_160](start_span)[span_160](end_span)
                if st.button("🗑️ Clear Call Logs for this School", key=f"clear_logs_btn_{tab_name}_{target_crm_school}"):[span_161](start_span)[span_161](end_span)
                    st.session_state["crm_call_logs_store"] = [l for l in st.session_state["crm_call_logs_store"] if l.get("School") != target_crm_school][span_162](start_span)[span_162](end_span)
                    save_call_logs_to_supabase(st.session_state["crm_call_logs_store"])[span_163](start_span)[span_163](end_span)
                    st.success(f"Successfully cleared call logs for {target_crm_school}!")[span_164](start_span)[span_164](end_span)
                    st.rerun()[span_165](start_span)[span_165](end_span)
        else:
            st.info(f"No call discussion logs recorded yet for {target_crm_school}.")[span_166](start_span)[span_166](end_span)


def render_universal_crm_box(tab_name, active_selected_schools, current_filter_description, metrics_summary_text):
    st.markdown("---")[span_167](start_span)[span_167](end_span)
    st.subheader(f"📞 School & Coordinator CRM, Call Notes & WhatsApp Generators ({tab_name})")[span_168](start_span)[span_168](end_span)
    
    if "crm_global_data" not in st.session_state:[span_169](start_span)[span_169](end_span)
        st.session_state["crm_global_data"] = load_crm_data_from_supabase()[span_170](start_span)[span_170](end_span)

    if "crm_call_logs_store" not in st.session_state:[span_171](start_span)[span_171](end_span)
        st.session_state["crm_call_logs_store"] = load_call_logs_from_supabase()[span_172](start_span)[span_172](end_span)

    crm_data = st.session_state["crm_global_data"][span_173](start_span)[span_173](end_span)
    if "contacts" not in crm_data:[span_174](start_span)[span_174](end_span)
        crm_data["contacts"] = {}[span_175](start_span)[span_175](end_span)

    c_col1, c_col2 = st.columns([1, 2])[span_176](start_span)[span_176](end_span)
    with c_col1:[span_177](start_span)[span_177](end_span)
        if isinstance(active_selected_schools, str):[span_178](start_span)[span_178](end_span)
            schools_list = [active_selected_schools][span_179](start_span)[span_179](end_span)
        elif isinstance(active_selected_schools, (list, tuple, pd.Series, np.ndarray)):[span_180](start_span)[span_180](end_span)
            schools_list = [str(s) for s in active_selected_schools if str(s).strip()][span_181](start_span)[span_181](end_span)
        else:
            schools_list = ["Default School"][span_182](start_span)[span_182](end_span)
            
        if not schools_list:[span_183](start_span)[span_183](end_span)
            schools_list = ["Default School"][span_184](start_span)[span_184](end_span)

        target_crm_school = st.selectbox("Select School:", options=schools_list, key=f"crm_school_{tab_name}")[span_185](start_span)[span_185](end_span)
        
        if target_crm_school not in crm_data["contacts"]:[span_186](start_span)[span_186](end_span)
            crm_data["contacts"][target_crm_school] = {
                "Principal": {"name": "", "phone": ""},
                "Owner": {"name": "", "phone": ""},
                "Coordinator": {"name": "", "phone": ""}
            }[span_187](start_span)[span_187](end_span)

        st.markdown("##### 👥 Select Entity & Contact Details")[span_188](start_span)[span_188](end_span)
        selected_entity_type = st.selectbox("Target Entity Type:", options=["Principal", "Owner", "Coordinator"], key=f"entity_type_{tab_name}_{target_crm_school}")[span_189](start_span)[span_189](end_span)
        
        current_entity_data = crm_data["contacts"][target_crm_school].get(selected_entity_type, {"name": "", "phone": ""})[span_190](start_span)[span_190](end_span)
        
        input_contact_name = st.text_input(f"{selected_entity_type} Name:", value=current_entity_data.get("name", ""), key=f"cname_{tab_name}_{target_crm_school}_{selected_entity_type}")[span_191](start_span)[span_191](end_span)
        input_phone = st.text_input(f"{selected_entity_type} Mobile (+91...):", value=current_entity_data.get("phone", ""), key=f"cphone_{tab_name}_{target_crm_school}_{selected_entity_type}")[span_192](start_span)[span_192](end_span)

        if st.button(f"💾 Save {selected_entity_type} Contact to Supabase", key=f"save_contact_btn_{tab_name}_{target_crm_school}_{selected_entity_type}"):[span_193](start_span)[span_193](end_span)
            crm_data["contacts"][target_crm_school][selected_entity_type] = {
                "name": input_contact_name,
                "phone": input_phone
            }[span_194](start_span)[span_194](end_span)
            save_crm_data_to_supabase(crm_data)[span_195](start_span)[span_195](end_span)
            st.success(f"Successfully saved {selected_entity_type} details for {target_crm_school} to Supabase!")[span_196](start_span)[span_196](end_span)

        active_phone = input_phone.strip()[span_197](start_span)[span_197](end_span)
        if active_phone:[span_198](start_span)[span_198](end_span)
            clean_phone = re.sub(r'[^0-9+]', '', active_phone)[span_199](start_span)[span_199](end_span)
            contact_greeting = input_contact_name if input_contact_name else selected_entity_type[span_200](start_span)[span_200](end_span)
            quick_wa = urllib.parse.quote(f"Namaste {contact_greeting} ji, checking in from Onelearn Academic Team regarding {tab_name} metrics for {target_crm_school} - {current_filter_description}.")[span_201](start_span)[span_201](end_span)
            st.markdown(f'<a href="tel:{active_phone}" target="_blank" style="text-decoration:none;"><button style="background-color:#2CA02C;color:white;padding:8px 14px;border:none;border-radius:4px;cursor:pointer;font-weight:bold;margin-bottom:6px;width:100%;">📞 Call {selected_entity_type}</button></a>', unsafe_allow_html=True)[span_202](start_span)[span_202](end_span)
            st.markdown(f'<a href="https://wa.me/{clean_phone}?text={quick_wa}" target="_blank" style="text-decoration:none;"><button style="background-color:#25D366;color:white;padding:8px 14px;border:none;border-radius:4px;cursor:pointer;font-weight:bold;width:100%;">📱 Quick WhatsApp Message</button></a>', unsafe_allow_html=True)[span_203](start_span)[span_203](end_span)
        else:
            st.warning(f"Please enter and save a mobile number for the selected {selected_entity_type}.")[span_204](start_span)[span_204](end_span)

    with c_col2:[span_205](start_span)[span_205](end_span)
        st.markdown("##### 💬 WhatsApp & Calling Generators (Indian Context)")[span_206](start_span)[span_206](end_span)
        custom_tone = st.selectbox("Select Message Tone:", ["Encouraging & Supportive", "Constructive & Corrective", "Executive Summary"], key=f"tone_{tab_name}_{target_crm_school}")[span_207](start_span)[span_207](end_span)
        
        with st.expander("✨ AI-Driven Calling Script & Smart Message Generator (Voice & Text)"):[span_208](start_span)[span_208](end_span)
            manager_voice_audio = st.audio_input("🎙️ Record Voice Instructions:", key=f"voice_input_{tab_name}_{target_crm_school}")[span_209](start_span)[span_209](end_span)
            user_custom_instruction = st.text_area("Or Type Custom Instructions:", placeholder="e.g., Focus heavily on improving classroom book engagement...", key=f"ai_custom_prompt_{tab_name}_{target_crm_school}")[span_210](start_span)[span_210](end_span)
            
            if st.button("Generate AI Script & Message", key=f"gen_ai_both_{tab_name}_{target_crm_school}"):[span_211](start_span)[span_211](end_span)
                if not ai_client:[span_212](start_span)[span_212](end_span)
                    st.error("Gemini API client is not initialized.")[span_213](start_span)[span_213](end_span)
                else:
                    ai_prompt = f"""
                    You are an expert Academic Consultant. 
                    Based on these filtered metrics for {tab_name} at {target_crm_school} ({current_filter_description}):
                    Metrics & Breakdown: {metrics_summary_text}
                    Target Entity: {selected_entity_type} named {input_contact_name or 'Sir/Madam'}
                    Tone: {custom_tone}
                    
                    Generate two outputs: 1. Calling Script, 2. AI WhatsApp Follow-up Message. Sign off with 'Onelearn Academic Team'.
                    ""[span_214](start_span)"[span_214](end_span)
                    with st.spinner("Processing with Gemini..."):[span_215](start_span)[span_215](end_span)
                        try:
                            ai_result = get_gemini_summary(ai_prompt, audio_file_obj=manager_voice_audio)[span_216](start_span)[span_216](end_span)
                            st.session_state[f"ai_gen_output_{tab_name}_{target_crm_school}"] = ai_result[span_217](start_span)[span_217](end_span)
                        except Exception as e:
                            st.error(f"Error generating AI content: {e}")[span_218](start_span)[span_218](end_span)
            
            if f"ai_gen_output_{tab_name}_{target_crm_school}" in st.session_state:[span_219](start_span)[span_219](end_span)
                st.markdown(st.session_state[f"ai_gen_output_{tab_name}_{target_crm_school}"])[span_220](start_span)[span_220](end_span)

        st.markdown("##### 📝 Quick WhatsApp Message Draft (Standard Template)")[span_221](start_span)[span_221](end_span)
        draft_state_key = f"wa_draft_text_{tab_name}_{target_crm_school}_{selected_entity_type}[span_222](start_span)"[span_222](end_span)
        name_prefix = f" {input_contact_name}" if input_contact_name and input_contact_name.strip() else "[span_223](start_span)"[span_223](end_span)
        
        default_template_string = (
            f"Dear {name_prefix} ji,\n\n"
            f"Here is the performance update for {target_crm_school} - {current_filter_description}:\n\n"
            f"📊 *Module:* {tab_name}\n"
            f"{metrics_summary_text}\n\n"
            f"Regards,\n"
            f"Harshit Bhargava,\n"
            f"OneLearn Academic Team"
        )[span_224](start_span)[span_224](end_span)

        sync_track_key = f"last_raw_template_{tab_name}_{target_crm_school}_{selected_entity_type}[span_225](start_span)"[span_225](end_span)
        if draft_state_key not in st.session_state or st.session_state.get(sync_track_key) != default_template_string:[span_226](start_span)[span_226](end_span)
            st.session_state[draft_state_key] = default_template_string[span_227](start_span)[span_227](end_span)
            st.session_state[sync_track_key] = default_template_string[span_228](start_span)[span_228](end_span)

        editable_wa_area = st.text_area(
            "Confirm or Edit Final WhatsApp Message Draft:",
            value=st.session_state[draft_state_key],
            height=140,
            key=f"wa_textarea_{tab_name}_{target_crm_school}_{selected_entity_type}"
        )[span_229](start_span)[span_229](end_span)
        st.session_state[draft_state_key] = editable_wa_area[span_230](start_span)[span_230](end_span)

        if active_phone:[span_231](start_span)[span_231](end_span)
            clean_phone = re.sub(r'[^0-9+]', '', active_phone)[span_232](start_span)[span_232](end_span)
            encoded_final_text = urllib.parse.quote(editable_wa_area)[span_233](start_span)[span_233](end_span)
            st.markdown(f'<a href="https://wa.me/{clean_phone}?text={encoded_final_text}" target="_blank" style="text-decoration:none;"><button style="background-color:#25D366;color:white;padding:10px 18px;border:none;border-radius:4px;cursor:pointer;font-weight:bold;width:100%;">🚀 Send Final WhatsApp Message</button></a>', unsafe_allow_html=True)[span_234](start_span)[span_234](end_span)

    st.markdown("---")[span_235](start_span)[span_235](end_span)
    st.markdown(f"##### 📝 Post-Call Discussion Notes & Follow-up Scheduler ({target_crm_school} - {selected_entity_type})")[span_236](start_span)[span_236](end_span)
    
    with st.form(key=f"call_log_form_{tab_name}_{target_crm_school}_{selected_entity_type}"):[span_237](start_span)[span_237](end_span)
        col_f1, col_f2 = st.columns(2)[span_238](start_span)[span_238](end_span)
        with col_f1:[span_239](start_span)[span_239](end_span)
            call_date_punched = st.date_input("Call Conducted Date:", value=pd.Timestamp.now().date(), key=f"cdate_{tab_name}_{target_crm_school}")[span_240](start_span)[span_240](end_span)
        with col_f2:[span_241](start_span)[span_241](end_span)
            next_followup_date = st.date_input("Next Scheduled Follow-up Date:", value=pd.Timestamp.now().date() + pd.Timedelta(days=7), key=f"fdate_{tab_name}_{target_crm_school}")[span_242](start_span)[span_242](end_span)
            
        discussion_notes = st.text_area("Discussion Summary / Notes from Call:", placeholder="Punch key talking points, agreed commitments, and action items...", key=f"dnotes_{tab_name}_{target_crm_school}")[span_243](start_span)[span_243](end_span)
        call_status_opt = st.selectbox("Call Status / Resolution:", options=["Open Action Item", "In Progress", "Successfully Resolved"], key=f"cstat_{tab_name}_{target_crm_school}")[span_244](start_span)[span_244](end_span)
        
        submit_call_log = st.form_submit_button("💾 Save Call Note & Sync to Supabase Cloud")[span_245](start_span)[span_245](end_span)
        
        if submit_call_log:[span_246](start_span)[span_246](end_span)
            if discussion_notes.strip():[span_247](start_span)[span_247](end_span)
                new_log_entry = {
                    "School": target_crm_school,
                    "Entity Type": selected_entity_type,
                    "Contact Name": input_contact_name or "N/A",
                    "Module Tab": tab_name,
                    "Filter Window": current_filter_description,
                    "Call Date": str(call_date_punched),
                    "Discussion Notes": discussion_notes.strip(),
                    "Next Follow-up Date": str(next_followup_date),
                    "Status": call_status_opt
                }[span_248](start_span)[span_248](end_span)
                st.session_state["crm_call_logs_store"].append(new_log_entry)[span_249](start_span)[span_249](end_span)
                save_call_logs_to_supabase(st.session_state["crm_call_logs_store"])[span_250](start_span)[span_250](end_span)
                st.success("✅ Call notes and follow-up schedule successfully saved and synced to Supabase Cloud!")[span_251](start_span)[span_251](end_span)
            else:
                st.warning("Please enter discussion notes before saving.")[span_252](start_span)[span_252](end_span)

    if st.session_state["crm_call_logs_store"]:[span_253](start_span)[span_253](end_span)
        st.markdown(f"##### 📊 Filterable Call Discussion Logs & Audit Trail for {target_crm_school}")[span_254](start_span)[span_254](end_span)
        logs_df = pd.DataFrame(st.session_state["crm_call_logs_store"])[span_255](start_span)[span_255](end_span)
        
        if 'School' in logs_df.columns:[span_256](start_span)[span_256](end_span)
            logs_df = logs_df[logs_df['School'] == target_crm_school][span_257](start_span)[span_257](end_span)

        if not logs_df.empty:[span_258](start_span)[span_258](end_span)
            desired_cols = ['School', 'Entity Type', 'Contact Name', 'Module Tab', 'Filter Window', 'Call Date', 'Discussion Notes', 'Next Follow-up Date', 'Status'][span_259](start_span)[span_259](end_span)
            available_log_cols = [c for c in desired_cols if c in logs_df.columns][span_260](start_span)[span_260](end_span)
            
            st.dataframe(logs_df[available_log_cols], use_container_width=True)[span_261](start_span)[span_261](end_span)
            
            dl_col1, dl_col2 = st.columns(2)[span_262](start_span)[span_262](end_span)
            with dl_col1:[span_263](start_span)[span_263](end_span)
                output_buffer = BytesIO()[span_264](start_span)[span_264](end_span)
                with pd.ExcelWriter(output_buffer, engine='openpyxl') as writer:[span_265](start_span)[span_265](end_span)
                    logs_df[available_log_cols].to_excel(writer, index=False, sheet_name='Call_Discussion_Logs')[span_266](start_span)[span_266](end_span)
                output_buffer.seek(0)[span_267](start_span)[span_267](end_span)
                
                st.download_button(
                    label="📥 Download Filtered Call Logs (Excel)",
                    data=output_buffer,
                    file_name=f"School_CRM_Call_Logs_{target_crm_school.replace(' ', '_')}.xlsx",
                    mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    key=f"dl_excel_{tab_name}_{target_crm_school}"
                )[span_268](start_span)[span_268](end_span)
            with dl_col2:[span_269](start_span)[span_269](end_span)
                if st.button("🗑️ Clear Call Logs for this School", key=f"clear_logs_btn_{tab_name}_{target_crm_school}"):[span_270](start_span)[span_270](end_span)
                    st.session_state["crm_call_logs_store"] = [l for l in st.session_state["crm_call_logs_store"] if l.get("School") != target_crm_school][span_271](start_span)[span_271](end_span)
                    save_call_logs_to_supabase(st.session_state["crm_call_logs_store"])[span_272](start_span)[span_272](end_span)
                    st.success(f"Successfully cleared call logs for {target_crm_school}!")[span_273](start_span)[span_273](end_span)
                    st.rerun()[span_274](start_span)[span_274](end_span)
        else:
            st.info(f"No call discussion logs recorded yet for {target_crm_school}.")[span_275](start_span)[span_275](end_span)


def generate_pdf_report(title_text, subtitle_text, school_name, summary_metrics, dataframe=None, custom_sections=None):
    buffer = BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=letter, rightMargin=36, leftMargin=36, topMargin=36, bottomMargin=36)
    story = []
    styles = getSampleStyleSheet()

    primary_color = colors.HexColor('#2563EB')
    dark_neutral = colors.HexColor('#1E293B')
    light_bg = colors.HexColor('#F8FAFC')
    border_color = colors.HexColor('#E2E8F0')
    accent_color = colors.HexColor('#0F172A')

    title_style = ParagraphStyle('DocTitle', parent=styles['Heading1'], fontSize=16, leading=20, textColor=primary_color, fontName='Helvetica-Bold')
    subtitle_style = ParagraphStyle('DocSubTitle', parent=styles['Normal'], fontSize=9, leading=13, textColor=dark_neutral)
    school_style = ParagraphStyle('SchoolHead', parent=styles['Normal'], fontSize=10, leading=14, textColor=accent_color, fontName='Helvetica-Bold')
    sec_head_style = ParagraphStyle('SecHead', parent=styles['Heading2'], fontSize=11, leading=15, textColor=primary_color, fontName='Helvetica-Bold', spaceBefore=12, spaceAfter=5)
    normal_style = ParagraphStyle('Body', parent=styles['Normal'], fontSize=8.5, leading=13, textColor=dark_neutral)
    link_style = ParagraphStyle('LinkStyle', parent=styles['Normal'], fontSize=8, leading=11, textColor=colors.HexColor('#2563EB'), fontName='Helvetica-Bold')
    card_header = ParagraphStyle('CardHead', parent=styles['Normal'], fontSize=7.5, leading=10, textColor=colors.HexColor('#64748B'), fontName='Helvetica-Bold', alignment=1)
    card_value = ParagraphStyle('CardVal', parent=styles['Normal'], fontSize=11, leading=14, textColor=primary_color, fontName='Helvetica-Bold', alignment=1)
    
    story.append(Paragraph(f"<b>{title_text}</b>", title_style))[span_276](start_span)[span_276](end_span)
    story.append(Spacer(1, 4))[span_277](start_span)[span_277](end_span)
    story.append(Paragraph(f"🏫 <b>Institution / School Focus:</b> {school_name}", school_style))[span_278](start_span)[span_278](end_span)
    story.append(Spacer(1, 3))[span_279](start_span)[span_279](end_span)
    story.append(Paragraph(subtitle_text, subtitle_style))[span_280](start_span)[span_280](end_span)
    story.append(Spacer(1, 8))[span_281](start_span)[span_281](end_span)
    story.append(HRFlowable(width="100%", thickness=1.5, color=primary_color, spaceAfter=12))[span_282](start_span)[span_282](end_span)

    if summary_metrics:[span_283](start_span)[span_283](end_span)
        headers_row = [Paragraph(k, card_header) for k in summary_metrics.keys()][span_284](start_span)[span_284](end_span)
        values_row = [Paragraph(str(v), card_value) for v in summary_metrics.values()][span_285](start_span)[span_285](end_span)
        col_w = 540 / len(summary_metrics)[span_286](start_span)[span_286](end_span)
        kpi_table = Table([headers_row, values_row], colWidths=[col_w] * len(summary_metrics))[span_287](start_span)[span_287](end_span)
        kpi_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), light_bg),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('GRID', (0, 0), (-1, -1), 0.5, border_color),
            ('TOPPADDING', (0, 0), (-1, -1), 8),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
        ]))[span_288](start_span)[span_288](end_span)
        story.append(kpi_table)[span_289](start_span)[span_289](end_span)
        story.append(Spacer(1, 12))[span_290](start_span)[span_290](end_span)

    if custom_sections:[span_291](start_span)[span_291](end_span)
        for heading, body_items in custom_sections.items():[span_292](start_span)[span_292](end_span)
            story.append(Paragraph(f"<b>{heading}</b>", sec_head_style))[span_293](start_span)[span_293](end_span)
            story.append(HRFlowable(width="100%", thickness=0.5, color=border_color, spaceAfter=6))[span_294](start_span)[span_294](end_span)
            for item in body_items:[span_295](start_span)[span_295](end_span)
                if "<a href=" in item:[span_296](start_span)[span_296](end_span)
                    story.append(Paragraph(f"{item}", link_style))[span_297](start_span)[span_297](end_span)
                else:
                    story.append(Paragraph(f"• {item}", normal_style))[span_298](start_span)[span_298](end_span)
            story.append(Spacer(1, 10))[span_299](start_span)[span_299](end_span)

    if dataframe is not None and not dataframe.empty:[span_300](start_span)[span_300](end_span)
        story.append(Spacer(1, 4))[span_301](start_span)[span_301](end_span)
        raw_data = [dataframe.columns.tolist()] + dataframe.astype(str).values.tolist()[span_302](start_span)[span_302](end_span)
        cell_style = ParagraphStyle('TableCell', parent=styles['Normal'], fontSize=8, leading=12, textColor=dark_neutral)[span_303](start_span)[span_303](end_span)
        header_style = ParagraphStyle('TableHeader', parent=styles['Normal'], fontSize=8.5, leading=12, textColor=colors.white, fontName='Helvetica-Bold')[span_304](start_span)[span_304](end_span)

        formatted_data = [][span_305](start_span)[span_305](end_span)
        for i, row in enumerate(raw_data):[span_306](start_span)[span_306](end_span)
            formatted_row = [][span_307](start_span)[span_307](end_span)
            for cell in row:[span_308](start_span)[span_308](end_span)
                st_to_use = header_style if i == 0 else cell_style[span_309](start_span)[span_309](end_span)
                formatted_row.append(Paragraph(str(cell), st_to_use))[span_310](start_span)[span_310](end_span)
            formatted_data.append(formatted_row)[span_311](start_span)[span_311](end_span)

        num_cols = len(dataframe.columns)[span_312](start_span)[span_312](end_span)
        col_width = 540 / num_cols[span_313](start_span)[span_313](end_span)

        pdf_table = Table(formatted_data, colWidths=[col_width] * num_cols, repeatRows=1)[span_314](start_span)[span_314](end_span)
        pdf_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), primary_color),
            ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('GRID', (0, 0), (-1, -1), 0.4, border_color),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, light_bg]),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
            ('TOPPADDING', (0, 0), (-1, -1), 6),
        ]))[span_315](start_span)[span_315](end_span)
        story.append(pdf_table)[span_316](start_span)[span_316](end_span)

    doc.build(story)[span_317](start_span)[span_317](end_span)
    buffer.seek(0)[span_318](start_span)[span_318](end_span)
    return buffer[span_319](start_span)[span_319](end_span)


# --- R2 EVIDENCE RESOLUTION HELPERS ---
def _is_legacy_http_url(value: str) -> bool:
    return value.strip().lower().startswith(("http://", "https://"))[span_320](start_span)[span_320](end_span)


def split_evidence_raw_value(raw_val: str):
    if raw_val is None:
        return []
    raw_val = str(raw_val).strip()
    if not raw_val or raw_val.lower() in ("nan", "none", "null"):
        return []
    return [v.strip() for v in raw_val.split(",") if v.strip()][span_321](start_span)[span_321](end_span)


def detect_evidence_file_type(value: str) -> str:
    path_part = urllib.parse.urlparse(value).path if _is_legacy_http_url(value) else value[span_322](start_span)[span_322](end_span)
    ext = os.path.splitext(path_part)[1].lower()[span_323](start_span)[span_323](end_span)
    if ext in (".mp3", ".wav", ".m4a", ".aac", ".ogg", ".opus", ".weba"):[span_324](start_span)[span_324](end_span)
        return "audio[span_325](start_span)"[span_325](end_span)
    if ext in (".mp4", ".mov", ".m4v", ".avi", ".mkv", ".webm"):[span_326](start_span)[span_326](end_span)
        return "video[span_327](start_span)"[span_327](end_span)
    if ext in (".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".heic"):[span_328](start_span)[span_328](end_span)
        return "image[span_329](start_span)"[span_329](end_span)
    if ext == ".pdf":[span_330](start_span)[span_330](end_span)
        return "pdf[span_331](start_span)"[span_331](end_span)
    return "other[span_332](start_span)"[span_332](end_span)


def get_public_evidence_url(object_key: str):
    if not R2_ENABLED or not object_key:
        return None
    encoded_key = urllib.parse.quote(object_key, safe="/")[span_333](start_span)[span_333](end_span)
    return f"{R2_PUBLIC_BASE_URL}/{encoded_key}[span_334](start_span)"[span_334](end_span)


def resolve_evidence_links(raw_value: str):
    resolved = []
    for single_val in split_evidence_raw_value(raw_value):[span_335](start_span)[span_335](end_span)
        if _is_legacy_http_url(single_val):[span_336](start_span)[span_336](end_span)
            resolved.append({
                "source": "legacy_url",
                "object_key": None,
                "url": single_val,
                "file_type": detect_evidence_file_type(single_val),
            })[span_337](start_span)[span_337](end_span)
        else:
            object_key = single_val.lstrip("/")[span_338](start_span)[span_338](end_span)
            resolved.append({
                "source": "r2_key",
                "object_key": object_key,
                "url": get_public_evidence_url(object_key) or "",
                "file_type": detect_evidence_file_type(object_key),
            })[span_339](start_span)[span_339](end_span)
    return resolved[span_340](start_span)[span_340](end_span)


def render_evidence_media_preview(item: dict, widget_key: str):
    display_url = item.get("url")[span_341](start_span)[span_341](end_span)
    file_type = item.get("file_type", "other")[span_342](start_span)[span_342](end_span)
    if not display_url:[span_343](start_span)[span_343](end_span)
        st.caption("⚠️ Evidence file could not be loaded from R2 (missing key or public base URL).")[span_344](start_span)[span_344](end_span)
        return
    try:
        if file_type == "audio":[span_345](start_span)[span_345](end_span)
            st.audio(display_url)[span_346](start_span)[span_346](end_span)
        elif file_type == "video":[span_347](start_span)[span_347](end_span)
            st.video(display_url)[span_348](start_span)[span_348](end_span)
        elif file_type == "image":[span_349](start_span)[span_349](end_span)
            st.image(display_url, use_container_width=True)[span_350](start_span)[span_350](end_span)
        elif file_type == "pdf":[span_351](start_span)[span_351](end_span)
            st.markdown(
                f'<iframe src="{display_url}" width="100%" height="480" '
                f'style="border:1px solid #E2E8F0;border-radius:6px;"></iframe>',
                unsafe_allow_html=True,
            )[span_352](start_span)[span_352](end_span)
        else:
            st.markdown(f"[⬇️ Open / Download File]({display_url})")[span_353](start_span)[span_353](end_span)
    except Exception:
        st.caption("⚠️ Unable to render an inline preview for this file. Use the link to open it directly.")[span_354](start_span)[span_354](end_span)


def extract_evidence_items_vectorized(df_src, col_name):
    if col_name not in df_src.columns or df_src.empty:[span_355](start_span)[span_355](end_span)
        return [][span_356](start_span)[span_356](end_span)

    col_str = df_src[col_name].fillna('').astype(str).str.strip()[span_357](start_span)[span_357](end_span)
    valid_mask = col_str.str.len() > 0[span_358](start_span)[span_358](end_span)
    valid_rows = df_src[valid_mask][span_359](start_span)[span_359](end_span)

    if valid_rows.empty:[span_360](start_span)[span_360](end_span)
        return [][span_361](start_span)[span_361](end_span)

    items = [][span_362](start_span)[span_362](end_span)
    for _, r in valid_rows.iterrows():[span_363](start_span)[span_363](end_span)
        raw_val = str(r[col_name]).strip()[span_364](start_span)[span_364](end_span)
        resolved_files = resolve_evidence_links(raw_val)[span_365](start_span)[span_365](end_span)
        if not resolved_files:[span_366](start_span)[span_366](end_span)
            continue
        d_str = str(r['Date']) if 'Date' in r and pd.notna(r['Date']) else "Recent[span_367](start_span)"[span_367](end_span)
        g_str = f"Grade {r['Grade']}" if 'Grade' in r and str(r['Grade']).strip() else "Grade N/A[span_368](start_span)"[span_368](end_span)
        s_str = str(r['Subject']).strip() if 'Subject' in r and str(r['Subject']).strip() else "General Subject[span_369](start_span)"[span_369](end_span)
        b_str = str(r['Book']).strip() if 'Book' in r and str(r['Book']).strip() else "Lesson Plan[span_370](start_span)"[span_370](end_span)
        for f in resolved_files:[span_371](start_span)[span_371](end_span)
            items.append({
                'url': f['url'],
                'file_type': f['file_type'],
                'object_key': f['object_key'],
                'source': f['source'],
                'date': d_str, 'grade': g_str, 'subject': s_str, 'lesson': b_str,
            })[span_372](start_span)[span_372](end_span)

    seen = set()[span_373](start_span)[span_373](end_span)
    deduped = [][span_374](start_span)[span_374](end_span)
    for item in items:[span_375](start_span)[span_375](end_span)
        dedup_key = item.get('object_key') or item['url'][span_376](start_span)[span_376](end_span)
        if dedup_key not in seen:[span_377](start_span)[span_377](end_span)
            seen.add(dedup_key)[span_378](start_span)[span_378](end_span)
            deduped.append(item)[span_379](start_span)[span_379](end_span)
    return deduped[span_380](start_span)[span_380](end_span)


def evidence_items_across_columns(df_src, columns):
    items = [][span_381](start_span)[span_381](end_span)
    seen = set()[span_382](start_span)[span_382](end_span)
    for col in columns:[span_383](start_span)[span_383](end_span)
        for item in extract_evidence_items_vectorized(df_src, col):[span_384](start_span)[span_384](end_span)
            url = item.get('url', '').strip()[span_385](start_span)[span_385](end_span)
            if url and url not in seen:[span_386](start_span)[span_386](end_span)
                seen.add(url)[span_387](start_span)[span_387](end_span)
                items.append(item)[span_388](start_span)[span_388](end_span)
    return items[span_389](start_span)[span_389](end_span)


def generate_comprehensive_school_pdf_report(school_name, teachers_list, school_filtered_df, filtered_df, filter_desc, calc_ld_kpi, calc_content_kpi, calc_lib_kpi, daily_ld_target, daily_content_target, daily_lib_target, selected_num_days, target_vid_count=3, target_writing_count=3, target_lp_combo_count=3, target_phonics_count=2, target_portfolio_count=1, enable_quant_kpi=True, enable_qual_kpi=True, active_metric_mode="Content / Book Usage"):
    buffer = BytesIO()[span_390](start_span)[span_390](end_span)
    doc = SimpleDocTemplate(buffer, pagesize=letter, rightMargin=36, leftMargin=36, topMargin=36, bottomMargin=36)[span_391](start_span)[span_391](end_span)
    story = [][span_392](start_span)[span_392](end_span)
    styles = getSampleStyleSheet()[span_393](start_span)[span_393](end_span)

    primary_color = colors.HexColor('#2563EB')[span_394](start_span)[span_394](end_span)
    dark_neutral = colors.HexColor('#1E293B')[span_395](start_span)[span_395](end_span)
    light_bg = colors.HexColor('#F8FAFC')[span_396](start_span)[span_396](end_span)
    border_color = colors.HexColor('#E2E8F0')[span_397](start_span)[span_397](end_span)
    accent_color = colors.HexColor('#0F172A')[span_398](start_span)[span_398](end_span)

    title_style = ParagraphStyle('DocTitle', parent=styles['Heading1'], fontSize=16, leading=20, textColor=primary_color, fontName='Helvetica-Bold')[span_399](start_span)[span_399](end_span)
    subtitle_style = ParagraphStyle('DocSubTitle', parent=styles['Normal'], fontSize=9, leading=13, textColor=dark_neutral)[span_400](start_span)[span_400](end_span)
    school_style = ParagraphStyle('SchoolHead', parent=styles['Normal'], fontSize=10, leading=14, textColor=accent_color, fontName='Helvetica-Bold')[span_401](start_span)[span_401](end_span)
    sec_head_style = ParagraphStyle('SecHead', parent=styles['Heading2'], fontSize=11, leading=15, textColor=primary_color, fontName='Helvetica-Bold', spaceBefore=12, spaceAfter=5)[span_402](start_span)[span_402](end_span)
    normal_style = ParagraphStyle('Body', parent=styles['Normal'], fontSize=8.5, leading=13, textColor=dark_neutral)[span_403](start_span)[span_403](end_span)
    link_style = ParagraphStyle('LinkStyle', parent=styles['Normal'], fontSize=8, leading=11, textColor=colors.HexColor('#2563EB'), fontName='Helvetica-Bold')[span_404](start_span)[span_404](end_span)
    card_header = ParagraphStyle('CardHead', parent=styles['Normal'], fontSize=7.5, leading=10, textColor=colors.HexColor('#64748B'), fontName='Helvetica-Bold', alignment=1)[span_405](start_span)[span_405](end_span)
    card_value = ParagraphStyle('CardVal', parent=styles['Normal'], fontSize=11, leading=14, textColor=primary_color, fontName='Helvetica-Bold', alignment=1)[span_406](start_span)[span_406](end_span)

    if isinstance(school_name, (list, tuple, set, np.ndarray, pd.Series)):[span_407](start_span)[span_407](end_span)
        school_names = [str(x) for x in school_name if str(x).strip()][span_408](start_span)[span_408](end_span)
        school_curr_df = filtered_df[filtered_df['Institution'].isin(school_names)][span_409](start_span)[span_409](end_span)
    else:
        school_names = [str(school_name)][span_410](start_span)[span_410](end_span)
        school_curr_df = filtered_df[filtered_df['Institution'] == school_name][span_411](start_span)[span_411](end_span)

    include_content = "Content" in active_metric_mode or "Both" in active_metric_mode[span_412](start_span)[span_412](end_span)
    include_library = "Library" in active_metric_mode or "Both" in active_metric_mode[span_413](start_span)[span_413](end_span)

    story.append(Paragraph(f"<b>Comprehensive School Audit & Feature-Wise Report</b>", title_style))[span_414](start_span)[span_414](end_span)
    story.append(Spacer(1, 4))[span_415](start_span)[span_415](end_span)
    story.append(Paragraph(f"<b>Institution / School Focus:</b> {school_name}", school_style))[span_416](start_span)[span_416](end_span)
    story.append(Spacer(1, 3))[span_417](start_span)[span_417](end_span)
    story.append(Paragraph(f"Observation Window: {filter_desc} | Focus Mode: {active_metric_mode}", subtitle_style))[span_418](start_span)[span_418](end_span)
    story.append(Spacer(1, 8))[span_419](start_span)[span_419](end_span)
    story.append(HRFlowable(width="100%", thickness=1.5, color=primary_color, spaceAfter=12))[span_420](start_span)[span_420](end_span)

    ld_df = school_curr_df[school_curr_df['Type'] == 'lessonDelivery'][span_421](start_span)[span_421](end_span)
    ld_usage = ld_df.groupby('FullName')['Duration_Min'].sum().to_dict()[span_422](start_span)[span_422](end_span)
    
    lib_df = school_curr_df[school_curr_df['Type'] == 'library'][span_423](start_span)[span_423](end_span)
    lib_usage = lib_df.groupby('FullName')['Duration_Min'].sum().to_dict()[span_424](start_span)[span_424](end_span)

    content_raw = school_curr_df[school_curr_df['Book'].str.len() > 0][span_425](start_span)[span_425](end_span)
    content_df = content_raw[~content_raw['Book'].str.match(r'^Lesson Plan', case=False, na=False)][span_426](start_span)[span_426](end_span)
    content_usage = content_df.groupby('FullName')['Duration_Min'].sum().to_dict()[span_427](start_span)[span_427](end_span)
    content_books_opened = content_df.groupby('FullName')['Book'].nunique().to_dict()[span_428](start_span)[span_428](end_span)

    total_teachers_count = len(teachers_list)[span_429](start_span)[span_429](end_span)
    met_ld_count = 0[span_430](start_span)[span_430](end_span)
    met_content_count = 0[span_431](start_span)[span_431](end_span)
    met_lib_count = 0[span_432](start_span)[span_432](end_span)

    for t_name in teachers_list:[span_433](start_span)[span_433](end_span)
        t_ld = ld_usage.get(t_name, 0.0)[span_434](start_span)[span_434](end_span)
        t_content = content_usage.get(t_name, 0.0)[span_435](start_span)[span_435](end_span)
        t_lib = lib_usage.get(t_name, 0.0)[span_436](start_span)[span_436](end_span)
        
        if (calc_ld_kpi > 0 and t_ld >= calc_ld_kpi) or (calc_ld_kpi == 0 and t_ld > 0):[span_437](start_span)[span_437](end_span)
            met_ld_count += 1[span_438](start_span)[span_438](end_span)
        if (calc_content_kpi > 0 and t_content >= calc_content_kpi) or (calc_content_kpi == 0 and t_content > 0):[span_439](start_span)[span_439](end_span)
            met_content_count += 1[span_440](start_span)[span_440](end_span)
        if (calc_lib_kpi > 0 and t_lib >= calc_lib_kpi) or (calc_lib_kpi == 0 and t_lib > 0):[span_441](start_span)[span_441](end_span)
            met_lib_count += 1[span_442](start_span)[span_442](end_span)

    school_summary_metrics = {
        "Active Roster Teachers": total_teachers_count,
        "Working Days Evaluated": f"{selected_num_days} Days"
    }[span_443](start_span)[span_443](end_span)
    if enable_quant_kpi:[span_444](start_span)[span_444](end_span)
        school_summary_metrics["Met Lesson Prep KPI"] = f"{met_ld_count} / {total_teachers_count}[span_445](start_span)"[span_445](end_span)
        if include_content:[span_446](start_span)[span_446](end_span)
            school_summary_metrics["Met Content (Book) KPI"] = f"{met_content_count} / {total_teachers_count}[span_447](start_span)"[span_447](end_span)
        if include_library:[span_448](start_span)[span_448](end_span)
            school_summary_metrics["Met Library KPI"] = f"{met_lib_count} / {total_teachers_count}[span_449](start_span)"[span_449](end_span)

    headers_row = [Paragraph(k, card_header) for k in school_summary_metrics.keys()][span_450](start_span)[span_450](end_span)
    values_row = [Paragraph(str(v), card_value) for v in school_summary_metrics.values()][span_451](start_span)[span_451](end_span)
    col_w = 540 / len(school_summary_metrics)[span_452](start_span)[span_452](end_span)
    kpi_table = Table([headers_row, values_row], colWidths=[col_w] * len(school_summary_metrics))[span_453](start_span)[span_453](end_span)
    kpi_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), light_bg),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('GRID', (0, 0), (-1, -1), 0.5, border_color),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
    ]))[span_454](start_span)[span_454](end_span)
    story.append(kpi_table)[span_455](start_span)[span_455](end_span)
    story.append(Spacer(1, 10))[span_456](start_span)[span_456](end_span)

    if enable_quant_kpi:[span_457](start_span)[span_457](end_span)
        story.append(Paragraph("<b>School-Level Feature Performance Summary & Guidelines</b>", sec_head_style))[span_458](start_span)[span_458](end_span)
        story.append(HRFlowable(width="100%", thickness=0.5, color=border_color, spaceAfter=6))[span_459](start_span)[span_459](end_span)
        story.append(Paragraph(f"• <b>Lesson Plan Prep Standard:</b> {daily_ld_target:.0f} mins/day × {selected_num_days} working days ({calc_ld_kpi:.0f} mins total benchmark standard)", normal_style))[span_460](start_span)[span_460](end_span)
        if include_content:[span_461](start_span)[span_461](end_span)
            story.append(Paragraph(f"• <b>Content / Book Usage Standard:</b> {daily_content_target:.0f} mins/day × {selected_num_days} working days ({calc_content_kpi:.0f} mins total benchmark standard)", normal_style))[span_462](start_span)[span_462](end_span)
        if include_library:[span_463](start_span)[span_463](end_span)
            story.append(Paragraph(f"• <b>Library Usage Standard:</b> {daily_lib_target:.0f} mins/day × {selected_num_days} working days ({calc_lib_kpi:.0f} mins total benchmark standard)", normal_style))[span_464](start_span)[span_464](end_span)
        story.append(Spacer(1, 10))[span_465](start_span)[span_465](end_span)

    story.append(Paragraph("<b>1. Lesson Plan Preparation Consolidated Report</b>", sec_head_style))[span_466](start_span)[span_466](end_span)
    ld_summary_table_data = [["Teacher Name", "Total Minutes Logged", "Average Mins/Day", "Performance Indicator Status"]][span_467](start_span)[span_467](end_span)
    for t_name in teachers_list:[span_468](start_span)[span_468](end_span)
        t_mins = ld_usage.get(t_name, 0.0)[span_469](start_span)[span_469](end_span)
        t_avg = t_mins / selected_num_days if selected_num_days > 0 else 0.0[span_470](start_span)[span_470](end_span)
        if not enable_quant_kpi or calc_ld_kpi == 0:[span_471](start_span)[span_471](end_span)
            t_stat = "Activity Logged" if t_mins > 0 else "No Activity Logged[span_472](start_span)"[span_472](end_span)
        elif t_mins >= calc_ld_kpi:[span_473](start_span)[span_473](end_span)
            t_stat = f"Met Performance Indicator (>= {calc_ld_kpi:.0f}m)[span_474](start_span)"[span_474](end_span)
        elif t_mins > 0.0:[span_475](start_span)[span_475](end_span)
            t_stat = f"Below Performance Indicator (< {calc_ld_kpi:.0f}m)[span_476](start_span)"[span_476](end_span)
        else:
            t_stat = "Inactive (0 Mins)[span_477](start_span)"[span_477](end_span)
        ld_summary_table_data.append([t_name, f"{t_mins:.1f}m", f"{t_avg:.1f}m/day", t_stat])[span_478](start_span)[span_478](end_span)

    ld_table_obj = Table(ld_summary_table_data, colWidths=[140, 110, 100, 190])[span_479](start_span)[span_479](end_span)
    ld_table_obj.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), primary_color),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 8),
        ('GRID', (0, 0), (-1, -1), 0.4, border_color),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, light_bg]),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
    ]))[span_480](start_span)[span_480](end_span)
    story.append(ld_table_obj)[span_481](start_span)[span_481](end_span)
    story.append(Spacer(1, 14))[span_482](start_span)[span_482](end_span)

    if include_content:[span_483](start_span)[span_483](end_span)
        story.append(Paragraph("<b>2. Content & Chapter Usage Consolidated Report</b>", sec_head_style))[span_484](start_span)[span_484](end_span)
        content_summary_table_data = [["Teacher Name", "Total Minutes Logged", "Average Mins/Day", "Textbooks/Chapters Opened", "Status"]][span_485](start_span)[span_485](end_span)
        for t_name in teachers_list:[span_486](start_span)[span_486](end_span)
            t_content_mins = content_usage.get(t_name, 0.0)[span_487](start_span)[span_487](end_span)
            t_content_avg = t_content_mins / selected_num_days if selected_num_days > 0 else 0.0[span_488](start_span)[span_488](end_span)
            t_content_books = content_books_opened.get(t_name, 0)[span_489](start_span)[span_489](end_span)
            if not enable_quant_kpi or calc_content_kpi == 0:[span_490](start_span)[span_490](end_span)
                t_cstat = "Activity Logged" if t_content_mins > 0 else "No Activity Logged[span_491](start_span)"[span_491](end_span)
            elif t_content_mins >= calc_content_kpi:[span_492](start_span)[span_492](end_span)
                t_cstat = f"Met KPI (>= {calc_content_kpi:.0f}m)[span_493](start_span)"[span_493](end_span)
            elif t_content_mins > 0:[span_494](start_span)[span_494](end_span)
                t_cstat = f"Below KPI (< {calc_content_kpi:.0f}m)[span_495](start_span)"[span_495](end_span)
            else:
                t_cstat = "Inactive (0 Mins)[span_496](start_span)"[span_496](end_span)
            content_summary_table_data.append([t_name, f"{t_content_mins:.1f}m", f"{t_content_avg:.1f}m/day", str(t_content_books), t_cstat])[span_497](start_span)[span_497](end_span)

        content_table_obj = Table(content_summary_table_data, colWidths=[130, 95, 95, 100, 120])[span_498](start_span)[span_498](end_span)
        content_table_obj.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), primary_color),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 8),
            ('GRID', (0, 0), (-1, -1), 0.4, border_color),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, light_bg]),
            ('TOPPADDING', (0, 0), (-1, -1), 5),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ]))[span_499](start_span)[span_499](end_span)
        story.append(content_table_obj)[span_500](start_span)[span_500](end_span)
        story.append(Spacer(1, 14))[span_501](start_span)[span_501](end_span)

    if include_library:[span_502](start_span)[span_502](end_span)
        sec_num = "3" if include_content else "2[span_503](start_span)"[span_503](end_span)
        story.append(Paragraph(f"<b>{sec_num}. Library Usage Overview </b>", sec_head_style))[span_504](start_span)[span_504](end_span)
        lib_summary_table_data = [["Teacher Name", "Total Minutes Logged", "Average Mins/Day", "Status"]][span_505](start_span)[span_505](end_span)
        for t_name in teachers_list:[span_506](start_span)[span_506](end_span)
            t_lib_mins = lib_usage.get(t_name, 0.0)[span_507](start_span)[span_507](end_span)
            t_lib_avg = t_lib_mins / selected_num_days if selected_num_days > 0 else 0.0[span_508](start_span)[span_508](end_span)
            if not enable_quant_kpi or calc_lib_kpi == 0:[span_509](start_span)[span_509](end_span)
                t_lib_stat = "Activity Logged" if t_lib_mins > 0 else "No Activity Logged[span_510](start_span)"[span_510](end_span)
            elif t_lib_mins >= calc_lib_kpi:[span_511](start_span)[span_511](end_span)
                t_lib_stat = f"Met KPI (>= {calc_lib_kpi:.0f}m)[span_512](start_span)"[span_512](end_span)
            elif t_lib_mins > 0:[span_513](start_span)[span_513](end_span)
                t_lib_stat = f"Below KPI (< {calc_lib_kpi:.0f}m)[span_514](start_span)"[span_514](end_span)
            else:
                t_lib_stat = "Inactive (0 Mins)[span_515](start_span)"[span_515](end_span)
            lib_summary_table_data.append([t_name, f"{t_lib_mins:.1f}m", f"{t_lib_avg:.1f}m/day", t_lib_stat])[span_516](start_span)[span_516](end_span)

        lib_table_obj = Table(lib_summary_table_data, colWidths=[140, 110, 100, 190])[span_517](start_span)[span_517](end_span)
        lib_table_obj.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), primary_color),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 8),
            ('GRID', (0, 0), (-1, -1), 0.4, border_color),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, light_bg]),
            ('TOPPADDING', (0, 0), (-1, -1), 5),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ]))[span_518](start_span)[span_518](end_span)
        story.append(lib_table_obj)[span_519](start_span)[span_519](end_span)
        story.append(Spacer(1, 14))[span_520](start_span)[span_520](end_span)

    if enable_qual_kpi:[span_521](start_span)[span_521](end_span)
        story.append(Paragraph("<b>Classroom Submissions & Evidence Compliance</b>", sec_head_style))[span_522](start_span)[span_522](end_span)
        qual_summary_table_data = [["Teacher Name", "LP / Audio Notes", "Activity Videos", "Writing Samples", "Phonics Evidences", "Portfolio Artifacts", "Status"]][span_523](start_span)[span_523](end_span)
        
        for t_name in teachers_list:[span_524](start_span)[span_524](end_span)
            sub_t = school_curr_df[school_curr_df['FullName'] == t_name][span_525](start_span)[span_525](end_span)
            v_cnt = len(evidence_items_across_columns(sub_t, ['Video_Evidence_1', 'Video_Evidence_2', 'Video_Evidence_3']))[span_526](start_span)[span_526](end_span)
            w_cnt = len(extract_evidence_items_vectorized(sub_t, 'Writing_Sample_Link'))[span_527](start_span)[span_527](end_span)
            lp_cnt = len(extract_evidence_items_vectorized(sub_t, 'Lesson_Plan_Picture'))[span_528](start_span)[span_528](end_span)
            vn_cnt = len(extract_evidence_items_vectorized(sub_t, 'Voice_Note_Link'))[span_529](start_span)[span_529](end_span)
            ph_cnt = len(extract_evidence_items_vectorized(sub_t, 'Phonics_Evidence_Link'))[span_530](start_span)[span_530](end_span)
            pf_cnt = len(extract_evidence_items_vectorized(sub_t, 'Portfolio_Evidence_Link'))[span_531](start_span)[span_531](end_span)
            
            is_q_ok = (v_cnt >= target_vid_count and w_cnt >= target_writing_count and (lp_cnt + vn_cnt) >= target_lp_combo_count and ph_cnt >= target_phonics_count and pf_cnt >= target_portfolio_count)[span_532](start_span)[span_532](end_span)
            q_stat = "Met Standard" if is_q_ok else "In Progress[span_533](start_span)"[span_533](end_span)
            qual_summary_table_data.append([t_name, str(lp_cnt + vn_cnt), str(v_cnt), str(w_cnt), str(ph_cnt), str(pf_cnt), q_stat])[span_534](start_span)[span_534](end_span)

        qual_table_obj = Table(qual_summary_table_data, colWidths=[130, 80, 70, 70, 75, 75, 40])[span_535](start_span)[span_535](end_span)
        qual_table_obj.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), primary_color),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('ALIGN', (0, 0), (0, -1), 'LEFT'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 7.5),
            ('GRID', (0, 0), (-1, -1), 0.4, border_color),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, light_bg]),
            ('TOPPADDING', (0, 0), (-1, -1), 5),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ]))[span_536](start_span)[span_536](end_span)
        story.append(qual_table_obj)[span_537](start_span)[span_537](end_span)
        story.append(Spacer(1, 12))[span_538](start_span)[span_538](end_span)

    for target_teacher in teachers_list:[span_539](start_span)[span_539](end_span)
        story.append(PageBreak())[span_540](start_span)[span_540](end_span)

        teacher_date_data = school_curr_df[school_curr_df['FullName'] == target_teacher][span_541](start_span)[span_541](end_span)

        t_day_ld = teacher_date_data[teacher_date_data['Type'] == 'lessonDelivery']['Duration_Min'].sum() if not teacher_date_data.empty else 0.0[span_542](start_span)[span_542](end_span)
        t_day_lib = teacher_date_data[teacher_date_data['Type'] == 'library']['Duration_Min'].sum() if not teacher_date_data.empty else 0.0[span_543](start_span)[span_543](end_span)
        
        t_books_raw = teacher_date_data[teacher_date_data['Book'].str.len() > 0][span_544](start_span)[span_544](end_span)
        teacher_books = t_books_raw[~t_books_raw['Book'].str.match(r'^Lesson Plan', case=False, na=False)][span_545](start_span)[span_545](end_span)
        t_day_content = teacher_books['Duration_Min'].sum() if not teacher_books.empty else 0.0[span_546](start_span)[span_546](end_span)

        ld_pct = safe_percentage(t_day_ld, calc_ld_kpi)[span_547](start_span)[span_547](end_span)
        content_pct = safe_percentage(t_day_content, calc_content_kpi)[span_548](start_span)[span_548](end_span)
        lib_pct = safe_percentage(t_day_lib, calc_lib_kpi)[span_549](start_span)[span_549](end_span)

        ld_advice = f"Steady Execution ({t_day_ld:.1f}m logged)" if (calc_ld_kpi > 0 and t_day_ld >= calc_ld_kpi) else (f"In-Progress ({t_day_ld:.1f}m logged)" if t_day_ld > 0 else "Pending Activity")[span_550](start_span)[span_550](end_span)
        content_advice = f"Steady Execution ({t_day_content:.1f}m logged)" if (calc_content_kpi > 0 and t_day_content >= calc_content_kpi) else (f"In-Progress ({t_day_content:.1f}m logged)" if t_day_content > 0 else "Pending Activity")[span_551](start_span)[span_551](end_span)
        lib_advice = f"Steady Execution ({t_day_lib:.1f}m logged)" if (calc_lib_kpi > 0 and t_day_lib >= calc_lib_kpi) else (f"In-Progress ({t_day_lib:.1f}m logged)" if t_day_lib > 0 else "Pending Activity")[span_552](start_span)[span_552](end_span)

        evidence_source = teacher_date_data[span_553](start_span)[span_553](end_span)

        v_voice = extract_evidence_items_vectorized(evidence_source, 'Voice_Note_Link')[span_554](start_span)[span_554](end_span)
        v_pic = extract_evidence_items_vectorized(evidence_source, 'Lesson_Plan_Picture')[span_555](start_span)[span_555](end_span)
        v_writing = extract_evidence_items_vectorized(evidence_source, 'Writing_Sample_Link')[span_556](start_span)[span_556](end_span)
        v_phonics = extract_evidence_items_vectorized(evidence_source, 'Phonics_Evidence_Link')[span_557](start_span)[span_557](end_span)
        v_portfolio = extract_evidence_items_vectorized(evidence_source, 'Portfolio_Evidence_Link')[span_558](start_span)[span_558](end_span)
        v_vid = evidence_items_across_columns(evidence_source, ['Video_Evidence_1', 'Video_Evidence_2', 'Video_Evidence_3'])[span_559](start_span)[span_559](end_span)

        lp_combo_total = len(v_voice) + len(v_pic)[span_560](start_span)[span_560](end_span)
        total_artifacts = lp_combo_total + len(v_vid) + len(v_writing) + len(v_phonics) + len(v_portfolio)[span_561](start_span)[span_561](end_span)

        pdf_book_items = [][span_562](start_span)[span_562](end_span)
        if not teacher_books.empty:[span_563](start_span)[span_563](end_span)
            b_summary_df = teacher_books.groupby(['Book', 'Grade', 'Subject'])['Duration_Min'].sum().reset_index()[span_564](start_span)[span_564](end_span)
            for _, br in b_summary_df.iterrows():[span_565](start_span)[span_565](end_span)
                pdf_book_items.append(f"Book: {br['Book']} ({br['Grade']} - {br['Subject']}) | Time Spent: {br['Duration_Min']:.1f} Mins")[span_566](start_span)[span_566](end_span)
        else:
            pdf_book_items.append("No textbooks or digital modules opened.")[span_567](start_span)[span_567](end_span)

        pdf_link_items = [][span_568](start_span)[span_568](end_span)
        for i, item in enumerate(v_voice, 1):[span_569](start_span)[span_569](end_span)
            pdf_link_items.append(f'• 🎧 <a href="{item["url"]}"><u><b>Open Voice Reflection #{i}</b></u></a> — <i>{item["grade"]} | {item["subject"]} ({item["lesson"]}, {item["date"]})</i>')[span_570](start_span)[span_570](end_span)
        for i, item in enumerate(v_pic, 1):[span_571](start_span)[span_571](end_span)
            pdf_link_items.append(f'• 🖼️ <a href="{item["url"]}"><u><b>View Lesson Plan Photo #{i}</b></u></a> — <i>{item["grade"]} | {item["subject"]} ({item["lesson"]}, {item["date"]})</i>')[span_572](start_span)[span_572](end_span)
        for i, item in enumerate(v_vid, 1):[span_573](start_span)[span_573](end_span)
            pdf_link_items.append(f'• 🎥 <a href="{item["url"]}"><u><b>Watch Classroom Activity Video #{i}</b></u></a> — <i>{item["grade"]} | {item["subject"]} ({item["lesson"]}, {item["date"]})</i>')[span_574](start_span)[span_574](end_span)
        for i, item in enumerate(v_writing, 1):[span_575](start_span)[span_575](end_span)
            pdf_link_items.append(f'• 📝 <a href="{item["url"]}"><u><b>View Student Writing Sample #{i}</b></u></a> — <i>{item["grade"]} | {item["subject"]} ({item["lesson"]}, {item["date"]})</i>')[span_576](start_span)[span_576](end_span)
        for i, item in enumerate(v_phonics, 1):[span_577](start_span)[span_577](end_span)
            pdf_link_items.append(f'• 🔤 <a href="{item["url"]}"><u><b>Open Phonics Evidence #{i}</b></u></a> — <i>{item["grade"]} | {item["subject"]} ({item["lesson"]}, {item["date"]})</i>')[span_578](start_span)[span_578](end_span)
        for i, item in enumerate(v_portfolio, 1):[span_579](start_span)[span_579](end_span)
            pdf_link_items.append(f'• 📁 <a href="{item["url"]}"><u><b>View Teacher Portfolio Showcase #{i}</b></u></a> — <i>{item["grade"]} | {item["subject"]} ({item["lesson"]}, {item["date"]})</i>')[span_580](start_span)[span_580](end_span)

        story.append(Paragraph(f"<b>Academic Performance Profile: {target_teacher}</b>", title_style))[span_581](start_span)[span_581](end_span)
        story.append(Spacer(1, 4))[span_582](start_span)[span_582](end_span)
        story.append(Paragraph(f"<b>Institution / School Focus:</b> {school_name}", school_style))[span_583](start_span)[span_583](end_span)
        story.append(Spacer(1, 3))[span_584](start_span)[span_584](end_span)
        story.append(Paragraph(f"Observation Window: {filter_desc}", subtitle_style))[span_585](start_span)[span_585](end_span)
        story.append(Spacer(1, 6))[span_586](start_span)[span_586](end_span)
        story.append(HRFlowable(width="100%", thickness=1.5, color=primary_color, spaceAfter=10))[span_587](start_span)[span_587](end_span)

        summary_metrics = {
            "Teacher": target_teacher,
            "Lesson Prep": f"{t_day_ld:.1f}m"
        }[span_588](start_span)[span_588](end_span)
        if include_content:[span_589](start_span)[span_589](end_span)
            summary_metrics["Content (Book)"] = f"{t_day_content:.1f}m[span_590](start_span)"[span_590](end_span)
        if include_library:[span_591](start_span)[span_591](end_span)
            summary_metrics["Library Usage"] = f"{t_day_lib:.1f}m[span_592](start_span)"[span_592](end_span)
        summary_metrics["Phonics / Portfolio"] = f"{len(v_phonics)} / {len(v_portfolio)}[span_593](start_span)"[span_593](end_span)
        summary_metrics["Activity Submissions"] = f"{total_artifacts}[span_594](start_span)"[span_594](end_span)

        headers_row = [Paragraph(k, card_header) for k in summary_metrics.keys()][span_595](start_span)[span_595](end_span)
        values_row = [Paragraph(str(v), card_value) for v in summary_metrics.values()][span_596](start_span)[span_596](end_span)
        col_w = 540 / len(summary_metrics)[span_597](start_span)[span_597](end_span)
        kpi_table = Table([headers_row, values_row], colWidths=[col_w] * len(summary_metrics))[span_598](start_span)[span_598](end_span)
        kpi_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), light_bg),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('GRID', (0, 0), (-1, -1), 0.5, border_color),
            ('TOPPADDING', (0, 0), (-1, -1), 6),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ]))[span_599](start_span)[span_599](end_span)
        story.append(kpi_table)[span_600](start_span)[span_600](end_span)
        story.append(Spacer(1, 10))[span_601](start_span)[span_601](end_span)

        sec1_items = [
            f"Lesson Preparation Duration: {t_day_ld:.1f} Minutes" + (f" ({ld_pct:.0f}% of Academic Benchmark)" if enable_quant_kpi else ""),
        ][span_602](start_span)[span_602](end_span)
        if include_content:[span_603](start_span)[span_603](end_span)
            sec1_items.append(f"Content Usage (Textbooks/Chapters) Duration: {t_day_content:.1f} Minutes" + (f" ({content_pct:.0f}% of Academic Benchmark)" if enable_quant_kpi else "") + f" across {teacher_books['Book'].nunique() if not teacher_books.empty else 0} unique textbook(s)/chapter(s).")[span_604](start_span)[span_604](end_span)
        if include_library:[span_605](start_span)[span_605](end_span)
            sec1_items.append(f"Library Usage Duration: {t_day_lib:.1f} Minutes" + (f" ({lib_pct:.0f}% of Academic Benchmark)" if enable_quant_kpi else ""))[span_606](start_span)[span_606](end_span)

        sec1_items.append(f"Consultant Assessment: {ld_advice} in lesson preparation, " + (f"{content_advice} in textbook content delivery." if include_content else f"{lib_advice} in library integration."))[span_607](start_span)[span_607](end_span)

        sections = {
            "1. Quantitative Performance Indicator Overview": sec1_items
        }[span_608](start_span)[span_608](end_span)
        if include_content:[span_609](start_span)[span_609](end_span)
            sections["2. Detailed Textbook & Chapter Breakdown"] = pdf_book_items[span_610](start_span)[span_610](end_span)
            sections["3. Activity Evidence & Qualitative Artifacts"] = pdf_link_items if pdf_link_items else ["No activity or evidence submission links recorded in active window."][span_611](start_span)[span_611](end_span)
        else:
            sections["2. Activity Evidence & Qualitative Artifacts"] = pdf_link_items if pdf_link_items else ["No activity or evidence submission links recorded in active window."][span_612](start_span)[span_612](end_span)

        for heading, body_items in sections.items():[span_613](start_span)[span_613](end_span)
            story.append(Paragraph(f"<b>{heading}</b>", sec_head_style))[span_614](start_span)[span_614](end_span)
            story.append(HRFlowable(width="100%", thickness=0.5, color=border_color, spaceAfter=4))[span_615](start_span)[span_615](end_span)
            for item in body_items:[span_616](start_span)[span_616](end_span)
                if "<a href=" in item:[span_617](start_span)[span_617](end_span)
                    story.append(Paragraph(f"{item}", link_style))[span_618](start_span)[span_618](end_span)
                else:
                    story.append(Paragraph(f"• {item}", normal_style))[span_619](start_span)[span_619](end_span)
            story.append(Spacer(1, 8))[span_620](start_span)[span_620](end_span)

    doc.build(story)[span_621](start_span)[span_621](end_span)
    buffer.seek(0)[span_622](start_span)[span_622](end_span)
    return buffer[span_623](start_span)[span_623](end_span)


def ingest_excel_to_postgresql(processed_dfs):
    if not processed_dfs:[span_624](start_span)[span_624](end_span)
        return 0, 0[span_625](start_span)[span_625](end_span)
    combined_df = pd.concat(processed_dfs, ignore_index=True)[span_626](start_span)[span_626](end_span)
    combined_df = normalize_identity_columns(combined_df)[span_627](start_span)[span_627](end_span)
    
    db_cols = [
        "State_Zone", "Uploaded_By", "Institution", "Center",
        "FirstName", "LastName", "FullName", "Role", "Type",
        "Grade", "Subject", "Book", "StartTime", "EndTime",
        "Duration_Min", "Voice_Note_Link", "Lesson_Plan_Picture",
        "Video_Evidence_1", "Video_Evidence_2", "Video_Evidence_3",
        "Writing_Sample_Link", "Phonics_Evidence_Link", "Portfolio_Evidence_Link",
        "Assessment_Score_Pct", "Record_Hash"
    ][span_628](start_span)[span_628](end_span)
    
    for col in db_cols:[span_629](start_span)[span_629](end_span)
        if col not in combined_df.columns:[span_630](start_span)[span_630](end_span)
            combined_df[col] = None[span_631](start_span)[span_631](end_span)

    for dt_col in ['StartTime', 'EndTime']:[span_632](start_span)[span_632](end_span)
        combined_df[dt_col] = pd.to_datetime(combined_df[dt_col], errors='coerce')[span_633](start_span)[span_633](end_span)

    if 'Duration_Min' in combined_df.columns:[span_634](start_span)[span_634](end_span)
        combined_df['Duration_Min'] = pd.to_numeric(combined_df['Duration_Min'], errors='coerce').fillna(0.0).clip(lower=0.0)[span_635](start_span)[span_635](end_span)

    if combined_df['StartTime'].isna().all():[span_636](start_span)[span_636](end_span)
        combined_df['StartTime'] = pd.Timestamp.now()[span_637](start_span)[span_637](end_span)

    combined_df['Record_Hash'] = combined_df.apply(compute_record_hash, axis=1)[span_638](start_span)[span_638](end_span)

    cleaned_df = combined_df[db_cols].copy()[span_639](start_span)[span_639](end_span)
    cleaned_df = cleaned_df.replace({np.nan: None})[span_640](start_span)[span_640](end_span)
    total_incoming = len(cleaned_df)[span_641](start_span)[span_641](end_span)

    cleaned_df = cleaned_df.drop_duplicates(subset=['Record_Hash'], keep='last')[span_642](start_span)[span_642](end_span)
    skipped_within_batch = total_incoming - len(cleaned_df)[span_643](start_span)[span_643](end_span)

    if cleaned_df.empty:[span_644](start_span)[span_644](end_span)
        return 0, 0[span_645](start_span)[span_645](end_span)

    engine = conn.engine[span_646](start_span)[span_646](end_span)
    try:
        with engine.begin() as bulk_conn:[span_647](start_span)[span_647](end_span)
            existing_hashes = set()[span_648](start_span)[span_648](end_span)
            try:
                existing_hashes = set(
                    h for (h,) in bulk_conn.execute(
                        text('SELECT DISTINCT "Record_Hash" FROM teacher_records WHERE "Record_Hash" IS NOT NULL')
                    ).fetchall()
                )[span_649](start_span)[span_649](end_span)
            except Exception:
                pass[span_650](start_span)[span_650](end_span)

            insert_df = cleaned_df[~cleaned_df['Record_Hash'].isin(existing_hashes)] if existing_hashes else cleaned_df[span_651](start_span)[span_651](end_span)
            skipped_exact_duplicates = (total_incoming - len(insert_df))[span_652](start_span)[span_652](end_span)

            before_count = bulk_conn.execute(text('SELECT COUNT(*) FROM teacher_records')).scalar() or 0[span_653](start_span)[span_653](end_span)
            if not insert_df.empty:[span_654](start_span)[span_654](end_span)
                insert_df.to_sql('teacher_records', con=bulk_conn, index=False, if_exists='append', method='multi', chunksize=1000)[span_655](start_span)[span_655](end_span)
            after_count = bulk_conn.execute(text('SELECT COUNT(*) FROM teacher_records')).scalar() or 0[span_656](start_span)[span_656](end_span)

        inserted_count = int(after_count - before_count)[span_657](start_span)[span_657](end_span)
        return inserted_count, skipped_exact_duplicates[span_658](start_span)[span_658](end_span)
    except Exception as e:
        st.error(f"Ingestion database error: {e}")[span_659](start_span)[span_659](end_span)
        return 0, 0[span_660](start_span)[span_660](end_span)


# Page layout title
st.title("🏫 Academic Manager Portfolio & Teacher Performance Indicator Review Dashboard")[span_661](start_span)[span_661](end_span)
st.markdown("Track **School Portfolio Management**, **School WoW Velocity**, **Teacher Execution Tiers**, **Quantitative Performance Indicators (Lesson Prep / Book Content Usage)**, and **360° Qualitative Evidences & Artifact Compliance**.")[span_662](start_span)[span_662](end_span)


# --- 2. MULTI-EMPLOYEE HIERARCHY & DATA UPLOAD MANAGER ---
st.sidebar.header("📁 Multi-Employee Data Ingestion Portal")[span_663](start_span)[span_663](end_span)

employee_name = st.sidebar.text_input("Enter Consultant Name:", value="Harshit Bhargava")[span_664](start_span)[span_664](end_span)
employee_state = st.sidebar.selectbox("Select State / Zone (India Region):", [
    "Madhya Pradesh (MP)", "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat", 
    "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", 
    "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab", 
    "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", 
    "Uttarakhand", "West Bengal", "Delhi NCR", "Jammu and Kashmir", "Ladakh"
])[span_665](start_span)[span_665](end_span)

uploaded_files = st.sidebar.file_uploader(
    "Upload UserMetrics Excel (.xlsx)", 
    type=["xlsx"], 
    accept_multiple_files=True
)[span_666](start_span)[span_666](end_span)

if uploaded_files:[span_667](start_span)[span_667](end_span)
    if st.sidebar.button("🚀 Process & Ingest Files Now", type="primary"):[span_668](start_span)[span_668](end_span)
        new_processed_dfs = [][span_669](start_span)[span_669](end_span)
        for file in uploaded_files:[span_670](start_span)[span_670](end_span)
            try:
                temp_dict = pd.read_excel(file, sheet_name=None)[span_671](start_span)[span_671](end_span)
                target_sheet = next(
                    (s for s in temp_dict.keys() if "usermetric" in s.lower()), 
                    list(temp_dict.keys())[0]
                )[span_672](start_span)[span_672](end_span)
                temp_df = temp_dict[target_sheet][span_673](start_span)[span_673](end_span)

                temp_df = normalize_identity_columns(temp_df)[span_674](start_span)[span_674](end_span)
                temp_df['Uploaded_By'] = employee_name[span_675](start_span)[span_675](end_span)
                temp_df['State_Zone'] = employee_state[span_676](start_span)[span_676](end_span)

                if temp_df['Institution'].eq('').all():[span_677](start_span)[span_677](end_span)
                    temp_df['Institution'] = "Default School[span_678](start_span)"[span_678](end_span)
                else:
                    temp_df['Institution'] = temp_df['Institution'].replace('', 'Unknown School')[span_679](start_span)[span_679](end_span)

                for col in ['Grade', 'Subject', 'Book']:[span_680](start_span)[span_680](end_span)
                    if col not in temp_df.columns:[span_681](start_span)[span_681](end_span)
                        temp_df[col] = '[span_682](start_span)'[span_682](end_span)
                    else:
                        temp_df[col] = temp_df[col].fillna('').astype(str).str.replace(r'\s+', ' ', regex=True).str.strip()[span_683](start_span)[span_683](end_span)

                def parse_duration_minutes(value):
                    if value is None or (isinstance(value, float) and np.isnan(value)) or pd.isna(value):
                        return 0.0
                    if isinstance(value, pd.Timedelta):
                        return value.total_seconds() / 60.0
                    if isinstance(value, np.timedelta64):
                        try:
                            return pd.to_timedelta(value).total_seconds() / 60.0
                        except Exception:
                            return 0.0
                    if isinstance(value, (int, float, np.integer, np.floating)):
                        return float(value) * 1440.0 if 0 <= float(value) < 1 else float(value)
                    text_value = str(value).strip()
                    if not text_value:
                        return 0.0
                    try:
                        td = pd.to_timedelta(text_value, errors='raise')
                        return td.total_seconds() / 60.0
                    except Exception:
                        try:
                            return float(text_value)
                        except Exception:
                            return 0.0[span_684](start_span)[span_684](end_span)

                if 'Duration (HH:MM:SS)' in temp_df.columns:[span_685](start_span)[span_685](end_span)
                    temp_df['Duration_Min'] = temp_df['Duration (HH:MM:SS)'].apply(parse_duration_minutes)[span_686](start_span)[span_686](end_span)
                elif 'Duration (Minutes)' in temp_df.columns:[span_687](start_span)[span_687](end_span)
                    temp_df['Duration_Min'] = pd.to_numeric(temp_df['Duration (Minutes)'], errors='coerce').fillna(0.0)[span_688](start_span)[span_688](end_span)
                else:
                    temp_df['Duration_Min'] = 0.0[span_689](start_span)[span_689](end_span)

                if 'Type' in temp_df.columns:[span_690](start_span)[span_690](end_span)
                    temp_df['Type'] = temp_df['Type'].fillna('lessonDelivery').astype(str)[span_691](start_span)[span_691](end_span)
                else:
                    temp_df['Type'] = 'lessonDelivery[span_692](start_span)'[span_692](end_span)

                for dt_col in ['StartTime', 'EndTime']:[span_693](start_span)[span_693](end_span)
                    if dt_col in temp_df.columns:[span_694](start_span)[span_694](end_span)
                        temp_df[dt_col] = pd.to_datetime(temp_df[dt_col], errors='coerce')[span_695](start_span)[span_695](end_span)

                for qual_col in ['Voice_Note_Link', 'Lesson_Plan_Picture', 'Video_Evidence_1', 'Video_Evidence_2', 'Video_Evidence_3', 'Writing_Sample_Link', 'Phonics_Evidence_Link', 'Portfolio_Evidence_Link', 'Assessment_Score_Pct']:[span_696](start_span)[span_696](end_span)
                    if qual_col not in temp_df.columns:[span_697](start_span)[span_697](end_span)
                        temp_df[qual_col] = None[span_698](start_span)[span_698](end_span)

                new_processed_dfs.append(temp_df)[span_699](start_span)[span_699](end_span)
            except Exception as e:
                st.sidebar.error(f"Error reading {file.name}: {e}")[span_700](start_span)[span_700](end_span)

        if new_processed_dfs:[span_701](start_span)[span_701](end_span)
            inserted_count, duplicate_count = ingest_excel_to_postgresql(new_processed_dfs)[span_702](start_span)[span_702](end_span)
            fetch_master_db_from_supabase.clear()[span_703](start_span)[span_703](end_span)
            build_teacher_roster_cached.clear()[span_704](start_span)[span_704](end_span)
            st.sidebar.success(f"🎉 Database sync complete: {inserted_count} record(s) inserted successfully!")[span_705](start_span)[span_705](end_span)
            st.rerun()[span_706](start_span)[span_706](end_span)

df = fetch_master_db_from_supabase()[span_707](start_span)[span_707](end_span)

# --- 3. GRANULAR CLOUD DATABASE MANAGEMENT ---
st.sidebar.markdown("---")[span_708](start_span)[span_708](end_span)
st.sidebar.header("🗄️ Granular Database Management")[span_709](start_span)[span_709](end_span)

if st.sidebar.button("🔄 Sync Latest Records"):[span_710](start_span)[span_710](end_span)
    fetch_master_db_from_supabase.clear()[span_711](start_span)[span_711](end_span)
    build_teacher_roster_cached.clear()[span_712](start_span)[span_712](end_span)
    st.rerun()[span_713](start_span)[span_713](end_span)

with st.sidebar.expander("📦 One-Time Data Import (Old App Data)"):[span_714](start_span)[span_714](end_span)
    st.caption("Imports all historical records from legacy `master_database.parquet` and the `submissions/` JSON folder into PostgreSQL.")[span_715](start_span)[span_715](end_span)
    if st.button("🚀 Run One-Time Import", key="btn_run_historical_import"):[span_716](start_span)[span_716](end_span)
        with st.spinner("Downloading and migrating historical data to PostgreSQL..."):[span_717](start_span)[span_717](end_span)
            base_df = pd.DataFrame()[span_718](start_span)[span_718](end_span)
            try:
                res = supabase.storage.from_(BUCKET_NAME).download("master_database.parquet")[span_719](start_span)[span_719](end_span)
                if res:[span_720](start_span)[span_720](end_span)
                    base_df = pd.read_parquet(BytesIO(res))[span_721](start_span)[span_721](end_span)
                    st.sidebar.info(f"Loaded {len(base_df)} rows from master_database.parquet")[span_722](start_span)[span_722](end_span)
            except Exception as e:
                st.sidebar.warning(f"Parquet check notice: {e}")[span_723](start_span)[span_723](end_span)

            sub_records = [][span_724](start_span)[span_724](end_span)
            try:
                file_list = supabase.storage.from_(BUCKET_NAME).list("submissions", {"limit": 10000})[span_725](start_span)[span_725](end_span)
                if file_list:[span_726](start_span)[span_726](end_span)
                    for item in file_list:[span_727](start_span)[span_727](end_span)
                        fname = item.get('name', '')[span_728](start_span)[span_728](end_span)
                        if fname.endswith('.json'):[span_729](start_span)[span_729](end_span)
                            raw = supabase.storage.from_(BUCKET_NAME).download(f"submissions/{fname}")[span_730](start_span)[span_730](end_span)
                            if raw:[span_731](start_span)[span_731](end_span)
                                sub_records.append(json.loads(raw.decode('utf-8')))[span_732](start_span)[span_732](end_span)
                    if sub_records:[span_733](start_span)[span_733](end_span)
                        st.sidebar.info(f"Loaded {len(sub_records)} submissions from submissions/ folder")[span_734](start_span)[span_734](end_span)
            except Exception as e:
                st.sidebar.warning(f"Submissions check notice: {e}")[span_735](start_span)[span_735](end_span)

            subs_df = pd.DataFrame(sub_records) if sub_records else pd.DataFrame()[span_736](start_span)[span_736](end_span)
            combined_legacy = pd.concat([base_df, subs_df], ignore_index=True) if not base_df.empty else subs_df[span_737](start_span)[span_737](end_span)

            if not combined_legacy.empty:[span_738](start_span)[span_738](end_span)
                combined_legacy = normalize_identity_columns(combined_legacy)[span_739](start_span)[span_739](end_span)
                inserted_count, duplicate_count = ingest_excel_to_postgresql([combined_legacy])[span_740](start_span)[span_740](end_span)
                st.sidebar.success(f"🎉 Historical import complete: {inserted_count} new record(s) inserted!")[span_741](start_span)[span_741](end_span)
                fetch_master_db_from_supabase.clear()[span_742](start_span)[span_742](end_span)
                build_teacher_roster_cached.clear()[span_743](start_span)[span_743](end_span)
                st.rerun()[span_744](start_span)[span_744](end_span)
            else:
                st.sidebar.error("No historical parquet or JSON files found in Supabase storage.")[span_745](start_span)[span_745](end_span)

if not df.empty:[span_746](start_span)[span_746](end_span)
    st.sidebar.metric("Database Total Records", len(df))[span_747](start_span)[span_747](end_span)

    if st.sidebar.button("🧹 Remove Exact Duplicate Records"):[span_748](start_span)[span_748](end_span)
        with st.spinner("Backfilling content hashes and collapsing exact duplicates..."):[span_749](start_span)[span_749](end_span)
            backfilled = backfill_teacher_records_hash()[span_750](start_span)[span_750](end_span)
            removed = 0[span_751](start_span)[span_751](end_span)
            try:
                with conn.engine.begin() as c:[span_752](start_span)[span_752](end_span)
                    before = c.execute(text('SELECT COUNT(*) FROM teacher_records')).scalar() or 0[span_753](start_span)[span_753](end_span)
                    c.execute(text('''
                        DELETE FROM teacher_records a
                        USING teacher_records b
                        WHERE a.ctid < b.ctid
                          AND a."Record_Hash" = b."Record_Hash"
                          AND a."Record_Hash" IS NOT NULL
                    '''))[span_754](start_span)[span_754](end_span)
                    after = c.execute(text('SELECT COUNT(*) FROM teacher_records')).scalar() or 0[span_755](start_span)[span_755](end_span)
                    removed = before - after[span_756](start_span)[span_756](end_span)
            except Exception as e:
                st.sidebar.error(f"Dedup cleanup error: {e}")[span_757](start_span)[span_757](end_span)

            fetch_master_db_from_supabase.clear()[span_758](start_span)[span_758](end_span)
            build_teacher_roster_cached.clear()[span_759](start_span)[span_759](end_span)
            st.sidebar.success(f"✅ Backfilled {backfilled} legacy row(s), removed {removed} duplicate row(s).")[span_760](start_span)[span_760](end_span)
            st.rerun()[span_761](start_span)[span_761](end_span)

    with st.sidebar.expander("🛠️ Selective Database Cleanup"):[span_762](start_span)[span_762](end_span)
        clean_mode = st.radio("Select Cleanup Scope:", ["By Consultant Name & State/Zone", "By School", "Clear Entire DB"])[span_763](start_span)[span_763](end_span)
        
        if clean_mode == "By Consultant Name & State/Zone":[span_764](start_span)[span_764](end_span)
            del_emp_name = st.text_input("Enter Exact Consultant Name to Delete:", value="")[span_765](start_span)[span_765](end_span)
            del_state_zone = st.selectbox("Select State/Zone for Cleanup:", [
                "Madhya Pradesh (MP)", "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat", 
                "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", 
                "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab", 
                "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", 
                "Uttarakhand", "West Bengal", "Delhi NCR", "Jammu and Kashmir", "Ladakh"
            ], key="del_state_select")[span_766](start_span)[span_766](end_span)
            
            if st.button("🗑️ Delete Consultant Records from SQL DB"):[span_767](start_span)[span_767](end_span)
                try:
                    if not del_emp_name.strip():[span_768](start_span)[span_768](end_span)
                        st.error("Please enter the consultant name.")[span_769](start_span)[span_769](end_span)
                    else:
                        with conn.session as s:[span_770](start_span)[span_770](end_span)
                            s.execute(
                                text('DELETE FROM teacher_records WHERE LOWER("Uploaded_By") = LOWER(:name) AND "State_Zone" = :state'),
                                {"name": del_emp_name.strip(), "state": del_state_zone}
                            )[span_771](start_span)[span_771](end_span)
                            s.commit()[span_772](start_span)[span_772](end_span)
                        fetch_master_db_from_supabase.clear()[span_773](start_span)[span_773](end_span)
                        build_teacher_roster_cached.clear()[span_774](start_span)[span_774](end_span)
                        st.success(f"Successfully deleted records for {del_emp_name} in {del_state_zone}!")[span_775](start_span)[span_775](end_span)
                        st.rerun()[span_776](start_span)[span_776](end_span)
                except Exception as e:
                    st.error(f"Error deleting consultant data: {e}")[span_777](start_span)[span_777](end_span)
                    
        elif clean_mode == "By School":[span_778](start_span)[span_778](end_span)
            schools_in_db = sorted(df['Institution'].dropna().unique().tolist()) if 'Institution' in df.columns else [][span_779](start_span)[span_779](end_span)
            target_del_school = st.selectbox("Select School to Delete:", options=schools_in_db)[span_780](start_span)[span_780](end_span)
            if st.button("🗑️ Delete School Data from SQL DB"):[span_781](start_span)[span_781](end_span)
                try:
                    with conn.session as s:[span_782](start_span)[span_782](end_span)
                        s.execute(text('DELETE FROM teacher_records WHERE "Institution" = :school'), {"school": target_del_school})[span_783](start_span)[span_783](end_span)
                        s.commit()[span_784](start_span)[span_784](end_span)
                    fetch_master_db_from_supabase.clear()[span_785](start_span)[span_785](end_span)
                    build_teacher_roster_cached.clear()[span_786](start_span)[span_786](end_span)
                    st.success(f"Successfully removed data for {target_del_school} from database!")[span_787](start_span)[span_787](end_span)
                    st.rerun()[span_788](start_span)[span_788](end_span)
                except Exception as e:
                    st.error(f"Error deleting school data: {e}")[span_789](start_span)[span_789](end_span)
                    
        else:
            if st.button("🚨 Clear Entire Database Table", key="clear_entire_teacher_db"):[span_790](start_span)[span_790](end_span)
                try:
                    with conn.session as s:[span_791](start_span)[span_791](end_span)
                        delete_result = s.execute(text("DELETE FROM teacher_records;"))[span_792](start_span)[span_792](end_span)
                        deleted_count = delete_result.rowcount[span_793](start_span)[span_793](end_span)
                        s.commit()[span_794](start_span)[span_794](end_span)

                    fetch_master_db_from_supabase.clear()[span_795](start_span)[span_795](end_span)
                    build_teacher_roster_cached.clear()[span_796](start_span)[span_796](end_span)
                    st.session_state.pop("master_df", None)[span_797](start_span)[span_797](end_span)
                    st.session_state.pop("df", None)[span_798](start_span)[span_798](end_span)
                    st.session_state.pop("filtered_df", None)[span_799](start_span)[span_799](end_span)
                    st.session_state.pop("school_filtered_df", None)[span_800](start_span)[span_800](end_span)

                    st.sidebar.success(
                        f"✅ Database cleared successfully: {deleted_count if deleted_count >= 0 else 'all'} record(s) deleted."
                    )[span_801](start_span)[span_801](end_span)
                    st.rerun()[span_802](start_span)[span_802](end_span)
                except Exception as e:
                    fetch_master_db_from_supabase.clear()[span_803](start_span)[span_803](end_span)
                    build_teacher_roster_cached.clear()[span_804](start_span)[span_804](end_span)
                    st.sidebar.error(f"❌ Could not clear teacher_records: {type(e).__name__}: {e}")[span_805](start_span)[span_805](end_span)

if df.empty:[span_806](start_span)[span_806](end_span)
    st.info("👋 Upload your `UserMetrics.xlsx` file in the sidebar and click **'🚀 Process & Ingest Files Now'** to populate your dashboard.")[span_807](start_span)[span_807](end_span)
else:
    df['StartTime'] = pd.to_datetime(df['StartTime'], errors='coerce').fillna(pd.Timestamp.now())[span_808](start_span)[span_808](end_span)
    df['Date'] = df['StartTime'].dt.date[span_809](start_span)[span_809](end_span)
    df['Month_Name'] = df['StartTime'].dt.strftime('%B %Y')[span_810](start_span)[span_810](end_span)
    df['Month_Sort'] = df['StartTime'].dt.strftime('%Y-%m')[span_811](start_span)[span_811](end_span)
    
    def get_week_of_month(dt):
        try:
            first_day = dt.replace(day=1)
            dom = dt.day
            adjusted_dom = dom + first_day.weekday()
            return int(np.ceil(adjusted_dom / 7.0))
        except:
            return 1[span_812](start_span)[span_812](end_span)

    df['Week_Num'] = df['StartTime'].apply(get_week_of_month)[span_813](start_span)[span_813](end_span)
    
    week_ranges = df.groupby(['Month_Name', 'Week_Num'])['Date'].agg(['min', 'max']).reset_index()[span_814](start_span)[span_814](end_span)
    week_ranges['Week_Date_Range'] = (
        week_ranges['min'].apply(lambda x: x.strftime('%b %d') if pd.notna(x) else '') + " to " + 
        week_ranges['max'].apply(lambda x: x.strftime('%b %d') if pd.notna(x) else '')
    )[span_815](start_span)[span_815](end_span)
    
    df = df.merge(week_ranges[['Month_Name', 'Week_Num', 'Week_Date_Range']], on=['Month_Name', 'Week_Num'], how='left')[span_816](start_span)[span_816](end_span)
    df['Month_Week_Label'] = df['StartTime'].dt.strftime('%b %Y') + " - Week " + df['Week_Num'].astype(str) + " (" + df['Week_Date_Range'] + ")[span_817](start_span)"[span_817](end_span)
    df['Week'] = df['Month_Week_Label'][span_818](start_span)[span_818](end_span)

    master_teacher_roster = build_teacher_roster_cached(df)[span_819](start_span)[span_819](end_span)
    if master_teacher_roster.empty:[span_820](start_span)[span_820](end_span)
        master_teacher_roster = df[['Institution', 'FullName', 'Uploaded_By', 'State_Zone']].drop_duplicates()[span_821](start_span)[span_821](end_span)
    else:
        master_teacher_roster = master_teacher_roster[['Institution', 'FullName', 'Uploaded_By', 'State_Zone']].drop_duplicates()[span_822](start_span)[span_822](end_span)

    # --- HIERARCHICAL GLOBAL FILTERS ---
    st.sidebar.markdown("---")[span_823](start_span)[span_823](end_span)
    st.sidebar.header("🔍 Hierarchical Global Filters")[span_824](start_span)[span_824](end_span)
    
    all_states = sorted([str(s) for s in df['State_Zone'].unique() if str(s).strip() and str(s).lower() not in ['nan', 'none']])[span_825](start_span)[span_825](end_span)
    default_states = ["Madhya Pradesh (MP)"] if "Madhya Pradesh (MP)" in all_states else all_states[span_826](start_span)[span_826](end_span)
    
    if all_states:[span_827](start_span)[span_827](end_span)
        selected_states = st.sidebar.multiselect("1. Select State(s) / Zone(s)", options=all_states, default=default_states)[span_828](start_span)[span_828](end_span)
        df_state = df[df['State_Zone'].isin(selected_states)] if selected_states else df[span_829](start_span)[span_829](end_span)
    else:
        df_state = df[span_830](start_span)[span_830](end_span)

    all_employees = sorted([str(e) for e in df_state['Uploaded_By'].unique() if str(e).strip() and str(e).lower() not in ['nan', 'none']])[span_831](start_span)[span_831](end_span)
    if all_employees:[span_832](start_span)[span_832](end_span)
        selected_employees = st.sidebar.multiselect("2. Select Consultant(s)", options=all_employees, default=all_employees)[span_833](start_span)[span_833](end_span)
        df_emp = df_state[df_state['Uploaded_By'].isin(selected_employees)] if selected_employees else df_state[span_834](start_span)[span_834](end_span)
    else:
        df_emp = df_state[span_835](start_span)[span_835](end_span)

    all_schools = sorted([str(s) for s in df_emp['Institution'].unique() if str(s).strip() and str(s).lower() not in ['nan', 'none']])[span_836](start_span)[span_836](end_span)
    selected_schools = st.sidebar.multiselect("3. Select School(s)", options=all_schools, default=all_schools)[span_837](start_span)[span_837](end_span)

    school_master_roster = master_teacher_roster[master_teacher_roster['Institution'].isin(selected_schools)] if selected_schools else master_teacher_roster[span_838](start_span)[span_838](end_span)
    school_filtered_df = df_emp[df_emp['Institution'].isin(selected_schools)] if selected_schools else df_emp[span_839](start_span)[span_839](end_span)

    # --- CALENDAR & HOLIDAY MANAGER ---
    st.sidebar.markdown("---")[span_840](start_span)[span_840](end_span)
    st.sidebar.header("📅 Calendar & Holiday Manager")[span_841](start_span)[span_841](end_span)
    
    available_months_df = school_filtered_df[['Month_Sort', 'Month_Name']].dropna().drop_duplicates().sort_values(by='Month_Sort', ascending=False)[span_842](start_span)[span_842](end_span)
    month_options = available_months_df['Month_Name'].tolist()[span_843](start_span)[span_843](end_span)
    
    selected_month = st.sidebar.selectbox("Select Review Month:", options=month_options if month_options else ["All Months"])[span_844](start_span)[span_844](end_span)
    month_filtered_df = school_filtered_df[school_filtered_df['Month_Name'] == selected_month] if selected_month != "All Months" else school_filtered_df[span_845](start_span)[span_845](end_span)
    
    exclude_sundays_flag = st.sidebar.checkbox("🗓️ Exclude Sundays from Performance Indicators", value=True)[span_846](start_span)[span_846](end_span)
    use_teacher_eligible_days = st.sidebar.checkbox(
        "👤 Use teacher-specific eligible working days", value=False,
        help="Default OFF uses actual calendar working days. ON uses working days between each teacher's first and last recorded activity in the selected period."
    )[span_847](start_span)[span_847](end_span)

    user_excluded_dates = [][span_848](start_span)[span_848](end_span)
    try:
        selected_month_start = pd.to_datetime(selected_month, format="%B %Y").date()[span_849](start_span)[span_849](end_span)
        selected_month_end = (pd.Timestamp(selected_month_start) + pd.offsets.MonthEnd(1)).date()[span_850](start_span)[span_850](end_span)
    except Exception:
        selected_month_start = month_filtered_df['Date'].min() if not month_filtered_df.empty else None[span_851](start_span)[span_851](end_span)
        selected_month_end = month_filtered_df['Date'].max() if not month_filtered_df.empty else None[span_852](start_span)[span_852](end_span)

    if selected_month_start is not None and selected_month_end is not None:[span_853](start_span)[span_853](end_span)
        all_month_possible_dates = [d.date() for d in pd.date_range(selected_month_start, selected_month_end)][span_854](start_span)[span_854](end_span)
        user_excluded_dates = st.sidebar.multiselect(
            f"🗓️ Punch Holidays for {selected_month}:", options=all_month_possible_dates,
            format_func=lambda x: x.strftime('%Y-%m-%d')
        )[span_855](start_span)[span_855](end_span)

    # --- GRANULARITY & CUSTOM DATE RANGE SELECTOR ---
    st.sidebar.subheader("🔍 Review View Level")[span_856](start_span)[span_856](end_span)
    available_month_weeks = sorted(month_filtered_df['Month_Week_Label'].dropna().unique())[span_857](start_span)[span_857](end_span)
    available_dates = sorted(month_filtered_df['Date'].dropna().unique(), reverse=True)[span_858](start_span)[span_858](end_span)
    
    view_mode = st.sidebar.radio("Granularity:", ["Full Month Summary", "Specific Week of Month", "Single Day Review", "Custom Date Range"])[span_859](start_span)[span_859](end_span)
    
    if month_filtered_df.empty and view_mode != "Custom Date Range":[span_860](start_span)[span_860](end_span)
        filtered_df = month_filtered_df[span_861](start_span)[span_861](end_span)
        selected_num_days = 0[span_862](start_span)[span_862](end_span)
        filter_description_text = f"Full Month: {selected_month} - 0 Records / 0 Working Days[span_863](start_span)"[span_863](end_span)
    elif view_mode == "Full Month Summary":[span_864](start_span)[span_864](end_span)
        filtered_df = month_filtered_df[span_865](start_span)[span_865](end_span)
        selected_num_days = get_working_days(selected_month_start, selected_month_end, user_excluded_dates, exclude_sundays=exclude_sundays_flag)[span_866](start_span)[span_866](end_span)
        filter_description_text = f"Full Month: {selected_month} - {selected_num_days} Working Days ({selected_month_start} to {selected_month_end})[span_867](start_span)"[span_867](end_span)
    elif view_mode == "Specific Week of Month":[span_868](start_span)[span_868](end_span)
        selected_week_label = st.sidebar.selectbox("Select Week:", options=available_month_weeks)[span_869](start_span)[span_869](end_span)
        filtered_df = month_filtered_df[month_filtered_df['Month_Week_Label'] == selected_week_label][span_870](start_span)[span_870](end_span)
        w_start = filtered_df['Date'].min() if not filtered_df.empty else selected_month[span_871](start_span)[span_871](end_span)
        w_end = filtered_df['Date'].max() if not filtered_df.empty else selected_month[span_872](start_span)[span_872](end_span)
        selected_num_days = get_working_days(w_start, w_end, user_excluded_dates, exclude_sundays=exclude_sundays_flag)[span_873](start_span)[span_873](end_span)
        filter_description_text = f"{selected_week_label} - {selected_num_days} Working Days[span_874](start_span)"[span_874](end_span)
    elif view_mode == "Single Day Review":[span_875](start_span)[span_875](end_span)
        selected_date = st.sidebar.selectbox("Select Day:", options=available_dates)[span_876](start_span)[span_876](end_span)
        filtered_df = month_filtered_df[month_filtered_df['Date'] == selected_date][span_877](start_span)[span_877](end_span)
        selected_num_days = get_working_days(selected_date, selected_date, user_excluded_dates, exclude_sundays=exclude_sundays_flag)[span_878](start_span)[span_878](end_span)
        filter_description_text = f"Single Date: {selected_date} - {selected_num_days} Working Days[span_879](start_span)"[span_879](end_span)
    else:
        min_avail = school_filtered_df['Date'].dropna().min() if not school_filtered_df['Date'].dropna().empty else pd.Timestamp.now().date()[span_880](start_span)[span_880](end_span)
        max_avail = school_filtered_df['Date'].dropna().max() if not school_filtered_df['Date'].dropna().empty else pd.Timestamp.now().date()[span_881](start_span)[span_881](end_span)
        
        custom_date_range = st.sidebar.date_input("Select Custom Date Range:", value=(min_avail, max_avail), min_value=min_avail, max_value=max_avail)[span_882](start_span)[span_882](end_span)
        if isinstance(custom_date_range, (tuple, list)) and len(custom_date_range) == 2:[span_883](start_span)[span_883](end_span)
            c_start, c_end = custom_date_range[span_884](start_span)[span_884](end_span)
        elif isinstance(custom_date_range, (tuple, list)) and len(custom_date_range) == 1:[span_885](start_span)[span_885](end_span)
            c_start = c_end = custom_date_range[0][span_886](start_span)[span_886](end_span)
        else:
            c_start = c_end = custom_date_range[span_887](start_span)[span_887](end_span)
            
        filtered_df = school_filtered_df[(school_filtered_df['Date'] >= c_start) & (school_filtered_df['Date'] <= c_end)][span_888](start_span)[span_888](end_span)
        selected_num_days = get_working_days(c_start, c_end, user_excluded_dates, exclude_sundays=exclude_sundays_flag)[span_889](start_span)[span_889](end_span)
        filter_description_text = f"Custom Range: {c_start} to {c_end} - {selected_num_days} Working Days[span_890](start_span)"[span_890](end_span)

    # 4. Global Teacher Filter
    available_teachers = sorted([str(t) for t in school_master_roster['FullName'].unique() if str(t).strip()])[span_891](start_span)[span_891](end_span)
    selected_teachers = st.sidebar.multiselect("4. Select Teacher(s)", options=available_teachers, default=available_teachers)[span_892](start_span)[span_892](end_span)
    
    filtered_roster = school_master_roster[school_master_roster['FullName'].isin(selected_teachers)] if selected_teachers else school_master_roster[span_893](start_span)[span_893](end_span)
    filtered_df = filtered_df[filtered_df['FullName'].isin(selected_teachers)] if selected_teachers else filtered_df[span_894](start_span)[span_894](end_span)

    period_start, period_end = get_period_bounds_for_view(
        selected_month, view_mode, month_filtered_df,
        c_start if view_mode == "Custom Date Range" else None,
        c_end if view_mode == "Custom Date Range" else None
    )[span_895](start_span)[span_895](end_span)
    teacher_days = teacher_days_map(
        filtered_roster, filtered_df, period_start, period_end,
        user_excluded_dates, exclude_sundays_flag
    ) if use_teacher_eligible_days else {}[span_896](start_span)[span_896](end_span)

    # Global Content / Book dataset derivation
    content_raw = filtered_df[filtered_df['Book'].str.len() > 0][span_897](start_span)[span_897](end_span)
    global_content_df = content_raw[~content_raw['Book'].str.match(r'^Lesson Plan', case=False, na=False)][span_898](start_span)[span_898](end_span)

    # --- SIDEBAR DIRECT EXCEL EXPORT ---
    st.sidebar.markdown("---")[span_899](start_span)[span_899](end_span)
    st.sidebar.subheader("📥 Direct Admin Master Export")[span_900](start_span)[span_900](end_span)
    if st.sidebar.button("📦 Prepare Master DB Export"):[span_901](start_span)[span_901](end_span)
        buf_master_xlsx = BytesIO()[span_902](start_span)[span_902](end_span)
        with pd.ExcelWriter(buf_master_xlsx, engine='openpyxl') as writer:[span_903](start_span)[span_903](end_span)
            filtered_df.to_excel(writer, index=False, sheet_name="Filtered_Database_Logs")[span_904](start_span)[span_904](end_span)
        st.session_state["master_db_export_ready"] = buf_master_xlsx.getvalue()[span_905](start_span)[span_905](end_span)

    if "master_db_export_ready" in st.session_state:[span_906](start_span)[span_906](end_span)
        st.sidebar.download_button(
            label="📥 Download Prepared Master DB (Excel)",
            data=st.session_state["master_db_export_ready"],
            file_name=f"Master_Database_Export_{pd.Timestamp.now().strftime('%Y%m%d_%H%M%S')}.xlsx",
            mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )[span_907](start_span)[span_907](end_span)

    # 8 Dedicated Active Tabs
    tab1, tab2, tab3, tab4, tab5, tab6, tab7, tab8 = st.tabs([
        "📘 1. Lesson Plan Preparation Tracker", 
        "📚 2. Library Usage Tracker", 
        "📖 3. Content & Chapters (Primary KPI)", 
        "👤 4. Teacher 360° Profile Report",
        "🏛️ 5. Manager Portfolio Quadrants",
        "🏫 6. School Teacher Progression",
        "📬 7. Live Evidence Submissions Feed",
        "📋 8. Classroom Visit Observation Form"
    ])[span_908](start_span)[span_908](end_span)

    # TAB 1: LESSON PLAN PREPARATION TRACKER
    with tab1:[span_909](start_span)[span_909](end_span)
        st.header("📘 Lesson Plan Preparation Tracker")[span_910](start_span)[span_910](end_span)
        
        with st.expander("🎯 Lesson Prep Target Benchmark Settings", expanded=False):[span_911](start_span)[span_911](end_span)
            t1_kcol1, t1_kcol2 = st.columns(2)[span_912](start_span)[span_912](end_span)
            with t1_kcol1:[span_913](start_span)[span_913](end_span)
                enable_quant_kpi_t1 = st.checkbox("Enable Lesson Prep Quantitative Benchmark", value=True, key="t1_enable_quant_kpi")[span_914](start_span)[span_914](end_span)
            with t1_kcol2:[span_915](start_span)[span_915](end_span)
                daily_ld_target_t1 = st.number_input("Lesson Prep Target (Mins/Day)", min_value=0.0, max_value=60.0, value=10.0, step=5.0, key="t1_ld_target", disabled=not enable_quant_kpi_t1) if enable_quant_kpi_t1 else 0.0[span_916](start_span)[span_916](end_span)

        calc_ld_kpi_t1 = calculate_kpi_target(daily_ld_target_t1, selected_num_days, enable_quant_kpi_t1)[span_917](start_span)[span_917](end_span)
        st.session_state['calc_ld_kpi_t1'] = calc_ld_kpi_t1[span_918](start_span)[span_918](end_span)
        st.session_state['daily_ld_target_t1'] = daily_ld_target_t1[span_919](start_span)[span_919](end_span)

        tab1_col_f1, tab1_col_f2 = st.columns(2)[span_920](start_span)[span_920](end_span)
        with tab1_col_f1:[span_921](start_span)[span_921](end_span)
            tab1_schools = ["All Selected Schools"] + sorted([s for s in filtered_df['Institution'].unique() if str(s).strip()])[span_922](start_span)[span_922](end_span)
            tab1_selected_school = st.selectbox("Filter Tab by School:", tab1_schools, key="tab1_school_filter")[span_923](start_span)[span_923](end_span)
        
        tab1_active_df = filtered_df if tab1_selected_school == "All Selected Schools" else filtered_df[filtered_df['Institution'] == tab1_selected_school][span_924](start_span)[span_924](end_span)
        tab1_active_roster = filtered_roster if tab1_selected_school == "All Selected Schools" else filtered_roster[filtered_roster['Institution'] == tab1_selected_school][span_925](start_span)[span_925](end_span)

        with tab1_col_f2:[span_926](start_span)[span_926](end_span)
            tab1_teachers = ["All Teachers"] + sorted([t for t in tab1_active_roster['FullName'].unique() if str(t).strip()])[span_927](start_span)[span_927](end_span)
            tab1_selected_teacher = st.selectbox("Filter Tab by Teacher:", tab1_teachers, key="tab1_teacher_filter")[span_928](start_span)[span_928](end_span)
            
        if tab1_selected_teacher != "All Teachers":[span_929](start_span)[span_929](end_span)
            tab1_active_df = tab1_active_df[tab1_active_df['FullName'] == tab1_selected_teacher][span_930](start_span)[span_930](end_span)
            tab1_active_roster = tab1_active_roster[tab1_active_roster['FullName'] == tab1_selected_teacher][span_931](start_span)[span_931](end_span)

        if enable_quant_kpi_t1 and calc_ld_kpi_t1 > 0:[span_932](start_span)[span_932](end_span)
            st.caption(f"Benchmark Standard: **At least {calc_ld_kpi_t1:.0f} Minutes** ({daily_ld_target_t1:.0f} mins/day across {selected_num_days} working day(s)).")[span_933](start_span)[span_933](end_span)
        else:
            st.caption(f"Reviewing cumulative minutes prepared across {selected_num_days} working day(s).")[span_934](start_span)[span_934](end_span)

        ld_df = tab1_active_df[tab1_active_df['Type'] == 'lessonDelivery'][span_935](start_span)[span_935](end_span)
        ld_usage = ld_df.groupby(['Institution', 'FullName'])['Duration_Min'].sum().reset_index()[span_936](start_span)[span_936](end_span)
        ld_daily = tab1_active_roster.merge(ld_usage, on=['Institution', 'FullName'], how='left').fillna(0.0)[span_937](start_span)[span_937](end_span)
        ld_daily['Eligible Working Days'] = ld_daily.apply(lambda r: teacher_days.get((r['Institution'], r['FullName']), selected_num_days) if use_teacher_eligible_days else selected_num_days, axis=1)[span_938](start_span)[span_938](end_span)
        ld_daily['Performance Benchmark (Min)'] = ld_daily['Eligible Working Days'] * daily_ld_target_t1[span_939](start_span)[span_939](end_span)
        
        ld_daily['Performance Indicator Status'] = ld_daily.apply(lambda r: calculate_kpi_status(r['Duration_Min'], r['Performance Benchmark (Min)'], enable_quant_kpi_t1, r['Eligible Working Days'] == 0), axis=1)[span_940](start_span)[span_940](end_span)

        c1, c2, c3, c4 = st.columns(4)[span_941](start_span)[span_941](end_span)
        total_teachers = len(ld_daily)[span_942](start_span)[span_942](end_span)
        met_count = len(ld_daily[(ld_daily['Duration_Min'] >= ld_daily['Performance Benchmark (Min)']) & (ld_daily['Performance Benchmark (Min)'] > 0)]) if enable_quant_kpi_t1 else len(ld_daily[ld_daily['Duration_Min'] > 0])[span_943](start_span)[span_943](end_span)
        inactive_count = len(ld_daily[ld_daily['Duration_Min'] == 0.0])[span_944](start_span)[span_944](end_span)
        
        c1.metric("Total Roster Teachers", total_teachers)[span_945](start_span)[span_945](end_span)
        c2.metric(f"Met Standard ({calc_ld_kpi_t1:.0f}m)" if enable_quant_kpi_t1 else "Active Teachers", f"{met_count} / {total_teachers}")[span_946](start_span)[span_946](end_span)
        c3.metric("Inactive Teachers (0m)", inactive_count, delta=f"{-inactive_count}" if inactive_count > 0 else "0", delta_color="inverse")[span_947](start_span)[span_947](end_span)
        c4.metric("Compliance Rate", f"{(met_count/total_teachers*100 if total_teachers>0 else 0):.1f}%")[span_948](start_span)[span_948](end_span)

        fig_ld = px.bar(
            ld_daily, x="FullName", y="Duration_Min", color="Performance Indicator Status",
            title=f"Lesson Prep Minutes per Teacher" + (f" vs. {calc_ld_kpi_t1:.0f} Min Standard" if enable_quant_kpi_t1 else ""),
            labels={"FullName": "Teacher Name", "Duration_Min": "Minutes Prepared"},
            text_auto=".1f"
        )[span_949](start_span)[span_949](end_span)
        if enable_quant_kpi_t1 and calc_ld_kpi_t1 > 0:[span_950](start_span)[span_950](end_span)
            fig_ld.add_hline(y=calc_ld_kpi_t1, line_dash="dash", line_color="black", annotation_text=f"Guideline ({calc_ld_kpi_t1:.0f} mins)")[span_951](start_span)[span_951](end_span)
        st.plotly_chart(fig_ld, use_container_width=True)[span_952](start_span)[span_952](end_span)

        display_ld_table = ld_daily.rename(columns={'Institution': 'School', 'FullName': 'Teacher Name', 'Duration_Min': 'Minutes Logged'}).round({'Minutes Logged': 1})[span_953](start_span)[span_953](end_span)
        st.dataframe(display_ld_table, use_container_width=True)[span_954](start_span)[span_954](end_span)

        col_t1_d1, col_t1_d2 = st.columns(2)[span_955](start_span)[span_955](end_span)
        with col_t1_d1:[span_956](start_span)[span_956](end_span)
            if st.button("⚙️ Compile Tab 1 PDF Report", key="prep_pdf_tab1_btn"):[span_957](start_span)[span_957](end_span)
                with st.spinner("Compiling PDF report..."):[span_958](start_span)[span_958](end_span)
                    pdf_bytes = generate_comprehensive_school_pdf_report(
                        school_name=tab1_selected_school if tab1_selected_school != "All Selected Schools" else "Multiple Schools",
                        teachers_list=tab1_active_roster['FullName'].unique().tolist(),
                        school_filtered_df=school_filtered_df,
                        filtered_df=filtered_df,
                        filter_desc=filter_description_text,
                        calc_ld_kpi=calc_ld_kpi_t1,
                        calc_content_kpi=st.session_state.get('calc_content_kpi_t3', calculate_kpi_target(30.0, selected_num_days, True)),
                        calc_lib_kpi=st.session_state.get('calc_lib_kpi_t2', calculate_kpi_target(30.0, selected_num_days, True)),
                        daily_ld_target=daily_ld_target_t1,
                        daily_content_target=st.session_state.get('daily_content_target_t3', 30.0),
                        daily_lib_target=st.session_state.get('daily_lib_target_t2', 30.0),
                        selected_num_days=selected_num_days,
                        enable_quant_kpi=enable_quant_kpi_t1,
                        enable_qual_kpi=True,
                        active_metric_mode="Both"
                    ).getvalue()[span_959](start_span)[span_959](end_span)
                    st.session_state["tab1_pdf_ready"] = pdf_bytes[span_960](start_span)[span_960](end_span)

            if "tab1_pdf_ready" in st.session_state:[span_961](start_span)[span_961](end_span)
                st.download_button(
                    label="📄 Download Tab 1 Report (PDF)",
                    data=st.session_state["tab1_pdf_ready"],
                    file_name=f"Lesson_Plan_Prep_Report_{selected_month.replace(' ', '_')}.pdf",
                    mime="application/pdf",
                    key="btn_pdf_tab1"
                )[span_962](start_span)[span_962](end_span)

        with col_t1_d2:[span_963](start_span)[span_963](end_span)
            if st.button("⚙️ Prepare Tab 1 Excel Export", key="prep_xlsx_tab1_btn"):[span_964](start_span)[span_964](end_span)
                buf_t1_xlsx = BytesIO()[span_965](start_span)[span_965](end_span)
                with pd.ExcelWriter(buf_t1_xlsx, engine='openpyxl') as writer:[span_966](start_span)[span_966](end_span)
                    display_ld_table.to_excel(writer, index=False, sheet_name="Lesson_Prep_Logs")[span_967](start_span)[span_967](end_span)
                st.session_state["tab1_xlsx_ready"] = buf_t1_xlsx.getvalue()[span_968](start_span)[span_968](end_span)

            if "tab1_xlsx_ready" in st.session_state:[span_969](start_span)[span_969](end_span)
                st.download_button(
                    label="📥 Download Tab 1 Data (Excel)",
                    data=st.session_state["tab1_xlsx_ready"],
                    file_name=f"Lesson_Plan_Prep_{selected_month.replace(' ', '_')}.xlsx",
                    mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    key="btn_xlsx_tab1"
                )[span_970](start_span)[span_970](end_span)

        teacher_prep_breakdown = "\n\n".join([f"• **{r['FullName']}**: {r['Duration_Min']:.1f} mins ({r['Performance Indicator Status']})" for _, r in ld_daily.iterrows()])[span_971](start_span)[span_971](end_span)
        tab1_metrics_summary = (
            f"🎯 Target KPI: {daily_ld_target_t1:.0f} mins/day × {selected_num_days} working days = {calc_ld_kpi_t1:.0f} mins total standard\n"
            f"Total Roster: {total_teachers} teachers | Met Standard: {met_count} | Inactive: {inactive_count} | Compliance Rate: {(met_count/total_teachers*100 if total_teachers>0 else 0):.1f}%\n\n"
            f"Detailed Teacher Lesson Prep Logs:\n{teacher_prep_breakdown}"
        )[span_972](start_span)[span_972](end_span)
        render_universal_crm_box("Lesson Plan Prep Tracker", selected_schools, filter_description_text, tab1_metrics_summary)[span_973](start_span)[span_973](end_span)

    # TAB 2: LIBRARY USAGE TRACKER
    with tab2:[span_974](start_span)[span_974](end_span)
        st.header("📚 Library Usage Tracker")[span_975](start_span)[span_975](end_span)
        st.caption("Review digital library research, supplementary assets, and general platform exploration.")[span_976](start_span)[span_976](end_span)
        
        with st.expander("🎯 Library Target Benchmark Settings", expanded=False):[span_977](start_span)[span_977](end_span)
            t2_kcol1, t2_kcol2 = st.columns(2)[span_978](start_span)[span_978](end_span)
            with t2_kcol1:[span_979](start_span)[span_979](end_span)
                enable_quant_kpi_t2 = st.checkbox("Enable Library Quantitative Benchmark", value=True, key="t2_enable_quant_kpi")[span_980](start_span)[span_980](end_span)
            with t2_kcol2:[span_981](start_span)[span_981](end_span)
                daily_lib_target_t2 = st.number_input("Library Usage Target (Mins/Day)", min_value=0.0, max_value=120.0, value=30.0, step=5.0, key="t2_lib_target", disabled=not enable_quant_kpi_t2) if enable_quant_kpi_t2 else 0.0[span_982](start_span)[span_982](end_span)

        calc_lib_kpi_t2 = calculate_kpi_target(daily_lib_target_t2, selected_num_days, enable_quant_kpi_t2)[span_983](start_span)[span_983](end_span)
        st.session_state['calc_lib_kpi_t2'] = calc_lib_kpi_t2[span_984](start_span)[span_984](end_span)
        st.session_state['daily_lib_target_t2'] = daily_lib_target_t2[span_985](start_span)[span_985](end_span)

        tab2_col_f1, tab2_col_f2 = st.columns(2)[span_986](start_span)[span_986](end_span)
        with tab2_col_f1:[span_987](start_span)[span_987](end_span)
            tab2_schools = ["All Selected Schools"] + sorted([s for s in filtered_df['Institution'].unique() if str(s).strip()])[span_988](start_span)[span_988](end_span)
            tab2_selected_school = st.selectbox("Filter Tab by School:", tab2_schools, key="tab2_school_filter")[span_989](start_span)[span_989](end_span)
        
        tab2_active_df = filtered_df if tab2_selected_school == "All Selected Schools" else filtered_df[filtered_df['Institution'] == tab2_selected_school][span_990](start_span)[span_990](end_span)
        tab2_active_roster = filtered_roster if tab2_selected_school == "All Selected Schools" else filtered_roster[filtered_roster['Institution'] == tab2_selected_school][span_991](start_span)[span_991](end_span)

        with tab2_col_f2:[span_992](start_span)[span_992](end_span)
            tab2_teachers = ["All Teachers"] + sorted([t for t in tab2_active_roster['FullName'].unique() if str(t).strip()])[span_993](start_span)[span_993](end_span)
            tab2_selected_teacher = st.selectbox("Filter Tab by Teacher:", tab2_teachers, key="tab2_teacher_filter")[span_994](start_span)[span_994](end_span)
            
        if tab2_selected_teacher != "All Teachers":[span_995](start_span)[span_995](end_span)
            tab2_active_df = tab2_active_df[tab2_active_df['FullName'] == tab2_selected_teacher][span_996](start_span)[span_996](end_span)
            tab2_active_roster = tab2_active_roster[tab2_active_roster['FullName'] == tab2_selected_teacher][span_997](start_span)[span_997](end_span)

        if enable_quant_kpi_t2 and calc_lib_kpi_t2 > 0:[span_998](start_span)[span_998](end_span)
            st.caption(f"Benchmark Standard: **At least {calc_lib_kpi_t2:.0f} Minutes** ({daily_lib_target_t2:.0f} mins/day across {selected_num_days} working day(s)).")[span_999](start_span)[span_999](end_span)
        else:
            st.caption(f"Reviewing cumulative library usage minutes across {selected_num_days} working day(s).")[span_1000](start_span)[span_1000](end_span)

        lib_df = tab2_active_df[tab2_active_df['Type'] == 'library'][span_1001](start_span)[span_1001](end_span)
        lib_usage = lib_df.groupby(['Institution', 'FullName'])['Duration_Min'].sum().reset_index()[span_1002](start_span)[span_1002](end_span)
        lib_daily = tab2_active_roster.merge(lib_usage, on=['Institution', 'FullName'], how='left').fillna(0.0)[span_1003](start_span)[span_1003](end_span)
        lib_daily['Eligible Working Days'] = lib_daily.apply(lambda r: teacher_days.get((r['Institution'], r['FullName']), selected_num_days) if use_teacher_eligible_days else selected_num_days, axis=1)[span_1004](start_span)[span_1004](end_span)
        lib_daily['Performance Benchmark (Min)'] = lib_daily['Eligible Working Days'] * daily_lib_target_t2[span_1005](start_span)[span_1005](end_span)
        
        lib_daily['Performance Indicator Status'] = lib_daily.apply(lambda r: calculate_kpi_status(r['Duration_Min'], r['Performance Benchmark (Min)'], enable_quant_kpi_t2, r['Eligible Working Days'] == 0), axis=1)[span_1006](start_span)[span_1006](end_span)

        m1, m2, m3, m4 = st.columns(4)[span_1007](start_span)[span_1007](end_span)
        lib_total_teachers = len(lib_daily)[span_1008](start_span)[span_1008](end_span)
        lib_met_count = len(lib_daily[(lib_daily['Duration_Min'] >= lib_daily['Performance Benchmark (Min)']) & (lib_daily['Performance Benchmark (Min)'] > 0)]) if enable_quant_kpi_t2 else len(lib_daily[lib_daily['Duration_Min'] > 0])[span_1009](start_span)[span_1009](end_span)
        lib_inactive_count = len(lib_daily[lib_daily['Duration_Min'] == 0.0])[span_1010](start_span)[span_1010](end_span)
        
        m1.metric("Total Roster Teachers", lib_total_teachers)[span_1011](start_span)[span_1011](end_span)
        m2.metric(f"Met Standard ({calc_lib_kpi_t2:.0f}m)" if enable_quant_kpi_t2 else "Active Teachers", f"{lib_met_count} / {lib_total_teachers}")[span_1012](start_span)[span_1012](end_span)
        m3.metric("Inactive Teachers (0m)", lib_inactive_count, delta=f"{-lib_inactive_count}" if lib_inactive_count > 0 else "0", delta_color="inverse")[span_1013](start_span)[span_1013](end_span)
        m4.metric("Engagement Rate", f"{(lib_met_count/lib_total_teachers*100 if lib_total_teachers>0 else 0):.1f}%")[span_1014](start_span)[span_1014](end_span)

        fig_lib = px.bar(
            lib_daily, x="FullName", y="Duration_Min", color="Performance Indicator Status",
            title=f"Library Usage Minutes per Teacher" + (f" vs. {calc_lib_kpi_t2:.0f} Min Standard" if enable_quant_kpi_t2 else ""),
            labels={"FullName": "Teacher Name", "Duration_Min": "Minutes Logged"},
            text_auto=".1f"
        )[span_1015](start_span)[span_1015](end_span)
        if enable_quant_kpi_t2 and calc_lib_kpi_t2 > 0:[span_1016](start_span)[span_1016](end_span)
            fig_lib.add_hline(y=calc_lib_kpi_t2, line_dash="dash", line_color="black", annotation_text=f"Guideline ({calc_lib_kpi_t2:.0f} mins)")[span_1017](start_span)[span_1017](end_span)
        st.plotly_chart(fig_lib, use_container_width=True)[span_1018](start_span)[span_1018](end_span)

        display_lib_table = lib_daily.rename(columns={'Institution': 'School', 'FullName': 'Teacher Name', 'Duration_Min': 'Minutes Logged'}).round({'Minutes Logged': 1})[span_1019](start_span)[span_1019](end_span)
        st.dataframe(display_lib_table, use_container_width=True)[span_1020](start_span)[span_1020](end_span)

        col_t2_d1, col_t2_d2 = st.columns(2)[span_1021](start_span)[span_1021](end_span)
        with col_t2_d1:[span_1022](start_span)[span_1022](end_span)
            if st.button("⚙️ Compile Tab 2 PDF Report (Library Only)", key="prep_pdf_tab2_btn"):[span_1023](start_span)[span_1023](end_span)
                with st.spinner("Compiling Library PDF report..."):[span_1024](start_span)[span_1024](end_span)
                    pdf_bytes = generate_comprehensive_school_pdf_report(
                        school_name=tab2_selected_school if tab2_selected_school != "All Selected Schools" else "Multiple Schools",
                        teachers_list=tab2_active_roster['FullName'].unique().tolist(),
                        school_filtered_df=school_filtered_df,
                        filtered_df=filtered_df,
                        filter_desc=filter_description_text,
                        calc_ld_kpi=st.session_state.get('calc_ld_kpi_t1', calculate_kpi_target(10.0, selected_num_days, True)),
                        calc_content_kpi=st.session_state.get('calc_content_kpi_t3', calculate_kpi_target(30.0, selected_num_days, True)),
                        calc_lib_kpi=calc_lib_kpi_t2,
                        daily_ld_target=st.session_state.get('daily_ld_target_t1', 10.0),
                        daily_content_target=st.session_state.get('daily_content_target_t3', 30.0),
                        daily_lib_target=daily_lib_target_t2,
                        selected_num_days=selected_num_days,
                        enable_quant_kpi=enable_quant_kpi_t2,
                        enable_qual_kpi=True,
                        active_metric_mode="Library Usage"
                    ).getvalue()[span_1025](start_span)[span_1025](end_span)
                    st.session_state["tab2_pdf_ready"] = pdf_bytes[span_1026](start_span)[span_1026](end_span)

            if "tab2_pdf_ready" in st.session_state:[span_1027](start_span)[span_1027](end_span)
                st.download_button(
                    label="📄 Download Tab 2 Report (PDF)",
                    data=st.session_state["tab2_pdf_ready"],
                    file_name=f"Library_Usage_Report_{selected_month.replace(' ', '_')}.pdf",
                    mime="application/pdf",
                    key="btn_pdf_tab2"
                )[span_1028](start_span)[span_1028](end_span)

        with col_t2_d2:[span_1029](start_span)[span_1029](end_span)
            if st.button("⚙️ Prepare Tab 2 Excel Export", key="prep_xlsx_tab2_btn"):[span_1030](start_span)[span_1030](end_span)
                buf_t2_xlsx = BytesIO()[span_1031](start_span)[span_1031](end_span)
                with pd.ExcelWriter(buf_t2_xlsx, engine='openpyxl') as writer:[span_1032](start_span)[span_1032](end_span)
                    display_lib_table.to_excel(writer, index=False, sheet_name="Library_Usage_Logs")[span_1033](start_span)[span_1033](end_span)
                st.session_state["tab2_xlsx_ready"] = buf_t2_xlsx.getvalue()[span_1034](start_span)[span_1034](end_span)

            if "tab2_xlsx_ready" in st.session_state:[span_1035](start_span)[span_1035](end_span)
                st.download_button(
                    label="📥 Download Tab 2 Data (Excel)",
                    data=st.session_state["tab2_xlsx_ready"],
                    file_name=f"Library_Usage_{selected_month.replace(' ', '_')}.xlsx",
                    mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    key="btn_xlsx_tab2"
                )[span_1036](start_span)[span_1036](end_span)

        teacher_lib_breakdown = "\n\n".join([f"• **{r['FullName']}**: {r['Duration_Min']:.1f} mins ({r['Performance Indicator Status']})" for _, r in lib_daily.iterrows()])[span_1037](start_span)[span_1037](end_span)
        tab2_metrics_summary = (
            f"🎯 Target KPI: {daily_lib_target_t2:.0f} mins/day × {selected_num_days} working days = {calc_lib_kpi_t2:.0f} mins total standard\n"
            f"Total Roster: {lib_total_teachers} teachers | Active Met Standard: {lib_met_count} | Inactive: {lib_inactive_count} | Engagement Rate: {(lib_met_count/lib_total_teachers*100 if lib_total_teachers>0 else 0):.1f}%\n\n"
            f"Detailed Teacher Library Usage Logs:\n{teacher_lib_breakdown}"
        )[span_1038](start_span)[span_1038](end_span)
        render_universal_crm_box("Library Usage Tracker", selected_schools, filter_description_text, tab2_metrics_summary)[span_1039](start_span)[span_1039](end_span)

    # TAB 3: CONTENT & CHAPTERS (PRIMARY QUANTITATIVE BENCHMARK)
    with tab3:[span_1040](start_span)[span_1040](end_span)
        st.header("📖 Content & Chapters (Primary Quantitative Benchmark)")[span_1041](start_span)[span_1041](end_span)
        st.caption(f"Track specific textbook time and chapter-wise instructional delivery during `{filter_description_text}`.")[span_1042](start_span)[span_1042](end_span)

        with st.expander("🎯 Content / Book Target Benchmark Settings", expanded=False):[span_1043](start_span)[span_1043](end_span)
            t3_kcol1, t3_kcol2 = st.columns(2)[span_1044](start_span)[span_1044](end_span)
            with t3_kcol1:[span_1045](start_span)[span_1045](end_span)
                enable_quant_kpi_t3 = st.checkbox("Enable Content Quantitative Benchmark", value=True, key="t3_enable_quant_kpi")[span_1046](start_span)[span_1046](end_span)
            with t3_kcol2:[span_1047](start_span)[span_1047](end_span)
                daily_content_target_t3 = st.number_input("Content Delivery Target (Mins/Day)", min_value=0.0, max_value=120.0, value=30.0, step=5.0, key="t3_content_target", disabled=not enable_quant_kpi_t3) if enable_quant_kpi_t3 else 0.0[span_1048](start_span)[span_1048](end_span)

        calc_content_kpi_t3 = calculate_kpi_target(daily_content_target_t3, selected_num_days, enable_quant_kpi_t3)[span_1049](start_span)[span_1049](end_span)
        st.session_state['calc_content_kpi_t3'] = calc_content_kpi_t3[span_1050](start_span)[span_1050](end_span)
        st.session_state['daily_content_target_t3'] = daily_content_target_t3[span_1051](start_span)[span_1051](end_span)

        if global_content_df.empty:[span_1052](start_span)[span_1052](end_span)
            st.info("No specific textbook/chapter access logs found in the uploaded data for the selected global filters.")[span_1053](start_span)[span_1053](end_span)
        else:
            col_f1, col_f2, col_f3 = st.columns(3)[span_1054](start_span)[span_1054](end_span)
            with col_f1:[span_1055](start_span)[span_1055](end_span)
                t3_school_opt = ["All Selected Schools"] + sorted(global_content_df['Institution'].unique().tolist())[span_1056](start_span)[span_1056](end_span)
                t3_school = st.selectbox("🏫 Select School:", t3_school_opt, key="t3_school")[span_1057](start_span)[span_1057](end_span)
                
            t3_df = global_content_df if t3_school == "All Selected Schools" else global_content_df[global_content_df['Institution'] == t3_school][span_1058](start_span)[span_1058](end_span)
            t3_roster = filtered_roster if t3_school == "All Selected Schools" else filtered_roster[filtered_roster['Institution'] == t3_school][span_1059](start_span)[span_1059](end_span)

            with col_f2:[span_1060](start_span)[span_1060](end_span)
                t3_teacher_opt = ["All Teachers"] + sorted(t3_roster['FullName'].unique().tolist())[span_1061](start_span)[span_1061](end_span)
                t3_teacher = st.selectbox("👤 Select Teacher:", t3_teacher_opt, key="t3_teacher")[span_1062](start_span)[span_1062](end_span)
                
            if t3_teacher != "All Teachers":[span_1063](start_span)[span_1063](end_span)
                t3_df = t3_df[t3_df['FullName'] == t3_teacher][span_1064](start_span)[span_1064](end_span)
                t3_roster = t3_roster[t3_roster['FullName'] == t3_teacher][span_1065](start_span)[span_1065](end_span)

            with col_f3:[span_1066](start_span)[span_1066](end_span)
                t3_subject_opt = ["All Subjects"] + sorted([s for s in t3_df['Subject'].unique().tolist() if str(s).strip()])[span_1067](start_span)[span_1067](end_span)
                t3_subject = st.selectbox("📚 Select Subject:", t3_subject_opt, key="t3_subject")[span_1068](start_span)[span_1068](end_span)

            if t3_subject != "All Subjects":[span_1069](start_span)[span_1069](end_span)
                t3_df = t3_df[t3_df['Subject'] == t3_subject][span_1070](start_span)[span_1070](end_span)

            st.markdown("---")[span_1071](start_span)[span_1071](end_span)

            content_teacher_usage = t3_df.groupby(['Institution', 'FullName'])['Duration_Min'].sum().reset_index()[span_1072](start_span)[span_1072](end_span)
            content_daily = t3_roster.merge(content_teacher_usage, on=['Institution', 'FullName'], how='left').fillna(0.0)[span_1073](start_span)[span_1073](end_span)
            content_daily['Eligible Working Days'] = content_daily.apply(lambda r: teacher_days.get((r['Institution'], r['FullName']), selected_num_days) if use_teacher_eligible_days else selected_num_days, axis=1)[span_1074](start_span)[span_1074](end_span)
            content_daily['Performance Benchmark (Min)'] = content_daily['Eligible Working Days'] * daily_content_target_t3[span_1075](start_span)[span_1075](end_span)
            content_daily['Performance Indicator Status'] = content_daily.apply(lambda r: calculate_kpi_status(r['Duration_Min'], r['Performance Benchmark (Min)'], enable_quant_kpi_t3, r['Eligible Working Days'] == 0), axis=1)[span_1076](start_span)[span_1076](end_span)

            c_cnt_tot = len(content_daily)[span_1077](start_span)[span_1077](end_span)
            c_cnt_met = len(content_daily[(content_daily['Duration_Min'] >= content_daily['Performance Benchmark (Min)']) & (content_daily['Performance Benchmark (Min)'] > 0)]) if enable_quant_kpi_t3 else len(content_daily[content_daily['Duration_Min'] > 0])[span_1078](start_span)[span_1078](end_span)
            c_cnt_inact = len(content_daily[content_daily['Duration_Min'] == 0.0])[span_1079](start_span)[span_1079](end_span)

            ck1, ck2, ck3, ck4 = st.columns(4)[span_1080](start_span)[span_1080](end_span)
            ck1.metric("Total Roster Teachers", c_cnt_tot)[span_1081](start_span)[span_1081](end_span)
            ck2.metric(f"Met Content Benchmark ({calc_content_kpi_t3:.0f}m)" if enable_quant_kpi_t3 else "Active Teachers", f"{c_cnt_met} / {c_cnt_tot}")[span_1082](start_span)[span_1082](end_span)
            ck3.metric("Inactive Teachers (0m)", c_cnt_inact, delta=f"{-c_cnt_inact}" if c_cnt_inact > 0 else "0", delta_color="inverse")[span_1083](start_span)[span_1083](end_span)
            ck4.metric("Textbooks Opened", t3_df['Book'].nunique())[span_1084](start_span)[span_1084](end_span)

            fig_content = px.bar(
                content_daily, x="FullName", y="Duration_Min", color="Performance Indicator Status",
                title=f"Textbook & Chapter Delivery Minutes per Teacher" + (f" vs. {calc_content_kpi_t3:.0f} Min Standard" if enable_quant_kpi_t3 else ""),
                labels={"FullName": "Teacher Name", "Duration_Min": "Minutes Taught"},
                text_auto=".1f"
            )[span_1085](start_span)[span_1085](end_span)
            if enable_quant_kpi_t3 and calc_content_kpi_t3 > 0:[span_1086](start_span)[span_1086](end_span)
                fig_content.add_hline(y=calc_content_kpi_t3, line_dash="dash", line_color="black", annotation_text=f"Guideline ({calc_content_kpi_t3:.0f} mins)")[span_1087](start_span)[span_1087](end_span)
            st.plotly_chart(fig_content, use_container_width=True)[span_1088](start_span)[span_1088](end_span)

            col_c1, col_c2 = st.columns(2)[span_1089](start_span)[span_1089](end_span)
            with col_c1:[span_1090](start_span)[span_1090](end_span)
                if t3_teacher != "All Teachers":[span_1091](start_span)[span_1091](end_span)
                    ch_summary = t3_df.groupby(['Book', 'Grade'])['Duration_Min'].sum().reset_index()[span_1092](start_span)[span_1092](end_span)
                    fig_ch = px.bar(
                        ch_summary, x="Duration_Min", y="Book", color="Grade", orientation="h",
                        title=f"Chapters Opened by {t3_teacher} (Mins)",
                        labels={"Duration_Min": "Minutes", "Book": "Book / Chapter"},
                        text_auto=".1f"
                    )[span_1093](start_span)[span_1093](end_span)
                    fig_ch.update_layout(yaxis={'categoryorder':'total ascending'})[span_1094](start_span)[span_1094](end_span)
                else:
                    ch_summary = t3_df.groupby(['FullName', 'Book'])['Duration_Min'].sum().reset_index()[span_1095](start_span)[span_1095](end_span)
                    fig_ch = px.bar(
                        ch_summary, x="FullName", y="Duration_Min", color="Book",
                        title="Textbooks / Chapters Opened per Teacher (Mins)",
                        labels={"FullName": "Teacher", "Duration_Min": "Minutes", "Book": "Book / Chapter"},
                        barmode="stack", text_auto=".1f"
                    )[span_1096](start_span)[span_1096](end_span)
                st.plotly_chart(fig_ch, use_container_width=True)[span_1097](start_span)[span_1097](end_span)

            with col_c2:[span_1098](start_span)[span_1098](end_span)
                subj_summary = t3_df.groupby('Subject')['Duration_Min'].sum().reset_index()[span_1099](start_span)[span_1099](end_span)
                fig_sub = px.pie(
                    subj_summary, names="Subject", values="Duration_Min",
                    title="Subject / Theme Distribution (Minutes)"
                )[span_1100](start_span)[span_1100](end_span)
                st.plotly_chart(fig_sub, use_container_width=True)[span_1101](start_span)[span_1101](end_span)

            st.subheader("📋 Filtered Granular Textbook Log")[span_1102](start_span)[span_1102](end_span)
            log_cols = ['Institution', 'FullName', 'Grade', 'Subject', 'Book', 'StartTime', 'Duration_Min'][span_1103](start_span)[span_1103](end_span)
            available_cols = [c for c in log_cols if c in t3_df.columns][span_1104](start_span)[span_1104](end_span)
            
            display_content_log = t3_df[available_cols].rename(columns={
                'Institution': 'School', 'FullName': 'Teacher Name', 'Duration_Min': 'Minutes'
            }).sort_values(by='StartTime', ascending=False)[span_1105](start_span)[span_1105](end_span)
            display_content_log['Minutes'] = display_content_log['Minutes'].round(1)[span_1106](start_span)[span_1106](end_span)
            st.dataframe(display_content_log, use_container_width=True)[span_1107](start_span)[span_1107](end_span)

            col_d1, col_d2 = st.columns(2)[span_1108](start_span)[span_1108](end_span)
            with col_d1:[span_1109](start_span)[span_1109](end_span)
                if st.button("⚙️ Prepare Content Excel Export", key="prep_xlsx_tab3_btn"):[span_1110](start_span)[span_1110](end_span)
                    buf_t3_xlsx = BytesIO()[span_1111](start_span)[span_1111](end_span)
                    with pd.ExcelWriter(buf_t3_xlsx, engine='openpyxl') as writer:[span_1112](start_span)[span_1112](end_span)
                        display_content_log.to_excel(writer, index=False, sheet_name='Content_Log')[span_1113](start_span)[span_1113](end_span)
                    st.session_state["tab3_xlsx_ready"] = buf_t3_xlsx.getvalue()[span_1114](start_span)[span_1114](end_span)

                if "tab3_xlsx_ready" in st.session_state:[span_1115](start_span)[span_1115](end_span)
                    st.download_button(
                        label="📥 Download Content Log (Excel)",
                        data=st.session_state["tab3_xlsx_ready"],
                        file_name=f"Content_Log_{selected_month.replace(' ', '_')}.xlsx",
                        mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        key="btn_xlsx_tab3"
                    )[span_1116](start_span)[span_1116](end_span)
            with col_d2:[span_1117](start_span)[span_1117](end_span)
                if st.button("⚙️ Compile Tab 3 PDF Report (Content Only)", key="prep_pdf_tab3_btn"):[span_1118](start_span)[span_1118](end_span)
                    with st.spinner("Compiling Content PDF..."):[span_1119](start_span)[span_1119](end_span)
                        pdf_t3 = generate_comprehensive_school_pdf_report(
                            school_name=t3_school if t3_school != "All Selected Schools" else "Multiple Schools",
                            teachers_list=t3_roster['FullName'].unique().tolist(),
                            school_filtered_df=school_filtered_df,
                            filtered_df=filtered_df,
                            filter_desc=filter_description_text,
                            calc_ld_kpi=st.session_state.get('calc_ld_kpi_t1', calculate_kpi_target(10.0, selected_num_days, True)),
                            calc_content_kpi=calc_content_kpi_t3,
                            calc_lib_kpi=st.session_state.get('calc_lib_kpi_t2', calculate_kpi_target(30.0, selected_num_days, True)),
                            daily_ld_target=st.session_state.get('daily_ld_target_t1', 10.0),
                            daily_content_target=daily_content_target_t3,
                            daily_lib_target=st.session_state.get('daily_lib_target_t2', 30.0),
                            selected_num_days=selected_num_days,
                            enable_quant_kpi=enable_quant_kpi_t3,
                            enable_qual_kpi=True,
                            active_metric_mode="Content / Book Usage"
                        ).getvalue()[span_1120](start_span)[span_1120](end_span)
                        st.session_state["tab3_pdf_ready"] = pdf_t3[span_1121](start_span)[span_1121](end_span)

                if "tab3_pdf_ready" in st.session_state:[span_1122](start_span)[span_1122](end_span)
                    st.download_button(
                        label="📄 Download Tab 3 Content Report (PDF)",
                        data=st.session_state["tab3_pdf_ready"],
                        file_name=f"Content_Usage_Report_{selected_month.replace(' ', '_')}.pdf",
                        mime="application/pdf",
                        key="btn_pdf_tab3"
                    )[span_1123](start_span)[span_1123](end_span)

            book_breakdown_summary = "\n\n".join([f"• {r['Book']} ({r['Grade']} - {r['Subject']}): {r['Duration_Min']:.1f} mins" for _, r in t3_df.groupby(['Book', 'Grade', 'Subject'])['Duration_Min'].sum().reset_index().iterrows()])[span_1124](start_span)[span_1124](end_span)
            tab3_metrics_summary = (
                f"🎯 Content Target: {daily_content_target_t3:.0f} mins/day × {selected_num_days} working days = {calc_content_kpi_t3:.0f} mins total standard\n"
                f"Chapters Opened: {t3_df['Book'].nunique()} | Subjects Taught: {t3_df['Subject'].nunique()} | Total Access Time: {t3_df['Duration_Min'].sum():.1f} Mins\n\n"
                f"Chapter Breakdown:\n{book_breakdown_summary}"
            )[span_1125](start_span)[span_1125](end_span)
            render_universal_crm_box("Content & Chapters", t3_school if t3_school != "All Selected Schools" else selected_schools, filter_description_text, tab3_metrics_summary)[span_1126](start_span)[span_1126](end_span)

    # TAB 4: TEACHER 360° PROFILE REPORT
    with tab4:[span_1127](start_span)[span_1127](end_span)
        st.header("👤 Teacher 360° Performance Profile")[span_1128](start_span)[span_1128](end_span)
        st.caption("Review quantitative lesson metrics, textbook delivery logs, and structured qualitative performance evidence.")[span_1129](start_span)[span_1129](end_span)

        with st.expander("🎯 Teacher 360 Benchmark Controls", expanded=False):[span_1130](start_span)[span_1130](end_span)
            t4_kcol1, t4_kcol2, t4_kcol3 = st.columns(3)[span_1131](start_span)[span_1131](end_span)
            with t4_kcol1:[span_1132](start_span)[span_1132](end_span)
                enable_quant_kpi_t4 = st.checkbox("Enable Quantitative Benchmark", value=True, key="t4_enable_quant_kpi")[span_1133](start_span)[span_1133](end_span)
                daily_ld_target_t4 = st.number_input("Lesson Prep Target (Mins/Day)", min_value=0.0, max_value=60.0, value=10.0, step=5.0, key="t4_ld_target", disabled=not enable_quant_kpi_t4) if enable_quant_kpi_t4 else 0.0[span_1134](start_span)[span_1134](end_span)
                daily_content_target_t4 = st.number_input("Content / Book Target (Mins/Day)", min_value=0.0, max_value=120.0, value=30.0, step=5.0, key="t4_content_target", disabled=not enable_quant_kpi_t4) if enable_quant_kpi_t4 else 0.0[span_1135](start_span)[span_1135](end_span)
                daily_lib_target_t4 = st.number_input("Library Target (Mins/Day)", min_value=0.0, max_value=120.0, value=30.0, step=5.0, key="t4_lib_target", disabled=not enable_quant_kpi_t4) if enable_quant_kpi_t4 else 0.0[span_1136](start_span)[span_1136](end_span)
            with t4_kcol2:[span_1137](start_span)[span_1137](end_span)
                enable_qual_kpi_t4 = st.checkbox("Enable Qualitative Benchmark", value=True, key="t4_enable_qual_kpi")[span_1138](start_span)[span_1138](end_span)
                target_vid_count_t4 = st.number_input("Min. Activity Videos", min_value=1, max_value=20, value=3, step=1, key="t4_vid_cnt", disabled=not enable_qual_kpi_t4) if enable_qual_kpi_t4 else 0[span_1139](start_span)[span_1139](end_span)
                target_writing_count_t4 = st.number_input("Min. Writing Samples", min_value=1, max_value=20, value=3, step=1, key="t4_writing_cnt", disabled=not enable_qual_kpi_t4) if enable_qual_kpi_t4 else 0[span_1140](start_span)[span_1140](end_span)
            with t4_kcol3:[span_1141](start_span)[span_1141](end_span)
                target_lp_combo_count_t4 = st.number_input("Min. LP / Audio Notes", min_value=1, max_value=20, value=3, step=1, key="t4_lp_cnt", disabled=not enable_qual_kpi_t4) if enable_qual_kpi_t4 else 0[span_1142](start_span)[span_1142](end_span)
                target_phonics_count_t4 = st.number_input("Min. Phonics Evidence", min_value=1, max_value=20, value=2, step=1, key="t4_ph_cnt", disabled=not enable_qual_kpi_t4) if enable_qual_kpi_t4 else 0[span_1143](start_span)[span_1143](end_span)
                target_portfolio_count_t4 = st.number_input("Min. Portfolio Artifacts", min_value=1, max_value=20, value=1, step=1, key="t4_pf_cnt", disabled=not enable_qual_kpi_t4) if enable_qual_kpi_t4 else 0[span_1144](start_span)[span_1144](end_span)

        calc_ld_kpi_t4 = calculate_kpi_target(daily_ld_target_t4, selected_num_days, enable_quant_kpi_t4)[span_1145](start_span)[span_1145](end_span)
        calc_content_kpi_t4 = calculate_kpi_target(daily_content_target_t4, selected_num_days, enable_quant_kpi_t4)[span_1146](start_span)[span_1146](end_span)
        calc_lib_kpi_t4 = calculate_kpi_target(daily_lib_target_t4, selected_num_days, enable_quant_kpi_t4)[span_1147](start_span)[span_1147](end_span)

        t4_fcol1, t4_fcol2, t4_fcol3 = st.columns([1, 1, 1.2])[span_1148](start_span)[span_1148](end_span)
        with t4_fcol1:[span_1149](start_span)[span_1149](end_span)
            t4_schools = ["All Selected Schools"] + sorted([s for s in school_master_roster['Institution'].unique() if str(s).strip()])[span_1150](start_span)[span_1150](end_span)
            t4_selected_school = st.selectbox("Filter Roster by School:", t4_schools, key="t4_school_filter")[span_1151](start_span)[span_1151](end_span)

        t4_active_roster = school_master_roster if t4_selected_school == "All Selected Schools" else school_master_roster[school_master_roster['Institution'] == t4_selected_school][span_1152](start_span)[span_1152](end_span)
        all_roster_teachers = sorted(t4_active_roster['FullName'].unique())[span_1153](start_span)[span_1153](end_span)
        
        with t4_fcol2:[span_1154](start_span)[span_1154](end_span)
            if not all_roster_teachers:[span_1155](start_span)[span_1155](end_span)
                st.info("No teachers found in roster for the selected filter.")[span_1156](start_span)[span_1156](end_span)
                target_teacher = None[span_1157](start_span)[span_1157](end_span)
            else:
                target_teacher = st.selectbox("Select Teacher to Audit:", options=all_roster_teachers, key="top_teacher_select")[span_1158](start_span)[span_1158](end_span)

        with t4_fcol3:[span_1159](start_span)[span_1159](end_span)
            primary_view_metric = st.radio("Focus Metric in Audit & PDF:", ["📖 Content (Book) Usage", "📚 Library Usage", "Both Side-by-Side"], horizontal=True, key="t4_metric_focus")[span_1160](start_span)[span_1160](end_span)
        
        if target_teacher:[span_1161](start_span)[span_1161](end_span)
            teacher_all_data = school_filtered_df[school_filtered_df['FullName'] == target_teacher][span_1162](start_span)[span_1162](end_span)
            teacher_date_data = filtered_df[filtered_df['FullName'] == target_teacher][span_1163](start_span)[span_1163](end_span)
            teacher_school = school_master_roster[school_master_roster['FullName'] == target_teacher]['Institution'].values[0] if not school_master_roster[school_master_roster['FullName'] == target_teacher].empty else "N/A[span_1164](start_span)"[span_1164](end_span)

            t_day_ld = teacher_date_data[teacher_date_data['Type'] == 'lessonDelivery']['Duration_Min'].sum() if not teacher_date_data.empty else 0.0[span_1165](start_span)[span_1165](end_span)
            t_day_lib = teacher_date_data[teacher_date_data['Type'] == 'library']['Duration_Min'].sum() if not teacher_date_data.empty else 0.0[span_1166](start_span)[span_1166](end_span)
            
            t_books_raw = teacher_date_data[teacher_date_data['Book'].str.len() > 0][span_1167](start_span)[span_1167](end_span)
            teacher_books = t_books_raw[~t_books_raw['Book'].str.match(r'^Lesson Plan', case=False, na=False)][span_1168](start_span)[span_1168](end_span)
            t_day_content = teacher_books['Duration_Min'].sum() if not teacher_books.empty else 0.0[span_1169](start_span)[span_1169](end_span)

            t_eligible_days = teacher_days.get((teacher_school, target_teacher), selected_num_days) if use_teacher_eligible_days else selected_num_days[span_1170](start_span)[span_1170](end_span)
            t_calc_ld_kpi = calculate_kpi_target(daily_ld_target_t4, t_eligible_days, enable_quant_kpi_t4)[span_1171](start_span)[span_1171](end_span)
            t_calc_content_kpi = calculate_kpi_target(daily_content_target_t4, t_eligible_days, enable_quant_kpi_t4)[span_1172](start_span)[span_1172](end_span)
            t_calc_lib_kpi = calculate_kpi_target(daily_lib_target_t4, t_eligible_days, enable_quant_kpi_t4)[span_1173](start_span)[span_1173](end_span)
            
            ld_pct = safe_percentage(t_day_ld, t_calc_ld_kpi)[span_1174](start_span)[span_1174](end_span)
            content_pct = safe_percentage(t_day_content, t_calc_content_kpi)[span_1175](start_span)[span_1175](end_span)
            lib_pct = safe_percentage(t_day_lib, t_calc_lib_kpi)[span_1176](start_span)[span_1176](end_span)

            ld_advice = f"🌟 Steady Execution ({t_day_ld:.1f}m logged)" if (t_calc_ld_kpi > 0 and t_day_ld >= t_calc_ld_kpi) else (f"⚠️ In-Progress ({t_day_ld:.1f}m logged)" if t_day_ld > 0 else "❌ Pending Activity")[span_1177](start_span)[span_1177](end_span)
            content_advice = f"🌟 Steady Execution ({t_day_content:.1f}m logged)" if (t_calc_content_kpi > 0 and t_day_content >= t_calc_content_kpi) else (f"⚠️ In-Progress ({t_day_content:.1f}m logged)" if t_day_content > 0 else "❌ Pending Activity")[span_1178](start_span)[span_1178](end_span)
            lib_advice = f"🌟 Steady Execution ({t_day_lib:.1f}m logged)" if (t_calc_lib_kpi > 0 and t_day_lib >= t_calc_lib_kpi) else (f"⚠️ In-Progress ({t_day_lib:.1f}m logged)" if t_day_lib > 0 else "❌ Pending Activity")[span_1179](start_span)[span_1179](end_span)

            evidence_source = teacher_date_data[span_1180](start_span)[span_1180](end_span)
            
            v_voice = extract_evidence_items_vectorized(evidence_source, 'Voice_Note_Link')[span_1181](start_span)[span_1181](end_span)
            v_pic = extract_evidence_items_vectorized(evidence_source, 'Lesson_Plan_Picture')[span_1182](start_span)[span_1182](end_span)
            v_writing = extract_evidence_items_vectorized(evidence_source, 'Writing_Sample_Link')[span_1183](start_span)[span_1183](end_span)
            v_phonics = extract_evidence_items_vectorized(evidence_source, 'Phonics_Evidence_Link')[span_1184](start_span)[span_1184](end_span)
            v_portfolio = extract_evidence_items_vectorized(evidence_source, 'Portfolio_Evidence_Link')[span_1185](start_span)[span_1185](end_span)
            v_vid = evidence_items_across_columns(evidence_source, ['Video_Evidence_1', 'Video_Evidence_2', 'Video_Evidence_3'])[span_1186](start_span)[span_1186](end_span)

            lp_combo_total = len(v_voice) + len(v_pic)[span_1187](start_span)[span_1187](end_span)
            total_artifacts = lp_combo_total + len(v_vid) + len(v_writing) + len(v_phonics) + len(v_portfolio)[span_1188](start_span)[span_1188](end_span)

            col_btn_top, col_bulk_btn = st.columns(2)[span_1189](start_span)[span_1189](end_span)
            with col_btn_top:[span_1190](start_span)[span_1190](end_span)
                if st.button(f"⚙️ Compile 360° Profile PDF for {target_teacher} ({primary_view_metric})", key="btn_prep_single_pdf"):[span_1191](start_span)[span_1191](end_span)
                    with st.spinner("Generating teacher profile PDF..."):[span_1192](start_span)[span_1192](end_span)
                        single_pdf = generate_comprehensive_school_pdf_report(
                            school_name=teacher_school,
                            teachers_list=[target_teacher],
                            school_filtered_df=school_filtered_df,
                            filtered_df=filtered_df,
                            filter_desc=filter_description_text,
                            calc_ld_kpi=t_calc_ld_kpi,
                            calc_content_kpi=t_calc_content_kpi,
                            calc_lib_kpi=t_calc_lib_kpi,
                            daily_ld_target=daily_ld_target_t4,
                            daily_content_target=daily_content_target_t4,
                            daily_lib_target=daily_lib_target_t4,
                            selected_num_days=selected_num_days,
                            target_vid_count=target_vid_count_t4,
                            target_writing_count=target_writing_count_t4,
                            target_lp_combo_count=target_lp_combo_count_t4,
                            target_phonics_count=target_phonics_count_t4,
                            target_portfolio_count=target_portfolio_count_t4,
                            enable_quant_kpi=enable_quant_kpi_t4,
                            enable_qual_kpi=enable_qual_kpi_t4,
                            active_metric_mode=primary_view_metric
                        ).getvalue()[span_1193](start_span)[span_1193](end_span)
                        st.session_state[f"pdf_360_{target_teacher}"] = single_pdf[span_1194](start_span)[span_1194](end_span)

                if f"pdf_360_{target_teacher}" in st.session_state:[span_1195](start_span)[span_1195](end_span)
                    st.download_button(
                        label="📥 Download 360° Profile (PDF)",
                        data=st.session_state[f"pdf_360_{target_teacher}"],
                        file_name=f"{target_teacher.replace(' ', '_')}_360_Profile_Report.pdf",
                        mime="application/pdf",
                        key="top_pdf_download_btn"
                    )[span_1196](start_span)[span_1196](end_span)

            with col_bulk_btn:[span_1197](start_span)[span_1197](end_span)
                if st.button(f"⚙️ Compile Bulk School PDF for {teacher_school} ({primary_view_metric})", key="btn_prep_bulk_pdf"):[span_1198](start_span)[span_1198](end_span)
                    with st.spinner("Generating comprehensive school audit..."):[span_1199](start_span)[span_1199](end_span)
                        school_teachers_list = sorted(school_master_roster[school_master_roster['Institution'] == teacher_school]['FullName'].unique().tolist())[span_1200](start_span)[span_1200](end_span)
                        bulk_pdf = generate_comprehensive_school_pdf_report(
                            school_name=teacher_school,
                            teachers_list=school_teachers_list,
                            school_filtered_df=school_filtered_df,
                            filtered_df=filtered_df,
                            filter_desc=filter_description_text,
                            calc_ld_kpi=calc_ld_kpi_t4,
                            calc_content_kpi=calc_content_kpi_t4,
                            calc_lib_kpi=calc_lib_kpi_t4,
                            daily_ld_target=daily_ld_target_t4,
                            daily_content_target=daily_content_target_t4,
                            daily_lib_target=daily_lib_target_t4,
                            selected_num_days=selected_num_days,
                            target_vid_count=target_vid_count_t4,
                            target_writing_count=target_writing_count_t4,
                            target_lp_combo_count=target_lp_combo_count_t4,
                            target_phonics_count=target_phonics_count_t4,
                            target_portfolio_count=target_portfolio_count_t4,
                            enable_quant_kpi=enable_quant_kpi_t4,
                            enable_qual_kpi=enable_qual_kpi_t4,
                            active_metric_mode=primary_view_metric
                        ).getvalue()[span_1201](start_span)[span_1201](end_span)
                        st.session_state[f"bulk_pdf_{teacher_school}"] = bulk_pdf[span_1202](start_span)[span_1202](end_span)

                if f"bulk_pdf_{teacher_school}" in st.session_state:[span_1203](start_span)[span_1203](end_span)
                    st.download_button(
                        label="📥 Download Bulk School 360 Profiles (PDF)",
                        data=st.session_state[f"bulk_pdf_{teacher_school}"],
                        file_name=f"{teacher_school.replace(' ', '_')}_Comprehensive_School_Report.pdf",
                        mime="application/pdf",
                        key="bulk_school_pdf_btn"
                    )[span_1204](start_span)[span_1204](end_span)

            st.markdown(f"### 📋 Audit Profile: **{target_teacher}** | School: **{teacher_school}**")[span_1205](start_span)[span_1205](end_span)

            st.subheader("1. Quantitative Performance Indicator Summary")[span_1206](start_span)[span_1206](end_span)
            st.info(f"📅 **Active Filter**: `{filter_description_text}` | **Performance Indicator Duration**: `{selected_num_days} Working Day(s)`")[span_1207](start_span)[span_1207](end_span)

            col_sum1, col_sum2 = st.columns([1, 1.2])[span_1208](start_span)[span_1208](end_span)

            with col_sum1:[span_1209](start_span)[span_1209](end_span)
                st.markdown("##### 📌 Quantitative Performance Indicator Overview")[span_1210](start_span)[span_1210](end_span)
                s1, s2, s3 = st.columns(3)[span_1211](start_span)[span_1211](end_span)
                s1.metric("Lesson Prep Mins", f"{t_day_ld:.1f} mins", delta=f"{ld_pct:.0f}% of Standard" if enable_quant_kpi_t4 else None)[span_1212](start_span)[span_1212](end_span)
                
                if "Content" in primary_view_metric or "Both" in primary_view_metric:[span_1213](start_span)[span_1213](end_span)
                    s2.metric("Content (Book) Mins", f"{t_day_content:.1f} mins", delta=f"{content_pct:.0f}% of Standard" if enable_quant_kpi_t4 else None)[span_1214](start_span)[span_1214](end_span)
                if "Library" in primary_view_metric or "Both" in primary_view_metric:[span_1215](start_span)[span_1215](end_span)
                    s3.metric("Library Usage Mins", f"{t_day_lib:.1f} mins", delta=f"{lib_pct:.0f}% of Standard" if enable_quant_kpi_t4 else None)[span_1216](start_span)[span_1216](end_span)
                
                st.markdown("##### 💡 Academic Consultant Observation")[span_1217](start_span)[span_1217](end_span)
                st.write(f"• **Lesson Plan Preparation**: {ld_advice}")[span_1218](start_span)[span_1218](end_span)
                if "Content" in primary_view_metric or "Both" in primary_view_metric:[span_1219](start_span)[span_1219](end_span)
                    st.write(f"• **Content / Book Delivery**: {content_advice}")[span_1220](start_span)[span_1220](end_span)
                if "Library" in primary_view_metric or "Both" in primary_view_metric:[span_1221](start_span)[span_1221](end_span)
                    st.write(f"• **Library Usage**: {lib_advice}")[span_1222](start_span)[span_1222](end_span)

            with col_sum2:[span_1223](start_span)[span_1223](end_span)
                st.markdown("##### 📊 Performance Indicator Achievement Comparison")[span_1224](start_span)[span_1224](end_span)
                plot_cats, plot_logs, plot_benches = [], [], [][span_1225](start_span)[span_1225](end_span)
                
                plot_cats.append(f'Lesson Prep ({calc_ld_kpi_t4:.0f}m)' if enable_quant_kpi_t4 else 'Lesson Prep')[span_1226](start_span)[span_1226](end_span)
                plot_logs.append(t_day_ld)[span_1227](start_span)[span_1227](end_span)
                plot_benches.append(calc_ld_kpi_t4)[span_1228](start_span)[span_1228](end_span)
                
                if "Content" in primary_view_metric or "Both" in primary_view_metric:[span_1229](start_span)[span_1229](end_span)
                    plot_cats.append(f'Content Book ({calc_content_kpi_t4:.0f}m)' if enable_quant_kpi_t4 else 'Content Book')[span_1230](start_span)[span_1230](end_span)
                    plot_logs.append(t_day_content)[span_1231](start_span)[span_1231](end_span)
                    plot_benches.append(calc_content_kpi_t4)[span_1232](start_span)[span_1232](end_span)
                    
                if "Library" in primary_view_metric or "Both" in primary_view_metric:[span_1233](start_span)[span_1233](end_span)
                    plot_cats.append(f'Library ({calc_lib_kpi_t4:.0f}m)' if enable_quant_kpi_t4 else 'Library')[span_1234](start_span)[span_1234](end_span)
                    plot_logs.append(t_day_lib)[span_1235](start_span)[span_1235](end_span)
                    plot_benches.append(calc_lib_kpi_t4)[span_1236](start_span)[span_1236](end_span)

                ach_df = pd.DataFrame({
                    'Performance Indicator Category': plot_cats,
                    'Logged Minutes': plot_logs,
                    'Performance Indicator Standard': plot_benches
                })[span_1237](start_span)[span_1237](end_span)
                
                fig_ach = go.Figure()[span_1238](start_span)[span_1238](end_span)
                fig_ach.add_trace(go.Bar(
                    x=ach_df['Performance Indicator Category'], y=ach_df['Logged Minutes'],
                    name='Logged Minutes', marker_color='#2CA02C', text=[f"{v:.1f} mins" for v in ach_df['Logged Minutes']], textposition='auto'
                ))[span_1239](start_span)[span_1239](end_span)
                if enable_quant_kpi_t4:[span_1240](start_span)[span_1240](end_span)
                    fig_ach.add_trace(go.Bar(
                        x=ach_df['Performance Indicator Category'], y=ach_df['Performance Indicator Standard'],
                        name='Standard Guideline', marker_color='#E5E5E5', opacity=0.6, text=[f"{v:.1f} mins" for v in ach_df['Performance Indicator Standard']], textposition='auto'
                    ))[span_1241](start_span)[span_1241](end_span)
                fig_ach.update_layout(
                    barmode='group', title=f"Logged Minutes vs. Standard Guideline ({selected_num_days} Working Day(s))",
                    height=280, margin=dict(l=20, r=20, t=40, b=20)
                )[span_1242](start_span)[span_1242](end_span)
                st.plotly_chart(fig_ach, use_container_width=True)[span_1243](start_span)[span_1243](end_span)

            st.markdown("---")[span_1244](start_span)[span_1244](end_span)

            if "Content" in primary_view_metric or "Both" in primary_view_metric:[span_1245](start_span)[span_1245](end_span)
                st.subheader("2. Detailed Textbook & Chapter Time Breakdown")[span_1246](start_span)[span_1246](end_span)
                if teacher_books.empty:[span_1247](start_span)[span_1247](end_span)
                    st.info(f"No digital textbooks or modules recorded for **{target_teacher}**.")[span_1248](start_span)[span_1248](end_span)
                else:
                    col_b1, col_b2 = st.columns(2)[span_1249](start_span)[span_1249](end_span)
                    with col_b1:[span_1250](start_span)[span_1250](end_span)
                        t_book_summary = teacher_books.groupby(['Book', 'Grade', 'Subject'])['Duration_Min'].sum().reset_index()[span_1251](start_span)[span_1251](end_span)
                        fig_tb_bar = px.bar(
                            t_book_summary, x="Duration_Min", y="Book", color="Grade", orientation="h",
                            title=f"Time Spent per Book/Chapter by {target_teacher} (Minutes)",
                            labels={"Duration_Min": "Time Spent (Minutes)", "Book": "Book / Chapter"},
                            text_auto=".1f"
                        )[span_1252](start_span)[span_1252](end_span)
                        fig_tb_bar.update_layout(yaxis={'categoryorder':'total ascending'}, height=320)[span_1253](start_span)[span_1253](end_span)
                        st.plotly_chart(fig_tb_bar, use_container_width=True)[span_1254](start_span)[span_1254](end_span)
                        
                    with col_b2:[span_1255](start_span)[span_1255](end_span)
                        st.markdown("##### ⏱️ Time Allocation Table")[span_1256](start_span)[span_1256](end_span)
                        display_book_table = t_book_summary.rename(columns={'Book': 'Textbook / Module', 'Grade': 'Grade', 'Subject': 'Subject', 'Duration_Min': 'Time Spent (Mins)'}).round({'Time Spent (Mins)': 1})[span_1257](start_span)[span_1257](end_span)
                        st.dataframe(display_book_table, use_container_width=True)[span_1258](start_span)[span_1258](end_span)

                st.markdown("---")[span_1259](start_span)[span_1259](end_span)

            st.subheader("3. Qualitative Evidences & Artifact Hub (Phonics & Portfolio Integrated)")[span_1260](start_span)[span_1260](end_span)

            v_cols = st.columns(5)[span_1261](start_span)[span_1261](end_span)
            v_cols[0].metric("📖 LP / Audio Notes", f"{lp_combo_total}", delta=f"{len(v_voice)} Audio | {len(v_pic)} Img")[span_1262](start_span)[span_1262](end_span)
            v_cols[1].metric("🎥 Activity Videos", f"{len(v_vid)}")[span_1263](start_span)[span_1263](end_span)
            v_cols[2].metric("📝 Writing Samples", f"{len(v_writing)}")[span_1264](start_span)[span_1264](end_span)
            v_cols[3].metric("🔤 Phonics Evidence", f"{len(v_phonics)}")[span_1265](start_span)[span_1265](end_span)
            v_cols[4].metric("📁 Portfolio Uploads", f"{len(v_portfolio)}")[span_1266](start_span)[span_1266](end_span)

            st.markdown("##### 📌 Detailed Evidence Submissions & Direct Artifact Links")[span_1267](start_span)[span_1267](end_span)
            q_cols1, q_cols2, q_cols3 = st.columns(3)[span_1268](start_span)[span_1268](end_span)
            
            with q_cols1:[span_1269](start_span)[span_1269](end_span)
                st.markdown("###### 📖 1. Lesson Plans & Pre-Class Voice Notes")[span_1270](start_span)[span_1270](end_span)
                combined_lp_items = [][span_1271](start_span)[span_1271](end_span)
                for item in v_voice:[span_1272](start_span)[span_1272](end_span)
                    combined_lp_items.append(f"🎧 [Audio Note]({item['url']}) - **{item['grade']}** | *{item['subject']}* ({item['lesson']}, {item['date']})")[span_1273](start_span)[span_1273](end_span)
                for item in v_pic:[span_1274](start_span)[span_1274](end_span)
                    combined_lp_items.append(f"🖼️ [LP Picture]({item['url']}) - **{item['grade']}** | *{item['subject']}* ({item['lesson']}, {item['date']})")[span_1275](start_span)[span_1275](end_span)
                if combined_lp_items:[span_1276](start_span)[span_1276](end_span)
                    for line in combined_lp_items: st.markdown(f"• {line}")[span_1277](start_span)[span_1277](end_span)
                    with st.expander("👁️ Play / view these files"):[span_1278](start_span)[span_1278](end_span)
                        for i_idx, item in enumerate(v_voice + v_pic):[span_1279](start_span)[span_1279](end_span)
                            render_evidence_media_preview(item, widget_key=f"q1_{i_idx}")[span_1280](start_span)[span_1280](end_span)
                else:
                    st.caption("No lesson plans or voice reflections submitted.")[span_1281](start_span)[span_1281](end_span)

            with q_cols2:[span_1282](start_span)[span_1282](end_span)
                st.markdown("###### 🎥 2. Classroom Videos & Student Writing")[span_1283](start_span)[span_1283](end_span)
                for item in v_vid:[span_1284](start_span)[span_1284](end_span)
                    st.markdown(f"• 🎥 [Watch Video]({item['url']}) - **{item['grade']}** | *{item['subject']}* ({item['lesson']}, {item['date']})")[span_1285](start_span)[span_1285](end_span)
                for item in v_writing:[span_1286](start_span)[span_1286](end_span)
                    st.markdown(f"• 📝 [View Writing]({item['url']}) - **{item['grade']}** | *{item['subject']}* ({item['lesson']}, {item['date']})")[span_1287](start_span)[span_1287](end_span)
                if v_vid or v_writing:[span_1288](start_span)[span_1288](end_span)
                    with st.expander("👁️ Play / view these files"):[span_1289](start_span)[span_1289](end_span)
                        for i_idx, item in enumerate(v_vid + v_writing):[span_1290](start_span)[span_1290](end_span)
                            render_evidence_media_preview(item, widget_key=f"q2_{i_idx}")[span_1291](start_span)[span_1291](end_span)
                else:
                    st.caption("No activity videos or writing samples uploaded.")[span_1292](start_span)[span_1292](end_span)

            with q_cols3:[span_1293](start_span)[span_1293](end_span)
                st.markdown("###### 🔤 3. Phonics Implementation & Portfolio Showcase")[span_1294](start_span)[span_1294](end_span)
                for item in v_phonics:[span_1295](start_span)[span_1295](end_span)
                    st.markdown(f"• 🔤 [Phonics Evidence]({item['url']}) - **{item['grade']}** | *{item['subject']}* ({item['lesson']}, {item['date']})")[span_1296](start_span)[span_1296](end_span)
                for item in v_portfolio:[span_1297](start_span)[span_1297](end_span)
                    st.markdown(f"• 📁 [Portfolio Artifact]({item['url']}) - **{item['grade']}** | *{item['subject']}* ({item['lesson']}, {item['date']})")[span_1298](start_span)[span_1298](end_span)
                if v_phonics or v_portfolio:[span_1299](start_span)[span_1299](end_span)
                    with st.expander("👁️ Play / view these files"):[span_1300](start_span)[span_1300](end_span)
                        for i_idx, item in enumerate(v_phonics + v_portfolio):[span_1301](start_span)[span_1301](end_span)
                            render_evidence_media_preview(item, widget_key=f"q3_{i_idx}")[span_1302](start_span)[span_1302](end_span)
                else:
                    st.caption("No phonics implementation or portfolio files uploaded.")[span_1303](start_span)[span_1303](end_span)

            st.markdown("---")[span_1304](start_span)[span_1304](end_span)

            # Embedded School Audit Box
            sch_roster = school_master_roster[school_master_roster['Institution'] == teacher_school][span_1305](start_span)[span_1305](end_span)
            sch_data = filtered_df[filtered_df['Institution'] == teacher_school][span_1306](start_span)[span_1306](end_span)

            sch_teachers_list = sorted(sch_roster['FullName'].unique().tolist())[span_1307](start_span)[span_1307](end_span)
            tot_teachers = len(sch_teachers_list)[span_1308](start_span)[span_1308](end_span)

            ld_m = sch_data[sch_data['Type'] == 'lessonDelivery'].groupby('FullName')['Duration_Min'].sum().to_dict()[span_1309](start_span)[span_1309](end_span)
            
            sch_content_raw = sch_data[sch_data['Book'].str.len() > 0][span_1310](start_span)[span_1310](end_span)
            sch_content_df = sch_content_raw[~sch_content_raw['Book'].str.match(r'^Lesson Plan', case=False, na=False)][span_1311](start_span)[span_1311](end_span)
            content_m = sch_content_df.groupby('FullName')['Duration_Min'].sum().to_dict()[span_1312](start_span)[span_1312](end_span)

            met_ld = 0[span_1313](start_span)[span_1313](end_span)
            met_content = 0[span_1314](start_span)[span_1314](end_span)
            for t in sch_teachers_list:[span_1315](start_span)[span_1315](end_span)
                t_ld_mins = ld_m.get(t, 0.0)[span_1316](start_span)[span_1316](end_span)
                t_c_mins = content_m.get(t, 0.0)[span_1317](start_span)[span_1317](end_span)
                if (calc_ld_kpi_t4 > 0 and t_ld_mins >= calc_ld_kpi_t4) or (calc_ld_kpi_t4 == 0 and t_ld_mins > 0):[span_1318](start_span)[span_1318](end_span)
                    met_ld += 1[span_1319](start_span)[span_1319](end_span)
                if (calc_content_kpi_t4 > 0 and t_c_mins >= calc_content_kpi_t4) or (calc_content_kpi_t4 == 0 and t_c_mins > 0):[span_1320](start_span)[span_1320](end_span)
                    met_content += 1[span_1321](start_span)[span_1321](end_span)

            ld_comp_pct = (met_ld / tot_teachers * 100) if tot_teachers > 0 else 0[span_1322](start_span)[span_1322](end_span)
            content_comp_pct = (met_content / tot_teachers * 100) if tot_teachers > 0 else 0[span_1323](start_span)[span_1323](end_span)

            inactive_teachers = [t for t in sch_teachers_list if (ld_m.get(t, 0.0) == 0.0 and content_m.get(t, 0.0) == 0.0)][span_1324](start_span)[span_1324](end_span)
            inactive_str = ", ".join(inactive_teachers[:3]) + (f" (+{len(inactive_teachers)-3} more)" if len(inactive_teachers) > 3 else "") if inactive_teachers else "None (All Active)[span_1325](start_span)"[span_1325](end_span)

            vids_cnt = len(evidence_items_across_columns(sch_data, ['Video_Evidence_1', 'Video_Evidence_2', 'Video_Evidence_3']))[span_1326](start_span)[span_1326](end_span)
            phonics_cnt = len(extract_evidence_items_vectorized(sch_data, 'Phonics_Evidence_Link'))[span_1327](start_span)[span_1327](end_span)
            writing_cnt = len(extract_evidence_items_vectorized(sch_data, 'Writing_Sample_Link'))[span_1328](start_span)[span_1328](end_span)
            lp_pic_cnt = len(extract_evidence_items_vectorized(sch_data, 'Lesson_Plan_Picture'))[span_1329](start_span)[span_1329](end_span)
            voice_cnt = len(extract_evidence_items_vectorized(sch_data, 'Voice_Note_Link'))[span_1330](start_span)[span_1330](end_span)
            portfolio_cnt = len(extract_evidence_items_vectorized(sch_data, 'Portfolio_Evidence_Link'))[span_1331](start_span)[span_1331](end_span)

            hosted_school_pdf_url = st.session_state.get(f"hosted_pdf_url_{teacher_school}")[span_1332](start_span)[span_1332](end_span)

            if st.button(f"☁️ Compile & Upload PDF Report to Supabase Cloud for {teacher_school} ({primary_view_metric})", key=f"upload_cloud_pdf_{teacher_school}"):[span_1333](start_span)[span_1333](end_span)
                with st.spinner("Generating and uploading PDF report to Supabase..."):[span_1334](start_span)[span_1334](end_span)
                    school_pdf_buf = generate_comprehensive_school_pdf_report(
                        school_name=teacher_school,
                        teachers_list=sch_teachers_list,
                        school_filtered_df=school_filtered_df,
                        filtered_df=filtered_df,
                        filter_desc=filter_description_text,
                        calc_ld_kpi=calc_ld_kpi_t4,
                        calc_content_kpi=calc_content_kpi_t4,
                        calc_lib_kpi=calc_lib_kpi_t4,
                        daily_ld_target=daily_ld_target_t4,
                        daily_content_target=daily_content_target_t4,
                        daily_lib_target=daily_lib_target_t4,
                        selected_num_days=selected_num_days,
                        target_vid_count=target_vid_count_t4,
                        target_writing_count=target_writing_count_t4,
                        target_lp_combo_count=target_lp_combo_count_t4,
                        target_phonics_count=target_phonics_count_t4,
                        target_portfolio_count=target_portfolio_count_t4,
                        enable_quant_kpi=enable_quant_kpi_t4,
                        enable_qual_kpi=enable_qual_kpi_t4,
                        active_metric_mode=primary_view_metric
                    )[span_1335](start_span)[span_1335](end_span)
                    hosted_school_pdf_url = upload_pdf_to_supabase(school_pdf_buf, teacher_school)[span_1336](start_span)[span_1336](end_span)
                    st.session_state[f"hosted_pdf_url_{teacher_school}"] = hosted_school_pdf_url[span_1337](start_span)[span_1337](end_span)
                    st.success("Uploaded successfully to Supabase!")[span_1338](start_span)[span_1338](end_span)

            pdf_link_markdown = f"\n\n📄 *Download Full School Audit Report (PDF):*\n{hosted_school_pdf_url}" if hosted_school_pdf_url else "[span_1339](start_span)"[span_1339](end_span)

            ld_bench_str = f" [Benchmark: {daily_ld_target_t4:.0f}m/day × {selected_num_days}d = {calc_ld_kpi_t4:.0f} mins total]" if (enable_quant_kpi_t4 and calc_ld_kpi_t4 > 0) else "[span_1340](start_span)"[span_1340](end_span)
            content_bench_str = f" [Benchmark: {daily_content_target_t4:.0f}m/day × {selected_num_days}d = {calc_content_kpi_t4:.0f} mins total]" if (enable_quant_kpi_t4 and calc_content_kpi_t4 > 0) else "[span_1341](start_span)"[span_1341](end_span)

            school_msg_parts = [
                f"Respected Sir/Madam,\n\n",
                f"Greetings from OneLearn Academic Team! Here is the latest performance & classroom implementation summary for *{teacher_school}* ({filter_description_text}):\n"
            ][span_1342](start_span)[span_1342](end_span)

            if enable_quant_kpi_t4:[span_1343](start_span)[span_1343](end_span)
                school_msg_parts.append(
                    f"📊 *Quantitative Benchmarks:*\n"
                    f"• Lesson Plan Prep Compliance: {ld_comp_pct:.0f}% ({met_ld}/{tot_teachers} Teachers){ld_bench_str}\n"
                    f"• Textbook & Chapter Delivery Compliance: {content_comp_pct:.0f}% ({met_content}/{tot_teachers} Teachers){content_bench_str}"
                )[span_1344](start_span)[span_1344](end_span)

            if enable_qual_kpi_t4:[span_1345](start_span)[span_1345](end_span)
                school_msg_parts.append(
                    f"\n📬 *Classroom Evidence Submissions:*\n"
                    f"• Activity Videos: {vids_cnt} Uploaded\n"
                    f"• Phonics Evidence: {phonics_cnt} Uploaded\n"
                    f"• Writing Samples: {writing_cnt} Uploaded\n"
                    f"• LP Pictures / Voice Notes: {lp_pic_cnt + voice_cnt} Uploaded\n"
                    f"• Portfolio Artifacts: {portfolio_cnt} Uploaded"
                )[span_1346](start_span)[span_1346](end_span)

            school_msg_parts.append(
                f"\n⚠️ *Inactive / Follow-up Teachers:* {inactive_str}"
                f"{pdf_link_markdown}\n\n"
                f"Let us connect for a 5-minute review to support your teachers in scaling classroom outcomes.\n\n"
                f"Regards,\n"
                f"Harshit Bhargava,\n"
                f"OneLearn Academic Team"
            )[span_1347](start_span)[span_1347](end_span)

            final_school_wa_msg = "\n".join(school_msg_parts)[span_1348](start_span)[span_1348](end_span)

            render_school_audit_crm_box(
                "Teacher 360 Profile", 
                teacher_school, 
                filter_description_text, 
                final_school_wa_msg
            )[span_1349](start_span)[span_1349](end_span)

    # TAB 5: MANAGER PORTFOLIO & SCHOOL QUADRANTS (CONTENT-DRIVEN)
    with tab5:[span_1350](start_span)[span_1350](end_span)
        st.header("🏛️ Academic Manager Portfolio Overview")[span_1351](start_span)[span_1351](end_span)
        st.caption("High-level classification, Quantitative indicators (Lesson Prep & Content Delivery), and Week-on-Week Velocity tracking.")[span_1352](start_span)[span_1352](end_span)

        if school_filtered_df.empty:[span_1353](start_span)[span_1353](end_span)
            st.warning("No data available for the selected school filter.")[span_1354](start_span)[span_1354](end_span)
        else:
            with st.expander("🎯 Portfolio Quadrant Benchmark Settings", expanded=False):[span_1355](start_span)[span_1355](end_span)
                t5_kcol1, t5_kcol2 = st.columns(2)[span_1356](start_span)[span_1356](end_span)
                with t5_kcol1:[span_1357](start_span)[span_1357](end_span)
                    enable_quant_kpi_t5 = st.checkbox("Enable Quantitative Benchmark", value=True, key="t5_enable_quant_kpi")[span_1358](start_span)[span_1358](end_span)
                    daily_ld_target_t5 = st.number_input("Lesson Prep Target (Mins/Day)", min_value=0.0, max_value=60.0, value=10.0, step=5.0, key="t5_ld_target", disabled=not enable_quant_kpi_t5) if enable_quant_kpi_t5 else 0.0[span_1359](start_span)[span_1359](end_span)
                    daily_content_target_t5 = st.number_input("Content / Book Delivery Target (Mins/Day)", min_value=0.0, max_value=120.0, value=30.0, step=5.0, key="t5_content_target", disabled=not enable_quant_kpi_t5) if enable_quant_kpi_t5 else 0.0[span_1360](start_span)[span_1360](end_span)
                with t5_kcol2:[span_1361](start_span)[span_1361](end_span)
                    enable_qual_kpi_t5 = st.checkbox("Enable Qualitative Artifact Benchmark", value=True, key="t5_enable_qual_kpi")[span_1362](start_span)[span_1362](end_span)
                    target_vid_count_t5 = st.number_input("Min. Activity Videos Required", min_value=1, max_value=20, value=3, step=1, key="t5_vid_cnt", disabled=not enable_qual_kpi_t5) if enable_qual_kpi_t5 else 0[span_1363](start_span)[span_1363](end_span)
                    target_writing_count_t5 = st.number_input("Min. Writing Practice Required", min_value=1, max_value=20, value=3, step=1, key="t5_writing_cnt", disabled=not enable_qual_kpi_t5) if enable_qual_kpi_t5 else 0[span_1364](start_span)[span_1364](end_span)

            t5_class_filter = st.selectbox("Filter Portfolio by Classification:", ["All Classifications", "🌟 Pace Setters", "📘 Lesson Focused", "📖 Content Focused", "🚨 Priority Focus"], key="t5_class_filter")[span_1365](start_span)[span_1365](end_span)

            ld_school_stats = filtered_df[filtered_df['Type'] == 'lessonDelivery'].groupby('Institution')['Duration_Min'].sum().reset_index().rename(columns={'Duration_Min': 'lessonDelivery'})[span_1366](start_span)[span_1366](end_span)
            
            c_school_raw = filtered_df[filtered_df['Book'].str.len() > 0][span_1367](start_span)[span_1367](end_span)
            c_school_df = c_school_raw[~c_school_raw['Book'].str.match(r'^Lesson Plan', case=False, na=False)][span_1368](start_span)[span_1368](end_span)
            content_school_stats = c_school_df.groupby('Institution')['Duration_Min'].sum().reset_index().rename(columns={'Duration_Min': 'contentDelivery'})[span_1369](start_span)[span_1369](end_span)

            school_stats = pd.merge(ld_school_stats, content_school_stats, on='Institution', how='outer').fillna(0.0)[span_1370](start_span)[span_1370](end_span)
            
            all_active_schools = school_filtered_df['Institution'].unique()[span_1371](start_span)[span_1371](end_span)
            for s_name in all_active_schools:[span_1372](start_span)[span_1372](end_span)
                if s_name not in school_stats['Institution'].values:[span_1373](start_span)[span_1373](end_span)
                    new_row = pd.DataFrame({'Institution': [s_name], 'lessonDelivery': [0.0], 'contentDelivery': [0.0]})[span_1374](start_span)[span_1374](end_span)
                    school_stats = pd.concat([school_stats, new_row], ignore_index=True)[span_1375](start_span)[span_1375](end_span)

            school_roster_count = school_master_roster.groupby('Institution')['FullName'].nunique().reset_index().rename(columns={'FullName': 'Roster_Teachers'})[span_1376](start_span)[span_1376](end_span)
            school_stats = school_stats.merge(school_roster_count, on='Institution', how='left').fillna({'Roster_Teachers': 0})[span_1377](start_span)[span_1377](end_span)

            school_stats['Avg_Lesson_Prep_Mins'] = np.where((school_stats['Roster_Teachers'] > 0) & (selected_num_days > 0), school_stats['lessonDelivery'] / school_stats['Roster_Teachers'] / selected_num_days, 0.0).round(1)[span_1378](start_span)[span_1378](end_span)
            school_stats['Avg_Content_Delivery_Mins'] = np.where((school_stats['Roster_Teachers'] > 0) & (selected_num_days > 0), school_stats['contentDelivery'] / school_stats['Roster_Teachers'] / selected_num_days, 0.0).round(1)[span_1379](start_span)[span_1379](end_span)

            qual_agg = [][span_1380](start_span)[span_1380](end_span)
            for s_name in school_stats['Institution'].unique():[span_1381](start_span)[span_1381](end_span)
                s_data = filtered_df[filtered_df['Institution'] == s_name][span_1382](start_span)[span_1382](end_span)
                s_vids = len(evidence_items_across_columns(s_data, ['Video_Evidence_1', 'Video_Evidence_2', 'Video_Evidence_3']))[span_1383](start_span)[span_1383](end_span)
                s_w = len(extract_evidence_items_vectorized(s_data, 'Writing_Sample_Link'))[span_1384](start_span)[span_1384](end_span)
                s_lp = len(extract_evidence_items_vectorized(s_data, 'Lesson_Plan_Picture'))[span_1385](start_span)[span_1385](end_span)
                s_vn = len(extract_evidence_items_vectorized(s_data, 'Voice_Note_Link'))[span_1386](start_span)[span_1386](end_span)
                s_ph = len(extract_evidence_items_vectorized(s_data, 'Phonics_Evidence_Link'))[span_1387](start_span)[span_1387](end_span)
                s_pf = len(extract_evidence_items_vectorized(s_data, 'Portfolio_Evidence_Link'))[span_1388](start_span)[span_1388](end_span)

                qual_agg.append({
                    'Institution': s_name,
                    'Activity_Videos': s_vids,
                    'Writing_Samples': s_w,
                    'LP_Audio_Submissions': s_lp + s_vn,
                    'Phonics_Evidences': s_ph,
                    'Portfolio_Artifacts': s_pf
                })[span_1389](start_span)[span_1389](end_span)
            
            qual_df_school = pd.DataFrame(qual_agg)[span_1390](start_span)[span_1390](end_span)
            school_stats = school_stats.merge(qual_df_school, on='Institution', how='left').fillna(0)[span_1391](start_span)[span_1391](end_span)

            def classify_school(row):
                if not enable_quant_kpi_t5:
                    return 'Active Portfolio'
                ld_ok = row['Avg_Lesson_Prep_Mins'] >= daily_ld_target_t5
                content_ok = row['Avg_Content_Delivery_Mins'] >= daily_content_target_t5
                qual_ok = True
                if enable_qual_kpi_t5:
                    qual_ok = (row['Activity_Videos'] >= target_vid_count_t5) or (row['Writing_Samples'] >= target_writing_count_t5)

                if ld_ok and content_ok and qual_ok:
                    return '🌟 Pace Setters'
                elif ld_ok and not content_ok:
                    return '📘 Lesson Focused'
                elif not ld_ok and content_ok:
                    return '📖 Content Focused'
                else:
                    return '🚨 Priority Focus[span_1392](start_span)'[span_1392](end_span)

            school_stats['Classification'] = school_stats.apply(classify_school, axis=1)[span_1393](start_span)[span_1393](end_span)

            st.subheader("🖼️ 2x2 Portfolio Classification Matrix")[span_1394](start_span)[span_1394](end_span)
            
            pace_setters = school_stats[school_stats['Classification'] == '🌟 Pace Setters']['Institution'].tolist()[span_1395](start_span)[span_1395](end_span)
            lesson_focused = school_stats[school_stats['Classification'] == '📘 Lesson Focused']['Institution'].tolist()[span_1396](start_span)[span_1396](end_span)
            content_focused = school_stats[school_stats['Classification'] == '📖 Content Focused']['Institution'].tolist()[span_1397](start_span)[span_1397](end_span)
            priority_focus = school_stats[school_stats['Classification'] == '🚨 Priority Focus']['Institution'].tolist()[span_1398](start_span)[span_1398](end_span)

            col_top1, col_top2 = st.columns(2)[span_1399](start_span)[span_1399](end_span)
            with col_top1:[span_1400](start_span)[span_1400](end_span)
                st.success(f"🌟 **Pace Setters ({len(pace_setters)} Schools)**\n\n*Met Standards*\n\n" + (", ".join(pace_setters) if pace_setters else "None"))[span_1401](start_span)[span_1401](end_span)
            with col_top2:[span_1402](start_span)[span_1402](end_span)
                st.info(f"📘 **Lesson Focused ({len(lesson_focused)} Schools)**\n\n" + (", ".join(lesson_focused) if lesson_focused else "None"))[span_1403](start_span)[span_1403](end_span)

            col_bot1, col_bot2 = st.columns(2)[span_1404](start_span)[span_1404](end_span)
            with col_bot1:[span_1405](start_span)[span_1405](end_span)
                st.warning(f"📖 **Content Focused ({len(content_focused)} Schools)**\n\n" + (", ".join(content_focused) if content_focused else "None"))[span_1406](start_span)[span_1406](end_span)
            with col_bot2:[span_1407](start_span)[span_1407](end_span)
                st.error(f"🚨 **Priority Focus ({len(priority_focus)} Schools)**\n\n" + (", ".join(priority_focus) if priority_focus else "None"))[span_1408](start_span)[span_1408](end_span)

            display_school_stats = school_stats if t5_class_filter == "All Classifications" else school_stats[school_stats['Classification'] == t5_class_filter][span_1409](start_span)[span_1409](end_span)

            st.subheader("📋 Complete School Performance Leaderboard")[span_1410](start_span)[span_1410](end_span)
            display_qtable = display_school_stats[['Institution', 'Roster_Teachers', 'Avg_Lesson_Prep_Mins', 'Avg_Content_Delivery_Mins', 'LP_Audio_Submissions', 'Activity_Videos', 'Writing_Samples', 'Phonics_Evidences', 'Portfolio_Artifacts', 'Classification']].rename(columns={
                'Institution': 'School Name', 'Roster_Teachers': 'Active Teachers', 'Avg_Lesson_Prep_Mins': 'Prep (m/day)', 'Avg_Content_Delivery_Mins': 'Book Content (m/day)', 'LP_Audio_Submissions': 'LP/Audio Notes', 'Activity_Videos': 'Activity Videos', 'Writing_Samples': 'Writing Samples', 'Phonics_Evidences': 'Phonics Uploads', 'Portfolio_Artifacts': 'Portfolio Uploads'
            })[span_1411](start_span)[span_1411](end_span)
            st.dataframe(display_qtable, use_container_width=True)[span_1412](start_span)[span_1412](end_span)

            col_t5_d1, col_t5_d2 = st.columns(2)[span_1413](start_span)[span_1413](end_span)
            with col_t5_d1:[span_1414](start_span)[span_1414](end_span)
                if st.button("⚙️ Compile Portfolio Overview PDF", key="prep_pdf_tab5_btn"):[span_1415](start_span)[span_1415](end_span)
                    with st.spinner("Compiling Portfolio PDF..."):[span_1416](start_span)[span_1416](end_span)
                        pdf_t5 = generate_pdf_report(
                            title_text="🏛️ Academic Manager Portfolio Review",
                            subtitle_text=f"Portfolio Performance Leaderboard ({selected_num_days} Working Days)",
                            school_name="Multiple Portfolio Schools",
                            summary_metrics={"Total Schools": len(display_school_stats), "Pace Setters": len(pace_setters), "Priority Focus": len(priority_focus)},
                            dataframe=display_qtable
                        ).getvalue()[span_1417](start_span)[span_1417](end_span)
                        st.session_state["tab5_pdf_ready"] = pdf_t5[span_1418](start_span)[span_1418](end_span)

                if "tab5_pdf_ready" in st.session_state:[span_1419](start_span)[span_1419](end_span)
                    st.download_button("📄 Download Portfolio Overview Report (PDF)", data=st.session_state["tab5_pdf_ready"], file_name=f"Manager_Portfolio_Overview_{selected_month.replace(' ', '_')}.pdf", mime="application/pdf", key="btn_pdf_tab5")[span_1420](start_span)[span_1420](end_span)

            with col_t5_d2:[span_1421](start_span)[span_1421](end_span)
                if st.button("⚙️ Prepare Portfolio Leaderboard Excel", key="prep_xlsx_tab5_btn"):[span_1422](start_span)[span_1422](end_span)
                    buf_t5_xlsx = BytesIO()[span_1423](start_span)[span_1423](end_span)
                    with pd.ExcelWriter(buf_t5_xlsx, engine='openpyxl') as writer:[span_1424](start_span)[span_1424](end_span)
                        display_qtable.to_excel(writer, index=False, sheet_name='Portfolio_Leaderboard')[span_1425](start_span)[span_1425](end_span)
                    st.session_state["tab5_xlsx_ready"] = buf_t5_xlsx.getvalue()[span_1426](start_span)[span_1426](end_span)

                if "tab5_xlsx_ready" in st.session_state:[span_1427](start_span)[span_1427](end_span)
                    st.download_button("📥 Download Portfolio Leaderboard (Excel)", data=st.session_state["tab5_xlsx_ready"], file_name=f"Portfolio_Leaderboard_{selected_month.replace(' ', '_')}.xlsx", mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", key="btn_xlsx_tab5")[span_1428](start_span)[span_1428](end_span)

    # TAB 6: SCHOOL-LEVEL TEACHER PROGRESSION & EXECUTION TIERS
    with tab6:[span_1429](start_span)[span_1429](end_span)
        st.header("🏫 School-Level Teacher Progression & Execution Tiers")[span_1430](start_span)[span_1430](end_span)
        
        with st.expander("🎯 Progression Target Benchmark Settings", expanded=False):[span_1431](start_span)[span_1431](end_span)
            t6_kcol1, t6_kcol2 = st.columns(2)[span_1432](start_span)[span_1432](end_span)
            with t6_kcol1:[span_1433](start_span)[span_1433](end_span)
                daily_ld_target_t6 = st.number_input("Lesson Prep Target (Mins/Day)", min_value=0.0, max_value=60.0, value=10.0, step=5.0, key="t6_ld_target")[span_1434](start_span)[span_1434](end_span)
            with t6_kcol2:[span_1435](start_span)[span_1435](end_span)
                daily_content_target_t6 = st.number_input("Content / Book Target (Mins/Day)", min_value=0.0, max_value=120.0, value=30.0, step=5.0, key="t6_content_target")[span_1436](start_span)[span_1436](end_span)

        calc_ld_kpi_t6 = calculate_kpi_target(daily_ld_target_t6, selected_num_days, True)[span_1437](start_span)[span_1437](end_span)
        calc_content_kpi_t6 = calculate_kpi_target(daily_content_target_t6, selected_num_days, True)[span_1438](start_span)[span_1438](end_span)

        all_schools_list_t6 = sorted(school_master_roster['Institution'].unique())[span_1439](start_span)[span_1439](end_span)
        
        if not all_schools_list_t6:[span_1440](start_span)[span_1440](end_span)
            st.info("No schools found in roster.")[span_1441](start_span)[span_1441](end_span)
        else:
            t6_col_f1, t6_col_f2 = st.columns(2)[span_1442](start_span)[span_1442](end_span)
            with t6_col_f1:[span_1443](start_span)[span_1443](end_span)
                target_school_t6 = st.selectbox("Select School to Inspect:", options=all_schools_list_t6, key="t6_school_sel")[span_1444](start_span)[span_1444](end_span)
                
            school_t6_roster = school_master_roster[school_master_roster['Institution'] == target_school_t6][span_1445](start_span)[span_1445](end_span)
            school_t6_data = filtered_df[filtered_df['Institution'] == target_school_t6][span_1446](start_span)[span_1446](end_span)

            t6_ld = school_t6_data[school_t6_data['Type'] == 'lessonDelivery'].groupby('FullName')['Duration_Min'].sum().reset_index()[span_1447](start_span)[span_1447](end_span)
            
            t6_c_raw = school_t6_data[school_t6_data['Book'].str.len() > 0][span_1448](start_span)[span_1448](end_span)
            t6_c_df = t6_c_raw[~t6_c_raw['Book'].str.match(r'^Lesson Plan', case=False, na=False)][span_1449](start_span)[span_1449](end_span)
            t6_content = t6_c_df.groupby('FullName')['Duration_Min'].sum().reset_index()[span_1450](start_span)[span_1450](end_span)

            t6_teachers = school_t6_roster.merge(t6_ld.rename(columns={'Duration_Min': 'Lesson_Mins'}), on='FullName', how='left').fillna(0.0)[span_1451](start_span)[span_1451](end_span)
            t6_teachers = t6_teachers.merge(t6_content.rename(columns={'Duration_Min': 'Content_Mins'}), on='FullName', how='left').fillna(0.0)[span_1452](start_span)[span_1452](end_span)

            def tier_teacher(row):
                if selected_num_days == 0:
                    return '🏖️ Scheduled Break / No Working Days'
                ld_pct = (row['Lesson_Mins'] / calc_ld_kpi_t6) if calc_ld_kpi_t6 > 0 else 0.0
                content_pct = (row['Content_Mins'] / calc_content_kpi_t6) if calc_content_kpi_t6 > 0 else 0.0
                if ld_pct >= 1.0 and content_pct >= 1.0:
                    return '🌟 Consistent Achiever (>= 100%)'
                elif ld_pct < 0.40 and content_pct < 0.40:
                    return '❌ Persistent Inactive (< 40%)'
                else:
                    return '⚠️ Fluctuating / Partial (40%-99%)[span_1453](start_span)'[span_1453](end_span)

            t6_teachers['Execution_Tier'] = t6_teachers.apply(tier_teacher, axis=1)[span_1454](start_span)[span_1454](end_span)

            with t6_col_f2:[span_1455](start_span)[span_1455](end_span)
                t6_tier_filter = st.selectbox("Filter by Execution Tier:", ["All Tiers", "🌟 Consistent Achiever (>= 100%)", "⚠️ Fluctuating / Partial (40%-99%)", "❌ Persistent Inactive (< 40%)"], key="t6_tier_filter")[span_1456](start_span)[span_1456](end_span)

            if t6_tier_filter != "All Tiers":[span_1457](start_span)[span_1457](end_span)
                t6_teachers_filtered = t6_teachers[t6_teachers['Execution_Tier'] == t6_tier_filter][span_1458](start_span)[span_1458](end_span)
            else:
                t6_teachers_filtered = t6_teachers[span_1459](start_span)[span_1459](end_span)

            st.markdown(f"### 🏫 School Audit: **{target_school_t6}** | Active Roster: **{len(school_t6_roster)} Teachers**")[span_1460](start_span)[span_1460](end_span)

            e1, e2, e3 = st.columns(3)[span_1461](start_span)[span_1461](end_span)
            num_ach = len(t6_teachers[t6_teachers['Execution_Tier'].str.startswith('🌟')])[span_1462](start_span)[span_1462](end_span)
            num_fluc = len(t6_teachers[t6_teachers['Execution_Tier'].str.startswith('⚠️')])[span_1463](start_span)[span_1463](end_span)
            num_inact = len(t6_teachers[t6_teachers['Execution_Tier'].str.startswith('❌')])[span_1464](start_span)[span_1464](end_span)

            e1.metric("🌟 Consistent Achievers", num_ach)[span_1465](start_span)[span_1465](end_span)
            e2.metric("⚠️ Fluctuating / Partial", num_fluc)[span_1466](start_span)[span_1466](end_span)
            e3.metric("❌ Persistent Inactive", num_inact)[span_1467](start_span)[span_1467](end_span)

            fig_t6_bar = px.bar(
                t6_teachers_filtered, x="FullName", y=["Lesson_Mins", "Content_MSorry, something went wrong. Please try your request again.
