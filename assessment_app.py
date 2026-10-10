"""Standalone literacy assessment application for a test Streamlit deployment."""
import streamlit as st
from assessment_module import render_assessment_module
st.set_page_config(page_title="Literacy Assessments",page_icon="📚",layout="wide")
render_assessment_module()
