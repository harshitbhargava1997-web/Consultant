import streamlit as st
import pandas as pd
import numpy as np
import plotly.express as px
import plotly.graph_objects as go
import os
import re
import json
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


def _norm_text(value):
    if pd.isna(value):
        return ""
    return re.sub(r"\s+", " ", str(value)).strip()


def _norm_key(value):
    return _norm_text(value).casefold()


def _categorize_record_type(val, book_val=""):
    """Robustly categorizes a record into 'lessonDelivery', 'library', or 'other'."""
    v = _norm_key(val)
    b = _norm_key(book_val)
    
    if any(k in v for k in ['lessondelivery', 'lesson delivery', 'lesson_delivery', 'lessonplan', 'lesson plan', 'prep', 'delivery', 'teaching']):
        return 'lessonDelivery'
    if any(k in v for k in ['library', 'digital', 'resource', 'content', 'ebook', 'reading', 'book']):
        return 'library'
    if b.startswith('lesson plan') or b.startswith('lp'):
        return 'lessonDelivery'
    return 'other'


def normalize_identity_columns(df):
    if df is None or df.empty:
        return pd.DataFrame()
    out = df.copy()

    for col in ["Institution", "Center", "FirstName", "LastName", "FullName", "Role", "Uploaded_By", "State_Zone", "Type", "Grade", "Subject", "Book"]:
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

    out["Standard_Type"] = out.apply(lambda r: _categorize_record_type(r.get("Type", ""), r.get("Book", "")), axis=1)

    if "Duration_Min" in out.columns:
        out["Duration_Min"] = pd.to_numeric(out["Duration_Min"], errors='coerce').fillna(0.0)
    else:
        out["Duration_Min"] = 0.0

    if 'StartTime' in out.columns and 'EndTime' in out.columns:
        st_dt = pd.to_datetime(out['StartTime'], errors='coerce')
        et_dt = pd.to_datetime(out['EndTime'], errors='coerce')
        diff_mins = (et_dt - st_dt).dt.total_seconds() / 60.0
        out.loc[out["Duration_Min"].le(0.0) & diff_mins.notna() & diff_mins.gt(0), "Duration_Min"] = diff_mins

    return out


@st.cache_data(ttl=300, show_spinner=False)
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
        df_raw = conn.query(query)
        if df_raw.empty:
            return pd.DataFrame()
            
        for dt_col in ['StartTime', 'EndTime']:
            if dt_col in df_raw.columns:
                df_raw[dt_col] = pd.to_datetime(df_raw[dt_col], errors='coerce')
                
        return normalize_identity_columns(df_raw)
    except Exception as e:
        st.error(f"Error fetching from PostgreSQL: {e}")
        return pd.DataFrame()


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


def upload_pdf_to_supabase(pdf_buffer, school_name):
    try:
        clean_name = re.sub(r'[^a-zA-Z0-9_-]', '_', school_name)
        remote_path = f"reports/{clean_name}_Comprehensive_Audit.pdf"
        
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


def extract_evidence_items_vectorized(df_src, col_name):
    if col_name not in df_src.columns or df_src.empty:
        return []
    
    col_str = df_src[col_name].fillna('').astype(str).str.strip()
    valid_mask = col_str.str.contains(r'https?://|drive\.google|supabase\.co', case=False, na=False)
    valid_rows = df_src[valid_mask]
    
    if valid_rows.empty:
        return []
        
    items = []
    for _, r in valid_rows.iterrows():
        val = str(r[col_name]).strip()
        d_str = str(r['Date']) if 'Date' in r and pd.notna(r['Date']) else "Recent"
        g_str = f"Grade {r['Grade']}" if 'Grade' in r and str(r['Grade']).strip() else "Grade N/A"
        s_str = str(r['Subject']).strip() if 'Subject' in r and str(r['Subject']).strip() else "General Subject"
        b_str = str(r['Book']).strip() if 'Book' in r and str(r['Book']).strip() else "Lesson Plan"
        items.append({'url': val, 'date': d_str, 'grade': g_str, 'subject': s_str, 'lesson': b_str})
        
    seen = set()
    deduped = []
    for item in items:
        if item['url'] not in seen:
            seen.add(item['url'])
            deduped.append(item)
    return deduped


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

    # Respect full date-filtered data for this school
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

    ld_df = school_curr_df[school_curr_df['Standard_Type'] == 'lessonDelivery']
    ld_usage = ld_df.groupby('FullName')['Duration_Min'].sum().to_dict()
    
    lib_df = school_curr_df[school_curr_df['Standard_Type'] == 'library']
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

    # 1. Lesson Plan Preparation Consolidated Report
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

    # 2. Library Usage Consolidated Report
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

    # 3. Qualitative Submissions & Evidence Compliance
    if enable_qual_kpi:
        story.append(Paragraph("<b>3. Qualitative Submissions & Evidence Compliance</b>", sec_head_style))
        qual_summary_table_data = [["Teacher Name", "LP / Audio Notes", "Activity Videos", "Writing Samples", "Phonics Evidences", "Portfolio Artifacts", "Status"]]
        
        for t_name in teachers_list:
            sub_t = school_curr_df[school_curr_df['FullName'] == t_name]
            v_cnt = sum([len(extract_evidence_items_vectorized(sub_t, col)) for col in ['Video_Evidence_1', 'Video_Evidence_2', 'Video_Evidence_3']])
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

    # PART 2: INDIVIDUAL TEACHER 360° PROFILES
    for target_teacher in teachers_list:
        story.append(PageBreak())

        teacher_date_data = school_curr_df[school_curr_df['FullName'] == target_teacher]
        teacher_all_data = school_filtered_df[(school_filtered_df['FullName'] == target_teacher) & (school_filtered_df['Institution'] == school_name)]

        t_day_ld = teacher_date_data[teacher_date_data['Standard_Type'] == 'lessonDelivery']['Duration_Min'].sum() if not teacher_date_data.empty else 0.0
        t_day_lib = teacher_date_data[teacher_date_data['Standard_Type'] == 'library']['Duration_Min'].sum() if not teacher_date_data.empty else 0.0
        
        ld_pct = (t_day_ld / calc_ld_kpi) * 100 if calc_ld_kpi > 0 else (100.0 if t_day_ld >= 0 else 0)
        lib_pct = (t_day_lib / calc_lib_kpi) * 100 if calc_lib_kpi > 0 else (100.0 if t_day_lib >= 0 else 0)

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

        v_vid = []
        for col in ['Video_Evidence_1', 'Video_Evidence_2', 'Video_Evidence_3']:
            v_vid.extend(extract_evidence_items_vectorized(evidence_source, col))
        seen_v = set()
        deduped_v = []
        for item in v_vid:
            if item['url'] not in seen_v:
                seen_v.add(item['url'])
                deduped_v.append(item)
            v_vid = deduped_v

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
            manager_voice_audio = st.audio_input(
                "🎙️ Record Voice Instructions (Speak your custom prompt):",
                key=f"voice_input_{tab_name}_{target_crm_school}"
            )
            user_custom_instruction = st.text_area(
                "Or Type Custom Instructions (Alternative to voice):",
                placeholder="e.g., Focus heavily on improving library engagement and phonics submissions...",
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

    # --- CALL DISCUSSION NOTES & FOLLOW-UP SYNC TO SUPABASE ---
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
                if st.button("🗑️ Clear Call Logs for this School", key=f"clear_logs_btn_{tab_name}_{target_crm_school}"):
                    st.session_state["crm_call_logs_store"] = [l for l in st.session_state["crm_call_logs_store"] if l.get("School") != target_crm_school]
                    save_call_logs_to_supabase(st.session_state["crm_call_logs_store"])
                    st.success(f"Successfully cleared call logs for {target_crm_school}!")
                    st.rerun()
        else:
            st.info(f"No call discussion logs recorded yet for {target_crm_school}.")


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
            user_custom_instruction = st.text_area("Or Type Custom Instructions:", placeholder="e.g., Focus heavily on improving library engagement...", key=f"ai_custom_prompt_{tab_name}_{target_crm_school}")
            
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
            st.markdown(f'<a href="https://wa.me/{clean_phone}?text={encoded_final_text}" target="_blank" style="text-decoration:none;"><button style="background-color:#25D366;color:white;padding:10px 18px;border:none;border-radius:4px;cursor:pointer;font-weight:bold;width:100%;">🚀 Send Final WhatsApp Message</button></a>', unsafe_allow_html=True)

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
                if st.button("🗑️ Clear Call Logs for this School", key=f"clear_logs_btn_{tab_name}_{target_crm_school}"):
                    st.session_state["crm_call_logs_store"] = [l for l in st.session_state["crm_call_logs_store"] if l.get("School") != target_crm_school]
                    save_call_logs_to_supabase(st.session_state["crm_call_logs_store"])
                    st.success(f"Successfully cleared call logs for {target_crm_school}!")
                    st.rerun()
        else:
            st.info(f"No call discussion logs recorded yet for {target_crm_school}.")


# --- DATA SCOPE & MAIN APP SETUP ---
# 1. Multi-Employee Hierarchy & Ingestion Portal
st.sidebar.header("📁 Multi-Employee Data Ingestion Portal")

employee_name = st.sidebar.text_input("Enter Consultant Name:", value="Harshit Bhargava")[cite: 1]
employee_state = st.sidebar.selectbox("Select State / Zone (India Region):", [
    "Madhya Pradesh (MP)", "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat", 
    "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", 
    "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab", 
    "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", 
    "Uttarakhand", "West Bengal", "Delhi NCR", "Jammu and Kashmir", "Ladakh"
])[cite: 1]

uploaded_files = st.sidebar.file_uploader("Upload UserMetrics Excel (.xlsx)", type=["xlsx"], accept_multiple_files=True)[cite: 1]

if uploaded_files:
    if "last_ingested_files" not in st.session_state:
        st.session_state["last_ingested_files"] = [][cite: 1]

    files_to_process = [f for f in uploaded_files if f"{f.name}_{f.size}" not in st.session_state["last_ingested_files"]][cite: 1]

    if files_to_process:
        new_processed_dfs = [][cite: 1]
        for file in files_to_process:
            try:
                temp_dict = pd.read_excel(file, sheet_name=None)[cite: 1]
                target_sheet = next((s for s in temp_dict.keys() if "usermetric" in s.lower()), list(temp_dict.keys())[0])[cite: 1]
                temp_df = temp_dict[target_sheet][cite: 1]
                
                if 'Institution' not in temp_df.columns:
                    temp_df['Institution'] = "Default School"[cite: 1]

                temp_df = normalize_identity_columns(temp_df)
                
                temp_df['Uploaded_By'] = employee_name[cite: 1]
                temp_df['State_Zone'] = employee_state[cite: 1]

                if temp_df['Institution'].eq('').all():
                    temp_df['Institution'] = "Default School"[cite: 1]
                else:
                    temp_df['Institution'] = temp_df['Institution'].replace('', 'Unknown School')[cite: 1]

                for col in ['Grade', 'Subject', 'Book']:
                    if col not in temp_df.columns:
                        temp_df[col] = ''[cite: 1]
                    else:
                        temp_df[col] = temp_df[col].fillna('').astype(str).str.replace(r'\s+', ' ', regex=True).str.strip()[cite: 1]

                def parse_time_mins(t_str):
                    try:
                        parts = str(t_str).split(':')
                        return int(parts[0])*60 + int(parts[1]) + float(parts[2])/60.0
                    except:
                        return 0.0

                if 'Duration (HH:MM:SS)' in temp_df.columns:
                    temp_df['Duration_Min'] = temp_df['Duration (HH:MM:SS)'].apply(parse_time_mins)[cite: 1]
                elif 'Duration (Minutes)' in temp_df.columns:
                    temp_df['Duration_Min'] = pd.to_numeric(temp_df['Duration (Minutes)'], errors='coerce').fillna(0.0)[cite: 1]
                else:
                    temp_df['Duration_Min'] = 0.0[cite: 1]

                if 'Type' in temp_df.columns:
                    temp_df['Type'] = temp_df['Type'].fillna('Other').astype(str)[cite: 1]

                for dt_col in ['StartTime', 'EndTime']:
                    if dt_col in temp_df.columns:
                        temp_df[dt_col] = pd.to_datetime(temp_df[dt_col], errors='coerce')[cite: 1]

                for qual_col in ['Voice_Note_Link', 'Lesson_Plan_Picture', 'Video_Evidence_1', 'Video_Evidence_2', 'Video_Evidence_3', 'Writing_Sample_Link', 'Phonics_Evidence_Link', 'Portfolio_Evidence_Link', 'Assessment_Score_Pct']:
                    if qual_col not in temp_df.columns:
                        temp_df[qual_col] = None[cite: 1]

                new_processed_dfs.append(temp_df)[cite: 1]
            except Exception as e:
                st.sidebar.error(f"Error reading {file.name}: {e}")[cite: 1]

        if new_processed_dfs:
            ingest_excel_to_postgresql(new_processed_dfs)[cite: 1]
            for f in files_to_process:
                st.session_state["last_ingested_files"].append(f"{f.name}_{f.size}")[cite: 1]
            st.sidebar.success(f"Synced {len(files_to_process)} file(s) directly into PostgreSQL Database!")[cite: 1]
            st.rerun()[cite: 1]

df = fetch_master_db_from_supabase()[cite: 1]

# --- 2. Granular Database Operations & One-Time Migration Tool ---
st.sidebar.markdown("---")[cite: 1]
st.sidebar.header("🗄️ Granular Database Management")[cite: 1]

if st.sidebar.button("🔄 Sync Latest Records"):
    fetch_master_db_from_supabase.clear()[cite: 1]
    st.rerun()[cite: 1]

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
                ingest_excel_to_postgresql([combined_legacy])
                st.sidebar.success(f"🎉 Successfully imported {len(combined_legacy)} historical records into PostgreSQL!")
                fetch_master_db_from_supabase.clear()
                st.rerun()
            else:
                st.sidebar.error("No historical parquet or JSON files found in Supabase storage.")

if not df.empty:
    st.sidebar.metric("Database Total Records", len(df))[cite: 1]
    
    with st.sidebar.expander("🛠️ Selective Database Cleanup"):[cite: 1]
        clean_mode = st.radio("Select Cleanup Scope:", ["By Consultant Name & State/Zone", "By School", "Clear Entire DB"])[cite: 1]
        
        if clean_mode == "By Consultant Name & State/Zone":
            del_emp_name = st.text_input("Enter Exact Consultant Name to Delete:", value="")[cite: 1]
            del_state_zone = st.selectbox("Select State/Zone for Cleanup:", [[cite: 1]
                "Madhya Pradesh (MP)", "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat", 
                "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", 
                "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab", 
                "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", 
                "Uttarakhand", "West Bengal", "Delhi NCR", "Jammu and Kashmir", "Ladakh"
            ], key="del_state_select")[cite: 1]
            
            if st.button("🗑️ Delete Consultant Records from SQL DB"):[cite: 1]
                try:
                    if not del_emp_name.strip():[cite: 1]
                        st.error("Please enter the consultant name.")[cite: 1]
                    else:
                        with conn.session as s:[cite: 1]
                            s.execute(
                                text('DELETE FROM teacher_records WHERE LOWER("Uploaded_By") = LOWER(:name) AND "State_Zone" = :state'),[cite: 1]
                                {"name": del_emp_name.strip(), "state": del_state_zone}[cite: 1]
                            )
                            s.commit()[cite: 1]
                        fetch_master_db_from_supabase.clear()[cite: 1]
                        st.success(f"Successfully deleted records for {del_emp_name} in {del_state_zone}!")[cite: 1]
                        st.rerun()[cite: 1]
                except Exception as e:
                    st.error(f"Error deleting consultant data: {e}")[cite: 1]
                    
        elif clean_mode == "By School":
            schools_in_db = sorted(df['Institution'].dropna().unique().tolist()) if 'Institution' in df.columns else [][cite: 1]
            target_del_school = st.selectbox("Select School to Delete:", options=schools_in_db)[cite: 1]
            if st.button("🗑️ Delete School Data from SQL DB"):[cite: 1]
                try:
                    with conn.session as s:[cite: 1]
                        s.execute(text('DELETE FROM teacher_records WHERE "Institution" = :school'), {"school": target_del_school})[cite: 1]
                        s.commit()[cite: 1]
                    fetch_master_db_from_supabase.clear()[cite: 1]
                    st.success(f"Successfully removed data for {target_del_school} from database!")[cite: 1]
                    st.rerun()[cite: 1]
                except Exception as e:
                    st.error(f"Error deleting school data: {e}")[cite: 1]
                    
        else:
            if st.button("🚨 Clear Entire Database Table"):[cite: 1]
                try:
                    with conn.session as s:[cite: 1]
                        s.execute(text("TRUNCATE TABLE teacher_records;"))[cite: 1]
                        s.commit()[cite: 1]
                    fetch_master_db_from_supabase.clear()[cite: 1]
                    st.sidebar.error("Database table cleared!")[cite: 1]
                    st.rerun()[cite: 1]
                except Exception as e:
                    st.sidebar.error(f"Could not truncate table: {e}")[cite: 1]

if df.empty:
    st.info("👋 Upload your daily or weekly `UserMetrics.xlsx` files in the sidebar, or run the One-Time Import in the sidebar to populate your PostgreSQL database.")[cite: 1]
else:
    if 'StartTime' in df.columns and not df['StartTime'].isna().all():[cite: 1]
        df['Date'] = df['StartTime'].dt.date[cite: 1]
        df['Month_Name'] = df['StartTime'].dt.strftime('%B %Y')[cite: 1]
        df['Month_Sort'] = df['StartTime'].dt.strftime('%Y-%m')[cite: 1]
        
        def get_week_of_month(dt):
            try:
                first_day = dt.replace(day=1)
                dom = dt.day
                adjusted_dom = dom + first_day.weekday()
                return int(np.ceil(adjusted_dom / 7.0))
            except:
                return 1

        df['Week_Num'] = df['StartTime'].apply(get_week_of_month)[cite: 1]
        
        week_ranges = df.groupby(['Month_Name', 'Week_Num'])['Date'].agg(['min', 'max']).reset_index()[cite: 1]
        week_ranges['Week_Date_Range'] = ([cite: 1]
            week_ranges['min'].apply(lambda x: x.strftime('%b %d') if pd.notna(x) else '') + " to " + [cite: 1]
            week_ranges['max'].apply(lambda x: x.strftime('%b %d') if pd.notna(x) else '')[cite: 1]
        )
        
        df = df.merge(week_ranges[['Month_Name', 'Week_Num', 'Week_Date_Range']], on=['Month_Name', 'Week_Num'], how='left')[cite: 1]
        df['Month_Week_Label'] = df['StartTime'].dt.strftime('%b %Y') + " - Week " + df['Week_Num'].astype(str) + " (" + df['Week_Date_Range'] + ")"[cite: 1]
        df['Week'] = df['Month_Week_Label'][cite: 1]
    else:
        df['Date'] = None[cite: 1]
        df['Month_Name'] = "N/A"[cite: 1]
        df['Week'] = "N/A"[cite: 1]

    master_teacher_roster = build_teacher_roster_cached(df)[cite: 1]
    if master_teacher_roster.empty:[cite: 1]
        master_teacher_roster = pd.DataFrame(columns=['Institution', 'FullName', 'Uploaded_By', 'State_Zone'])[cite: 1]
    else:
        master_teacher_roster = master_teacher_roster[['Institution', 'FullName', 'Uploaded_By', 'State_Zone']].drop_duplicates()[cite: 1]

    # --- 3. Hierarchical Global Scope Filters ---
    st.sidebar.markdown("---")[cite: 1]
    st.sidebar.header("🔍 Hierarchical Global Filters")[cite: 1]
    
    all_states = sorted([str(s) for s in df['State_Zone'].unique() if str(s).strip() and str(s).lower() not in ['nan', 'none']])[cite: 1]
    default_states = ["Madhya Pradesh (MP)"] if "Madhya Pradesh (MP)" in all_states else all_states[cite: 1]
    
    if all_states:[cite: 1]
        selected_states = st.sidebar.multiselect("1. Select State(s) / Zone(s)", options=all_states, default=default_states)[cite: 1]
        df_state = df[df['State_Zone'].isin(selected_states)][cite: 1]
    else:
        df_state = df[cite: 1]

    all_employees = sorted([str(e) for e in df_state['Uploaded_By'].unique() if str(e).strip() and str(e).lower() not in ['nan', 'none']])[cite: 1]
    if all_employees:[cite: 1]
        selected_employees = st.sidebar.multiselect("2. Select Consultant(s)", options=all_employees, default=all_employees)[cite: 1]
        df_emp = df_state[df_state['Uploaded_By'].isin(selected_employees)][cite: 1]
    else:
        df_emp = df_state[cite: 1]

    all_schools = sorted([str(s) for s in df_emp['Institution'].unique() if str(s).strip() and str(s).lower() not in ['nan', 'none']])[cite: 1]
    selected_schools = st.sidebar.multiselect("3. Select School(s)", options=all_schools, default=all_schools)[cite: 1]

    school_master_roster = master_teacher_roster[master_teacher_roster['Institution'].isin(selected_schools)][cite: 1]
    school_filtered_df = df_emp[df_emp['Institution'].isin(selected_schools)][cite: 1]

    # --- Calendar & Holiday Manager ---
    st.sidebar.markdown("---")[cite: 1]
    st.sidebar.header("📅 Calendar & Holiday Manager")[cite: 1]
    
    available_months_df = school_filtered_df[['Month_Sort', 'Month_Name']].dropna().drop_duplicates().sort_values(by='Month_Sort', ascending=False)[cite: 1]
    month_options = available_months_df['Month_Name'].tolist()[cite: 1]
    
    selected_month = st.sidebar.selectbox("Select Review Month:", options=month_options if month_options else ["No Month Data"])[cite: 1]
    month_filtered_df = school_filtered_df[school_filtered_df['Month_Name'] == selected_month][cite: 1]
    
    exclude_sundays_flag = st.sidebar.checkbox("🗓️ Exclude Sundays from Performance Indicators", value=True)[cite: 1]

    user_excluded_dates = [][cite: 1]
    if not month_filtered_df['Date'].isna().all() and not month_filtered_df.empty:[cite: 1]
        m_min_date = month_filtered_df['Date'].min()[cite: 1]
        m_max_date = month_filtered_df['Date'].max()[cite: 1]
        all_month_possible_dates = [d.date() for d in pd.date_range(start=m_min_date, end=m_max_date)][cite: 1]
        
        user_excluded_dates = st.sidebar.multiselect([cite: 1]
            f"🗓️ Punch Holidays for {selected_month}:",[cite: 1]
            options=all_month_possible_dates,[cite: 1]
            format_func=lambda x: x.strftime('%Y-%m-%d')[cite: 1]
        )

    # --- Granularity Selector ---
    st.sidebar.subheader("🔍 Review View Level")[cite: 1]
    available_month_weeks = sorted(month_filtered_df['Month_Week_Label'].dropna().unique())[cite: 1]
    available_dates = sorted(month_filtered_df['Date'].dropna().unique(), reverse=True)[cite: 1]
    
    view_mode = st.sidebar.radio("Granularity:", ["Full Month Summary", "Specific Week of Month", "Single Day Review", "Custom Date Range"])[cite: 1]
    
    if month_filtered_df.empty and view_mode != "Custom Date Range":[cite: 1]
        filtered_df = month_filtered_df[cite: 1]
        selected_num_days = 1[cite: 1]
        filter_description_text = f"Full Month: {selected_month} - 0 Records"[cite: 1]
    elif view_mode == "Full Month Summary":[cite: 1]
        filtered_df = month_filtered_df[cite: 1]
        selected_num_days = get_working_days(month_filtered_df['Date'].min(), month_filtered_df['Date'].max(), user_excluded_dates, exclude_sundays=exclude_sundays_flag)[cite: 1]
        filter_description_text = f"Full Month: {selected_month} - {selected_num_days} Working Days"[cite: 1]
    elif view_mode == "Specific Week of Month":[cite: 1]
        selected_week_label = st.sidebar.selectbox("Select Week:", options=available_month_weeks)[cite: 1]
        filtered_df = month_filtered_df[month_filtered_df['Month_Week_Label'] == selected_week_label][cite: 1]
        w_start = filtered_df['Date'].min() if not filtered_df.empty else selected_month[cite: 1]
        w_end = filtered_df['Date'].max() if not filtered_df.empty else selected_month[cite: 1]
        selected_num_days = get_working_days(w_start, w_end, user_excluded_dates, exclude_sundays=exclude_sundays_flag)[cite: 1]
        filter_description_text = f"{selected_week_label} - {selected_num_days} Working Days"[cite: 1]
    elif view_mode == "Single Day Review":[cite: 1]
        selected_date = st.sidebar.selectbox("Select Day:", options=available_dates)[cite: 1]
        filtered_df = month_filtered_df[month_filtered_df['Date'] == selected_date][cite: 1]
        selected_num_days = get_working_days(selected_date, selected_date, user_excluded_dates, exclude_sundays=exclude_sundays_flag)[cite: 1]
        filter_description_text = f"Single Date: {selected_date} - {selected_num_days} Working Days"[cite: 1]
    else:
        min_avail = school_filtered_df['Date'].dropna().min() if not school_filtered_df['Date'].dropna().empty else pd.Timestamp.now().date()[cite: 1]
        max_avail = school_filtered_df['Date'].dropna().max() if not school_filtered_df['Date'].dropna().empty else pd.Timestamp.now().date()[cite: 1]
        
        custom_date_range = st.sidebar.date_input("Select Custom Date Range:", value=(min_avail, max_avail), min_value=min_avail, max_value=max_avail)[cite: 1]
        if isinstance(custom_date_range, (tuple, list)) and len(custom_date_range) == 2:[cite: 1]
            c_start, c_end = custom_date_range[cite: 1]
        elif isinstance(custom_date_range, (tuple, list)) and len(custom_date_range) == 1:[cite: 1]
            c_start = c_end = custom_date_range[0][cite: 1]
        else:
            c_start = c_end = custom_date_range[cite: 1]
            
        filtered_df = school_filtered_df[(school_filtered_df['Date'] >= c_start) & (school_filtered_df['Date'] <= c_end)][cite: 1]
        selected_num_days = get_working_days(c_start, c_end, user_excluded_dates, exclude_sundays=exclude_sundays_flag)[cite: 1]
        filter_description_text = f"Custom Range: {c_start} to {c_end} - {selected_num_days} Working Days"[cite: 1]

    available_teachers = sorted([str(t) for t in school_master_roster['FullName'].unique() if str(t).strip()])[cite: 1]
    selected_teachers = st.sidebar.multiselect("4. Select Teacher(s)", options=available_teachers, default=available_teachers)[cite: 1]
    
    filtered_roster = school_master_roster[school_master_roster['FullName'].isin(selected_teachers)][cite: 1]
    filtered_df = filtered_df[filtered_df['FullName'].isin(selected_teachers)][cite: 1]

    # --- SIDEBAR DIRECT EXCEL EXPORT (Only on click) ---
    st.sidebar.markdown("---")[cite: 1]
    st.sidebar.subheader("📥 Direct Admin Master Export")[cite: 1]
    if st.sidebar.button("📦 Prepare Master DB Export"):[cite: 1]
        buf_master_xlsx = BytesIO()[cite: 1]
        with pd.ExcelWriter(buf_master_xlsx, engine='openpyxl') as writer:[cite: 1]
            filtered_df.to_excel(writer, index=False, sheet_name="Filtered_Database_Logs")[cite: 1]
        st.session_state["master_db_export_ready"] = buf_master_xlsx.getvalue()[cite: 1]

    if "master_db_export_ready" in st.session_state:[cite: 1]
        st.sidebar.download_button([cite: 1]
            label="📥 Download Prepared Master DB (Excel)",[cite: 1]
            data=st.session_state["master_db_export_ready"],[cite: 1]
            file_name=f"Master_Database_Export_{pd.Timestamp.now().strftime('%Y%m%d_%H%M%S')}.xlsx",[cite: 1]
            mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"[cite: 1]
        )

    # --- 7 DEDICATED TABS ---
    tab1, tab2, tab3, tab4, tab5, tab6, tab7 = st.tabs([[cite: 1]
        "📘 1. Lesson Plan Preparation Tracker", 
        "📚 2. Library Usage Tracker", 
        "📖 3. Content & Chapters", 
        "👤 4. Teacher 360° Profile Report",
        "🏛️ 5. Manager Portfolio Quadrants",
        "🏫 6. School Teacher Progression",
        "📬 7. Live Evidence Submissions Feed"
    ])

    # TAB 1: LESSON PLAN PREPARATION TRACKER
    with tab1:
        st.header("📘 Lesson Plan Preparation Tracker")[cite: 1]
        
        with st.expander("🎯 Lesson Prep Target Benchmark Settings", expanded=False):
            t1_kcol1, t1_kcol2 = st.columns(2)
            with t1_kcol1:
                enable_quant_kpi_t1 = st.checkbox("Enable Lesson Prep Quantitative Benchmark", value=True, key="t1_enable_quant_kpi")
            with t1_kcol2:
                daily_ld_target_t1 = st.number_input("Lesson Prep Target (Mins/Day)", min_value=0.0, max_value=60.0, value=10.0, step=5.0, key="t1_ld_target", disabled=not enable_quant_kpi_t1) if enable_quant_kpi_t1 else 0.0

        calc_ld_kpi_t1 = daily_ld_target_t1 * selected_num_days

        tab1_col_f1, tab1_col_f2 = st.columns(2)[cite: 1]
        with tab1_col_f1:[cite: 1]
            tab1_schools = ["All Selected Schools"] + sorted([s for s in filtered_df['Institution'].unique() if str(s).strip()])[cite: 1]
            tab1_selected_school = st.selectbox("Filter Tab by School:", tab1_schools, key="tab1_school_filter")[cite: 1]
        
        tab1_active_df = filtered_df if tab1_selected_school == "All Selected Schools" else filtered_df[filtered_df['Institution'] == tab1_selected_school][cite: 1]
        tab1_active_roster = filtered_roster if tab1_selected_school == "All Selected Schools" else filtered_roster[filtered_roster['Institution'] == tab1_selected_school][cite: 1]

        with tab1_col_f2:[cite: 1]
            tab1_teachers = ["All Teachers"] + sorted([t for t in tab1_active_roster['FullName'].unique() if str(t).strip()])[cite: 1]
            tab1_selected_teacher = st.selectbox("Filter Tab by Teacher:", tab1_teachers, key="tab1_teacher_filter")[cite: 1]
            
        if tab1_selected_teacher != "All Teachers":[cite: 1]
            tab1_active_df = tab1_active_df[tab1_active_df['FullName'] == tab1_selected_teacher][cite: 1]
            tab1_active_roster = tab1_active_roster[tab1_active_roster['FullName'] == tab1_selected_teacher][cite: 1]

        if enable_quant_kpi_t1 and calc_ld_kpi_t1 > 0:
            st.caption(f"Benchmark Standard: **At least {calc_ld_kpi_t1:.0f} Minutes** ({daily_ld_target_t1:.0f} mins/day across {selected_num_days} working day(s)).")
        else:
            st.caption(f"Reviewing cumulative minutes prepared across {selected_num_days} working day(s).")[cite: 1]

        ld_df = tab1_active_df[tab1_active_df['Standard_Type'] == 'lessonDelivery']
        ld_usage = ld_df.groupby(['Institution', 'FullName'])['Duration_Min'].sum().reset_index()
        ld_daily = tab1_active_roster.merge(ld_usage, on=['Institution', 'FullName'], how='left').fillna(0.0)
        
        def get_ld_status(x):
            if not enable_quant_kpi_t1 or calc_ld_kpi_t1 == 0: 
                return 'Activity Logged' if x > 0 else 'No Activity Logged'
            if x >= calc_ld_kpi_t1: 
                return f'✅ Met Performance Indicator (>= {calc_ld_kpi_t1:.0f}m)'
            elif x > 0.0: 
                return f'⚠️ Below Performance Indicator (< {calc_ld_kpi_t1:.0f}m)'
            else: 
                return '❌ Inactive (0 Mins)'
        
        ld_daily['Performance Indicator Status'] = ld_daily['Duration_Min'].apply(get_ld_status)[cite: 1]

        c1, c2, c3, c4 = st.columns(4)[cite: 1]
        total_teachers = len(ld_daily)[cite: 1]
        met_count = len(ld_daily[ld_daily['Duration_Min'] >= calc_ld_kpi_t1]) if (enable_quant_kpi_t1 and calc_ld_kpi_t1 > 0) else len(ld_daily[ld_daily['Duration_Min'] > 0])
        inactive_count = len(ld_daily[ld_daily['Duration_Min'] == 0.0])[cite: 1]
        
        c1.metric("Total Roster Teachers", total_teachers)[cite: 1]
        c2.metric(f"Met Standard ({calc_ld_kpi_t1:.0f}m)" if enable_quant_kpi_t1 else "Active Teachers", f"{met_count} / {total_teachers}")
        c3.metric("Inactive Teachers (0m)", inactive_count, delta=f"{-inactive_count}" if inactive_count > 0 else "0", delta_color="inverse")[cite: 1]
        c4.metric("Compliance Rate", f"{(met_count/total_teachers*100 if total_teachers>0 else 0):.1f}%")[cite: 1]

        with st.expander("✨ Gemini AI Intelligent Lesson Prep Analysis", expanded=False):[cite: 1]
            if st.button("Generate AI Lesson Prep Summary", key="ai_btn_tab1"):[cite: 1]
                with st.spinner("Analyzing lesson prep metrics with Gemini..."):[cite: 1]
                    summary_prompt = f"Analyze these lesson prep statistics: Total Teachers: {total_teachers}, Met Standard: {met_count}, Inactive: {inactive_count}. Provide 3 key actionable takeaways for the academic manager."[cite: 1]
                    ai_text = get_gemini_summary(summary_prompt)[cite: 1]
                    st.markdown(ai_text)[cite: 1]

        fig_ld = px.bar([cite: 1]
            ld_daily, x="FullName", y="Duration_Min", color="Performance Indicator Status",[cite: 1]
            title=f"Lesson Prep Minutes per Teacher" + (f" vs. {calc_ld_kpi_t1:.0f} Min Standard" if enable_quant_kpi_t1 else ""),
            labels={"FullName": "Teacher Name", "Duration_Min": "Minutes Prepared"},[cite: 1]
            text_auto=".1f"[cite: 1]
        )
        if enable_quant_kpi_t1 and calc_ld_kpi_t1 > 0:
            fig_ld.add_hline(y=calc_ld_kpi_t1, line_dash="dash", line_color="black", annotation_text=f"Guideline ({calc_ld_kpi_t1:.0f} mins)")
        st.plotly_chart(fig_ld, use_container_width=True)[cite: 1]

        st.subheader("📋 Lesson Plan Preparation Table")[cite: 1]
        display_ld_table = ld_daily.rename(columns={'Institution': 'School', 'FullName': 'Teacher Name', 'Duration_Min': 'Minutes Logged'}).round({'Minutes Logged': 1})[cite: 1]
        st.dataframe(display_ld_table, use_container_width=True)[cite: 1]

        col_t1_d1, col_t1_d2 = st.columns(2)[cite: 1]
        with col_t1_d1:[cite: 1]
            if st.button("⚙️ Compile Tab 1 PDF Report", key="prep_pdf_tab1_btn"):[cite: 1]
                with st.spinner("Compiling PDF report..."):[cite: 1]
                    pdf_bytes = generate_comprehensive_school_pdf_report(
                        school_name=selected_schools[0] if len(selected_schools) == 1 else "Multiple Schools Portfolio",[cite: 1]
                        teachers_list=filtered_roster['FullName'].unique().tolist(),[cite: 1]
                        school_filtered_df=school_filtered_df,[cite: 1]
                        filtered_df=filtered_df,[cite: 1]
                        filter_desc=filter_description_text,[cite: 1]
                        calc_ld_kpi=calc_ld_kpi_t1,
                        calc_lib_kpi=0.0,
                        daily_ld_target=daily_ld_target_t1,
                        daily_lib_target=0.0,
                        selected_num_days=selected_num_days,[cite: 1]
                        target_vid_count=3,[cite: 1]
                        target_writing_count=3,[cite: 1]
                        target_lp_combo_count=3,[cite: 1]
                        target_phonics_count=2,[cite: 1]
                        target_portfolio_count=1,[cite: 1]
                        enable_quant_kpi=enable_quant_kpi_t1,
                        enable_qual_kpi=True[cite: 1]
                    ).getvalue()
                    st.session_state["tab1_pdf_ready"] = pdf_bytes[cite: 1]

            if "tab1_pdf_ready" in st.session_state:[cite: 1]
                st.download_button([cite: 1]
                    label="📄 Download Tab 1 Report (PDF)",[cite: 1]
                    data=st.session_state["tab1_pdf_ready"],[cite: 1]
                    file_name=f"Lesson_Plan_Prep_Report_{selected_month.replace(' ', '_')}.pdf",[cite: 1]
                    mime="application/pdf",[cite: 1]
                    key="btn_pdf_tab1"[cite: 1]
                )

        with col_t1_d2:[cite: 1]
            if st.button("⚙️ Prepare Tab 1 Excel Export", key="prep_xlsx_tab1_btn"):[cite: 1]
                buf_t1_xlsx = BytesIO()[cite: 1]
                with pd.ExcelWriter(buf_t1_xlsx, engine='openpyxl') as writer:[cite: 1]
                    display_ld_table.to_excel(writer, index=False, sheet_name="Lesson_Prep_Logs")[cite: 1]
                st.session_state["tab1_xlsx_ready"] = buf_t1_xlsx.getvalue()[cite: 1]

            if "tab1_xlsx_ready" in st.session_state:[cite: 1]
                st.download_button([cite: 1]
                    label="📥 Download Tab 1 Data (Excel)",[cite: 1]
                    data=st.session_state["tab1_xlsx_ready"],[cite: 1]
                    file_name=f"Lesson_Plan_Prep_{selected_month.replace(' ', '_')}.xlsx",[cite: 1]
                    mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",[cite: 1]
                    key="btn_xlsx_tab1"[cite: 1]
                )

        teacher_prep_breakdown = "\n\n".join([f"• **{r['FullName']}**: {r['Duration_Min']:.1f} mins ({r['Performance Indicator Status']})" for _, r in ld_daily.iterrows()])[cite: 1]
        tab1_metrics_summary = ([cite: 1]
            f"🎯 Target KPI: {daily_ld_target_t1:.0f} mins/day × {selected_num_days} working days = {calc_ld_kpi_t1:.0f} mins total standard\n"
            f"Total Roster: {total_teachers} teachers | Met Standard: {met_count} | Inactive: {inactive_count} | Compliance Rate: {(met_count/total_teachers*100 if total_teachers>0 else 0):.1f}%\n\n"[cite: 1]
            f"Detailed Teacher Lesson Prep Logs:\n{teacher_prep_breakdown}"[cite: 1]
        )
        render_universal_crm_box("Lesson Plan Prep Tracker", selected_schools, filter_description_text, tab1_metrics_summary)[cite: 1]

    # TAB 2: LIBRARY USAGE TRACKER
    with tab2:
        st.header("📚 Library Usage Tracker")[cite: 1]
        
        with st.expander("🎯 Library Target Benchmark Settings", expanded=False):
            t2_kcol1, t2_kcol2 = st.columns(2)
            with t2_kcol1:
                enable_quant_kpi_t2 = st.checkbox("Enable Library Quantitative Benchmark", value=True, key="t2_enable_quant_kpi")
            with t2_kcol2:
                daily_lib_target_t2 = st.number_input("Library Usage Target (Mins/Day)", min_value=0.0, max_value=120.0, value=30.0, step=5.0, key="t2_lib_target", disabled=not enable_quant_kpi_t2) if enable_quant_kpi_t2 else 0.0

        calc_lib_kpi_t2 = daily_lib_target_t2 * selected_num_days

        tab2_col_f1, tab2_col_f2 = st.columns(2)[cite: 1]
        with tab2_col_f1:[cite: 1]
            tab2_schools = ["All Selected Schools"] + sorted([s for s in filtered_df['Institution'].unique() if str(s).strip()])[cite: 1]
            tab2_selected_school = st.selectbox("Filter Tab by School:", tab2_schools, key="tab2_school_filter")[cite: 1]
        
        tab2_active_df = filtered_df if tab2_selected_school == "All Selected Schools" else filtered_df[filtered_df['Institution'] == tab2_selected_school][cite: 1]
        tab2_active_roster = filtered_roster if tab2_selected_school == "All Selected Schools" else filtered_roster[filtered_roster['Institution'] == tab2_selected_school][cite: 1]

        with tab2_col_f2:[cite: 1]
            tab2_teachers = ["All Teachers"] + sorted([t for t in tab2_active_roster['FullName'].unique() if str(t).strip()])[cite: 1]
            tab2_selected_teacher = st.selectbox("Filter Tab by Teacher:", tab2_teachers, key="tab2_teacher_filter")[cite: 1]
            
        if tab2_selected_teacher != "All Teachers":[cite: 1]
            tab2_active_df = tab2_active_df[tab2_active_df['FullName'] == tab2_selected_teacher][cite: 1]
            tab2_active_roster = tab2_active_roster[tab2_active_roster['FullName'] == tab2_selected_teacher][cite: 1]

        if enable_quant_kpi_t2 and calc_lib_kpi_t2 > 0:
            st.caption(f"Benchmark Standard: **At least {calc_lib_kpi_t2:.0f} Minutes** ({daily_lib_target_t2:.0f} mins/day across {selected_num_days} working day(s)).")
        else:
            st.caption(f"Reviewing cumulative library usage minutes across {selected_num_days} working day(s).")[cite: 1]

        lib_df = tab2_active_df[tab2_active_df['Standard_Type'] == 'library']
        lib_usage = lib_df.groupby(['Institution', 'FullName'])['Duration_Min'].sum().reset_index()
        lib_daily = tab2_active_roster.merge(lib_usage, on=['Institution', 'FullName'], how='left').fillna(0.0)
        
        def get_lib_status(x):
            if not enable_quant_kpi_t2 or calc_lib_kpi_t2 == 0: 
                return 'Activity Logged' if x > 0 else 'No Activity Logged'
            if x >= calc_lib_kpi_t2: 
                return f'✅ Met Performance Indicator (>= {calc_lib_kpi_t2:.0f}m)'
            elif x > 0.0: 
                return f'⚠️ Below Performance Indicator (< {calc_lib_kpi_t2:.0f}m)'
            else: 
                return '❌ Inactive (0 Mins)'

        lib_daily['Performance Indicator Status'] = lib_daily['Duration_Min'].apply(get_lib_status)[cite: 1]

        m1, m2, m3, m4 = st.columns(4)[cite: 1]
        lib_total_teachers = len(lib_daily)[cite: 1]
        lib_met_count = len(lib_daily[lib_daily['Duration_Min'] >= calc_lib_kpi_t2]) if (enable_quant_kpi_t2 and calc_lib_kpi_t2 > 0) else len(lib_daily[lib_daily['Duration_Min'] > 0])
        lib_inactive_count = len(lib_daily[lib_daily['Duration_Min'] == 0.0])[cite: 1]
        
        m1.metric("Total Roster Teachers", lib_total_teachers)[cite: 1]
        m2.metric(f"Met Standard ({calc_lib_kpi_t2:.0f}m)" if enable_quant_kpi_t2 else "Active Teachers", f"{lib_met_count} / {lib_total_teachers}")
        m3.metric("Inactive Teachers (0m)", lib_inactive_count, delta=f"{-lib_inactive_count}" if lib_inactive_count > 0 else "0", delta_color="inverse")[cite: 1]
        m4.metric("Engagement Rate", f"{(lib_met_count/lib_total_teachers*100 if lib_total_teachers>0 else 0):.1f}%")[cite: 1]

        with st.expander("✨ Gemini AI Intelligent Library Usage Analysis", expanded=False):[cite: 1]
            if st.button("Generate AI Library Summary", key="ai_btn_tab2"):[cite: 1]
                with st.spinner("Analyzing library engagement with Gemini..."):[cite: 1]
                    summary_prompt = f"Analyze these library usage statistics: Total Teachers: {lib_total_teachers}, Met Standard: {lib_met_count}, Engagement Rate: {(lib_met_count/lib_total_teachers*100 if lib_total_teachers>0 else 0):.1f}%. Provide 3 key recommendations."[cite: 1]
                    ai_text = get_gemini_summary(summary_prompt)[cite: 1]
                    st.markdown(ai_text)[cite: 1]

        fig_lib = px.bar([cite: 1]
            lib_daily, x="FullName", y="Duration_Min", color="Performance Indicator Status",[cite: 1]
            title=f"Library Usage Minutes per Teacher" + (f" vs. {calc_lib_kpi_t2:.0f} Min Standard" if enable_quant_kpi_t2 else ""),
            labels={"FullName": "Teacher Name", "Duration_Min": "Minutes Logged"},[cite: 1]
            text_auto=".1f"[cite: 1]
        )
        if enable_quant_kpi_t2 and calc_lib_kpi_t2 > 0:
            fig_lib.add_hline(y=calc_lib_kpi_t2, line_dash="dash", line_color="black", annotation_text=f"Guideline ({calc_lib_kpi_t2:.0f} mins)")
        st.plotly_chart(fig_lib, use_container_width=True)[cite: 1]

        st.subheader("📋 Library Usage Table")[cite: 1]
        display_lib_table = lib_daily.rename(columns={'Institution': 'School', 'FullName': 'Teacher Name', 'Duration_Min': 'Minutes Logged'}).round({'Minutes Logged': 1})[cite: 1]
        st.dataframe(display_lib_table, use_container_width=True)[cite: 1]

        col_t2_d1, col_t2_d2 = st.columns(2)[cite: 1]
        with col_t2_d1:[cite: 1]
            if st.button("⚙️ Compile Tab 2 PDF Report", key="prep_pdf_tab2_btn"):[cite: 1]
                with st.spinner("Compiling PDF report..."):[cite: 1]
                    pdf_bytes = generate_comprehensive_school_pdf_report(
                        school_name=selected_schools[0] if len(selected_schools) == 1 else "Multiple Schools Portfolio",[cite: 1]
                        teachers_list=filtered_roster['FullName'].unique().tolist(),[cite: 1]
                        school_filtered_df=school_filtered_df,[cite: 1]
                        filtered_df=filtered_df,[cite: 1]
                        filter_desc=filter_description_text,[cite: 1]
                        calc_ld_kpi=0.0,
                        calc_lib_kpi=calc_lib_kpi_t2,
                        daily_ld_target=0.0,
                        daily_lib_target=daily_lib_target_t2,
                        selected_num_days=selected_num_days,[cite: 1]
                        target_vid_count=3,[cite: 1]
                        target_writing_count=3,[cite: 1]
                        target_lp_combo_count=3,[cite: 1]
                        target_phonics_count=2,[cite: 1]
                        target_portfolio_count=1,[cite: 1]
                        enable_quant_kpi=enable_quant_kpi_t2,
                        enable_qual_kpi=True[cite: 1]
                    ).getvalue()
                    st.session_state["tab2_pdf_ready"] = pdf_bytes[cite: 1]

            if "tab2_pdf_ready" in st.session_state:[cite: 1]
                st.download_button([cite: 1]
                    label="📄 Download Tab 2 Report (PDF)",[cite: 1]
                    data=st.session_state["tab2_pdf_ready"],[cite: 1]
                    file_name=f"Library_Usage_Report_{selected_month.replace(' ', '_')}.pdf",[cite: 1]
                    mime="application/pdf",[cite: 1]
                    key="btn_pdf_tab2"[cite: 1]
                )

        with col_t2_d2:[cite: 1]
            if st.button("⚙️ Prepare Tab 2 Excel Export", key="prep_xlsx_tab2_btn"):[cite: 1]
                buf_t2_xlsx = BytesIO()[cite: 1]
                with pd.ExcelWriter(buf_t2_xlsx, engine='openpyxl') as writer:[cite: 1]
                    display_lib_table.to_excel(writer, index=False, sheet_name="Library_Usage_Logs")[cite: 1]
                st.session_state["tab2_xlsx_ready"] = buf_t2_xlsx.getvalue()[cite: 1]

            if "tab2_xlsx_ready" in st.session_state:[cite: 1]
                st.download_button([cite: 1]
                    label="📥 Download Tab 2 Data (Excel)",[cite: 1]
                    data=st.session_state["tab2_xlsx_ready"],[cite: 1]
                    file_name=f"Library_Usage_{selected_month.replace(' ', '_')}.xlsx",[cite: 1]
                    mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",[cite: 1]
                    key="btn_xlsx_tab2"[cite: 1]
                )

        teacher_lib_breakdown = "\n\n".join([f"• **{r['FullName']}**: {r['Duration_Min']:.1f} mins ({r['Performance Indicator Status']})" for _, r in lib_daily.iterrows()])[cite: 1]
        tab2_metrics_summary = ([cite: 1]
            f"🎯 Target KPI: {daily_lib_target_t2:.0f} mins/day × {selected_num_days} working days = {calc_lib_kpi_t2:.0f} mins total standard\n"
            f"Total Roster: {lib_total_teachers} teachers | Active Met Standard: {lib_met_count} | Inactive: {lib_inactive_count} | Engagement Rate: {(lib_met_count/lib_total_teachers*100 if lib_total_teachers>0 else 0):.1f}%\n\n"[cite: 1]
            f"Detailed Teacher Library Usage Logs:\n{teacher_lib_breakdown}\n\n"[cite: 1]
            f"Note: Detailed chapter-wise reports are available in the PDF for all teachers."[cite: 1]
        )
        render_universal_crm_box("Library Usage Tracker", selected_schools, filter_description_text, tab2_metrics_summary)[cite: 1]

    # TAB 3: CONTENT & CHAPTERS
    with tab3:
        st.header("📖 Content & Chapters")[cite: 1]
        st.caption(f"Track specific textbooks and instructional modules opened during `{filter_description_text}`.")[cite: 1]

        content_raw = filtered_df[filtered_df['Book'].str.len() > 0][cite: 1]
        content_df = content_raw[~content_raw['Book'].str.match(r'^Lesson Plan', case=False, na=False)][cite: 1]

        if content_df.empty:[cite: 1]
            st.info("No specific textbook/chapter access logs found in the uploaded data for the selected global filters.")[cite: 1]
        else:
            col_f1, col_f2, col_f3 = st.columns(3)[cite: 1]
            with col_f1:[cite: 1]
                t3_school_opt = ["All Selected Schools"] + sorted(content_df['Institution'].unique().tolist())[cite: 1]
                t3_school = st.selectbox("🏫 Select School:", t3_school_opt, key="t3_school")[cite: 1]
                
            t3_df = content_df if t3_school == "All Selected Schools" else content_df[content_df['Institution'] == t3_school][cite: 1]

            with col_f2:[cite: 1]
                t3_teacher_opt = ["All Teachers"] + sorted(t3_df['FullName'].unique().tolist())[cite: 1]
                t3_teacher = st.selectbox("👤 Select Teacher:", t3_teacher_opt, key="t3_teacher")[cite: 1]
                
            if t3_teacher != "All Teachers":[cite: 1]
                t3_df = t3_df[t3_df['FullName'] == t3_teacher][cite: 1]

            with col_f3:[cite: 1]
                t3_subject_opt = ["All Subjects"] + sorted(t3_df['Subject'].unique().tolist())[cite: 1]
                t3_subject = st.selectbox("📚 Select Subject:", t3_subject_opt, key="t3_subject")[cite: 1]

            if t3_subject != "All Subjects":[cite: 1]
                t3_df = t3_df[t3_df['Subject'] == t3_subject][cite: 1]

            st.markdown("---")[cite: 1]

            if t3_df.empty:[cite: 1]
                st.warning("No data matches these specific drill-down filters.")[cite: 1]
            else:
                k1, k2, k3 = st.columns(3)[cite: 1]
                k1.metric("Textbooks / Chapters Opened", t3_df['Book'].nunique())[cite: 1]
                k2.metric("Subjects Taught", t3_df['Subject'].nunique())[cite: 1]
                k3.metric("Total Content Access Time", f"{t3_df['Duration_Min'].sum():.1f} Mins")[cite: 1]

                with st.expander("✨ Gemini AI Curriculum Pacing Analysis", expanded=False):[cite: 1]
                    if st.button("Generate AI Content Summary", key="ai_btn_tab3"):[cite: 1]
                        with st.spinner("Analyzing curriculum usage with Gemini..."):[cite: 1]
                            summary_prompt = f"Analyze textbook and subject distribution: Unique Chapters: {t3_df['Book'].nunique()}, Subjects Taught: {t3_df['Subject'].nunique()}, Total Time: {t3_df['Duration_Min'].sum():.1f} mins. Provide pacing insights."[cite: 1]
                            ai_text = get_gemini_summary(summary_prompt)[cite: 1]
                            st.markdown(ai_text)[cite: 1]

                col_c1, col_c2 = st.columns(2)[cite: 1]
                with col_c1:[cite: 1]
                    if t3_teacher != "All Teachers":[cite: 1]
                        ch_summary = t3_df.groupby(['Book', 'Grade'])['Duration_Min'].sum().reset_index()[cite: 1]
                        fig_ch = px.bar([cite: 1]
                            ch_summary, x="Duration_Min", y="Book", color="Grade", orientation="h",[cite: 1]
                            title=f"Chapters Opened by {t3_teacher} (Mins)",[cite: 1]
                            labels={"Duration_Min": "Minutes", "Book": "Book / Chapter"},[cite: 1]
                            text_auto=".1f"[cite: 1]
                        )
                        fig_ch.update_layout(yaxis={'categoryorder':'total ascending'})[cite: 1]
                    else:
                        ch_summary = t3_df.groupby(['FullName', 'Book'])['Duration_Min'].sum().reset_index()[cite: 1]
                        fig_ch = px.bar([cite: 1]
                            ch_summary, x="FullName", y="Duration_Min", color="Book",[cite: 1]
                            title="Textbooks / Chapters Opened per Teacher (Mins)",[cite: 1]
                            labels={"FullName": "Teacher", "Duration_Min": "Minutes", "Book": "Book / Chapter"},[cite: 1]
                            barmode="stack", text_auto=".1f"[cite: 1]
                        )
                    st.plotly_chart(fig_ch, use_container_width=True)[cite: 1]

                with col_c2:[cite: 1]
                    subj_summary = t3_df.groupby('Subject')['Duration_Min'].sum().reset_index()[cite: 1]
                    fig_sub = px.pie([cite: 1]
                        subj_summary, names="Subject", values="Duration_Min",[cite: 1]
                        title="Subject / Theme Distribution (Minutes)"[cite: 1]
                    )
                    st.plotly_chart(fig_sub, use_container_width=True)[cite: 1]

                st.subheader("📋 Filtered Granular Textbook Log")[cite: 1]
                log_cols = ['Institution', 'FullName', 'Grade', 'Subject', 'Book', 'StartTime', 'Duration_Min'][cite: 1]
                available_cols = [c for c in log_cols if c in t3_df.columns][cite: 1]
                
                display_content_log = t3_df[available_cols].rename(columns={[cite: 1]
                    'Institution': 'School', 'FullName': 'Teacher Name', 'Duration_Min': 'Minutes'[cite: 1]
                }).sort_values(by='StartTime', ascending=False)[cite: 1]
                display_content_log['Minutes'] = display_content_log['Minutes'].round(1)[cite: 1]
                st.dataframe(display_content_log, use_container_width=True)[cite: 1]

                col_d1, col_d2 = st.columns(2)[cite: 1]
                with col_d1:[cite: 1]
                    if st.button("⚙️ Prepare Content Excel Export", key="prep_xlsx_tab3_btn"):[cite: 1]
                        buf_t3_xlsx = BytesIO()[cite: 1]
                        with pd.ExcelWriter(buf_t3_xlsx, engine='openpyxl') as writer:[cite: 1]
                            display_content_log.to_excel(writer, index=False, sheet_name='Content_Log')[cite: 1]
                        st.session_state["tab3_xlsx_ready"] = buf_t3_xlsx.getvalue()[cite: 1]

                    if "tab3_xlsx_ready" in st.session_state:[cite: 1]
                        st.download_button([cite: 1]
                            label="📥 Download Content Log (Excel)",[cite: 1]
                            data=st.session_state["tab3_xlsx_ready"],[cite: 1]
                            file_name=f"Content_Log_{selected_month.replace(' ', '_')}.xlsx",[cite: 1]
                            mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",[cite: 1]
                            key="btn_xlsx_tab3"[cite: 1]
                        )
                with col_d2:[cite: 1]
                    if st.button("⚙️ Compile Content PDF Report", key="prep_pdf_tab3_btn"):[cite: 1]
                        with st.spinner("Compiling Content PDF..."):[cite: 1]
                            pdf_t3 = generate_pdf_report([cite: 1]
                                title_text="📖 Textbooks & Digital Content Usage Report",[cite: 1]
                                subtitle_text=f"Teacher: {t3_teacher} | Subject: {t3_subject}",[cite: 1]
                                school_name=t3_school,[cite: 1]
                                summary_metrics={[cite: 1]
                                    "Chapters Opened": t3_df['Book'].nunique(),[cite: 1]
                                    "Subjects Taught": t3_df['Subject'].nunique(),[cite: 1]
                                    "Total Duration": f"{t3_df['Duration_Min'].sum():.1f} Mins"[cite: 1]
                                },
                                dataframe=display_content_log[['School', 'Teacher Name', 'Grade', 'Subject', 'Book', 'Minutes']].head(30)[cite: 1]
                            ).getvalue()
                            st.session_state["tab3_pdf_ready"] = pdf_t3[cite: 1]

                    if "tab3_pdf_ready" in st.session_state:[cite: 1]
                        st.download_button([cite: 1]
                            label="📄 Download Tab 3 Content Report (PDF)",[cite: 1]
                            data=st.session_state["tab3_pdf_ready"],[cite: 1]
                            file_name=f"Content_Usage_Report_{selected_month.replace(' ', '_')}.pdf",[cite: 1]
                            mime="application/pdf",[cite: 1]
                            key="btn_pdf_tab3"[cite: 1]
                        )

                book_breakdown_summary = "\n\n".join([f"• {r['Book']} ({r['Grade']} - {r['Subject']}): {r['Duration_Min']:.1f} mins" for _, r in t3_df.groupby(['Book', 'Grade', 'Subject'])['Duration_Min'].sum().reset_index().iterrows()])[cite: 1]
                tab3_metrics_summary = ([cite: 1]
                    f"Chapters Opened: {t3_df['Book'].nunique()} | Subjects Taught: {t3_df['Subject'].nunique()} | Total Access Time: {t3_df['Duration_Min'].sum():.1f} Mins\n\n"[cite: 1]
                    f"Chapter Breakdown:\n{book_breakdown_summary}"[cite: 1]
                )
                render_universal_crm_box("Content & Chapters", t3_school if t3_school != "All Selected Schools" else selected_schools, filter_description_text, tab3_metrics_summary)[cite: 1]

    # TAB 4: TEACHER 360° PROFILE REPORT
    with tab4:
        st.header("👤 Teacher 360° Performance Profile")[cite: 1]
        st.caption("Review quantitative lesson metrics, detailed textbook time logs, and structured qualitative performance evidence with clickable artifact links.")[cite: 1]

        with st.expander("🎯 Teacher 360 Benchmark Controls", expanded=False):
            t4_kcol1, t4_kcol2, t4_kcol3 = st.columns(3)
            with t4_kcol1:
                enable_quant_kpi_t4 = st.checkbox("Enable Quantitative Benchmark", value=True, key="t4_enable_quant_kpi")
                daily_ld_target_t4 = st.number_input("Lesson Prep Target (Mins/Day)", min_value=0.0, max_value=60.0, value=10.0, step=5.0, key="t4_ld_target", disabled=not enable_quant_kpi_t4) if enable_quant_kpi_t4 else 0.0
                daily_lib_target_t4 = st.number_input("Library Usage Target (Mins/Day)", min_value=0.0, max_value=120.0, value=30.0, step=5.0, key="t4_lib_target", disabled=not enable_quant_kpi_t4) if enable_quant_kpi_t4 else 0.0
            with t4_kcol2:
                enable_qual_kpi_t4 = st.checkbox("Enable Qualitative Benchmark", value=True, key="t4_enable_qual_kpi")
                target_vid_count_t4 = st.number_input("Min. Activity Videos", min_value=1, max_value=20, value=3, step=1, key="t4_vid_cnt", disabled=not enable_qual_kpi_t4) if enable_qual_kpi_t4 else 0
                target_writing_count_t4 = st.number_input("Min. Writing Samples", min_value=1, max_value=20, value=3, step=1, key="t4_writing_cnt", disabled=not enable_qual_kpi_t4) if enable_qual_kpi_t4 else 0
            with t4_kcol3:
                target_lp_combo_count_t4 = st.number_input("Min. LP / Audio Notes", min_value=1, max_value=20, value=3, step=1, key="t4_lp_cnt", disabled=not enable_qual_kpi_t4) if enable_qual_kpi_t4 else 0
                target_phonics_count_t4 = st.number_input("Min. Phonics Evidence", min_value=1, max_value=20, value=2, step=1, key="t4_ph_cnt", disabled=not enable_qual_kpi_t4) if enable_qual_kpi_t4 else 0
                target_portfolio_count_t4 = st.number_input("Min. Portfolio Artifacts", min_value=1, max_value=20, value=1, step=1, key="t4_pf_cnt", disabled=not enable_qual_kpi_t4) if enable_qual_kpi_t4 else 0

        calc_ld_kpi_t4 = daily_ld_target_t4 * selected_num_days
        calc_lib_kpi_t4 = daily_lib_target_t4 * selected_num_days

        t4_fcol1, t4_fcol2 = st.columns(2)[cite: 1]
        with t4_fcol1:[cite: 1]
            t4_schools = ["All Selected Schools"] + sorted([s for s in school_master_roster['Institution'].unique() if str(s).strip()])[cite: 1]
            t4_selected_school = st.selectbox("Filter Roster by School:", t4_schools, key="t4_school_filter")[cite: 1]

        t4_active_roster = school_master_roster if t4_selected_school == "All Selected Schools" else school_master_roster[school_master_roster['Institution'] == t4_selected_school][cite: 1]
        all_roster_teachers = sorted(t4_active_roster['FullName'].unique())[cite: 1]
        
        with t4_fcol2:[cite: 1]
            if not all_roster_teachers:[cite: 1]
                st.info("No teachers found in roster for the selected filter.")[cite: 1]
                target_teacher = None[cite: 1]
            else:
                target_teacher = st.selectbox("Select Teacher to Audit:", options=all_roster_teachers, key="top_teacher_select")[cite: 1]
        
        if target_teacher:[cite: 1]
            teacher_all_data = school_filtered_df[school_filtered_df['FullName'] == target_teacher][cite: 1]
            teacher_date_data = filtered_df[filtered_df['FullName'] == target_teacher][cite: 1]
            teacher_school = school_master_roster[school_master_roster['FullName'] == target_teacher]['Institution'].values[0] if not school_master_roster[school_master_roster['FullName'] == target_teacher].empty else "N/A"[cite: 1]

            t_day_ld = teacher_date_data[teacher_date_data['Standard_Type'] == 'lessonDelivery']['Duration_Min'].sum() if not teacher_date_data.empty else 0.0
            t_day_lib = teacher_date_data[teacher_date_data['Standard_Type'] == 'library']['Duration_Min'].sum() if not teacher_date_data.empty else 0.0
            
            ld_pct = (t_day_ld / calc_ld_kpi_t4) * 100 if calc_ld_kpi_t4 > 0 else (100.0 if t_day_ld >= 0 else 0)
            lib_pct = (t_day_lib / calc_lib_kpi_t4) * 100 if calc_lib_kpi_t4 > 0 else (100.0 if t_day_lib >= 0 else 0)

            if calc_ld_kpi_t4 > 0:
                ld_advice = f"🌟 Steady Execution ({t_day_ld:.1f}m logged)" if t_day_ld >= calc_ld_kpi_t4 else (f"⚠️ In-Progress ({t_day_ld:.1f}m logged)" if t_day_ld > 0 else "❌ Pending Activity")
            else:
                ld_advice = "✅ Holiday / Scheduled Break"[cite: 1]

            if calc_lib_kpi_t4 > 0:
                lib_advice = f"🌟 Steady Execution ({t_day_lib:.1f}m logged)" if t_day_lib >= calc_lib_kpi_t4 else (f"⚠️ In-Progress ({t_day_lib:.1f}m logged)" if t_day_lib > 0 else "❌ Pending Activity")
            else:
                lib_advice = "✅ Holiday / Scheduled Break"[cite: 1]

            t_books_raw = teacher_date_data[teacher_date_data['Book'].str.len() > 0][cite: 1]
            if t_books_raw.empty:[cite: 1]
                t_books_raw = teacher_all_data[teacher_all_data['Book'].str.len() > 0][cite: 1]
            teacher_books = t_books_raw[~t_books_raw['Book'].str.match(r'^Lesson Plan', case=False, na=False)][cite: 1]

            evidence_source = teacher_date_data if not teacher_date_data.empty else teacher_all_data[cite: 1]
            
            v_voice = extract_evidence_items_vectorized(evidence_source, 'Voice_Note_Link')[cite: 1]
            v_pic = extract_evidence_items_vectorized(evidence_source, 'Lesson_Plan_Picture')[cite: 1]
            v_writing = extract_evidence_items_vectorized(evidence_source, 'Writing_Sample_Link')[cite: 1]
            v_phonics = extract_evidence_items_vectorized(evidence_source, 'Phonics_Evidence_Link')[cite: 1]
            v_portfolio = extract_evidence_items_vectorized(evidence_source, 'Portfolio_Evidence_Link')[cite: 1]

            v_vid = [][cite: 1]
            for col in ['Video_Evidence_1', 'Video_Evidence_2', 'Video_Evidence_3']:[cite: 1]
                v_vid.extend(extract_evidence_items_vectorized(evidence_source, col))[cite: 1]
            seen_v = set()[cite: 1]
            deduped_v = [][cite: 1]
            for item in v_vid:[cite: 1]
                if item['url'] not in seen_v:[cite: 1]
                    seen_v.add(item['url'])[cite: 1]
                    deduped_v.append(item)[cite: 1]
            v_vid = deduped_v[cite: 1]

            lp_combo_total = len(v_voice) + len(v_pic)[cite: 1]
            total_artifacts = lp_combo_total + len(v_vid) + len(v_writing) + len(v_phonics) + len(v_portfolio)[cite: 1]

            pdf_book_items = [][cite: 1]
            if not teacher_books.empty:[cite: 1]
                b_summary_df = teacher_books.groupby(['Book', 'Grade', 'Subject'])['Duration_Min'].sum().reset_index()[cite: 1]
                for _, br in b_summary_df.iterrows():[cite: 1]
                    pdf_book_items.append(f"Book: {br['Book']} ({br['Grade']} - {br['Subject']}) | Time Spent: {br['Duration_Min']:.1f} Mins")[cite: 1]
            else:
                pdf_book_items.append("No textbooks or digital modules opened.")[cite: 1]

            pdf_link_items = [][cite: 1]
            for i, item in enumerate(v_voice, 1):  [cite: 1]
                pdf_link_items.append(f'• 🎧 <a href="{item["url"]}"><u><b>Open Voice Reflection #{i}</b></u></a> — <i>{item["grade"]} | {item["subject"]} ({item["lesson"]}, {item["date"]})</i>')[cite: 1]
            for i, item in enumerate(v_pic, 1): [cite: 1]
                pdf_link_items.append(f'• 🖼️ <a href="{item["url"]}"><u><b>View Lesson Plan Photo #{i}</b></u></a> — <i>{item["grade"]} | {item["subject"]} ({item["lesson"]}, {item["date"]})</i>')[cite: 1]
            for i, item in enumerate(v_vid, 1): [cite: 1]
                pdf_link_items.append(f'• 🎥 <a href="{item["url"]}"><u><b>Watch Classroom Activity Video #{i}</b></u></a> — <i>{item["grade"]} | {item["subject"]} ({item["lesson"]}, {item["date"]})</i>')[cite: 1]
            for i, item in enumerate(v_writing, 1): [cite: 1]
                pdf_link_items.append(f'• 📝 <a href="{item["url"]}"><u><b>View Student Writing Sample #{i}</b></u></a> — <i>{item["grade"]} | {item["subject"]} ({item["lesson"]}, {item["date"]})</i>')[cite: 1]
            for i, item in enumerate(v_phonics, 1): [cite: 1]
                pdf_link_items.append(f'• 🔤 <a href="{item["url"]}"><u><b>Open Phonics Evidence #{i}</b></u></a> — <i>{item["grade"]} | {item["subject"]} ({item["lesson"]}, {item["date"]})</i>')[cite: 1]
            for i, item in enumerate(v_portfolio, 1): [cite: 1]
                pdf_link_items.append(f'• 📁 <a href="{item["url"]}"><u><b>View Teacher Portfolio Showcase #{i}</b></u></a> — <i>{item["grade"]} | {item["subject"]} ({item["lesson"]}, {item["date"]})</i>')[cite: 1]

            pdf_custom_sections = {[cite: 1]
                "1. Lesson Preparation, Lesson Delivery, and Library Usage": [[cite: 1]
                    f"Lesson Preparation Duration: {t_day_ld:.1f} Minutes" + (f" ({ld_pct:.0f}% of Academic Benchmark)" if enable_quant_kpi_t4 else ""),
                    f"Library & Digital Resources Duration: {t_day_lib:.1f} Minutes" + (f" ({lib_pct:.0f}% of Academic Benchmark)" if enable_quant_kpi_t4 else ""),
                    f"Consultant Assessment: {ld_advice} in lesson preparation, {lib_advice} in library integration."[cite: 1]
                ],
                "2. Content / Digital Book Content Usage": pdf_book_items,[cite: 1]
                "3. Activity Evidence, Activity Submission, and Artifact Evidence": pdf_link_items if pdf_link_items else ["No activity or evidence submission links recorded in active window."][cite: 1]
            }

            col_btn_top, col_bulk_btn = st.columns(2)[cite: 1]
            with col_btn_top:[cite: 1]
                if st.button(f"⚙️ Compile 360° Profile PDF for {target_teacher}", key="btn_prep_single_pdf"):[cite: 1]
                    with st.spinner("Generating teacher profile PDF..."):[cite: 1]
                        single_pdf = generate_pdf_report([cite: 1]
                            title_text=f"🏫 Academic Performance Profile: {target_teacher}",[cite: 1]
                            subtitle_text=f"Observation Window: {filter_description_text}",[cite: 1]
                            school_name=teacher_school,[cite: 1]
                            summary_metrics={[cite: 1]
                                "Teacher": target_teacher,[cite: 1]
                                "Lesson Prep": f"{t_day_ld:.1f}m",[cite: 1]
                                "Library Usage": f"{t_day_lib:.1f}m",[cite: 1]
                                "Phonics / Portfolio": f"{len(v_phonics)} / {len(v_portfolio)}",[cite: 1]
                                "Activity Submissions": f"{total_artifacts}"[cite: 1]
                            },
                            dataframe=None,[cite: 1]
                            custom_sections=pdf_custom_sections[cite: 1]
                        ).getvalue()
                        st.session_state[f"pdf_360_{target_teacher}"] = single_pdf[cite: 1]

                if f"pdf_360_{target_teacher}" in st.session_state:[cite: 1]
                    st.download_button([cite: 1]
                        label="📥 Download 360° Profile (PDF)",[cite: 1]
                        data=st.session_state[f"pdf_360_{target_teacher}"],[cite: 1]
                        file_name=f"{target_teacher.replace(' ', '_')}_360_Profile_Report.pdf",[cite: 1]
                        mime="application/pdf",[cite: 1]
                        key="top_pdf_download_btn"[cite: 1]
                    )

            with col_bulk_btn:[cite: 1]
                if st.button(f"⚙️ Compile Bulk School PDF for {teacher_school}", key="btn_prep_bulk_pdf"):[cite: 1]
                    with st.spinner("Generating comprehensive school audit..."):[cite: 1]
                        school_teachers_list = sorted(school_master_roster[school_master_roster['Institution'] == teacher_school]['FullName'].unique().tolist())[cite: 1]
                        bulk_pdf = generate_comprehensive_school_pdf_report(
                            school_name=teacher_school,[cite: 1]
                            teachers_list=school_teachers_list,[cite: 1]
                            school_filtered_df=school_filtered_df,[cite: 1]
                            filtered_df=filtered_df,[cite: 1]
                            filter_desc=filter_description_text,[cite: 1]
                            calc_ld_kpi=calc_ld_kpi_t4,
                            calc_lib_kpi=calc_lib_kpi_t4,
                            daily_ld_target=daily_ld_target_t4,
                            daily_lib_target=daily_lib_target_t4,
                            selected_num_days=selected_num_days,[cite: 1]
                            target_vid_count=target_vid_count_t4,
                            target_writing_count=target_writing_count_t4,
                            target_lp_combo_count=target_lp_combo_count_t4,
                            target_phonics_count=target_phonics_count_t4,
                            target_portfolio_count=target_portfolio_count_t4,
                            enable_quant_kpi=enable_quant_kpi_t4,
                            enable_qual_kpi=enable_qual_kpi_t4
                        ).getvalue()
                        st.session_state[f"bulk_pdf_{teacher_school}"] = bulk_pdf[cite: 1]

                if f"bulk_pdf_{teacher_school}" in st.session_state:[cite: 1]
                    st.download_button([cite: 1]
                        label="📥 Download Bulk School 360 Profiles (PDF)",[cite: 1]
                        data=st.session_state[f"bulk_pdf_{teacher_school}"],[cite: 1]
                        file_name=f"{teacher_school.replace(' ', '_')}_Comprehensive_School_Report.pdf",[cite: 1]
                        mime="application/pdf",[cite: 1]
                        key="bulk_school_pdf_btn"[cite: 1]
                    )

            st.markdown(f"### 📋 Audit Profile: **{target_teacher}** | School: **{teacher_school}**")[cite: 1]

            with st.expander("✨ Gemini AI Comprehensive Teacher Evaluation Report", expanded=False):[cite: 1]
                if st.button("Generate AI Teacher 360 Review", key="ai_btn_tab4"):[cite: 1]
                    with st.spinner("Generating comprehensive teacher evaluation with Gemini..."):[cite: 1]
                        review_prompt = f"Write an academic manager review for teacher {target_teacher} at {teacher_school}. Lesson prep: {t_day_ld:.1f} mins, Library usage: {t_day_lib:.1f} mins, Phonics evidence: {len(v_phonics)}, Portfolio uploads: {len(v_portfolio)}, Activity videos: {len(v_vid)}, Writing samples: {len(v_writing)}. Provide constructive feedback."[cite: 1]
                        ai_eval = get_gemini_summary(review_prompt)[cite: 1]
                        st.markdown(ai_eval)[cite: 1]

            st.subheader("1. Quantitative Performance Indicator Summary")[cite: 1]
            st.info(f"📅 **Active Filter**: `{filter_description_text}` | **Performance Indicator Duration**: `{selected_num_days} Working Day(s)`")[cite: 1]

            col_sum1, col_sum2 = st.columns([1, 1.2])[cite: 1]

            with col_sum1:[cite: 1]
                st.markdown("##### 📌 Quantitative Performance Indicator Overview")[cite: 1]
                s1, s2 = st.columns(2)[cite: 1]
                s1.metric("Lesson Prep Mins", f"{t_day_ld:.1f} mins", delta=f"{ld_pct:.0f}% of Standard" if enable_quant_kpi_t4 else None)
                s2.metric("Library Usage Mins", f"{t_day_lib:.1f} mins", delta=f"{lib_pct:.0f}% of Standard" if enable_quant_kpi_t4 else None)
                
                st.markdown("##### 💡 Academic Consultant Observation")[cite: 1]
                if calc_ld_kpi_t4 == 0 and calc_lib_kpi_t4 == 0:
                    st.info(f"🏖️ **Break Period**: Active filter falls on an excluded calendar break.")[cite: 1]
                elif t_day_ld >= calc_ld_kpi_t4 and t_day_lib >= calc_lib_kpi_t4:
                    st.success(f"👏 **Consistent Delivery**: {target_teacher} maintained steady curriculum prep and library engagement.")[cite: 1]
                elif t_day_ld < calc_ld_kpi_t4 and t_day_lib < calc_lib_kpi_t4:
                    st.warning(f"💡 **Growth Opportunity**: Focus on structured digital planning hours and library exploration.")[cite: 1]
                else:
                    st.info(f"📌 **Balanced Usage**: Progress noted with potential to scale integration.")[cite: 1]

                st.write(f"• **Lesson Plan Preparation**: {ld_advice}")[cite: 1]
                st.write(f"• **Library Usage Engagement**: {lib_advice}")[cite: 1]

            with col_sum2:[cite: 1]
                st.markdown("##### 📊 Performance Indicator Achievement Comparison")[cite: 1]
                ach_df = pd.DataFrame({[cite: 1]
                    'Performance Indicator Category': [f'Lesson Prep ({calc_ld_kpi_t4:.0f}m)' if enable_quant_kpi_t4 else 'Lesson Prep', 
                                                       f'Library Usage ({calc_lib_kpi_t4:.0f}m)' if enable_quant_kpi_t4 else 'Library Usage'],
                    'Logged Minutes': [t_day_ld, t_day_lib],[cite: 1]
                    'Performance Indicator Standard': [calc_ld_kpi_t4, calc_lib_kpi_t4]
                })
                
                fig_ach = go.Figure()[cite: 1]
                fig_ach.add_trace(go.Bar([cite: 1]
                    x=ach_df['Performance Indicator Category'], y=ach_df['Logged Minutes'],[cite: 1]
                    name='Logged Minutes', marker_color='#2CA02C', text=[f"{v:.1f} mins" for v in ach_df['Logged Minutes']], textposition='auto'[cite: 1]
                ))
                if enable_quant_kpi_t4:
                    fig_ach.add_trace(go.Bar([cite: 1]
                        x=ach_df['Performance Indicator Category'], y=ach_df['Performance Indicator Standard'],[cite: 1]
                        name='Standard Guideline', marker_color='#E5E5E5', opacity=0.6, text=[f"{v:.1f} mins" for v in ach_df['Performance Indicator Standard']], textposition='auto'[cite: 1]
                    ))
                fig_ach.update_layout([cite: 1]
                    barmode='group', title=f"Logged Minutes vs. Standard Guideline ({selected_num_days} Working Day(s))",[cite: 1]
                    height=280, margin=dict(l=20, r=20, t=40, b=20)[cite: 1]
                )
                st.plotly_chart(fig_ach, use_container_width=True)[cite: 1]

            st.markdown("---")[cite: 1]

            st.subheader("2. Detailed Textbook & Chapter Time Breakdown")[cite: 1]
            if teacher_books.empty:[cite: 1]
                st.info(f"No digital textbooks or modules recorded for **{target_teacher}**.")[cite: 1]
            else:
                col_b1, col_b2 = st.columns(2)[cite: 1]
                with col_b1:[cite: 1]
                    t_book_summary = teacher_books.groupby(['Book', 'Grade', 'Subject'])['Duration_Min'].sum().reset_index()[cite: 1]
                    fig_tb_bar = px.bar([cite: 1]
                        t_book_summary, x="Duration_Min", y="Book", color="Grade", orientation="h",[cite: 1]
                        title=f"Time Spent per Book/Chapter by {target_teacher} (Minutes)",[cite: 1]
                        labels={"Duration_Min": "Time Spent (Minutes)", "Book": "Book / Chapter"},[cite: 1]
                        text_auto=".1f"[cite: 1]
                    )
                    fig_tb_bar.update_layout(yaxis={'categoryorder':'total ascending'}, height=320)[cite: 1]
                    st.plotly_chart(fig_tb_bar, use_container_width=True)[cite: 1]
                    
                with col_b2:[cite: 1]
                    st.markdown("##### ⏱️ Time Allocation Table")[cite: 1]
                    display_book_table = t_book_summary.rename(columns={'Book': 'Textbook / Module', 'Grade': 'Grade', 'Subject': 'Subject', 'Duration_Min': 'Time Spent (Mins)'}).round({'Time Spent (Mins)': 1})[cite: 1]
                    st.dataframe(display_book_table, use_container_width=True)[cite: 1]

            st.markdown("---")[cite: 1]

            st.subheader("3. Qualitative Evidences & Artifact Hub (Phonics & Portfolio Integrated)")[cite: 1]

            v_cols = st.columns(5)[cite: 1]
            v_cols[0].metric("📖 LP / Audio Notes", f"{lp_combo_total}", delta=f"{len(v_voice)} Audio | {len(v_pic)} Img")[cite: 1]
            v_cols[1].metric("🎥 Activity Videos", f"{len(v_vid)}")[cite: 1]
            v_cols[2].metric("📝 Writing Samples", f"{len(v_writing)}")[cite: 1]
            v_cols[3].metric("🔤 Phonics Evidence", f"{len(v_phonics)}")[cite: 1]
            v_cols[4].metric("📁 Portfolio Uploads", f"{len(v_portfolio)}")[cite: 1]

            st.markdown("##### 📌 Detailed Evidence Submissions & Direct Artifact Links")[cite: 1]
            q_cols1, q_cols2, q_cols3 = st.columns(3)[cite: 1]
            
            with q_cols1:[cite: 1]
                st.markdown("###### 📖 1. Lesson Plans & Pre-Class Voice Notes")[cite: 1]
                combined_lp_items = [][cite: 1]
                for item in v_voice:[cite: 1]
                    combined_lp_items.append(f"🎧 [Audio Note]({item['url']}) - **{item['grade']}** | *{item['subject']}* ({item['lesson']}, {item['date']})")[cite: 1]
                for item in v_pic:[cite: 1]
                    combined_lp_items.append(f"🖼️ [LP Picture]({item['url']}) - **{item['grade']}** | *{item['subject']}* ({item['lesson']}, {item['date']})")[cite: 1]
                if combined_lp_items:[cite: 1]
                    for line in combined_lp_items: st.markdown(f"• {line}")[cite: 1]
                else:
                    st.caption("No lesson plans or voice reflections submitted.")[cite: 1]

            with q_cols2:[cite: 1]
                st.markdown("###### 🎥 2. Classroom Videos & Student Writing")[cite: 1]
                for item in v_vid:[cite: 1]
                    st.markdown(f"• 🎥 [Watch Video]({item['url']}) - **{item['grade']}** | *{item['subject']}* ({item['lesson']}, {item['date']})")[cite: 1]
                for item in v_writing:[cite: 1]
                    st.markdown(f"• 📝 [View Writing]({item['url']}) - **{item['grade']}** | *{item['subject']}* ({item['lesson']}, {item['date']})")[cite: 1]
                if not v_vid and not v_writing:[cite: 1]
                    st.caption("No activity videos or writing samples uploaded.")[cite: 1]

            with q_cols3:[cite: 1]
                st.markdown("###### 🔤 3. Phonics Implementation & Portfolio Showcase")[cite: 1]
                for item in v_phonics:[cite: 1]
                    st.markdown(f"• 🔤 [Phonics Evidence]({item['url']}) - **{item['grade']}** | *{item['subject']}* ({item['lesson']}, {item['date']})")[cite: 1]
                for item in v_portfolio:[cite: 1]
                    st.markdown(f"• 📁 [Portfolio Artifact]({item['url']}) - **{item['grade']}** | *{item['subject']}* ({item['lesson']}, {item['date']})")[cite: 1]
                if not v_phonics and not v_portfolio:[cite: 1]
                    st.caption("No phonics implementation or portfolio files uploaded.")[cite: 1]

            st.markdown("---")[cite: 1]

            col_log_head, col_log_filt = st.columns([2, 1])[cite: 1]
            with col_log_head:[cite: 1]
                st.subheader(f"4. Granular Classroom Audit Log for {target_teacher}")[cite: 1]
            with col_log_filt:[cite: 1]
                available_types = ["All Types"] + sorted(teacher_all_data['Type'].dropna().unique().tolist())[cite: 1]
                selected_type_filter = st.selectbox("Filter Audit Log by Type:", options=available_types)[cite: 1]

            if selected_type_filter == "All Types":[cite: 1]
                filtered_audit_log = teacher_all_data[cite: 1]
            else:
                filtered_audit_log = teacher_all_data[teacher_all_data['Type'] == selected_type_filter][cite: 1]

            t_log_cols = ['Date', 'Type', 'Grade', 'Subject', 'Book', 'StartTime', 'Phonics_Evidence_Link', 'Portfolio_Evidence_Link', 'Voice_Note_Link', 'Video_Evidence_1', 'Writing_Sample_Link', 'Duration_Min'][cite: 1]
            t_avail_cols = [c for c in t_log_cols if c in filtered_audit_log.columns][cite: 1]
            
            if filtered_audit_log.empty:[cite: 1]
                st.info(f"No logs found for type `{selected_type_filter}` during `{filter_description_text}`.")[cite: 1]
            else:
                t_display_log = filtered_audit_log[t_avail_cols].rename(columns={'Duration_Min': 'Minutes'}).sort_values(by='StartTime', ascending=False)[cite: 1]
                t_display_log['Minutes'] = t_display_log['Minutes'].round(1)[cite: 1]
                st.dataframe(t_display_log, use_container_width=True)[cite: 1]

                col_p1, col_p2 = st.columns(2)[cite: 1]
                with col_p1:[cite: 1]
                    if st.button("⚙️ Prepare Teacher Audit Excel", key=f"prep_audit_xlsx_{target_teacher}"):[cite: 1]
                        buf_p1_xlsx = BytesIO()[cite: 1]
                        with pd.ExcelWriter(buf_p1_xlsx, engine='openpyxl') as writer:[cite: 1]
                            t_display_log.to_excel(writer, index=False, sheet_name='Teacher_Audit')[cite: 1]
                        st.session_state[f"audit_xlsx_{target_teacher}"] = buf_p1_xlsx.getvalue()[cite: 1]

                    if f"audit_xlsx_{target_teacher}" in st.session_state:[cite: 1]
                        st.download_button([cite: 1]
                            label=f"📥 Download Full Excel Audit for {target_teacher}",[cite: 1]
                            data=st.session_state[f"audit_xlsx_{target_teacher}"],[cite: 1]
                            file_name=f"{target_teacher.replace(' ', '_')}_{selected_type_filter}_Audit.xlsx",[cite: 1]
                            mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",[cite: 1]
                            key="btn_xlsx_tab4"[cite: 1]
                        )

            # --- EMBEDDED SCHOOL AUDIT & WHATSAPP DISPATCH HUB ---
            st.markdown("---")[cite: 1]
            st.markdown(f"### 📱 School Audit WhatsApp & PDF Dispatch Hub for: **{teacher_school}**")[cite: 1]
            st.caption("Generates a school-wide performance summary with an embedded live Supabase download link for the Full School Audit Report.")[cite: 1]

            sch_roster = school_master_roster[school_master_roster['Institution'] == teacher_school][cite: 1]
            sch_data = filtered_df[filtered_df['Institution'] == teacher_school][cite: 1]
            if sch_data.empty and not school_filtered_df.empty:[cite: 1]
                sch_data = school_filtered_df[school_filtered_df['Institution'] == teacher_school][cite: 1]

            sch_teachers_list = sorted(sch_roster['FullName'].unique().tolist())[cite: 1]
            tot_teachers = len(sch_teachers_list)[cite: 1]

            ld_m = sch_data[sch_data['Standard_Type'] == 'lessonDelivery'].groupby('FullName')['Duration_Min'].sum().to_dict()
            lib_m = sch_data[sch_data['Standard_Type'] == 'library'].groupby('FullName')['Duration_Min'].sum().to_dict()

            met_ld = 0[cite: 1]
            met_lib = 0[cite: 1]
            for t in sch_teachers_list:[cite: 1]
                t_ld_mins = ld_m.get(t, 0.0)[cite: 1]
                t_lib_mins = lib_m.get(t, 0.0)[cite: 1]
                if (calc_ld_kpi_t4 > 0 and t_ld_mins >= calc_ld_kpi_t4) or (calc_ld_kpi_t4 == 0 and t_ld_mins > 0):[cite: 1]
                    met_ld += 1[cite: 1]
                if (calc_lib_kpi_t4 > 0 and t_lib_mins >= calc_lib_kpi_t4) or (calc_lib_kpi_t4 == 0 and t_lib_mins > 0):[cite: 1]
                    met_lib += 1[cite: 1]

            ld_comp_pct = (met_ld / tot_teachers * 100) if tot_teachers > 0 else 0[cite: 1]
            lib_comp_pct = (met_lib / tot_teachers * 100) if tot_teachers > 0 else 0[cite: 1]

            inactive_teachers = [t for t in sch_teachers_list if (ld_m.get(t, 0.0) == 0.0 and lib_m.get(t, 0.0) == 0.0)][cite: 1]
            inactive_str = ", ".join(inactive_teachers[:3]) + (f" (+{len(inactive_teachers)-3} more)" if len(inactive_teachers) > 3 else "") if inactive_teachers else "None (All Active)"[cite: 1]

            vids_cnt = sum([len(extract_evidence_items_vectorized(sch_data, col)) for col in ['Video_Evidence_1', 'Video_Evidence_2', 'Video_Evidence_3']])[cite: 1]
            phonics_cnt = len(extract_evidence_items_vectorized(sch_data, 'Phonics_Evidence_Link'))[cite: 1]
            writing_cnt = len(extract_evidence_items_vectorized(sch_data, 'Writing_Sample_Link'))[cite: 1]
            lp_pic_cnt = len(extract_evidence_items_vectorized(sch_data, 'Lesson_Plan_Picture'))[cite: 1]
            voice_cnt = len(extract_evidence_items_vectorized(sch_data, 'Voice_Note_Link'))[cite: 1]
            portfolio_cnt = len(extract_evidence_items_vectorized(sch_data, 'Portfolio_Evidence_Link'))[cite: 1]

            hosted_school_pdf_url = st.session_state.get(f"hosted_pdf_url_{teacher_school}")[cite: 1]

            if st.button(f"☁️ Compile & Upload PDF Report to Supabase Cloud for {teacher_school}", key=f"upload_cloud_pdf_{teacher_school}"):[cite: 1]
                with st.spinner("Generating and uploading PDF report to Supabase..."):[cite: 1]
                    school_pdf_buf = generate_comprehensive_school_pdf_report(
                        school_name=teacher_school,[cite: 1]
                        teachers_list=sch_teachers_list,[cite: 1]
                        school_filtered_df=school_filtered_df,[cite: 1]
                        filtered_df=filtered_df,[cite: 1]
                        filter_desc=filter_description_text,[cite: 1]
                        calc_ld_kpi=calc_ld_kpi_t4,
                        calc_lib_kpi=calc_lib_kpi_t4,
                        daily_ld_target=daily_ld_target_t4,
                        daily_lib_target=daily_lib_target_t4,
                        selected_num_days=selected_num_days,[cite: 1]
                        target_vid_count=target_vid_count_t4,
                        target_writing_count=target_writing_count_t4,
                        target_lp_combo_count=target_lp_combo_count_t4,
                        target_phonics_count=target_phonics_count_t4,
                        target_portfolio_count=target_portfolio_count_t4,
                        enable_quant_kpi=enable_quant_kpi_t4,
                        enable_qual_kpi=enable_qual_kpi_t4
                    )
                    hosted_school_pdf_url = upload_pdf_to_supabase(school_pdf_buf, teacher_school)[cite: 1]
                    st.session_state[f"hosted_pdf_url_{teacher_school}"] = hosted_school_pdf_url[cite: 1]
                    st.success("Uploaded successfully to Supabase!")[cite: 1]

            pdf_link_markdown = f"\n\n📄 *Download Full School Audit Report (PDF):*\n{hosted_school_pdf_url}" if hosted_school_pdf_url else ""[cite: 1]

            ld_bench_str = f" [Benchmark: {daily_ld_target_t4:.0f}m/day × {selected_num_days}d = {calc_ld_kpi_t4:.0f} mins total]" if (enable_quant_kpi_t4 and calc_ld_kpi_t4 > 0) else ""[cite: 1]
            lib_bench_str = f" [Benchmark: {daily_lib_target_t4:.0f}m/day × {selected_num_days}d = {calc_lib_kpi_t4:.0f} mins total]" if (enable_quant_kpi_t4 and calc_lib_kpi_t4 > 0) else ""[cite: 1]

            school_msg_parts = [[cite: 1]
                f"Respected Sir/Madam,\n\n",[cite: 1]
                f"Greetings from OneLearn Academic Team! Here is the latest performance & classroom implementation summary for *{teacher_school}* ({filter_description_text}):\n"[cite: 1]
            ]

            if enable_quant_kpi_t4:[cite: 1]
                school_msg_parts.append([cite: 1]
                    f"📊 *Quantitative Benchmarks:*\n"[cite: 1]
                    f"• Lesson Plan Prep Compliance: {ld_comp_pct:.0f}% ({met_ld}/{tot_teachers} Teachers){ld_bench_str}\n"[cite: 1]
                    f"• Library Digital Usage Compliance: {lib_comp_pct:.0f}% ({met_lib}/{tot_teachers} Teachers){lib_bench_str}"[cite: 1]
                )

            if enable_qual_kpi_t4:[cite: 1]
                school_msg_parts.append([cite: 1]
                    f"\n📬 *Classroom Evidence Submissions:*\n"[cite: 1]
                    f"• Activity Videos: {vids_cnt} Uploaded\n"[cite: 1]
                    f"• Phonics Evidence: {phonics_cnt} Uploaded\n"[cite: 1]
                    f"• Writing Samples: {writing_cnt} Uploaded\n"[cite: 1]
                    f"• LP Pictures / Voice Notes: {lp_pic_cnt + voice_cnt} Uploaded\n"[cite: 1]
                    f"• Portfolio Artifacts: {portfolio_cnt} Uploaded"[cite: 1]
                )

            school_msg_parts.append([cite: 1]
                f"\n⚠️ *Inactive / Follow-up Teachers:* {inactive_str}"[cite: 1]
                f"{pdf_link_markdown}\n\n"[cite: 1]
                f"Let us connect for a 5-minute review to support your teachers in scaling classroom outcomes.\n\n"[cite: 1]
                f"Regards,\n"[cite: 1]
                f"Harshit Bhargava,\n"[cite: 1]
                f"OneLearn Academic Team"[cite: 1]
            )

            final_school_wa_msg = "\n".join(school_msg_parts)[cite: 1]

            render_school_audit_crm_box([cite: 1]
                "Teacher 360 Profile", [cite: 1]
                teacher_school, [cite: 1]
                filter_description_text, [cite: 1]
                final_school_wa_msg[cite: 1]
            )

    # TAB 5: MANAGER PORTFOLIO & SCHOOL QUADRANTS
    with tab5:
        st.header("🏛️ Academic Manager Portfolio Overview")[cite: 1]
        st.caption("High-level classification, Quantitative indicators, and Week-on-Week Velocity tracking across your school portfolio.")[cite: 1]

        if school_filtered_df.empty:[cite: 1]
            st.warning("No data available for the selected school filter.")[cite: 1]
        else:
            with st.expander("🎯 Portfolio Quadrant Benchmark Settings", expanded=False):
                t5_kcol1, t5_kcol2 = st.columns(2)
                with t5_kcol1:
                    enable_quant_kpi_t5 = st.checkbox("Enable Quantitative Benchmark", value=True, key="t5_enable_quant_kpi")
                    daily_ld_target_t5 = st.number_input("Lesson Prep Target (Mins/Day)", min_value=0.0, max_value=60.0, value=10.0, step=5.0, key="t5_ld_target", disabled=not enable_quant_kpi_t5) if enable_quant_kpi_t5 else 0.0
                    daily_lib_target_t5 = st.number_input("Library Usage Target (Mins/Day)", min_value=0.0, max_value=120.0, value=30.0, step=5.0, key="t5_lib_target", disabled=not enable_quant_kpi_t5) if enable_quant_kpi_t5 else 0.0
                with t5_kcol2:
                    enable_qual_kpi_t5 = st.checkbox("Enable Qualitative Artifact Benchmark", value=True, key="t5_enable_qual_kpi")
                    target_vid_count_t5 = st.number_input("Min. Activity Videos Required", min_value=1, max_value=20, value=3, step=1, key="t5_vid_cnt", disabled=not enable_qual_kpi_t5) if enable_qual_kpi_t5 else 0
                    target_writing_count_t5 = st.number_input("Min. Writing Practice Required", min_value=1, max_value=20, value=3, step=1, key="t5_writing_cnt", disabled=not enable_qual_kpi_t5) if enable_qual_kpi_t5 else 0

            t5_class_filter = st.selectbox("Filter Portfolio by Classification:", ["All Classifications", "🌟 Pace Setters", "📘 Lesson Focused", "📚 Library Focused", "🚨 Priority Focus"], key="t5_class_filter")[cite: 1]

            school_stats = filtered_df.groupby(['Institution', 'Standard_Type'])['Duration_Min'].sum().unstack(fill_value=0.0).reset_index()
            
            if 'lessonDelivery' not in school_stats.columns: school_stats['lessonDelivery'] = 0.0[cite: 1]
            if 'library' not in school_stats.columns: school_stats['library'] = 0.0[cite: 1]
            
            all_active_schools = school_filtered_df['Institution'].unique()[cite: 1]
            for s_name in all_active_schools:[cite: 1]
                if s_name not in school_stats['Institution'].values:[cite: 1]
                    new_row = pd.DataFrame({'Institution': [s_name], 'lessonDelivery': [0.0], 'library': [0.0]})[cite: 1]
                    school_stats = pd.concat([school_stats, new_row], ignore_index=True)[cite: 1]

            school_roster_count = school_master_roster.groupby('Institution')['FullName'].nunique().reset_index().rename(columns={'FullName': 'Roster_Teachers'})[cite: 1]
            school_stats = school_stats.merge(school_roster_count, on='Institution', how='left').fillna(1)[cite: 1]

            school_stats['Avg_Lesson_Prep_Mins'] = (school_stats['lessonDelivery'] / school_stats['Roster_Teachers'] / selected_num_days).round(1)[cite: 1]
            school_stats['Avg_Library_Usage_Mins'] = (school_stats['library'] / school_stats['Roster_Teachers'] / selected_num_days).round(1)[cite: 1]

            qual_agg = [][cite: 1]
            for s_name in school_stats['Institution'].unique():[cite: 1]
                s_data = filtered_df[filtered_df['Institution'] == s_name][cite: 1]
                s_vids = sum([len(extract_evidence_items_vectorized(s_data, vc)) for vc in ['Video_Evidence_1', 'Video_Evidence_2', 'Video_Evidence_3']])[cite: 1]
                s_w = len(extract_evidence_items_vectorized(s_data, 'Writing_Sample_Link'))[cite: 1]
                s_lp = len(extract_evidence_items_vectorized(s_data, 'Lesson_Plan_Picture'))[cite: 1]
                s_vn = len(extract_evidence_items_vectorized(s_data, 'Voice_Note_Link'))[cite: 1]
                s_ph = len(extract_evidence_items_vectorized(s_data, 'Phonics_Evidence_Link'))[cite: 1]
                s_pf = len(extract_evidence_items_vectorized(s_data, 'Portfolio_Evidence_Link'))[cite: 1]

                qual_agg.append({[cite: 1]
                    'Institution': s_name,[cite: 1]
                    'Activity_Videos': s_vids,[cite: 1]
                    'Writing_Samples': s_w,[cite: 1]
                    'LP_Audio_Submissions': s_lp + s_vn,[cite: 1]
                    'Phonics_Evidences': s_ph,[cite: 1]
                    'Portfolio_Artifacts': s_pf[cite: 1]
                })
            
            qual_df_school = pd.DataFrame(qual_agg)[cite: 1]
            school_stats = school_stats.merge(qual_df_school, on='Institution', how='left').fillna(0)[cite: 1]

            def classify_school(row):
                if not enable_quant_kpi_t5:
                    return 'Active Portfolio'
                ld_ok = row['Avg_Lesson_Prep_Mins'] >= daily_ld_target_t5
                lib_ok = row['Avg_Library_Usage_Mins'] >= daily_lib_target_t5
                qual_ok = True
                if enable_qual_kpi_t5:
                    qual_ok = (row['Activity_Videos'] >= target_vid_count_t5) or (row['Writing_Samples'] >= target_writing_count_t5)

                if ld_ok and lib_ok and qual_ok:
                    return '🌟 Pace Setters'[cite: 1]
                elif ld_ok and not lib_ok:
                    return '📘 Lesson Focused'[cite: 1]
                elif not ld_ok and lib_ok:
                    return '📚 Library Focused'[cite: 1]
                else:
                    return '🚨 Priority Focus'[cite: 1]

            school_stats['Classification'] = school_stats.apply(classify_school, axis=1)[cite: 1]

            st.subheader("🖼️ 2x2 Portfolio Classification Matrix")[cite: 1]
            
            pace_setters = school_stats[school_stats['Classification'] == '🌟 Pace Setters']['Institution'].tolist()[cite: 1]
            lesson_focused = school_stats[school_stats['Classification'] == '📘 Lesson Focused']['Institution'].tolist()[cite: 1]
            library_focused = school_stats[school_stats['Classification'] == '📚 Library Focused']['Institution'].tolist()[cite: 1]
            priority_focus = school_stats[school_stats['Classification'] == '🚨 Priority Focus']['Institution'].tolist()[cite: 1]

            col_top1, col_top2 = st.columns(2)[cite: 1]
            with col_top1:[cite: 1]
                st.success(f"🌟 **Pace Setters ({len(pace_setters)} Schools)**\n\n*Met Standards*\n\n" + (", ".join(pace_setters) if pace_setters else "None"))[cite: 1]
            with col_top2:[cite: 1]
                st.info(f"📘 **Lesson Focused ({len(lesson_focused)} Schools)**\n\n" + (", ".join(lesson_focused) if lesson_focused else "None"))[cite: 1]

            col_bot1, col_bot2 = st.columns(2)[cite: 1]
            with col_bot1:[cite: 1]
                st.warning(f"📚 **Library Focused ({len(library_focused)} Schools)**\n\n" + (", ".join(library_focused) if library_focused else "None"))[cite: 1]
            with col_bot2:[cite: 1]
                st.error(f"🚨 **Priority Focus ({len(priority_focus)} Schools)**\n\n" + (", ".join(priority_focus) if priority_focus else "None"))[cite: 1]

            display_school_stats = school_stats if t5_class_filter == "All Classifications" else school_stats[school_stats['Classification'] == t5_class_filter][cite: 1]

            st.subheader("📋 Complete School Performance Leaderboard")[cite: 1]
            display_qtable = display_school_stats[['Institution', 'Roster_Teachers', 'Avg_Lesson_Prep_Mins', 'Avg_Library_Usage_Mins', 'LP_Audio_Submissions', 'Activity_Videos', 'Writing_Samples', 'Phonics_Evidences', 'Portfolio_Artifacts', 'Classification']].rename(columns={[cite: 1]
                'Institution': 'School Name', 'Roster_Teachers': 'Active Teachers', 'Avg_Lesson_Prep_Mins': 'Prep (m/day)', 'Avg_Library_Usage_Mins': 'Library (m/day)', 'LP_Audio_Submissions': 'LP/Audio Notes', 'Activity_Videos': 'Activity Videos', 'Writing_Samples': 'Writing Samples', 'Phonics_Evidences': 'Phonics Uploads', 'Portfolio_Artifacts': 'Portfolio Uploads'[cite: 1]
            })
            st.dataframe(display_qtable, use_container_width=True)[cite: 1]

            col_t5_d1, col_t5_d2 = st.columns(2)[cite: 1]
            with col_t5_d1:[cite: 1]
                if st.button("⚙️ Compile Portfolio Overview PDF", key="prep_pdf_tab5_btn"):[cite: 1]
                    with st.spinner("Compiling Portfolio PDF..."):[cite: 1]
                        pdf_t5 = generate_pdf_report([cite: 1]
                            title_text="🏛️ Academic Manager Portfolio Review",[cite: 1]
                            subtitle_text=f"Portfolio Performance Leaderboard ({selected_num_days} Working Days)",[cite: 1]
                            school_name="Multiple Portfolio Schools",[cite: 1]
                            summary_metrics={"Total Schools": len(display_school_stats), "Pace Setters": len(pace_setters), "Priority Focus": len(priority_focus)},[cite: 1]
                            dataframe=display_qtable[cite: 1]
                        ).getvalue()
                        st.session_state["tab5_pdf_ready"] = pdf_t5[cite: 1]

                if "tab5_pdf_ready" in st.session_state:[cite: 1]
                    st.download_button("📄 Download Portfolio Overview Report (PDF)", data=st.session_state["tab5_pdf_ready"], file_name=f"Manager_Portfolio_Overview_{selected_month.replace(' ', '_')}.pdf", mime="application/pdf", key="btn_pdf_tab5")[cite: 1]

            with col_t5_d2:[cite: 1]
                if st.button("⚙️ Prepare Portfolio Leaderboard Excel", key="prep_xlsx_tab5_btn"):[cite: 1]
                    buf_t5_xlsx = BytesIO()[cite: 1]
                    with pd.ExcelWriter(buf_t5_xlsx, engine='openpyxl') as writer:[cite: 1]
                        display_qtable.to_excel(writer, index=False, sheet_name='Portfolio_Leaderboard')[cite: 1]
                    st.session_state["tab5_xlsx_ready"] = buf_t5_xlsx.getvalue()[cite: 1]

                if "tab5_xlsx_ready" in st.session_state:[cite: 1]
                    st.download_button("📥 Download Portfolio Leaderboard (Excel)", data=st.session_state["tab5_xlsx_ready"], file_name=f"Portfolio_Leaderboard_{selected_month.replace(' ', '_')}.xlsx", mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", key="btn_xlsx_tab5")[cite: 1]

    # TAB 6: SCHOOL-LEVEL TEACHER PROGRESSION & EXECUTION TIERS
    with tab6:
        st.header("🏫 School-Level Teacher Progression & Execution Tiers")[cite: 1]
        
        with st.expander("🎯 Progression Target Benchmark Settings", expanded=False):
            t6_kcol1, t6_kcol2 = st.columns(2)
            with t6_kcol1:
                daily_ld_target_t6 = st.number_input("Lesson Prep Target (Mins/Day)", min_value=0.0, max_value=60.0, value=10.0, step=5.0, key="t6_ld_target")
            with t6_kcol2:
                daily_lib_target_t6 = st.number_input("Library Usage Target (Mins/Day)", min_value=0.0, max_value=120.0, value=30.0, step=5.0, key="t6_lib_target")

        calc_ld_kpi_t6 = daily_ld_target_t6 * selected_num_days
        calc_lib_kpi_t6 = daily_lib_target_t6 * selected_num_days

        all_schools_list_t6 = sorted(school_master_roster['Institution'].unique())[cite: 1]
        
        if not all_schools_list_t6:[cite: 1]
            st.info("No schools found in roster.")[cite: 1]
        else:
            t6_col_f1, t6_col_f2 = st.columns(2)[cite: 1]
            with t6_col_f1:[cite: 1]
                target_school_t6 = st.selectbox("Select School to Inspect:", options=all_schools_list_t6, key="t6_school_sel")[cite: 1]
                
            school_t6_roster = school_master_roster[school_master_roster['Institution'] == target_school_t6][cite: 1]
            school_t6_data = school_filtered_df[school_filtered_df['Institution'] == target_school_t6][cite: 1]

            t6_ld = school_t6_data[school_t6_data['Standard_Type'] == 'lessonDelivery'].groupby('FullName')['Duration_Min'].sum().reset_index()
            t6_lib = school_t6_data[school_t6_data['Standard_Type'] == 'library'].groupby('FullName')['Duration_Min'].sum().reset_index()

            t6_teachers = school_t6_roster.merge(t6_ld.rename(columns={'Duration_Min': 'Lesson_Mins'}), on='FullName', how='left').fillna(0.0)[cite: 1]
            t6_teachers = t6_teachers.merge(t6_lib.rename(columns={'Duration_Min': 'Library_Mins'}), on='FullName', how='left').fillna(0.0)[cite: 1]

            def tier_teacher(row):
                ld_pct = (row['Lesson_Mins'] / calc_ld_kpi_t6) if calc_ld_kpi_t6 > 0 else 1.0
                lib_pct = (row['Library_Mins'] / calc_lib_kpi_t6) if calc_lib_kpi_t6 > 0 else 1.0
                if ld_pct >= 1.0 and lib_pct >= 1.0:
                    return '🌟 Consistent Achiever (>= 100%)'[cite: 1]
                elif ld_pct < 0.40 and lib_pct < 0.40:
                    return '❌ Persistent Inactive (< 40%)'[cite: 1]
                else:
                    return '⚠️ Fluctuating / Partial (40%-99%)'[cite: 1]

            t6_teachers['Execution_Tier'] = t6_teachers.apply(tier_teacher, axis=1)[cite: 1]

            with t6_col_f2:[cite: 1]
                t6_tier_filter = st.selectbox("Filter by Execution Tier:", ["All Tiers", "🌟 Consistent Achiever (>= 100%)", "⚠️ Fluctuating / Partial (40%-99%)", "❌ Persistent Inactive (< 40%)"], key="t6_tier_filter")[cite: 1]

            if t6_tier_filter != "All Tiers":[cite: 1]
                t6_teachers_filtered = t6_teachers[t6_teachers['Execution_Tier'] == t6_tier_filter][cite: 1]
            else:
                t6_teachers_filtered = t6_teachers[cite: 1]

            st.markdown(f"### 🏫 School Audit: **{target_school_t6}** | Active Roster: **{len(school_t6_roster)} Teachers**")[cite: 1]

            e1, e2, e3 = st.columns(3)[cite: 1]
            num_ach = len(t6_teachers[t6_teachers['Execution_Tier'].str.startswith('🌟')])[cite: 1]
            num_fluc = len(t6_teachers[t6_teachers['Execution_Tier'].str.startswith('⚠️')])[cite: 1]
            num_inact = len(t6_teachers[t6_teachers['Execution_Tier'].str.startswith('❌')])[cite: 1]

            e1.metric("🌟 Consistent Achievers", num_ach)[cite: 1]
            e2.metric("⚠️ Fluctuating / Partial", num_fluc)[cite: 1]
            e3.metric("❌ Persistent Inactive", num_inact)[cite: 1]

            fig_t6_bar = px.bar([cite: 1]
                t6_teachers_filtered, x="FullName", y=["Lesson_Mins", "Library_Mins"],[cite: 1]
                title=f"Teacher Usage Breakdown for {target_school_t6} (Mins)",[cite: 1]
                labels={"FullName": "Teacher Name", "value": "Logged Minutes", "variable": "Feature"},[cite: 1]
                barmode="group", text_auto=".1f"[cite: 1]
            )
            st.plotly_chart(fig_t6_bar, use_container_width=True)[cite: 1]

            display_t6_table = t6_teachers_filtered.rename(columns={'FullName': 'Teacher Name', 'Lesson_Mins': 'Lesson Prep (m)', 'Library_Mins': 'Library Usage (m)', 'Execution_Tier': 'Execution Tier'})[cite: 1]
            st.dataframe(display_t6_table, use_container_width=True)[cite: 1]

    # TAB 7: LIVE EVIDENCE SUBMISSIONS FEED & QUALITATIVE TRACKER
    with tab7:
        st.header("📬 Live Evidence Submissions Feed & Qualitative Performance Indicator Tracker")[cite: 1]
        
        with st.expander("🎯 Qualitative Artifact Threshold Controls", expanded=False):
            t7_kcol1, t7_kcol2 = st.columns(2)
            with t7_kcol1:
                target_vid_count_t7 = st.number_input("Min. Activity Videos", min_value=1, max_value=20, value=3, step=1, key="t7_vid_cnt")
                target_writing_count_t7 = st.number_input("Min. Writing Samples", min_value=1, max_value=20, value=3, step=1, key="t7_writing_cnt")
            with t7_kcol2:
                target_phonics_count_t7 = st.number_input("Min. Phonics Submissions", min_value=1, max_value=20, value=2, step=1, key="t7_ph_cnt")
                target_portfolio_count_t7 = st.number_input("Min. Portfolio Artifacts", min_value=1, max_value=20, value=1, step=1, key="t7_pf_cnt")

        evidence_cols = ['Voice_Note_Link', 'Lesson_Plan_Picture', 'Video_Evidence_1', 'Video_Evidence_2', 'Video_Evidence_3', 'Writing_Sample_Link', 'Phonics_Evidence_Link', 'Portfolio_Evidence_Link'][cite: 1]
        avail_ev_cols = [c for c in evidence_cols if c in filtered_df.columns][cite: 1]

        if not filtered_df.empty and avail_ev_cols:[cite: 1]
            url_mask = pd.concat([
                filtered_df[c].fillna('').astype(str).str.strip().str.contains(r'https?://|drive\.google|supabase\.co', case=False, na=False)
                for c in avail_ev_cols
            ], axis=1).any(axis=1)
            all_submissions_df = filtered_df[url_mask].copy()
        else:
            all_submissions_df = pd.DataFrame()[cite: 1]

        if all_submissions_df.empty:[cite: 1]
            st.info("No teacher evidence submissions match the currently selected global filter criteria.")[cite: 1]
        else:
            col_t7_f1, col_t7_f2, col_t7_f3 = st.columns(3)[cite: 1]
            with col_t7_f1:[cite: 1]
                t7_schools = ["All Schools"] + sorted([s for s in all_submissions_df['Institution'].unique() if str(s).strip()])[cite: 1]
                t7_selected_school = st.selectbox("Filter by School:", t7_schools, key="t7_school")[cite: 1]
            
            t7_filtered = all_submissions_df if t7_selected_school == "All Schools" else all_submissions_df[all_submissions_df['Institution'] == t7_selected_school][cite: 1]

            with col_t7_f2:[cite: 1]
                t7_teachers = ["All Teachers"] + sorted([t for t in t7_filtered['FullName'].unique() if str(t).strip()])[cite: 1]
                t7_selected_teacher = st.selectbox("Filter by Teacher:", t7_teachers, key="t7_teacher")[cite: 1]

            if t7_selected_teacher != "All Teachers":[cite: 1]
                t7_filtered = t7_filtered[t7_filtered['FullName'] == t7_selected_teacher][cite: 1]

            with col_t7_f3:[cite: 1]
                t7_grades = ["All Grades"] + sorted([g for g in t7_filtered['Grade'].unique() if str(g).strip()])[cite: 1]
                t7_selected_grade = st.selectbox("Filter by Grade:", t7_grades, key="t7_grade")[cite: 1]

            if t7_selected_grade != "All Grades":[cite: 1]
                t7_filtered = t7_filtered[t7_filtered['Grade'] == t7_selected_grade][cite: 1]

            st.markdown("---")[cite: 1]
            tot_subs = len(t7_filtered)[cite: 1]
            st.metric("📋 Total Submissions Found", tot_subs)[cite: 1]

            t7_display_cols = ['StartTime', 'Institution', 'FullName', 'Grade', 'Subject', 'Book', 'Phonics_Evidence_Link', 'Portfolio_Evidence_Link', 'Voice_Note_Link', 'Lesson_Plan_Picture', 'Video_Evidence_1', 'Writing_Sample_Link'][cite: 1]
            t7_avail = [c for c in t7_display_cols if c in t7_filtered.columns][cite: 1]
            
            t7_table = t7_filtered[t7_avail].sort_values(by='StartTime', ascending=False)[cite: 1]
            st.dataframe(t7_table, use_container_width=True)[cite: 1]
