import streamlit as st
import boto3
from botocore.exceptions import ClientError

st.set_page_config(page_title="R2 Storage Test")

st.title("☁️ Cloudflare R2 Storage Test")

st.write("Upload a small test file to verify the R2 connection.")

# Connect to Cloudflare R2
try:
    r2 = boto3.client(
        "s3",
        endpoint_url=st.secrets["R2_ENDPOINT_URL"],
        aws_access_key_id=st.secrets["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=st.secrets["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
    )

    bucket = st.secrets["R2_BUCKET_NAME"]

    st.success("✅ R2 connection configured successfully")

except Exception as e:
    st.error("❌ Could not connect to R2")
    st.code(str(e))
    st.stop()


# File uploader
uploaded_file = st.file_uploader(
    "Choose a small test file",
    type=["txt", "pdf", "jpg", "jpeg", "png", "mp3", "m4a", "mp4"]
)


# Upload
if uploaded_file is not None:

    st.write("**File:**", uploaded_file.name)
    st.write("**Size:**", f"{uploaded_file.size / 1024:.2f} KB")

    if st.button("☁️ Upload to R2"):

        try:
            file_key = f"test/{uploaded_file.name}"

            r2.upload_fileobj(
                uploaded_file,
                bucket,
                file_key,
                ExtraArgs={
                    "ContentType": uploaded_file.type
                }
            )

            st.success("🎉 File uploaded successfully to Cloudflare R2!")

            st.write("**Bucket:**", bucket)
            st.write("**R2 path:**", file_key)

        except ClientError as e:
            st.error("❌ Upload failed")
            st.code(str(e))

        except Exception as e:
            st.error("❌ Unexpected error")
            st.code(str(e))
