import streamlit as st
import boto3
from botocore.exceptions import ClientError, BotoCoreError

st.set_page_config(
    page_title="R2 Storage Test",
    page_icon="☁️",
    layout="centered"
)

st.title("☁️ Cloudflare R2 Storage Test")
st.write("This page checks the R2 configuration and tests a file upload.")


# =========================================================
# 1. CHECK STREAMLIT SECRETS
# =========================================================

st.subheader("1️⃣ Checking Streamlit Secrets")

required_keys = [
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET_NAME",
    "R2_ENDPOINT_URL",
]

available_keys = list(st.secrets.keys())

st.write("Secret names available to this app:")

for key in available_keys:
    st.write(f"• `{key}`")


missing_keys = [
    key for key in required_keys
    if key not in st.secrets
]


if missing_keys:

    st.error("❌ Some required R2 secrets are missing.")

    st.write("Missing secret names:")

    for key in missing_keys:
        st.write(f"❌ `{key}`")

    st.info(
        "Go to Streamlit Cloud → Manage App → Settings → Secrets "
        "and check the exact spelling of the missing keys."
    )

    st.stop()


st.success("✅ All required R2 secret names are present.")


# =========================================================
# 2. READ R2 CONFIGURATION
# =========================================================

account_id = st.secrets["R2_ACCOUNT_ID"]
access_key_id = st.secrets["R2_ACCESS_KEY_ID"]
secret_access_key = st.secrets["R2_SECRET_ACCESS_KEY"]
bucket_name = st.secrets["R2_BUCKET_NAME"]
endpoint_url = st.secrets["R2_ENDPOINT_URL"]


# Don't display the actual credentials.
st.write("**Bucket:**", bucket_name)
st.write("**Endpoint:**", endpoint_url)
st.write("**Account ID:**", f"{account_id[:6]}...{account_id[-4:]}")


# =========================================================
# 3. CONNECT TO R2
# =========================================================

st.subheader("2️⃣ Testing R2 Connection")

try:

    r2 = boto3.client(
        "s3",
        endpoint_url=endpoint_url,
        aws_access_key_id=access_key_id,
        aws_secret_access_key=secret_access_key,
        region_name="auto",
    )

    st.success("✅ R2 client created successfully.")

except Exception as e:

    st.error("❌ Could not create the R2 connection.")

    st.code(str(e))

    st.stop()


# =========================================================
# 4. TEST BUCKET ACCESS
# =========================================================

st.subheader("3️⃣ Testing Bucket Access")

if st.button("🔍 Test R2 Bucket"):

    try:

        response = r2.list_objects_v2(
            Bucket=bucket_name,
            MaxKeys=5
        )

        st.success("🎉 R2 bucket access is working!")

        objects = response.get("Contents", [])

        if objects:

            st.write("Files currently in the bucket:")

            for obj in objects:
                st.write(
                    f"📄 {obj['Key']} "
                    f"({obj['Size']} bytes)"
                )

        else:

            st.info(
                "The bucket is accessible, but it is currently empty."
            )

    except ClientError as e:

        st.error("❌ R2 bucket access failed.")

        error = e.response.get("Error", {})

        st.write("**Error Code:**", error.get("Code"))
        st.write("**Message:**", error.get("Message"))

        st.code(str(e))

    except BotoCoreError as e:

        st.error("❌ Boto3/R2 error.")

        st.code(str(e))

    except Exception as e:

        st.error("❌ Unexpected error.")

        st.code(str(e))


# =========================================================
# 5. TEST FILE UPLOAD
# =========================================================

st.subheader("4️⃣ Test File Upload")

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

    st.write("### Selected File")

    st.write("**Name:**", uploaded_file.name)

    st.write(
        "**Size:**",
        f"{uploaded_file.size / 1024:.2f} KB"
    )

    st.write(
        "**Type:**",
        uploaded_file.type
    )

    if st.button("☁️ Upload Test File to R2"):

        try:

            # Keep test files separate from your real application files.
            file_key = f"test/{uploaded_file.name}"

            r2.upload_fileobj(
                uploaded_file,
                bucket_name,
                file_key,
                ExtraArgs={
                    "ContentType": uploaded_file.type
                }
            )

            st.success(
                "🎉 File uploaded successfully to Cloudflare R2!"
            )

            st.write("**Bucket:**", bucket_name)
            st.write("**R2 file path:**", file_key)

            st.info(
                "Now open Cloudflare → R2 → your bucket → test/ "
                "and confirm that the file is visible."
            )

        except ClientError as e:

            st.error("❌ File upload failed.")

            error = e.response.get("Error", {})

            st.write(
                "**Error Code:**",
                error.get("Code")
            )

            st.write(
                "**Message:**",
                error.get("Message")
            )

            st.code(str(e))

        except Exception as e:

            st.error("❌ Unexpected upload error.")

            st.code(str(e))
