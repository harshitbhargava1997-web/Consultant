import streamlit as st
import pandas as pd
import numpy as np
import plotly.express as px
import plotly.graph_objects as go
import os
import re
import json
import uuid
import urllib.parse
from io import BytesIO
from sqlalchemy import text
from supabase import create_client

# Google GenAI SDK (Requires package 'google-genai')
from google import genai

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
    return out


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
            "Writing_Sample_Link", "Phonics_Evidence_Link", "Portfolio_Evidence_Link"
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
        combined = pd.concat([df_raw, subs_df], ignore_index=True) if not df_raw.empty else subs_df
        dedupe_cols = [c for c in ['Uploaded_By', 'FullName', 'Institution', 'Type', 'StartTime', 'EndTime', 'Duration_Min'] if c in combined.columns]
        if dedupe_cols:
            combined = combined.drop_duplicates(subset=dedupe_cols, keep='last')
        df_raw = combined

    if df_raw.empty:
        return pd.DataFrame()

    return normalize_identity_columns(df_raw)


@st.cache_data(ttl=600, show_spinner=False)
def load_crm_data_from_supabase():
    try:
        response = supabase.storage.from_(BUCKET_NAME).download(CRM_FILE_NAME)
        if response:
            return json.loads(response.decode('utf-8'))
    except Exception:
        pass
    return {"contacts": {}}


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
        st.error(f"Could not sync CRM data to Supabase: {e}")


@st.cache_data(ttl=600, show_spinner=False)
def load_call_logs_from_supabase():
    try:
        response = supabase.storage.from_(BUCKET_NAME).download(CALL_LOGS_FILE_NAME)
        if response:
            return json.loads(response.decode('utf-8'))
    except Exception:
        pass
    return []


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
        st.error(f"Could not sync call discussion logs to Supabase: {e}")


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


def get_gemini_summary(context_prompt, audio_file_obj=None):
    if not ai_client:
        return "⚠️ Gemini API key not found in Streamlit secrets."
    try:
        contents_payload = [context_prompt]
        if audio_file_obj is not None:
            audio_bytes = audio_file_obj.read()
            contents_payload.append(
                genai.types.Part.from_bytes(
                    data=audio_bytes,
                    mime_type="audio/wav"
                )
            )

        response = ai_client.models.generate_content(
            model='gemini-2.5-flash',
            contents=contents_payload
        )
        return response.text
    except Exception as e:
        return f"AI Generation Notice: {e}"


# --- REPORTLAB GENERATOR FOR CLASSROOM OBSERVATION VISIT AUDIT ---
def generate_classroom_observation_visit_pdf(metadata, rubric_scores, narratives):
    buffer = BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=letter, leftMargin=24, rightMargin=24, topMargin=24, bottomMargin=24)
    story = []
    styles = getSampleStyleSheet()

    header_blue = colors.HexColor('#0284C7')
    dark_neutral = colors.HexColor('#0F172A')
    light_bg = colors.HexColor('#F8FAFC')
    border_color = colors.HexColor('#CBD5E1')

    title_style = ParagraphStyle('ObsTitle', parent=styles['Heading1'], fontSize=12, leading=15, textColor=header_blue, fontName='Helvetica-Bold')
    sub_title = ParagraphStyle('ObsSub', parent=styles['Normal'], fontSize=8, leading=11, textColor=dark_neutral)
    cell_bold = ParagraphStyle('CellB', parent=styles['Normal'], fontSize=7.5, leading=10, textColor=dark_neutral, fontName='Helvetica-Bold')
    cell_norm = ParagraphStyle('CellN', parent=styles['Normal'], fontSize=6.5, leading=8.5, textColor=dark_neutral)
    header_style = ParagraphStyle('HeadS', parent=styles['Normal'], fontSize=7.5, leading=10, textColor=colors.white, fontName='Helvetica-Bold', alignment=1)
    sec_head = ParagraphStyle('SecH', parent=styles['Heading2'], fontSize=9, leading=12, textColor=header_blue, fontName='Helvetica-Bold', spaceBefore=8, spaceAfter=4)
    narrative_p = ParagraphStyle('NarrP', parent=styles['Normal'], fontSize=7.5, leading=10.5, textColor=dark_neutral)

    story.append(Paragraph(f"<b>OneLern Classroom Observation :- {metadata.get('School', 'N/A')}</b>", title_style))
    story.append(Spacer(1, 4))
    story.append(HRFlowable(width="100%", thickness=1.5, color=header_blue, spaceAfter=8))

    meta_data = [
        [Paragraph("<b>Name of the Teacher</b>", cell_bold), Paragraph(metadata.get("Teacher", ""), sub_title), Paragraph("<b>Date</b>", cell_bold), Paragraph(str(metadata.get("Date", "")), sub_title)],
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

    for cat_name, desc_dict in OBSERVATION_RUBRIC_CONFIG.items():
        res = rubric_scores.get(cat_name, {"Grade": "A", "Remarks": ""})
        rubric_rows.append([
            Paragraph(cat_name, cell_bold),
            Paragraph(desc_dict.get("A", ""), cell_norm),
            Paragraph(desc_dict.get("B", ""), cell_norm),
            Paragraph(desc_dict.get("C", ""), cell_norm),
            Paragraph(f"<b>{res.get('Grade', 'NA')}</b>", ParagraphStyle('Ctr', parent=cell_bold, alignment=1)),
            Paragraph(res.get("Remarks", ""), cell_norm)
        ])

    rubric_table = Table(rubric_rows, colWidths=[80, 130, 130, 110, 34, 80], repeatRows=1)
    rubric_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), header_blue),
        ('GRID', (0, 0), (-1, -1), 0.4, border_color),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, light_bg]),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
    ]))
    story.append(rubric_table)
    story.append(Spacer(1, 10))

    story.append(Paragraph("<b>Flow of the class</b>", sec_head))
    story.append(HRFlowable(width="100%", thickness=0.5, color=border_color, spaceAfter=4))
    story.append(Paragraph(narratives.get("Flow", "N/A").replace('\n', '<br/>'), narrative_p))
    story.append(Spacer(1, 8))

    story.append(Paragraph("<b>High Points of the class</b>", sec_head))
    story.append(HRFlowable(width="100%", thickness=0.5, color=border_color, spaceAfter=4))
    story.append(Paragraph(narratives.get("HighPoints", "N/A").replace('\n', '<br/>'), narrative_p))
    story.append(Spacer(1, 8))

    story.append(Paragraph("<b>Recommendations by the Academic Mentor</b>", sec_head))
    story.append(HRFlowable(width="100%", thickness=0.5, color=border_color, spaceAfter=4))
    story.append(Paragraph(narratives.get("Recommendations", "N/A").replace('\n', '<br/>'), narrative_p))

    doc.build(story)
    buffer.seek(0)
    return buffer


def render_school_audit_crm_box(tab_name, active_school, current_filter_description, school_audit_whatsapp_message):
    st.markdown("---")
    st.subheader(f"📞 School & Coordinator CRM, Call Notes & WhatsApp Generators ({tab_name})")
    
    if "crm_global_data" not in st.session_state:
        st.session_state["crm_global_data"] = load_crm_data_from_supabase()

    if "crm_call_logs_store" not in st.session_state:
        st.session_state["crm_call_logs_store"] = load_call_logs_from_supabase()

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
            save_crm_data_to_supabase(crm_data)
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
            manager_voice_audio = st.audio_input("🎙️ Record Voice Instructions:", key=f"voice_input_{tab_name}_{target_crm_school}")
            user_custom_instruction = st.text_area("Or Type Custom Instructions:", placeholder="e.g., Focus heavily on improving library engagement...", key=f"ai_custom_prompt_{tab_name}_{target_crm_school}")
            
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
                    1. Calling Script: A structured phone conversation script.
                    2. AI WhatsApp Follow-up Message. Sign off with 'Onelearn Academic Team'.
                    """
                    with st.spinner("Processing with Gemini..."):
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
            st.markdown(f'<a href="https://wa.me/{clean_phone}?text={encoded_final_text}" target="_blank" style="text-decoration:none;"><button style="background-color:#25D366;color:white;padding:10px 18px;border:none;border-radius:4px;cursor:pointer;font-weight:bold;width:100%;">🚀 Send Final WhatsApp Message</button></a>', unsafe_allow_html=True)


def render_universal_crm_box(tab_name, active_selected_schools, current_filter_description, metrics_summary_text):
    st.markdown("---")
    st.subheader(f"📞 School & Coordinator CRM, Call Notes & WhatsApp Generators ({tab_name})")
    
    if "crm_global_data" not in st.session_state:
        st.session_state["crm_global_data"] = load_crm_data_from_supabase()

    if "crm_call_logs_store" not in st.session_state:
        st.session_state["crm_call_logs_store"] = load_call_logs_from_supabase()

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
            crm_data["contacts"][target_crm_school][selected_entity_type] = {"name": input_contact_name, "phone": input_phone}
            save_crm_data_to_supabase(crm_data)
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

        editable_wa_area = st.text_area("Confirm or Edit Final WhatsApp Message Draft:", value=st.session_state[draft_state_key], height=140, key=f"wa_textarea_{tab_name}_{target_crm_school}_{selected_entity_type}")
        st.session_state[draft_state_key] = editable_wa_area

        if active_phone:
            clean_phone = re.sub(r'[^0-9+]', '', active_phone)
            encoded_final_text = urllib.parse.quote(editable_wa_area)
            st.markdown(f'<a href="https://wa.me/{clean_phone}?text={encoded_final_text}" target="_blank" style="text-decoration:none;"><button style="background-color:#25D366;color:white;padding:10px 18px;border:none;border-radius:4px;cursor:pointer;font-weight:bold;width:100%;">🚀 Send Final WhatsApp Message</button></a>', unsafe_allow_html=True)


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
        header_style = ParagraphStyle('TableHeader', parent=styles['Normal'], fontSize=8.5, leading=12, textColor=colors.white, fontName='Helvetica-Bold')

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


def extract_evidence_items_vectorized(df_src, col_name):
    if col_name not in df_src.columns or df_src.empty:
        return []
    
    col_str = df_src[col_name].fillna('').astype(str).str.strip()
    valid_mask = col_str.str.contains('http://', regex=False) | col_str.str.contains('https://', regex=False)
    valid_rows = df_src[valid_mask]
    
    if valid_rows.empty:
        return []
        
    items = []
    for _, r in valid_rows.iterrows():
        raw_val = str(r[col_name]).strip()
        urls = [u.strip() for u in raw_val.split(',') if u.strip().lower().startswith(('http://', 'https://'))]
        if not urls:
            continue
        d_str = str(r['Date']) if 'Date' in r and pd.notna(r['Date']) else "Recent"
        g_str = f"Grade {r['Grade']}" if 'Grade' in r and str(r['Grade']).strip() else "Grade N/A"
        s_str = str(r['Subject']).strip() if 'Subject' in r and str(r['Subject']).strip() else "General Subject"
        b_str = str(r['Book']).strip() if 'Book' in r and str(r['Book']).strip() else "Lesson Plan"
        for u in urls:
            items.append({'url': u, 'date': d_str, 'grade': g_str, 'subject': s_str, 'lesson': b_str})
        
    seen = set()
    deduped = []
    for item in items:
        if item['url'] not in seen:
            seen.add(item['url'])
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


def generate_comprehensive_school_pdf_report(school_name, teachers_list, school_filtered_df, filtered_df, filter_desc, calc_ld_kpi, calc_lib_kpi, daily_ld_target, daily_lib_target, selected_num_days, target_vid_count=3, target_writing_count=3, target_lp_combo_count=3, target_phonics_count=2, target_portfolio_count=1, enable_quant_kpi=True, enable_qual_kpi=True):
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

    if isinstance(school_name, (list, tuple, set, np.ndarray, pd.Series)):
        school_names = [str(x) for x in school_name if str(x).strip()]
        school_curr_df = filtered_df[filtered_df['Institution'].isin(school_names)]
        if school_curr_df.empty and not school_filtered_df.empty:
            school_curr_df = school_filtered_df[school_filtered_df['Institution'].isin(school_names)]
    else:
        school_names = [str(school_name)]
        school_curr_df = filtered_df[filtered_df['Institution'] == school_name]
        if school_curr_df.empty and not school_filtered_df.empty:
            school_curr_df = school_filtered_df[school_filtered_df['Institution'] == school_name]

    story.append(Paragraph(f"<b>Comprehensive School Audit & Feature-Wise Report</b>", title_style))
    story.append(Spacer(1, 4))
    story.append(Paragraph(f"<b>Institution / School Focus:</b> {school_name}", school_style))
    story.append(Spacer(1, 3))
    story.append(Paragraph(f"Observation Window: {filter_desc}", subtitle_style))
    story.append(Spacer(1, 8))
    story.append(HRFlowable(width="100%", thickness=1.5, color=primary_color, spaceAfter=12))

    ld_df = school_curr_df[school_curr_df['Type'] == 'lessonDelivery']
    ld_usage = ld_df.groupby('FullName')['Duration_Min'].sum().to_dict()
    
    lib_df = school_curr_df[school_curr_df['Type'] == 'library']
    lib_usage = lib_df.groupby('FullName')['Duration_Min'].sum().to_dict()

    total_teachers_count = len(teachers_list)
    met_ld_count = 0
    met_lib_count = 0

    for t_name in teachers_list:
        t_ld = ld_usage.get(t_name, 0.0)
        t_lib = lib_usage.get(t_name, 0.0)
        
        if (calc_ld_kpi > 0 and t_ld >= calc_ld_kpi) or (calc_ld_kpi == 0 and t_ld > 0):
            met_ld_count += 1
        if (calc_lib_kpi > 0 and t_lib >= calc_lib_kpi) or (calc_lib_kpi == 0 and t_lib > 0):
            met_lib_count += 1

    school_summary_metrics = {
        "Active Roster Teachers": total_teachers_count,
        "Working Days Evaluated": f"{selected_num_days} Days"
    }
    if enable_quant_kpi:
        school_summary_metrics["Met Lesson Prep KPI"] = f"{met_ld_count} / {total_teachers_count}"
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
        story.append(Paragraph(f"• <b>Lesson Plan Performance Standard:</b> {daily_ld_target:.0f} mins/day × {selected_num_days} working days ({calc_ld_kpi:.0f} mins total benchmark standard)", normal_style))
        story.append(Paragraph(f"• <b>Library Usage Performance Standard:</b> {daily_lib_target:.0f} mins/day × {selected_num_days} working days ({calc_lib_kpi:.0f} mins total benchmark standard)", normal_style))
        story.append(Spacer(1, 10))

    story.append(Paragraph("<b>1. Lesson Plan Preparation Consolidated Report</b>", sec_head_style))
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
            t_stat = "Inactive (0 Mins)"
        ld_summary_table_data.append([t_name, f"{t_mins:.1f}m", f"{t_avg:.1f}m/day", t_stat])

    ld_table_obj = Table(ld_summary_table_data, colWidths=[140, 110, 100, 190])
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
    ]))
    story.append(ld_table_obj)
    story.append(Spacer(1, 14))

    story.append(Paragraph("<b>2. Library Usage Consolidated Report</b>", sec_head_style))
    lib_summary_table_data = [["Teacher Name", "Total Minutes Logged", "Average Mins/Day", "Performance Indicator Status"]]
    for t_name in teachers_list:
        t_lib_mins = lib_usage.get(t_name, 0.0)
        t_lib_avg = t_lib_mins / selected_num_days if selected_num_days > 0 else 0.0
        if not enable_quant_kpi or calc_lib_kpi == 0:
            t_lib_stat = "Activity Logged" if t_lib_mins > 0 else "No Activity Logged"
        elif t_lib_mins >= calc_lib_kpi:
            t_lib_stat = f"Met Performance Indicator (>= {calc_lib_kpi:.0f}m)"
        elif t_lib_mins > 0.0:
            t_lib_stat = f"Below Performance Indicator (< {calc_lib_kpi:.0f}m)"
        else:
            t_lib_stat = "Inactive (0 Mins)"
        lib_summary_table_data.append([t_name, f"{t_lib_mins:.1f}m", f"{t_lib_avg:.1f}m/day", t_lib_stat])

    lib_table_obj = Table(lib_summary_table_data, colWidths=[140, 110, 100, 190])
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
    ]))
    story.append(lib_table_obj)
    story.append(Spacer(1, 14))

    if enable_qual_kpi:
        story.append(Paragraph("<b>3. Qualitative Submissions & Evidence Compliance</b>", sec_head_style))
        qual_summary_table_data = [["Teacher Name", "LP / Audio Notes", "Activity Videos", "Writing Samples", "Phonics Evidences", "Portfolio Artifacts", "Status"]]
        
        for t_name in teachers_list:
            sub_t = school_curr_df[school_curr_df['FullName'] == t_name]
            v_cnt = len(evidence_items_across_columns(sub_t, ['Video_Evidence_1', 'Video_Evidence_2', 'Video_Evidence_3']))
            w_cnt = len(extract_evidence_items_vectorized(sub_t, 'Writing_Sample_Link'))
            lp_cnt = len(extract_evidence_items_vectorized(sub_t, 'Lesson_Plan_Picture'))
            vn_cnt = len(extract_evidence_items_vectorized(sub_t, 'Voice_Note_Link'))
            ph_cnt = len(extract_evidence_items_vectorized(sub_t, 'Phonics_Evidence_Link'))
            pf_cnt = len(extract_evidence_items_vectorized(sub_t, 'Portfolio_Evidence_Link'))
            
            is_q_ok = (v_cnt >= target_vid_count and w_cnt >= target_writing_count and (lp_cnt + vn_cnt) >= target_lp_combo_count and ph_cnt >= target_phonics_count and pf_cnt >= target_portfolio_count)
            q_stat = "Met Standard" if is_q_ok else "In Progress"
            qual_summary_table_data.append([t_name, str(lp_cnt + vn_cnt), str(v_cnt), str(w_cnt), str(ph_cnt), str(pf_cnt), q_stat])

        qual_table_obj = Table(qual_summary_table_data, colWidths=[130, 80, 70, 70, 75, 75, 40])
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
        ]))
        story.append(qual_table_obj)
        story.append(Spacer(1, 12))

    for target_teacher in teachers_list:
        story.append(PageBreak())

        teacher_date_data = school_curr_df[school_curr_df['FullName'] == target_teacher]
        teacher_all_data = school_filtered_df[(school_filtered_df['FullName'] == target_teacher) & (school_filtered_df['Institution'] == school_name)]

        t_day_ld = teacher_date_data[teacher_date_data['Type'] == 'lessonDelivery']['Duration_Min'].sum() if not teacher_date_data.empty else 0.0
        t_day_lib = teacher_date_data[teacher_date_data['Type'] == 'library']['Duration_Min'].sum() if not teacher_date_data.empty else 0.0
        
        ld_pct = safe_percentage(t_day_ld, calc_ld_kpi)
        lib_pct = safe_percentage(t_day_lib, calc_lib_kpi)

        ld_advice = f"Steady Execution ({t_day_ld:.1f}m logged)" if (calc_ld_kpi > 0 and t_day_ld >= calc_ld_kpi) else (f"In-Progress ({t_day_ld:.1f}m logged)" if t_day_ld > 0 else "Pending Activity")
        lib_advice = f"Steady Execution ({t_day_lib:.1f}m logged)" if (calc_lib_kpi > 0 and t_day_lib >= calc_lib_kpi) else (f"In-Progress ({t_day_lib:.1f}m logged)" if t_day_lib > 0 else "Pending Activity")

        t_books_raw = teacher_date_data[teacher_date_data['Book'].str.len() > 0]
        if t_books_raw.empty:
            t_books_raw = teacher_all_data[teacher_all_data['Book'].str.len() > 0]
        teacher_books = t_books_raw[~t_books_raw['Book'].str.match(r'^Lesson Plan', case=False, na=False)]

        evidence_source = teacher_date_data if not teacher_date_data.empty else teacher_all_data

        v_voice = extract_evidence_items_vectorized(evidence_source, 'Voice_Note_Link')
        v_pic = extract_evidence_items_vectorized(evidence_source, 'Lesson_Plan_Picture')
        v_writing = extract_evidence_items_vectorized(evidence_source, 'Writing_Sample_Link')
        v_phonics = extract_evidence_items_vectorized(evidence_source, 'Phonics_Evidence_Link')
        v_portfolio = extract_evidence_items_vectorized(evidence_source, 'Portfolio_Evidence_Link')
        v_vid = evidence_items_across_columns(evidence_source, ['Video_Evidence_1', 'Video_Evidence_2', 'Video_Evidence_3'])

        lp_combo_total = len(v_voice) + len(v_pic)
        total_artifacts = lp_combo_total + len(v_vid) + len(v_writing) + len(v_phonics) + len(v_portfolio)

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
            pdf_link_items.append(f'• 🎥 <a href="{item["url"]}"><u><b>Watch Classroom Activity Video #{i}</b></u></a> — <i>{item["grade"]} | {item["subject"]} ({item["lesson"]}, {item["date"]})</i>')
        for i, item in enumerate(v_writing, 1): 
            pdf_link_items.append(f'• 📝 <a href="{item["url"]}"><u><b>View Student Writing Sample #{i}</b></u></a> — <i>{item["grade"]} | {item["subject"]} ({item["lesson"]}, {item["date"]})</i>')
        for i, item in enumerate(v_phonics, 1): 
            pdf_link_items.append(f'• 🔤 <a href="{item["url"]}"><u><b>Open Phonics Evidence #{i}</b></u></a> — <i>{item["grade"]} | {item["subject"]} ({item["lesson"]}, {item["date"]})</i>')
        for i, item in enumerate(v_portfolio, 1): 
            pdf_link_items.append(f'• 📁 <a href="{item["url"]}"><u><b>View Teacher Portfolio Showcase #{i}</b></u></a> — <i>{item["grade"]} | {item["subject"]} ({item["lesson"]}, {item["date"]})</i>')

        story.append(Paragraph(f"<b>Academic Performance Profile: {target_teacher}</b>", title_style))
        story.append(Spacer(1, 4))
        story.append(Paragraph(f"<b>Institution / School Focus:</b> {school_name}", school_style))
        story.append(Spacer(1, 3))
        story.append(Paragraph(f"Observation Window: {filter_desc}", subtitle_style))
        story.append(Spacer(1, 6))
        story.append(HRFlowable(width="100%", thickness=1.5, color=primary_color, spaceAfter=10))

        summary_metrics = {
            "Teacher": target_teacher,
            "Lesson Prep": f"{t_day_ld:.1f}m",
            "Library Usage": f"{t_day_lib:.1f}m",
            "Phonics / Portfolio": f"{len(v_phonics)} / {len(v_portfolio)}",
            "Activity Submissions": f"{total_artifacts}"
        }
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

        sections = {
            "1. Lesson Preparation, Lesson Delivery, and Library Usage": [
                f"Lesson Preparation Duration: {t_day_ld:.1f} Minutes" + (f" ({ld_pct:.0f}% of Academic Benchmark)" if enable_quant_kpi else ""),
                f"Library & Digital Resources Duration: {t_day_lib:.1f} Minutes" + (f" ({lib_pct:.0f}% of Academic Benchmark)" if enable_quant_kpi else ""),
                f"Consultant Assessment: {ld_advice} in lesson preparation, {lib_advice} in library integration."
            ],
            "2. Content / Digital Book Content Usage": pdf_book_items,
            "3. Activity Evidence, Activity Submission, and Artifact Evidence": pdf_link_items if pdf_link_items else ["No activity or evidence submission links recorded in active window."]
        }

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
    if teacher_df is None or teacher_df.empty or period_start is None or period_end is None:
        return 0
    dates = pd.to_datetime(teacher_df['Date'], errors='coerce').dropna()
    if dates.empty:
        return 0
    dates = dates[(dates.dt.date >= pd.Timestamp(period_start).date()) & (dates.dt.date <= pd.Timestamp(period_end).date())]
    if dates.empty:
        return 0
    return get_working_days(dates.min().date(), dates.max().date(), excluded_dates, exclude_sundays)


def teacher_days_map(roster_df, activity_df, period_start, period_end, excluded_dates=None, exclude_sundays=True):
    result = {}
    if roster_df is None or roster_df.empty:
        return result
    for _, row in roster_df[['Institution','FullName']].drop_duplicates().iterrows():
        inst, teacher = row['Institution'], row['FullName']
        tdf = activity_df[(activity_df['Institution'] == inst) & (activity_df['FullName'] == teacher)] if activity_df is not None and not activity_df.empty else pd.DataFrame()
        result[(inst, teacher)] = get_teacher_eligible_working_days(tdf, period_start, period_end, excluded_dates, exclude_sundays)
    return result


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
    return '❌ Inactive (0 Mins)'


# --- INGESTION WITH PYTHON-LEVEL COMPOSITE KEY DEDUPLICATION ---
def ingest_excel_to_postgresql(processed_dfs):
    if not processed_dfs:
        return 0, 0
    combined_df = pd.concat(processed_dfs, ignore_index=True)
    combined_df = normalize_identity_columns(combined_df)
    
    db_cols = [
        "State_Zone", "Uploaded_By", "Institution", "Center",
        "FirstName", "LastName", "FullName", "Role", "Type",
        "Grade", "Subject", "Book", "StartTime", "EndTime",
        "Duration_Min", "Voice_Note_Link", "Lesson_Plan_Picture",
        "Video_Evidence_1", "Video_Evidence_2", "Video_Evidence_3",
        "Writing_Sample_Link", "Phonics_Evidence_Link", "Portfolio_Evidence_Link",
        "Assessment_Score_Pct"
    ]
    
    for col in db_cols:
        if col not in combined_df.columns:
            combined_df[col] = None

    cleaned_df = combined_df[db_cols].copy()
    
    for dt_col in ['StartTime', 'EndTime']:
        cleaned_df[dt_col] = pd.to_datetime(cleaned_df[dt_col], errors='coerce')

    if 'Duration_Min' in cleaned_df.columns:
        cleaned_df['Duration_Min'] = pd.to_numeric(cleaned_df['Duration_Min'], errors='coerce').fillna(0.0).clip(lower=0.0)

    if cleaned_df['StartTime'].isna().all():
        cleaned_df['StartTime'] = pd.Timestamp.now()

    dedupe_cols = ['Institution', 'FullName', 'Type', 'StartTime', 'Duration_Min', 'Subject', 'Book']
    cleaned_df = cleaned_df.drop_duplicates(subset=dedupe_cols, keep='last')
    
    total_incoming = len(cleaned_df)
    if cleaned_df.empty:
        return 0, 0

    engine = conn.engine
    try:
        with engine.begin() as bulk_conn:
            existing_query = text("""
                SELECT 
                    COALESCE("Institution", '') AS "Institution",
                    COALESCE("FullName", '') AS "FullName",
                    COALESCE("Type", '') AS "Type",
                    "StartTime",
                    COALESCE("Duration_Min", 0.0) AS "Duration_Min",
                    COALESCE("Subject", '') AS "Subject",
                    COALESCE("Book", '') AS "Book"
                FROM teacher_records
            """)
            existing_records = bulk_conn.execute(existing_query).fetchall()
            
            def make_sig(inst, name, typ, st_time, dur, subj, bk):
                st_str = pd.to_datetime(st_time).strftime('%Y-%m-%d %H:%M') if pd.notna(st_time) else ""
                dur_val = round(float(dur or 0.0), 1)
                return (
                    str(inst).strip().lower(),
                    str(name).strip().lower(),
                    str(typ).strip().lower(),
                    st_str,
                    dur_val,
                    str(subj).strip().lower(),
                    str(bk).strip().lower()
                )

            existing_set = {
                make_sig(r[0], r[1], r[2], r[3], r[4], r[5], r[6])
                for r in existing_records
            }

            incoming_mask = ~cleaned_df.apply(
                lambda row: make_sig(
                    row['Institution'], row['FullName'], row['Type'],
                    row['StartTime'], row['Duration_Min'], row['Subject'], row['Book']
                ) in existing_set,
                axis=1
            )

            records_to_insert = cleaned_df[incoming_mask].copy()
            records_to_insert = records_to_insert.replace({np.nan: None})

            if not records_to_insert.empty:
                records_to_insert.to_sql(
                    'teacher_records',
                    con=bulk_conn,
                    index=False,
                    if_exists='append',
                    method='multi',
                    chunksize=1000
                )
                inserted_count = len(records_to_insert)
            else:
                inserted_count = 0

            duplicate_count = total_incoming - inserted_count

        st.cache_data.clear()
        return inserted_count, duplicate_count

    except Exception as e:
        st.error(f"Ingestion database error: {e}")
        return 0, 0


# --- MULTI-EMPLOYEE DATA UPLOAD MANAGER ---
st.sidebar.header("📁 Multi-Employee Data Ingestion Portal")

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
        new_processed_dfs = []
        for file in uploaded_files:
            try:
                temp_dict = pd.read_excel(file, sheet_name=None)
                target_sheet = next(
                    (s for s in temp_dict.keys() if "usermetric" in s.lower()), 
                    list(temp_dict.keys())[0]
                )
                temp_df = temp_dict[target_sheet]

                temp_df = normalize_identity_columns(temp_df)
                temp_df['Uploaded_By'] = employee_name
                temp_df['State_Zone'] = employee_state

                if temp_df['Institution'].eq('').all():
                    temp_df['Institution'] = "Default School"
                else:
                    temp_df['Institution'] = temp_df['Institution'].replace('', 'Unknown School')

                for col in ['Grade', 'Subject', 'Book']:
                    if col not in temp_df.columns:
                        temp_df[col] = ''
                    else:
                        temp_df[col] = temp_df[col].fillna('').astype(str).str.replace(r'\s+', ' ', regex=True).str.strip()

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
                            return 0.0

                if 'Duration (HH:MM:SS)' in temp_df.columns:
                    temp_df['Duration_Min'] = temp_df['Duration (HH:MM:SS)'].apply(parse_duration_minutes)
                elif 'Duration (Minutes)' in temp_df.columns:
                    temp_df['Duration_Min'] = pd.to_numeric(temp_df['Duration (Minutes)'], errors='coerce').fillna(0.0)
                else:
                    temp_df['Duration_Min'] = 0.0

                if 'Type' in temp_df.columns:
                    temp_df['Type'] = temp_df['Type'].fillna('lessonDelivery').astype(str)
                else:
                    temp_df['Type'] = 'lessonDelivery'

                for dt_col in ['StartTime', 'EndTime']:
                    if dt_col in temp_df.columns:
                        temp_df[dt_col] = pd.to_datetime(temp_df[dt_col], errors='coerce')

                for qual_col in ['Voice_Note_Link', 'Lesson_Plan_Picture', 'Video_Evidence_1', 'Video_Evidence_2', 'Video_Evidence_3', 'Writing_Sample_Link', 'Phonics_Evidence_Link', 'Portfolio_Evidence_Link', 'Assessment_Score_Pct']:
                    if qual_col not in temp_df.columns:
                        temp_df[qual_col] = None

                new_processed_dfs.append(temp_df)
            except Exception as e:
                st.sidebar.error(f"Error reading {file.name}: {e}")

        if new_processed_dfs:
            inserted_count, duplicate_count = ingest_excel_to_postgresql(new_processed_dfs)
            fetch_master_db_from_supabase.clear()
            build_teacher_roster_cached.clear()
            if inserted_count > 0:
                st.sidebar.success(f"🎉 Database sync complete: {inserted_count} record(s) inserted successfully! ({duplicate_count} duplicates skipped)")
            else:
                st.sidebar.info(f"ℹ️ All {duplicate_count} records are already present in the database.")
            st.rerun()

df = fetch_master_db_from_supabase()

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

if not df.empty:
    st.sidebar.metric("Database Total Records", len(df))
    
    with st.sidebar.expander("🛠️ Selective Database Cleanup"):
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
            
            if st.button("🗑️ Delete Consultant Records from SQL DB"):
                try:
                    if not del_emp_name.strip():
                        st.error("Please enter the consultant name.")
                    else:
                        with conn.session as s:
                            s.execute(
                                text('DELETE FROM teacher_records WHERE LOWER("Uploaded_By") = LOWER(:name) AND "State_Zone" = :state'),
                                {"name": del_emp_name.strip(), "state": del_state_zone}
                            )
                            s.commit()
                        fetch_master_db_from_supabase.clear()
                        build_teacher_roster_cached.clear()
                        st.success(f"Successfully deleted records for {del_emp_name} in {del_state_zone}!")
                        st.rerun()
                except Exception as e:
                    st.error(f"Error deleting consultant data: {e}")
                    
        elif clean_mode == "By School":
            schools_in_db = sorted(df['Institution'].dropna().unique().tolist()) if 'Institution' in df.columns else []
            target_del_school = st.selectbox("Select School to Delete:", options=schools_in_db)
            if st.button("🗑️ Delete School Data from SQL DB"):
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
            if st.button("🚨 Clear Entire Database Table", key="clear_entire_teacher_db"):
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

                    st.sidebar.success(f"✅ Database cleared successfully: {deleted_count} record(s) deleted.")
                    st.rerun()
                except Exception as e:
                    fetch_master_db_from_supabase.clear()
                    build_teacher_roster_cached.clear()
                    st.sidebar.error(f"❌ Could not clear teacher_records: {e}")

if df.empty:
    st.title("🏫 Academic Manager Portfolio & Teacher Performance Indicator Review Dashboard")
    st.info("👋 Upload your `UserMetrics.xlsx` file in the sidebar and click **'🚀 Process & Ingest Files Now'** to populate your dashboard.")
else:
    df['StartTime'] = pd.to_datetime(df['StartTime'], errors='coerce').fillna(pd.Timestamp.now())
    df['Date'] = df['StartTime'].dt.date
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
    
    all_states = sorted([str(s) for s in df['State_Zone'].unique() if str(s).strip() and str(s).lower() not in ['nan', 'none']])
    default_states = ["Madhya Pradesh (MP)"] if "Madhya Pradesh (MP)" in all_states else all_states
    
    if all_states:
        selected_states = st.sidebar.multiselect("1. Select State(s) / Zone(s)", options=all_states, default=default_states)
        df_state = df[df['State_Zone'].isin(selected_states)] if selected_states else df
    else:
        df_state = df

    all_employees = sorted([str(e) for e in df_state['Uploaded_By'].unique() if str(e).strip() and str(e).lower() not in ['nan', 'none']])
    if all_employees:
        selected_employees = st.sidebar.multiselect("2. Select Consultant(s)", options=all_employees, default=all_employees)
        df_emp = df_state[df_state['Uploaded_By'].isin(selected_employees)] if selected_employees else df_state
    else:
        df_emp = df_state

    all_schools = sorted([str(s) for s in df_emp['Institution'].unique() if str(s).strip() and str(s).lower() not in ['nan', 'none']])
    selected_schools = st.sidebar.multiselect("3. Select School(s)", options=all_schools, default=all_schools)

    school_master_roster = master_teacher_roster[master_teacher_roster['Institution'].isin(selected_schools)] if selected_schools else master_teacher_roster
    school_filtered_df = df_emp[df_emp['Institution'].isin(selected_schools)] if selected_schools else df_emp

    # --- CALENDAR & HOLIDAY MANAGER ---
    st.sidebar.markdown("---")
    st.sidebar.header("📅 Calendar & Holiday Manager")
    
    available_months_df = school_filtered_df[['Month_Sort', 'Month_Name']].dropna().drop_duplicates().sort_values(by='Month_Sort', ascending=False)
    month_options = available_months_df['Month_Name'].tolist()
    
    selected_month = st.sidebar.selectbox("Select Review Month:", options=month_options if month_options else ["All Months"])
    month_filtered_df = school_filtered_df[school_filtered_df['Month_Name'] == selected_month] if selected_month != "All Months" else school_filtered_df
    
    exclude_sundays_flag = st.sidebar.checkbox("🗓️ Exclude Sundays from Performance Indicators", value=True)
    use_teacher_eligible_days = st.sidebar.checkbox(
        "👤 Use teacher-specific eligible working days", value=False,
        help="Default OFF uses actual calendar working days. ON uses working days between each teacher's first and last recorded activity in the selected period."
    )

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

    # --- GRANULARITY SELECTOR ---
    st.sidebar.subheader("🔍 Review View Level")
    available_month_weeks = sorted(month_filtered_df['Month_Week_Label'].dropna().unique())
    available_dates = sorted(month_filtered_df['Date'].dropna().unique(), reverse=True)
    
    view_mode = st.sidebar.radio("Granularity:", ["Full Month Summary", "Specific Week of Month", "Single Day Review", "Custom Date Range"])
    
    if month_filtered_df.empty and view_mode != "Custom Date Range":
        filtered_df = month_filtered_df
        selected_num_days = 0
        filter_description_text = f"Full Month: {selected_month} - 0 Records / 0 Working Days"
    elif view_mode == "Full Month Summary":
        filtered_df = month_filtered_df
        selected_num_days = get_working_days(selected_month_start, selected_month_end, user_excluded_dates, exclude_sundays=exclude_sundays_flag)
        filter_description_text = f"Full Month: {selected_month} - {selected_num_days} Working Days ({selected_month_start} to {selected_month_end})"
    elif view_mode == "Specific Week of Month":
        selected_week_label = st.sidebar.selectbox("Select Week:", options=available_month_weeks)
        filtered_df = month_filtered_df[month_filtered_df['Month_Week_Label'] == selected_week_label]
        w_start = filtered_df['Date'].min() if not filtered_df.empty else selected_month
        w_end = filtered_df['Date'].max() if not filtered_df.empty else selected_month
        selected_num_days = get_working_days(w_start, w_end, user_excluded_dates, exclude_sundays=exclude_sundays_flag)
        filter_description_text = f"{selected_week_label} - {selected_num_days} Working Days"
    elif view_mode == "Single Day Review":
        selected_date = st.sidebar.selectbox("Select Day:", options=available_dates)
        filtered_df = month_filtered_df[month_filtered_df['Date'] == selected_date]
        selected_num_days = get_working_days(selected_date, selected_date, user_excluded_dates, exclude_sundays=exclude_sundays_flag)
        filter_description_text = f"Single Date: {selected_date} - {selected_num_days} Working Days"
    else:
        min_avail = school_filtered_df['Date'].dropna().min() if not school_filtered_df['Date'].dropna().empty else pd.Timestamp.now().date()
        max_avail = school_filtered_df['Date'].dropna().max() if not school_filtered_df['Date'].dropna().empty else pd.Timestamp.now().date()
        
        custom_date_range = st.sidebar.date_input("Select Custom Date Range:", value=(min_avail, max_avail), min_value=min_avail, max_value=max_avail)
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
    
    filtered_roster = school_master_roster[school_master_roster['FullName'].isin(selected_teachers)] if selected_teachers else school_master_roster
    filtered_df = filtered_df[filtered_df['FullName'].isin(selected_teachers)] if selected_teachers else filtered_df

    period_start, period_end = get_period_bounds_for_view(
        selected_month, view_mode, month_filtered_df,
        c_start if view_mode == "Custom Date Range" else None,
        c_end if view_mode == "Custom Date Range" else None
    )
    teacher_days = teacher_days_map(
        filtered_roster, filtered_df, period_start, period_end,
        user_excluded_dates, exclude_sundays_flag
    ) if use_teacher_eligible_days else {}

    # --- 8 DEDICATED DASHBOARD TABS ---
    tab1, tab2, tab3, tab4, tab5, tab6, tab7, tab8 = st.tabs([
        "📘 1. Lesson Plan Preparation Tracker", 
        "📚 2. Library Usage Tracker", 
        "📖 3. Content & Chapters", 
        "👤 4. Teacher 360° Profile Report",
        "🏛️ 5. Manager Portfolio Quadrants",
        "🏫 6. School Teacher Progression",
        "📬 7. Live Evidence Submissions Feed",
        "📋 8. Classroom Visit Observation Form"
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

        ld_df = tab1_active_df[tab1_active_df['Type'] == 'lessonDelivery']
        ld_usage = ld_df.groupby(['Institution', 'FullName'])['Duration_Min'].sum().reset_index()
        ld_daily = tab1_active_roster.merge(ld_usage, on=['Institution', 'FullName'], how='left').fillna(0.0)
        ld_daily['Eligible Working Days'] = ld_daily.apply(lambda r: teacher_days.get((r['Institution'], r['FullName']), selected_num_days) if use_teacher_eligible_days else selected_num_days, axis=1)
        ld_daily['Performance Benchmark (Min)'] = ld_daily['Eligible Working Days'] * daily_ld_target_t1

        def get_ld_status_row(r):
            return calculate_kpi_status(r['Duration_Min'], r['Performance Benchmark (Min)'], enable_quant_kpi_t1, r['Eligible Working Days'] == 0)
        
        ld_daily['Performance Indicator Status'] = ld_daily.apply(get_ld_status_row, axis=1)

        c1, c2, c3, c4 = st.columns(4)
        total_teachers = len(ld_daily)
        met_count = len(ld_daily[(ld_daily['Duration_Min'] >= ld_daily['Performance Benchmark (Min)']) & (ld_daily['Performance Benchmark (Min)'] > 0)]) if enable_quant_kpi_t1 else len(ld_daily[ld_daily['Duration_Min'] > 0])
        inactive_count = len(ld_daily[ld_daily['Duration_Min'] == 0.0])
        
        c1.metric("Total Roster Teachers", total_teachers)
        c2.metric(f"Met Standard ({calc_ld_kpi_t1:.0f}m)" if enable_quant_kpi_t1 else "Active Teachers", f"{met_count} / {total_teachers}")
        c3.metric("Inactive Teachers (0m)", inactive_count, delta=f"{-inactive_count}" if inactive_count > 0 else "0", delta_color="inverse")
        c4.metric("Compliance Rate", f"{(met_count/total_teachers*100 if total_teachers>0 else 0):.1f}%")

        fig_ld = px.bar(
            ld_daily, x="FullName", y="Duration_Min", color="Performance Indicator Status",
            title=f"Lesson Prep Minutes per Teacher" + (f" vs. {calc_ld_kpi_t1:.0f} Min Standard" if enable_quant_kpi_t1 else ""),
            labels={"FullName": "Teacher Name", "Duration_Min": "Minutes Prepared"},
            text_auto=".1f"
        )
        if enable_quant_kpi_t1 and calc_ld_kpi_t1 > 0:
            fig_ld.add_hline(y=calc_ld_kpi_t1, line_dash="dash", line_color="black", annotation_text=f"Guideline ({calc_ld_kpi_t1:.0f} mins)")
        st.plotly_chart(fig_ld, use_container_width=True)

        display_ld_table = ld_daily.rename(columns={'Institution': 'School', 'FullName': 'Teacher Name', 'Duration_Min': 'Minutes Logged'}).round({'Minutes Logged': 1})
        st.dataframe(display_ld_table, use_container_width=True)

        teacher_prep_breakdown = "\n\n".join([f"• **{r['FullName']}**: {r['Duration_Min']:.1f} mins ({r['Performance Indicator Status']})" for _, r in ld_daily.iterrows()])
        tab1_metrics_summary = (
            f"🎯 Target KPI: {daily_ld_target_t1:.0f} mins/day × {selected_num_days} working days = {calc_ld_kpi_t1:.0f} mins total standard\n"
            f"Total Roster: {total_teachers} teachers | Met Standard: {met_count} | Inactive: {inactive_count} | Compliance Rate: {(met_count/total_teachers*100 if total_teachers>0 else 0):.1f}%\n\n"
            f"Detailed Teacher Lesson Prep Logs:\n{teacher_prep_breakdown}"
        )
        render_universal_crm_box("Lesson Plan Prep Tracker", selected_schools, filter_description_text, tab1_metrics_summary)

    # TAB 2: LIBRARY USAGE TRACKER
    with tab2:
        st.header("📚 Library Usage Tracker")
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

        lib_df = tab2_active_df[tab2_active_df['Type'] == 'library']
        lib_usage = lib_df.groupby(['Institution', 'FullName'])['Duration_Min'].sum().reset_index()
        lib_daily = tab2_active_roster.merge(lib_usage, on=['Institution', 'FullName'], how='left').fillna(0.0)
        lib_daily['Eligible Working Days'] = lib_daily.apply(lambda r: teacher_days.get((r['Institution'], r['FullName']), selected_num_days) if use_teacher_eligible_days else selected_num_days, axis=1)
        lib_daily['Performance Benchmark (Min)'] = lib_daily['Eligible Working Days'] * daily_lib_target_t2
        
        def get_lib_status_row(r):
            return calculate_kpi_status(r['Duration_Min'], r['Performance Benchmark (Min)'], enable_quant_kpi_t2, r['Eligible Working Days'] == 0)

        lib_daily['Performance Indicator Status'] = lib_daily.apply(get_lib_status_row, axis=1)

        m1, m2, m3, m4 = st.columns(4)
        lib_total_teachers = len(lib_daily)
        lib_met_count = len(lib_daily[(lib_daily['Duration_Min'] >= lib_daily['Performance Benchmark (Min)']) & (lib_daily['Performance Benchmark (Min)'] > 0)]) if enable_quant_kpi_t2 else len(lib_daily[lib_daily['Duration_Min'] > 0])
        lib_inactive_count = len(lib_daily[lib_daily['Duration_Min'] == 0.0])
        
        m1.metric("Total Roster Teachers", lib_total_teachers)
        m2.metric(f"Met Standard ({calc_lib_kpi_t2:.0f}m)" if enable_quant_kpi_t2 else "Active Teachers", f"{lib_met_count} / {lib_total_teachers}")
        m3.metric("Inactive Teachers (0m)", lib_inactive_count, delta=f"{-lib_inactive_count}" if lib_inactive_count > 0 else "0", delta_color="inverse")
        m4.metric("Engagement Rate", f"{(lib_met_count/lib_total_teachers*100 if lib_total_teachers>0 else 0):.1f}%")

        fig_lib = px.bar(
            lib_daily, x="FullName", y="Duration_Min", color="Performance Indicator Status",
            title=f"Library Usage Minutes per Teacher" + (f" vs. {calc_lib_kpi_t2:.0f} Min Standard" if enable_quant_kpi_t2 else ""),
            labels={"FullName": "Teacher Name", "Duration_Min": "Minutes Logged"},
            text_auto=".1f"
        )
        if enable_quant_kpi_t2 and calc_lib_kpi_t2 > 0:
            fig_lib.add_hline(y=calc_lib_kpi_t2, line_dash="dash", line_color="black", annotation_text=f"Guideline ({calc_lib_kpi_t2:.0f} mins)")
        st.plotly_chart(fig_lib, use_container_width=True)

        display_lib_table = lib_daily.rename(columns={'Institution': 'School', 'FullName': 'Teacher Name', 'Duration_Min': 'Minutes Logged'}).round({'Minutes Logged': 1})
        st.dataframe(display_lib_table, use_container_width=True)

        teacher_lib_breakdown = "\n\n".join([f"• **{r['FullName']}**: {r['Duration_Min']:.1f} mins ({r['Performance Indicator Status']})" for _, r in lib_daily.iterrows()])
        tab2_metrics_summary = (
            f"🎯 Target KPI: {daily_lib_target_t2:.0f} mins/day × {selected_num_days} working days = {calc_lib_kpi_t2:.0f} mins total standard\n"
            f"Total Roster: {lib_total_teachers} teachers | Active Met Standard: {lib_met_count} | Inactive: {lib_inactive_count} | Engagement Rate: {(lib_met_count/lib_total_teachers*100 if lib_total_teachers>0 else 0):.1f}%\n\n"
            f"Detailed Teacher Library Usage Logs:\n{teacher_lib_breakdown}"
        )
        render_universal_crm_box("Library Usage Tracker", selected_schools, filter_description_text, tab2_metrics_summary)

    # TAB 3: CONTENT & CHAPTERS
    with tab3:
        st.header("📖 Content & Chapters")
        content_raw = filtered_df[filtered_df['Book'].str.len() > 0]
        content_df = content_raw[~content_raw['Book'].str.match(r'^Lesson Plan', case=False, na=False)]

        if content_df.empty:
            st.info("No specific textbook/chapter access logs found.")
        else:
            col_f1, col_f2, col_f3 = st.columns(3)
            with col_f1:
                t3_school_opt = ["All Selected Schools"] + sorted(content_df['Institution'].unique().tolist())
                t3_school = st.selectbox("🏫 Select School:", t3_school_opt, key="t3_school")
            t3_df = content_df if t3_school == "All Selected Schools" else content_df[content_df['Institution'] == t3_school]

            with col_f2:
                t3_teacher_opt = ["All Teachers"] + sorted(t3_df['FullName'].unique().tolist())
                t3_teacher = st.selectbox("👤 Select Teacher:", t3_teacher_opt, key="t3_teacher")
            if t3_teacher != "All Teachers":
                t3_df = t3_df[t3_df['FullName'] == t3_teacher]

            with col_f3:
                t3_subject_opt = ["All Subjects"] + sorted(t3_df['Subject'].unique().tolist())
                t3_subject = st.selectbox("📚 Select Subject:", t3_subject_opt, key="t3_subject")
            if t3_subject != "All Subjects":
                t3_df = t3_df[t3_df['Subject'] == t3_subject]

            if not t3_df.empty:
                k1, k2, k3 = st.columns(3)
                k1.metric("Textbooks / Chapters Opened", t3_df['Book'].nunique())
                k2.metric("Subjects Taught", t3_df['Subject'].nunique())
                k3.metric("Total Content Access Time", f"{t3_df['Duration_Min'].sum():.1f} Mins")

                display_content_log = t3_df[['Institution', 'FullName', 'Grade', 'Subject', 'Book', 'StartTime', 'Duration_Min']].rename(columns={
                    'Institution': 'School', 'FullName': 'Teacher Name', 'Duration_Min': 'Minutes'
                }).sort_values(by='StartTime', ascending=False)
                st.dataframe(display_content_log, use_container_width=True)

    # TAB 4: TEACHER 360° PROFILE REPORT
    with tab4:
        st.header("👤 Teacher 360° Performance Profile")
        t4_fcol1, t4_fcol2 = st.columns(2)
        with t4_fcol1:
            t4_schools = ["All Selected Schools"] + sorted([s for s in school_master_roster['Institution'].unique() if str(s).strip()])
            t4_selected_school = st.selectbox("Filter Roster by School:", t4_schools, key="t4_school_filter")

        t4_active_roster = school_master_roster if t4_selected_school == "All Selected Schools" else school_master_roster[school_master_roster['Institution'] == t4_selected_school]
        all_roster_teachers = sorted(t4_active_roster['FullName'].unique())
        
        with t4_fcol2:
            target_teacher = st.selectbox("Select Teacher to Audit:", options=all_roster_teachers, key="top_teacher_select") if all_roster_teachers else None
        
        if target_teacher:
            teacher_all_data = school_filtered_df[school_filtered_df['FullName'] == target_teacher]
            teacher_date_data = filtered_df[filtered_df['FullName'] == target_teacher]
            teacher_school = school_master_roster[school_master_roster['FullName'] == target_teacher]['Institution'].values[0] if not school_master_roster[school_master_roster['FullName'] == target_teacher].empty else "N/A"

            t_day_ld = teacher_date_data[teacher_date_data['Type'] == 'lessonDelivery']['Duration_Min'].sum() if not teacher_date_data.empty else 0.0
            t_day_lib = teacher_date_data[teacher_date_data['Type'] == 'library']['Duration_Min'].sum() if not teacher_date_data.empty else 0.0

            s1, s2 = st.columns(2)
            s1.metric("Lesson Prep Minutes", f"{t_day_ld:.1f} mins")
            s2.metric("Library Usage Minutes", f"{t_day_lib:.1f} mins")
            st.dataframe(teacher_all_data[['StartTime', 'Type', 'Grade', 'Subject', 'Book', 'Duration_Min']].sort_values(by='StartTime', ascending=False), use_container_width=True)

    # TAB 5: MANAGER PORTFOLIO QUADRANTS
    with tab5:
        st.header("🏛️ Academic Manager Portfolio Overview")
        school_stats = filtered_df.groupby(['Institution', 'Type'])['Duration_Min'].sum().unstack(fill_value=0.0).reset_index()
        if 'lessonDelivery' not in school_stats.columns: school_stats['lessonDelivery'] = 0.0
        if 'library' not in school_stats.columns: school_stats['library'] = 0.0
        st.dataframe(school_stats.rename(columns={'lessonDelivery': 'Total Lesson Prep (m)', 'library': 'Total Library Usage (m)'}), use_container_width=True)

    # TAB 6: SCHOOL TEACHER PROGRESSION
    with tab6:
        st.header("🏫 School-Level Teacher Progression & Execution Tiers")
        t6_ld = filtered_df[filtered_df['Type'] == 'lessonDelivery'].groupby('FullName')['Duration_Min'].sum().reset_index(name='Lesson_Mins')
        t6_lib = filtered_df[filtered_df['Type'] == 'library'].groupby('FullName')['Duration_Min'].sum().reset_index(name='Library_Mins')
        t6_comb = filtered_roster.merge(t6_ld, on='FullName', how='left').merge(t6_lib, on='FullName', how='left').fillna(0.0)
        st.dataframe(t6_comb, use_container_width=True)

    # TAB 7: LIVE EVIDENCE SUBMISSIONS FEED
    with tab7:
        st.header("📬 Live Evidence Submissions Feed")
        evidence_cols = ['Voice_Note_Link', 'Lesson_Plan_Picture', 'Video_Evidence_1', 'Video_Evidence_2', 'Video_Evidence_3', 'Writing_Sample_Link', 'Phonics_Evidence_Link', 'Portfolio_Evidence_Link']
        avail_ev_cols = [c for c in evidence_cols if c in filtered_df.columns]
        if avail_ev_cols:
            url_mask = pd.concat([filtered_df[c].fillna('').astype(str).str.startswith(('http://', 'https://')) for c in avail_ev_cols], axis=1).any(axis=1)
            all_submissions_df = filtered_df[url_mask]
            st.dataframe(all_submissions_df[['StartTime', 'Institution', 'FullName', 'Grade', 'Subject', 'Book'] + avail_ev_cols].sort_values(by='StartTime', ascending=False), use_container_width=True)

    # TAB 8: CLASSROOM VISIT OBSERVATION FORM (NEW COMPREHENSIVE GENERATOR)
    with tab8:
        st.header("📋 Physical School Visit: Classroom Observation Form & Audit Generator")
        st.caption("Fill in physical visit observations, select parameter rubrics, punch narrative details, and generate the formal audit PDF without writing into Excel.")

        with st.form("classroom_visit_full_form"):
            st.subheader("1. General Information & Metadata")
            col_m1, col_m2, col_m3 = st.columns(3)
            
            with col_m1:
                input_school = st.selectbox("Name of the School / Institution:", options=all_schools, key="obs_school_sel")
                input_teacher = st.selectbox("Name of the Teacher:", options=available_teachers, key="obs_teacher_sel")
                input_custom_teacher = st.text_input("Or Type Custom Teacher Name (if not in list):", key="obs_custom_teacher")
                input_mentor = st.text_input("Name of the Academic Mentor:", value=employee_name, key="obs_mentor_name")

            with col_m2:
                input_class_sec = st.text_input("Class and Section:", placeholder="e.g. 3rd", value="3rd", key="obs_class_sec")
                input_subject = st.text_input("Subject:", placeholder="e.g. Science", value="Science", key="obs_subject")
                input_topic = st.text_input("Topic:", placeholder="e.g. States of Matter", value="States of Matter", key="obs_topic")

            with col_m3:
                input_date = st.date_input("Observation Date:", value=pd.Timestamp.now().date(), key="obs_date_pick")
                input_duration = st.text_input("Total Time Duration of Observation:", value="40 Min", key="obs_dur")
                input_students = st.number_input("Total number of students present:", min_value=1, max_value=120, value=26, key="obs_num_students")
                input_print_disp = st.selectbox("Print displayed in class:", ["Yes", "No"], index=0, key="obs_print_disp")

            st.markdown("---")
            st.subheader("2. Parameter-Wise Evaluation Rubric (A / B / C / NA)")
            st.caption("Select the grade that matches the teacher's execution and type specific remarks/action items for each parameter.")

            final_rubric_responses = {}

            for cat_name, desc_dict in OBSERVATION_RUBRIC_CONFIG.items():
                st.markdown(f"##### 📌 {cat_name}")
                col_r1, col_r2 = st.columns([3, 1.5])
                
                with col_r1:
                    selected_grade = st.radio(
                        f"Select Rubric Grade for '{cat_name}':",
                        options=["A", "B", "C", "NA"],
                        format_func=lambda opt, d=desc_dict: f"**{opt}**: {d.get(opt, 'Not Applicable')}" if opt in d else "NA: Not Applicable / Not Observed",
                        horizontal=False,
                        key=f"rubric_opt_{cat_name}"
                    )

                with col_r2:
                    param_remark = st.text_input(
                        f"Remarks for {cat_name}:",
                        placeholder="Enter observation remark...",
                        key=f"rubric_rem_{cat_name}"
                    )
                
                final_rubric_responses[cat_name] = {
                    "Grade": selected_grade,
                    "Remarks": param_remark.strip()
                }
                st.markdown("<hr style='margin: 8px 0; border-top: 1px dashed #e2e8f0;'>", unsafe_allow_html=True)

            st.markdown("---")
            st.subheader("3. Classroom Flow, High Points & Mentor Recommendations")

            flow_default = (
                "1. Utilized the digital book to explain the concepts with the support of visuals.\n"
                "2. Began with an explanation of solids with visual examples from digital content.\n"
                "3. While teaching liquids, invited students to provide examples from their surroundings.\n"
                "4. Used a bilingual approach during explanation of gases to support conceptual clarity.\n"
                "5. Conducted Cold Calling CFU questions throughout the lesson.\n"
                "6. Concluded the class with a recap activity and lesson summary."
            )

            high_points_default = (
                "1. Effective use of the Digital Book and visuals to explain the concepts.\n"
                "2. Students participated and related the topic to their daily life by sharing relevant examples.\n"
                "3. Regular use of CFU questions and cold calling.\n"
                "4. The teacher used a bilingual approach to support conceptual clarity.\n"
                "5. The lesson ended with an effective recap and summarization."
            )

            recom_default = (
                "1. Start the lesson with open-ended, curiosity-driven questions before introducing the concept to activate prior knowledge.\n"
                "2. Follow the complete Lesson Plan flow consistently: Warm-up → Curiosity Questions → Concept Explanation → Reflection.\n"
                "3. Use simple Teaching-Learning Materials (TLMs) like stones, water bottles, or balloons for experiential understanding.\n"
                "4. Increase opportunities for students to predict, observe, and reason before providing explanations."
            )

            input_flow = st.text_area("Flow of the Class (Step-by-step chronology):", value=flow_default, height=130, key="obs_narr_flow")
            input_high_points = st.text_area("High Points of the Class:", value=high_points_default, height=110, key="obs_narr_high")
            input_recom = st.text_area("Recommendations by the Academic Mentor:", value=recom_default, height=110, key="obs_narr_recom")

            submit_obs_form = st.form_submit_button("🚀 Compile & Generate Classroom Observation Report (PDF)")

        if submit_obs_form:
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

            with st.spinner("Compiling Classroom Observation PDF via ReportLab..."):
                obs_pdf_buffer = generate_classroom_observation_visit_pdf(
                    metadata=obs_meta_payload,
                    rubric_scores=final_rubric_responses,
                    narratives=obs_narrative_payload
                )
                
                uploaded_obs_url = upload_pdf_to_supabase(
                    pdf_buffer=obs_pdf_buffer,
                    school_name=f"{input_school}_{active_eval_teacher}",
                    subfolder="observations",
                    file_suffix=f"_{input_date}_Observation_Audit"
                )
                
                st.session_state["latest_obs_pdf_bytes"] = obs_pdf_buffer.getvalue()
                st.session_state["latest_obs_pdf_url"] = uploaded_obs_url
                st.session_state["latest_obs_teacher"] = active_eval_teacher
                st.session_state["latest_obs_school"] = input_school
                st.session_state["latest_obs_date"] = str(input_date)
                
                st.success(f"🎉 Observation Audit PDF compiled and synced for **{active_eval_teacher}** at **{input_school}**!")

        if "latest_obs_pdf_bytes" in st.session_state:
            st.markdown("---")
            st.subheader("📥 Export & Share Classroom Observation Audit")
            
            col_d1, col_d2 = st.columns(2)
            with col_d1:
                st.download_button(
                    label=f"📄 Download Observation Audit (PDF) for {st.session_state['latest_obs_teacher']}",
                    data=st.session_state["latest_obs_pdf_bytes"],
                    file_name=f"{st.session_state['latest_obs_school']}_{st.session_state['latest_obs_teacher']}_{st.session_state['latest_obs_date']}_Observation.pdf".replace(' ', '_'),
                    mime="application/pdf",
                    key="dl_obs_pdf_btn"
                )

            with col_d2:
                live_url = st.session_state.get("latest_obs_pdf_url")
                if live_url:
                    wa_msg = (
                        f"Respected Sir/Madam,\n\n"
                        f"Greetings from OneLearn Academic Team! Here is the completed Classroom Observation & Teacher Mentorship Audit for *{st.session_state['latest_obs_teacher']}* at *{st.session_state['latest_obs_school']}* conducted on {st.session_state['latest_obs_date']}.\n\n"
                        f"📄 *Download Observation Report (PDF):*\n{live_url}\n\n"
                        f"Regards,\n"
                        f"{employee_name},\n"
                        f"OneLearn Academic Team"
                    )
                    encoded_wa = urllib.parse.quote(wa_msg)
                    st.markdown(f'<a href="https://wa.me/?text={encoded_wa}" target="_blank" style="text-decoration:none;"><button style="background-color:#25D366;color:white;padding:9px 16px;border:none;border-radius:4px;cursor:pointer;font-weight:bold;width:100%;">📱 Share Report on WhatsApp</button></a>', unsafe_allow_html=True)
