import streamlit as st
import boto3
from botocore.exceptions import ClientError, BotoCoreError

# ---------------------------------------------------------
# PAGE CONFIGURATION
# ---------------------------------------------------------

st.set_page_config(
    page_title="Cloudflare R2 Test",
    page_icon="☁️",
    layout="centered"
)

st.title("☁️ Cloudflare R2 Storage Test")
st.write("This page checks the R2 configuration, connection, bucket access, and file upload.")


# ---------------------------------------------------------
# 1. CHECK STREAMLIT SECRETS
# ---------------------------------------------------------

st.subheader("1️⃣ Checking Streamlit Secrets")

# Check whether the [r2] section exists
if "r2" not in st.secrets:
    st.error("❌ R2 section not found in Streamlit Secrets.")
    
    st.write("Top-level secrets currently detected:")

    for key in st.secrets.keys():
        st.write(f"• `{key}`")

    st.info(
        "Please check Streamlit Cloud → Settings → Secrets "
        "and make sure the [r2] section has been added and saved."
    )

    st.stop()


st.success("✅ `[r2]` section found.")


# ---------------------------------------------------------
# 2. CHECK R2 SECRET NAMES
# ---------------------------------------------------------

r2_secrets = st.secrets["r2"]

required_keys = [
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET_NAME",
    "R2_ENDPOINT_URL",
]

st.write("R2 secret names detected:")

for key in r2_secrets.keys():
    st.write(f"• `{key}`")


missing_keys = [
    key for key in required_keys
    if key not in r2_secrets
]


if missing_keys:
    st.error("❌ Some R2 secret names are missing.")

    st.write("Missing:")

    for key in missing_keys:
        st.write(f"❌ `{key}`")

    st.info(
        "Make sure the spelling and capital letters exactly match the code."
    )

    st.stop()


st.success("✅ All five R2 secret names are present.")


# ---------------------------------------------------------
# 3. READ R2 CONFIGURATION
# ---------------------------------------------------------

R2_ACCOUNT_ID = r2_secrets["R2_ACCOUNT_ID"]
R2_ACCESS_KEY_ID = r2_secrets["R2_ACCESS_KEY_ID"]
R2_SECRET_ACCESS_KEY = r2_secrets["R2_SECRET_ACCESS_KEY"]
R2_BUCKET_NAME = r2_secrets["R2_BUCKET_NAME"]
R2_ENDPOINT_URL = r2_secrets["R2_ENDPOINT_URL"]


# ---------------------------------------------------------
# 4. DISPLAY SAFE INFORMATION
# ---------------------------------------------------------

st.subheader("2️⃣ R2 Configuration")

st.write("**Bucket Name:**", R2_BUCKET_NAME)
st.write("**Endpoint URL:**", R2_ENDPOINT_URL)

# Only show a masked Account ID
if len(R2_ACCOUNT_ID) > 10:
    masked_account_id = (
        R2_ACCOUNT_ID[:6]
        + "..."
        + R2_ACCOUNT_ID[-4:]
    )
else:
    masked_account_id = "********"

st.write("**Account ID:**", masked_account_id)

# Never display Access Key or Secret Access Key
st.write("**Access Key:** ✅ Loaded")
st.write("**Secret Access Key:** ✅ Loaded")


# ---------------------------------------------------------
# 5. CREATE R2 CLIENT
# ---------------------------------------------------------

st.subheader("3️⃣ Testing R2 Connection")

try:

    r2 = boto3.client(
        "s3",
        endpoint_url=R2_ENDPOINT_URL,
        aws_access_key_id=R2_ACCESS_KEY_ID,
        aws_secret_access_key=R2_SECRET_ACCESS_KEY,
        region_name="auto",
    )

    st.success("✅ R2 client created successfully.")

except Exception as e:

    st.error("❌ Could not create the R2 connection.")

    st.code(str(e))

    st.stop()


# ---------------------------------------------------------
# 6. TEST BUCKET ACCESS
# ---------------------------------------------------------

st.subheader("4️⃣ Testing Bucket Access")

if st.button("🔍 Test R2 Bucket"):

    try:

        response = r2.list_objects_v2(
            Bucket=R2_BUCKET_NAME,
            MaxKeys=10
        )

        st.success("🎉 R2 bucket access is working!")

        objects = response.get("Contents", [])

        if objects:

            st.write("### Files currently in the bucket")

            for obj in objects:

                file_name = obj["Key"]
                file_size = obj["Size"]

                st.write(
                    f"📄 `{file_name}` — "
                    f"{file_size / 1024:.2f} KB"
                )

        else:

            st.info(
                "The bucket is accessible, but it is currently empty."
            )

    except ClientError as e:

        st.error("❌ R2 bucket access failed.")

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

    except BotoCoreError as e:

        st.error("❌ Boto3/R2 error.")

        st.code(str(e))

    except Exception as e:

        st.error("❌ Unexpected error.")

        st.code(str(e))


# ---------------------------------------------------------
# 7. TEST FILE UPLOAD
# ---------------------------------------------------------

st.subheader("5️⃣ Test File Upload")

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

            # Test files will be stored inside the test/ folder
            file_key = f"test/{uploaded_file.name}"


            r2.upload_fileobj(
                uploaded_file,
                R2_BUCKET_NAME,
                file_key,
                ExtraArgs={
                    "ContentType": uploaded_file.type
                }
            )


            st.success(
                "🎉 File uploaded successfully to Cloudflare R2!"
            )

            st.write("**Bucket:**", R2_BUCKET_NAME)

            st.write("**R2 File Path:**", file_key)

            st.info(
                "Open Cloudflare → R2 → your bucket → test/ "
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


        except BotoCoreError as e:

            st.error("❌ Boto3/R2 error.")

            st.code(str(e))


        except Exception as e:

            st.error("❌ Unexpected upload error.")

            st.code(str(e))
