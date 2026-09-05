import streamlit as st
import pandas as pd
import re
import uuid
import concurrent.futures
from datetime import datetime, date
from io import BytesIO

from supabase import create_client
import boto3
from boto3.s3.transfer import TransferConfig


# ============================================================
# PAGE CONFIG
# ============================================================

st.set_page_config(
    page_title="Teacher Daily Implementation Reflection",
    page_icon="🎓",
    layout="wide",
    initial_sidebar_state="collapsed",
)


# ============================================================
# CONSTANTS
# ============================================================

MAX_FILE_SIZE_MB = 50
MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024

MAX_PARALLEL_UPLOADS = 5

R2_MULTIPART_THRESHOLD = 8 * 1024 * 1024
R2_MULTIPART_CHUNK_SIZE = 8 * 1024 * 1024

MAX_IMPLEMENTATION_GROUPS = 10

TEACHER_RECORDS_TABLE = "teacher_records"

GRADES = [
    "Nursery",
    "LKG",
    "UKG",
    "Grade 1",
    "Grade 2",
    "Grade 3",
    "Grade 4",
    "Grade 5",
]

SUBJECTS = [
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
    "Play Based",
]

MATERIAL_TYPES = [
    "Lesson Plan",
    "Classroom Activity Conducted",
    "Student Written Work / Writing Practice",
    "Phonics / Phonetics Implementation",
    "Student Assessment",
    "Teacher Portfolio",
]


# ============================================================
# SUPABASE
# ============================================================

supabase_url = st.secrets["supabase"]["url"]
supabase_key = st.secrets["supabase"]["key"]

supabase = create_client(
    supabase_url,
    supabase_key,
)


# ============================================================
# CLOUDFLARE R2
# ============================================================

r2_secrets = st.secrets["r2"]

R2_ACCOUNT_ID = r2_secrets["R2_ACCOUNT_ID"]
R2_ACCESS_KEY_ID = r2_secrets["R2_ACCESS_KEY_ID"]
R2_SECRET_ACCESS_KEY = r2_secrets["R2_SECRET_ACCESS_KEY"]
R2_BUCKET_NAME = r2_secrets["R2_BUCKET_NAME"]
R2_ENDPOINT_URL = r2_secrets["R2_ENDPOINT_URL"]


def create_r2_client():
    """
    Create a fresh R2 client.
    A separate client per upload is safer when uploads
    are performed concurrently.
    """
    return boto3.client(
        "s3",
        endpoint_url=R2_ENDPOINT_URL,
        aws_access_key_id=R2_ACCESS_KEY_ID,
        aws_secret_access_key=R2_SECRET_ACCESS_KEY,
        region_name="auto",
    )


# ============================================================
# HELPERS
# ============================================================

def clean_name(value):
    """
    Clean school / teacher / file path names for R2.
    """
    if value is None:
        return "unknown"

    value = str(value).strip()

    if not value:
        return "unknown"

    value = re.sub(r"[^\w\s\-\.]", "", value, flags=re.UNICODE)
    value = re.sub(r"\s+", "_", value)

    return value[:150]


def clean_filename(filename):
    """
    Keep original extension while making filename R2-safe.
    """
    if not filename:
        return "file"

    filename = str(filename)

    filename = re.sub(
        r"[^\w\s\-\.\(\)]",
        "",
        filename,
        flags=re.UNICODE,
    )

    filename = re.sub(r"\s+", "_", filename)

    return filename[:180]


def get_file_size(uploaded_file):
    """
    Return file size without permanently changing the
    current stream position.
    """
    if uploaded_file is None:
        return 0

    try:
        current_position = uploaded_file.tell()
    except Exception:
        current_position = 0

    try:
        uploaded_file.seek(0, 2)
        size = uploaded_file.tell()
        uploaded_file.seek(0)
        return size
    except Exception:
        try:
            uploaded_file.seek(current_position)
        except Exception:
            pass

        return 0


def validate_file_size(uploaded_file):
    """
    Validate the 50 MB maximum file size.
    """
    if uploaded_file is None:
        return True, ""

    size = get_file_size(uploaded_file)

    if size > MAX_FILE_SIZE_BYTES:
        return (
            False,
            f"{uploaded_file.name} is larger than "
            f"{MAX_FILE_SIZE_MB} MB.",
        )

    return True, ""


def get_extension(filename):
    """
    Return a lowercase file extension.
    """
    if not filename or "." not in filename:
        return ""

    return filename.rsplit(".", 1)[1].lower()


def upload_file_to_r2(
    uploaded_file,
    object_key,
    content_type=None,
):
    """
    Upload one file to Cloudflare R2.

    Supports multipart upload for larger files.
    """

    if uploaded_file is None:
        return None

    file_size = get_file_size(uploaded_file)

    if file_size > MAX_FILE_SIZE_BYTES:
        raise ValueError(
            f"{uploaded_file.name} exceeds the "
            f"{MAX_FILE_SIZE_MB} MB file-size limit."
        )

    r2_client = create_r2_client()

    transfer_config = TransferConfig(
        multipart_threshold=R2_MULTIPART_THRESHOLD,
        multipart_chunksize=R2_MULTIPART_CHUNK_SIZE,
        max_concurrency=4,
        use_threads=True,
    )

    uploaded_file.seek(0)

    extra_args = {}

    if content_type:
        extra_args["ContentType"] = content_type
    elif getattr(uploaded_file, "type", None):
        extra_args["ContentType"] = uploaded_file.type

    r2_client.upload_fileobj(
        uploaded_file,
        R2_BUCKET_NAME,
        object_key,
        ExtraArgs=extra_args if extra_args else None,
        Config=transfer_config,
    )

    return object_key


def get_r2_category_folder(material_type):
    """
    Convert teacher-facing evidence type into the
    existing R2 folder structure.
    """

    mapping = {
        "Lesson Plan": "lesson_plans",
        "Classroom Activity Conducted": "activity_videos",
        "Student Written Work / Writing Practice": "student_work",
        "Phonics / Phonetics Implementation": "phonics",
        "Student Assessment": "student_assessments",
        "Teacher Portfolio": "teacher_portfolio",
        "Voice Reflection": "voice_notes",
    }

    return mapping.get(material_type, "other")


def get_supabase_rows_paginated(
    table_name,
    page_size=1000,
):
    """
    Fetch all rows from a Supabase table using pagination.
    """

    all_rows = []
    offset = 0

    while True:
        response = (
            supabase
            .table(table_name)
            .select("*")
            .range(
                offset,
                offset + page_size - 1,
            )
            .execute()
        )

        rows = response.data or []

        if not rows:
            break

        all_rows.extend(rows)

        if len(rows) < page_size:
            break

        offset += page_size

    return all_rows


def get_teacher_master_data():
    """
    Fetch teacher records from the master teacher_records table.
    """

    try:
        rows = get_supabase_rows_paginated(
            TEACHER_RECORDS_TABLE
        )

        if not rows:
            return pd.DataFrame()

        return pd.DataFrame(rows)

    except Exception as e:
        st.error(
            f"Unable to load teacher information: {e}"
        )
        return pd.DataFrame()


def unique_non_empty(values):
    """
    Return unique non-empty values while preserving order.
    """

    result = []

    for value in values:
        if value is None:
            continue

        value = str(value).strip()

        if not value:
            continue

        if value not in result:
            result.append(value)

    return result


def get_school_names(df):
    """
    Extract school/institution names.
    """

    if df.empty or "Institution" not in df.columns:
        return []

    return unique_non_empty(
        df["Institution"].tolist()
    )


def get_teachers_for_school(
    df,
    school_name,
):
    """
    Get teachers associated with the selected school.
    """

    if df.empty:
        return []

    school_df = df.copy()

    if "Institution" in school_df.columns:
        school_df = school_df[
            school_df["Institution"].astype(str).str.strip()
            == str(school_name).strip()
        ]

    teachers = []

    if "FullName" in school_df.columns:
        teachers.extend(
            school_df["FullName"].tolist()
        )

    elif (
        "FirstName" in school_df.columns
        or "LastName" in school_df.columns
    ):
        first_names = (
            school_df["FirstName"].fillna("")
            if "FirstName" in school_df.columns
            else pd.Series(
                [""] * len(school_df),
                index=school_df.index,
            )
        )

        last_names = (
            school_df["LastName"].fillna("")
            if "LastName" in school_df.columns
            else pd.Series(
                [""] * len(school_df),
                index=school_df.index,
            )
        )

        for first_name, last_name in zip(
            first_names,
            last_names,
        ):
            full_name = (
                f"{str(first_name).strip()} "
                f"{str(last_name).strip()}"
            ).strip()

            if full_name:
                teachers.append(full_name)

    return unique_non_empty(teachers)


def get_teacher_role(
    df,
    school_name,
    teacher_name,
):
    """
    Find the teacher's role from master data.
    """

    if df.empty:
        return "Teacher"

    if "FullName" not in df.columns:
        return "Teacher"

    filtered = df[
        df["FullName"].astype(str).str.strip()
        == str(teacher_name).strip()
    ]

    if "Institution" in filtered.columns:
        filtered = filtered[
            filtered["Institution"].astype(str).str.strip()
            == str(school_name).strip()
        ]

    if filtered.empty:
        return "Teacher"

    if "Role" in filtered.columns:
        roles = unique_non_empty(
            filtered["Role"].tolist()
        )

        if roles:
            return roles[0]

    return "Teacher"


def get_center_for_school(
    df,
    school_name,
):
    """
    Get Center value for selected school.
    """

    if df.empty or "Center" not in df.columns:
        return ""

    filtered = df

    if "Institution" in filtered.columns:
        filtered = filtered[
            filtered["Institution"].astype(str).str.strip()
            == str(school_name).strip()
        ]

    centers = unique_non_empty(
        filtered["Center"].tolist()
    )

    if centers:
        return centers[0]

    return ""


def get_state_zone_for_school(
    df,
    school_name,
):
    """
    Get State_Zone value for selected school.
    """

    if df.empty or "State_Zone" not in df.columns:
        return ""

    filtered = df

    if "Institution" in filtered.columns:
        filtered = filtered[
            filtered["Institution"].astype(str).str.strip()
            == str(school_name).strip()
        ]

    zones = unique_non_empty(
        filtered["State_Zone"].tolist()
    )

    if zones:
        return zones[0]

    return ""


def get_uploaded_by_name():
    """
    Retrieve consultant identity.

    The application can provide consultant_name through
    Streamlit session state or secrets.
    """

    session_consultant = (
        st.session_state.get("consultant_name")
    )

    if session_consultant:
        return str(session_consultant).strip()

    try:
        secret_consultant = (
            st.secrets["app"]["consultant_name"]
        )

        if secret_consultant:
            return str(secret_consultant).strip()

    except Exception:
        pass

    return "Consultant"


def build_r2_object_key(
    school_name,
    teacher_name,
    selected_date,
    submission_id,
    implementation_number,
    material_type,
    filename,
):
    """
    Build the existing R2 folder structure:

    schools/{school}/teachers/{teacher}/{date}/
    submission_{id}/implementation_{group}/folder/file
    """

    school_part = clean_name(school_name)
    teacher_part = clean_name(teacher_name)

    date_part = selected_date.strftime(
        "%Y-%m-%d"
    )

    submission_part = (
        f"submission_{submission_id}"
    )

    implementation_part = (
        f"implementation_{implementation_number}"
    )

    category_folder = get_r2_category_folder(
        material_type
    )

    safe_filename = clean_filename(filename)

    unique_prefix = uuid.uuid4().hex[:12]

    return (
        f"schools/{school_part}/"
        f"teachers/{teacher_part}/"
        f"{date_part}/"
        f"{submission_part}/"
        f"{implementation_part}/"
        f"{category_folder}/"
        f"{unique_prefix}_{safe_filename}"
    )


def upload_task(
    uploaded_file,
    object_key,
):
    """
    Worker used by the parallel uploader.
    """

    content_type = getattr(
        uploaded_file,
        "type",
        None,
    )

    result = upload_file_to_r2(
        uploaded_file,
        object_key,
        content_type,
    )

    return result


def upload_files_parallel(upload_tasks):
    """
    Upload multiple files concurrently.

    upload_tasks:
        list of tuples:
        (uploaded_file, object_key)
    """

    if not upload_tasks:
        return []

    results = [None] * len(upload_tasks)

    with concurrent.futures.ThreadPoolExecutor(
        max_workers=MAX_PARALLEL_UPLOADS
    ) as executor:

        future_to_index = {}

        for index, (
            uploaded_file,
            object_key,
        ) in enumerate(upload_tasks):

            future = executor.submit(
                upload_task,
                uploaded_file,
                object_key,
            )

            future_to_index[future] = index

        for future in concurrent.futures.as_completed(
            future_to_index
        ):

            index = future_to_index[future]

            try:
                results[index] = future.result()

            except Exception as e:
                raise RuntimeError(
                    f"Upload failed for "
                    f"{upload_tasks[index][0].name}: {e}"
                )

    return results


def store_uploaded_file_reference(
    uploaded_file,
    school_name,
    teacher_name,
    selected_date,
    submission_id,
    implementation_number,
    material_type,
):
    """
    Create an R2 object key and upload the file.
    """

    object_key = build_r2_object_key(
        school_name=school_name,
        teacher_name=teacher_name,
        selected_date=selected_date,
        submission_id=submission_id,
        implementation_number=implementation_number,
        material_type=material_type,
        filename=uploaded_file.name,
    )

    return object_key


# ============================================================
# SESSION STATE
# ============================================================

if "implementation_groups" not in st.session_state:
    st.session_state.implementation_groups = 1


if "material_areas" not in st.session_state:
    st.session_state.material_areas = {
        1: []
    }


if "submit_requested" not in st.session_state:
    st.session_state.submit_requested = False


if "submission_in_progress" not in st.session_state:
    st.session_state.submission_in_progress = False


def request_submission():
    """
    Persistent submit callback.

    This prevents the Streamlit button click from being
    lost during the rerun.
    """

    st.session_state.submit_requested = True


def add_implementation_group():
    """
    Add another class implementation.
    """

    current_count = (
        st.session_state.implementation_groups
    )

    if current_count < MAX_IMPLEMENTATION_GROUPS:

        new_number = current_count + 1

        st.session_state.implementation_groups = (
            new_number
        )

        if new_number not in st.session_state.material_areas:
            st.session_state.material_areas[
                new_number
            ] = []


def add_material_area(group_number):
    """
    Add a new evidence type area.
    """

    if group_number not in st.session_state.material_areas:
        st.session_state.material_areas[
            group_number
        ] = []

    selected = (
        st.session_state.material_areas[
            group_number
        ]
    )

    remaining = [
        item
        for item in MATERIAL_TYPES
        if item not in selected
    ]

    if remaining:
        selected.append(remaining[0])


def remove_material_area(
    group_number,
    material_index,
):
    """
    Remove an evidence area.
    """

    if group_number not in st.session_state.material_areas:
        return

    areas = st.session_state.material_areas[
        group_number
    ]

    if (
        0 <= material_index
        < len(areas)
    ):
        areas.pop(material_index)


# ============================================================
# HEADER
# ============================================================

st.title(
    "🎓 Teacher Daily Implementation Reflection"
)

st.caption(
    "Complete your reflection once after your class. "
    "Record your plan for tomorrow and upload evidence "
    "from the class you completed today."
)


# ============================================================
# LOAD MASTER DATA
# ============================================================

if "master_teacher_data" not in st.session_state:

    with st.spinner(
        "Loading teacher information..."
    ):
        st.session_state.master_teacher_data = (
            get_teacher_master_data()
        )

master_df = (
    st.session_state.master_teacher_data
)


# ============================================================
# SCHOOL
# ============================================================

school_names = get_school_names(
    master_df
)

if not school_names:

    st.error(
        "No school information was found in "
        "teacher_records."
    )

    st.stop()


selected_school = st.selectbox(
    "School",
    school_names,
    key="selected_school",
)


# ============================================================
# CONSULTANT / TEACHER
# ============================================================

consultant_name = get_uploaded_by_name()

school_teachers = get_teachers_for_school(
    master_df,
    selected_school,
)

teacher_options = []

for teacher in school_teachers:
    if teacher not in teacher_options:
        teacher_options.append(teacher)

# Consultant is included in the same dropdown.
if consultant_name and consultant_name not in teacher_options:
    teacher_options.append(consultant_name)

# Other teacher option.
teacher_options.append(
    "Other Teacher / Not Listed"
)


selected_teacher = st.selectbox(
    "Teacher",
    teacher_options,
    key="selected_teacher",
)


manual_teacher_name = ""

if selected_teacher == "Other Teacher / Not Listed":

    manual_teacher_name = st.text_input(
        "Enter Teacher Name",
        key="manual_teacher_name",
    )

    full_name = manual_teacher_name.strip()
    teacher_role = "Teacher"
    uploaded_by = consultant_name

elif selected_teacher == consultant_name:

    full_name = consultant_name
    teacher_role = "Consultant"
    uploaded_by = consultant_name

else:

    full_name = selected_teacher
    teacher_role = get_teacher_role(
        master_df,
        selected_school,
        selected_teacher,
    )

    uploaded_by = consultant_name


# ============================================================
# DATE
# ============================================================

selected_date = st.date_input(
    "Implementation Date",
    value=date.today(),
    key="selected_date",
)


# ============================================================
# VOICE REFLECTION
# ============================================================

st.markdown("### 🎙️ Voice Reflection")

st.info(
    "Record your reflection for the upcoming class — "
    "what you plan to teach tomorrow."
)


with st.expander(
    "📌 Before You Record Your Reflection"
):

    st.markdown(
        """
**What**
- Grade, Subject, Lesson Plan No. & Topic/Chapter

**Why — Skill / Learning Objective**
- What do I want students to learn or be able to do through this lesson?
- Think Bloom’s Taxonomy: Remembering, Understanding, Applying, Analysing, Evaluating, Creating.

**Teacher Activity — How**
- How will I teach?
- Which digital or physical resources will I use?

**Student Activity**
- What will students do or participate in?

**Practice & Apply**
- What will students do in the Course Book/Workbook?
- Mention the specific topic, section or page number.
- Include classwork/homework.

**Review**
- How will I check students’ learning?

**Remember**
- The purpose is not just to tell what we are going to do, but to think about why we are doing it and how it will support student learning.
        """
    )


voice_recording = st.audio_input(
    "🎙️ Record Your Reflection",
    sample_rate=16000,
    key="record_voice",
)


voice_upload = st.file_uploader(
    "Or upload your voice reflection",
    type=[
        "mp3",
        "wav",
        "m4a",
        "aac",
        "ogg",
    ],
    key="voice_upload",
)


# ============================================================
# CLASS IMPLEMENTATIONS
# ============================================================

implementation_count = (
    st.session_state.implementation_groups
)


for group_number in range(
    1,
    implementation_count + 1,
):

    st.markdown(
        f"### Class Implementation {group_number}"
    )

    col1, col2, col3 = st.columns(3)

    with col1:

        grade = st.selectbox(
            "Grade",
            GRADES,
            key=f"grade_{group_number}",
        )

    with col2:

        subject = st.selectbox(
            "Subject",
            SUBJECTS,
            key=f"subject_{group_number}",
        )

    with col3:

        book = st.text_input(
            "Book / Chapter / Topic",
            key=f"book_{group_number}",
        )

    time_col1, time_col2 = st.columns(2)

    with time_col1:

        start_time = st.time_input(
            "Start Time",
            value=datetime.strptime(
                "09:00",
                "%H:%M",
            ).time(),
            key=f"start_time_{group_number}",
        )

    with time_col2:

        end_time = st.time_input(
            "End Time",
            value=datetime.strptime(
                "09:45",
                "%H:%M",
            ).time(),
            key=f"end_time_{group_number}",
        )

    # --------------------------------------------------------
    # EVIDENCE FROM TODAY
    # --------------------------------------------------------

    st.markdown(
        "#### 📎 Reflections & Observations from Today's Class"
    )

    st.caption(
        "Upload evidence from the class you completed today."
    )

    if group_number not in st.session_state.material_areas:
        st.session_state.material_areas[
            group_number
        ] = []

    current_areas = (
        st.session_state.material_areas[
            group_number
        ]
    )

    # --------------------------------------------------------
    # MATERIAL AREAS
    # --------------------------------------------------------

    for material_index, material_type in enumerate(
        current_areas
    ):

        area_col1, area_col2 = st.columns(
            [5, 1]
        )

        with area_col1:

            available_types = [
                item
                for item in MATERIAL_TYPES
                if (
                    item == material_type
                    or item not in current_areas
                )
            ]

            selected_material = st.selectbox(
                "What would you like to upload?",
                available_types,
                index=(
                    available_types.index(
                        material_type
                    )
                    if material_type
                    in available_types
                    else 0
                ),
                key=(
                    f"material_type_"
                    f"{group_number}_"
                    f"{material_index}"
                ),
            )

            current_areas[
                material_index
            ] = selected_material

        with area_col2:

            st.write("")

            st.write("")

            if st.button(
                "Remove This Area",
                key=(
                    f"remove_material_"
                    f"{group_number}_"
                    f"{material_index}"
                ),
                use_container_width=True,
            ):

                remove_material_area(
                    group_number,
                    material_index,
                )

                st.rerun()

        # ----------------------------------------------------
        # UPLOAD FILE
        # ----------------------------------------------------

        file_key = (
            f"file_"
            f"{group_number}_"
            f"{material_index}"
        )

        uploaded_material = st.file_uploader(
            f"Upload {selected_material}",
            type=None,
            key=file_key,
        )

        if uploaded_material is not None:

            valid, error_message = (
                validate_file_size(
                    uploaded_material
                )
            )

            if not valid:
                st.error(
                    error_message
                )

            else:

                size_mb = (
                    get_file_size(
                        uploaded_material
                    )
                    / (1024 * 1024)
                )

                st.caption(
                    f"Selected: "
                    f"{uploaded_material.name} "
                    f"({size_mb:.2f} MB)"
                )

    # --------------------------------------------------------
    # ADD ANOTHER EVIDENCE TYPE
    # --------------------------------------------------------

    available_to_add = [
        item
        for item in MATERIAL_TYPES
        if item not in current_areas
    ]

    if (
        available_to_add
        and len(current_areas)
        < len(MATERIAL_TYPES)
    ):

        if st.button(
            "＋ Add Another Evidence Type",
            key=f"add_material_{group_number}",
            use_container_width=True,
        ):

            add_material_area(
                group_number
            )

            st.rerun()

    st.divider()


# ============================================================
# ADD ANOTHER CLASS
# ============================================================

if (
    st.session_state.implementation_groups
    < MAX_IMPLEMENTATION_GROUPS
):

    if st.button(
        "＋ Add Another Class",
        use_container_width=True,
    ):

        add_implementation_group()

        st.rerun()


# ============================================================
# SUBMISSION NOTE
# ============================================================

st.markdown("### 🚀 Submit")

st.caption(
    f"Maximum file size: {MAX_FILE_SIZE_MB} MB per file."
)

st.caption(
    "Submit once after completing today's class. "
    "Your voice reflection is for the upcoming class "
    "and the evidence above is for today's completed class."
)


# ============================================================
# SUBMIT BUTTON
# ============================================================

st.button(
    "🚀 Submit Implementation",
    type="primary",
    use_container_width=True,
    on_click=request_submission,
)


# ============================================================
# SUBMISSION PROCESS
# ============================================================

if st.session_state.get(
    "submit_requested",
    False,
):

    # Reset immediately so the request is processed once.
    st.session_state.submit_requested = False

    if st.session_state.get(
        "submission_in_progress",
        False,
    ):
        st.warning(
            "Submission is already in progress."
        )

        st.stop()

    st.session_state.submission_in_progress = True

    try:

        # ----------------------------------------------------
        # VALIDATION
        # ----------------------------------------------------

        if not selected_school:
            st.error(
                "Please select a school."
            )
            st.stop()

        if not full_name:
            st.error(
                "Please select or enter a teacher name."
            )
            st.stop()

        implementation_count = (
            st.session_state.implementation_groups
        )

        # ----------------------------------------------------
        # VOICE FILE
        # ----------------------------------------------------

        final_voice_file = (
            voice_recording
            if voice_recording is not None
            else voice_upload
        )

        if final_voice_file is not None:

            voice_valid, voice_error = (
                validate_file_size(
                    final_voice_file
                )
            )

            if not voice_valid:
                st.error(
                    voice_error
                )
                st.stop()

        # ----------------------------------------------------
        # SUBMISSION ID
        # ----------------------------------------------------

        submission_id = (
            uuid.uuid4().hex[:12]
        )

        # ----------------------------------------------------
        # SCHOOL METADATA
        # ----------------------------------------------------

        center = get_center_for_school(
            master_df,
            selected_school,
        )

        state_zone = get_state_zone_for_school(
            master_df,
            selected_school,
        )

        # ----------------------------------------------------
        # BUILD ALL UPLOAD TASKS
        # ----------------------------------------------------

        upload_tasks = []

        # Voice reflection belongs to the upcoming/tomorrow
        # reflection and is stored independently in
        # Voice_Note_Link.

        if final_voice_file is not None:

            voice_object_key = (
                build_r2_object_key(
                    school_name=selected_school,
                    teacher_name=full_name,
                    selected_date=selected_date,
                    submission_id=submission_id,
                    implementation_number=1,
                    material_type="Voice Reflection",
                    filename=final_voice_file.name,
                )
            )

            upload_tasks.append(
                (
                    final_voice_file,
                    voice_object_key,
                )
            )

        # ----------------------------------------------------
        # MATERIAL FILES
        # ----------------------------------------------------

        material_upload_metadata = []

        for group_number in range(
            1,
            implementation_count + 1,
        ):

            current_areas = (
                st.session_state.material_areas.get(
                    group_number,
                    [],
                )
            )

            for material_index, material_type in enumerate(
                current_areas
            ):

                widget_key = (
                    f"file_"
                    f"{group_number}_"
                    f"{material_index}"
                )

                uploaded_file = st.session_state.get(
                    widget_key
                )

                if uploaded_file is None:
                    continue

                valid, error_message = (
                    validate_file_size(
                        uploaded_file
                    )
                )

                if not valid:
                    st.error(
                        error_message
                    )
                    st.stop()

                object_key = (
                    build_r2_object_key(
                        school_name=selected_school,
                        teacher_name=full_name,
                        selected_date=selected_date,
                        submission_id=submission_id,
                        implementation_number=group_number,
                        material_type=material_type,
                        filename=uploaded_file.name,
                    )
                )

                upload_tasks.append(
                    (
                        uploaded_file,
                        object_key,
                    )
                )

                material_upload_metadata.append(
                    {
                        "group_number": group_number,
                        "material_index": material_index,
                        "material_type": material_type,
                        "object_key": object_key,
                    }
                )

        # ----------------------------------------------------
        # UPLOAD TO R2
        # ----------------------------------------------------

        upload_results = []

        if upload_tasks:

            with st.spinner(
                "Uploading files..."
            ):

                upload_results = (
                    upload_files_parallel(
                        upload_tasks
                    )
                )

        # ----------------------------------------------------
        # IDENTIFY VOICE OBJECT
        # ----------------------------------------------------

        voice_object_key = None

        if final_voice_file is not None:

            voice_object_key = upload_results[0]

        # ----------------------------------------------------
        # MAP MATERIAL UPLOADS
        # ----------------------------------------------------

        uploaded_material_paths = {}

        upload_result_offset = (
            1
            if final_voice_file is not None
            else 0
        )

        for index, metadata in enumerate(
            material_upload_metadata
        ):

            result_index = (
                upload_result_offset
                + index
            )

            uploaded_material_paths[
                (
                    metadata["group_number"],
                    metadata["material_type"],
                )
            ] = upload_results[
                result_index
            ]

        # ----------------------------------------------------
        # INSERT EACH IMPLEMENTATION AS ONE ROW
        # ----------------------------------------------------

        records_to_insert = []

        for group_number in range(
            1,
            implementation_count + 1,
        ):

            group_grade = st.session_state.get(
                f"grade_{group_number}"
            )

            group_subject = st.session_state.get(
                f"subject_{group_number}"
            )

            group_book = st.session_state.get(
                f"book_{group_number}",
                "",
            )

            group_start_time = st.session_state.get(
                f"start_time_{group_number}"
            )

            group_end_time = st.session_state.get(
                f"end_time_{group_number}"
            )

            # ------------------------------------------------
            # IMPORTANT:
            # StartTime and EndTime are timestamp fields.
            # Do NOT save only "09:00" / "09:45".
            # ------------------------------------------------

            implementation_start_timestamp = (
                f"{selected_date.strftime('%Y-%m-%d')}"
                f"T"
                f"{group_start_time.strftime('%H:%M:%S')}"
            )

            implementation_end_timestamp = (
                f"{selected_date.strftime('%Y-%m-%d')}"
                f"T"
                f"{group_end_time.strftime('%H:%M:%S')}"
            )

            # ------------------------------------------------
            # DURATION
            # ------------------------------------------------

            start_minutes = (
                group_start_time.hour * 60
                + group_start_time.minute
            )

            end_minutes = (
                group_end_time.hour * 60
                + group_end_time.minute
            )

            duration_minutes = (
                end_minutes - start_minutes
            )

            if duration_minutes < 0:
                duration_minutes = 0

            # ------------------------------------------------
            # EXISTING MASTER TABLE FIELDS
            # ------------------------------------------------

            record = {
                "State_Zone": state_zone,
                "Uploaded_By": uploaded_by,
                "Institution": selected_school,
                "Center": center,
                "FirstName": (
                    full_name.split(" ")[0]
                    if full_name
                    else ""
                ),
                "LastName": (
                    " ".join(
                        full_name.split(" ")[1:]
                    )
                    if len(
                        full_name.split(" ")
                    ) > 1
                    else ""
                ),
                "FullName": full_name,
                "Role": teacher_role,
                "Type": "Teacher Implementation",
                "Grade": group_grade,
                "Subject": group_subject,
                "Book": group_book,
                "StartTime": (
                    implementation_start_timestamp
                ),
                "EndTime": (
                    implementation_end_timestamp
                ),
                "Duration_Min": float(
                    duration_minutes
                ),
                "Voice_Note_Link": (
                    voice_object_key
                    if group_number == 1
                    else None
                ),
                "Lesson_Plan_Picture": None,
                "Video_Evidence_1": None,
                "Video_Evidence_2": None,
                "Video_Evidence_3": None,
                "Writing_Sample_Link": None,
                "Student_Assessment_Link": None,
                "Phonics_Evidence_Link": None,
                "Portfolio_Evidence_Link": None,
                "Assessment_Score_Pct": None,
            }

            # ------------------------------------------------
            # MAP EVIDENCE TO EXISTING COLUMNS
            # ------------------------------------------------

            activity_counter = 0

            for material_type in (
                st.session_state.material_areas.get(
                    group_number,
                    [],
                )
            ):

                object_key = (
                    uploaded_material_paths.get(
                        (
                            group_number,
                            material_type,
                        )
                    )
                )

                if not object_key:
                    continue

                if material_type == "Lesson Plan":

                    record[
                        "Lesson_Plan_Picture"
                    ] = object_key

                elif (
                    material_type
                    == "Classroom Activity Conducted"
                ):

                    activity_counter += 1

                    if activity_counter == 1:

                        record[
                            "Video_Evidence_1"
                        ] = object_key

                    elif activity_counter == 2:

                        record[
                            "Video_Evidence_2"
                        ] = object_key

                    elif activity_counter == 3:

                        record[
                            "Video_Evidence_3"
                        ] = object_key

                elif (
                    material_type
                    == "Student Written Work / Writing Practice"
                ):

                    record[
                        "Writing_Sample_Link"
                    ] = object_key

                elif (
                    material_type
                    == "Phonics / Phonetics Implementation"
                ):

                    record[
                        "Phonics_Evidence_Link"
                    ] = object_key

                elif (
                    material_type
                    == "Student Assessment"
                ):

                    record[
                        "Student_Assessment_Link"
                    ] = object_key

                elif (
                    material_type
                    == "Teacher Portfolio"
                ):

                    record[
                        "Portfolio_Evidence_Link"
                    ] = object_key

            records_to_insert.append(
                record
            )

        # ----------------------------------------------------
        # SAVE TO SUPABASE
        # ----------------------------------------------------

        if not records_to_insert:

            st.error(
                "No implementation data was available "
                "to submit."
            )

            st.stop()

        with st.spinner(
            "Saving your implementation..."
        ):

            response = (
                supabase
                .table(
                    TEACHER_RECORDS_TABLE
                )
                .insert(
                    records_to_insert
                )
                .execute()
            )

        # ----------------------------------------------------
        # SUCCESS
        # ----------------------------------------------------

        st.success(
            "✅ Your implementation has been submitted successfully!"
        )

        st.info(
            "🎙️ Your Voice Reflection has been saved "
            "for the upcoming class, while the evidence "
            "you uploaded has been saved as evidence "
            "from today's completed class."
        )

        st.balloons()

    except Exception as e:

        st.error(
            "Submission could not be saved."
        )

        st.exception(e)

    finally:

        st.session_state.submission_in_progress = False
