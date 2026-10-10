
import streamlit as st

from assessment_module import render_assessment_module

st.set_page_config(
    page_title="Foundational Literacy Assessment",
    page_icon="📚",
    layout="wide",
)

render_assessment_module()
