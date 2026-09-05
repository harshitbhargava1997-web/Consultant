import streamlit as st
import pandas as pd
import re
import uuid
import concurrent.futures
from supabase import create_client
import boto3
from boto3.s3.transfer import TransferConfig


# ============================================================
# PAGE CONFIG
# ============================================================

st.set_page_config(
    page_title="Teacher Daily Implementation Reflection Portal",
    page_icon="📝",
    layout="centered"
)


# ============================================================
# CONSTANTS
# ============================================================

MAX_FILE_SIZE_MB = 50
MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024

MAX_PARALLEL_UPLOADS = 5

R2_MULTIPART_THRESHOLD = 8 * 1024 * 1024
R2_MULTIPART_CHUNK_SIZE = 8 * 1024 * 1024

MAX_IMPLEMENTATION_GROUPS = 10

TEACHER_RECORDS_TABLE = "teacher_records"


GRADE_OPTIONS = [
    "Nursery",
    "LKG",
    "UKG",
    "Grade 1",
    "Grade 2",
    "Grade 3",
    "Grade 4",
    "Grade 5"
]


SUBJECT_OPTIONS = [
    "All Subjects Together",
    "Phonics / Literacy",
    "Mathematics",
    "Numeracy",
    "English",
    "Hindi",
    "Environmental Studies (EVS)",
    "Science",
    "General Knowledge (GK)",
    "English Grammar",
    "Computer",
    "Play Activity",
    "Play Time",
    "Play Based"
]


IMPLEMENTATION_MATERIAL_OPTIONS = [
    "Lesson Plan",
    "Classroom Activity Conducted",
    "Student Written Work / Writing Practice",
    "Phonics / Phonetics Implementation",
    "Student Assessment",
    "Teacher Portfolio"
]


# ============================================================
# SESSION STATE
# ============================================================

if "implementation_group_count" not in st.session_state:
    st.session_state.implementation_group_count = 1


# ============================================================
# SUPABASE CONNECTION
# ============================================================

@st.cache_resource
def get_supabase_client():
    supabase_url = st.secrets["supabase"]["url"]
    supabase_key = st.secrets["supabase"]["key"]

    return create_client(
        supabase_url,
        supabase_key
    )


supabase = get_supabase_client()


# ============================================================
# CLOUDFLARE R2 CONNECTION
# ============================================================

@st.cache_resource
def get_r2_client():

    r2_secrets = st.secrets["r2"]

    R2_ACCOUNT_ID = r2_secrets["R2_ACCOUNT_ID"]
    R2_ACCESS_KEY_ID = r2_secrets["R2_ACCESS_KEY_ID"]
    R2_SECRET_ACCESS_KEY = r2_secrets["R2_SECRET_ACCESS_KEY"]
    R2_BUCKET_NAME = r2_secrets["R2_BUCKET_NAME"]
    R2_ENDPOINT_URL = r2_secrets["R2_ENDPOINT_URL"]

    client = boto3.client(
        "s3",
        endpoint_url=R2_ENDPOINT_URL,
        aws_access_key_id=R2_ACCESS_KEY_ID,
        aws_secret_access_key=R2_SECRET_ACCESS_KEY,
        region_name="auto"
    )

    return client, R2_BUCKET_NAME


r2_client, R2_BUCKET_NAME = get_r2_client()


R2_TRANSFER_CONFIG = TransferConfig(
    multipart_threshold=R2_MULTIPART_THRESHOLD,
    multipart_chunksize=R2_MULTIPART_CHUNK_SIZE,
    max_concurrency=5,
    use_threads=True
)


# ============================================================
# HELPERS
# ============================================================

def sanitize_path_component(value):
    """
    Makes school / teacher / filename safe for R2 object paths.
    """

    if value is None:
        return "unknown"

    value = str(value).strip()

    value = re.sub(
        r"\s+",
        "_",
        value
    )

    value = re.sub(
        r"[^A-Za-z0-9._-]",
        "_",
        value
    )

    return value[:150]


def get_file_size_mb(uploaded_file):

    if uploaded_file is None:
        return 0

    try:
        return uploaded_file.size / (1024 * 1024)
    except Exception:
        return 0


def split_teacher_name(full_name):

    if not full_name:
        return "", ""

    parts = str(full_name).strip().split()

    if len(parts) == 1:
        return parts[0], ""

    return parts[0], " ".join(parts[1:])


def safe_widget_key(prefix, group_number, unique_id=""):

    return (
        f"{prefix}_"
        f"{group_number}_"
        f"{unique_id}"
    )


# ============================================================
# FETCH MASTER ROSTER
# ============================================================

@st.cache_data(ttl=300)
def fetch_master_db_from_supabase():

    rows = []

    start = 0
    page_size = 1000

    select_columns = (
        "State_Zone,"
        "Uploaded_By,"
        "Institution,"
        "FullName,"
        "Role"
    )

    while True:

        response = (
            supabase
            .table(TEACHER_RECORDS_TABLE)
            .select(select_columns)
            .range(start, start + page_size - 1)
            .execute()
        )

        batch = response.data or []

        if not batch:
            break

        rows.extend(batch)

        if len(batch) < page_size:
            break

        start += page_size

    if not rows:
        return pd.DataFrame(
            columns=[
                "State_Zone",
                "Uploaded_By",
                "Institution",
                "FullName",
                "Role"
            ]
        )

    df = pd.DataFrame(rows)

    for column in [
        "State_Zone",
        "Uploaded_By",
        "Institution",
        "FullName",
        "Role"
    ]:
        if column in df.columns:
            df[column] = (
                df[column]
                .fillna("")
                .astype(str)
                .str.strip()
            )

    df = df.drop_duplicates()

    return df


# ============================================================
# R2 UPLOAD
# ============================================================

def upload_file_to_r2(
    uploaded_file,
    folder_name,
    category,
    group_number
):

    if uploaded_file is None:
        return {
            "success": False,
            "file_name": "",
            "category": category,
            "group_number": group_number,
            "path": "",
            "error": "No file provided."
        }

    try:

        file_size = get_file_size_mb(uploaded_file)

        if file_size > MAX_FILE_SIZE_MB:

            return {
                "success": False,
                "file_name": uploaded_file.name,
                "category": category,
                "group_number": group_number,
                "path": "",
                "error": (
                    f"{uploaded_file.name} is "
                    f"{file_size:.1f} MB. "
                    f"Maximum allowed size is "
                    f"{MAX_FILE_SIZE_MB} MB."
                )
            }

        original_name = uploaded_file.name

        safe_name = sanitize_path_component(
            original_name
        )

        unique_prefix = uuid.uuid4().hex[:12]

        final_filename = (
            f"{unique_prefix}_{safe_name}"
        )

        object_key = (
            f"{folder_name}/"
            f"{final_filename}"
        )

        uploaded_file.seek(0)

        content_type = (
            getattr(uploaded_file, "type", None)
            or "application/octet-stream"
        )

        r2_client.upload_fileobj(
            uploaded_file,
            R2_BUCKET_NAME,
            object_key,
            ExtraArgs={
                "ContentType": content_type
            },
            Config=R2_TRANSFER_CONFIG
        )

        return {
            "success": True,
            "file_name": original_name,
            "category": category,
            "group_number": group_number,
            "path": object_key,
            "error": ""
        }

    except Exception as e:

        return {
            "success": False,
            "file_name": getattr(
                uploaded_file,
                "name",
                "unknown"
            ),
            "category": category,
            "group_number": group_number,
            "path": "",
            "error": str(e)
        }


# ============================================================
# PARALLEL UPLOADS
# ============================================================

def upload_all_files_parallel(upload_jobs):

    if not upload_jobs:
        return []

    results = []

    with concurrent.futures.ThreadPoolExecutor(
        max_workers=MAX_PARALLEL_UPLOADS
    ) as executor:

        futures = [
            executor.submit(
                upload_file_to_r2,
                uploaded_file,
                folder_name,
                category,
                group_number
            )
            for (
                uploaded_file,
                folder_name,
                category,
                group_number
            ) in upload_jobs
        ]

        for future in concurrent.futures.as_completed(
            futures
        ):
            results.append(
                future.result()
            )

    return results


# ============================================================
# DATABASE INSERT
# ============================================================

def insert_implementation_to_db(entry):

    response = (
        supabase
        .table(TEACHER_RECORDS_TABLE)
        .insert(entry)
        .execute()
    )

    return response


# ============================================================
# TOP HEADER
# ============================================================

st.title(
    "📝 Teacher Daily Implementation Reflection Portal"
)

st.markdown(
    """
Use this space to share your daily lesson implementation
through a short voice reflection and relevant classroom
implementation materials.
"""
)


st.info(
    """
🎙️ **How to share your reflection**

Record a short voice note before or after your lesson.
Use the voice note to briefly think through:

• **What** — Grade, Subject, Lesson Plan No. & Topic/Chapter  
• **Why** — Skill / Learning Objective  
• **Teacher Activity** — How will I teach and which resources will I use?  
• **Student Activity** — What will students do or participate in?  
• **Practice & Apply** — Course Book / Workbook practice and application  
• **Review** — How will I check students' learning?

The purpose is not only to tell what you are going to do,
but also to think about why you are doing it and how it will
support student learning.
"""
)


# ============================================================
# LOAD MASTER DATA
# ============================================================

try:

    master_df = fetch_master_db_from_supabase()

except Exception as e:

    st.error(
        "Unable to load teacher information from the database."
    )

    st.exception(e)

    st.stop()


if master_df.empty:

    st.warning(
        "No teacher data is currently available."
    )

    st.stop()


# ============================================================
# SCHOOL / TEACHER SELECTION
# ============================================================

st.subheader("👤 Teacher Details")


state_options = sorted(
    [
        x for x in
        master_df["State_Zone"].dropna().unique()
        if str(x).strip()
    ]
)


selected_state = st.selectbox(
    "State / Zone",
    options=["Select State / Zone"] + state_options,
    key="selected_state"
)


if selected_state == "Select State / Zone":

    st.stop()


state_df = master_df[
    master_df["State_Zone"] == selected_state
].copy()


consultant_options = sorted(
    [
        x for x in
        state_df["Uploaded_By"].dropna().unique()
        if str(x).strip()
    ]
)


selected_consultant = st.selectbox(
    "Consultant",
    options=["Select Consultant"] + consultant_options,
    key="selected_consultant"
)


if selected_consultant == "Select Consultant":

    st.stop()


consultant_df = state_df[
    state_df["Uploaded_By"] == selected_consultant
].copy()


school_options = sorted(
    [
        x for x in
        consultant_df["Institution"].dropna().unique()
        if str(x).strip()
    ]
)


selected_school = st.selectbox(
    "School",
    options=["Select School"] + school_options,
    key="selected_school"
)


if selected_school == "Select School":

    st.stop()


school_df = consultant_df[
    consultant_df["Institution"] == selected_school
].copy()


teacher_df = school_df[
    school_df["Role"]
    .str.lower()
    .isin(["teacher", "teachers"])
].copy()


teacher_options = sorted(
    [
        x for x in
        teacher_df["FullName"].dropna().unique()
        if str(x).strip()
    ]
)


selected_teacher = st.selectbox(
    "Teacher",
    options=["Select Teacher"] + teacher_options,
    key="selected_teacher"
)


if selected_teacher == "Select Teacher":

    st.stop()


selected_date = st.date_input(
    "Implementation Date",
    key="implementation_date"
)


# ============================================================
# IMPLEMENTATION GROUP STATE
# ============================================================

def initialize_group_state(group_number):

    state_key = f"implementation_group_{group_number}"

    if state_key not in st.session_state:

        st.session_state[state_key] = {
            "areas": [
                {
                    "id": uuid.uuid4().hex[:8],
                    "type": None
                }
            ]
        }


def add_material_area(group_number):

    initialize_group_state(group_number)

    st.session_state[
        f"implementation_group_{group_number}"
    ]["areas"].append(
        {
            "id": uuid.uuid4().hex[:8],
            "type": None
        }
    )


def remove_material_area(
    group_number,
    area_id
):

    initialize_group_state(group_number)

    areas = st.session_state[
        f"implementation_group_{group_number}"
    ]["areas"]

    if len(areas) <= 1:
        return

    st.session_state[
        f"implementation_group_{group_number}"
    ]["areas"] = [
        area for area in areas
        if area["id"] != area_id
    ]


# ============================================================
# RENDER IMPLEMENTATION GROUP
# ============================================================

def render_implementation_group(group_number):

    initialize_group_state(group_number)

    group_state_key = (
        f"implementation_group_{group_number}"
    )

    group_state = st.session_state[
        group_state_key
    ]

    st.markdown("---")

    st.subheader(
        f"Class / Implementation {group_number}"
    )


    # --------------------------------------------------------
    # BASIC LESSON INFORMATION
    # --------------------------------------------------------

    col1, col2 = st.columns(2)

    with col1:

        grade = st.selectbox(
            "Grade",
            GRADE_OPTIONS,
            key=f"grade_{group_number}"
        )

    with col2:

        subject = st.selectbox(
            "Subject",
            SUBJECT_OPTIONS,
            key=f"subject_{group_number}"
        )


    lesson_name = st.text_input(
        "Lesson Plan No. & Topic / Chapter",
        placeholder=(
            "Example: LP 12 – Plants Around Us"
        ),
        key=f"lesson_name_{group_number}"
    )


    # --------------------------------------------------------
    # VOICE REFLECTION
    # --------------------------------------------------------

    st.markdown(
        "### 🎙️ Voice Reflection"
    )

    st.caption(
        "Record your reflection or upload an existing voice note."
    )


    recorded_voice = st.audio_input(
        "🎙️ Record Your Reflection",
        sample_rate=16000,
        key=f"record_voice_{group_number}"
    )


    uploaded_voice = st.file_uploader(
        "Or Upload an Existing Voice Note",
        type=[
            "mp3",
            "wav",
            "m4a",
            "aac",
            "ogg",
            "mp4"
        ],
        accept_multiple_files=True,
        key=f"voice_upload_{group_number}"
    )


    # --------------------------------------------------------
    # CLASSROOM IMPLEMENTATION MATERIALS
    # --------------------------------------------------------

    st.markdown(
        "### 📚 Classroom Implementation & Learning Reflections"
    )

    st.caption(
        "Share materials such as lesson plans, classroom "
        "activities, student written work, phonics/phonetics "
        "implementation, student assessments, and teacher "
        "portfolio materials."
    )


    st.markdown(
        "#### Classroom Implementation Materials"
    )

    st.caption(
        "You can upload the relevant material completed "
        "for your classroom implementation."
    )


    uploaded_materials = []


    # --------------------------------------------------------
    # MATERIAL AREAS
    # --------------------------------------------------------

    for area_index, area in enumerate(
        group_state["areas"]
    ):

        area_id = area["id"]

        selected_types = [
            a["type"]
            for a in group_state["areas"]
            if a["id"] != area_id
            and a["type"] is not None
        ]

        available_options = [
            option
            for option in IMPLEMENTATION_MATERIAL_OPTIONS
            if option not in selected_types
        ]


        current_type = area.get("type")

        select_options = [
            "Select an area"
        ] + available_options


        if (
            current_type is not None
            and current_type not in select_options
        ):
            select_options.append(
                current_type
            )


        current_index = 0

        if current_type in select_options:

            current_index = (
                select_options.index(
                    current_type
                )
            )


        selected_area = st.selectbox(
            "Select an area",
            select_options,
            index=current_index,
            key=(
                f"material_area_"
                f"{group_number}_"
                f"{area_id}"
            )
        )


        if selected_area == "Select an area":

            area["type"] = None

            continue


        area["type"] = selected_area


        # ----------------------------------------------------
        # LESSON PLAN
        # ----------------------------------------------------

        if selected_area == "Lesson Plan":

            files = st.file_uploader(
                "Upload Lesson Plan",
                type=[
                    "pdf",
                    "jpg",
                    "jpeg",
                    "png",
                    "webp"
                ],
                accept_multiple_files=True,
                key=(
                    f"lesson_plan_files_"
                    f"{group_number}_"
                    f"{area_id}"
                )
            )

            for file in files or []:

                uploaded_materials.append(
                    {
                        "file": file,
                        "category": "lesson_plan"
                    }
                )


        # ----------------------------------------------------
        # CLASSROOM ACTIVITY
        # ----------------------------------------------------

        elif selected_area == (
            "Classroom Activity Conducted"
        ):

            files = st.file_uploader(
                "Upload Classroom Activity Pictures / Video",
                type=[
                    "jpg",
                    "jpeg",
                    "png",
                    "webp",
                    "mp4",
                    "mov",
                    "m4v",
                    "avi"
                ],
                accept_multiple_files=True,
                key=(
                    f"classroom_activity_files_"
                    f"{group_number}_"
                    f"{area_id}"
                )
            )

            for file in files or []:

                uploaded_materials.append(
                    {
                        "file": file,
                        "category": "activity"
                    }
                )


        # ----------------------------------------------------
        # STUDENT WRITTEN WORK
        # ----------------------------------------------------

        elif selected_area == (
            "Student Written Work / Writing Practice"
        ):

            files = st.file_uploader(
                "Upload Student Written Work / Writing Practice",
                type=[
                    "jpg",
                    "jpeg",
                    "png",
                    "webp",
                    "pdf"
                ],
                accept_multiple_files=True,
                key=(
                    f"student_written_work_files_"
                    f"{group_number}_"
                    f"{area_id}"
                )
            )

            for file in files or []:

                uploaded_materials.append(
                    {
                        "file": file,
                        "category": "writing"
                    }
                )


        # ----------------------------------------------------
        # PHONICS / PHONETICS
        # ----------------------------------------------------

        elif selected_area == (
            "Phonics / Phonetics Implementation"
        ):

            files = st.file_uploader(
                "Upload Phonics / Phonetics Implementation Pictures / Videos",
                type=[
                    "jpg",
                    "jpeg",
                    "png",
                    "webp",
                    "mp4",
                    "mov",
                    "m4v",
                    "avi",
                    "pdf"
                ],
                accept_multiple_files=True,
                key=(
                    f"phonics_files_"
                    f"{group_number}_"
                    f"{area_id}"
                )
            )

            for file in files or []:

                uploaded_materials.append(
                    {
                        "file": file,
                        "category": "phonics"
                    }
                )


        # ----------------------------------------------------
        # STUDENT ASSESSMENT
        # ----------------------------------------------------

        elif selected_area == (
            "Student Assessment"
        ):

            files = st.file_uploader(
                "Upload Student Assessment",
                type=[
                    "jpg",
                    "jpeg",
                    "png",
                    "webp",
                    "pdf"
                ],
                accept_multiple_files=True,
                key=(
                    f"student_assessment_files_"
                    f"{group_number}_"
                    f"{area_id}"
                )
            )

            for file in files or []:

                uploaded_materials.append(
                    {
                        "file": file,
                        "category": "assessment"
                    }
                )


        # ----------------------------------------------------
        # TEACHER PORTFOLIO
        # ----------------------------------------------------

        elif selected_area == (
            "Teacher Portfolio"
        ):

            files = st.file_uploader(
                "Upload Teacher Portfolio",
                type=[
                    "jpg",
                    "jpeg",
                    "png",
                    "webp",
                    "pdf",
                    "mp4",
                    "mov",
                    "m4v"
                ],
                accept_multiple_files=True,
                key=(
                    f"teacher_portfolio_files_"
                    f"{group_number}_"
                    f"{area_id}"
                )
            )

            for file in files or []:

                uploaded_materials.append(
                    {
                        "file": file,
                        "category": "portfolio"
                    }
                )


        # ----------------------------------------------------
        # REMOVE AREA
        # ----------------------------------------------------

        if len(group_state["areas"]) > 1:

            if st.button(
                "Remove This Area",
                key=(
                    f"remove_area_"
                    f"{group_number}_"
                    f"{area_id}"
                )
            ):

                remove_material_area(
                    group_number,
                    area_id
                )

                st.rerun()


    # --------------------------------------------------------
    # ADD ANOTHER MATERIAL AREA
    # --------------------------------------------------------

    st.button(
        "＋ Add Another Area",
        key=f"add_area_{group_number}",
        on_click=add_material_area,
        args=(group_number,)
    )


    return {
        "group_number": group_number,
        "grade": grade,
        "subject": subject,
        "lesson_name": lesson_name,
        "recorded_voice": recorded_voice,
        "uploaded_voice": uploaded_voice or [],
        "uploaded_materials": uploaded_materials
    }


# ============================================================
# IMPLEMENTATION GROUPS
# ============================================================

st.markdown("---")

st.header(
    "📖 Daily Classroom Implementation"
)


all_groups = []


for group_number in range(
    1,
    st.session_state.implementation_group_count + 1
):

    group_data = render_implementation_group(
        group_number
    )

    all_groups.append(
        group_data
    )


# ============================================================
# ADD ANOTHER CLASS
# ============================================================

if (
    st.session_state.implementation_group_count
    < MAX_IMPLEMENTATION_GROUPS
):

    if st.button(
        "＋ Add Another Class / Implementation",
        key="add_another_class"
    ):

        st.session_state.implementation_group_count += 1

        st.rerun()


else:

    st.caption(
        f"Maximum of {MAX_IMPLEMENTATION_GROUPS} "
        "classes / implementations can be added at one time."
    )


# ============================================================
# SUBMISSION
# ============================================================

st.markdown("---")

st.subheader(
    "🚀 Submit Daily Implementation"
)


st.caption(
    f"Maximum file size: {MAX_FILE_SIZE_MB} MB per file."
)


submit_button = st.button(
    "Submit Implementation",
    type="primary",
    use_container_width=True
)


# ============================================================
# SUBMISSION PROCESS
# ============================================================

if submit_button:

    # --------------------------------------------------------
    # BASIC VALIDATION
    # --------------------------------------------------------

    if not selected_state:
        st.error("Please select State / Zone.")
        st.stop()


    if not selected_consultant:
        st.error("Please select Consultant.")
        st.stop()


    if not selected_school:
        st.error("Please select School.")
        st.stop()


    if not selected_teacher:
        st.error("Please select Teacher.")
        st.stop()


    # --------------------------------------------------------
    # VALIDATE LESSON NAMES
    # --------------------------------------------------------

    invalid_groups = []

    for group in all_groups:

        if not str(
            group["lesson_name"]
        ).strip():

            invalid_groups.append(
                group["group_number"]
            )


    if invalid_groups:

        st.error(
            "Please enter Lesson Plan No. & "
            "Topic / Chapter for implementation "
            f"group(s): {', '.join(map(str, invalid_groups))}"
        )

        st.stop()


    # --------------------------------------------------------
    # CREATE SUBMISSION ID
    # --------------------------------------------------------

    submission_id = (
        uuid.uuid4()
        .hex[:12]
    )


    school_path = sanitize_path_component(
        selected_school
    )

    teacher_path = sanitize_path_component(
        selected_teacher
    )

    date_string = selected_date.strftime(
        "%Y-%m-%d"
    )


    submission_base = (
        f"schools/"
        f"{school_path}/"
        f"teachers/"
        f"{teacher_path}/"
        f"{date_string}/"
        f"submission_{submission_id}"
    )


    # --------------------------------------------------------
    # COLLECT ALL UPLOAD JOBS
    # --------------------------------------------------------

    upload_jobs = []


    for group in all_groups:

        group_number = group["group_number"]

        group_base = (
            f"{submission_base}/"
            f"implementation_{group_number}"
        )


        # ----------------------------------------------------
        # RECORDED VOICE NOTE
        # ----------------------------------------------------

        recorded_voice = group[
            "recorded_voice"
        ]

        if recorded_voice is not None:

            upload_jobs.append(
                (
                    recorded_voice,
                    f"{group_base}/voice_notes",
                    "voice",
                    group_number
                )
            )


        # ----------------------------------------------------
        # UPLOADED VOICE NOTES
        # ----------------------------------------------------

        for voice_file in group[
            "uploaded_voice"
        ]:

            upload_jobs.append(
                (
                    voice_file,
                    f"{group_base}/voice_notes",
                    "voice",
                    group_number
                )
            )


        # ----------------------------------------------------
        # CLASSROOM MATERIALS
        # ----------------------------------------------------

        for material in group[
            "uploaded_materials"
        ]:

            category = material[
                "category"
            ]

            file = material[
                "file"
            ]


            category_folder_map = {

                "lesson_plan":
                    "lesson_plans",

                "activity":
                    "activity_videos",

                "writing":
                    "student_work",

                "phonics":
                    "phonics",

                "assessment":
                    "student_assessments",

                "portfolio":
                    "teacher_portfolio"
            }


            folder = category_folder_map[
                category
            ]


            upload_jobs.append(
                (
                    file,
                    f"{group_base}/{folder}",
                    category,
                    group_number
                )
            )


    # --------------------------------------------------------
    # CHECK FILE SIZES BEFORE UPLOAD
    # --------------------------------------------------------

    oversized_files = []


    for (
        uploaded_file,
        folder_name,
        category,
        group_number
    ) in upload_jobs:

        size_mb = get_file_size_mb(
            uploaded_file
        )

        if size_mb > MAX_FILE_SIZE_MB:

            oversized_files.append(
                (
                    uploaded_file.name,
                    size_mb
                )
            )


    if oversized_files:

        st.error(
            "The following files exceed the "
            f"{MAX_FILE_SIZE_MB} MB limit:"
        )

        for file_name, size_mb in oversized_files:

            st.write(
                f"• {file_name} — "
                f"{size_mb:.1f} MB"
            )

        st.stop()


    # --------------------------------------------------------
    # UPLOAD
    # --------------------------------------------------------

    progress = st.progress(
        0,
        text="Preparing uploads..."
    )


    if upload_jobs:

        progress.progress(
            10,
            text=(
                f"Uploading {len(upload_jobs)} "
                "file(s)..."
            )
        )


        upload_results = upload_all_files_parallel(
            upload_jobs
        )

    else:

        upload_results = []


    progress.progress(
        70,
        text="Checking uploaded files..."
    )


    # --------------------------------------------------------
    # UPLOAD FAILURE CHECK
    # --------------------------------------------------------

    failed_uploads = [
        result
        for result in upload_results
        if not result["success"]
    ]


    if failed_uploads:

        st.error(
            "Some files could not be uploaded. "
            "No database records were created."
        )


        for result in failed_uploads:

            st.write(
                f"• {result['file_name']} — "
                f"{result['error']}"
            )

        st.stop()


    # --------------------------------------------------------
    # GROUP UPLOAD PATHS
    # --------------------------------------------------------

    def get_paths(
        group_number,
        category
    ):

        return [
            result["path"]
            for result in upload_results
            if (
                result["group_number"]
                == group_number
                and result["category"]
                == category
                and result["success"]
            )
        ]


    # --------------------------------------------------------
    # CREATE DATABASE ROWS
    # --------------------------------------------------------

    database_entries = []


    for group in all_groups:

        group_number = group[
            "group_number"
        ]


        voice_paths = get_paths(
            group_number,
            "voice"
        )


        lesson_plan_paths = get_paths(
            group_number,
            "lesson_plan"
        )


        activity_paths = get_paths(
            group_number,
            "activity"
        )


        writing_paths = get_paths(
            group_number,
            "writing"
        )


        assessment_paths = get_paths(
            group_number,
            "assessment"
        )


        phonics_paths = get_paths(
            group_number,
            "phonics"
        )


        portfolio_paths = get_paths(
            group_number,
            "portfolio"
        )


        first_name, last_name = (
            split_teacher_name(
                selected_teacher
            )
        )


        # ----------------------------------------------------
        # ACTIVITY PATHS
        # Existing backend has three separate columns.
        # ----------------------------------------------------

        video_1 = (
            activity_paths[0]
            if len(activity_paths) > 0
            else None
        )

        video_2 = (
            activity_paths[1]
            if len(activity_paths) > 1
            else None
        )

        video_3 = (
            activity_paths[2]
            if len(activity_paths) > 2
            else None
        )


        # ----------------------------------------------------
        # EXISTING teacher_records SCHEMA
        # ----------------------------------------------------

        entry = {

            "State_Zone":
                selected_state,

            "Uploaded_By":
                selected_consultant,

            "Institution":
                selected_school,

            "Center":
                selected_school,

            "FirstName":
                first_name,

            "LastName":
                last_name,

            "FullName":
                selected_teacher,

            "Role":
                "Teacher",

            "Type":
                "Classroom Reflection",

            "Grade":
                group["grade"],

            "Subject":
                group["subject"],

            "Book":
                group["lesson_name"],

            "StartTime":
                "09:00",

            "EndTime":
                "09:45",

            "Duration_Min":
                0.0,

            "Voice_Note_Link":
                ",".join(
                    voice_paths
                )
                if voice_paths
                else None,

            "Lesson_Plan_Picture":
                ",".join(
                    lesson_plan_paths
                )
                if lesson_plan_paths
                else None,

            "Video_Evidence_1":
                video_1,

            "Video_Evidence_2":
                video_2,

            "Video_Evidence_3":
                video_3,

            "Writing_Sample_Link":
                ",".join(
                    writing_paths
                )
                if writing_paths
                else None,

            "Student_Assessment_Link":
                ",".join(
                    assessment_paths
                )
                if assessment_paths
                else None,

            "Phonics_Evidence_Link":
                ",".join(
                    phonics_paths
                )
                if phonics_paths
                else None,

            "Portfolio_Evidence_Link":
                ",".join(
                    portfolio_paths
                )
                if portfolio_paths
                else None,

            "Assessment_Score_Pct":
                None
        }


        database_entries.append(
            entry
        )


    # --------------------------------------------------------
    # INSERT INTO EXISTING MASTER TABLE
    # --------------------------------------------------------

    progress.progress(
        85,
        text="Saving implementation details..."
    )


    inserted_count = 0

    database_errors = []


    for entry in database_entries:

        try:

            insert_implementation_to_db(
                entry
            )

            inserted_count += 1

        except Exception as e:

            database_errors.append(
                str(e)
            )


    # --------------------------------------------------------
    # DATABASE FAILURE
    # --------------------------------------------------------

    if database_errors:

        st.error(
            "Implementation files were uploaded, "
            "but some database records could not be saved."
        )


        for error in database_errors:

            st.code(error)


        st.stop()


    # --------------------------------------------------------
    # SUCCESS
    # --------------------------------------------------------

    progress.progress(
        100,
        text="Submission completed successfully."
    )


    st.success(
        f"✅ {inserted_count} implementation(s) "
        "submitted successfully."
    )


    st.info(
        "Your voice reflection and selected "
        "classroom implementation materials "
        "have been saved successfully."
    )


    # --------------------------------------------------------
    # RESET FORM
    # --------------------------------------------------------

    st.session_state.implementation_group_count = 1


    keys_to_remove = []

    for key in st.session_state.keys():

        if (
            key.startswith("implementation_group_")
            or key.startswith("grade_")
            or key.startswith("subject_")
            or key.startswith("lesson_name_")
            or key.startswith("record_voice_")
            or key.startswith("voice_upload_")
            or key.startswith("material_area_")
            or key.startswith("lesson_plan_files_")
            or key.startswith("classroom_activity_files_")
            or key.startswith("student_written_work_files_")
            or key.startswith("phonics_files_")
            or key.startswith("student_assessment_files_")
            or key.startswith("teacher_portfolio_files_")
        ):

            keys_to_remove.append(
                key
            )


    for key in keys_to_remove:

        del st.session_state[key]


    st.rerun()
