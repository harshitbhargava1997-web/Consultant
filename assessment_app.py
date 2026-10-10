
"""
Foundational Literacy Assessment Application

Standalone Streamlit entry point.
Includes:
- Supabase Authentication
- Platform Super Admin
- School-based assessments
- Student competency assessments
- Teacher competency assessments
- Progress reports
"""

import streamlit as st

from assessment_module import render_assessment_module


st.set_page_config(
    page_title="Foundational Literacy Assessment",
    page_icon="📚",
    layout="wide",
    initial_sidebar_state="expanded",
)

render_assessment_module()
