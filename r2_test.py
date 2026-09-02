import streamlit as st

st.title("🔍 Streamlit Secrets Diagnostic")

st.write("Top-level secrets detected by this app:")

for key in st.secrets.keys():
    st.write(f"• `{key}`")

st.divider()

if "r2" in st.secrets:
    st.success("✅ R2 section FOUND")

    st.write("R2 keys detected:")

    for key in st.secrets["r2"].keys():
        st.write(f"• `r2.{key}`")

else:
    st.error("❌ R2 section NOT FOUND")

st.write("---")
st.write("Expected structure:")

st.code("""
[connections]
...

[supabase]
...

[gemini]
...

[r2]
account_id = "..."
access_key_id = "..."
secret_access_key = "..."
bucket_name = "..."
endpoint_url = "..."
""")
