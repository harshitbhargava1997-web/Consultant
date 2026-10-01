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
import hmac
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from pathlib import Path
from xml.sax.saxutils import escape
from portal_core import (APP_VERSION, RECORD_COLUMNS, EVIDENCE_COLUMNS, record_hash, usage_masks,
    add_review_dates, local_naive_series, eligible_days, report_fingerprint, scope_school,
    parse_duration_minutes as parse_source_duration, validate_import, artifact_counts, evidence_values)
from consultant_workspace import render_workspace, render_data_quality, workflow_ready
import boto3
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
from reportlab.platypus import SimpleDocTemplate, Paragraph as ReportLabParagraph, Spacer, Table as ReportLabTable, TableStyle, HRFlowable, PageBreak
from reportlab.lib.styles import ParagraphStyle
from portal_core import pdf_styles as getSampleStyleSheet
from reportlab.lib import colors

def Paragraph(value, style, *args, **kwargs):
    # Decorative emoji are not supported by the built-in PDF fonts.
    value = re.sub(r"[\U00010000-\U0010ffff\uFE0F]", "", str(value))
    return ReportLabParagraph(value, style, *args, **kwargs)


def Table(data, *args, **kwargs):
    # Wrap plain-string cells so long teacher names/headers never overlap columns.
    styles = getSampleStyleSheet()
    wrapped = []
    for row_index, row in enumerate(data):
        output = []
        for value in row:
            if isinstance(value, str):
                style = ParagraphStyle('WrappedCell', parent=styles['Normal'],fontSize=7.5,leading=10,
                    textColor=colors.white if row_index == 0 else colors.HexColor('#1E293B'))
                output.append(Paragraph(escape(value), style))
            else:
                output.append(value)
        wrapped.append(output)
    if kwargs.get('colWidths') and sum(kwargs['colWidths']) > 540:
        factor = 540 / sum(kwargs['colWidths'])
        kwargs['colWidths'] = [w * factor for w in kwargs['colWidths']]
    kwargs.setdefault('repeatRows',1)
    return ReportLabTable(wrapped,*args,**kwargs)

# Page layout configuration
st.set_page_config(page_title="Academic Manager Portfolio & Teacher Performance Indicator Review Dashboard", layout="wide")

# Optional deployment protection. Configure [access] admin_password before sharing.
try:
    _access = dict(st.secrets.get("access", {}))
except Exception:
    _access = {}
if _access.get("admin_password"):
    if not st.session_state.get("portal_admin_authenticated", False):
        password = st.text_input("Administrator password", type="password", key="portal_admin_password")
        if st.button("Sign in"):
            if hmac.compare_digest(password, str(_access["admin_password"])):
                st.session_state["portal_admin_authenticated"] = True
                st.session_state.pop("portal_admin_password", None)
                st.rerun()
            else:
                st.error("Incorrect password.")
        st.stop()
    if st.sidebar.button("Sign out"):
        st.session_state.clear()
        st.rerun()
else:
    st.warning("Admin access is not protected inside this app. Keep deployment access private, or configure [access] admin_password before sharing.")
DESTRUCTIVE_ENABLED = bool(_access.get("admin_password") and _access.get("allow_destructive_admin", False))
st.sidebar.caption(f"Version {APP_VERSION}")

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

# --- CLOUDFLARE R2 DELETE CLIENT ---
# Separate from R2_PUBLIC_BASE_URL above (which is read-only, just a
# CDN-style base URL). Deleting an uploaded evidence file for real needs
# write credentials, so this reuses the SAME [r2] secrets block the
# teacher-facing submission app already has — copy R2_ENDPOINT_URL,
# R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET_NAME from that
# app's secrets.toml into this app's [r2] section (alongside the
# existing public_base_url key) to enable the "Delete" buttons in Tab 7.
R2_DELETE_ENABLED = False
r2_delete_client = None
R2_DELETE_BUCKET_NAME = None
try:
    r2_delete_secrets = st.secrets["r2"]
    r2_delete_client = boto3.client(
        "s3",
        endpoint_url=r2_delete_secrets["R2_ENDPOINT_URL"],
        aws_access_key_id=r2_delete_secrets["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=r2_delete_secrets["R2_SECRET_ACCESS_KEY"],
        region_name="auto"
    )
    R2_DELETE_BUCKET_NAME = r2_delete_secrets["R2_BUCKET_NAME"]
    R2_DELETE_ENABLED = True
except Exception:
    # Delete credentials aren't configured yet — the "🗑️ Delete" button in
    # Tab 7 will stay hidden rather than erroring, since everything else
    # (viewing files via the public base URL above) keeps working either way.
    pass

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
    return re.sub(r"\s+", " ", str(value)).strip()


def _norm_key(value):
    return _norm_text(value).casefold()


def compute_record_hash(row):
    return record_hash(row)



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
        elif c_low in ['starttime', 'start time'] or (c_low in ['date', 'created_at', 'timestamp'] and not any(str(x).strip().lower() in ['starttime','start time'] for x in df.columns)):
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

    out.loc[out["State_Zone"].eq(""), "State_Zone"] = "Unassigned"
    out.loc[out["Uploaded_By"].eq(""), "Uploaded_By"] = "Unassigned"

    calculated_full = (
        out["FirstName"].fillna("") + " " + out["LastName"].fillna("")
    ).str.replace(r'\s+', ' ', regex=True).str.strip()
    empty_full = out["FullName"].eq("")
    out.loc[empty_full, "FullName"] = calculated_full.loc[empty_full]

    out.loc[out["FullName"].eq(""), "FullName"] = "Unknown Teacher"
    return out


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
        return 0


def safe_percentage(numerator, denominator):
    if denominator is None or denominator <= 0:
        return 0.0
    return float(numerator) / float(denominator) * 100.0


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
    return None, None


def get_teacher_eligible_working_days(teacher_df, period_start, period_end, excluded_dates=None, exclude_sundays=True):
    # Observed activity must never shorten the expected review period.
    return eligible_days(period_start, period_end, excluded_dates or [], exclude_sundays)



def teacher_days_map(roster_df, activity_df, period_start, period_end, excluded_dates=None, exclude_sundays=True):
    result = {}
    for _, row in roster_df[['Institution','FullName']].drop_duplicates().iterrows():
        school = row['Institution']
        holidays = list(excluded_dates or []) + SCHOOL_HOLIDAYS.get(school, [])
        result[(school, row['FullName'])] = eligible_days(period_start, period_end, holidays, exclude_sundays)
    return result



def duration_sum(df, mask=None):
    if df is None or df.empty:
        return 0.0
    work = df if mask is None else df.loc[mask]
    if 'Duration_Min' not in work.columns:
        return 0.0
    vals = pd.to_numeric(work['Duration_Min'], errors='coerce').replace([np.inf, -np.inf], np.nan).fillna(0.0)
    return max(0.0, float(vals.sum()))


def calculate_kpi_target(daily_target, working_days, enabled=True):
    if not enabled:
        return 0.0
    return max(0.0, float(daily_target)) * max(0, int(working_days))


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
    return '❌ No recorded usage (0 Mins)'


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
            c.execute(text('ALTER TABLE classroom_observations ADD COLUMN IF NOT EXISTS evidence_links TEXT;'))
    except Exception:
        pass


def init_teacher_records_hash_column():
    try:
        with conn.engine.begin() as c:
            c.execute(text('ALTER TABLE teacher_records ADD COLUMN IF NOT EXISTS "Record_Hash" TEXT;'))
            c.execute(text('CREATE INDEX IF NOT EXISTS idx_teacher_records_hash ON teacher_records ("Record_Hash");'))
    except Exception:
        pass


def backfill_teacher_records_hash():
    with conn.engine.begin() as c:
        legacy = pd.read_sql(text('SELECT * FROM teacher_records WHERE "Record_Hash" IS NULL'), c)
        if legacy.empty or 'id' not in legacy:
            return 0
        count = 0
        for _, row in legacy.iterrows():
            if str(row.get('Type','')).casefold() == 'classroom reflection' or any(evidence_values(row.get(col)) for col in EVIDENCE_COLUMNS):
                continue
            c.execute(text('UPDATE teacher_records SET "Record_Hash"=:h WHERE id=:id AND "Record_Hash" IS NULL'),
                      {'h': compute_record_hash(row), 'id': int(row['id'])})
            count += 1
        return count



# --- ONE-TIME STARTUP MIGRATIONS ---
# init_observation_db(), init_teacher_records_hash_column() and
# backfill_teacher_records_hash() are idempotent schema/backfill checks, but
# each one is a DB round trip (some doing a full-table scan). Streamlit
# reruns this whole script on EVERY widget interaction, so calling them
# unguarded at module level meant every click, dropdown change, or page
# load paid for a CREATE TABLE check, two ALTER TABLE/CREATE INDEX checks,
# and a "SELECT ... WHERE Record_Hash IS NULL" scan — even when nothing
# needed to change. st.cache_resource makes this run exactly once per app
# server process (shared across all users/sessions) instead of once per
# rerun.
@st.cache_resource(show_spinner=False)
def _run_startup_db_migrations():
    init_observation_db()
    init_teacher_records_hash_column()
    # Schema additions and consultant tables are installed using migration.sql.
    # Hash backfill/cleanup is explicit and excludes evidence submissions.
    return True


_run_startup_db_migrations()


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
        return False


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
        fetch_observation_history.clear()
        return True
    except Exception as e:
        st.error(f"Error updating visit observation in database: {e}")
        return False


@st.cache_data(ttl=60, show_spinner=False)
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
        return pd.DataFrame()


@st.cache_data(ttl=60, show_spinner=False)
def fetch_master_db_from_supabase():
    try:
        with conn.engine.connect() as c:
            raw = pd.read_sql(text('SELECT * FROM teacher_records'), c)
    except Exception as e:
        st.error(f"Cannot read teacher_records: {e}")
        return pd.DataFrame()
    if raw.empty:
        return pd.DataFrame()
    for col in RECORD_COLUMNS:
        if col not in raw:
            raw[col] = None
    raw['Duration_Min'] = pd.to_numeric(raw['Duration_Min'], errors='coerce').fillna(0.0)
    raw = normalize_identity_columns(raw)
    for col in ['Book','Type','Subject','Grade','Section']:
        raw[col] = raw[col].fillna('').astype(str)
    # Keep raw timestamps for exports; add_review_dates normalizes only the review copy.
    return raw



@st.cache_data(ttl=60, show_spinner=False)
def load_crm_data_from_supabase():
    if workflow_ready(conn):
        with conn.engine.connect() as c:
            rows = c.execute(text('SELECT school,entity_type,name,phone FROM portal_contacts')).mappings().all()
        data = {"contacts": {}}
        for row in rows:
            data['contacts'].setdefault(row['school'],{})[row['entity_type']] = {'name':row['name'],'phone':row['phone']}
        return data
    response = supabase.storage.from_(BUCKET_NAME).download(CRM_FILE_NAME)
    return json.loads(response.decode('utf-8')) if response else {"contacts":{}}



def save_crm_data_to_supabase(crm_data, school=None, entity_type=None):
    if not workflow_ready(conn):
        raise RuntimeError('Run migration.sql and migrate legacy CRM before saving contacts.')
    contact = crm_data['contacts'][school][entity_type]
    with conn.engine.begin() as c:
        c.execute(text('INSERT INTO portal_contacts(school,entity_type,name,phone) VALUES (:school,:entity,:name,:phone)\n            ON CONFLICT(school,entity_type) DO UPDATE SET name=EXCLUDED.name,phone=EXCLUDED.phone,updated_at=now()'),
            dict(school=school,entity=entity_type,name=contact.get('name',''),phone=contact.get('phone','')))
    load_crm_data_from_supabase.clear()
    return True



@st.cache_data(ttl=60, show_spinner=False)
def load_call_logs_from_supabase():
    if workflow_ready(conn):
        with conn.engine.connect() as c:
            rows = c.execute(text('SELECT id,payload FROM portal_call_logs WHERE archived_at IS NULL ORDER BY created_at')).mappings().all()
        return [dict((json.loads(r['payload']) if isinstance(r['payload'],str) else r['payload']), _id=r['id']) for r in rows]
    response = supabase.storage.from_(BUCKET_NAME).download(CALL_LOGS_FILE_NAME)
    return json.loads(response.decode('utf-8')) if response else []



def save_call_logs_to_supabase(logs_list):
    if not workflow_ready(conn):
        raise RuntimeError('Run migration.sql and migrate legacy CRM before saving calls.')
    with conn.engine.begin() as c:
        for item in logs_list:
            if not item.get('_id'):
                item['_id'] = str(uuid.uuid4())
            c.execute(text('INSERT INTO portal_call_logs(id,school,payload) VALUES (:id,:school,CAST(:payload AS jsonb)) ON CONFLICT(id) DO NOTHING'),
                      dict(id=item['_id'],school=item['School'],payload=json.dumps(item,default=str)))
    load_call_logs_from_supabase.clear()
    return True


def archive_school_calls(school):
    if not DESTRUCTIVE_ENABLED:
        raise PermissionError('Protected maintenance access required.')
    with conn.engine.begin() as c:
        c.execute(text('UPDATE portal_call_logs SET archived_at=now() WHERE school=:school AND archived_at IS NULL'), {'school':school})
    load_call_logs_from_supabase.clear()
    st.session_state['crm_call_logs_store'] = load_call_logs_from_supabase()


def migrate_legacy_crm():
    # Explicit, idempotent import. Original JSON files remain untouched.
    legacy_contacts = {}
    legacy_calls = []
    failures = []
    for filename, kind in [(CRM_FILE_NAME,'contacts'),(CALL_LOGS_FILE_NAME,'calls')]:
        try:
            raw = supabase.storage.from_(BUCKET_NAME).download(filename)
            payload = json.loads(raw.decode('utf-8'))
            if kind == 'contacts': legacy_contacts = payload.get('contacts',{})
            else: legacy_calls = payload
        except Exception as e:
            failures.append(f'{filename}: {e}')
    if failures:
        raise RuntimeError('Could not read every legacy CRM file; nothing imported. ' + '; '.join(failures))
    contacts_inserted = calls_inserted = 0
    with conn.engine.begin() as c:
        for school, entities in legacy_contacts.items():
            for entity, contact in entities.items():
                result = c.execute(text('INSERT INTO portal_contacts(school,entity_type,name,phone) VALUES (:school,:entity,:name,:phone) ON CONFLICT DO NOTHING'),
                          dict(school=school,entity=entity,name=contact.get('name',''),phone=contact.get('phone','')))
                contacts_inserted += result.rowcount
        for index, item in enumerate(legacy_calls):
            # Index retains intentional identical historical entries; source stays immutable.
            identifier = 'legacy:' + hashlib.sha256((str(index)+json.dumps(item,sort_keys=True)).encode()).hexdigest()
            result = c.execute(text('INSERT INTO portal_call_logs(id,school,payload) VALUES (:id,:school,CAST(:payload AS jsonb)) ON CONFLICT DO NOTHING'),
                      dict(id=identifier,school=item.get('School',''),payload=json.dumps(item)))
            calls_inserted += result.rowcount
    load_crm_data_from_supabase.clear(); load_call_logs_from_supabase.clear()
    st.session_state.pop('crm_global_data',None); st.session_state.pop('crm_call_logs_store',None)
    return contacts_inserted, calls_inserted


def crm_school_metrics(tab_name, school):
    # Recompute from the recipient's school and the current tab scope.
    if tab_name == 'Lesson Plan Prep Tracker':
        data = tab1_active_df; roster = tab1_active_roster; metric = 'prep'; daily = daily_ld_target_t1
    elif tab_name == 'Library Usage Tracker':
        data = tab2_active_df; roster = tab2_active_roster; metric = 'library'; daily = daily_lib_target_t2
    else:
        data = t3_df; roster = t3_roster; metric = 'content'; daily = daily_content_target_t3
    data = data[data.Institution.eq(school)]
    roster = roster[roster.Institution.eq(school)]
    mask = usage_masks(data)[{'prep':0,'library':1,'content':2}[metric]]
    totals = data[mask].groupby('FullName').Duration_Min.sum().to_dict()
    lines = []
    for teacher in roster.FullName.unique():
        days = teacher_days.get((school,teacher),selected_num_days) if use_teacher_eligible_days else selected_num_days
        minutes = totals.get(teacher,0)
        target = daily * days
        status = calculate_kpi_status(minutes,target,daily>0,days==0)
        lines.append(f'{teacher}: {minutes:.1f} recorded minutes; {days} eligible days; {status}')
    return '\n'.join(lines) if lines else 'No teachers in the active filter for this school.'



def upload_pdf_to_supabase(pdf_buffer, school_name, subfolder="reports", file_suffix="_Comprehensive_Audit"):
    try:
        clean_name = re.sub(r'[^a-zA-Z0-9_-]', '_', school_name)
        remote_path = f"{subfolder}/{clean_name}/{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')}_{uuid.uuid4().hex[:10]}{file_suffix}.pdf"
        
        supabase.storage.from_(BUCKET_NAME).upload(
            path=remote_path,
            file=pdf_buffer.getvalue(),
            file_options={"upsert": "true", "content-type": "application/pdf"}
        )
        public_url = f"{SUPABASE_URL}/storage/v1/object/public/{BUCKET_NAME}/{remote_path}"
        return public_url
    except Exception:
        return None


def upload_generic_file_to_supabase(file_obj, filename, subfolder="visit_evidences"):
    try:
        clean_filename = re.sub(r'[^a-zA-Z0-9_.-]', '_', filename)
        remote_path = f"{subfolder}/{uuid.uuid4().hex}_{clean_filename}"
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

    return candidate.reset_index(drop=True)



# --- PERSISTENT GEMINI API USAGE TRACKER ---
AI_USAGE_TZ = ZoneInfo("Asia/Kolkata")
AI_USAGE_PREFIX = "ai_usage"


def _ai_usage_day():
    return datetime.now(AI_USAGE_TZ).strftime("%Y-%m-%d")


def log_ai_usage(action, model, status, error_text=""):
    """Persist one record per actual Gemini API attempt in Supabase Storage.

    This deliberately uses a separate ai_usage/ folder in the existing bucket,
    so it does not modify teacher/school data or require a database migration.
    Tracking failures never interrupt the main application.
    """
    try:
        now = datetime.now(AI_USAGE_TZ)
        safe_action = re.sub(r"[^a-zA-Z0-9_-]", "_", str(action))[:40] or "unknown"
        safe_status = re.sub(r"[^a-zA-Z0-9_-]", "_", str(status))[:20] or "unknown"
        remote_path = (
            f"{AI_USAGE_PREFIX}/{now.strftime('%Y-%m-%d')}/"
            f"{now.strftime('%H%M%S%f')}__{safe_action}__{safe_status}__{uuid.uuid4().hex[:8]}.json"
        )
        payload = {
            "timestamp_ist": now.isoformat(),
            "action": str(action),
            "model": str(model),
            "status": str(status),
            "error": str(error_text)[:1000],
        }
        supabase.storage.from_(BUCKET_NAME).upload(
            path=remote_path,
            file=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            file_options={"upsert": "false", "content-type": "application/json"},
        )
        get_ai_usage_today.clear()
    except Exception:
        # Usage tracking must never break AI generation or the rest of the app.
        pass


@st.cache_data(ttl=10, show_spinner=False)
def get_ai_usage_today(day_str=None):
    """Return today's app-side Gemini attempt counts from Supabase Storage."""
    day_str = day_str or _ai_usage_day()
    counts = {"total": 0, "success": 0, "failed": 0, "quota": 0, "temporary": 0}
    try:
        items = supabase.storage.from_(BUCKET_NAME).list(
            f"{AI_USAGE_PREFIX}/{day_str}", {"limit": 1000}
        ) or []
        for item in items:
            name = str(item.get("name", "")) if isinstance(item, dict) else str(item)
            if not name.endswith(".json"):
                continue
            counts["total"] += 1
            parts = name.split("__")
            status = parts[2] if len(parts) >= 4 else ""
            if status in counts:
                counts[status] += 1
            elif status:
                counts["failed"] += 1
        return counts, None
    except Exception as e:
        return counts, str(e)


def render_ai_usage_panel():
    counts, usage_err = get_ai_usage_today()
    st.markdown("##### 🤖 Gemini API Usage — Today")
    c1, c2, c3, c4 = st.columns(4)
    c1.metric("Total API Attempts", counts["total"])
    c2.metric("Successful", counts["success"])
    c3.metric("Failed / Temporary", counts["failed"] + counts["temporary"])
    c4.metric("Quota Exhausted", counts["quota"])
    st.caption(
        f"App-side usage log for {_ai_usage_day()} (IST). Each actual call to Gemini is counted, including retries."
    )
    if usage_err:
        st.caption("Usage tracker is currently unavailable; AI generation itself can still work normally.")


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

    models_to_try = [str(st.secrets.get("gemini", {}).get("model", "gemini-3.6-flash"))]
    for m in models_to_try:
        try:
            response = ai_client.models.generate_content(
                model=m,
                contents=contents_payload
            )
            log_ai_usage("summary", m, "success")
            return response.text
        except errors.APIError as e:
            err_text = str(e).lower()
            if getattr(e, "code", None) == 429 and (
                "quota exceeded" in err_text
                or "resource_exhausted" in err_text
                or "perday" in err_text
                or "free_tier_requests" in err_text
            ):
                log_ai_usage("summary", m, "quota", str(e))
                return (
                    "⚠️ Gemini daily API quota is exhausted for this project/model. "
                    "The rest of the app remains available. AI generation will resume "
                    "after the quota resets or when a key/project with available quota is configured."
                )
            log_ai_usage("summary", m, "temporary", str(e))
            time.sleep(1)
            continue
        except Exception as e:
            log_ai_usage("summary", m, "failed", str(e))
            time.sleep(1)
            continue
            
    return "AI Generation Notice: Service temporarily busy. Please retry shortly."


# --- STRUCTURED OBSERVATION AI HELPER ---
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
    4. For all 12 rubric categories, include an entry in 'rubrics' with the exact category name, assigned grade ('A', 'B', 'C', or 'NA'), and a 1-sentence specific observation remark. If a category was not observed, assign 'NA' and explicitly state 'Not observed'. Never invent evidence, student responses or lesson events. Distinguish suggested actions from observed facts.
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

    candidate_models = [str(st.secrets.get("gemini", {}).get("model", "gemini-3.6-flash"))]
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
                log_ai_usage("observation", model_name, "success")
                return json.loads(response.text), None
            except errors.APIError as e:
                last_exception = e
                err_text = str(e).lower()
                err_code = getattr(e, "code", None)

                # A daily/project quota exhaustion will not recover by retrying
                # a few seconds later. Stop immediately and show a useful message.
                quota_exhausted = (
                    err_code == 429
                    and (
                        "quota exceeded" in err_text
                        or "resource_exhausted" in err_text
                        or "perday" in err_text
                        or "free_tier_requests" in err_text
                    )
                )
                if quota_exhausted:
                    log_ai_usage("observation", model_name, "quota", str(e))
                    return None, (
                        "Gemini daily API quota has been exhausted for the configured "
                        f"model ({model_name}). The rest of the admin app is still usable. "
                        "AI generation will work again when Google resets the quota, or "
                        "after you use an API project/key with available quota or billing."
                    )

                # Retry genuinely temporary rate-limit or service-availability errors.
                if err_code in [429, 503] or "503" in err_text:
                    log_ai_usage("observation", model_name, "temporary", str(e))
                    time.sleep(2 ** attempt)
                    continue
                log_ai_usage("observation", model_name, "failed", str(e))
                break
            except Exception as e:
                last_exception = e
                log_ai_usage("observation", model_name, "failed", str(e))
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

    title_style = ParagraphStyle('ObsTitle', parent=styles['Heading1'], fontSize=12, leading=15, textColor=header_blue, fontName='PortalSans-Bold')
    sub_title = ParagraphStyle('ObsSub', parent=styles['Normal'], fontSize=8, leading=11, textColor=dark_neutral)
    cell_bold = ParagraphStyle('CellB', parent=styles['Normal'], fontSize=7.5, leading=10, textColor=dark_neutral, fontName='PortalSans-Bold')
    cell_norm = ParagraphStyle('CellN', parent=styles['Normal'], fontSize=6.5, leading=8.5, textColor=dark_neutral)
    header_style = ParagraphStyle('HeadS', parent=styles['Normal'], fontSize=7.5, leading=10, textColor=colors.white, fontName='PortalSans-Bold', alignment=1)
    sec_head = ParagraphStyle('SecH', parent=styles['Heading2'], fontSize=9, leading=12, textColor=header_blue, fontName='PortalSans-Bold', spaceBefore=8, spaceAfter=4)
    narrative_p = ParagraphStyle('NarrP', parent=styles['Normal'], fontSize=7.5, leading=10.5, textColor=dark_neutral)
    link_p = ParagraphStyle('LinkP', parent=styles['Normal'], fontSize=7.5, leading=10.5, textColor=colors.HexColor('#0284C7'))

    story.append(Paragraph(f"<b>OneLern Classroom Observation :- {metadata.get('School', 'N/A')}</b>", title_style))
    story.append(Spacer(1, 4))
    story.append(HRFlowable(width="100%", thickness=1.5, color=header_blue, spaceAfter=8))

    meta_data = [
        [Paragraph("<b>Name of the Teacher</b>", cell_bold), Paragraph(escape(metadata.get("Teacher", "")), sub_title), Paragraph("<b>Date</b>", cell_bold), Paragraph(str(metadata.get("Date", "")), sub_title)],
        [Paragraph("<b>Class and section</b>", cell_bold), Paragraph(metadata.get("Class", ""), sub_title), Paragraph("<b>Total Duration of Observation</b>", cell_bold), Paragraph(metadata.get("Duration", ""), sub_title)],
        [Paragraph("<b>Subject</b>", cell_bold), Paragraph(metadata.get("Subject", ""), sub_title), Paragraph("<b>Total Students Present</b>", cell_bold), Paragraph(str(metadata.get("Students", "")), sub_title)],
        [Paragraph("<b>Topic</b>", cell_bold), Paragraph(metadata.get("Topic", ""), sub_title), Paragraph("<b>Print displayed in class</b>", cell_bold), Paragraph(metadata.get("PrintDisplay", "Yes"), sub_title)],
        [Paragraph("<b>Academic Mentor</b>", cell_bold), Paragraph(metadata.get("Mentor", "Harshit Bhargava"), sub_title), Paragraph("", sub_title), Paragraph("", sub_title)]
    ]
    meta_table = Table(meta_data, colWidths=[100, 182, 120, 162])
    meta_table.setStyle(TableStyle([
        ('GRID', (0, 0), (-1, -1), 0.5, border_color),
        ('BACKGROUND', (0, 0), (0, -1), light_bg),
        ('BACKGROUND', (2, 0), (2, -1), light_bg),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
    ]))
    story.append(meta_table)
    story.append(Spacer(1, 8))

    rubric_rows = [[
        Paragraph("Category", header_style),
        Paragraph("A", header_style),
        Paragraph("B", header_style),
        Paragraph("C", header_style),
        Paragraph("A/B/C", header_style),
        Paragraph("Remarks", header_style)
    ]]

    custom_table_styles = [
        ('BACKGROUND', (0, 0), (-1, 0), header_blue),
        ('GRID', (0, 0), (-1, -1), 0.4, border_color),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
    ]

    col_map = {"A": 1, "B": 2, "C": 3}

    for idx, (cat_name, desc_dict) in enumerate(OBSERVATION_RUBRIC_CONFIG.items(), start=1):
        res = rubric_scores.get(cat_name, {"Grade": "NA", "Remarks": ""})
        awarded_grade = res.get("Grade", "NA")

        rubric_rows.append([
            Paragraph(cat_name, cell_bold),
            Paragraph(desc_dict.get("A", ""), cell_norm),
            Paragraph(desc_dict.get("B", ""), cell_norm),
            Paragraph(desc_dict.get("C", ""), cell_norm),
            Paragraph(f"<b>{awarded_grade}</b>", ParagraphStyle('Ctr', parent=cell_bold, alignment=1)),
            Paragraph(escape(res.get("Remarks", "")), cell_norm)
        ])

        base_bg = colors.white if idx % 2 != 0 else light_bg
        custom_table_styles.append(('BACKGROUND', (0, idx), (-1, idx), base_bg))

        if awarded_grade in col_map:
            target_col = col_map[awarded_grade]
            custom_table_styles.append(('BACKGROUND', (target_col, idx), (target_col, idx), highlight_yellow))
            custom_table_styles.append(('BACKGROUND', (4, idx), (4, idx), highlight_yellow))

    rubric_table = Table(rubric_rows, colWidths=[80, 130, 130, 110, 34, 80], repeatRows=1)
    rubric_table.setStyle(TableStyle(custom_table_styles))
    story.append(rubric_table)
    story.append(Spacer(1, 10))

    story.append(Paragraph("<b>Flow of the class</b>", sec_head))
    story.append(HRFlowable(width="100%", thickness=0.5, color=border_color, spaceAfter=4))
    story.append(Paragraph(escape(narratives.get("Flow", "N/A")).replace('\n', '<br/>'), narrative_p))
    story.append(Spacer(1, 8))

    story.append(Paragraph("<b>High Points of the class</b>", sec_head))
    story.append(HRFlowable(width="100%", thickness=0.5, color=border_color, spaceAfter=4))
    story.append(Paragraph(escape(narratives.get("HighPoints", "N/A")).replace('\n', '<br/>'), narrative_p))
    story.append(Spacer(1, 8))

    story.append(Paragraph("<b>Recommendations by the Academic Mentor</b>", sec_head))
    story.append(HRFlowable(width="100%", thickness=0.5, color=border_color, spaceAfter=4))
    story.append(Paragraph(escape(narratives.get("Recommendations", "N/A")).replace('\n', '<br/>'), narrative_p))

    if evidence_urls:
        story.append(Spacer(1, 8))
        story.append(Paragraph("<b>Classroom Activity Evidences & Visual Records</b>", sec_head))
        story.append(HRFlowable(width="100%", thickness=0.5, color=border_color, spaceAfter=4))
        for i, u in enumerate(evidence_urls, 1):
            story.append(Paragraph(f"• 📷 <a href='{u}'><u>Click to View Classroom Activity Evidence #{i}</u></a>", link_p))

    doc.build(story)
    buffer.seek(0)
    return buffer


def render_school_audit_crm_box(tab_name, active_school, current_filter_description, school_audit_whatsapp_message):
    st.markdown("---")
    st.subheader(f"📞 School & Coordinator CRM, Call Notes & WhatsApp Generators ({tab_name})")
    
    if "crm_global_data" not in st.session_state:
        try:
            st.session_state["crm_global_data"] = load_crm_data_from_supabase()
        except Exception as e:
            st.warning(f"CRM could not be loaded: {e}")
            return

    if "crm_call_logs_store" not in st.session_state:
        try:
            st.session_state["crm_call_logs_store"] = load_call_logs_from_supabase()
        except Exception as e:
            st.warning(f"Call history could not be loaded: {e}")
            return

    crm_data = st.session_state["crm_global_data"]
    if "contacts" not in crm_data:
        crm_data["contacts"] = {}

    target_crm_school = active_school

    c_col1, c_col2 = st.columns([1, 2])
    with c_col1:
        st.write(f"🏫 **Target School:** `{target_crm_school}`")
        
        if target_crm_school not in crm_data["contacts"]:
            crm_data["contacts"][target_crm_school] = {
                "Principal": {"name": "", "phone": ""},
                "Owner": {"name": "", "phone": ""},
                "Coordinator": {"name": "", "phone": ""}
            }

        st.markdown("##### 👥 Select Entity & Contact Details")
        selected_entity_type = st.selectbox("Target Entity Type:", options=["Principal", "Owner", "Coordinator"], key=f"entity_type_{tab_name}_{target_crm_school}")
        
        current_entity_data = crm_data["contacts"][target_crm_school].get(selected_entity_type, {"name": "", "phone": ""})
        
        input_contact_name = st.text_input(f"{selected_entity_type} Name:", value=current_entity_data.get("name", ""), key=f"cname_{tab_name}_{target_crm_school}_{selected_entity_type}")
        input_phone = st.text_input(f"{selected_entity_type} Mobile (+91...):", value=current_entity_data.get("phone", ""), key=f"cphone_{tab_name}_{target_crm_school}_{selected_entity_type}")

        if st.button(f"💾 Save {selected_entity_type} Contact to Supabase", key=f"save_contact_btn_{tab_name}_{target_crm_school}_{selected_entity_type}"):
            crm_data["contacts"][target_crm_school][selected_entity_type] = {
                "name": input_contact_name,
                "phone": input_phone
            }
            save_crm_data_to_supabase(crm_data, target_crm_school, selected_entity_type)
            st.success(f"Successfully saved {selected_entity_type} details for {target_crm_school} to Supabase!")

        active_phone = input_phone.strip()
        if active_phone:
            clean_phone = re.sub(r'[^0-9+]', '', active_phone)
            contact_greeting = input_contact_name if input_contact_name else selected_entity_type
            quick_wa = urllib.parse.quote(f"Namaste {contact_greeting} ji, checking in from Onelearn Academic Team regarding school audit metrics for {target_crm_school} - {current_filter_description}.")
            st.markdown(f'<a href="tel:{active_phone}" target="_blank" style="text-decoration:none;"><button style="background-color:#2CA02C;color:white;padding:8px 14px;border:none;border-radius:4px;cursor:pointer;font-weight:bold;margin-bottom:6px;width:100%;">📞 Call {selected_entity_type}</button></a>', unsafe_allow_html=True)
            st.markdown(f'<a href="https://wa.me/{clean_phone}?text={quick_wa}" target="_blank" style="text-decoration:none;"><button style="background-color:#25D366;color:white;padding:8px 14px;border:none;border-radius:4px;cursor:pointer;font-weight:bold;width:100%;">📱 Quick WhatsApp Message</button></a>', unsafe_allow_html=True)
        else:
            st.warning(f"Please enter and save a mobile number for the selected {selected_entity_type}.")

    with c_col2:
        st.markdown("##### 💬 WhatsApp & Calling Generators (Indian Context)")
        
        custom_tone = st.selectbox("Select Message Tone:", ["Encouraging & Supportive", "Constructive & Corrective", "Executive Summary"], key=f"tone_{tab_name}_{target_crm_school}")
        
        with st.expander("✨ AI-Driven Calling Script & Smart Message Generator (Voice & Text)"):
            manager_voice_audio = st.audio_input(
                "🎙️ Record Voice Instructions (Speak your custom prompt):",
                key=f"voice_input_{tab_name}_{target_crm_school}"
            )
            user_custom_instruction = st.text_area(
                "Or Type Custom Instructions (Alternative to voice):",
                placeholder="e.g., Focus heavily on improving content book delivery and phonics submissions...",
                key=f"ai_custom_prompt_{tab_name}_{target_crm_school}"
            )
            
            if st.button("Generate AI Script & Message", key=f"gen_ai_both_{tab_name}_{target_crm_school}"):
                if not ai_client:
                    st.error("Gemini API client is not initialized.")
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
                    """
                    with st.spinner("Processing voice/text instructions with Gemini..."):
                        try:
                            ai_result = get_gemini_summary(ai_prompt, audio_file_obj=manager_voice_audio)
                            st.session_state[f"ai_gen_output_{tab_name}_{target_crm_school}"] = ai_result
                        except Exception as e:
                            st.error(f"Error generating AI content: {e}")
            
            if f"ai_gen_output_{tab_name}_{target_crm_school}" in st.session_state:
                st.markdown(st.session_state[f"ai_gen_output_{tab_name}_{target_crm_school}"])

        st.markdown("##### 📝 Quick WhatsApp Message Draft (Full School Audit)")
        draft_state_key = f"wa_draft_text_{tab_name}_{target_crm_school}_{selected_entity_type}"
        sync_track_key = f"last_raw_msg_{tab_name}_{target_crm_school}_{selected_entity_type}"
        
        if draft_state_key not in st.session_state or st.session_state.get(sync_track_key) != school_audit_whatsapp_message:
            st.session_state[draft_state_key] = school_audit_whatsapp_message
            st.session_state[sync_track_key] = school_audit_whatsapp_message
            st.session_state.pop(f"wa_textarea_{tab_name}_{target_crm_school}_{selected_entity_type}",None)

        editable_wa_area = st.text_area(
            "Confirm or Edit Final WhatsApp Message Draft:",
            value=st.session_state[draft_state_key],
            height=220,
            key=f"wa_textarea_{tab_name}_{target_crm_school}_{selected_entity_type}"
        )
        st.session_state[draft_state_key] = editable_wa_area

        if active_phone:
            clean_phone = re.sub(r'[^0-9+]', '', active_phone)
            encoded_final_text = urllib.parse.quote(editable_wa_area)
            st.markdown(f'<a href="https://wa.me/{clean_phone}?text={encoded_final_text}" target="_blank" style="text-decoration:none;"><button style="background-color:#25D366;color:white;padding:10px 18px;border:none;border-radius:4px;cursor:pointer;font-weight:bold;width:100%;">Open WhatsApp Draft</button></a>', unsafe_allow_html=True)

    st.markdown("---")
    st.markdown(f"##### 📝 Post-Call Discussion Notes & Follow-up Scheduler ({target_crm_school} - {selected_entity_type})")
    
    with st.form(key=f"call_log_form_{tab_name}_{target_crm_school}_{selected_entity_type}"):
        col_f1, col_f2 = st.columns(2)
        with col_f1:
            call_date_punched = st.date_input("Call Conducted Date:", value=pd.Timestamp.now().date(), key=f"cdate_{tab_name}_{target_crm_school}")
        with col_f2:
            next_followup_date = st.date_input("Next Scheduled Follow-up Date:", value=pd.Timestamp.now().date() + pd.Timedelta(days=7), key=f"fdate_{tab_name}_{target_crm_school}")
            
        discussion_notes = st.text_area("Discussion Summary / Notes from Call:", placeholder="Punch key talking points, agreed commitments, and action items...", key=f"dnotes_{tab_name}_{target_crm_school}")
        call_status_opt = st.selectbox("Call Status / Resolution:", options=["Open Action Item", "In Progress", "Successfully Resolved"], key=f"cstat_{tab_name}_{target_crm_school}")
        
        submit_call_log = st.form_submit_button("💾 Save Call Note & Sync to Supabase Cloud")
        
        if submit_call_log:
            if discussion_notes.strip():
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
                }
                st.session_state["crm_call_logs_store"].append(new_log_entry)
                save_call_logs_to_supabase(st.session_state["crm_call_logs_store"])
                st.success("✅ Call notes and follow-up schedule successfully saved and synced to Supabase Cloud!")
            else:
                st.warning("Please enter discussion notes before saving.")

    if st.session_state["crm_call_logs_store"]:
        st.markdown(f"##### 📊 Filterable Call Discussion Logs & Audit Trail for {target_crm_school}")
        logs_df = pd.DataFrame(st.session_state["crm_call_logs_store"])
        
        if 'School' in logs_df.columns:
            logs_df = logs_df[logs_df['School'] == target_crm_school]

        if not logs_df.empty:
            desired_cols = ['School', 'Entity Type', 'Contact Name', 'Module Tab', 'Filter Window', 'Call Date', 'Discussion Notes', 'Next Follow-up Date', 'Status']
            available_log_cols = [c for c in desired_cols if c in logs_df.columns]
            
            st.dataframe(logs_df[available_log_cols], use_container_width=True)
            
            dl_col1, dl_col2 = st.columns(2)
            with dl_col1:
                output_buffer = BytesIO()
                with pd.ExcelWriter(output_buffer, engine='openpyxl') as writer:
                    logs_df[available_log_cols].to_excel(writer, index=False, sheet_name='Call_Discussion_Logs')
                output_buffer.seek(0)
                
                st.download_button(
                    label="📥 Download Filtered Call Logs (Excel)",
                    data=output_buffer,
                    file_name=f"School_CRM_Call_Logs_{target_crm_school.replace(' ', '_')}.xlsx",
                    mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    key=f"dl_excel_{tab_name}_{target_crm_school}"
                )
            with dl_col2:
                if st.button("Archive Call Logs for this School", key=f"clear_logs_btn_{tab_name}_{target_crm_school}", disabled=not DESTRUCTIVE_ENABLED):
                    archive_school_calls(target_crm_school)
                    st.success(f"Successfully archived call logs for {target_crm_school}!")
                    st.rerun()
        else:
            st.info(f"No call discussion logs recorded yet for {target_crm_school}.")


def render_universal_crm_box(tab_name, active_selected_schools, current_filter_description, metrics_summary_text):
    st.markdown("---")
    st.subheader(f"📞 School & Coordinator CRM, Call Notes & WhatsApp Generators ({tab_name})")
    
    if "crm_global_data" not in st.session_state:
        try:
            st.session_state["crm_global_data"] = load_crm_data_from_supabase()
        except Exception as e:
            st.warning(f"CRM could not be loaded: {e}")
            return

    if "crm_call_logs_store" not in st.session_state:
        try:
            st.session_state["crm_call_logs_store"] = load_call_logs_from_supabase()
        except Exception as e:
            st.warning(f"Call history could not be loaded: {e}")
            return

    crm_data = st.session_state["crm_global_data"]
    if "contacts" not in crm_data:
        crm_data["contacts"] = {}

    c_col1, c_col2 = st.columns([1, 2])
    with c_col1:
        if isinstance(active_selected_schools, str):
            schools_list = [active_selected_schools]
        elif isinstance(active_selected_schools, (list, tuple, pd.Series, np.ndarray)):
            schools_list = [str(s) for s in active_selected_schools if str(s).strip()]
        else:
            schools_list = ["Default School"]
            
        if not schools_list:
            schools_list = ["Default School"]

        target_crm_school = st.selectbox("Select School:", options=schools_list, key=f"crm_school_{tab_name}")
        metrics_summary_text = crm_school_metrics(tab_name, target_crm_school)
        
        if target_crm_school not in crm_data["contacts"]:
            crm_data["contacts"][target_crm_school] = {
                "Principal": {"name": "", "phone": ""},
                "Owner": {"name": "", "phone": ""},
                "Coordinator": {"name": "", "phone": ""}
            }

        st.markdown("##### 👥 Select Entity & Contact Details")
        selected_entity_type = st.selectbox("Target Entity Type:", options=["Principal", "Owner", "Coordinator"], key=f"entity_type_{tab_name}_{target_crm_school}")
        
        current_entity_data = crm_data["contacts"][target_crm_school].get(selected_entity_type, {"name": "", "phone": ""})
        
        input_contact_name = st.text_input(f"{selected_entity_type} Name:", value=current_entity_data.get("name", ""), key=f"cname_{tab_name}_{target_crm_school}_{selected_entity_type}")
        input_phone = st.text_input(f"{selected_entity_type} Mobile (+91...):", value=current_entity_data.get("phone", ""), key=f"cphone_{tab_name}_{target_crm_school}_{selected_entity_type}")

        if st.button(f"💾 Save {selected_entity_type} Contact to Supabase", key=f"save_contact_btn_{tab_name}_{target_crm_school}_{selected_entity_type}"):
            crm_data["contacts"][target_crm_school][selected_entity_type] = {
                "name": input_contact_name,
                "phone": input_phone
            }
            save_crm_data_to_supabase(crm_data, target_crm_school, selected_entity_type)
            st.success(f"Successfully saved {selected_entity_type} details for {target_crm_school} to Supabase!")

        active_phone = input_phone.strip()
        if active_phone:
            clean_phone = re.sub(r'[^0-9+]', '', active_phone)
            contact_greeting = input_contact_name if input_contact_name else selected_entity_type
            quick_wa = urllib.parse.quote(f"Namaste {contact_greeting} ji, checking in from Onelearn Academic Team regarding {tab_name} metrics for {target_crm_school} - {current_filter_description}.")
            st.markdown(f'<a href="tel:{active_phone}" target="_blank" style="text-decoration:none;"><button style="background-color:#2CA02C;color:white;padding:8px 14px;border:none;border-radius:4px;cursor:pointer;font-weight:bold;margin-bottom:6px;width:100%;">📞 Call {selected_entity_type}</button></a>', unsafe_allow_html=True)
            st.markdown(f'<a href="https://wa.me/{clean_phone}?text={quick_wa}" target="_blank" style="text-decoration:none;"><button style="background-color:#25D366;color:white;padding:8px 14px;border:none;border-radius:4px;cursor:pointer;font-weight:bold;width:100%;">📱 Quick WhatsApp Message</button></a>', unsafe_allow_html=True)
        else:
            st.warning(f"Please enter and save a mobile number for the selected {selected_entity_type}.")

    with c_col2:
        st.markdown("##### 💬 WhatsApp & Calling Generators (Indian Context)")
        custom_tone = st.selectbox("Select Message Tone:", ["Encouraging & Supportive", "Constructive & Corrective", "Executive Summary"], key=f"tone_{tab_name}_{target_crm_school}")
        
        with st.expander("✨ AI-Driven Calling Script & Smart Message Generator (Voice & Text)"):
            manager_voice_audio = st.audio_input("🎙️ Record Voice Instructions:", key=f"voice_input_{tab_name}_{target_crm_school}")
            user_custom_instruction = st.text_area("Or Type Custom Instructions:", placeholder="e.g., Focus heavily on improving classroom book engagement...", key=f"ai_custom_prompt_{tab_name}_{target_crm_school}")
            
            if st.button("Generate AI Script & Message", key=f"gen_ai_both_{tab_name}_{target_crm_school}"):
                if not ai_client:
                    st.error("Gemini API client is not initialized.")
                else:
                    ai_prompt = f"""
                    You are an expert Academic Consultant. 
                    Based on these filtered metrics for {tab_name} at {target_crm_school} ({current_filter_description}):
                    Metrics & Breakdown: {metrics_summary_text}
                    Target Entity: {selected_entity_type} named {input_contact_name or 'Sir/Madam'}
                    Tone: {custom_tone}
                    User instructions: {user_custom_instruction}
                    Do not invent metrics or imply the message has already been sent.
                    Generate two outputs: 1. Calling Script, 2. AI WhatsApp Follow-up Message. Sign off with 'Onelearn Academic Team'.
                    """
                    with st.spinner("Processing with Gemini..."):
                        try:
                            ai_result = get_gemini_summary(ai_prompt, audio_file_obj=manager_voice_audio)
                            st.session_state[f"ai_gen_output_{tab_name}_{target_crm_school}"] = ai_result
                        except Exception as e:
                            st.error(f"Error generating AI content: {e}")
            
            if f"ai_gen_output_{tab_name}_{target_crm_school}" in st.session_state:
                st.markdown(st.session_state[f"ai_gen_output_{tab_name}_{target_crm_school}"])

        st.markdown("##### 📝 Quick WhatsApp Message Draft (Standard Template)")
        draft_state_key = f"wa_draft_text_{tab_name}_{target_crm_school}_{selected_entity_type}"
        name_prefix = f" {input_contact_name}" if input_contact_name and input_contact_name.strip() else ""
        
        default_template_string = (
            f"Dear {name_prefix} ji,\n\n"
            f"Here is the performance update for {target_crm_school} - {current_filter_description}:\n\n"
            f"📊 *Module:* {tab_name}\n"
            f"{metrics_summary_text}\n\n"
            f"Regards,\n"
            f"Harshit Bhargava,\n"
            f"OneLearn Academic Team"
        )

        sync_track_key = f"last_raw_template_{tab_name}_{target_crm_school}_{selected_entity_type}"
        if draft_state_key not in st.session_state or st.session_state.get(sync_track_key) != default_template_string:
            st.session_state[draft_state_key] = default_template_string
            st.session_state[sync_track_key] = default_template_string
            st.session_state.pop(f"wa_textarea_{tab_name}_{target_crm_school}_{selected_entity_type}",None)

        editable_wa_area = st.text_area(
            "Confirm or Edit Final WhatsApp Message Draft:",
            value=st.session_state[draft_state_key],
            height=140,
            key=f"wa_textarea_{tab_name}_{target_crm_school}_{selected_entity_type}"
        )
        st.session_state[draft_state_key] = editable_wa_area

        if active_phone:
            clean_phone = re.sub(r'[^0-9+]', '', active_phone)
            encoded_final_text = urllib.parse.quote(editable_wa_area)
            st.markdown(f'<a href="https://wa.me/{clean_phone}?text={encoded_final_text}" target="_blank" style="text-decoration:none;"><button style="background-color:#25D366;color:white;padding:10px 18px;border:none;border-radius:4px;cursor:pointer;font-weight:bold;width:100%;">Open WhatsApp Draft</button></a>', unsafe_allow_html=True)

    st.markdown("---")
    st.markdown(f"##### 📝 Post-Call Discussion Notes & Follow-up Scheduler ({target_crm_school} - {selected_entity_type})")
    
    with st.form(key=f"call_log_form_{tab_name}_{target_crm_school}_{selected_entity_type}"):
        col_f1, col_f2 = st.columns(2)
        with col_f1:
            call_date_punched = st.date_input("Call Conducted Date:", value=pd.Timestamp.now().date(), key=f"cdate_{tab_name}_{target_crm_school}")
        with col_f2:
            next_followup_date = st.date_input("Next Scheduled Follow-up Date:", value=pd.Timestamp.now().date() + pd.Timedelta(days=7), key=f"fdate_{tab_name}_{target_crm_school}")
            
        discussion_notes = st.text_area("Discussion Summary / Notes from Call:", placeholder="Punch key talking points, agreed commitments, and action items...", key=f"dnotes_{tab_name}_{target_crm_school}")
        call_status_opt = st.selectbox("Call Status / Resolution:", options=["Open Action Item", "In Progress", "Successfully Resolved"], key=f"cstat_{tab_name}_{target_crm_school}")
        
        submit_call_log = st.form_submit_button("💾 Save Call Note & Sync to Supabase Cloud")
        
        if submit_call_log:
            if discussion_notes.strip():
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
                }
                st.session_state["crm_call_logs_store"].append(new_log_entry)
                save_call_logs_to_supabase(st.session_state["crm_call_logs_store"])
                st.success("✅ Call notes and follow-up schedule successfully saved and synced to Supabase Cloud!")
            else:
                st.warning("Please enter discussion notes before saving.")

    if st.session_state["crm_call_logs_store"]:
        st.markdown(f"##### 📊 Filterable Call Discussion Logs & Audit Trail for {target_crm_school}")
        logs_df = pd.DataFrame(st.session_state["crm_call_logs_store"])
        
        if 'School' in logs_df.columns:
            logs_df = logs_df[logs_df['School'] == target_crm_school]

        if not logs_df.empty:
            desired_cols = ['School', 'Entity Type', 'Contact Name', 'Module Tab', 'Filter Window', 'Call Date', 'Discussion Notes', 'Next Follow-up Date', 'Status']
            available_log_cols = [c for c in desired_cols if c in logs_df.columns]
            
            st.dataframe(logs_df[available_log_cols], use_container_width=True)
            
            dl_col1, dl_col2 = st.columns(2)
            with dl_col1:
                output_buffer = BytesIO()
                with pd.ExcelWriter(output_buffer, engine='openpyxl') as writer:
                    logs_df[available_log_cols].to_excel(writer, index=False, sheet_name='Call_Discussion_Logs')
                output_buffer.seek(0)
                
                st.download_button(
                    label="📥 Download Filtered Call Logs (Excel)",
                    data=output_buffer,
                    file_name=f"School_CRM_Call_Logs_{target_crm_school.replace(' ', '_')}.xlsx",
                    mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    key=f"dl_excel_{tab_name}_{target_crm_school}"
                )
            with dl_col2:
                if st.button("Archive Call Logs for this School", key=f"clear_logs_btn_{tab_name}_{target_crm_school}", disabled=not DESTRUCTIVE_ENABLED):
                    archive_school_calls(target_crm_school)
                    st.success(f"Successfully archived call logs for {target_crm_school}!")
                    st.rerun()
        else:
            st.info(f"No call discussion logs recorded yet for {target_crm_school}.")


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

    title_style = ParagraphStyle('DocTitle', parent=styles['Heading1'], fontSize=16, leading=20, textColor=primary_color, fontName='PortalSans-Bold')
    subtitle_style = ParagraphStyle('DocSubTitle', parent=styles['Normal'], fontSize=9, leading=13, textColor=dark_neutral)
    school_style = ParagraphStyle('SchoolHead', parent=styles['Normal'], fontSize=10, leading=14, textColor=accent_color, fontName='PortalSans-Bold')
    sec_head_style = ParagraphStyle('SecHead', parent=styles['Heading2'], fontSize=11, leading=15, textColor=primary_color, fontName='PortalSans-Bold', spaceBefore=12, spaceAfter=5)
    normal_style = ParagraphStyle('Body', parent=styles['Normal'], fontSize=8.5, leading=13, textColor=dark_neutral)
    link_style = ParagraphStyle('LinkStyle', parent=styles['Normal'], fontSize=8, leading=11, textColor=colors.HexColor('#2563EB'), fontName='PortalSans-Bold')
    card_header = ParagraphStyle('CardHead', parent=styles['Normal'], fontSize=7.5, leading=10, textColor=colors.HexColor('#64748B'), fontName='PortalSans-Bold', alignment=1)
    card_value = ParagraphStyle('CardVal', parent=styles['Normal'], fontSize=11, leading=14, textColor=primary_color, fontName='PortalSans-Bold', alignment=1)
    
    story.append(Paragraph(f"<b>{title_text}</b>", title_style))
    story.append(Spacer(1, 4))
    story.append(Paragraph(f"🏫 <b>Institution / School Focus:</b> {school_name}", school_style))
    story.append(Spacer(1, 3))
    story.append(Paragraph(subtitle_text, subtitle_style))
    story.append(Spacer(1, 8))
    story.append(HRFlowable(width="100%", thickness=1.5, color=primary_color, spaceAfter=12))

    if summary_metrics:
        headers_row = [Paragraph(k, card_header) for k in summary_metrics.keys()]
        values_row = [Paragraph(str(v), card_value) for v in summary_metrics.values()]
        col_w = 540 / len(summary_metrics)
        kpi_table = Table([headers_row, values_row], colWidths=[col_w] * len(summary_metrics))
        kpi_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), light_bg),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('GRID', (0, 0), (-1, -1), 0.5, border_color),
            ('TOPPADDING', (0, 0), (-1, -1), 8),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
        ]))
        story.append(kpi_table)
        story.append(Spacer(1, 12))

    if custom_sections:
        for heading, body_items in custom_sections.items():
            story.append(Paragraph(f"<b>{heading}</b>", sec_head_style))
            story.append(HRFlowable(width="100%", thickness=0.5, color=border_color, spaceAfter=6))
            for item in body_items:
                if "<a href=" in item:
                    story.append(Paragraph(f"{item}", link_style))
                else:
                    story.append(Paragraph(f"• {item}", normal_style))
            story.append(Spacer(1, 10))

    if dataframe is not None and not dataframe.empty:
        story.append(Spacer(1, 4))
        raw_data = [dataframe.columns.tolist()] + dataframe.astype(str).values.tolist()
        cell_style = ParagraphStyle('TableCell', parent=styles['Normal'], fontSize=8, leading=12, textColor=dark_neutral)
        header_style = ParagraphStyle('TableHeader', parent=styles['Normal'], fontSize=8.5, leading=12, textColor=colors.white, fontName='PortalSans-Bold')

        formatted_data = []
        for i, row in enumerate(raw_data):
            formatted_row = []
            for cell in row:
                st_to_use = header_style if i == 0 else cell_style
                formatted_row.append(Paragraph(str(cell), st_to_use))
            formatted_data.append(formatted_row)

        num_cols = len(dataframe.columns)
        col_width = 540 / num_cols

        pdf_table = Table(formatted_data, colWidths=[col_width] * num_cols, repeatRows=1)
        pdf_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), primary_color),
            ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('GRID', (0, 0), (-1, -1), 0.4, border_color),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, light_bg]),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
            ('TOPPADDING', (0, 0), (-1, -1), 6),
        ]))
        story.append(pdf_table)

    doc.build(story)
    buffer.seek(0)
    return buffer


# --- R2 EVIDENCE RESOLUTION HELPERS ---
def _is_legacy_http_url(value: str) -> bool:
    return value.strip().lower().startswith(("http://", "https://"))


def split_evidence_raw_value(raw_val: str):
    if raw_val is None:
        return []
    raw_val = str(raw_val).strip()
    if not raw_val or raw_val.lower() in ("nan", "none", "null"):
        return []
    return [v.strip() for v in raw_val.split(",") if v.strip()]


def detect_evidence_file_type(value: str) -> str:
    path_part = urllib.parse.urlparse(value).path if _is_legacy_http_url(value) else value
    ext = os.path.splitext(path_part)[1].lower()
    if ext in (".mp3", ".wav", ".m4a", ".aac", ".ogg", ".opus", ".weba"):
        return "audio"
    if ext in (".mp4", ".mov", ".m4v", ".avi", ".mkv", ".webm"):
        return "video"
    if ext in (".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".heic"):
        return "image"
    if ext == ".pdf":
        return "pdf"
    return "other"


def get_public_evidence_url(object_key: str):
    if not R2_ENABLED or not object_key:
        return None
    encoded_key = urllib.parse.quote(object_key, safe="/")
    return f"{R2_PUBLIC_BASE_URL}/{encoded_key}"


def resolve_evidence_links(raw_value: str):
    resolved = []
    for single_val in split_evidence_raw_value(raw_value):
        if _is_legacy_http_url(single_val):
            resolved.append({
                "source": "legacy_url",
                "object_key": None,
                "url": single_val,
                "file_type": detect_evidence_file_type(single_val),
            })
        else:
            object_key = single_val.lstrip("/")
            resolved.append({
                "source": "r2_key",
                "object_key": object_key,
                "url": get_public_evidence_url(object_key) or "",
                "file_type": detect_evidence_file_type(object_key),
            })
    return resolved


def render_evidence_media_preview(item: dict, widget_key: str):
    display_url = item.get("url")
    file_type = item.get("file_type", "other")
    if not display_url:
        st.caption("⚠️ Evidence file could not be loaded from R2 (missing key or public base URL).")
        return
    try:
        if file_type == "audio":
            st.audio(display_url)
        elif file_type == "video":
            st.video(display_url)
        elif file_type == "image":
            st.image(display_url, use_container_width=True)
        elif file_type == "pdf":
            st.markdown(
                f'<iframe src="{display_url}" width="100%" height="480" '
                f'style="border:1px solid #E2E8F0;border-radius:6px;"></iframe>',
                unsafe_allow_html=True,
            )
        else:
            st.markdown(f"[⬇️ Open / Download File]({display_url})")
    except Exception:
        st.caption("⚠️ Unable to render an inline preview for this file. Use the link to open it directly.")


def extract_evidence_items_vectorized(df_src, col_name):
    if col_name not in df_src.columns or df_src.empty:
        return []

    col_str = df_src[col_name].fillna('').astype(str).str.strip()
    valid_mask = col_str.str.len() > 0
    valid_rows = df_src[valid_mask]

    if valid_rows.empty:
        return []

    items = []
    for _, r in valid_rows.iterrows():
        raw_val = str(r[col_name]).strip()
        resolved_files = resolve_evidence_links(raw_val)
        if not resolved_files:
            continue
        d_str = str(r['Date']) if 'Date' in r and pd.notna(r['Date']) else "Recent"
        g_str = str(r['Grade']) if 'Grade' in r and str(r['Grade']).strip() else "Grade N/A"
        s_str = str(r['Subject']).strip() if 'Subject' in r and str(r['Subject']).strip() else "General Subject"
        b_str = str(r['Book']).strip() if 'Book' in r and str(r['Book']).strip() else "Lesson Plan"
        for f in resolved_files:
            items.append({
                'url': f['url'],
                'file_type': f['file_type'],
                'object_key': f['object_key'],
                'source': f['source'],
                'date': d_str, 'grade': g_str, 'subject': s_str, 'lesson': b_str,
                'record_id': r['id'] if 'id' in r and pd.notna(r['id']) else None,
                'column': col_name,
            })

    seen = set()
    deduped = []
    for item in items:
        dedup_key = item.get('object_key') or item['url']
        if dedup_key not in seen:
            seen.add(dedup_key)
            deduped.append(item)
    return deduped


def evidence_items_across_columns(df_src, columns):
    items = []
    seen = set()
    for col in columns:
        for item in extract_evidence_items_vectorized(df_src, col):
            url = item.get('url', '').strip()
            if url and url not in seen:
                seen.add(url)
                items.append(item)
    return items


# Every evidence column an uploaded file can live in. delete_evidence_item()
# refuses to touch anything outside this set, as a guard against a typo'd
# or unexpected column name ever reaching a raw SQL UPDATE.
DELETABLE_EVIDENCE_COLUMNS = {
    'Voice_Note_Link', 'Lesson_Plan_Picture',
    'Video_Evidence_1', 'Video_Evidence_2', 'Video_Evidence_3',
    'Writing_Sample_Link', 'Phonics_Evidence_Link', 'Portfolio_Evidence_Link',
    'Student_Assessment_Link', 'Event_Pictures_Link',
}


def delete_evidence_item(record_id, column_name, object_key, url):
    """
    Permanently removes ONE evidence file: deletes the underlying object
    from R2 (skipped for legacy external links that were never stored in
    R2 — we have no write access to wherever those live) and removes just
    that file's reference from the matching teacher_records row, leaving
    any other files listed in the same column untouched. Because every
    admin view (Tab 4, Tab 7, PDF reports) reads straight from
    teacher_records, the removed file disappears everywhere the moment
    the page/report is refreshed — there's no separate "clean it out of
    the PDF" step needed.

    Returns (success: bool, message: str | None) — message is an error
    on failure, or a non-fatal warning on success (e.g. DB updated but
    R2 delete failed), or None if everything went cleanly.
    """
    if column_name not in DELETABLE_EVIDENCE_COLUMNS:
        return False, f"'{column_name}' is not a recognized evidence column."
    if not record_id:
        return False, "This record has no database id to target (older row, or the 'id' column isn't available) — cannot safely delete."

    try:
        with conn.session as s:
            current = s.execute(
                text(f'SELECT "{column_name}" FROM teacher_records WHERE id = :id'),
                {"id": int(record_id)}
            ).fetchone()
    except Exception as e:
        return False, f"Could not read the current value: {e}"

    if current is None:
        return False, "Record not found — it may already have been deleted."

    current_raw = current[0]
    target = (object_key or url or "").strip()
    remaining = [v for v in split_evidence_raw_value(current_raw) if v.strip() != target]
    new_value = ",".join(remaining) if remaining else None

    try:
        with conn.session as s:
            s.execute(
                text(f'UPDATE teacher_records SET "{column_name}" = :val WHERE id = :id'),
                {"val": new_value, "id": int(record_id)}
            )
            s.commit()
    except Exception as e:
        return False, f"Could not update the database: {e}"

    r2_warning = None
    if object_key and R2_DELETE_ENABLED:
        try:
            r2_delete_client.delete_object(Bucket=R2_DELETE_BUCKET_NAME, Key=object_key)
        except Exception as e:
            r2_warning = f"Database record updated, but the file could not be removed from R2 storage and may need manual cleanup: {e}"
    elif object_key and not R2_DELETE_ENABLED:
        r2_warning = "Database record updated, but R2 delete credentials aren't configured yet, so the file itself still exists in storage (see the R2 delete client note near the top of this file)."

    fetch_master_db_from_supabase.clear()
    return True, r2_warning


def generate_comprehensive_school_pdf_report(school_name, teachers_list, school_filtered_df, filtered_df, filter_desc, calc_ld_kpi, calc_content_kpi, calc_lib_kpi, daily_ld_target, daily_content_target, daily_lib_target, selected_num_days, target_vid_count=3, target_writing_count=3, target_lp_combo_count=3, target_phonics_count=2, target_portfolio_count=1, enable_quant_kpi=True, enable_qual_kpi=True, active_metric_mode="Content / Book Usage", show_lesson_plan_report=True, show_evidence_section=True):
    buffer = BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=letter, rightMargin=36, leftMargin=36, topMargin=36, bottomMargin=36)
    story = []
    styles = getSampleStyleSheet()

    primary_color = colors.HexColor('#2563EB')
    dark_neutral = colors.HexColor('#1E293B')
    light_bg = colors.HexColor('#F8FAFC')
    border_color = colors.HexColor('#E2E8F0')
    accent_color = colors.HexColor('#0F172A')

    title_style = ParagraphStyle('DocTitle', parent=styles['Heading1'], fontSize=16, leading=20, textColor=primary_color, fontName='PortalSans-Bold')
    subtitle_style = ParagraphStyle('DocSubTitle', parent=styles['Normal'], fontSize=9, leading=13, textColor=dark_neutral)
    school_style = ParagraphStyle('SchoolHead', parent=styles['Normal'], fontSize=10, leading=14, textColor=accent_color, fontName='PortalSans-Bold')
    sec_head_style = ParagraphStyle('SecHead', parent=styles['Heading2'], fontSize=11, leading=15, textColor=primary_color, fontName='PortalSans-Bold', spaceBefore=12, spaceAfter=5)
    normal_style = ParagraphStyle('Body', parent=styles['Normal'], fontSize=8.5, leading=13, textColor=dark_neutral)
    link_style = ParagraphStyle('LinkStyle', parent=styles['Normal'], fontSize=8, leading=11, textColor=colors.HexColor('#2563EB'), fontName='PortalSans-Bold')
    card_header = ParagraphStyle('CardHead', parent=styles['Normal'], fontSize=7.5, leading=10, textColor=colors.HexColor('#64748B'), fontName='PortalSans-Bold', alignment=1)
    card_value = ParagraphStyle('CardVal', parent=styles['Normal'], fontSize=11, leading=14, textColor=primary_color, fontName='PortalSans-Bold', alignment=1)

    if isinstance(school_name, (list, tuple, set, np.ndarray, pd.Series)) and len(school_name) > 1:
        from pypdf import PdfReader, PdfWriter
        writer = PdfWriter()
        for school in school_name:
            names = [t[1] for t in teachers_list if isinstance(t, tuple) and t[0] == school]
            if not names:
                names = [t for t in teachers_list if isinstance(t,str) and t in filtered_df.loc[filtered_df.Institution.eq(school),'FullName'].values]
            buf = generate_comprehensive_school_pdf_report(school,names,school_filtered_df,filtered_df,filter_desc,
                calc_ld_kpi,calc_content_kpi,calc_lib_kpi,daily_ld_target,daily_content_target,daily_lib_target,
                selected_num_days,target_vid_count,target_writing_count,target_lp_combo_count,target_phonics_count,
                target_portfolio_count,enable_quant_kpi,enable_qual_kpi,active_metric_mode,show_lesson_plan_report,show_evidence_section)
            writer.append(PdfReader(buf))
        merged = BytesIO(); writer.write(merged); merged.seek(0)
        return merged
    if isinstance(school_name,(list,tuple,set,np.ndarray,pd.Series)) and len(school_name)==1:
        school_name=list(school_name)[0]
    teachers_list=[t[1] if isinstance(t,tuple) else t for t in teachers_list]
    # Each school calendar has its own denominator; use it consistently in every table.
    if globals().get('use_teacher_eligible_days',False):
        selected_num_days = next((globals().get('teacher_days',{}).get((school_name,t)) for t in teachers_list
                                 if (school_name,t) in globals().get('teacher_days',{})),selected_num_days)
        calc_ld_kpi = calculate_kpi_target(daily_ld_target,selected_num_days,enable_quant_kpi)
        calc_content_kpi = calculate_kpi_target(daily_content_target,selected_num_days,enable_quant_kpi)
        calc_lib_kpi = calculate_kpi_target(daily_lib_target,selected_num_days,enable_quant_kpi)
    if isinstance(school_name, (list, tuple, set, np.ndarray, pd.Series)):
        school_names = [str(x) for x in school_name if str(x).strip()]
        school_curr_df = filtered_df[filtered_df['Institution'].isin(school_names)]
    else:
        school_names = [str(school_name)]
        school_curr_df = filtered_df[filtered_df['Institution'] == school_name]

    include_content = "Content" in active_metric_mode or "Both" in active_metric_mode
    include_library = "Library" in active_metric_mode or "Both" in active_metric_mode

    story.append(Paragraph(f"<b>Comprehensive School Audit & Feature-Wise Report</b>", title_style))
    story.append(Spacer(1, 4))
    story.append(Paragraph(f"<b>Institution / School Focus:</b> {school_name}", school_style))
    story.append(Spacer(1, 3))
    story.append(Paragraph(f"Observation Window: {filter_desc} | Focus Mode: {active_metric_mode}", subtitle_style))
    story.append(Spacer(1, 8))
    story.append(HRFlowable(width="100%", thickness=1.5, color=primary_color, spaceAfter=12))

    ld_df = school_curr_df[usage_masks(school_curr_df)[0]]
    ld_usage = ld_df.groupby('FullName')['Duration_Min'].sum().to_dict()
    
    lib_df = school_curr_df[usage_masks(school_curr_df)[1]]
    lib_usage = lib_df.groupby('FullName')['Duration_Min'].sum().to_dict()

    content_raw = school_curr_df[school_curr_df['Book'].str.len() > 0]
    content_df = content_raw[usage_masks(content_raw)[2]]
    content_usage = content_df.groupby('FullName')['Duration_Min'].sum().to_dict()
    content_books_opened = content_df.groupby('FullName')['Book'].nunique().to_dict()

    total_teachers_count = len(teachers_list)
    met_ld_count = 0
    met_content_count = 0
    met_lib_count = 0

    for t_name in teachers_list:
        t_ld = ld_usage.get(t_name, 0.0)
        t_content = content_usage.get(t_name, 0.0)
        t_lib = lib_usage.get(t_name, 0.0)
        
        if (calc_ld_kpi > 0 and t_ld >= calc_ld_kpi) or (calc_ld_kpi == 0 and t_ld > 0):
            met_ld_count += 1
        if (calc_content_kpi > 0 and t_content >= calc_content_kpi) or (calc_content_kpi == 0 and t_content > 0):
            met_content_count += 1
        if (calc_lib_kpi > 0 and t_lib >= calc_lib_kpi) or (calc_lib_kpi == 0 and t_lib > 0):
            met_lib_count += 1

    school_summary_metrics = {
        "Active Roster Teachers": total_teachers_count,
        "Working Days Evaluated": f"{selected_num_days} Days"
    }
    if enable_quant_kpi:
        if show_lesson_plan_report:
            school_summary_metrics["Met Lesson Prep KPI"] = f"{met_ld_count} / {total_teachers_count}"
        if include_content:
            school_summary_metrics["Met Content (Book) KPI"] = f"{met_content_count} / {total_teachers_count}"
        if include_library:
            school_summary_metrics["Met Library KPI"] = f"{met_lib_count} / {total_teachers_count}"

    headers_row = [Paragraph(k, card_header) for k in school_summary_metrics.keys()]
    values_row = [Paragraph(str(v), card_value) for v in school_summary_metrics.values()]
    col_w = 540 / len(school_summary_metrics)
    kpi_table = Table([headers_row, values_row], colWidths=[col_w] * len(school_summary_metrics))
    kpi_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), light_bg),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('GRID', (0, 0), (-1, -1), 0.5, border_color),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
    ]))
    story.append(kpi_table)
    story.append(Spacer(1, 10))

    if enable_quant_kpi:
        story.append(Paragraph("<b>School-Level Feature Performance Summary & Guidelines</b>", sec_head_style))
        story.append(HRFlowable(width="100%", thickness=0.5, color=border_color, spaceAfter=6))
        if show_lesson_plan_report:
            story.append(Paragraph(f"• <b>Lesson Plan Prep Standard:</b> {daily_ld_target:.0f} mins/day × {selected_num_days} working days ({calc_ld_kpi:.0f} mins total benchmark standard)", normal_style))
        if include_content:
            story.append(Paragraph(f"• <b>Content / Book Usage Standard:</b> {daily_content_target:.0f} mins/day × {selected_num_days} working days ({calc_content_kpi:.0f} mins total benchmark standard)", normal_style))
        if include_library:
            story.append(Paragraph(f"• <b>Library Usage Standard:</b> {daily_lib_target:.0f} mins/day × {selected_num_days} working days ({calc_lib_kpi:.0f} mins total benchmark standard)", normal_style))
        story.append(Spacer(1, 10))

    # Section numbers are computed dynamically instead of hardcoded, since
    # any of Lesson Plan / Content / Library can now be individually
    # switched off for the PDF — a fixed "1. / 2. / 3." would produce gaps
    # or wrong numbers depending on which sections are actually included.
    summary_sec_num = 1

    if show_lesson_plan_report:
        story.append(Paragraph(f"<b>{summary_sec_num}. Lesson Plan Preparation Consolidated Report</b>", sec_head_style))
        summary_sec_num += 1
        ld_summary_table_data = [["Teacher Name", "Total Minutes Logged", "Average Mins/Day", "Performance Indicator Status"]]
        for t_name in teachers_list:
            t_mins = ld_usage.get(t_name, 0.0)
            t_avg = t_mins / selected_num_days if selected_num_days > 0 else 0.0
            if not enable_quant_kpi or calc_ld_kpi == 0:
                t_stat = "Activity Logged" if t_mins > 0 else "No Activity Logged"
            elif t_mins >= calc_ld_kpi:
                t_stat = f"Met Performance Indicator (>= {calc_ld_kpi:.0f}m)"
            elif t_mins > 0.0:
                t_stat = f"Below Performance Indicator (< {calc_ld_kpi:.0f}m)"
            else:
                t_stat = "No recorded usage (0 Mins)"
            ld_summary_table_data.append([t_name, f"{t_mins:.1f}m", f"{t_avg:.1f}m/day", t_stat])

        ld_table_obj = Table(ld_summary_table_data, colWidths=[140, 110, 100, 190])
        ld_table_obj.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), primary_color),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
            ('FONTNAME', (0, 0), (-1, 0), 'PortalSans-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 8),
            ('GRID', (0, 0), (-1, -1), 0.4, border_color),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, light_bg]),
            ('TOPPADDING', (0, 0), (-1, -1), 5),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ]))
        story.append(ld_table_obj)
        story.append(Spacer(1, 14))

    if include_content:
        story.append(Paragraph(f"<b>{summary_sec_num}. Content & Chapter Usage Consolidated Report</b>", sec_head_style))
        summary_sec_num += 1
        content_summary_table_data = [["Teacher Name", "Total Minutes Logged", "Average Mins/Day", "Textbooks/Chapters Opened", "Status"]]
        for t_name in teachers_list:
            t_content_mins = content_usage.get(t_name, 0.0)
            t_content_avg = t_content_mins / selected_num_days if selected_num_days > 0 else 0.0
            t_content_books = content_books_opened.get(t_name, 0)
            if not enable_quant_kpi or calc_content_kpi == 0:
                t_cstat = "Activity Logged" if t_content_mins > 0 else "No Activity Logged"
            elif t_content_mins >= calc_content_kpi:
                t_cstat = f"Met KPI (>= {calc_content_kpi:.0f}m)"
            elif t_content_mins > 0:
                t_cstat = f"Below KPI (< {calc_content_kpi:.0f}m)"
            else:
                t_cstat = "No recorded usage (0 Mins)"
            content_summary_table_data.append([t_name, f"{t_content_mins:.1f}m", f"{t_content_avg:.1f}m/day", str(t_content_books), t_cstat])

        content_table_obj = Table(content_summary_table_data, colWidths=[130, 95, 95, 100, 120])
        content_table_obj.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), primary_color),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
            ('FONTNAME', (0, 0), (-1, 0), 'PortalSans-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 8),
            ('GRID', (0, 0), (-1, -1), 0.4, border_color),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, light_bg]),
            ('TOPPADDING', (0, 0), (-1, -1), 5),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ]))
        story.append(content_table_obj)
        story.append(Spacer(1, 14))

    if include_library:
        story.append(Paragraph(f"<b>{summary_sec_num}. Library Usage Overview </b>", sec_head_style))
        summary_sec_num += 1
        lib_summary_table_data = [["Teacher Name", "Total Minutes Logged", "Average Mins/Day", "Status"]]
        for t_name in teachers_list:
            t_lib_mins = lib_usage.get(t_name, 0.0)
            t_lib_avg = t_lib_mins / selected_num_days if selected_num_days > 0 else 0.0
            if not enable_quant_kpi or calc_lib_kpi == 0:
                t_lib_stat = "Activity Logged" if t_lib_mins > 0 else "No Activity Logged"
            elif t_lib_mins >= calc_lib_kpi:
                t_lib_stat = f"Met KPI (>= {calc_lib_kpi:.0f}m)"
            elif t_lib_mins > 0:
                t_lib_stat = f"Below KPI (< {calc_lib_kpi:.0f}m)"
            else:
                t_lib_stat = "No recorded usage (0 Mins)"
            lib_summary_table_data.append([t_name, f"{t_lib_mins:.1f}m", f"{t_lib_avg:.1f}m/day", t_lib_stat])

        lib_table_obj = Table(lib_summary_table_data, colWidths=[140, 110, 100, 190])
        lib_table_obj.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), primary_color),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
            ('FONTNAME', (0, 0), (-1, 0), 'PortalSans-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 8),
            ('GRID', (0, 0), (-1, -1), 0.4, border_color),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, light_bg]),
            ('TOPPADDING', (0, 0), (-1, -1), 5),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ]))
        story.append(lib_table_obj)
        story.append(Spacer(1, 14))

    if enable_qual_kpi and show_evidence_section:
        story.append(Paragraph("<b>Classroom Submissions & Evidence Compliance</b>", sec_head_style))
        qual_summary_table_data = [["Teacher Name", "LP / Audio", "Activities", "Writing", "Phonics", "Portfolio", "Assess.", "Events", "Status"]]
        
        for t_name in teachers_list:
            sub_t = school_curr_df[school_curr_df['FullName'] == t_name]
            v_cnt = len(evidence_items_across_columns(sub_t, ['Video_Evidence_1', 'Video_Evidence_2', 'Video_Evidence_3']))
            w_cnt = len(extract_evidence_items_vectorized(sub_t, 'Writing_Sample_Link'))
            lp_cnt = len(extract_evidence_items_vectorized(sub_t, 'Lesson_Plan_Picture'))
            vn_cnt = len(extract_evidence_items_vectorized(sub_t, 'Voice_Note_Link'))
            ph_cnt = len(extract_evidence_items_vectorized(sub_t, 'Phonics_Evidence_Link'))
            pf_cnt = len(extract_evidence_items_vectorized(sub_t, 'Portfolio_Evidence_Link'))
            as_cnt = len(extract_evidence_items_vectorized(sub_t, 'Student_Assessment_Link'))
            ev_cnt = len(extract_evidence_items_vectorized(sub_t, 'Event_Pictures_Link'))
            
            is_q_ok = (v_cnt >= target_vid_count and w_cnt >= target_writing_count and (lp_cnt + vn_cnt) >= target_lp_combo_count and ph_cnt >= target_phonics_count and pf_cnt >= target_portfolio_count)
            q_stat = "Met Standard" if is_q_ok else "In Progress"
            qual_summary_table_data.append([t_name, str(lp_cnt + vn_cnt), str(v_cnt), str(w_cnt), str(ph_cnt), str(pf_cnt), str(as_cnt), str(ev_cnt), q_stat])

        qual_table_obj = Table(qual_summary_table_data, colWidths=[100, 55, 50, 50, 55, 55, 50, 45, 45])
        qual_table_obj.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), primary_color),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('ALIGN', (0, 0), (0, -1), 'LEFT'),
            ('FONTNAME', (0, 0), (-1, 0), 'PortalSans-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 7.5),
            ('GRID', (0, 0), (-1, -1), 0.4, border_color),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, light_bg]),
            ('TOPPADDING', (0, 0), (-1, -1), 5),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ]))
        story.append(qual_table_obj)
        story.append(Spacer(1, 12))

    for target_teacher in teachers_list:
        story.append(PageBreak())

        teacher_date_data = school_curr_df[school_curr_df['FullName'] == target_teacher]

        t_day_ld = teacher_date_data[usage_masks(teacher_date_data)[0]]['Duration_Min'].sum() if not teacher_date_data.empty else 0.0
        t_day_lib = teacher_date_data[usage_masks(teacher_date_data)[1]]['Duration_Min'].sum() if not teacher_date_data.empty else 0.0
        
        t_books_raw = teacher_date_data[teacher_date_data['Book'].str.len() > 0]
        teacher_books = t_books_raw[usage_masks(t_books_raw)[2]]
        t_day_content = teacher_books['Duration_Min'].sum() if not teacher_books.empty else 0.0

        ld_pct = safe_percentage(t_day_ld, calc_ld_kpi)
        content_pct = safe_percentage(t_day_content, calc_content_kpi)
        lib_pct = safe_percentage(t_day_lib, calc_lib_kpi)

        ld_advice = f"Steady Execution ({t_day_ld:.1f}m logged)" if (calc_ld_kpi > 0 and t_day_ld >= calc_ld_kpi) else (f"In-Progress ({t_day_ld:.1f}m logged)" if t_day_ld > 0 else "Pending Activity")
        content_advice = f"Steady Execution ({t_day_content:.1f}m logged)" if (calc_content_kpi > 0 and t_day_content >= calc_content_kpi) else (f"In-Progress ({t_day_content:.1f}m logged)" if t_day_content > 0 else "Pending Activity")
        lib_advice = f"Steady Execution ({t_day_lib:.1f}m logged)" if (calc_lib_kpi > 0 and t_day_lib >= calc_lib_kpi) else (f"In-Progress ({t_day_lib:.1f}m logged)" if t_day_lib > 0 else "Pending Activity")

        evidence_source = teacher_date_data

        v_voice = extract_evidence_items_vectorized(evidence_source, 'Voice_Note_Link')
        v_pic = extract_evidence_items_vectorized(evidence_source, 'Lesson_Plan_Picture')
        v_writing = extract_evidence_items_vectorized(evidence_source, 'Writing_Sample_Link')
        v_phonics = extract_evidence_items_vectorized(evidence_source, 'Phonics_Evidence_Link')
        v_portfolio = extract_evidence_items_vectorized(evidence_source, 'Portfolio_Evidence_Link')
        v_assessment = extract_evidence_items_vectorized(evidence_source, 'Student_Assessment_Link')
        v_events = extract_evidence_items_vectorized(evidence_source, 'Event_Pictures_Link')
        v_vid = evidence_items_across_columns(evidence_source, ['Video_Evidence_1', 'Video_Evidence_2', 'Video_Evidence_3'])

        lp_combo_total = len(v_voice) + len(v_pic)
        total_artifacts = lp_combo_total + len(v_vid) + len(v_writing) + len(v_phonics) + len(v_portfolio) + len(v_assessment) + len(v_events)

        pdf_book_items = []
        if not teacher_books.empty:
            b_summary_df = teacher_books.groupby(['Book', 'Grade', 'Subject'])['Duration_Min'].sum().reset_index()
            for _, br in b_summary_df.iterrows():
                pdf_book_items.append(f"Book: {br['Book']} ({br['Grade']} - {br['Subject']}) | Time Spent: {br['Duration_Min']:.1f} Mins")
        else:
            pdf_book_items.append("No textbooks or digital modules opened.")

        pdf_link_items = []
        for i, item in enumerate(v_voice, 1): 
            pdf_link_items.append(f'• 🎧 <a href="{item["url"]}"><u><b>Open Voice Reflection #{i}</b></u></a> — <i>{item["grade"]} | {item["subject"]} ({item["lesson"]}, {item["date"]})</i>')
        for i, item in enumerate(v_pic, 1): 
            pdf_link_items.append(f'• 🖼️ <a href="{item["url"]}"><u><b>View Lesson Plan Photo #{i}</b></u></a> — <i>{item["grade"]} | {item["subject"]} ({item["lesson"]}, {item["date"]})</i>')
        for i, item in enumerate(v_vid, 1): 
            pdf_link_items.append(f'• 🎥 <a href="{item["url"]}"><u><b>Open Classroom Activity File #{i}</b></u></a> — <i>{item["grade"]} | {item["subject"]} ({item["lesson"]}, {item["date"]})</i>')
        for i, item in enumerate(v_writing, 1): 
            pdf_link_items.append(f'• 📝 <a href="{item["url"]}"><u><b>View Student Writing Sample #{i}</b></u></a> — <i>{item["grade"]} | {item["subject"]} ({item["lesson"]}, {item["date"]})</i>')
        for i, item in enumerate(v_phonics, 1): 
            pdf_link_items.append(f'• 🔤 <a href="{item["url"]}"><u><b>Open Phonics Evidence #{i}</b></u></a> — <i>{item["grade"]} | {item["subject"]} ({item["lesson"]}, {item["date"]})</i>')
        for i, item in enumerate(v_portfolio, 1): 
            pdf_link_items.append(f'• 📁 <a href="{item["url"]}"><u><b>View Teacher Portfolio Showcase #{i}</b></u></a> — <i>{item["grade"]} | {item["subject"]} ({item["lesson"]}, {item["date"]})</i>')
        for i, item in enumerate(v_assessment, 1):
            pdf_link_items.append(f'• 🧪 <a href="{item["url"]}"><u><b>View Student Assessment #{i}</b></u></a> — <i>{item["grade"]} | {item["subject"]} ({item["lesson"]}, {item["date"]})</i>')
        for i, item in enumerate(v_events, 1):
            pdf_link_items.append(f'• 🎉 <a href="{item["url"]}"><u><b>View Event Picture #{i}</b></u></a> — <i>{item["grade"]} | {item["subject"]} ({item["lesson"]}, {item["date"]})</i>')

        story.append(Paragraph(f"<b>Academic Performance Profile: {target_teacher}</b>", title_style))
        story.append(Spacer(1, 4))
        story.append(Paragraph(f"<b>Institution / School Focus:</b> {school_name}", school_style))
        story.append(Spacer(1, 3))
        story.append(Paragraph(f"Observation Window: {filter_desc}", subtitle_style))
        story.append(Spacer(1, 6))
        story.append(HRFlowable(width="100%", thickness=1.5, color=primary_color, spaceAfter=10))

        summary_metrics = {
            "Teacher": target_teacher,
        }
        if show_lesson_plan_report:
            summary_metrics["Lesson Prep"] = f"{t_day_ld:.1f}m"
        if include_content:
            summary_metrics["Content (Book)"] = f"{t_day_content:.1f}m"
        if include_library:
            summary_metrics["Library Usage"] = f"{t_day_lib:.1f}m"
        if show_evidence_section:
            summary_metrics["Phonics / Portfolio"] = f"{len(v_phonics)} / {len(v_portfolio)}"
            summary_metrics["Assessments / Events"] = f"{len(v_assessment)} / {len(v_events)}"
            summary_metrics["Activity Submissions"] = f"{total_artifacts}"

        headers_row = [Paragraph(k, card_header) for k in summary_metrics.keys()]
        values_row = [Paragraph(str(v), card_value) for v in summary_metrics.values()]
        col_w = 540 / len(summary_metrics)
        kpi_table = Table([headers_row, values_row], colWidths=[col_w] * len(summary_metrics))
        kpi_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), light_bg),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('GRID', (0, 0), (-1, -1), 0.5, border_color),
            ('TOPPADDING', (0, 0), (-1, -1), 6),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ]))
        story.append(kpi_table)
        story.append(Spacer(1, 10))

        sec1_items = []
        if show_lesson_plan_report:
            sec1_items.append(f"Lesson Preparation Duration: {t_day_ld:.1f} Minutes" + (f" ({ld_pct:.0f}% of Academic Benchmark)" if enable_quant_kpi else ""))
        if include_content:
            sec1_items.append(f"Content Usage (Textbooks/Chapters) Duration: {t_day_content:.1f} Minutes" + (f" ({content_pct:.0f}% of Academic Benchmark)" if enable_quant_kpi else "") + f" across {teacher_books['Book'].nunique() if not teacher_books.empty else 0} unique textbook(s)/chapter(s).")
        if include_library:
            sec1_items.append(f"Library Usage Duration: {t_day_lib:.1f} Minutes" + (f" ({lib_pct:.0f}% of Academic Benchmark)" if enable_quant_kpi else ""))

        assessment_parts = []
        if show_lesson_plan_report:
            assessment_parts.append(f"{ld_advice} in lesson preparation")
        if include_content:
            assessment_parts.append(f"{content_advice} in textbook content delivery")
        elif include_library:
            assessment_parts.append(f"{lib_advice} in library integration")
        if assessment_parts:
            sec1_items.append(f"Consultant Assessment: " + ", ".join(assessment_parts) + ".")

        # Section numbers are computed dynamically, same reasoning as the
        # school-level summary above — Lesson Plan / Evidence can each be
        # switched off independently, so a fixed "1. / 2. / 3." would be
        # wrong whenever a section in the middle is skipped.
        sections = {}
        per_teacher_sec_num = 1
        if sec1_items:
            sections[f"{per_teacher_sec_num}. Quantitative Performance Indicator Overview"] = sec1_items
            per_teacher_sec_num += 1
        if include_content:
            sections[f"{per_teacher_sec_num}. Detailed Textbook & Chapter Breakdown"] = pdf_book_items
            per_teacher_sec_num += 1
        if show_evidence_section:
            sections[f"{per_teacher_sec_num}. Activity Evidence & Qualitative Artifacts"] = pdf_link_items if pdf_link_items else ["No activity or evidence submission links recorded in active window."]
            per_teacher_sec_num += 1

        for heading, body_items in sections.items():
            story.append(Paragraph(f"<b>{heading}</b>", sec_head_style))
            story.append(HRFlowable(width="100%", thickness=0.5, color=border_color, spaceAfter=4))
            for item in body_items:
                if "<a href=" in item:
                    story.append(Paragraph(f"{item}", link_style))
                else:
                    story.append(Paragraph(f"• {item}", normal_style))
            story.append(Spacer(1, 8))

    doc.build(story)
    buffer.seek(0)
    return buffer


def ingest_excel_to_postgresql(processed_dfs, source="UserMetrics / legacy import", skip_invalid=False):
    st.session_state.pop('last_import_result', None)
    if not processed_dfs:
        return 0, 0
    combined = normalize_identity_columns(pd.concat(processed_dfs, ignore_index=True))
    for col in RECORD_COLUMNS:
        if col not in combined:
            combined[col] = None
    # Alias normalization can create duplicate columns on legacy backups: reject rather than corrupt.
    if combined.columns.duplicated().any():
        raise ValueError("Duplicate mapped columns in import; resolve the source headers first.")
    combined['Duration_Min'] = pd.to_numeric(combined['Duration_Min'], errors='coerce')
    input_rows = len(combined)
    if input_rows == 0:
        st.session_state['last_import_result'] = {'source': source, 'status': 'No data rows', 'input_rows': 0, 'inserted_rows': 0, 'skipped_duplicates': 0, 'invalid_rows': 0}
        return 0, 0
    details = []
    errors = validate_import(combined)
    if errors:
        details = []
        for error in errors:
            record = combined.loc[int(error['Row'])]
            details.append({
                'File': str(record.get('_source_file', source)),
                'Excel row': str(record.get('_excel_row', int(error['Row']) + 2)),
                'Issues': error['Issues'],
                'School': str(record.get('Institution', '')),
                'Teacher': str(record.get('FullName', '')),
                'Type': str(record.get('Type', '')),
                'Original start time': str(record.get('_raw_start', record.get('StartTime', ''))),
                'Original duration': str(record.get('_raw_duration', record.get('Duration_Min', ''))),
                'Original numeric minutes': str(record.get('_raw_minutes', '')),
                'Parsed start time': str(record.get('StartTime', '')),
                'Parsed minutes': str(record.get('Duration_Min', '')),
            })
        st.session_state['last_import_result'] = {'source': source, 'status': 'Needs review - no rows written', 'input_rows': input_rows, 'inserted_rows': 0, 'skipped_duplicates': 0, 'invalid_rows': len(errors), 'examples': details[:20], 'rejected_rows': details}
        if not skip_invalid:
            raise ValueError(f"Import rejected: {len(errors)} row(s) have invalid identity/date/duration. See Data Quality for details.")
        combined = combined.drop(index=[int(error['Row']) for error in errors]).copy()
        if combined.empty:
            return 0, 0
    combined['Record_Hash'] = combined.apply(compute_record_hash, axis=1)
    total = len(combined)
    combined = combined.drop_duplicates('Record_Hash', keep='last')
    with conn.engine.begin() as c:
        # All app imports share this transaction lock, preventing concurrent check/insert races.
        c.execute(text("SELECT pg_advisory_xact_lock(72841902)"))
        available = set(pd.read_sql(text('SELECT * FROM teacher_records LIMIT 0'), c).columns)
        needed = [col for col in RECORD_COLUMNS if col not in available and combined[col].notna().any()]
        if needed:
            raise ValueError('Run migration.sql before importing. Missing fields: ' + ', '.join(needed))
        hashes = combined.Record_Hash.tolist()
        existing = set(h for (h,) in c.execute(text('SELECT "Record_Hash" FROM teacher_records WHERE "Record_Hash" = ANY(:hashes)'), {'hashes': hashes}))
        # Old evidence hashes differ from v2. Recompute only corresponding candidate rows in memory.
        legacy = pd.read_sql(text('SELECT * FROM teacher_records WHERE "Institution" = ANY(:schools) AND "FullName" = ANY(:teachers)'), c,
                             params={'schools': combined.Institution.unique().tolist(), 'teachers': combined.FullName.unique().tolist()})
        if not legacy.empty:
            existing.update(legacy.apply(compute_record_hash, axis=1).tolist())
        inserted = combined[~combined.Record_Hash.isin(existing)].copy()
        cols = [col for col in RECORD_COLUMNS if col in available]
        if not inserted.empty:
            records = []
            for _, row in inserted[cols].iterrows():
                record = {}
                for col, value in row.items():
                    if value is None or pd.isna(value):
                        record[col] = None
                    elif isinstance(value, (np.integer, np.floating)):
                        record[col] = value.item()
                    elif isinstance(value, pd.Timestamp):
                        record[col] = value.to_pydatetime()
                    else:
                        record[col] = value
                records.append(record)
            quoted = ','.join('"'+col+'"' for col in cols)
            values = ','.join(':'+col for col in cols)
            c.execute(text(f'INSERT INTO teacher_records ({quoted}) VALUES ({values})'), records)
        count = len(inserted)
        if c.execute(text("SELECT to_regclass('public.portal_import_runs')")).scalar():
            c.execute(text('INSERT INTO portal_import_runs(id,source,input_rows,inserted_rows,skipped_rows,actor) VALUES (:id,:source,:total,:inserted,:skipped,:actor)'),
                      dict(id=str(uuid.uuid4()), source=source,total=input_rows,inserted=count,skipped=input_rows-count,actor=employee_name))
    st.session_state['last_import_result'] = {'source':source,'status':'Committed with rows needing review' if details else 'Committed','input_rows':input_rows,'inserted_rows':count,'skipped_duplicates':total-count,'invalid_rows':len(details),'examples':details[:20],'rejected_rows':details}
    return count, total-count


def prepare_usermetrics_file(file, consultant, state_zone):
    """Parse one export without changing source files or inventing missing values."""
    file.seek(0)
    with pd.ExcelFile(file) as workbook:
        sheet = next((s for s in workbook.sheet_names if 'usermetric' in s.lower()), workbook.sheet_names[0])
        frame = pd.read_excel(workbook, sheet_name=sheet)
    frame.columns = [str(c).strip() for c in frame.columns]
    duration_headers = {c.lower(): c for c in ['Duration (HH:MM:SS)', 'Duration (Minutes)', 'Duration_Min']}
    frame = frame.rename(columns={c: duration_headers.get(c.lower(), c) for c in frame.columns})
    if frame.columns.duplicated().any():
        raise ValueError('Duplicate column headers; correct this workbook before importing it.')
    frame = normalize_identity_columns(frame)
    if frame.columns.duplicated().any():
        raise ValueError('Duplicate mapped column headers; correct this workbook before importing it.')
    frame['_source_file'] = file.name
    frame['_excel_row'] = range(2, len(frame) + 2)
    frame['_raw_start'] = frame.get('StartTime', '')
    frame['_raw_duration'] = frame.get('Duration (HH:MM:SS)', '')
    frame['_raw_minutes'] = frame.get('Duration (Minutes)', frame.get('Duration_Min', ''))
    frame['Uploaded_By'] = consultant
    frame['State_Zone'] = state_zone
    for col in ['Grade', 'Subject', 'Book', 'Type']:
        frame[col] = frame[col].fillna('').astype(str).str.replace(r'\s+', ' ', regex=True).str.strip() if col in frame else ''
    supported = ['Duration (HH:MM:SS)', 'Duration (Minutes)', 'Duration_Min']
    if not any(c in frame for c in supported):
        raise ValueError('No supported duration column: expected Duration (HH:MM:SS), Duration (Minutes), or Duration_Min.')
    # Keep the original HH:MM:SS convention; use explicit source minutes only
    # when that cell is blank/unreadable. Never replace missing duration with 0.
    duration = pd.Series(float('nan'), index=frame.index)
    if supported[0] in frame:
        duration = frame[supported[0]].map(lambda v: parse_source_duration(v) if pd.notna(v) and str(v).strip() else float('nan'))
    for col in supported[1:]:
        if col in frame:
            duration = duration.fillna(pd.to_numeric(frame[col], errors='coerce'))
    frame['Duration_Min'] = duration
    for col in ['StartTime', 'EndTime']:
        if col in frame:
            # Parse cells individually: a differently formatted first row must
            # not force otherwise valid rows into NaT.
            frame[col] = frame[col].map(lambda v: pd.to_datetime(v, errors='coerce'))
    return frame


def import_usermetrics_files(files, consultant, state_zone):
    """Import valid files/rows while keeping a visible record of exclusions."""
    st.session_state.pop('last_import_result', None)
    frames, file_errors = [], []
    for file in files:
        try:
            frames.append(prepare_usermetrics_file(file, consultant, state_zone))
        except Exception as exc:
            file_errors.append(f'{file.name}: {exc}')
    source = ', '.join(file.name for file in files)
    result = {'source': source, 'status': 'No readable files', 'input_rows': 0,
              'inserted_rows': 0, 'skipped_duplicates': 0, 'invalid_rows': 0}
    if frames:
        try:
            ingest_excel_to_postgresql(frames, source=source, skip_invalid=True)
            result = dict(st.session_state.get('last_import_result', result))
        except Exception as exc:
            result = dict(st.session_state.get('last_import_result', result))
            result.update(status='Database write failed', inserted_rows=0, skipped_duplicates=0, error=str(exc))
    result['file_errors'] = file_errors
    st.session_state['last_import_result'] = result
    st.session_state['last_metrics_import_result'] = result
    return result


def render_last_metrics_import():
    result = st.session_state.get('last_metrics_import_result')
    if not result:
        return
    with st.sidebar.expander('Last UserMetrics import', expanded=True):
        if result.get('status') == 'Database write failed':
            st.error('The database write failed. No success is reported; check the error below before retrying.')
            st.write(result.get('error', ''))
        else:
            st.info(f"Saved {result.get('inserted_rows', 0)} rows | Already present/duplicate: {result.get('skipped_duplicates', 0)} | Rows needing review: {result.get('invalid_rows', 0)}")
        for error in result.get('file_errors', []):
            st.warning(f'Skipped file: {error}')
        skipped = result.get('rejected_rows', [])
        if skipped:
            st.warning('Rows needing review were not imported. Correct the source rows and upload again; duplicate checks remain active.')
            st.dataframe(pd.DataFrame(skipped), use_container_width=True)
            st.download_button('Download rows needing review (CSV)', pd.DataFrame(skipped).to_csv(index=False).encode('utf-8-sig'),
                               'rows_needing_review.csv', 'text/csv', key='download_metrics_review', on_click='ignore')
        if skipped or result.get('file_errors'):
            st.caption('Review details are kept in this browser session. Download them before closing or starting another import.')


# Page layout title
st.title("🏫 Academic Manager Portfolio & Teacher Performance Indicator Review Dashboard")
st.markdown("Track **School Portfolio Management**, **School WoW Velocity**, **Teacher Execution Tiers**, **Quantitative Performance Indicators (Lesson Prep / Book Content Usage)**, and **360° Qualitative Evidences & Artifact Compliance**.")


# --- 2. MULTI-EMPLOYEE HIERARCHY & DATA UPLOAD MANAGER ---
st.sidebar.header("📁 Multi-Employee Data Ingestion Portal")
st.sidebar.caption("Valid-row import build: 2026-09-30")

employee_name = st.sidebar.text_input("Enter Consultant Name:", value="Harshit Bhargava")
employee_state = st.sidebar.selectbox("Select State / Zone (India Region):", [
    "Madhya Pradesh (MP)", "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat", 
    "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", 
    "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab", 
    "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", 
    "Uttarakhand", "West Bengal", "Delhi NCR", "Jammu and Kashmir", "Ladakh"
])

uploaded_files = st.sidebar.file_uploader(
    "Upload UserMetrics Excel (.xlsx)", 
    type=["xlsx"], 
    accept_multiple_files=True
)

if uploaded_files:
    if st.sidebar.button("🚀 Process & Ingest Files Now", type="primary"):
        result = import_usermetrics_files(uploaded_files, employee_name, employee_state)
        if result.get('status', '').startswith('Committed'):
            fetch_master_db_from_supabase.clear()
            build_teacher_roster_cached.clear()
            st.rerun()

render_last_metrics_import()

df = fetch_master_db_from_supabase()

# --- 3. GRANULAR CLOUD DATABASE MANAGEMENT ---
st.sidebar.markdown("---")
st.sidebar.header("🗄️ Granular Database Management")

if st.sidebar.button("🔄 Sync Latest Records"):
    fetch_master_db_from_supabase.clear()
    build_teacher_roster_cached.clear()
    st.rerun()

with st.sidebar.expander("📦 One-Time Data Import (Old App Data)"):
    st.caption("Imports all historical records from legacy `master_database.parquet` and the `submissions/` JSON folder into PostgreSQL.")
    if st.button("🚀 Run One-Time Import", key="btn_run_historical_import"):
        with st.spinner("Downloading and migrating historical data to PostgreSQL..."):
            base_df = pd.DataFrame()
            try:
                res = supabase.storage.from_(BUCKET_NAME).download("master_database.parquet")
                if res:
                    base_df = pd.read_parquet(BytesIO(res))
                    st.sidebar.info(f"Loaded {len(base_df)} rows from master_database.parquet")
            except Exception as e:
                st.sidebar.warning(f"Parquet check notice: {e}")

            sub_records = []
            try:
                file_list = supabase.storage.from_(BUCKET_NAME).list("submissions", {"limit": 10000})
                if file_list:
                    for item in file_list:
                        fname = item.get('name', '')
                        if fname.endswith('.json'):
                            raw = supabase.storage.from_(BUCKET_NAME).download(f"submissions/{fname}")
                            if raw:
                                sub_records.append(json.loads(raw.decode('utf-8')))
                    if sub_records:
                        st.sidebar.info(f"Loaded {len(sub_records)} submissions from submissions/ folder")
            except Exception as e:
                st.sidebar.warning(f"Submissions check notice: {e}")

            subs_df = pd.DataFrame(sub_records) if sub_records else pd.DataFrame()
            combined_legacy = pd.concat([base_df, subs_df], ignore_index=True) if not base_df.empty else subs_df

            if not combined_legacy.empty:
                combined_legacy = normalize_identity_columns(combined_legacy)
                inserted_count, duplicate_count = ingest_excel_to_postgresql([combined_legacy])
                st.sidebar.success(f"🎉 Historical import complete: {inserted_count} new record(s) inserted!")
                fetch_master_db_from_supabase.clear()
                build_teacher_roster_cached.clear()
                st.rerun()
            else:
                st.sidebar.error("No historical parquet or JSON files found in Supabase storage.")

with st.sidebar.expander("🛟 Restore from R2 Backups (Disaster Recovery)"):
    st.caption(
        "Every new submission from the teacher app now also writes a JSON "
        "copy of its row(s) to `backups/teacher_records/` in R2, independent "
        "of Postgres. Use this after any accidental deletion to re-insert "
        "whatever is missing — duplicates are skipped automatically via "
        "Record_Hash, so it's always safe to re-run."
    )
    if not R2_DELETE_ENABLED:
        st.warning("R2 delete/read credentials aren't configured in this app's secrets, so backups can't be listed here yet.")
    elif st.button("🔁 Restore Missing Records from R2", key="btn_restore_r2_backups"):
        with st.spinner("Listing and downloading R2 backup files..."):
            restored_records = []
            try:
                paginator = r2_delete_client.get_paginator("list_objects_v2")
                for page in paginator.paginate(Bucket=R2_DELETE_BUCKET_NAME, Prefix="backups/teacher_records/"):
                    for obj in page.get("Contents", []):
                        key = obj["Key"]
                        if not key.endswith(".json"):
                            continue
                        try:
                            raw = r2_delete_client.get_object(Bucket=R2_DELETE_BUCKET_NAME, Key=key)["Body"].read()
                            parsed = json.loads(raw.decode("utf-8"))
                            if isinstance(parsed, list):
                                restored_records.extend(parsed)
                            else:
                                restored_records.append(parsed)
                        except Exception as file_err:
                            st.sidebar.warning(f"Skipped unreadable backup {key}: {file_err}")
            except Exception as e:
                st.sidebar.error(f"Could not list R2 backups: {e}")
                restored_records = []

            if restored_records:
                restore_df = normalize_identity_columns(pd.DataFrame(restored_records))
                inserted_count, duplicate_count = ingest_excel_to_postgresql([restore_df], source="R2 recovery")
                st.sidebar.success(
                    f"🎉 Restore complete: {inserted_count} record(s) re-inserted, "
                    f"{duplicate_count} already present and skipped."
                )
                fetch_master_db_from_supabase.clear()
                build_teacher_roster_cached.clear()
                st.rerun()
            else:
                st.sidebar.info("No R2 backup files found under backups/teacher_records/.")

if not df.empty:
    st.sidebar.metric("Database Total Records", len(df))

    dedup_confirm = st.sidebar.checkbox("I have exported a backup before duplicate cleanup", disabled=not DESTRUCTIVE_ENABLED)
    if st.sidebar.button("🧹 Remove Exact Duplicate Records", disabled=not DESTRUCTIVE_ENABLED or not dedup_confirm):
        with st.spinner("Backfilling content hashes and collapsing exact duplicates..."):
            backfilled = backfill_teacher_records_hash()
            removed = 0
            try:
                with conn.engine.begin() as c:
                    before = c.execute(text('SELECT COUNT(*) FROM teacher_records')).scalar() or 0
                    c.execute(text('''
                        DELETE FROM teacher_records a
                        USING teacher_records b
                        WHERE a.ctid < b.ctid
                          AND a."Record_Hash" = b."Record_Hash"
                          AND a."Record_Hash" IS NOT NULL
                          AND LOWER(COALESCE(a."Type",'')) <> 'classroom reflection'
                          AND LOWER(COALESCE(b."Type",'')) <> 'classroom reflection'
                          AND COALESCE(a."Voice_Note_Link",'') = '' AND COALESCE(a."Lesson_Plan_Picture",'') = '' AND COALESCE(a."Video_Evidence_1",'') = '' AND COALESCE(a."Video_Evidence_2",'') = '' AND COALESCE(a."Video_Evidence_3",'') = '' AND COALESCE(a."Writing_Sample_Link",'') = '' AND COALESCE(a."Phonics_Evidence_Link",'') = '' AND COALESCE(a."Portfolio_Evidence_Link",'') = '' AND COALESCE(a."Student_Assessment_Link",'') = '' AND COALESCE(a."Event_Pictures_Link",'') = ''
                          AND COALESCE(b."Voice_Note_Link",'') = '' AND COALESCE(b."Lesson_Plan_Picture",'') = '' AND COALESCE(b."Video_Evidence_1",'') = '' AND COALESCE(b."Video_Evidence_2",'') = '' AND COALESCE(b."Video_Evidence_3",'') = '' AND COALESCE(b."Writing_Sample_Link",'') = '' AND COALESCE(b."Phonics_Evidence_Link",'') = '' AND COALESCE(b."Portfolio_Evidence_Link",'') = '' AND COALESCE(b."Student_Assessment_Link",'') = '' AND COALESCE(b."Event_Pictures_Link",'') = '' 
                    '''))
                    after = c.execute(text('SELECT COUNT(*) FROM teacher_records')).scalar() or 0
                    removed = before - after
            except Exception as e:
                st.sidebar.error(f"Dedup cleanup error: {e}")

            fetch_master_db_from_supabase.clear()
            build_teacher_roster_cached.clear()
            st.sidebar.success(f"✅ Backfilled {backfilled} legacy row(s), removed {removed} duplicate row(s).")
            st.rerun()

    with st.sidebar.expander("🛠️ Selective Database Cleanup"):
        if not DESTRUCTIVE_ENABLED:
            st.caption("Deletion is disabled. A protected admin session and access.allow_destructive_admin=true are required.")
        cleanup_phrase = st.text_input("Type DELETE to confirm the chosen cleanup scope", key="cleanup_phrase")
        cleanup_allowed = DESTRUCTIVE_ENABLED and cleanup_phrase == "DELETE"
        clean_mode = st.radio("Select Cleanup Scope:", ["By Consultant Name & State/Zone", "By School", "Clear Entire DB"])
        
        if clean_mode == "By Consultant Name & State/Zone":
            del_emp_name = st.text_input("Enter Exact Consultant Name to Delete:", value="")
            del_state_zone = st.selectbox("Select State/Zone for Cleanup:", [
                "Madhya Pradesh (MP)", "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat", 
                "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", 
                "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab", 
                "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", 
                "Uttarakhand", "West Bengal", "Delhi NCR", "Jammu and Kashmir", "Ladakh"
            ], key="del_state_select")
            
            if st.button("🗑️ Delete Consultant Records from SQL DB", disabled=not cleanup_allowed):
                try:
                    if not del_emp_name.strip():
                        st.error("Please enter the consultant name.")
                    else:
                        with conn.session as s:
                            del_result = s.execute(
                                text('''
                                    DELETE FROM teacher_records
                                    WHERE LOWER(TRIM("Uploaded_By")) = LOWER(TRIM(:name))
                                      AND TRIM("State_Zone") = TRIM(:state)
                                '''),
                                {"name": del_emp_name.strip(), "state": del_state_zone}
                            )
                            deleted_rows = del_result.rowcount
                            s.commit()
                        fetch_master_db_from_supabase.clear()
                        build_teacher_roster_cached.clear()
                        if deleted_rows and deleted_rows > 0:
                            st.success(f"Successfully deleted {deleted_rows} record(s) for {del_emp_name} in {del_state_zone}!")
                        else:
                            st.warning(
                                f"No records matched '{del_emp_name}' in '{del_state_zone}' — nothing was deleted. "
                                "Check for a name/state mismatch with how the data was originally uploaded "
                                "(the delete no longer requires an exact State/Zone string match, but the "
                                "consultant name and state must still exist together in the database)."
                            )
                        st.rerun()
                except Exception as e:
                    st.error(f"Error deleting consultant data: {e}")
                    
        elif clean_mode == "By School":
            schools_in_db = sorted(df['Institution'].dropna().unique().tolist()) if 'Institution' in df.columns else []
            target_del_school = st.selectbox("Select School to Delete:", options=schools_in_db)
            if st.button("🗑️ Delete School Data from SQL DB", disabled=not cleanup_allowed):
                try:
                    with conn.session as s:
                        s.execute(text('DELETE FROM teacher_records WHERE "Institution" = :school'), {"school": target_del_school})
                        s.commit()
                    fetch_master_db_from_supabase.clear()
                    build_teacher_roster_cached.clear()
                    st.success(f"Successfully removed data for {target_del_school} from database!")
                    st.rerun()
                except Exception as e:
                    st.error(f"Error deleting school data: {e}")
                    
        else:
            if st.button("🚨 Clear Entire Database Table", key="clear_entire_teacher_db", disabled=not cleanup_allowed):
                try:
                    with conn.session as s:
                        delete_result = s.execute(text("DELETE FROM teacher_records;"))
                        deleted_count = delete_result.rowcount
                        s.commit()

                    fetch_master_db_from_supabase.clear()
                    build_teacher_roster_cached.clear()
                    st.session_state.pop("master_df", None)
                    st.session_state.pop("df", None)
                    st.session_state.pop("filtered_df", None)
                    st.session_state.pop("school_filtered_df", None)

                    st.sidebar.success(
                        f"✅ Database cleared successfully: {deleted_count if deleted_count >= 0 else 'all'} record(s) deleted."
                    )
                    st.rerun()
                except Exception as e:
                    fetch_master_db_from_supabase.clear()
                    build_teacher_roster_cached.clear()
                    st.sidebar.error(f"❌ Could not clear teacher_records: {type(e).__name__}: {e}")

if df.empty:
    st.info("👋 Upload your `UserMetrics.xlsx` file in the sidebar and click **'🚀 Process & Ingest Files Now'** to populate your dashboard.")
else:
    df = add_review_dates(df)
    df['Month_Name'] = df['StartTime'].dt.strftime('%B %Y')
    df['Month_Sort'] = df['StartTime'].dt.strftime('%Y-%m')
    
    def get_week_of_month(dt):
        try:
            first_day = dt.replace(day=1)
            dom = dt.day
            adjusted_dom = dom + first_day.weekday()
            return int(np.ceil(adjusted_dom / 7.0))
        except:
            return 1

    df['Week_Num'] = df['StartTime'].apply(get_week_of_month)
    
    week_ranges = df.groupby(['Month_Name', 'Week_Num'])['Date'].agg(['min', 'max']).reset_index()
    week_ranges['Week_Date_Range'] = (
        week_ranges['min'].apply(lambda x: x.strftime('%b %d') if pd.notna(x) else '') + " to " + 
        week_ranges['max'].apply(lambda x: x.strftime('%b %d') if pd.notna(x) else '')
    )
    
    df = df.merge(week_ranges[['Month_Name', 'Week_Num', 'Week_Date_Range']], on=['Month_Name', 'Week_Num'], how='left')
    df['Month_Week_Label'] = df['StartTime'].dt.strftime('%b %Y') + " - Week " + df['Week_Num'].astype(str) + " (" + df['Week_Date_Range'] + ")"
    df['Week'] = df['Month_Week_Label']

    master_teacher_roster = build_teacher_roster_cached(df)
    if master_teacher_roster.empty:
        master_teacher_roster = df[['Institution', 'FullName', 'Uploaded_By', 'State_Zone']].drop_duplicates()
    else:
        master_teacher_roster = master_teacher_roster[['Institution', 'FullName', 'Uploaded_By', 'State_Zone']].drop_duplicates()

    # --- HIERARCHICAL GLOBAL FILTERS ---
    st.sidebar.markdown("---")
    st.sidebar.header("🔍 Hierarchical Global Filters")

    if st.sidebar.button("🔄 Refresh Live Data", use_container_width=True, help="Force-fetch the latest submissions now instead of waiting for the cache to expire."):
        fetch_master_db_from_supabase.clear()
        build_teacher_roster_cached.clear()
        st.rerun()

    def _sync_multiselect_selection(widget_key, known_key, current_options, default_options):
        """
        Keeps a multiselect's selection in sync as new options (new states,
        consultants, schools) appear across reruns/sessions, instead of only
        applying `default=` on first render. Any option not seen before is
        auto-added to the current selection so new data isn't silently
        hidden until a manual reselect or full app reboot.
        """
        previously_known = set(st.session_state.get(known_key, []))
        newly_seen = [o for o in current_options if o not in previously_known]

        if widget_key not in st.session_state:
            st.session_state[widget_key] = list(default_options)
        elif newly_seen:
            merged = list(st.session_state[widget_key]) + [o for o in newly_seen if o not in st.session_state[widget_key]]
            st.session_state[widget_key] = merged

        # Drop any stale selections for options that no longer exist at all.
        st.session_state[widget_key] = [o for o in st.session_state[widget_key] if o in current_options]
        st.session_state[known_key] = current_options

    all_states = sorted([str(s) for s in df['State_Zone'].unique() if str(s).strip() and str(s).lower() not in ['nan', 'none']])
    default_states = ["Madhya Pradesh (MP)"] if "Madhya Pradesh (MP)" in all_states else all_states

    if all_states:
        _sync_multiselect_selection("gf_selected_states", "_known_states", all_states, default_states)
        selected_states = st.sidebar.multiselect("1. Select State(s) / Zone(s)", options=all_states, key="gf_selected_states")
        df_state = df[df['State_Zone'].isin(selected_states)]
    else:
        df_state = df

    all_employees = sorted([str(e) for e in df_state['Uploaded_By'].unique() if str(e).strip() and str(e).lower() not in ['nan', 'none']])
    if all_employees:
        _sync_multiselect_selection("gf_selected_employees", "_known_employees", all_employees, all_employees)
        selected_employees = st.sidebar.multiselect("2. Select Consultant(s)", options=all_employees, key="gf_selected_employees")
        df_emp = df_state[df_state['Uploaded_By'].isin(selected_employees)]
    else:
        df_emp = df_state

    all_schools = sorted([str(s) for s in df_emp['Institution'].unique() if str(s).strip() and str(s).lower() not in ['nan', 'none']])
    _sync_multiselect_selection("gf_selected_schools", "_known_schools", all_schools, all_schools)
    selected_schools = st.sidebar.multiselect("3. Select School(s)", options=all_schools, key="gf_selected_schools")

    new_schools_this_run = [s for s in all_schools if s not in set(st.session_state.get("_seen_schools_ever", []))]
    st.session_state["_seen_schools_ever"] = list(set(st.session_state.get("_seen_schools_ever", [])) | set(all_schools))
    if new_schools_this_run and st.session_state.get("_filters_initialized", False):
        st.sidebar.success(f"✅ Auto-added {len(new_schools_this_run)} new school(s) to your filters: {', '.join(new_schools_this_run)}")
    st.session_state["_filters_initialized"] = True

    school_master_roster = build_teacher_roster_cached(df_emp)[['Institution','FullName','Uploaded_By','State_Zone']]
    school_master_roster = school_master_roster[school_master_roster.Institution.isin(selected_schools)]
    school_filtered_df = df_emp[df_emp['Institution'].isin(selected_schools)]

    # --- CALENDAR & HOLIDAY MANAGER ---
    st.sidebar.markdown("---")
    st.sidebar.header("📅 Calendar & Holiday Manager")
    
    available_months_df = school_filtered_df[['Month_Sort', 'Month_Name']].dropna().drop_duplicates().sort_values(by='Month_Sort', ascending=False)
    month_options = available_months_df['Month_Name'].tolist()
    
    selected_month = st.sidebar.selectbox("Month for adding holiday exclusions:", options=month_options if month_options else ["All Months"])
    month_filtered_df = school_filtered_df[school_filtered_df['Month_Name'] == selected_month] if selected_month != "All Months" else school_filtered_df
    
    exclude_sundays_flag = st.sidebar.checkbox("🗓️ Exclude Sundays from Performance Indicators", value=True)
    use_teacher_eligible_days = st.sidebar.checkbox(
        "🏫 Apply saved school holiday calendars", value=True,
        help="Uses the full selected period, excluding Sundays and school-specific holidays. Activity gaps never shorten the target."
    )

    SCHOOL_HOLIDAYS = {}
    try:
        if workflow_ready(conn):
            with conn.engine.connect() as c:
                for sch, dates in c.execute(text('SELECT school,calendar_dates FROM portal_school_plans')):
                    SCHOOL_HOLIDAYS[sch] = json.loads(dates) if isinstance(dates, str) else (dates or [])
    except Exception as e:
        st.sidebar.warning(f"School calendars could not be loaded: {e}")
    user_excluded_dates = []
    try:
        selected_month_start = pd.to_datetime(selected_month, format="%B %Y").date()
        selected_month_end = (pd.Timestamp(selected_month_start) + pd.offsets.MonthEnd(1)).date()
    except Exception:
        selected_month_start = month_filtered_df['Date'].min() if not month_filtered_df.empty else None
        selected_month_end = month_filtered_df['Date'].max() if not month_filtered_df.empty else None

    if selected_month_start is not None and selected_month_end is not None:
        all_month_possible_dates = [d.date() for d in pd.date_range(selected_month_start, selected_month_end)]
        user_excluded_dates = st.sidebar.multiselect(
            f"🗓️ Punch Holidays for {selected_month}:", options=all_month_possible_dates,
            format_func=lambda x: x.strftime('%Y-%m-%d')
        )

    # --- GLOBAL DATE FILTER (Custom Range only) ---
    # Previously offered 4 granularity modes (Full Month / Specific Week /
    # Single Day / Custom Range) via a radio button. Simplified to a single
    # always-on custom date range picker per requirements — every value this
    # used to produce (filtered_df, selected_num_days, filter_description_text,
    # c_start/c_end) is still produced the same way, so nothing downstream
    # (report generation, CRM box, WhatsApp summary, etc.) needed to change.
    st.sidebar.subheader("🔍 Review View Level")
    view_mode = "Custom Date Range"  # kept as a constant so get_period_bounds_for_view below is unchanged

    min_avail = school_filtered_df['Date'].dropna().min() if not school_filtered_df['Date'].dropna().empty else pd.Timestamp.now().date()
    max_avail = school_filtered_df['Date'].dropna().max() if not school_filtered_df['Date'].dropna().empty else pd.Timestamp.now().date()

    custom_date_range = st.sidebar.date_input("Select Custom Date Range:", value=(min_avail, max_avail), min_value=pd.Timestamp("2020-01-01").date(), max_value=max(max_avail, pd.Timestamp.now().date()))
    if isinstance(custom_date_range, (tuple, list)) and len(custom_date_range) == 2:
        c_start, c_end = custom_date_range
    elif isinstance(custom_date_range, (tuple, list)) and len(custom_date_range) == 1:
        c_start = c_end = custom_date_range[0]
    else:
        c_start = c_end = custom_date_range

    filtered_df = school_filtered_df[(school_filtered_df['Date'] >= c_start) & (school_filtered_df['Date'] <= c_end)]
    selected_num_days = get_working_days(c_start, c_end, user_excluded_dates, exclude_sundays=exclude_sundays_flag)
    filter_description_text = f"Custom Range: {c_start} to {c_end} - {selected_num_days} Working Days"

    # 4. Global Teacher Filter
    available_teachers = sorted([str(t) for t in school_master_roster['FullName'].unique() if str(t).strip()])
    selected_teachers = st.sidebar.multiselect("4. Select Teacher(s)", options=available_teachers, default=available_teachers)
    
    filtered_roster = school_master_roster[school_master_roster['FullName'].isin(selected_teachers)]
    filtered_df = filtered_df[filtered_df['FullName'].isin(selected_teachers)]

    period_start, period_end = get_period_bounds_for_view(
        selected_month, view_mode, month_filtered_df,
        c_start if view_mode == "Custom Date Range" else None,
        c_end if view_mode == "Custom Date Range" else None
    )
    teacher_days = teacher_days_map(
        filtered_roster, filtered_df, period_start, period_end,
        user_excluded_dates, exclude_sundays_flag
    ) if use_teacher_eligible_days else {}

    # Global Content / Book dataset derivation
    global_content_df = filtered_df[usage_masks(filtered_df)[2]]

    if filtered_roster.empty:
        st.info("No teachers in the selected scope. Choose a state, consultant, school and teacher to continue.")
        st.stop()
    scope_settings = dict(period=[str(c_start),str(c_end)], schools=selected_schools,
        consultants=selected_employees,states=selected_states,teachers=selected_teachers,
        holidays=[str(d) for d in user_excluded_dates], school_holidays=SCHOOL_HOLIDAYS,
        school_calendars=use_teacher_eligible_days,
        controls={k:str(v) for k,v in st.session_state.items() if k.startswith(('t1_','t2_','t3_','t4_','t7_','tab1_','tab2_','top_teacher_select')) and 'ready' not in k})
    report_signature = report_fingerprint(filtered_df, scope_settings)
    if st.session_state.get('_report_signature') != report_signature:
        for state_key in list(st.session_state):
            if state_key.endswith(('_pdf_ready','_xlsx_ready')) or state_key.startswith(('pdf_360_','bulk_pdf_','hosted_pdf_url_','ai_gen_output_','wa_textarea_')) or state_key == 'master_db_export_ready':
                st.session_state.pop(state_key, None)
        st.session_state['_report_signature'] = report_signature

    # --- SIDEBAR DIRECT EXCEL EXPORT ---
    st.sidebar.markdown("---")
    st.sidebar.subheader("📥 Direct Admin Master Export")
    if st.sidebar.button("📦 Prepare Master DB Export"):
        buf_master_xlsx = BytesIO()
        with pd.ExcelWriter(buf_master_xlsx, engine='openpyxl') as writer:
            filtered_df.to_excel(writer, index=False, sheet_name="Filtered_Database_Logs")
        st.session_state["master_db_export_ready"] = buf_master_xlsx.getvalue()

    if "master_db_export_ready" in st.session_state:
        st.sidebar.download_button(
            label="📥 Download Prepared Master DB (Excel)",
            data=st.session_state["master_db_export_ready"],
            file_name=f"Master_Database_Export_{pd.Timestamp.now().strftime('%Y%m%d_%H%M%S')}.xlsx",
            mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )

    # 6 Dedicated Active Tabs
    tab1, tab2, tab3, tab4, tab7, tab8, tab9, tab10 = st.tabs([
        "📘 1. Lesson Plan Preparation Tracker", 
        "📚 2. Library Usage Tracker", 
        "📖 3. Content & Chapters (Primary KPI)", 
        "👤 4. Teacher 360° Profile Report",
        "📬 5. Live Evidence Submissions Feed",
        "📋 6. Classroom Visit Observation Form",
        "🧭 7. Consultant Workspace",
        "✅ 8. Data Quality & Imports"
    ])

    # TAB 1: LESSON PLAN PREPARATION TRACKER
    with tab1:
        st.header("📘 Lesson Plan Preparation Tracker")
        
        with st.expander("🎯 Lesson Prep Target Benchmark Settings", expanded=False):
            t1_kcol1, t1_kcol2 = st.columns(2)
            with t1_kcol1:
                enable_quant_kpi_t1 = st.checkbox("Enable Lesson Prep Quantitative Benchmark", value=True, key="t1_enable_quant_kpi")
            with t1_kcol2:
                daily_ld_target_t1 = st.number_input("Lesson Prep Target (Mins/Day)", min_value=0.0, max_value=60.0, value=10.0, step=5.0, key="t1_ld_target", disabled=not enable_quant_kpi_t1) if enable_quant_kpi_t1 else 0.0

        calc_ld_kpi_t1 = calculate_kpi_target(daily_ld_target_t1, selected_num_days, enable_quant_kpi_t1)
        st.session_state['calc_ld_kpi_t1'] = calc_ld_kpi_t1
        st.session_state['daily_ld_target_t1'] = daily_ld_target_t1

        tab1_col_f1, tab1_col_f2 = st.columns(2)
        with tab1_col_f1:
            tab1_schools = ["All Selected Schools"] + sorted([s for s in filtered_df['Institution'].unique() if str(s).strip()])
            tab1_selected_school = st.selectbox("Filter Tab by School:", tab1_schools, key="tab1_school_filter")
        
        tab1_active_df = filtered_df if tab1_selected_school == "All Selected Schools" else filtered_df[filtered_df['Institution'] == tab1_selected_school]
        tab1_active_roster = filtered_roster if tab1_selected_school == "All Selected Schools" else filtered_roster[filtered_roster['Institution'] == tab1_selected_school]

        with tab1_col_f2:
            tab1_teachers = ["All Teachers"] + sorted([t for t in tab1_active_roster['FullName'].unique() if str(t).strip()])
            tab1_selected_teacher = st.selectbox("Filter Tab by Teacher:", tab1_teachers, key="tab1_teacher_filter")
            
        if tab1_selected_teacher != "All Teachers":
            tab1_active_df = tab1_active_df[tab1_active_df['FullName'] == tab1_selected_teacher]
            tab1_active_roster = tab1_active_roster[tab1_active_roster['FullName'] == tab1_selected_teacher]

        if enable_quant_kpi_t1 and calc_ld_kpi_t1 > 0:
            st.caption(f"Benchmark Standard: **At least {calc_ld_kpi_t1:.0f} Minutes** ({daily_ld_target_t1:.0f} mins/day across {selected_num_days} working day(s)).")
        else:
            st.caption(f"Reviewing cumulative minutes prepared across {selected_num_days} working day(s).")

        ld_df = tab1_active_df[usage_masks(tab1_active_df)[0]]
        ld_usage = ld_df.groupby(['Institution', 'FullName'])['Duration_Min'].sum().reset_index()
        ld_daily = tab1_active_roster.merge(ld_usage, on=['Institution', 'FullName'], how='left').fillna(0.0)
        ld_daily['Eligible Working Days'] = ld_daily.apply(lambda r: teacher_days.get((r['Institution'], r['FullName']), selected_num_days) if use_teacher_eligible_days else selected_num_days, axis=1)
        ld_daily['Performance Benchmark (Min)'] = ld_daily['Eligible Working Days'] * daily_ld_target_t1
        
        ld_daily['Performance Indicator Status'] = ld_daily.apply(lambda r: calculate_kpi_status(r['Duration_Min'], r['Performance Benchmark (Min)'], enable_quant_kpi_t1, r['Eligible Working Days'] == 0), axis=1)

        c1, c2, c3, c4 = st.columns(4)
        total_teachers = len(ld_daily)
        met_count = len(ld_daily[(ld_daily['Duration_Min'] >= ld_daily['Performance Benchmark (Min)']) & (ld_daily['Performance Benchmark (Min)'] > 0)]) if enable_quant_kpi_t1 else len(ld_daily[ld_daily['Duration_Min'] > 0])
        inactive_count = len(ld_daily[ld_daily['Duration_Min'] == 0.0])
        
        c1.metric("Total Roster Teachers", total_teachers)
        c2.metric(f"Met Standard ({calc_ld_kpi_t1:.0f}m)" if enable_quant_kpi_t1 else "Active Teachers", f"{met_count} / {total_teachers}")
        c3.metric("No recorded usage (0m)", inactive_count, delta=f"{-inactive_count}" if inactive_count > 0 else "0", delta_color="inverse")
        c4.metric("Compliance Rate", f"{(met_count/total_teachers*100 if total_teachers>0 else 0):.1f}%")

        ld_daily['Teacher / School'] = ld_daily['FullName'] + ' | ' + ld_daily['Institution']
        fig_ld = px.bar(
            ld_daily, x="Teacher / School", y="Duration_Min", color="Performance Indicator Status",
            title=f"Lesson Prep Minutes per Teacher" + (f" vs. {calc_ld_kpi_t1:.0f} Min Standard" if enable_quant_kpi_t1 else ""),
            labels={"FullName": "Teacher Name", "Duration_Min": "Recorded Prep Access Minutes"},
            text_auto=".1f"
        )
        if enable_quant_kpi_t1 and calc_ld_kpi_t1 > 0:
            fig_ld.add_trace(go.Scatter(x=ld_daily["Teacher / School"], y=ld_daily["Performance Benchmark (Min)"], mode="markers", name="Applicable target", marker=dict(symbol="line-ew", size=18, color="black")))
        st.plotly_chart(fig_ld, use_container_width=True)

        display_ld_table = ld_daily.rename(columns={'Institution': 'School', 'FullName': 'Teacher Name', 'Duration_Min': 'Minutes Logged'}).round({'Minutes Logged': 1})
        st.dataframe(display_ld_table, use_container_width=True)

        col_t1_d1, col_t1_d2 = st.columns(2)
        with col_t1_d1:
            t1_show_lp = st.checkbox("Include Lesson Plan section in PDF", value=True, key="t1_show_lp_section")
            t1_show_evidence = st.checkbox("Include Classroom Activity Evidence in PDF", value=True, key="t1_show_evidence_section")
            if st.button("⚙️ Compile Tab 1 PDF Report", key="prep_pdf_tab1_btn"):
                with st.spinner("Compiling PDF report..."):
                    pdf_bytes = generate_comprehensive_school_pdf_report(
                        school_name=tab1_selected_school if tab1_selected_school != "All Selected Schools" else tab1_active_roster.Institution.unique().tolist(),
                        teachers_list=tab1_active_roster[["Institution","FullName"]].drop_duplicates().apply(tuple,axis=1).tolist(),
                        school_filtered_df=school_filtered_df,
                        filtered_df=tab1_active_df,
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
                        active_metric_mode="Both",
                        show_lesson_plan_report=t1_show_lp,
                        show_evidence_section=t1_show_evidence
                    ).getvalue()
                    st.session_state["tab1_pdf_ready"] = pdf_bytes

            if "tab1_pdf_ready" in st.session_state:
                st.download_button(
                    label="📄 Download Tab 1 Report (PDF)",
                    data=st.session_state["tab1_pdf_ready"],
                    file_name=f"Lesson_Plan_Prep_Report_{selected_month.replace(' ', '_')}.pdf",
                    mime="application/pdf",
                    key="btn_pdf_tab1"
                )

        with col_t1_d2:
            if st.button("⚙️ Prepare Tab 1 Excel Export", key="prep_xlsx_tab1_btn"):
                buf_t1_xlsx = BytesIO()
                with pd.ExcelWriter(buf_t1_xlsx, engine='openpyxl') as writer:
                    display_ld_table.to_excel(writer, index=False, sheet_name="Lesson_Prep_Logs")
                st.session_state["tab1_xlsx_ready"] = buf_t1_xlsx.getvalue()

            if "tab1_xlsx_ready" in st.session_state:
                st.download_button(
                    label="📥 Download Tab 1 Data (Excel)",
                    data=st.session_state["tab1_xlsx_ready"],
                    file_name=f"Lesson_Plan_Prep_{selected_month.replace(' ', '_')}.xlsx",
                    mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    key="btn_xlsx_tab1"
                )

        teacher_prep_breakdown = "\n\n".join([f"• **{r['FullName']}**: {r['Duration_Min']:.1f} mins ({r['Performance Indicator Status']})" for _, r in ld_daily.iterrows()])
        tab1_metrics_summary = (
            f"🎯 Target KPI: {daily_ld_target_t1:.0f} mins/day × {selected_num_days} working days = {calc_ld_kpi_t1:.0f} mins total standard\n"
            f"Total Roster: {total_teachers} teachers | Met Standard: {met_count} | Inactive: {inactive_count} | Compliance Rate: {(met_count/total_teachers*100 if total_teachers>0 else 0):.1f}%\n\n"
            f"Detailed Teacher Lesson Prep Logs:\n{teacher_prep_breakdown}"
        )
        render_universal_crm_box("Lesson Plan Prep Tracker", tab1_active_roster.Institution.unique().tolist(), filter_description_text, tab1_metrics_summary)

    # TAB 2: LIBRARY USAGE TRACKER
    with tab2:
        st.header("📚 Library Usage Tracker")
        st.caption("Review digital library research, supplementary assets, and general platform exploration.")
        
        with st.expander("🎯 Library Target Benchmark Settings", expanded=False):
            t2_kcol1, t2_kcol2 = st.columns(2)
            with t2_kcol1:
                enable_quant_kpi_t2 = st.checkbox("Enable Library Quantitative Benchmark", value=True, key="t2_enable_quant_kpi")
            with t2_kcol2:
                daily_lib_target_t2 = st.number_input("Library Usage Target (Mins/Day)", min_value=0.0, max_value=120.0, value=30.0, step=5.0, key="t2_lib_target", disabled=not enable_quant_kpi_t2) if enable_quant_kpi_t2 else 0.0

        calc_lib_kpi_t2 = calculate_kpi_target(daily_lib_target_t2, selected_num_days, enable_quant_kpi_t2)
        st.session_state['calc_lib_kpi_t2'] = calc_lib_kpi_t2
        st.session_state['daily_lib_target_t2'] = daily_lib_target_t2

        tab2_col_f1, tab2_col_f2 = st.columns(2)
        with tab2_col_f1:
            tab2_schools = ["All Selected Schools"] + sorted([s for s in filtered_df['Institution'].unique() if str(s).strip()])
            tab2_selected_school = st.selectbox("Filter Tab by School:", tab2_schools, key="tab2_school_filter")
        
        tab2_active_df = filtered_df if tab2_selected_school == "All Selected Schools" else filtered_df[filtered_df['Institution'] == tab2_selected_school]
        tab2_active_roster = filtered_roster if tab2_selected_school == "All Selected Schools" else filtered_roster[filtered_roster['Institution'] == tab2_selected_school]

        with tab2_col_f2:
            tab2_teachers = ["All Teachers"] + sorted([t for t in tab2_active_roster['FullName'].unique() if str(t).strip()])
            tab2_selected_teacher = st.selectbox("Filter Tab by Teacher:", tab2_teachers, key="tab2_teacher_filter")
            
        if tab2_selected_teacher != "All Teachers":
            tab2_active_df = tab2_active_df[tab2_active_df['FullName'] == tab2_selected_teacher]
            tab2_active_roster = tab2_active_roster[tab2_active_roster['FullName'] == tab2_selected_teacher]

        if enable_quant_kpi_t2 and calc_lib_kpi_t2 > 0:
            st.caption(f"Benchmark Standard: **At least {calc_lib_kpi_t2:.0f} Minutes** ({daily_lib_target_t2:.0f} mins/day across {selected_num_days} working day(s)).")
        else:
            st.caption(f"Reviewing cumulative library usage minutes across {selected_num_days} working day(s).")

        lib_df = tab2_active_df[usage_masks(tab2_active_df)[1]]
        lib_usage = lib_df.groupby(['Institution', 'FullName'])['Duration_Min'].sum().reset_index()
        lib_daily = tab2_active_roster.merge(lib_usage, on=['Institution', 'FullName'], how='left').fillna(0.0)
        lib_daily['Eligible Working Days'] = lib_daily.apply(lambda r: teacher_days.get((r['Institution'], r['FullName']), selected_num_days) if use_teacher_eligible_days else selected_num_days, axis=1)
        lib_daily['Performance Benchmark (Min)'] = lib_daily['Eligible Working Days'] * daily_lib_target_t2
        
        lib_daily['Performance Indicator Status'] = lib_daily.apply(lambda r: calculate_kpi_status(r['Duration_Min'], r['Performance Benchmark (Min)'], enable_quant_kpi_t2, r['Eligible Working Days'] == 0), axis=1)

        m1, m2, m3, m4 = st.columns(4)
        lib_total_teachers = len(lib_daily)
        lib_met_count = len(lib_daily[(lib_daily['Duration_Min'] >= lib_daily['Performance Benchmark (Min)']) & (lib_daily['Performance Benchmark (Min)'] > 0)]) if enable_quant_kpi_t2 else len(lib_daily[lib_daily['Duration_Min'] > 0])
        lib_inactive_count = len(lib_daily[lib_daily['Duration_Min'] == 0.0])
        
        m1.metric("Total Roster Teachers", lib_total_teachers)
        m2.metric(f"Met Standard ({calc_lib_kpi_t2:.0f}m)" if enable_quant_kpi_t2 else "Active Teachers", f"{lib_met_count} / {lib_total_teachers}")
        m3.metric("No recorded usage (0m)", lib_inactive_count, delta=f"{-lib_inactive_count}" if lib_inactive_count > 0 else "0", delta_color="inverse")
        m4.metric("Engagement Rate", f"{(lib_met_count/lib_total_teachers*100 if lib_total_teachers>0 else 0):.1f}%")

        lib_daily['Teacher / School'] = lib_daily['FullName'] + ' | ' + lib_daily['Institution']
        fig_lib = px.bar(
            lib_daily, x="Teacher / School", y="Duration_Min", color="Performance Indicator Status",
            title=f"Library Usage Minutes per Teacher" + (f" vs. {calc_lib_kpi_t2:.0f} Min Standard" if enable_quant_kpi_t2 else ""),
            labels={"FullName": "Teacher Name", "Duration_Min": "Minutes Logged"},
            text_auto=".1f"
        )
        if enable_quant_kpi_t2 and calc_lib_kpi_t2 > 0:
            fig_lib.add_trace(go.Scatter(x=lib_daily["Teacher / School"], y=lib_daily["Performance Benchmark (Min)"], mode="markers", name="Applicable target", marker=dict(symbol="line-ew", size=18, color="black")))
        st.plotly_chart(fig_lib, use_container_width=True)

        display_lib_table = lib_daily.rename(columns={'Institution': 'School', 'FullName': 'Teacher Name', 'Duration_Min': 'Minutes Logged'}).round({'Minutes Logged': 1})
        st.dataframe(display_lib_table, use_container_width=True)

        col_t2_d1, col_t2_d2 = st.columns(2)
        with col_t2_d1:
            t2_show_lp = st.checkbox("Include Lesson Plan section in PDF", value=True, key="t2_show_lp_section")
            t2_show_evidence = st.checkbox("Include Classroom Activity Evidence in PDF", value=True, key="t2_show_evidence_section")
            if st.button("⚙️ Compile Tab 2 PDF Report (Library Only)", key="prep_pdf_tab2_btn"):
                with st.spinner("Compiling Library PDF report..."):
                    pdf_bytes = generate_comprehensive_school_pdf_report(
                        school_name=tab2_selected_school if tab2_selected_school != "All Selected Schools" else tab2_active_roster.Institution.unique().tolist(),
                        teachers_list=tab2_active_roster[["Institution","FullName"]].drop_duplicates().apply(tuple,axis=1).tolist(),
                        school_filtered_df=school_filtered_df,
                        filtered_df=tab2_active_df,
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
                        active_metric_mode="Library Usage",
                        show_lesson_plan_report=t2_show_lp,
                        show_evidence_section=t2_show_evidence
                    ).getvalue()
                    st.session_state["tab2_pdf_ready"] = pdf_bytes

            if "tab2_pdf_ready" in st.session_state:
                st.download_button(
                    label="📄 Download Tab 2 Report (PDF)",
                    data=st.session_state["tab2_pdf_ready"],
                    file_name=f"Library_Usage_Report_{selected_month.replace(' ', '_')}.pdf",
                    mime="application/pdf",
                    key="btn_pdf_tab2"
                )

        with col_t2_d2:
            if st.button("⚙️ Prepare Tab 2 Excel Export", key="prep_xlsx_tab2_btn"):
                buf_t2_xlsx = BytesIO()
                with pd.ExcelWriter(buf_t2_xlsx, engine='openpyxl') as writer:
                    display_lib_table.to_excel(writer, index=False, sheet_name="Library_Usage_Logs")
                st.session_state["tab2_xlsx_ready"] = buf_t2_xlsx.getvalue()

            if "tab2_xlsx_ready" in st.session_state:
                st.download_button(
                    label="📥 Download Tab 2 Data (Excel)",
                    data=st.session_state["tab2_xlsx_ready"],
                    file_name=f"Library_Usage_{selected_month.replace(' ', '_')}.xlsx",
                    mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    key="btn_xlsx_tab2"
                )

        teacher_lib_breakdown = "\n\n".join([f"• **{r['FullName']}**: {r['Duration_Min']:.1f} mins ({r['Performance Indicator Status']})" for _, r in lib_daily.iterrows()])
        tab2_metrics_summary = (
            f"🎯 Target KPI: {daily_lib_target_t2:.0f} mins/day × {selected_num_days} working days = {calc_lib_kpi_t2:.0f} mins total standard\n"
            f"Total Roster: {lib_total_teachers} teachers | Active Met Standard: {lib_met_count} | Inactive: {lib_inactive_count} | Engagement Rate: {(lib_met_count/lib_total_teachers*100 if lib_total_teachers>0 else 0):.1f}%\n\n"
            f"Detailed Teacher Library Usage Logs:\n{teacher_lib_breakdown}"
        )
        render_universal_crm_box("Library Usage Tracker", tab2_active_roster.Institution.unique().tolist(), filter_description_text, tab2_metrics_summary)

    # TAB 3: CONTENT & CHAPTERS (PRIMARY QUANTITATIVE BENCHMARK)
    with tab3:
        st.header("📖 Content & Chapters (Primary Quantitative Benchmark)")
        st.caption(f"Track recorded textbook and chapter access during `{filter_description_text}`.")

        with st.expander("🎯 Content / Book Target Benchmark Settings", expanded=False):
            t3_kcol1, t3_kcol2 = st.columns(2)
            with t3_kcol1:
                enable_quant_kpi_t3 = st.checkbox("Enable Content Quantitative Benchmark", value=True, key="t3_enable_quant_kpi")
            with t3_kcol2:
                daily_content_target_t3 = st.number_input("Content Delivery Target (Mins/Day)", min_value=0.0, max_value=120.0, value=30.0, step=5.0, key="t3_content_target", disabled=not enable_quant_kpi_t3) if enable_quant_kpi_t3 else 0.0

        calc_content_kpi_t3 = calculate_kpi_target(daily_content_target_t3, selected_num_days, enable_quant_kpi_t3)
        st.session_state['calc_content_kpi_t3'] = calc_content_kpi_t3
        st.session_state['daily_content_target_t3'] = daily_content_target_t3

        if global_content_df.empty:
            st.info("No specific textbook/chapter access logs found in the uploaded data for the selected global filters.")
        else:
            col_f1, col_f2, col_f3 = st.columns(3)
            with col_f1:
                t3_school_opt = ["All Selected Schools"] + sorted(global_content_df['Institution'].unique().tolist())
                t3_school = st.selectbox("🏫 Select School:", t3_school_opt, key="t3_school")
                
            t3_df = global_content_df if t3_school == "All Selected Schools" else global_content_df[global_content_df['Institution'] == t3_school]
            t3_roster = filtered_roster if t3_school == "All Selected Schools" else filtered_roster[filtered_roster['Institution'] == t3_school]

            with col_f2:
                t3_teacher_opt = ["All Teachers"] + sorted(t3_roster['FullName'].unique().tolist())
                t3_teacher = st.selectbox("👤 Select Teacher:", t3_teacher_opt, key="t3_teacher")
                
            if t3_teacher != "All Teachers":
                t3_df = t3_df[t3_df['FullName'] == t3_teacher]
                t3_roster = t3_roster[t3_roster['FullName'] == t3_teacher]

            with col_f3:
                t3_subject_opt = ["All Subjects"] + sorted([s for s in t3_df['Subject'].unique().tolist() if str(s).strip()])
                t3_subject = st.selectbox("📚 Select Subject:", t3_subject_opt, key="t3_subject")

            if t3_subject != "All Subjects":
                t3_df = t3_df[t3_df['Subject'] == t3_subject]

            st.markdown("---")

            content_teacher_usage = t3_df.groupby(['Institution', 'FullName'])['Duration_Min'].sum().reset_index()
            content_daily = t3_roster.merge(content_teacher_usage, on=['Institution', 'FullName'], how='left').fillna(0.0)
            content_daily['Eligible Working Days'] = content_daily.apply(lambda r: teacher_days.get((r['Institution'], r['FullName']), selected_num_days) if use_teacher_eligible_days else selected_num_days, axis=1)
            content_daily['Performance Benchmark (Min)'] = content_daily['Eligible Working Days'] * daily_content_target_t3
            content_daily['Performance Indicator Status'] = content_daily.apply(lambda r: calculate_kpi_status(r['Duration_Min'], r['Performance Benchmark (Min)'], enable_quant_kpi_t3, r['Eligible Working Days'] == 0), axis=1)

            c_cnt_tot = len(content_daily)
            c_cnt_met = len(content_daily[(content_daily['Duration_Min'] >= content_daily['Performance Benchmark (Min)']) & (content_daily['Performance Benchmark (Min)'] > 0)]) if enable_quant_kpi_t3 else len(content_daily[content_daily['Duration_Min'] > 0])
            c_cnt_inact = len(content_daily[content_daily['Duration_Min'] == 0.0])

            ck1, ck2, ck3, ck4 = st.columns(4)
            ck1.metric("Total Roster Teachers", c_cnt_tot)
            ck2.metric(f"Met Content Benchmark ({calc_content_kpi_t3:.0f}m)" if enable_quant_kpi_t3 else "Active Teachers", f"{c_cnt_met} / {c_cnt_tot}")
            ck3.metric("No recorded usage (0m)", c_cnt_inact, delta=f"{-c_cnt_inact}" if c_cnt_inact > 0 else "0", delta_color="inverse")
            ck4.metric("Textbooks Opened", t3_df['Book'].nunique())

            content_daily['Teacher / School'] = content_daily['FullName'] + ' | ' + content_daily['Institution']
            fig_content = px.bar(
                content_daily, x="Teacher / School", y="Duration_Min", color="Performance Indicator Status",
                title=f"Textbook & Chapter Access Minutes per Teacher" + (f" vs. {calc_content_kpi_t3:.0f} Min Standard" if enable_quant_kpi_t3 else ""),
                labels={"FullName": "Teacher Name", "Duration_Min": "Recorded Access Minutes"},
                text_auto=".1f"
            )
            if enable_quant_kpi_t3 and calc_content_kpi_t3 > 0:
                fig_content.add_trace(go.Scatter(x=content_daily["Teacher / School"], y=content_daily["Performance Benchmark (Min)"], mode="markers", name="Applicable target", marker=dict(symbol="line-ew", size=18, color="black")))
            st.plotly_chart(fig_content, use_container_width=True)

            col_c1, col_c2 = st.columns(2)
            with col_c1:
                if t3_teacher != "All Teachers":
                    ch_summary = t3_df.groupby(['Book', 'Grade'])['Duration_Min'].sum().reset_index()
                    fig_ch = px.bar(
                        ch_summary, x="Duration_Min", y="Book", color="Grade", orientation="h",
                        title=f"Chapters Opened by {t3_teacher} (Mins)",
                        labels={"Duration_Min": "Minutes", "Book": "Book / Chapter"},
                        text_auto=".1f"
                    )
                    fig_ch.update_layout(yaxis={'categoryorder':'total ascending'})
                else:
                    ch_summary = t3_df.groupby(['FullName', 'Book'])['Duration_Min'].sum().reset_index()
                    fig_ch = px.bar(
                        ch_summary, x="FullName", y="Duration_Min", color="Book",
                        title="Textbooks / Chapters Opened per Teacher (Mins)",
                        labels={"FullName": "Teacher", "Duration_Min": "Minutes", "Book": "Book / Chapter"},
                        barmode="stack", text_auto=".1f"
                    )
                st.plotly_chart(fig_ch, use_container_width=True)

            with col_c2:
                subj_summary = t3_df.groupby('Subject')['Duration_Min'].sum().reset_index()
                fig_sub = px.pie(
                    subj_summary, names="Subject", values="Duration_Min",
                    title="Subject / Theme Distribution (Minutes)"
                )
                st.plotly_chart(fig_sub, use_container_width=True)

            st.subheader("📋 Filtered Granular Textbook Log")
            log_cols = ['Institution', 'FullName', 'Grade', 'Subject', 'Book', 'StartTime', 'Duration_Min']
            available_cols = [c for c in log_cols if c in t3_df.columns]
            
            display_content_log = t3_df[available_cols].rename(columns={
                'Institution': 'School', 'FullName': 'Teacher Name', 'Duration_Min': 'Minutes'
            }).sort_values(by='StartTime', ascending=False)
            display_content_log['Minutes'] = display_content_log['Minutes'].round(1)
            st.dataframe(display_content_log, use_container_width=True)

            col_d1, col_d2 = st.columns(2)
            with col_d1:
                if st.button("⚙️ Prepare Content Excel Export", key="prep_xlsx_tab3_btn"):
                    buf_t3_xlsx = BytesIO()
                    with pd.ExcelWriter(buf_t3_xlsx, engine='openpyxl') as writer:
                        display_content_log.to_excel(writer, index=False, sheet_name='Content_Log')
                    st.session_state["tab3_xlsx_ready"] = buf_t3_xlsx.getvalue()

                if "tab3_xlsx_ready" in st.session_state:
                    st.download_button(
                        label="📥 Download Content Log (Excel)",
                        data=st.session_state["tab3_xlsx_ready"],
                        file_name=f"Content_Log_{selected_month.replace(' ', '_')}.xlsx",
                        mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        key="btn_xlsx_tab3"
                    )
            with col_d2:
                t3_show_lp = st.checkbox("Include Lesson Plan section in PDF", value=True, key="t3_show_lp_section")
                t3_show_evidence = st.checkbox("Include Classroom Activity Evidence in PDF", value=True, key="t3_show_evidence_section")
                if st.button("⚙️ Compile Tab 3 PDF Report (Content Only)", key="prep_pdf_tab3_btn"):
                    with st.spinner("Compiling Content PDF..."):
                        pdf_t3 = generate_comprehensive_school_pdf_report(
                            school_name=t3_school if t3_school != "All Selected Schools" else t3_roster.Institution.unique().tolist(),
                            teachers_list=t3_roster[["Institution","FullName"]].drop_duplicates().apply(tuple,axis=1).tolist(),
                            school_filtered_df=school_filtered_df,
                            filtered_df=filtered_df.merge(t3_roster[['Institution','FullName']].drop_duplicates(), on=['Institution','FullName'], how='inner').loc[lambda d: d.Subject.eq(t3_subject) if t3_subject != 'All Subjects' else pd.Series(True,index=d.index)],
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
                            active_metric_mode="Content / Book Usage",
                            show_lesson_plan_report=t3_show_lp,
                            show_evidence_section=t3_show_evidence
                        ).getvalue()
                        st.session_state["tab3_pdf_ready"] = pdf_t3

                if "tab3_pdf_ready" in st.session_state:
                    st.download_button(
                        label="📄 Download Tab 3 Content Report (PDF)",
                        data=st.session_state["tab3_pdf_ready"],
                        file_name=f"Content_Usage_Report_{selected_month.replace(' ', '_')}.pdf",
                        mime="application/pdf",
                        key="btn_pdf_tab3"
                    )

            book_breakdown_summary = "\n\n".join([f"• {r['Book']} ({r['Grade']} - {r['Subject']}): {r['Duration_Min']:.1f} mins" for _, r in t3_df.groupby(['Book', 'Grade', 'Subject'])['Duration_Min'].sum().reset_index().iterrows()])
            tab3_metrics_summary = (
                f"🎯 Content Target: {daily_content_target_t3:.0f} mins/day × {selected_num_days} working days = {calc_content_kpi_t3:.0f} mins total standard\n"
                f"Chapters Opened: {t3_df['Book'].nunique()} | Subjects Taught: {t3_df['Subject'].nunique()} | Total Access Time: {t3_df['Duration_Min'].sum():.1f} Mins\n\n"
                f"Chapter Breakdown:\n{book_breakdown_summary}"
            )
            render_universal_crm_box("Content & Chapters", t3_school if t3_school != "All Selected Schools" else selected_schools, filter_description_text, tab3_metrics_summary)

    # TAB 4: TEACHER 360° PROFILE REPORT
    with tab4:
        st.header("👤 Teacher 360° Performance Profile")
        st.caption("Review quantitative lesson metrics, textbook delivery logs, and structured qualitative performance evidence.")

        st.caption("Evidence targets below apply to the selected review period. Set a category to 0 when not applicable. File counts do not measure teaching quality.")
        with st.expander("🎯 Teacher 360 Benchmark Controls", expanded=False):
            t4_kcol1, t4_kcol2, t4_kcol3 = st.columns(3)
            with t4_kcol1:
                enable_quant_kpi_t4 = st.checkbox("Enable Quantitative Benchmark", value=True, key="t4_enable_quant_kpi")
                daily_ld_target_t4 = st.number_input("Lesson Prep Target (Mins/Day)", min_value=0.0, max_value=60.0, value=10.0, step=5.0, key="t4_ld_target", disabled=not enable_quant_kpi_t4) if enable_quant_kpi_t4 else 0.0
                daily_content_target_t4 = st.number_input("Content / Book Target (Mins/Day)", min_value=0.0, max_value=120.0, value=30.0, step=5.0, key="t4_content_target", disabled=not enable_quant_kpi_t4) if enable_quant_kpi_t4 else 0.0
                daily_lib_target_t4 = st.number_input("Library Target (Mins/Day)", min_value=0.0, max_value=120.0, value=30.0, step=5.0, key="t4_lib_target", disabled=not enable_quant_kpi_t4) if enable_quant_kpi_t4 else 0.0
            with t4_kcol2:
                enable_qual_kpi_t4 = st.checkbox("Enable Qualitative Benchmark", value=True, key="t4_enable_qual_kpi")
                target_vid_count_t4 = st.number_input("Min. Activity Files", min_value=0, max_value=100, value=3, step=1, key="t4_vid_cnt", disabled=not enable_qual_kpi_t4) if enable_qual_kpi_t4 else 0
                target_writing_count_t4 = st.number_input("Min. Writing Samples", min_value=0, max_value=100, value=3, step=1, key="t4_writing_cnt", disabled=not enable_qual_kpi_t4) if enable_qual_kpi_t4 else 0
            with t4_kcol3:
                target_lp_combo_count_t4 = st.number_input("Min. LP / Audio Notes", min_value=0, max_value=100, value=3, step=1, key="t4_lp_cnt", disabled=not enable_qual_kpi_t4) if enable_qual_kpi_t4 else 0
                target_phonics_count_t4 = st.number_input("Min. Phonics Evidence", min_value=0, max_value=100, value=2, step=1, key="t4_ph_cnt", disabled=not enable_qual_kpi_t4) if enable_qual_kpi_t4 else 0
                target_portfolio_count_t4 = st.number_input("Min. Portfolio Artifacts", min_value=0, max_value=100, value=1, step=1, key="t4_pf_cnt", disabled=not enable_qual_kpi_t4) if enable_qual_kpi_t4 else 0

        t4_pcol1, t4_pcol2 = st.columns(2)
        with t4_pcol1:
            t4_show_lp = st.checkbox("Include Lesson Plan section in PDF", value=True, key="t4_show_lp_section")
        with t4_pcol2:
            t4_show_evidence = st.checkbox("Include Classroom Activity Evidence in PDF", value=True, key="t4_show_evidence_section")

        calc_ld_kpi_t4 = calculate_kpi_target(daily_ld_target_t4, selected_num_days, enable_quant_kpi_t4)
        calc_content_kpi_t4 = calculate_kpi_target(daily_content_target_t4, selected_num_days, enable_quant_kpi_t4)
        calc_lib_kpi_t4 = calculate_kpi_target(daily_lib_target_t4, selected_num_days, enable_quant_kpi_t4)

        t4_fcol1, t4_fcol2, t4_fcol3 = st.columns([1, 1, 1.2])
        with t4_fcol1:
            t4_schools = sorted([s for s in filtered_roster['Institution'].unique() if str(s).strip()])
            t4_selected_school = st.selectbox("Filter Roster by School:", t4_schools, key="t4_school_filter")

        t4_active_roster = filtered_roster[filtered_roster['Institution'] == t4_selected_school]
        all_roster_teachers = sorted(t4_active_roster['FullName'].unique())
        
        with t4_fcol2:
            if not all_roster_teachers:
                st.info("No teachers found in roster for the selected filter.")
                target_teacher = None
            else:
                target_teacher = st.selectbox("Select Teacher to Audit:", options=all_roster_teachers, key="top_teacher_select")

        with t4_fcol3:
            primary_view_metric = st.radio("Focus Metric in Audit & PDF:", ["📖 Content (Book) Usage", "📚 Library Usage", "Both Side-by-Side"], horizontal=True, key="t4_metric_focus")
        
        if target_teacher:
            teacher_all_data = school_filtered_df[(school_filtered_df['FullName'] == target_teacher) & school_filtered_df.Institution.eq(t4_selected_school)]
            teacher_date_data = filtered_df[(filtered_df['FullName'] == target_teacher) & filtered_df.Institution.eq(t4_selected_school)]
            teacher_school = t4_selected_school

            t_day_ld = teacher_date_data[usage_masks(teacher_date_data)[0]]['Duration_Min'].sum() if not teacher_date_data.empty else 0.0
            t_day_lib = teacher_date_data[usage_masks(teacher_date_data)[1]]['Duration_Min'].sum() if not teacher_date_data.empty else 0.0
            
            t_books_raw = teacher_date_data[teacher_date_data['Book'].str.len() > 0]
            teacher_books = t_books_raw[usage_masks(t_books_raw)[2]]
            t_day_content = teacher_books['Duration_Min'].sum() if not teacher_books.empty else 0.0

            t_eligible_days = teacher_days.get((teacher_school, target_teacher), selected_num_days) if use_teacher_eligible_days else selected_num_days
            t_calc_ld_kpi = calculate_kpi_target(daily_ld_target_t4, t_eligible_days, enable_quant_kpi_t4)
            t_calc_content_kpi = calculate_kpi_target(daily_content_target_t4, t_eligible_days, enable_quant_kpi_t4)
            t_calc_lib_kpi = calculate_kpi_target(daily_lib_target_t4, t_eligible_days, enable_quant_kpi_t4)
            
            ld_pct = safe_percentage(t_day_ld, t_calc_ld_kpi)
            content_pct = safe_percentage(t_day_content, t_calc_content_kpi)
            lib_pct = safe_percentage(t_day_lib, t_calc_lib_kpi)

            ld_advice = f"🌟 Steady Execution ({t_day_ld:.1f}m logged)" if (t_calc_ld_kpi > 0 and t_day_ld >= t_calc_ld_kpi) else (f"⚠️ In-Progress ({t_day_ld:.1f}m logged)" if t_day_ld > 0 else "❌ Pending Activity")
            content_advice = f"🌟 Steady Execution ({t_day_content:.1f}m logged)" if (t_calc_content_kpi > 0 and t_day_content >= t_calc_content_kpi) else (f"⚠️ In-Progress ({t_day_content:.1f}m logged)" if t_day_content > 0 else "❌ Pending Activity")
            lib_advice = f"🌟 Steady Execution ({t_day_lib:.1f}m logged)" if (t_calc_lib_kpi > 0 and t_day_lib >= t_calc_lib_kpi) else (f"⚠️ In-Progress ({t_day_lib:.1f}m logged)" if t_day_lib > 0 else "❌ Pending Activity")

            evidence_source = teacher_date_data
            
            v_voice = extract_evidence_items_vectorized(evidence_source, 'Voice_Note_Link')
            v_pic = extract_evidence_items_vectorized(evidence_source, 'Lesson_Plan_Picture')
            v_writing = extract_evidence_items_vectorized(evidence_source, 'Writing_Sample_Link')
            v_phonics = extract_evidence_items_vectorized(evidence_source, 'Phonics_Evidence_Link')
            v_portfolio = extract_evidence_items_vectorized(evidence_source, 'Portfolio_Evidence_Link')
            v_assessment = extract_evidence_items_vectorized(evidence_source, 'Student_Assessment_Link')
            v_events = extract_evidence_items_vectorized(evidence_source, 'Event_Pictures_Link')
            v_vid = evidence_items_across_columns(evidence_source, ['Video_Evidence_1', 'Video_Evidence_2', 'Video_Evidence_3'])

            lp_combo_total = len(v_voice) + len(v_pic)
            total_artifacts = lp_combo_total + len(v_vid) + len(v_writing) + len(v_phonics) + len(v_portfolio) + len(v_assessment) + len(v_events)

            col_btn_top, col_bulk_btn = st.columns(2)
            with col_btn_top:
                if st.button(f"⚙️ Compile 360° Profile PDF for {target_teacher} ({primary_view_metric})", key="btn_prep_single_pdf"):
                    with st.spinner("Generating teacher profile PDF..."):
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
                            active_metric_mode=primary_view_metric,
                            show_lesson_plan_report=t4_show_lp,
                            show_evidence_section=t4_show_evidence
                        ).getvalue()
                        st.session_state[f"pdf_360_{teacher_school}_{target_teacher}"] = single_pdf

                if f"pdf_360_{teacher_school}_{target_teacher}" in st.session_state:
                    st.download_button(
                        label="📥 Download 360° Profile (PDF)",
                        data=st.session_state[f"pdf_360_{teacher_school}_{target_teacher}"],
                        file_name=f"{target_teacher.replace(' ', '_')}_360_Profile_Report.pdf",
                        mime="application/pdf",
                        key="top_pdf_download_btn"
                    )

            with col_bulk_btn:
                if st.button(f"⚙️ Compile Bulk School PDF for {teacher_school} ({primary_view_metric})", key="btn_prep_bulk_pdf"):
                    with st.spinner("Generating comprehensive school audit..."):
                        school_teachers_list = sorted(filtered_roster[filtered_roster['Institution'] == teacher_school]['FullName'].unique().tolist())
                        bulk_pdf = generate_comprehensive_school_pdf_report(
                            school_name=teacher_school,
                            teachers_list=school_teachers_list,
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
                            active_metric_mode=primary_view_metric,
                            show_lesson_plan_report=t4_show_lp,
                            show_evidence_section=t4_show_evidence
                        ).getvalue()
                        st.session_state[f"bulk_pdf_{teacher_school}"] = bulk_pdf

                if f"bulk_pdf_{teacher_school}" in st.session_state:
                    st.download_button(
                        label="📥 Download Bulk School 360 Profiles (PDF)",
                        data=st.session_state[f"bulk_pdf_{teacher_school}"],
                        file_name=f"{teacher_school.replace(' ', '_')}_Comprehensive_School_Report.pdf",
                        mime="application/pdf",
                        key="bulk_school_pdf_btn"
                    )

            st.markdown(f"### 📋 Audit Profile: **{target_teacher}** | School: **{teacher_school}**")

            st.subheader("1. Quantitative Performance Indicator Summary")
            st.info(f"📅 **Active Filter**: `{filter_description_text}` | **Performance Indicator Duration**: `{t_eligible_days} Working Day(s)`")

            col_sum1, col_sum2 = st.columns([1, 1.2])

            with col_sum1:
                st.markdown("##### 📌 Quantitative Performance Indicator Overview")
                s1, s2, s3 = st.columns(3)
                s1.metric("Lesson Prep Mins", f"{t_day_ld:.1f} mins", delta=f"{ld_pct:.0f}% of Standard" if enable_quant_kpi_t4 else None)
                
                if "Content" in primary_view_metric or "Both" in primary_view_metric:
                    s2.metric("Content (Book) Mins", f"{t_day_content:.1f} mins", delta=f"{content_pct:.0f}% of Standard" if enable_quant_kpi_t4 else None)
                if "Library" in primary_view_metric or "Both" in primary_view_metric:
                    s3.metric("Library Usage Mins", f"{t_day_lib:.1f} mins", delta=f"{lib_pct:.0f}% of Standard" if enable_quant_kpi_t4 else None)
                
                st.markdown("##### 💡 Academic Consultant Observation")
                st.write(f"• **Lesson Plan Preparation**: {ld_advice}")
                if "Content" in primary_view_metric or "Both" in primary_view_metric:
                    st.write(f"• **Content / Book Delivery**: {content_advice}")
                if "Library" in primary_view_metric or "Both" in primary_view_metric:
                    st.write(f"• **Library Usage**: {lib_advice}")

            with col_sum2:
                st.markdown("##### 📊 Performance Indicator Achievement Comparison")
                plot_cats, plot_logs, plot_benches = [], [], []
                
                plot_cats.append(f'Lesson Prep ({t_calc_ld_kpi:.0f}m)' if enable_quant_kpi_t4 else 'Lesson Prep')
                plot_logs.append(t_day_ld)
                plot_benches.append(t_calc_ld_kpi)
                
                if "Content" in primary_view_metric or "Both" in primary_view_metric:
                    plot_cats.append(f'Content Book ({t_calc_content_kpi:.0f}m)' if enable_quant_kpi_t4 else 'Content Book')
                    plot_logs.append(t_day_content)
                    plot_benches.append(t_calc_content_kpi)
                    
                if "Library" in primary_view_metric or "Both" in primary_view_metric:
                    plot_cats.append(f'Library ({t_calc_lib_kpi:.0f}m)' if enable_quant_kpi_t4 else 'Library')
                    plot_logs.append(t_day_lib)
                    plot_benches.append(t_calc_lib_kpi)

                ach_df = pd.DataFrame({
                    'Performance Indicator Category': plot_cats,
                    'Logged Minutes': plot_logs,
                    'Performance Indicator Standard': plot_benches
                })
                
                fig_ach = go.Figure()
                fig_ach.add_trace(go.Bar(
                    x=ach_df['Performance Indicator Category'], y=ach_df['Logged Minutes'],
                    name='Logged Minutes', marker_color='#2CA02C', text=[f"{v:.1f} mins" for v in ach_df['Logged Minutes']], textposition='auto'
                ))
                if enable_quant_kpi_t4:
                    fig_ach.add_trace(go.Bar(
                        x=ach_df['Performance Indicator Category'], y=ach_df['Performance Indicator Standard'],
                        name='Standard Guideline', marker_color='#E5E5E5', opacity=0.6, text=[f"{v:.1f} mins" for v in ach_df['Performance Indicator Standard']], textposition='auto'
                    ))
                fig_ach.update_layout(
                    barmode='group', title=f"Logged Minutes vs. Standard Guideline ({selected_num_days} Working Day(s))",
                    height=280, margin=dict(l=20, r=20, t=40, b=20)
                )
                st.plotly_chart(fig_ach, use_container_width=True)

            st.markdown("---")

            if "Content" in primary_view_metric or "Both" in primary_view_metric:
                st.subheader("2. Detailed Textbook & Chapter Time Breakdown")
                if teacher_books.empty:
                    st.info(f"No digital textbooks or modules recorded for **{target_teacher}**.")
                else:
                    col_b1, col_b2 = st.columns(2)
                    with col_b1:
                        t_book_summary = teacher_books.groupby(['Book', 'Grade', 'Subject'])['Duration_Min'].sum().reset_index()
                        fig_tb_bar = px.bar(
                            t_book_summary, x="Duration_Min", y="Book", color="Grade", orientation="h",
                            title=f"Time Spent per Book/Chapter by {target_teacher} (Minutes)",
                            labels={"Duration_Min": "Time Spent (Minutes)", "Book": "Book / Chapter"},
                            text_auto=".1f"
                        )
                        fig_tb_bar.update_layout(yaxis={'categoryorder':'total ascending'}, height=320)
                        st.plotly_chart(fig_tb_bar, use_container_width=True)
                        
                    with col_b2:
                        st.markdown("##### ⏱️ Time Allocation Table")
                        display_book_table = t_book_summary.rename(columns={'Book': 'Textbook / Module', 'Grade': 'Grade', 'Subject': 'Subject', 'Duration_Min': 'Time Spent (Mins)'}).round({'Time Spent (Mins)': 1})
                        st.dataframe(display_book_table, use_container_width=True)

                st.markdown("---")

            with st.expander("Classroom observations for this teacher"):
                observations = fetch_observation_history(target_teacher, teacher_school)
                if not observations.empty:
                    od = pd.to_datetime(observations.visit_date).dt.date
                    observations = observations[(od>=c_start)&(od<=c_end)]
                if observations.empty:
                    st.caption("No observations within the selected review window.")
                else:
                    st.dataframe(observations[['visit_date','subject','topic','high_points','recommendations','pdf_url']],use_container_width=True)
            st.subheader("3. Qualitative Evidences & Artifact Hub (Phonics & Portfolio Integrated)")

            v_cols = st.columns(7)
            v_cols[0].metric("📖 LP / Audio Notes", f"{lp_combo_total}", delta=f"{len(v_voice)} Audio | {len(v_pic)} Img")
            v_cols[1].metric("🎥 Activity Files", f"{len(v_vid)}")
            v_cols[2].metric("📝 Writing Samples", f"{len(v_writing)}")
            v_cols[3].metric("🔤 Phonics Evidence", f"{len(v_phonics)}")
            v_cols[4].metric("📁 Portfolio Uploads", f"{len(v_portfolio)}")
            v_cols[5].metric("🧪 Assessments", f"{len(v_assessment)}")
            v_cols[6].metric("🎉 Event Pictures", f"{len(v_events)}")

            st.markdown("##### 📌 Detailed Evidence Submissions & Direct Artifact Links")
            q_cols1, q_cols2, q_cols3, q_cols4 = st.columns(4)
            
            with q_cols1:
                st.markdown("###### 📖 1. Lesson Plans & Pre-Class Voice Notes")
                combined_lp_items = []
                for item in v_voice:
                    combined_lp_items.append(f"🎧 [Audio Note]({item['url']}) - **{item['grade']}** | *{item['subject']}* ({item['lesson']}, {item['date']})")
                for item in v_pic:
                    combined_lp_items.append(f"🖼️ [LP Picture]({item['url']}) - **{item['grade']}** | *{item['subject']}* ({item['lesson']}, {item['date']})")
                if combined_lp_items:
                    for line in combined_lp_items: st.markdown(f"• {line}")
                    with st.expander("👁️ Play / view these files"):
                        for i_idx, item in enumerate(v_voice + v_pic):
                            render_evidence_media_preview(item, widget_key=f"q1_{i_idx}")
                else:
                    st.caption("No lesson plans or voice reflections submitted.")

            with q_cols2:
                st.markdown("###### 🎥 2. Classroom Videos & Student Writing")
                for item in v_vid:
                    st.markdown(f"• 🎥 [Watch Video]({item['url']}) - **{item['grade']}** | *{item['subject']}* ({item['lesson']}, {item['date']})")
                for item in v_writing:
                    st.markdown(f"• 📝 [View Writing]({item['url']}) - **{item['grade']}** | *{item['subject']}* ({item['lesson']}, {item['date']})")
                if v_vid or v_writing:
                    with st.expander("👁️ Play / view these files"):
                        for i_idx, item in enumerate(v_vid + v_writing):
                            render_evidence_media_preview(item, widget_key=f"q2_{i_idx}")
                else:
                    st.caption("No activity files or writing samples uploaded.")

            with q_cols3:
                st.markdown("###### 🔤 3. Phonics Implementation & Portfolio Showcase")
                for item in v_phonics:
                    st.markdown(f"• 🔤 [Phonics Evidence]({item['url']}) - **{item['grade']}** | *{item['subject']}* ({item['lesson']}, {item['date']})")
                for item in v_portfolio:
                    st.markdown(f"• 📁 [Portfolio Artifact]({item['url']}) - **{item['grade']}** | *{item['subject']}* ({item['lesson']}, {item['date']})")
                if v_phonics or v_portfolio:
                    with st.expander("👁️ Play / view these files"):
                        for i_idx, item in enumerate(v_phonics + v_portfolio):
                            render_evidence_media_preview(item, widget_key=f"q3_{i_idx}")
                else:
                    st.caption("No phonics implementation or portfolio files uploaded.")

            with q_cols4:
                st.markdown("###### 🧪 4. Student Assessments & Event Pictures")
                for item in v_assessment:
                    st.markdown(f"• 🧪 [Student Assessment]({item['url']}) - **{item['grade']}** | *{item['subject']}* ({item['lesson']}, {item['date']})")
                for item in v_events:
                    st.markdown(f"• 🎉 [Event Picture]({item['url']}) - **{item['grade']}** | *{item['subject']}* ({item['lesson']}, {item['date']})")
                if v_assessment or v_events:
                    with st.expander("👁️ Play / view these files"):
                        for i_idx, item in enumerate(v_assessment + v_events):
                            render_evidence_media_preview(item, widget_key=f"q4_{i_idx}")
                else:
                    st.caption("No student assessments or event pictures uploaded.")

            st.markdown("---")

            # Embedded School Audit Box
            sch_roster = filtered_roster[filtered_roster['Institution'] == teacher_school]
            sch_data = filtered_df[filtered_df['Institution'] == teacher_school]

            sch_teachers_list = sorted(sch_roster['FullName'].unique().tolist())
            tot_teachers = len(sch_teachers_list)

            ld_m = sch_data[usage_masks(sch_data)[0]].groupby('FullName')['Duration_Min'].sum().to_dict()
            
            sch_content_raw = sch_data[sch_data['Book'].str.len() > 0]
            sch_content_df = sch_content_raw[usage_masks(sch_content_raw)[2]]
            content_m = sch_content_df.groupby('FullName')['Duration_Min'].sum().to_dict()

            met_ld = 0
            met_content = 0
            for t in sch_teachers_list:
                t_ld_mins = ld_m.get(t, 0.0)
                t_c_mins = content_m.get(t, 0.0)
                if (t_calc_ld_kpi > 0 and t_ld_mins >= t_calc_ld_kpi) or (t_calc_ld_kpi == 0 and t_ld_mins > 0):
                    met_ld += 1
                if (t_calc_content_kpi > 0 and t_c_mins >= t_calc_content_kpi) or (t_calc_content_kpi == 0 and t_c_mins > 0):
                    met_content += 1

            ld_comp_pct = (met_ld / tot_teachers * 100) if tot_teachers > 0 else 0
            content_comp_pct = (met_content / tot_teachers * 100) if tot_teachers > 0 else 0

            inactive_teachers = [t for t in sch_teachers_list if (ld_m.get(t, 0.0) == 0.0 and content_m.get(t, 0.0) == 0.0)]
            inactive_str = ", ".join(inactive_teachers[:3]) + (f" (+{len(inactive_teachers)-3} more)" if len(inactive_teachers) > 3 else "") if inactive_teachers else "None (All Active)"

            vids_cnt = len(evidence_items_across_columns(sch_data, ['Video_Evidence_1', 'Video_Evidence_2', 'Video_Evidence_3']))
            phonics_cnt = len(extract_evidence_items_vectorized(sch_data, 'Phonics_Evidence_Link'))
            writing_cnt = len(extract_evidence_items_vectorized(sch_data, 'Writing_Sample_Link'))
            lp_pic_cnt = len(extract_evidence_items_vectorized(sch_data, 'Lesson_Plan_Picture'))
            voice_cnt = len(extract_evidence_items_vectorized(sch_data, 'Voice_Note_Link'))
            portfolio_cnt = len(extract_evidence_items_vectorized(sch_data, 'Portfolio_Evidence_Link'))

            hosted_school_pdf_url = st.session_state.get(f"hosted_pdf_url_{teacher_school}")

            if st.button(f"☁️ Compile & Upload PDF Report to Supabase Cloud for {teacher_school} ({primary_view_metric})", key=f"upload_cloud_pdf_{teacher_school}"):
                with st.spinner("Generating and uploading PDF report to Supabase..."):
                    school_pdf_buf = generate_comprehensive_school_pdf_report(
                        school_name=teacher_school,
                        teachers_list=sch_teachers_list,
                        school_filtered_df=school_filtered_df,
                        filtered_df=filtered_df,
                        filter_desc=filter_description_text,
                        calc_ld_kpi=t_calc_ld_kpi,
                        calc_content_kpi=t_calc_content_kpi,
                        calc_lib_kpi=t_calc_lib_kpi,
                        daily_ld_target=daily_ld_target_t4,
                        daily_content_target=daily_content_target_t4,
                        daily_lib_target=daily_lib_target_t4,
                        selected_num_days=t_eligible_days,
                        target_vid_count=target_vid_count_t4,
                        target_writing_count=target_writing_count_t4,
                        target_lp_combo_count=target_lp_combo_count_t4,
                        target_phonics_count=target_phonics_count_t4,
                        target_portfolio_count=target_portfolio_count_t4,
                        enable_quant_kpi=enable_quant_kpi_t4,
                        enable_qual_kpi=enable_qual_kpi_t4,
                        active_metric_mode=primary_view_metric,
                        show_lesson_plan_report=t4_show_lp,
                        show_evidence_section=t4_show_evidence
                    )
                    hosted_school_pdf_url = upload_pdf_to_supabase(school_pdf_buf, teacher_school)
                    st.session_state[f"hosted_pdf_url_{teacher_school}"] = hosted_school_pdf_url
                    if hosted_school_pdf_url:
                        st.success("Report uploaded successfully.")
                    else:
                        st.error("Report upload failed. The previous report was not replaced.")

            pdf_link_markdown = f"\n\n📄 *Download Full School Audit Report (PDF):*\n{hosted_school_pdf_url}" if hosted_school_pdf_url else ""

            ld_bench_str = f" [Benchmark: {daily_ld_target_t4:.0f}m/day × {t_eligible_days}d = {t_calc_ld_kpi:.0f} mins total]" if (enable_quant_kpi_t4 and t_calc_ld_kpi > 0) else ""
            content_bench_str = f" [Benchmark: {daily_content_target_t4:.0f}m/day × {t_eligible_days}d = {t_calc_content_kpi:.0f} mins total]" if (enable_quant_kpi_t4 and t_calc_content_kpi > 0) else ""

            school_msg_parts = [
                f"Respected Sir/Madam,\n\n",
                f"Greetings from OneLearn Academic Team! Here is the latest performance & classroom implementation summary for *{teacher_school}* ({filter_description_text}):\n"
            ]

            if enable_quant_kpi_t4:
                school_msg_parts.append(
                    f"📊 *Quantitative Benchmarks:*\n"
                    f"• Lesson Plan Prep Compliance: {ld_comp_pct:.0f}% ({met_ld}/{tot_teachers} Teachers){ld_bench_str}\n"
                    f"• Textbook & Chapter Delivery Compliance: {content_comp_pct:.0f}% ({met_content}/{tot_teachers} Teachers){content_bench_str}"
                )

            if enable_qual_kpi_t4:
                school_msg_parts.append(
                    f"\n📬 *Classroom Evidence Submissions:*\n"
                    f"• Activity Files: {vids_cnt} Uploaded\n"
                    f"• Phonics Evidence: {phonics_cnt} Uploaded\n"
                    f"• Writing Samples: {writing_cnt} Uploaded\n"
                    f"• LP Pictures / Voice Notes: {lp_pic_cnt + voice_cnt} Uploaded\n"
                    f"• Portfolio Artifacts: {portfolio_cnt} Uploaded"
                )

            school_msg_parts.append(
                f"\n⚠️ *Inactive / Follow-up Teachers:* {inactive_str}"
                f"{pdf_link_markdown}\n\n"
                f"Let us connect for a 5-minute review to support your teachers in scaling classroom outcomes.\n\n"
                f"Regards,\n"
                f"Harshit Bhargava,\n"
                f"OneLearn Academic Team"
            )

            final_school_wa_msg = "\n".join(school_msg_parts)

            render_school_audit_crm_box(
                "Teacher 360 Profile", 
                teacher_school, 
                filter_description_text, 
                final_school_wa_msg
            )

    # TAB 7: LIVE EVIDENCE SUBMISSIONS FEED & QUALITATIVE TRACKER
    with tab7:
        st.header("📬 Live Evidence Submissions Feed & Qualitative Performance Indicator Tracker")
        
        with st.expander("🎯 Qualitative Artifact Threshold Controls", expanded=False):
            t7_kcol1, t7_kcol2 = st.columns(2)
            with t7_kcol1:
                target_vid_count_t7 = st.number_input("Min. Activity Files", min_value=0, max_value=100, value=3, step=1, key="t7_vid_cnt")
                target_writing_count_t7 = st.number_input("Min. Writing Samples", min_value=0, max_value=100, value=3, step=1, key="t7_writing_cnt")
            with t7_kcol2:
                target_phonics_count_t7 = st.number_input("Min. Phonics Submissions", min_value=0, max_value=100, value=2, step=1, key="t7_ph_cnt")
                target_portfolio_count_t7 = st.number_input("Min. Portfolio Artifacts", min_value=0, max_value=100, value=1, step=1, key="t7_pf_cnt")

        st.caption("Evidence targets apply to the selected review period; 0 means not applicable. These are file-submission targets, not quality ratings.")
        evidence_status_rows = []
        for _, tr in filtered_roster[['Institution','FullName']].drop_duplicates().iterrows():
            td = filtered_df[filtered_df.Institution.eq(tr.Institution) & filtered_df.FullName.eq(tr.FullName)]
            counts = artifact_counts(td)
            eligible = teacher_days.get((tr.Institution,tr.FullName),selected_num_days) if use_teacher_eligible_days else selected_num_days
            checks = [('Activity files',counts['activity'],target_vid_count_t7),('Written work',counts['Writing_Sample_Link'],target_writing_count_t7),
                      ('Phonics',counts['Phonics_Evidence_Link'],target_phonics_count_t7),('Portfolio',counts['Portfolio_Evidence_Link'],target_portfolio_count_t7)]
            result = {'School':tr.Institution,'Teacher':tr.FullName}
            for name,count,target in checks:
                result[name] = f'{count} / {target}' if target else f'{count} (not required)'
            applicable = [(count,target) for _,count,target in checks if target>0]
            result['Submission status'] = 'Not applicable' if eligible == 0 or not applicable else 'Met selected targets' if all(count>=target for count,target in applicable) else 'Needs follow-up'
            evidence_status_rows.append(result)
        st.dataframe(pd.DataFrame(evidence_status_rows),use_container_width=True)

        evidence_cols = ['Voice_Note_Link', 'Lesson_Plan_Picture', 'Video_Evidence_1', 'Video_Evidence_2', 'Video_Evidence_3', 'Writing_Sample_Link', 'Phonics_Evidence_Link', 'Portfolio_Evidence_Link', 'Student_Assessment_Link', 'Event_Pictures_Link']
        avail_ev_cols = [c for c in evidence_cols if c in filtered_df.columns]

        if not filtered_df.empty and avail_ev_cols:
            url_mask = pd.concat([
                filtered_df[c].fillna('').astype(str).str.strip().str.len() > 0
                for c in avail_ev_cols
            ], axis=1).any(axis=1)
            all_submissions_df = filtered_df[url_mask].copy()
        else:
            all_submissions_df = pd.DataFrame()

        if all_submissions_df.empty:
            st.info("No teacher evidence submissions match the currently selected global filter criteria.")
        else:
            col_t7_f1, col_t7_f2, col_t7_f3 = st.columns(3)
            with col_t7_f1:
                t7_schools = ["All Schools"] + sorted([s for s in all_submissions_df['Institution'].unique() if str(s).strip()])
                t7_selected_school = st.selectbox("Filter by School:", t7_schools, key="t7_school")
                
            t7_filtered = all_submissions_df if t7_selected_school == "All Schools" else all_submissions_df[all_submissions_df['Institution'] == t7_selected_school]

            with col_t7_f2:
                t7_teachers = ["All Teachers"] + sorted([t for t in t7_filtered['FullName'].unique() if str(t).strip()])
                t7_selected_teacher = st.selectbox("Filter by Teacher:", t7_teachers, key="t7_teacher")

            if t7_selected_teacher != "All Teachers":
                t7_filtered = t7_filtered[t7_filtered['FullName'] == t7_selected_teacher]

            with col_t7_f3:
                t7_grades = ["All Grades"] + sorted([g for g in t7_filtered['Grade'].unique() if str(g).strip()])
                t7_selected_grade = st.selectbox("Filter by Grade:", t7_grades, key="t7_grade")

            if t7_selected_grade != "All Grades":
                t7_filtered = t7_filtered[t7_filtered['Grade'] == t7_selected_grade]

            st.markdown("---")
            tot_subs = len(t7_filtered)
            st.metric("📋 Total Submissions Found", tot_subs)

            has_submitted_at = 'submitted_at' in t7_filtered.columns and t7_filtered['submitted_at'].notna().any()
            if has_submitted_at:
                t7_filtered['submitted_at'] = local_naive_series(t7_filtered['submitted_at']).fillna(t7_filtered['StartTime'])
            t7_sort_col = 'submitted_at' if has_submitted_at else 'StartTime'

            t7_display_cols = ['submitted_at', 'FullName', 'Institution', 'Grade', 'Subject', 'Book', 'StartTime', 'Phonics_Evidence_Link', 'Portfolio_Evidence_Link', 'Voice_Note_Link', 'Lesson_Plan_Picture', 'Video_Evidence_1', 'Writing_Sample_Link', 'Student_Assessment_Link', 'Event_Pictures_Link']
            t7_avail = [c for c in t7_display_cols if c in t7_filtered.columns]

            t7_table = t7_filtered[t7_avail].sort_values(by=t7_sort_col, ascending=False)
            t7_table = t7_table.rename(columns={
                'submitted_at': 'Submitted On',
                'FullName': 'Teacher Name',
                'Institution': 'School',
                'StartTime': 'Class Time (Recorded)'
            })
            st.dataframe(t7_table, use_container_width=True)

            st.markdown("---")
            st.markdown("##### 🎬 Play / View Evidence Files")
            st.caption("Files are streamed directly from the public R2 bucket.")
            if not R2_DELETE_ENABLED:
                st.caption("⚠️ R2 delete credentials aren't configured, so files can be removed from records here, but not from R2 storage itself. See the note near the top of this app.")

            t7_preview_rows = t7_filtered.sort_values(by=t7_sort_col, ascending=False).head(25)
            if t7_preview_rows.empty:
                st.caption("No submissions to preview.")
            else:
                for row_idx, r7 in t7_preview_rows.iterrows():
                    submitted_display = r7.get('submitted_at', '') if has_submitted_at else r7.get('StartTime', '')
                    row_label = f"{submitted_display} — {r7.get('FullName', 'Unknown Teacher')} ({r7.get('Institution', 'Unknown School')})"
                    record_id = r7.get('id') if 'id' in r7 else None
                    has_record_id = record_id is not None and pd.notna(record_id)
                    with st.expander(f"📁 {row_label}"):
                        any_file_for_row = False
                        for ev_col in avail_ev_cols:
                            raw_cell_val = r7.get(ev_col, "")
                            files_in_cell = resolve_evidence_links(raw_cell_val)
                            if not files_in_cell:
                                continue
                            any_file_for_row = True
                            st.markdown(f"**{ev_col.replace('_', ' ')}**")
                            for f_idx, f_item in enumerate(files_in_cell):
                                prev_col, del_col = st.columns([5, 1])
                                with prev_col:
                                    render_evidence_media_preview(f_item, widget_key=f"t7_{row_idx}_{ev_col}_{f_idx}")
                                with del_col:
                                    if not DESTRUCTIVE_ENABLED:
                                        st.caption("Deletion locked")
                                    elif not has_record_id:
                                        st.caption("No id — can't delete")
                                    else:
                                        del_base_key = f"t7del_{row_idx}_{ev_col}_{f_idx}"
                                        confirm_key = f"{del_base_key}_confirm"
                                        if st.session_state.get(confirm_key):
                                            st.warning("Permanently delete this file?")
                                            yes_col, no_col = st.columns(2)
                                            with yes_col:
                                                if st.button("✅ Yes", key=f"{del_base_key}_yes"):
                                                    ok, msg = delete_evidence_item(
                                                        record_id, ev_col,
                                                        f_item.get('object_key'), f_item.get('url')
                                                    )
                                                    st.session_state[confirm_key] = False
                                                    if ok:
                                                        st.success("Deleted." if not msg else msg)
                                                    else:
                                                        st.error(msg)
                                                    time.sleep(0.5)
                                                    st.rerun()
                                            with no_col:
                                                if st.button("✖ No", key=f"{del_base_key}_no"):
                                                    st.session_state[confirm_key] = False
                                                    st.rerun()
                                        else:
                                            if st.button(
                                                "🗑️ Delete",
                                                key=del_base_key,
                                                help="Permanently removes this file from R2 storage and from this record — can't be undone."
                                            ):
                                                st.session_state[confirm_key] = True
                                                st.rerun()
                        if not any_file_for_row:
                            st.caption("No evidence files found in this submission.")

    # --- TAB 8: PHYSICAL CLASSROOM VISIT OBSERVATION FORM & LONGITUDINAL AUDIT TRAIL ---
    with tab8:
        st.header("📋 Classroom Observation Form & Longitudinal Audit Trail")
        st.caption("Punch real-time classroom visit observations, auto-populate rubrics and narratives with Gemini voice debriefs, attach visit evidence, and generate reports.")

        render_ai_usage_panel()

        subtab_form, subtab_history = st.tabs(["📝 New Classroom Observation Visit", "📊 Teacher Visit History & Outcomes"])

        with subtab_form:
            is_editing_mode = "editing_obs_id" in st.session_state and st.session_state["editing_obs_id"] is not None
            if is_editing_mode:
                st.info(f"✏️ **Editing Mode Active:** Currently editing Observation Visit Record ID `#{st.session_state['editing_obs_id']}`. Saving will update the existing entry.")
                if st.button("❌ Cancel Editing Mode & Start Fresh Form", key="btn_cancel_editing"):
                    st.session_state.pop("editing_obs_id", None)
                    st.session_state.pop("obs_narr_flow", None)
                    st.session_state.pop("obs_narr_high", None)
                    st.session_state.pop("obs_narr_recom", None)
                    st.session_state.pop("edit_meta_cache", None)
                    for key in list(st.session_state):
                        if key.startswith(('obs_','rubric_','snip_')):
                            st.session_state.pop(key,None)
                    st.rerun()

            # --- AI Fast-Track Debrief Assistant (Voice & Text) ---
            st.markdown("##### 🎙️ AI Fast-Track Observation Assistant (Voice or Rough Notes)")
            st.caption("Speak your post-class debrief or type raw bullet points. Gemini will analyze the lesson, determine all 12 rubric grades and remarks, and write the narratives.")
            
            ai_v_col1, ai_v_col2 = st.columns([1.2, 1.8])
            with ai_v_col1:
                obs_audio_voice = st.audio_input("Record Voice Debrief:", key="obs_voice_input_top")
            with ai_v_col2:
                obs_text_field = st.text_area(
                    "Or Type Rough Observation Notes:",
                    placeholder="e.g., Started with a recap on states of matter. Showed water bottle for liquid. High student engagement with cold calling. However, didn't check workbooks or provide remedial feedback...",
                    height=105,
                    key="obs_text_notes_top"
                )

            if st.button("✨ Auto-Populate Form with Gemini AI", type="primary", key="btn_run_gemini_tab8"):
                if not obs_audio_voice and not obs_text_field.strip():
                    st.warning("Please record a voice note or provide rough text notes before generating.")
                else:
                    with st.spinner("Gemini is analyzing pedagogical indicators and structuring the evaluation..."):
                        ai_data, ai_err = generate_structured_observation_ai(
                            audio_file_obj=obs_audio_voice,
                            text_transcript=obs_text_field.strip()
                        )
                        if ai_err:
                            st.error(f"AI Generation Error: {ai_err}")
                        elif ai_data:
                            st.session_state["obs_narr_flow"] = ai_data.get("flow_of_class", "")
                            st.session_state["obs_narr_high"] = ai_data.get("high_points", "")
                            st.session_state["obs_narr_recom"] = ai_data.get("recommendations", "")

                            rubric_list = ai_data.get("rubrics", [])
                            for item in rubric_list:
                                cat_k = item.get("category", "").strip()
                                for valid_cat in OBSERVATION_RUBRIC_CONFIG.keys():
                                    if cat_k.lower() == valid_cat.lower():
                                        st.session_state[f"rubric_opt_{valid_cat}"] = item.get("grade", "NA")
                                        st.session_state[f"rubric_rem_{valid_cat}"] = item.get("remarks", "")
                                        break

                            st.success("✅ Audit form populated successfully! Review the ratings and narratives below before saving.")
                            st.rerun()

            st.markdown("---")

            if st.session_state.pop('_reset_observation_form',False):
                for widget in list(st.session_state):
                    if widget.startswith(('obs_','rubric_','snip_')):
                        st.session_state.pop(widget,None)
            for widget, value in st.session_state.pop('_pending_observation_widgets',{}).items():
                st.session_state[widget] = value
            edit_cache = st.session_state.get("edit_meta_cache", {})

            with st.form("classroom_visit_full_form"):
                st.subheader("1. General Information & Metadata")
                col_m1, col_m2, col_m3 = st.columns(3)
                
                with col_m1:
                    default_school_idx = all_schools.index(edit_cache["school"]) if edit_cache.get("school") in all_schools else 0
                    input_school = st.selectbox("Name of the School / Institution:", options=all_schools, index=default_school_idx, key="obs_school_sel")
                    
                    default_teach_idx = available_teachers.index(edit_cache["teacher"]) if edit_cache.get("teacher") in available_teachers else 0
                    input_teacher = st.selectbox("Name of the Teacher:", options=available_teachers, index=default_teach_idx, key="obs_teacher_sel")
                    input_custom_teacher = st.text_input("Or Type Custom Teacher Name (if unlisted):", value=edit_cache.get("custom_teacher", ""), key="obs_custom_teacher")
                    input_mentor = st.text_input("Name of the Academic Mentor:", value=edit_cache.get("mentor", employee_name), key="obs_mentor_name")

                with col_m2:
                    input_class_sec = st.text_input("Class and Section:", value=edit_cache.get("class_section", ""), key="obs_class_sec")
                    input_subject = st.text_input("Subject:", value=edit_cache.get("subject", ""), key="obs_subject")
                    input_topic = st.text_input("Topic:", value=edit_cache.get("topic", ""), key="obs_topic")

                with col_m3:
                    default_date_val = pd.to_datetime(edit_cache["visit_date"]).date() if edit_cache.get("visit_date") else pd.Timestamp.now().date()
                    input_date = st.date_input("Observation Date:", value=default_date_val, key="obs_date_pick")
                    input_duration = st.text_input("Total Time Duration of Observation:", value=edit_cache.get("duration", "40 Min"), key="obs_dur")
                    input_students = st.number_input("Total students present:", min_value=1, max_value=120, value=int(edit_cache.get("students_present", 26)), key="obs_num_students")
                    print_disp_idx = 1 if edit_cache.get("print_displayed") == "No" else 0
                    input_print_disp = st.selectbox("Print displayed in class:", ["Yes", "No"], index=print_disp_idx, key="obs_print_disp")

                st.markdown("---")
                st.subheader("2. Parameter-Wise Evaluation Rubric (with Yellow Highlight Sync)")
                st.caption("Select the grade level (the selected card highlights in yellow) and customize remarks.")

                final_rubric_responses = {}

                for cat_name, desc_dict in OBSERVATION_RUBRIC_CONFIG.items():
                    st.markdown(f"##### 📌 {cat_name}")
                    
                    col_r1, col_r2 = st.columns([3.2, 1.8])
                    with col_r1:
                        selected_grade = st.radio(
                            f"Select Rubric Grade for '{cat_name}':",
                            options=["NA", "A", "B", "C"],
                            horizontal=True,
                            key=f"rubric_opt_{cat_name}"
                        )
                        
                        c_a, c_b, c_c = st.columns(3)
                        with c_a:
                            bg_a = "#FEF08A" if selected_grade == "A" else "#F8FAFC"
                            border_a = "2px solid #CA8A04" if selected_grade == "A" else "1px solid #E2E8F0"
                            st.markdown(
                                f'<div style="background-color:{bg_a}; border:{border_a}; border-radius:6px; padding:8px; height:110px; font-size:11px; overflow-y:auto;">'
                                f'<b>A:</b> {desc_dict.get("A", "")}'
                                f'</div>', unsafe_allow_html=True
                            )
                        with c_b:
                            bg_b = "#FEF08A" if selected_grade == "B" else "#F8FAFC"
                            border_b = "2px solid #CA8A04" if selected_grade == "B" else "1px solid #E2E8F0"
                            st.markdown(
                                f'<div style="background-color:{bg_b}; border:{border_b}; border-radius:6px; padding:8px; height:110px; font-size:11px; overflow-y:auto;">'
                                f'<b>B:</b> {desc_dict.get("B", "")}'
                                f'</div>', unsafe_allow_html=True
                            )
                        with c_c:
                            bg_c = "#FEF08A" if selected_grade == "C" else "#F8FAFC"
                            border_c = "2px solid #CA8A04" if selected_grade == "C" else "1px solid #E2E8F0"
                            st.markdown(
                                f'<div style="background-color:{bg_c}; border:{border_c}; border-radius:6px; padding:8px; height:110px; font-size:11px; overflow-y:auto;">'
                                f'<b>C:</b> {desc_dict.get("C", "")}'
                                f'</div>', unsafe_allow_html=True
                            )

                    with col_r2:
                        suggested_snippets = [desc_dict.get("A", ""), desc_dict.get("B", ""), desc_dict.get("C", "")]
                        snippet_choice = st.selectbox(
                            f"Insert Rubric Excerpt into Remarks:",
                            options=["(None / Custom)"] + suggested_snippets,
                            key=f"snip_{cat_name}"
                        )
                        
                        existing_rem = st.session_state.get(f"rubric_rem_{cat_name}", "")
                        default_text = snippet_choice if snippet_choice != "(None / Custom)" else existing_rem

                        param_remark = st.text_area(
                            f"Specific Action Item / Remark:",
                            value=default_text,
                            placeholder="Add specific observations, flow notes, or action items...",
                            height=85,
                            key=f"rubric_rem_{cat_name}"
                        )
                    
                    final_rubric_responses[cat_name] = {
                        "Grade": selected_grade,
                        "Remarks": param_remark.strip()
                    }
                    st.markdown("<hr style='margin: 12px 0; border-top: 1px dashed #e2e8f0;'>", unsafe_allow_html=True)

                st.markdown("---")
                st.subheader("3. Classroom Flow, High Points & Mentor Recommendations")

                flow_default = ""
                high_points_default = ""
                recom_default = ""

                current_flow = st.session_state.get("obs_narr_flow", flow_default)
                current_high = st.session_state.get("obs_narr_high", high_points_default)
                current_recom = st.session_state.get("obs_narr_recom", recom_default)

                input_flow = st.text_area("Flow of the Class (Step-by-step chronology):", value=current_flow, height=130, key="obs_narr_flow")
                input_high_points = st.text_area("High Points of the Class:", value=current_high, height=110, key="obs_narr_high")
                input_recom = st.text_area("Recommendations by the Academic Mentor:", value=current_recom, height=110, key="obs_narr_recom")

                st.markdown("---")
                st.subheader("4. Visit Activity Media & Evidences (Optional)")
                st.caption("Upload classroom photos or videos captured during the observation. They will be stored in Supabase and hyperlinked directly inside the official PDF report.")
                visit_media_files = st.file_uploader(
                    "Upload Observation Photos / Videos:",
                    type=["jpg", "jpeg", "png", "mp4", "mov", "pdf"],
                    accept_multiple_files=True,
                    key="obs_visit_evidence_uploader"
                )

                submit_button_label = "💾 Update Existing Visit Record & Recompile PDF" if is_editing_mode else "🚀 Compile PDF, Save to Database & Generate Audit"
                submit_obs_form = st.form_submit_button(submit_button_label)

            if submit_obs_form:
                if not input_topic.strip() or not input_subject.strip() or not input_flow.strip():
                    st.error("Enter the subject, topic and observed lesson flow before saving.")
                    st.stop()
                if not input_custom_teacher.strip() and not ((school_master_roster.Institution.eq(input_school)) & school_master_roster.FullName.eq(input_teacher)).any():
                    st.error("The selected teacher does not belong to this school. Select the correct teacher or enter an unlisted teacher explicitly.")
                    st.stop()
                active_eval_teacher = input_custom_teacher.strip() if input_custom_teacher.strip() else input_teacher
                
                obs_meta_payload = {
                    "School": input_school,
                    "Teacher": active_eval_teacher,
                    "Class": input_class_sec,
                    "Subject": input_subject,
                    "Topic": input_topic,
                    "Date": str(input_date),
                    "Duration": input_duration,
                    "Students": input_students,
                    "PrintDisplay": input_print_disp,
                    "Mentor": input_mentor.strip() if input_mentor.strip() else employee_name
                }

                obs_narrative_payload = {
                    "Flow": input_flow,
                    "HighPoints": input_high_points,
                    "Recommendations": input_recom
                }

                uploaded_media_urls = []
                if edit_cache.get("evidence_links"):
                    uploaded_media_urls.extend([u.strip() for u in edit_cache["evidence_links"].split(",") if u.strip()])

                if visit_media_files:
                    with st.spinner("Uploading visit media evidences to Supabase Storage..."):
                        for f in visit_media_files:
                            m_url = upload_generic_file_to_supabase(f, f.name, subfolder="visit_evidences")
                            if m_url:
                                uploaded_media_urls.append(m_url)

                media_links_str = ",".join(uploaded_media_urls)

                with st.spinner("Generating PDF with yellow cell highlighting and saving audit..."):
                    obs_pdf_buffer = generate_classroom_observation_visit_pdf(
                        metadata=obs_meta_payload,
                        rubric_scores=final_rubric_responses,
                        narratives=obs_narrative_payload,
                        evidence_urls=uploaded_media_urls
                    )
                    
                    uploaded_obs_url = upload_pdf_to_supabase(
                        pdf_buffer=obs_pdf_buffer,
                        school_name=f"{input_school}_{active_eval_teacher}",
                        subfolder="observations",
                        file_suffix=f"_{input_date}_Observation_Audit"
                    )
                    
                    if is_editing_mode:
                        observation_updated = update_observation_in_db(
                            obs_id=st.session_state["editing_obs_id"],
                            meta=obs_meta_payload,
                            rubrics=final_rubric_responses,
                            narratives=obs_narrative_payload,
                            pdf_url=uploaded_obs_url or "",
                            evidence_links=media_links_str
                        )
                        if not observation_updated:
                            st.stop()
                        st.success(f"🎉 Observation Visit `#{st.session_state['editing_obs_id']}` updated successfully for **{active_eval_teacher}**!")
                        st.session_state.pop("editing_obs_id", None)
                        st.session_state.pop("edit_meta_cache", None)
                    else:
                        with conn.engine.begin() as c:
                            c.execute(text("""
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
                            """), {
                                "school": obs_meta_payload["School"],
                                "teacher": obs_meta_payload["Teacher"],
                                "class_section": obs_meta_payload["Class"],
                                "subject": obs_meta_payload["Subject"],
                                "topic": obs_meta_payload["Topic"],
                                "visit_date": obs_meta_payload["Date"],
                                "duration": obs_meta_payload["Duration"],
                                "students_present": int(obs_meta_payload["Students"]),
                                "print_displayed": obs_meta_payload["PrintDisplay"],
                                "academic_mentor": obs_meta_payload["Mentor"],
                                "rubric_json": json.dumps(final_rubric_responses),
                                "flow_of_class": obs_narrative_payload["Flow"],
                                "high_points": obs_narrative_payload["HighPoints"],
                                "recommendations": obs_narrative_payload["Recommendations"],
                                "pdf_url": uploaded_obs_url or "",
                                "evidence_links": media_links_str
                            })
                        fetch_observation_history.clear()
                        st.success(f"🎉 Observation Audit stored and compiled for **{active_eval_teacher}** at **{input_school}**!")

                    st.session_state["latest_obs_pdf_bytes"] = obs_pdf_buffer.getvalue()
                    st.session_state["latest_obs_pdf_url"] = uploaded_obs_url
                    st.session_state["latest_obs_teacher"] = active_eval_teacher
                    st.session_state["latest_obs_school"] = input_school
                    st.session_state["latest_obs_date"] = str(input_date)
                    st.session_state["_reset_observation_form"] = True
                    st.rerun()

            if "latest_obs_pdf_bytes" in st.session_state:
                st.markdown("---")
                st.download_button(
                    label=f"📄 Download Observation Audit (PDF) for {st.session_state['latest_obs_teacher']}",
                    data=st.session_state["latest_obs_pdf_bytes"],
                    file_name=f"{st.session_state['latest_obs_school']}_{st.session_state['latest_obs_teacher']}_{st.session_state['latest_obs_date']}_Observation.pdf".replace(' ', '_'),
                    mime="application/pdf",
                    key="dl_obs_pdf_btn"
                )

        # SUBTAB: HISTORICAL AUDIT VIEWER & PROGRESSION
        with subtab_history:
            st.subheader("📊 Historical Classroom Observation Audits")
            
            hist_col1, hist_col2 = st.columns(2)
            with hist_col1:
                hist_school = st.selectbox("Filter History by School:", options=["All Schools"] + selected_schools, key="hist_sch")
            with hist_col2:
                hist_teacher = st.selectbox("Filter History by Teacher:", options=["All Teachers"] + available_teachers, key="hist_teach")

            obs_history_df = fetch_observation_history(hist_teacher, hist_school)
            history_all_dates = st.checkbox("Show observation history across all dates", value=False, key="history_all_dates")
            if not obs_history_df.empty:
                obs_history_df = obs_history_df[obs_history_df.school.isin(selected_schools)]
                obs_history_df = obs_history_df[obs_history_df.teacher.isin(selected_teachers)]
                if not history_all_dates:
                    dates = pd.to_datetime(obs_history_df.visit_date).dt.date
                    obs_history_df = obs_history_df[(dates >= c_start) & (dates <= c_end)]

            if obs_history_df.empty:
                st.info("No physical visit records found in the database for the selected filters.")
            else:
                st.markdown(f"**Total Observations Logged:** `{len(obs_history_df)}`")
                
                summary_cards = []
                for _, row in obs_history_df.iterrows():
                    r_json = row.get("rubric_json") or {}
                    if isinstance(r_json, str):
                        r_json = json.loads(r_json)
                    grades = [v.get("Grade") for v in r_json.values() if isinstance(v, dict)]
                    a_cnt = grades.count("A")
                    b_cnt = grades.count("B")
                    c_cnt = grades.count("C")
                    summary_cards.append({
                        "ID": row["id"],
                        "Date": row["visit_date"],
                        "Teacher": row["teacher"],
                        "School": row["school"],
                        "Subject": row["subject"],
                        "Class": row["class_section"],
                        "A Grades": a_cnt,
                        "B Grades": b_cnt,
                        "C Grades": c_cnt,
                        "PDF Report": row.get("pdf_url")
                    })
                
                summary_df = pd.DataFrame(summary_cards)
                st.dataframe(summary_df, use_container_width=True)

                st.markdown("##### 🔍 Drill-Down Visit Review & Live Editor")
                for _, row in obs_history_df.iterrows():
                    with st.expander(f"📅 Visit #{row['id']}: {row['visit_date']} — Teacher: {row['teacher']} ({row['school']}) | Topic: {row['topic']}"):
                        v_c1, v_c2 = st.columns([3, 1])
                        with v_c1:
                            st.write(f"**Mentor:** {row['academic_mentor']} | **Duration:** {row['duration']} | **Students Present:** {row['students_present']}")
                            st.markdown("**Flow of the class:**")
                            st.write(row['flow_of_class'])
                            st.markdown("**High Points:**")
                            st.write(row['high_points'])
                            st.markdown("**Recommendations:**")
                            st.write(row['recommendations'])
                            
                            ev_links_cell = row.get("evidence_links")
                            if ev_links_cell:
                                st.markdown("**Uploaded Activity Media / Evidences:**")
                                for single_ev in str(ev_links_cell).split(","):
                                    if single_ev.strip():
                                        f_type = detect_evidence_file_type(single_ev.strip())
                                        render_evidence_media_preview({"url": single_ev.strip(), "file_type": f_type}, widget_key=f"hist_ev_{row['id']}_{abs(hash(single_ev))}")
                            
                            if row['pdf_url']:
                                st.markdown(f"[📄 Download Stored Cloud PDF]({row['pdf_url']})")

                        with v_c2:
                            if st.button(f"✏️ Edit Visit #{row['id']}", key=f"btn_edit_hist_{row['id']}"):
                                st.session_state["editing_obs_id"] = row["id"]
                                st.session_state["edit_meta_cache"] = {
                                    "school": row["school"],
                                    "teacher": row["teacher"],
                                    "custom_teacher": row["teacher"],
                                    "mentor": row["academic_mentor"],
                                    "class_section": row["class_section"],
                                    "subject": row["subject"],
                                    "topic": row["topic"],
                                    "visit_date": str(row["visit_date"]),
                                    "duration": row["duration"],
                                    "students_present": row["students_present"],
                                    "print_displayed": row["print_displayed"],
                                    "evidence_links": row.get("evidence_links", "")
                                }
                                for widget, field in {'obs_school_sel':'school','obs_teacher_sel':'teacher','obs_custom_teacher':'teacher',
                                    'obs_mentor_name':'academic_mentor','obs_class_sec':'class_section','obs_subject':'subject','obs_topic':'topic',
                                    'obs_dur':'duration','obs_num_students':'students_present','obs_print_disp':'print_displayed'}.items():
                                    # Applied before form instantiation on the next rerun.
                                    st.session_state.setdefault('_pending_observation_widgets',{})[widget] = row[field]
                                st.session_state['_pending_observation_widgets']['obs_date_pick'] = pd.Timestamp(row['visit_date']).date()
                                st.session_state.setdefault("_pending_observation_widgets",{})["obs_narr_flow"] = row["flow_of_class"]
                                st.session_state.setdefault("_pending_observation_widgets",{})["obs_narr_high"] = row["high_points"]
                                st.session_state.setdefault("_pending_observation_widgets",{})["obs_narr_recom"] = row["recommendations"]

                                r_json = row.get("rubric_json") or {}
                                if isinstance(r_json, str):
                                    r_json = json.loads(r_json)
                                for cat_name, val_dict in r_json.items():
                                    if isinstance(val_dict, dict):
                                        st.session_state.setdefault("_pending_observation_widgets",{})[f"rubric_opt_{cat_name}"] = val_dict.get("Grade", "NA")
                                        st.session_state.setdefault("_pending_observation_widgets",{})[f"rubric_rem_{cat_name}"] = val_dict.get("Remarks", "")

                                st.success(f"Visit #{row['id']} loaded! Switch to '📝 New Classroom Observation Visit' tab to edit and submit.")
                                st.rerun()

    with tab9:
        render_workspace(conn, filtered_df, filtered_roster, selected_schools, employee_name,
            filter_description_text, teacher_days if use_teacher_eligible_days else selected_num_days,
            dict(prep=daily_ld_target_t4, library=daily_lib_target_t4, content=daily_content_target_t4),
            f"{len(selected_teachers)} teacher name(s); Sundays excluded={exclude_sundays_flag}; school calendars={use_teacher_eligible_days}; holidays={user_excluded_dates}")
    with tab10:
        if workflow_ready(conn):
            st.info("Upgrading an existing portal? Import the original CRM JSON files once using the button below. Existing files are preserved and repeated imports skip previously imported records.")
            if st.button("Import existing CRM contacts and call logs", key="migrate_legacy_crm"):
                try:
                    contacts, calls = migrate_legacy_crm()
                    st.success(f"Imported {contacts} contact(s) and {calls} call log(s).")
                except Exception as e:
                    st.error(str(e))
        render_data_quality(conn, df, filtered_df, employee_name)
