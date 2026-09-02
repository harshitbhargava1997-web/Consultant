import streamlit as st
import boto3
from botocore.exceptions import ClientError

st.set_page_config(
    page_title="Cloudflare R2 Test",
    page_icon="☁️"
)

st.title("☁️ Cloudflare R2 Storage Test")
st.write("Use this page to test uploading a file to Cloudflare R2.")


# ---------------------------------------------------------
# 1. CONNECT TO CLOUDFLARE R2
# ---------------------------------------------------------

try:
    r2 = boto3.client(
        "s3",
        endpoint_url=st.secrets["R2_ENDPOINT_URL"],
        aws_access_key_id=st.secrets["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=st.secrets["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
    )

    bucket_name = st.secrets["R2_BUCKET_NAME"]

    st.success("✅ R2 credentials loaded successfully")

except Exception as e:
    st.error("❌ R2 configuration error")
    st.code(str(e))
    st.stop()


# ---------------------------------------------------------
# 2. TEST FILE UPLOAD
# ---------------------------------------------------------

uploaded_file = st.file_uploader(
    "Choose a small test file",
    type=[
        "txt",
        "pdf",
        "jpg",
        "jpeg",
        "png",
        "mp3",
        "m4a",
        "mp4"
    ]
)


if uploaded_file is not None:

    st.write("### File Details")
    st.write(f"**Name:** {uploaded_file.name}")
    st.write(f"**Size:** {uploaded_file.size / 1024:.2f} KB")
    st.write(f"**Type:** {uploaded_file.type}")

    if st.button("☁️ Upload to R2"):

        try:

            # Store test files inside a test folder
            file_key = f"test/{uploaded_file.name}"

            r2.upload_fileobj(
                uploaded_file,
                bucket_name,
                file_key,
                ExtraArgs={
                    "ContentType": uploaded_file.type
                }
            )

            st.success("🎉 File uploaded successfully to Cloudflare R2!")

            st.write(f"**Bucket:** `{bucket_name}`")
            st.write(f"**R2 Path:** `{file_key}`")

        except ClientError as e:

            st.error("❌ R2 upload failed")
            st.code(str(e))

        except Exception as e:

            st.error("❌ Unexpected error")
            st.code(str(e))
