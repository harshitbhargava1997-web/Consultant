import streamlit as st
import pandas as pd
import re
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed

from supabase import create_client
import boto3
from boto3.s3.transfer import TransferConfig


# ============================================================
# PAGE CONFIG
# ============================================================

st.set_page_config(
    page_title="Teacher Daily Implementation Reflection Portal",
    page_icon="📝",
    layout="centered",
    initial_sidebar_state="collapsed"
)


# ============================================================
# CONFIGURATION
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
    "Grade 5",
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
    "Play Based",
]


IMPLEMENTATION_OPTIONS = [
    "Lesson Plan",
    "Classroom Activity Conducted",
    "Student Written Work / Writing Practice",
    "Phonics / Phonetics Implementation",
    "Student Assessment",
    "Teacher Portfolio",
]


IMPLEMENTATION_DESCRIPTIONS = {
    "Lesson Plan":
        "Share a reflection and upload the lesson plan as a PDF or picture.",

    "Classroom Activity Conducted":
        "Share a reflection and upload pictures or a video of the classroom activity.",

    "Student Written Work / Writing Practice":
        "Share a reflection and upload pictures of the students' written work or writing practice.",

    "Phonics / Phonetics Implementation":
        "Share a reflection and upload pictures or videos of the phonics activity or implementation.",

    "Student Assessment":
        "Share a reflection and upload pictures or files of the assessment.",

    "Teacher Portfolio":
        "Share a reflection and upload the relevant portfolio material.",
}


# ============================================================
# SUPABASE
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
# CLOUDFLARE R2
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
# HELPER FUNCTIONS
# ============================================================

def sanitize_path_component(value):
    """
    Makes names safe for use inside R2 paths.
    """
    if value is None:
        return "unknown"

    value = str(value).strip()

    if not value:
        return "unknown"

    value = re.sub(r"\s+", "_", value)
    value = re.sub(r"[^A-Za-z0-9_\-\.]", "_", value)

    return value[:150]


def get_file_size_bytes(uploaded_file):
    """
    Returns uploaded file size without permanently changing
    its current file pointer.
    """
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


def get_file_size_mb(uploaded_file):
    return get_file_size_bytes(uploaded_file) / (1024 * 1024)


def split_teacher_name(full_name):
    """
    Splits teacher name into FirstName and LastName.
    """
    full_name = str(full_name).strip()

    if not full_name:
        return "", ""

    parts = full_name.split()

    if len(parts) == 1:
        return parts[0], ""

    return parts[0], " ".join(parts[1:])


def clean_dataframe(df):
    if df is None or df.empty:
        return pd.DataFrame()

    df = df.copy()

    for column in df.columns:
        if df[column].dtype == "object":
            df[column] = df[column].fillna("").astype(str).str.strip()

    return df


# ============================================================
# FETCH MASTER ROSTER
# ============================================================

@st.cache_data(ttl=300)
def fetch_master_db_from_supabase():

    all_rows = []
    page_size = 1000
    offset = 0

    columns = (
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
            .select(columns)
            .range(offset, offset + page_size - 1)
            .execute()
        )

        rows = response.data or []

        if not rows:
            break

        all_rows.extend(rows)

        if len(rows) < page_size:
            break

        offset += page_size

    if not all_rows:
        return pd.DataFrame(
            columns=[
                "State_Zone",
                "Uploaded_By",
                "Institution",
                "FullName",
                "Role"
            ]
        )

    df = pd.DataFrame(all_rows)

    df = clean_dataframe(df)

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

    try:

        if uploaded_file is None:
            return {
                "success": False,
                "error": "No file provided.",
                "file_name": "",
                "category": category,
                "group_number": group_number,
                "path": ""
            }

        file_size = get_file_size_bytes(uploaded_file)

        if file_size > MAX_FILE_SIZE_BYTES:
            return {
                "success": False,
                "error": (
                    f"{uploaded_file.name} exceeds the "
                    f"{MAX_FILE_SIZE_MB} MB limit."
                ),
                "file_name": uploaded_file.name,
                "category": category,
                "group_number": group_number,
                "path": ""
            }

        original_name = uploaded_file.name or "uploaded_file"

        safe_filename = sanitize_path_component(original_name)

        unique_prefix = uuid.uuid4().hex[:12]

        final_filename = (
            f"{unique_prefix}_{safe_filename}"
        )

        object_key = (
            f"{folder_name}/{final_filename}"
        )

        uploaded_file.seek(0)

        content_type = (
            uploaded_file.type
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
            "error": "",
            "file_name": original_name,
            "category": category,
            "group_number": group_number,
            "path": object_key
        }

    except Exception as e:

        return {
            "success": False,
            "error": str(e),
            "file_name": getattr(
                uploaded_file,
                "name",
                ""
            ),
            "category": category,
            "group_number": group_number,
            "path": ""
        }


def upload_all_files_parallel(upload_jobs):

    results = []

    if not upload_jobs:
        return results

    with ThreadPoolExecutor(
        max_workers=MAX_PARALLEL_UPLOADS
    ) as executor:

        future_map = {}

        for job in upload_jobs:

            future = executor.submit(
                upload_file_to_r2,
                job["uploaded_file"],
                job["folder_name"],
                job["category"],
                job["group_number"]
            )

            future_map[future] = job

        for future in as_completed(future_map):

            try:
                result = future.result()

            except Exception as e:

                job = future_map[future]

                result = {
                    "success": False,
                    "error": str(e),
                    "file_name": getattr(
                        job["uploaded_file"],
                        "name",
                        ""
                    ),
                    "category": job["category"],
                    "group_number": job["group_number"],
                    "path": ""
                }

            results.append(result)

    return results


# ============================================================
# DATABASE INSERT
# ============================================================

def insert_implementation_to_db(
    state_zone,
    uploaded_by,
    institution,
    teacher_name,
    group_data,
    implementation_paths,
):

    first_name, last_name = split_teacher_name(
        teacher_name
    )

    now_date = group_data["date"]

    entry = {
        "State_Zone": state_zone,
        "Uploaded_By": uploaded_by,
        "Institution": institution,
        "Center": institution,

        "FirstName": first_name,
        "LastName": last_name,
        "FullName": teacher_name,

        "Role": "Teacher",
        "Type": "Classroom Reflection",

        "Grade": group_data["grade"],
        "Subject": group_data["subject"],
        "Book": group_data["lesson_name"],

        "StartTime": "09:00",
        "EndTime": "09:45",
        "Duration_Min": 0.0,

        "Voice_Note_Link": implementation_paths.get(
            "voice",
            ""
        ),

        "Lesson_Plan_Picture": implementation_paths.get(
            "lesson_plan",
            ""
        ),

        "Video_Evidence_1": implementation_paths.get(
            "activity",
            ""
        ),

        "Video_Evidence_2": "",
        "Video_Evidence_3": "",

        "Writing_Sample_Link": implementation_paths.get(
            "writing",
            ""
        ),

        "Student_Assessment_Link": implementation_paths.get(
            "assessment",
            ""
        ),

        "Phonics_Evidence_Link": implementation_paths.get(
            "phonics",
            ""
        ),

        "Portfolio_Evidence_Link": implementation_paths.get(
            "portfolio",
            ""
        ),

        "Assessment_Score_Pct": None,
    }

    response = (
        supabase
        .table(TEACHER_RECORDS_TABLE)
        .insert(entry)
        .execute()
    )

    return response


# ============================================================
# SESSION STATE
# ============================================================

if "implementation_group_count" not in st.session_state:
    st.session_state.implementation_group_count = 1


# ============================================================
# PAGE HEADER
# ============================================================

st.title("📝 Teacher Daily Implementation Reflection Portal")

st.markdown(
    """
Use this space to share your daily classroom implementation,
learning reflections, and related classroom materials.
"""
)


# ============================================================
# LOAD ROSTER
# ============================================================

try:

    master_df = fetch_master_db_from_supabase()

except Exception as e:

    st.error(
        "Unable to load the teacher information right now."
    )

    st.exception(e)

    st.stop()


if master_df.empty:

    st.warning(
        "No teacher information is currently available."
    )

    st.stop()


# ============================================================
# TEACHER DETAILS
# ============================================================

st.markdown("### 👤 Teacher Details")


state_options = sorted(
    [
        x for x in master_df["State_Zone"].dropna().unique()
        if str(x).strip()
    ]
)

selected_state = st.selectbox(
    "State / Zone",
    ["Select State / Zone"] + state_options,
    key="teacher_state"
)


if selected_state == "Select State / Zone":

    st.info(
        "Please select your State / Zone to continue."
    )

    st.stop()


state_df = master_df[
    master_df["State_Zone"] == selected_state
].copy()


consultant_options = sorted(
    [
        x for x in state_df["Uploaded_By"].dropna().unique()
        if str(x).strip()
    ]
)

selected_consultant = st.selectbox(
    "Consultant",
    ["Select Consultant"] + consultant_options,
    key="teacher_consultant"
)


if selected_consultant == "Select Consultant":

    st.info(
        "Please select the Consultant to continue."
    )

    st.stop()


consultant_df = state_df[
    state_df["Uploaded_By"] == selected_consultant
].copy()


school_options = sorted(
    [
        x for x in consultant_df["Institution"].dropna().unique()
        if str(x).strip()
    ]
)

selected_school = st.selectbox(
    "School",
    ["Select School"] + school_options,
    key="teacher_school"
)


if selected_school == "Select School":

    st.info(
        "Please select your school to continue."
    )

    st.stop()


school_df = consultant_df[
    consultant_df["Institution"] == selected_school
].copy()


teacher_df = school_df[
    school_df["Role"]
    .fillna("")
    .astype(str)
    .str.lower()
    .isin(["teacher", "teachers"])
].copy()


teacher_options = sorted(
    [
        x for x in teacher_df["FullName"].dropna().unique()
        if str(x).strip()
    ]
)


if not teacher_options:

    st.warning(
        "No teachers were found for the selected school."
    )

    st.stop()


selected_teacher = st.selectbox(
    "Teacher Name",
    ["Select Teacher"] + teacher_options,
    key="teacher_name"
)


if selected_teacher == "Select Teacher":

    st.info(
        "Please select your name to continue."
    )

    st.stop()


implementation_date = st.date_input(
    "Implementation Date",
    key="implementation_date"
)


# ============================================================
# MAIN IMPLEMENTATION GROUP FUNCTION
# ============================================================

def render_implementation_group(group_number):

    st.divider()

    st.markdown(
        f"## 📚 Implementation Group {group_number}"
    )

    st.caption(
        "Add the details for one class, subject, lesson, "
        "or classroom implementation."
    )

    # --------------------------------------------------------
    # CLASS DETAILS
    # --------------------------------------------------------

    grade = st.selectbox(
        "Grade",
        GRADE_OPTIONS,
        key=f"grade_{group_number}"
    )

    subject = st.selectbox(
        "Subject",
        SUBJECT_OPTIONS,
        key=f"subject_{group_number}"
    )

    lesson_name = st.text_input(
        "Lesson Plan No. & Topic / Chapter",
        placeholder=(
            "Example: Lesson Plan 5 – Plants Around Us"
        ),
        key=f"lesson_name_{group_number}"
    )

    # --------------------------------------------------------
    # VOICE REFLECTION
    # --------------------------------------------------------

    st.markdown("### 🎙️ Record Your Reflection")

    st.markdown(
        """
Please record a brief voice note about your planned
classroom implementation.
"""
    )

    recorded_audio = st.audio_input(
        "🎙️ Record Your Reflection",
        sample_rate=16000,
        key=f"recorded_audio_{group_number}"
    )

    if recorded_audio is not None:

        st.audio(
            recorded_audio,
            format=recorded_audio.type
            or "audio/wav"
        )

    st.markdown("#### How to record your voice note")

    st.info(
        """
Please briefly share your reflection in this order:

**What**
- Grade
- Subject
- Lesson Plan No. & Topic/Chapter

**Why — Skill / Learning Objective**
- What do I want students to learn or be able to do?
- Think about Bloom’s Taxonomy: Remembering, Understanding,
  Applying, Analysing, Evaluating, Creating.

**Teacher Activity (How)**
- How will I teach?
- Which digital or physical resources will I use?

**Student Activity**
- What will students do or participate in?

**Practice & Apply**
- What will students do in the Course Book/Workbook?
- Mention the specific topic, section, or page number.
- Include any classwork or homework activity.

**Review**
- How will I check students’ learning?

Remember: the purpose is not only to tell what you are
going to do, but also to think about **why** you are doing it
and **how** it will support student learning.
"""
    )

    st.markdown("#### Or upload an existing voice note")

    uploaded_voice_note = st.file_uploader(
        "Upload Voice Note",
        type=[
            "mp3",
            "wav",
            "m4a",
            "aac",
            "ogg",
            "webm"
        ],
        key=f"uploaded_voice_{group_number}",
        label_visibility="collapsed"
    )

    # --------------------------------------------------------
    # CLASSROOM IMPLEMENTATION & LEARNING REFLECTIONS
    # --------------------------------------------------------

    st.markdown(
        "### 📸 Classroom Implementation & Learning Reflections"
    )

    st.markdown(
        """
Share a reflection related to your classroom implementation
and learning. Select the area you would like to reflect on
and share the relevant details, pictures, or videos.
"""
    )

    st.markdown("#### Classroom Implementation Materials")

    st.caption(
        """
You can share materials such as lesson plans, classroom
activities, student written work, phonics/phonetics
implementation, student assessments, and teacher portfolio
materials. You can add more than one area for the same class.
"""
    )

    # --------------------------------------------------------
    # DYNAMIC IMPLEMENTATION AREAS
    # --------------------------------------------------------

    area_key = f"areas_{group_number}"

    if area_key not in st.session_state:
        st.session_state[area_key] = [
            {
                "id": uuid.uuid4().hex[:8],
                "type": None
            }
        ]

    areas = st.session_state[area_key]

    areas_to_remove = []

    for area_index, area in enumerate(areas):

        unique_id = area["id"]

        st.markdown(
            f"#### Implementation Material {area_index + 1}"
        )

        selected_area = st.selectbox(
            "Select an area to reflect on",
            ["Select an area"] + IMPLEMENTATION_OPTIONS,
            index=(
                IMPLEMENTATION_OPTIONS.index(area["type"]) + 1
                if area.get("type") in IMPLEMENTATION_OPTIONS
                else 0
            ),
            key=(
                f"implementation_type_"
                f"{group_number}_"
                f"{unique_id}"
            )
        )

        if selected_area == "Select an area":

            area["type"] = None

        else:

            area["type"] = selected_area

            st.caption(
                IMPLEMENTATION_DESCRIPTIONS[
                    selected_area
                ]
            )

            # --------------------------------------------
            # REFLECTION DETAILS
            # --------------------------------------------

            reflection_text = st.text_area(
                "Reflection / Details",
                placeholder=(
                    "Briefly share what you implemented, "
                    "what students did, or what you observed."
                ),
                key=(
                    f"reflection_text_"
                    f"{group_number}_"
                    f"{unique_id}"
                ),
                height=100
            )

            area["reflection_text"] = reflection_text

            # --------------------------------------------
            # FILE TYPES
            # --------------------------------------------

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
                        f"files_lesson_plan_"
                        f"{group_number}_"
                        f"{unique_id}"
                    )
                )

            elif selected_area == "Classroom Activity Conducted":

                files = st.file_uploader(
                    "Upload Classroom Activity Pictures / Video",
                    type=[
                        "jpg",
                        "jpeg",
                        "png",
                        "webp",
                        "mp4",
                        "mov",
                        "avi",
                        "m4v",
                        "webm"
                    ],
                    accept_multiple_files=True,
                    key=(
                        f"files_activity_"
                        f"{group_number}_"
                        f"{unique_id}"
                    )
                )

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
                        f"files_writing_"
                        f"{group_number}_"
                        f"{unique_id}"
                    )
                )

            elif selected_area == (
                "Phonics / Phonetics Implementation"
            ):

                files = st.file_uploader(
                    "Upload Phonics / Phonetics Pictures or Videos",
                    type=[
                        "jpg",
                        "jpeg",
                        "png",
                        "webp",
                        "mp4",
                        "mov",
                        "avi",
                        "m4v",
                        "webm"
                    ],
                    accept_multiple_files=True,
                    key=(
                        f"files_phonics_"
                        f"{group_number}_"
                        f"{unique_id}"
                    )
                )

            elif selected_area == "Student Assessment":

                files = st.file_uploader(
                    "Upload Student Assessment",
                    type=[
                        "jpg",
                        "jpeg",
                        "png",
                        "webp",
                        "pdf",
                        "doc",
                        "docx",
                        "xlsx",
                        "xls"
                    ],
                    accept_multiple_files=True,
                    key=(
                        f"files_assessment_"
                        f"{group_number}_"
                        f"{unique_id}"
                    )
                )

            elif selected_area == "Teacher Portfolio":

                files = st.file_uploader(
                    "Upload Teacher Portfolio Material",
                    type=[
                        "jpg",
                        "jpeg",
                        "png",
                        "webp",
                        "pdf",
                        "doc",
                        "docx",
                        "xlsx",
                        "xls",
                        "ppt",
                        "pptx"
                    ],
                    accept_multiple_files=True,
                    key=(
                        f"files_portfolio_"
                        f"{group_number}_"
                        f"{unique_id}"
                    )
                )

            else:

                files = []

            area["files"] = files or []

            # --------------------------------------------
            # FILE PREVIEW
            # --------------------------------------------

            if area["files"]:

                st.caption(
                    f"{len(area['files'])} file(s) selected."
                )

                for file in area["files"]:

                    size_mb = get_file_size_mb(file)

                    if size_mb > MAX_FILE_SIZE_MB:

                        st.error(
                            f"{file.name} is {size_mb:.1f} MB. "
                            f"The maximum allowed size is "
                            f"{MAX_FILE_SIZE_MB} MB."
                        )

                    else:

                        st.write(
                            f"📎 {file.name} "
                            f"({size_mb:.1f} MB)"
                        )

        # --------------------------------------------
        # REMOVE AREA
        # --------------------------------------------

        if len(areas) > 1:

            if st.button(
                "Remove this area",
                key=(
                    f"remove_area_"
                    f"{group_number}_"
                    f"{unique_id}"
                )
            ):

                areas_to_remove.append(
                    unique_id
                )

    # Remove requested areas
    if areas_to_remove:

        st.session_state[area_key] = [
            area
            for area in areas
            if area["id"] not in areas_to_remove
        ]

        st.rerun()

    # --------------------------------------------------------
    # ADD ANOTHER AREA
    # --------------------------------------------------------

    if st.button(
        "➕ Add Another Area",
        key=f"add_area_{group_number}"
    ):

        if len(areas) >= len(IMPLEMENTATION_OPTIONS):

            st.warning(
                "All available areas have already been added."
            )

        else:

            areas.append(
                {
                    "id": uuid.uuid4().hex[:8],
                    "type": None
                }
            )

            st.rerun()

    # --------------------------------------------------------
    # RETURN DATA
    # --------------------------------------------------------

    return {
        "group_number": group_number,
        "grade": grade,
        "subject": subject,
        "lesson_name": lesson_name.strip(),
        "date": implementation_date,
        "recorded_audio": recorded_audio,
        "uploaded_voice_note": uploaded_voice_note,
        "areas": areas,
    }


# ============================================================
# RENDER ALL IMPLEMENTATION GROUPS
# ============================================================

all_groups = []

for group_number in range(
    1,
    st.session_state.implementation_group_count + 1
):

    group_data = render_implementation_group(
        group_number
    )

    all_groups.append(group_data)


# ============================================================
# ADD ANOTHER CLASS / IMPLEMENTATION
# ============================================================

st.divider()

if (
    st.session_state.implementation_group_count
    < MAX_IMPLEMENTATION_GROUPS
):

    if st.button(
        "➕ Add Another Class / Implementation",
        use_container_width=True
    ):

        st.session_state.implementation_group_count += 1

        st.rerun()

else:

    st.info(
        f"You can add up to {MAX_IMPLEMENTATION_GROUPS} "
        "classes / implementations at one time."
    )


# ============================================================
# REMOVE LAST GROUP
# ============================================================

if st.session_state.implementation_group_count > 1:

    if st.button(
        "Remove Last Class / Implementation"
    ):

        group_to_remove = (
            st.session_state.implementation_group_count
        )

        area_key = f"areas_{group_to_remove}"

        if area_key in st.session_state:
            del st.session_state[area_key]

        st.session_state.implementation_group_count -= 1

        st.rerun()


# ============================================================
# FILE SIZE NOTE
# ============================================================

st.caption(
    f"Maximum file size: {MAX_FILE_SIZE_MB} MB per file."
)


# ============================================================
# FINAL SUBMISSION
# ============================================================

st.divider()

st.markdown(
    "### 🚀 Share Your Daily Implementation"
)

st.markdown(
    """
Please review the class details and selected materials
before sharing your implementation.
"""
)


if st.button(
    "Submit Daily Implementation",
    type="primary",
    use_container_width=True
):

    # --------------------------------------------------------
    # BASIC VALIDATION
    # --------------------------------------------------------

    validation_errors = []

    if not selected_state:
        validation_errors.append(
            "Please select State / Zone."
        )

    if not selected_consultant:
        validation_errors.append(
            "Please select Consultant."
        )

    if not selected_school:
        validation_errors.append(
            "Please select School."
        )

    if not selected_teacher:
        validation_errors.append(
            "Please select Teacher Name."
        )

    if not all_groups:

        validation_errors.append(
            "Please add at least one implementation."
        )

    for group in all_groups:

        if not group["lesson_name"]:

            validation_errors.append(
                f"Implementation Group "
                f"{group['group_number']}: "
                "Please enter Lesson Plan No. & Topic / Chapter."
            )

        # Validate areas
        for area_index, area in enumerate(
            group["areas"]
        ):

            if area.get("type") is None:

                # Empty additional area is ignored
                # if it is the only blank area.
                if (
                    len(group["areas"]) > 1
                    or area_index == 0
                ):
                    validation_errors.append(
                        f"Implementation Group "
                        f"{group['group_number']}: "
                        f"Please select an area for "
                        f"Implementation Material "
                        f"{area_index + 1}, "
                        "or remove the unused area."
                    )

            else:

                files = area.get("files", [])

                for file in files:

                    if (
                        get_file_size_bytes(file)
                        > MAX_FILE_SIZE_BYTES
                    ):

                        validation_errors.append(
                            f"Implementation Group "
                            f"{group['group_number']}: "
                            f"{file.name} exceeds the "
                            f"{MAX_FILE_SIZE_MB} MB limit."
                        )

        # Validate voice note size
        if group["recorded_audio"] is not None:

            if (
                get_file_size_bytes(
                    group["recorded_audio"]
                )
                > MAX_FILE_SIZE_BYTES
            ):

                validation_errors.append(
                    f"Implementation Group "
                    f"{group['group_number']}: "
                    "Recorded voice note exceeds the "
                    f"{MAX_FILE_SIZE_MB} MB limit."
                )

        if group["uploaded_voice_note"] is not None:

            if (
                get_file_size_bytes(
                    group["uploaded_voice_note"]
                )
                > MAX_FILE_SIZE_BYTES
            ):

                validation_errors.append(
                    f"Implementation Group "
                    f"{group['group_number']}: "
                    "Uploaded voice note exceeds the "
                    f"{MAX_FILE_SIZE_MB} MB limit."
                )

    if validation_errors:

        for error in validation_errors:
            st.error(error)

        st.stop()

    # --------------------------------------------------------
    # SUBMISSION ID
    # --------------------------------------------------------

    submission_id = uuid.uuid4().hex[:12]

    school_path = sanitize_path_component(
        selected_school
    )

    teacher_path = sanitize_path_component(
        selected_teacher
    )

    date_path = implementation_date.strftime(
        "%Y-%m-%d"
    )

    submission_base = (
        f"schools/{school_path}/"
        f"teachers/{teacher_path}/"
        f"{date_path}/"
        f"submission_{submission_id}"
    )

    # --------------------------------------------------------
    # PREPARE ALL UPLOAD JOBS
    # --------------------------------------------------------

    upload_jobs = []

    group_upload_metadata = {}

    for group in all_groups:

        group_number = group["group_number"]

        group_base = (
            f"{submission_base}/"
            f"implementation_{group_number}"
        )

        group_upload_metadata[group_number] = {
            "group_base": group_base,
            "voice": [],
            "lesson_plan": [],
            "activity": [],
            "writing": [],
            "phonics": [],
            "assessment": [],
            "portfolio": [],
        }

        # --------------------------------------------
        # RECORDED VOICE
        # --------------------------------------------

        if group["recorded_audio"] is not None:

            upload_jobs.append(
                {
                    "uploaded_file":
                        group["recorded_audio"],

                    "folder_name":
                        f"{group_base}/voice_notes",

                    "category":
                        "voice",

                    "group_number":
                        group_number,
                }
            )

        # --------------------------------------------
        # UPLOADED VOICE
        # --------------------------------------------

        if group["uploaded_voice_note"] is not None:

            upload_jobs.append(
                {
                    "uploaded_file":
                        group["uploaded_voice_note"],

                    "folder_name":
                        f"{group_base}/voice_notes",

                    "category":
                        "voice",

                    "group_number":
                        group_number,
                }
            )

        # --------------------------------------------
        # CLASSROOM IMPLEMENTATION MATERIALS
        # --------------------------------------------

        for area in group["areas"]:

            area_type = area.get("type")

            if not area_type:
                continue

            files = area.get("files", [])

            if area_type == "Lesson Plan":

                category = "lesson_plan"
                folder = "lesson_plans"

            elif area_type == "Classroom Activity Conducted":

                category = "activity"
                folder = "activity_videos"

            elif area_type == (
                "Student Written Work / Writing Practice"
            ):

                category = "writing"
                folder = "student_work"

            elif area_type == (
                "Phonics / Phonetics Implementation"
            ):

                category = "phonics"
                folder = "phonics"

            elif area_type == "Student Assessment":

                category = "assessment"
                folder = "student_assessments"

            elif area_type == "Teacher Portfolio":

                category = "portfolio"
                folder = "teacher_portfolio"

            else:

                continue

            for file in files:

                upload_jobs.append(
                    {
                        "uploaded_file": file,

                        "folder_name":
                            f"{group_base}/{folder}",

                        "category": category,

                        "group_number":
                            group_number,
                    }
                )

    # --------------------------------------------------------
    # UPLOAD
    # --------------------------------------------------------

    progress_placeholder = st.empty()

    progress_placeholder.info(
        f"Uploading {len(upload_jobs)} file(s)..."
    )

    upload_results = upload_all_files_parallel(
        upload_jobs
    )

    # --------------------------------------------------------
    # CHECK UPLOAD RESULTS
    # --------------------------------------------------------

    failed_uploads = [
        result
        for result in upload_results
        if not result["success"]
    ]

    if failed_uploads:

        progress_placeholder.empty()

        st.error(
            "Some files could not be uploaded. "
            "No database records were created."
        )

        for result in failed_uploads:

            st.error(
                f"{result.get('file_name', 'File')}: "
                f"{result.get('error', 'Unknown error')}"
            )

        st.stop()

    # --------------------------------------------------------
    # COLLECT UPLOAD PATHS
    # --------------------------------------------------------

    for result in upload_results:

        if not result["success"]:
            continue

        group_number = result["group_number"]
        category = result["category"]
        path = result["path"]

        if group_number not in group_upload_metadata:
            continue

        if category not in group_upload_metadata[
            group_number
        ]:
            continue

        group_upload_metadata[
            group_number
        ][category].append(path)

    # --------------------------------------------------------
    # CREATE DATABASE ROWS
    # --------------------------------------------------------

    inserted_groups = 0

    database_errors = []

    for group in all_groups:

        group_number = group["group_number"]

        metadata = group_upload_metadata[
            group_number
        ]

        def join_paths(category):

            paths = metadata.get(
                category,
                []
            )

            return ",".join(paths)

        implementation_paths = {
            "voice":
                join_paths("voice"),

            "lesson_plan":
                join_paths("lesson_plan"),

            "activity":
                join_paths("activity"),

            "writing":
                join_paths("writing"),

            "phonics":
                join_paths("phonics"),

            "assessment":
                join_paths("assessment"),

            "portfolio":
                join_paths("portfolio"),
        }

        try:

            insert_implementation_to_db(
                state_zone=selected_state,
                uploaded_by=selected_consultant,
                institution=selected_school,
                teacher_name=selected_teacher,
                group_data=group,
                implementation_paths=
                    implementation_paths,
            )

            inserted_groups += 1

        except Exception as e:

            database_errors.append(
                {
                    "group": group_number,
                    "error": str(e)
                }
            )

    progress_placeholder.empty()

    # --------------------------------------------------------
    # FINAL RESULT
    # --------------------------------------------------------

    if database_errors:

        st.error(
            "The files were uploaded, but some implementation "
            "records could not be saved to the database."
        )

        for item in database_errors:

            st.error(
                f"Implementation Group "
                f"{item['group']}: "
                f"{item['error']}"
            )

        st.stop()

    # Clear cache so the next page load can get fresh data
    try:
        fetch_master_db_from_supabase.clear()
    except Exception:
        pass

    st.success(
        f"Your daily implementation has been shared successfully "
        f"for {inserted_groups} class(es)."
    )

    st.info(
        f"Implementation reference: {submission_id}"
    )

    st.balloons()

    # Reset number of groups for next submission
    st.session_state.implementation_group_count = 1
