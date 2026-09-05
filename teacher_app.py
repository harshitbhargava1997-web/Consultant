import os
import io
import json
import uuid
import hashlib
from datetime import datetime, date
from typing import Any, Dict, List, Optional

import streamlit as st
import pandas as pd

# Optional dependencies
try:
    from supabase import create_client, Client
except Exception:
    create_client = None
    Client = Any

try:
    import boto3
    from boto3.s3.transfer import TransferConfig
except Exception:
    boto3 = None
    TransferConfig = None

try:
    from openai import OpenAI
except Exception:
    OpenAI = None


# ============================================================
# PAGE CONFIG
# ============================================================

st.set_page_config(
    page_title="Teacher Professional Development",
    page_icon="🎓",
    layout="wide",
    initial_sidebar_state="expanded",
)


# ============================================================
# CONFIGURATION
# ============================================================

APP_NAME = "Teacher Professional Development"
APP_VERSION = "1.0.0"

MAX_AUDIO_MB = 50

DEFAULT_AI_MODEL = "gpt-4o-mini"
DEFAULT_TRANSCRIPTION_MODEL = "whisper-1"

IMPLEMENTATION_PORTAL_URL = os.getenv(
    "IMPLEMENTATION_PORTAL_URL",
    ""
)


# ============================================================
# SECRETS / ENVIRONMENT HELPERS
# ============================================================

def get_secret(name: str, default: str = "") -> str:
    """
    Read from Streamlit secrets first, then environment variables.
    """
    try:
        if name in st.secrets:
            return str(st.secrets[name])
    except Exception:
        pass

    return os.getenv(name, default)


SUPABASE_URL = get_secret("SUPABASE_URL")
SUPABASE_KEY = get_secret("SUPABASE_KEY")

R2_ACCOUNT_ID = get_secret("R2_ACCOUNT_ID")
R2_ACCESS_KEY_ID = get_secret("R2_ACCESS_KEY_ID")
R2_SECRET_ACCESS_KEY = get_secret("R2_SECRET_ACCESS_KEY")
R2_BUCKET_NAME = get_secret("R2_BUCKET_NAME")
R2_ENDPOINT_URL = get_secret(
    "R2_ENDPOINT_URL",
    f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
    if R2_ACCOUNT_ID
    else ""
)

OPENAI_API_KEY = get_secret("OPENAI_API_KEY")
OPENAI_MODEL = get_secret("OPENAI_MODEL", DEFAULT_AI_MODEL)
TRANSCRIPTION_MODEL = get_secret(
    "TRANSCRIPTION_MODEL",
    DEFAULT_TRANSCRIPTION_MODEL
)

ADMIN_PASSWORD = get_secret("ADMIN_PASSWORD")


# ============================================================
# SESSION STATE
# ============================================================

def init_state():

    defaults = {
        "role": "Teacher",
        "teacher_name": "",
        "teacher_school": "",
        "teacher_state": "",
        "teacher_consultant": "",
        "current_page": "Dashboard",

        "module_id": "module_1",
        "module_stage": "learning",

        "reflection_id": None,
        "reflection_draft": {},
        "reflection_transcript": "",
        "reflection_audio_path": "",
        "reflection_extraction": None,
        "reflection_evaluation": None,

        "quiz_answers": {},
        "quiz_submitted": False,
        "quiz_score": None,

        "final_answers": {},
        "final_submitted": False,
        "final_score": None,

        "admin_authenticated": False,
    }

    for key, value in defaults.items():
        if key not in st.session_state:
            st.session_state[key] = value


init_state()


# ============================================================
# CSS
# ============================================================

st.markdown(
    """
<style>

.block-container {
    padding-top: 1.5rem;
    padding-bottom: 3rem;
}

.main-title {
    font-size: 2.2rem;
    font-weight: 700;
    margin-bottom: 0.2rem;
}

.subtitle {
    color: #666;
    font-size: 1rem;
    margin-bottom: 1.5rem;
}

.card {
    padding: 1.2rem;
    border-radius: 14px;
    border: 1px solid rgba(128,128,128,0.25);
    margin-bottom: 1rem;
    background: rgba(128,128,128,0.04);
}

.learning-card {
    padding: 1.4rem;
    border-radius: 16px;
    border: 1px solid rgba(128,128,128,0.25);
    margin-bottom: 1.2rem;
}

.big-number {
    font-size: 2rem;
    font-weight: 700;
}

.stage {
    padding: 0.5rem 0.8rem;
    border-radius: 10px;
    border: 1px solid rgba(128,128,128,0.25);
    text-align: center;
}

.feedback-good {
    padding: 1rem;
    border-radius: 12px;
    border: 1px solid rgba(0,128,0,0.25);
    margin-bottom: 0.8rem;
}

.feedback-think {
    padding: 1rem;
    border-radius: 12px;
    border: 1px solid rgba(255,165,0,0.35);
    margin-bottom: 0.8rem;
}

</style>
""",
    unsafe_allow_html=True
)


# ============================================================
# SUPABASE
# ============================================================

@st.cache_resource
def get_supabase():
    if not SUPABASE_URL or not SUPABASE_KEY:
        return None

    if create_client is None:
        return None

    try:
        return create_client(
            SUPABASE_URL,
            SUPABASE_KEY
        )
    except Exception as e:
        st.error(f"Supabase connection error: {e}")
        return None


supabase = get_supabase()


# ============================================================
# R2
# ============================================================

@st.cache_resource
def get_r2_client():

    if not all([
        R2_ACCOUNT_ID,
        R2_ACCESS_KEY_ID,
        R2_SECRET_ACCESS_KEY,
        R2_BUCKET_NAME,
        R2_ENDPOINT_URL
    ]):
        return None

    if boto3 is None:
        return None

    try:
        return boto3.client(
            "s3",
            endpoint_url=R2_ENDPOINT_URL,
            aws_access_key_id=R2_ACCESS_KEY_ID,
            aws_secret_access_key=R2_SECRET_ACCESS_KEY,
            region_name="auto"
        )
    except Exception as e:
        st.error(f"R2 connection error: {e}")
        return None


r2_client = get_r2_client()


# ============================================================
# OPENAI
# ============================================================

@st.cache_resource
def get_openai_client():

    if not OPENAI_API_KEY:
        return None

    if OpenAI is None:
        return None

    try:
        return OpenAI(api_key=OPENAI_API_KEY)
    except Exception:
        return None


openai_client = get_openai_client()


def ai_available() -> bool:
    return openai_client is not None


# ============================================================
# UTILITY FUNCTIONS
# ============================================================

def now_iso() -> str:
    return datetime.utcnow().isoformat()


def safe_filename(filename: str) -> str:
    filename = filename or "audio.wav"

    allowed = (
        "abcdefghijklmnopqrstuvwxyz"
        "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
        "0123456789"
        "-_."
    )

    cleaned = "".join(
        c if c in allowed else "_"
        for c in filename
    )

    return cleaned


def make_unique_id() -> str:
    return str(uuid.uuid4())


def calculate_score(correct: int, total: int) -> int:
    if total == 0:
        return 0

    return round((correct / total) * 100)


def json_dumps(data: Any) -> str:
    return json.dumps(
        data,
        ensure_ascii=False,
        indent=2
    )


# ============================================================
# R2 STORAGE
# ============================================================

def upload_audio_to_r2(
    audio_bytes: bytes,
    teacher_name: str,
    module_id: str,
    filename: str
) -> Optional[str]:

    unique_id = make_unique_id()

    teacher_slug = safe_filename(
        teacher_name.replace(" ", "_")
    )

    date_folder = date.today().isoformat()

    extension = ".wav"

    if "." in filename:
        extension = "." + filename.split(".")[-1]

    object_key = (
        f"pd/"
        f"{module_id}/"
        f"{teacher_slug}/"
        f"{date_folder}/"
        f"{unique_id}_voice_note{extension}"
    )

    # Demo mode
    if r2_client is None:

        return (
            f"demo://r2/{object_key}"
        )

    try:

        file_obj = io.BytesIO(audio_bytes)

        config = None

        if TransferConfig:
            config = TransferConfig(
                multipart_threshold=8 * 1024 * 1024,
                multipart_chunksize=8 * 1024 * 1024,
                max_concurrency=5,
                use_threads=True
            )

        kwargs = {
            "Fileobj": file_obj,
            "Bucket": R2_BUCKET_NAME,
            "Key": object_key,
            "ExtraArgs": {
                "ContentType": "audio/wav"
            }
        }

        if config:
            kwargs["Config"] = config

        r2_client.upload_fileobj(**kwargs)

        return object_key

    except Exception as e:

        st.error(
            f"Audio upload failed: {e}"
        )

        return None


# ============================================================
# TRANSCRIPTION
# ============================================================

def transcribe_audio(
    audio_bytes: bytes,
    filename: str
) -> str:

    if openai_client is None:

        return (
            "DEMO TRANSCRIPT\n\n"
            "The teacher explains the lesson objective, "
            "introduces the topic using digital and physical "
            "resources, gives students an opportunity to "
            "participate, provides workbook practice, and "
            "checks learning through questions."
        )

    try:

        audio_file = io.BytesIO(audio_bytes)
        audio_file.name = safe_filename(filename)

        result = openai_client.audio.transcriptions.create(
            model=TRANSCRIPTION_MODEL,
            file=audio_file
        )

        return getattr(
            result,
            "text",
            str(result)
        )

    except Exception as e:

        raise RuntimeError(
            f"Speech-to-text failed: {e}"
        )


# ============================================================
# MODULE 1 CONTENT
# ============================================================

MODULE_1 = {
    "id": "module_1",
    "title": "Foundation of Effective Lesson Planning",
    "description": (
        "Learn how to think pedagogically about an "
        "already-prepared lesson."
    ),
    "duration": "45–60 minutes",
}


LESSON_CONTENT = [

    {
        "title": "What is Effective Lesson Planning?",
        "content": """
A lesson plan is not simply a list of activities.

Effective lesson planning starts with a clear understanding
of what students should learn and how each part of the lesson
will help students reach that learning goal.

Before teaching, ask:

**What do I want students to learn?**

Then ask:

**How will I help them learn it?**

And finally:

**How will I know whether they learned it?**

A strong lesson therefore has alignment between:

**Learning Objective → Teacher Activity → Student Activity → Practice → Review**
"""
    },

    {
        "title": "Why Learning Objectives Matter",
        "content": """
A learning objective describes what students should know,
understand, or be able to do after the learning experience.

A weak objective focuses on what the teacher will do.

Example:

> "I will explain nouns."

A stronger objective focuses on the learner:

> "Students will identify nouns in simple sentences."

An even stronger objective may require application:

> "Students will identify and use nouns in their own sentences."

The key question is:

**What should students be able to do?**
"""
    },

    {
        "title": "Bloom's Taxonomy",
        "content": """
Bloom's Taxonomy helps teachers think about the level of
thinking required from students.

### Remember
Recall information.

### Understand
Explain an idea in their own words.

### Apply
Use learning in a new situation.

### Analyse
Break information into parts and identify relationships.

### Evaluate
Make a judgment using evidence or criteria.

### Create
Produce something new.

Not every lesson needs to reach Create.

The important point is that the teaching activity,
student activity and objective should be aligned.
"""
    },

    {
        "title": "Teacher Activity vs Student Activity",
        "content": """
A common classroom pattern is:

Teacher explains → Students listen.

But learning becomes stronger when students also have
meaningful opportunities to think and participate.

For example:

Teacher Activity:
- Demonstrates how to solve a problem.

Student Activity:
- Students solve a similar problem.
- Students explain their method.
- Students compare answers.

The important question is:

**What are students actually doing?**
"""
    },

    {
        "title": "Practice and Application",
        "content": """
Students need opportunities to practise and apply what
they have learned.

Practice could happen through:

- Course Book
- Workbook
- Classwork
- Pair activity
- Worksheet
- Oral practice
- Demonstration
- Real-world task
- Homework

The practice should connect to the learning objective.

Do not treat workbook completion as the learning objective.
The workbook is a vehicle for practice.
"""
    },

    {
        "title": "Checking Student Learning",
        "content": """
Review is not simply asking:

> "Did everyone understand?"

Instead, collect evidence of learning.

For example:

- Ask students to explain.
- Ask an application question.
- Observe a demonstration.
- Ask students to solve a problem.
- Review written work.
- Use an exit question.
- Conduct a short assessment.

The goal is:

**How will I know what students have learned?**
"""
    },

]


# ============================================================
# MODULE 1 QUIZ
# ============================================================

MODULE_1_QUIZ = [

    {
        "question": (
            "Which is the strongest learning objective?"
        ),
        "options": [
            "I will explain nouns.",
            "I will complete the textbook activity.",
            "Students will identify nouns in simple sentences.",
            "I will show the digital lesson."
        ],
        "answer": 2
    },

    {
        "question": (
            "Which Bloom's level involves using learning "
            "in a new situation?"
        ),
        "options": [
            "Remember",
            "Understand",
            "Apply",
            "Create"
        ],
        "answer": 2
    },

    {
        "question": (
            "Which is the best example of student activity?"
        ),
        "options": [
            "Teacher explains the concept.",
            "Teacher displays a video.",
            "Students discuss and solve a problem.",
            "Teacher writes on the board."
        ],
        "answer": 2
    },

    {
        "question": (
            "Why is review important?"
        ),
        "options": [
            "To finish the lesson faster.",
            "To check evidence of student learning.",
            "To complete the lesson plan.",
            "To give students homework."
        ],
        "answer": 1
    },

    {
        "question": (
            "Which sequence shows strong pedagogical alignment?"
        ),
        "options": [
            "Teacher Activity → Homework → Objective",
            "Objective → Teacher Activity → Student Activity → Review",
            "Workbook → Homework → Teacher Activity",
            "Video → Textbook → Lesson Plan"
        ],
        "answer": 1
    }

]


# ============================================================
# FINAL ASSESSMENT
# ============================================================

FINAL_ASSESSMENT = [

    {
        "question": (
            "A teacher says, 'I will teach addition.' "
            "What is the main weakness?"
        ),
        "options": [
            "It is too short.",
            "It focuses on teacher action rather than student learning.",
            "Addition cannot be taught.",
            "It does not mention homework."
        ],
        "answer": 1
    },

    {
        "question": (
            "Students explain why their answer is correct. "
            "Which Bloom level is most closely involved?"
        ),
        "options": [
            "Remember",
            "Understand",
            "Apply",
            "Create"
        ],
        "answer": 1
    },

    {
        "question": (
            "Which question best checks student learning?"
        ),
        "options": [
            "Did you understand?",
            "Was the lesson interesting?",
            "Can you explain how you got your answer?",
            "Did you complete the page?"
        ],
        "answer": 2
    },

    {
        "question": (
            "Which is an example of meaningful student participation?"
        ),
        "options": [
            "Watching the teacher solve everything.",
            "Copying everything from the board.",
            "Solving, discussing and explaining a task.",
            "Sitting quietly."
        ],
        "answer": 2
    },

    {
        "question": (
            "What should practice be connected to?"
        ),
        "options": [
            "Only homework.",
            "Only textbook completion.",
            "The learning objective.",
            "Only digital content."
        ],
        "answer": 2
    },

    {
        "question": (
            "A teacher uses a video but students only watch it. "
            "What could improve the lesson?"
        ),
        "options": [
            "Make the video longer.",
            "Add meaningful student interaction around the video.",
            "Remove the objective.",
            "Give more homework."
        ],
        "answer": 1
    },

    {
        "question": (
            "Which is the best description of Bloom's Taxonomy?"
        ),
        "options": [
            "A classroom timetable.",
            "A framework for thinking about levels of cognition.",
            "A method for classroom decoration.",
            "A lesson-plan format."
        ],
        "answer": 1
    },

    {
        "question": (
            "What is the teacher's key question before teaching?"
        ),
        "options": [
            "How quickly can I finish?",
            "What do I want students to learn?",
            "How much homework can I give?",
            "How many pages can I cover?"
        ],
        "answer": 1
    },

    {
        "question": (
            "Which is strongest?"
        ),
        "options": [
            "Teacher explains → students listen.",
            "Teacher explains → students practise → teacher checks learning.",
            "Teacher talks → teacher answers.",
            "Teacher plays video → lesson ends."
        ],
        "answer": 1
    },

    {
        "question": (
            "Why should student activity be explicitly planned?"
        ),
        "options": [
            "To keep students busy.",
            "To make the lesson longer.",
            "Because learning requires meaningful student participation.",
            "To reduce teacher work."
        ],
        "answer": 2
    },

]


# ============================================================
# AI EXTRACTION PROMPT
# ============================================================

def extraction_prompt(transcript: str) -> str:

    return f"""
You are an expert teacher educator.

You are analysing a teacher's voice reflection about an
upcoming classroom lesson.

Your job is ONLY to extract what the teacher actually said.

Do not invent missing information.

If something was not mentioned, write exactly:
"Not mentioned"

Do not improve the teacher's answer.

Return ONLY valid JSON.

Required structure:

{{
  "what": {{
    "grade": "",
    "subject": "",
    "lesson_plan_number": "",
    "topic": "",
    "book": "",
    "page_or_section": ""
  }},
  "why": {{
    "learning_objective": "",
    "bloom_level": "",
    "objective_quality": ""
  }},
  "teacher_activity": "",
  "student_activity": "",
  "practice_apply": "",
  "review": ""
}}

Teacher transcript:

---BEGIN TRANSCRIPT---

{transcript}

---END TRANSCRIPT---
"""


# ============================================================
# AI EVALUATION PROMPT
# ============================================================

def evaluation_prompt(reflection: Dict[str, Any]) -> str:

    reflection_json = json_dumps(reflection)

    return f"""
You are an expert pedagogical coach supporting school teachers.

Evaluate the teacher's lesson reflection.

Do not judge the teacher personally.

Evaluate only the pedagogical thinking shown.

Use the following criteria:

1. Learning Objective
2. Bloom's Alignment
3. Teacher Activity
4. Student Activity
5. Practice & Application
6. Review / Checking Learning
7. Overall Pedagogical Alignment

Scoring:
0 = Not demonstrated
1 = Weak
2 = Developing
3 = Good
4 = Strong

Return ONLY valid JSON.

Required structure:

{{
  "learning_objective": {{
    "score": 0,
    "feedback": ""
  }},
  "bloom_alignment": {{
    "score": 0,
    "feedback": ""
  }},
  "teacher_activity": {{
    "score": 0,
    "feedback": ""
  }},
  "student_activity": {{
    "score": 0,
    "feedback": ""
  }},
  "practice_apply": {{
    "score": 0,
    "feedback": ""
  }},
  "review": {{
    "score": 0,
    "feedback": ""
  }},
  "overall_alignment": {{
    "score": 0,
    "feedback": ""
  }},
  "what_you_did_well": [],
  "think_about": [],
  "one_practical_suggestion": "",
  "overall_score": 0
}}

Teacher reflection:

{reflection_json}
"""


# ============================================================
# AI FUNCTIONS
# ============================================================

def extract_reflection(transcript: str) -> Dict[str, Any]:

    if not transcript.strip():
        return {}

    if openai_client is None:

        return {
            "what": {
                "grade": "Not mentioned",
                "subject": "Not mentioned",
                "lesson_plan_number": "Not mentioned",
                "topic": "Not mentioned",
                "book": "Not mentioned",
                "page_or_section": "Not mentioned"
            },
            "why": {
                "learning_objective": (
                    "Students will understand and apply "
                    "the lesson concept."
                ),
                "bloom_level": "Apply",
                "objective_quality": "Developing"
            },
            "teacher_activity": (
                "Teacher will explain the concept using "
                "digital and physical resources."
            ),
            "student_activity": (
                "Students will participate, respond "
                "and practise."
            ),
            "practice_apply": (
                "Students will complete related "
                "Course Book or Workbook practice."
            ),
            "review": (
                "Teacher will ask questions and check "
                "student responses."
            )
        }

    try:

        response = openai_client.chat.completions.create(
            model=OPENAI_MODEL,
            temperature=0,
            response_format={
                "type": "json_object"
            },
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You extract structured information "
                        "from teacher reflections."
                    )
                },
                {
                    "role": "user",
                    "content": extraction_prompt(transcript)
                }
            ]
        )

        content = response.choices[0].message.content

        return json.loads(content)

    except Exception as e:

        raise RuntimeError(
            f"AI extraction failed: {e}"
        )


def evaluate_reflection(
    reflection: Dict[str, Any]
) -> Dict[str, Any]:

    if openai_client is None:

        return {
            "learning_objective": {
                "score": 3,
                "feedback": (
                    "The reflection identifies a "
                    "student-focused objective."
                )
            },
            "bloom_alignment": {
                "score": 3,
                "feedback": (
                    "The Bloom level broadly matches "
                    "the intended learning."
                )
            },
            "teacher_activity": {
                "score": 3,
                "feedback": (
                    "The teacher has identified "
                    "appropriate teaching resources."
                )
            },
            "student_activity": {
                "score": 3,
                "feedback": (
                    "Students have opportunities "
                    "to participate."
                )
            },
            "practice_apply": {
                "score": 3,
                "feedback": (
                    "Practice is connected to "
                    "the lesson."
                )
            },
            "review": {
                "score": 3,
                "feedback": (
                    "The teacher has included "
                    "a way to check learning."
                )
            },
            "overall_alignment": {
                "score": 3,
                "feedback": (
                    "The lesson shows reasonable "
                    "alignment between objective, "
                    "activity and review."
                )
            },
            "what_you_did_well": [
                "You considered student participation.",
                "You included practice.",
                "You included a way to check learning."
            ],
            "think_about": [
                "Make the learning objective more specific.",
                "Consider how students will demonstrate learning."
            ],
            "one_practical_suggestion": (
                "Before starting the lesson, write one sentence "
                "beginning with: 'By the end of this lesson, "
                "students will be able to...'"
            ),
            "overall_score": 75
        }

    try:

        response = openai_client.chat.completions.create(
            model=OPENAI_MODEL,
            temperature=0.2,
            response_format={
                "type": "json_object"
            },
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a supportive pedagogical "
                        "coach for teachers."
                    )
                },
                {
                    "role": "user",
                    "content": evaluation_prompt(
                        reflection
                    )
                }
            ]
        )

        content = response.choices[0].message.content

        return json.loads(content)

    except Exception as e:

        raise RuntimeError(
            f"AI evaluation failed: {e}"
        )


# ============================================================
# DATABASE HELPERS
# ============================================================

def get_teacher_roster() -> pd.DataFrame:

    if supabase is None:
        return pd.DataFrame()

    try:

        response = (
            supabase
            .table("teacher_records")
            .select(
                "State_Zone,Uploaded_By,Institution,"
                "Center,FirstName,LastName,FullName,Role"
            )
            .execute()
        )

        data = response.data or []

        if not data:
            return pd.DataFrame()

        df = pd.DataFrame(data)

        if "FullName" in df.columns:
            df = df[
                df["FullName"].notna()
            ]

        return df.drop_duplicates()

    except Exception as e:

        st.warning(
            f"Could not load teacher roster: {e}"
        )

        return pd.DataFrame()


def save_pd_record(
    record: Dict[str, Any]
) -> Optional[str]:

    record_id = record.get(
        "id",
        make_unique_id()
    )

    record["id"] = record_id

    if supabase is None:

        # Store in session as demo fallback
        if "demo_pd_records" not in st.session_state:
            st.session_state.demo_pd_records = []

        st.session_state.demo_pd_records.append(
            record
        )

        return record_id

    try:

        response = (
            supabase
            .table("teacher_pd_records")
            .upsert(record)
            .execute()
        )

        return record_id

    except Exception as e:

        st.error(
            f"Could not save PD record: {e}"
        )

        return None


def get_teacher_pd_records(
    teacher_name: str
) -> pd.DataFrame:

    if supabase is None:

        records = st.session_state.get(
            "demo_pd_records",
            []
        )

        records = [
            x for x in records
            if x.get("teacher_name") == teacher_name
        ]

        return pd.DataFrame(records)

    try:

        response = (
            supabase
            .table("teacher_pd_records")
            .select("*")
            .eq("teacher_name", teacher_name)
            .order(
                "created_at",
                desc=True
            )
            .execute()
        )

        return pd.DataFrame(
            response.data or []
        )

    except Exception:

        return pd.DataFrame()


# ============================================================
# SIDEBAR
# ============================================================

def render_sidebar():

    st.sidebar.markdown(
        f"## 🎓 {APP_NAME}"
    )

    st.sidebar.caption(
        f"Version {APP_VERSION}"
    )

    st.sidebar.divider()

    role = st.sidebar.radio(
        "Mode",
        [
            "Teacher",
            "Admin"
        ],
        index=0
    )

    st.session_state.role = role

    if role == "Teacher":

        roster = get_teacher_roster()

        if not roster.empty:

            names = sorted(
                roster["FullName"]
                .dropna()
                .astype(str)
                .unique()
                .tolist()
            )

            selected = st.sidebar.selectbox(
                "Teacher",
                ["Select teacher"] + names
            )

            if selected != "Select teacher":

                st.session_state.teacher_name = selected

                row = roster[
                    roster["FullName"].astype(str)
                    == selected
                ].iloc[0]

                st.session_state.teacher_school = str(
                    row.get(
                        "Institution",
                        ""
                    )
                )

                st.session_state.teacher_state = str(
                    row.get(
                        "State_Zone",
                        ""
                    )
                )

                st.session_state.teacher_consultant = str(
                    row.get(
                        "Uploaded_By",
                        ""
                    )
                )

        else:

            st.sidebar.info(
                "Roster unavailable. Demo teacher mode."
            )

            st.session_state.teacher_name = (
                st.sidebar.text_input(
                    "Teacher name",
                    value=st.session_state.teacher_name
                )
            )

            st.session_state.teacher_school = (
                st.sidebar.text_input(
                    "School",
                    value=st.session_state.teacher_school
                )
            )

        st.sidebar.divider()

        page = st.sidebar.radio(
            "Navigate",
            [
                "Dashboard",
                "Professional Development",
                "Module 1",
                "My Reflections",
                "My Growth",
                "Classroom Implementation"
            ]
        )

        st.session_state.current_page = page

    else:

        st.sidebar.info(
            "Admin access is required."
        )

        if not st.session_state.admin_authenticated:

            password = st.sidebar.text_input(
                "Admin password",
                type="password"
            )

            if st.sidebar.button(
                "Login",
                use_container_width=True
            ):

                if not ADMIN_PASSWORD:

                    st.session_state.admin_authenticated = True

                elif password == ADMIN_PASSWORD:

                    st.session_state.admin_authenticated = True
                    st.sidebar.success(
                        "Authenticated"
                    )

                else:

                    st.sidebar.error(
                        "Incorrect password"
                    )

        if st.session_state.admin_authenticated:

            page = st.sidebar.radio(
                "Admin navigation",
                [
                    "Admin Dashboard",
                    "Teacher Progress",
                    "Reflection Analytics"
                ]
            )

            st.session_state.current_page = page


# ============================================================
# TEACHER DASHBOARD
# ============================================================

def render_teacher_dashboard():

    teacher = st.session_state.teacher_name

    st.markdown(
        '<div class="main-title">Teacher Dashboard</div>',
        unsafe_allow_html=True
    )

    st.markdown(
        '<div class="subtitle">'
        'Your professional learning and classroom journey'
        '</div>',
        unsafe_allow_html=True
    )

    if not teacher:

        st.info(
            "Please select your teacher profile from the sidebar."
        )
        return

    records = get_teacher_pd_records(
        teacher
    )

    completed_modules = 0
    reflections = 0
    average_score = 0

    if not records.empty:

        reflections = len(records)

        completed = records[
            records.get(
                "module_status",
                pd.Series(dtype=str)
            ) == "completed"
        ]

        completed_modules = len(
            completed
        )

        if "ai_score" in records.columns:

            scores = pd.to_numeric(
                records["ai_score"],
                errors="coerce"
            ).dropna()

            if len(scores):
                average_score = round(
                    scores.mean()
                )

    c1, c2, c3 = st.columns(3)

    with c1:

        st.markdown(
            '<div class="card">'
            '<div>Modules Completed</div>'
            f'<div class="big-number">{completed_modules}</div>'
            '</div>',
            unsafe_allow_html=True
        )

    with c2:

        st.markdown(
            '<div class="card">'
            '<div>Reflections</div>'
            f'<div class="big-number">{reflections}</div>'
            '</div>',
            unsafe_allow_html=True
        )

    with c3:

        st.markdown(
            '<div class="card">'
            '<div>Average Pedagogical Score</div>'
            f'<div class="big-number">{average_score}%</div>'
            '</div>',
            unsafe_allow_html=True
        )

    st.divider()

    st.subheader(
        "📚 Professional Development"
    )

    col1, col2 = st.columns([2, 1])

    with col1:

        st.markdown(
            f"""
### {MODULE_1["title"]}

{MODULE_1["description"]}

**Duration:** {MODULE_1["duration"]}

You will learn how to:

- Define meaningful learning objectives
- Use Bloom's Taxonomy
- Plan teacher and student activity
- Connect practice to learning
- Check student learning
- Reflect on an actual lesson
"""
        )

        if st.button(
            "Start / Continue Module 1",
            type="primary",
            use_container_width=True
        ):

            st.session_state.current_page = "Module 1"
            st.session_state.module_stage = "learning"
            st.rerun()

    with col2:

        st.info(
            """
### Your Learning Journey

**Learn**

↓

**Understand**

↓

**Think**

↓

**Reflect**

↓

**AI Feedback**

↓

**Assess**

↓

**Apply in Classroom**
"""
        )

    st.divider()

    st.subheader(
        "🏫 Classroom Implementation"
    )

    st.write(
        "Once you complete your learning, apply it "
        "in your classroom."
    )

    if IMPLEMENTATION_PORTAL_URL:

        st.link_button(
            "Open Classroom Implementation Portal",
            IMPLEMENTATION_PORTAL_URL,
            use_container_width=True
        )

    else:

        st.warning(
            "Implementation portal URL has not been configured."
        )


# ============================================================
# PROFESSIONAL DEVELOPMENT PAGE
# ============================================================

def render_pd_page():

    st.title(
        "📚 Professional Development"
    )

    st.write(
        "Build pedagogical understanding through "
        "short, practical learning modules."
    )

    st.divider()

    st.subheader(
        "Available Modules"
    )

    module_status = "Not Started"

    records = get_teacher_pd_records(
        st.session_state.teacher_name
    )

    if not records.empty:

        completed = records[
            records.get(
                "module_status",
                pd.Series(dtype=str)
            ) == "completed"
        ]

        if not completed.empty:
            module_status = "Completed"

    col1, col2, col3 = st.columns([2, 1, 1])

    with col1:

        st.markdown(
            f"""
## 1. {MODULE_1["title"]}

{MODULE_1["description"]}
"""
        )

    with col2:

        st.metric(
            "Status",
            module_status
        )

    with col3:

        if st.button(
            "Open Module",
            use_container_width=True
        ):

            st.session_state.current_page = "Module 1"
            st.rerun()


# ============================================================
# MODULE 1
# ============================================================

def render_module_1():

    st.title(
        "📘 Module 1"
    )

    st.header(
        MODULE_1["title"]
    )

    stages = [
        "Learning",
        "Understanding",
        "Practical Thinking",
        "Reflection",
        "AI Feedback",
        "Final Assessment"
    ]

    stage_map = {
        "learning": 0,
        "quiz": 1,
        "scenario": 2,
        "reflection": 3,
        "feedback": 4,
        "assessment": 5
    }

    current_index = stage_map.get(
        st.session_state.module_stage,
        0
    )

    cols = st.columns(
        len(stages)
    )

    for i, stage in enumerate(stages):

        with cols[i]:

            if i < current_index:

                symbol = "✅"

            elif i == current_index:

                symbol = "🔵"

            else:

                symbol = "⚪"

            st.markdown(
                f"""
                <div class="stage">
                {symbol}<br>
                <small>{stage}</small>
                </div>
                """,
                unsafe_allow_html=True
            )

    st.divider()

    if st.session_state.module_stage == "learning":

        render_module_learning()

    elif st.session_state.module_stage == "quiz":

        render_module_quiz()

    elif st.session_state.module_stage == "scenario":

        render_module_scenario()

    elif st.session_state.module_stage == "reflection":

        render_module_reflection()

    elif st.session_state.module_stage == "feedback":

        render_module_feedback()

    elif st.session_state.module_stage == "assessment":

        render_final_assessment()


# ============================================================
# LEARNING
# ============================================================

def render_module_learning():

    st.subheader(
        "Step 1 — Learn"
    )

    st.write(
        "Move through the learning sections below."
    )

    for item in LESSON_CONTENT:

        with st.container():

            st.markdown(
                '<div class="learning-card">',
                unsafe_allow_html=True
            )

            st.markdown(
                f"### {item['title']}"
            )

            st.markdown(
                item["content"]
            )

            st.markdown(
                "</div>",
                unsafe_allow_html=True
            )

    if st.button(
        "Continue to Understanding Check →",
        type="primary",
        use_container_width=True
    ):

        st.session_state.module_stage = "quiz"
        st.rerun()


# ============================================================
# QUIZ
# ============================================================

def render_module_quiz():

    st.subheader(
        "Step 2 — Check Your Understanding"
    )

    st.write(
        "Answer the following questions."
    )

    with st.form(
        "module_1_quiz"
    ):

        answers = {}

        for i, question in enumerate(
            MODULE_1_QUIZ
        ):

            st.markdown(
                f"**{i + 1}. {question['question']}**"
            )

            answers[i] = st.radio(
                "Select one",
                question["options"],
                key=f"quiz_{i}",
                label_visibility="collapsed"
            )

            st.divider()

        submitted = st.form_submit_button(
            "Submit Quiz",
            type="primary",
            use_container_width=True
        )

    if submitted:

        correct = 0

        for i, question in enumerate(
            MODULE_1_QUIZ
        ):

            selected = answers[i]

            if selected == question["options"][
                question["answer"]
            ]:

                correct += 1

        score = calculate_score(
            correct,
            len(MODULE_1_QUIZ)
        )

        st.session_state.quiz_score = score
        st.session_state.quiz_submitted = True

        if score >= 60:

            st.success(
                f"Well done! You scored {score}%."
            )

            if st.button(
                "Continue to Practical Thinking →",
                type="primary",
                use_container_width=True
            ):

                st.session_state.module_stage = "scenario"
                st.rerun()

        else:

            st.warning(
                f"You scored {score}%. "
                "Review the learning sections and try again."
            )


# ============================================================
# PRACTICAL SCENARIO
# ============================================================

def render_module_scenario():

    st.subheader(
        "Step 3 — Practical Thinking"
    )

    st.markdown(
        """
### Classroom Scenario

A Grade 2 teacher is teaching a lesson on plants.

The teacher:

- Explains the parts of a plant.
- Shows a digital image.
- Asks students to copy the names into their notebooks.
- Completes the textbook page.
- Moves to the next lesson.

However, the teacher does not ask students to identify
parts of a real plant, explain their function, or demonstrate
what they have learned.

### Think about it

What could the teacher change to make the lesson more
student-centred and aligned with the learning objective?
"""
    )

    response = st.text_area(
        "Your response",
        height=180,
        placeholder=(
            "Think about the objective, student activity, "
            "practice and review."
        )
    )

    if st.button(
        "Continue to My Lesson Reflection →",
        type="primary",
        disabled=not response.strip(),
        use_container_width=True
    ):

        st.session_state.module_stage = "reflection"
        st.session_state.scenario_response = response

        st.rerun()


# ============================================================
# REFLECTION
# ============================================================

def render_module_reflection():

    st.subheader(
        "Step 4 — Reflect on Your Actual Lesson"
    )

    st.info(
        """
Record a 1–2 minute reflection about an actual lesson
you are going to teach.

Try to cover:

**WHAT**
Grade, Subject, Lesson Plan No., Topic/Chapter

**WHY**
What do I want students to learn or be able to do?

**HOW / TEACHER ACTIVITY**
How will I teach? Which resources will I use?

**STUDENT ACTIVITY**
What will students do or participate in?

**PRACTICE & APPLY**
What will students practise in the Course Book/Workbook
or through another activity?

**REVIEW**
How will I check student learning?
"""
    )

    st.markdown(
        "### 🎙️ Record Your Reflection"
    )

    audio = st.audio_input(
        "Record a 1–2 minute voice note",
        sample_rate=16000,
        key="module_1_audio"
    )

    uploaded_audio = st.file_uploader(
        "Or upload an audio file",
        type=[
            "wav",
            "mp3",
            "m4a",
            "ogg"
        ],
        key="module_1_audio_upload"
    )

    audio_file = audio or uploaded_audio

    if audio_file:

        audio_bytes = audio_file.getvalue()

        size_mb = (
            len(audio_bytes) /
            (1024 * 1024)
        )

        st.audio(
            audio_bytes
        )

        st.caption(
            f"Audio size: {size_mb:.2f} MB"
        )

        if size_mb > MAX_AUDIO_MB:

            st.error(
                f"Audio exceeds the {MAX_AUDIO_MB} MB limit."
            )

            return

        if st.button(
            "Process Voice Reflection",
            type="primary",
            use_container_width=True
        ):

            with st.spinner(
                "Uploading and transcribing..."
            ):

                filename = getattr(
                    audio_file,
                    "name",
                    "reflection.wav"
                )

                r2_path = upload_audio_to_r2(
                    audio_bytes,
                    st.session_state.teacher_name,
                    "module_1",
                    filename
                )

                try:

                    transcript = transcribe_audio(
                        audio_bytes,
                        filename
                    )

                except Exception as e:

                    st.error(str(e))
                    return

                st.session_state.reflection_audio_path = (
                    r2_path or ""
                )

                st.session_state.reflection_transcript = (
                    transcript
                )

            with st.spinner(
                "Structuring your reflection..."
            ):

                try:

                    extraction = extract_reflection(
                        transcript
                    )

                    st.session_state.reflection_extraction = (
                        extraction
                    )

                except Exception as e:

                    st.error(str(e))
                    return

            st.success(
                "Your reflection has been transcribed and structured."
            )

            st.session_state.module_stage = "feedback"
            st.rerun()


# ============================================================
# FEEDBACK / REVIEW
# ============================================================

def render_module_feedback():

    st.subheader(
        "Step 5 — Review Your Lesson Reflection"
    )

    transcript = st.session_state.reflection_transcript
    extraction = st.session_state.reflection_extraction

    if not extraction:

        st.warning(
            "No reflection has been processed yet."
        )

        if st.button(
            "Back to Reflection"
        ):

            st.session_state.module_stage = "reflection"
            st.rerun()

        return

    with st.expander(
        "🎙️ View Transcript",
        expanded=False
    ):

        st.write(
            transcript
        )

    st.info(
        "Review the information below. "
        "AI has only structured your reflection; "
        "you remain the final decision-maker."
    )

    what = extraction.get(
        "what",
        {}
    )

    why = extraction.get(
        "why",
        {}
    )

    st.markdown(
        "### 1. WHAT"
    )

    c1, c2 = st.columns(2)

    with c1:

        grade = st.text_input(
            "Grade",
            value=str(
                what.get(
                    "grade",
                    ""
                )
            ),
            key="edit_grade"
        )

        subject = st.text_input(
            "Subject",
            value=str(
                what.get(
                    "subject",
                    ""
                )
            ),
            key="edit_subject"
        )

        lesson_plan_number = st.text_input(
            "Lesson Plan Number",
            value=str(
                what.get(
                    "lesson_plan_number",
                    ""
                )
            ),
            key="edit_lesson_plan"
        )

    with c2:

        topic = st.text_input(
            "Topic / Chapter",
            value=str(
                what.get(
                    "topic",
                    ""
                )
            ),
            key="edit_topic"
        )

        book = st.text_input(
            "Book / Workbook",
            value=str(
                what.get(
                    "book",
                    ""
                )
            ),
            key="edit_book"
        )

        page_section = st.text_input(
            "Page / Section",
            value=str(
                what.get(
                    "page_or_section",
                    ""
                )
            ),
            key="edit_page"
        )

    st.markdown(
        "### 2. WHY — Learning Objective"
    )

    learning_objective = st.text_area(
        "What do you want students to learn or be able to do?",
        value=str(
            why.get(
                "learning_objective",
                ""
            )
        ),
        height=100,
        key="edit_objective"
    )

    bloom_options = [
        "Not mentioned",
        "Remember",
        "Understand",
        "Apply",
        "Analyse",
        "Evaluate",
        "Create"
    ]

    existing_bloom = str(
        why.get(
            "bloom_level",
            "Not mentioned"
        )
    )

    if existing_bloom not in bloom_options:

        existing_bloom = "Not mentioned"

    bloom = st.selectbox(
        "Bloom's Taxonomy level",
        bloom_options,
        index=bloom_options.index(
            existing_bloom
        ),
        key="edit_bloom"
    )

    objective_quality = st.text_input(
        "Objective quality",
        value=str(
            why.get(
                "objective_quality",
                ""
            )
        ),
        key="edit_objective_quality"
    )

    st.markdown(
        "### 3. HOW — Teacher Activity"
    )

    teacher_activity = st.text_area(
        "How will you teach? Which resources will you use?",
        value=str(
            extraction.get(
                "teacher_activity",
                ""
            )
        ),
        height=120,
        key="edit_teacher_activity"
    )

    st.markdown(
        "### 4. STUDENT ACTIVITY"
    )

    student_activity = st.text_area(
        "What will students do or participate in?",
        value=str(
            extraction.get(
                "student_activity",
                ""
            )
        ),
        height=120,
        key="edit_student_activity"
    )

    st.markdown(
        "### 5. PRACTICE & APPLY"
    )

    practice_apply = st.text_area(
        "What will students practise or apply?",
        value=str(
            extraction.get(
                "practice_apply",
                ""
            )
        ),
        height=120,
        key="edit_practice"
    )

    st.markdown(
        "### 6. REVIEW"
    )

    review = st.text_area(
        "How will you check student learning?",
        value=str(
            extraction.get(
                "review",
                ""
            )
        ),
        height=120,
        key="edit_review"
    )

    st.divider()

    col1, col2 = st.columns(2)

    with col1:

        if st.button(
            "💾 Save Draft",
            use_container_width=True
        ):

            draft = build_reflection_from_ui()

            record = create_pd_record(
                draft,
                status="draft"
            )

            saved = save_pd_record(
                record
            )

            if saved:

                st.success(
                    "Draft saved successfully."
                )

    with col2:

        if st.button(
            "✅ Confirm & Get AI Feedback",
            type="primary",
            use_container_width=True
        ):

            reflection = build_reflection_from_ui()

            st.session_state.reflection_draft = (
                reflection
            )

            with st.spinner(
                "Evaluating your pedagogical thinking..."
            ):

                try:

                    evaluation = evaluate_reflection(
                        reflection
                    )

                except Exception as e:

                    st.error(str(e))
                    return

            st.session_state.reflection_evaluation = (
                evaluation
            )

            record = create_pd_record(
                reflection,
                status="reflection_submitted",
                evaluation=evaluation
            )

            saved = save_pd_record(
                record
            )

            if saved:

                st.session_state.module_stage = (
                    "assessment"
                )

                st.rerun()


def build_reflection_from_ui():

    return {
        "what": {
            "grade": st.session_state.get(
                "edit_grade",
                ""
            ),
            "subject": st.session_state.get(
                "edit_subject",
                ""
            ),
            "lesson_plan_number": st.session_state.get(
                "edit_lesson_plan",
                ""
            ),
            "topic": st.session_state.get(
                "edit_topic",
                ""
            ),
            "book": st.session_state.get(
                "edit_book",
                ""
            ),
            "page_or_section": st.session_state.get(
                "edit_page",
                ""
            )
        },
        "why": {
            "learning_objective": st.session_state.get(
                "edit_objective",
                ""
            ),
            "bloom_level": st.session_state.get(
                "edit_bloom",
                ""
            ),
            "objective_quality": st.session_state.get(
                "edit_objective_quality",
                ""
            )
        },
        "teacher_activity": st.session_state.get(
            "edit_teacher_activity",
            ""
        ),
        "student_activity": st.session_state.get(
            "edit_student_activity",
            ""
        ),
        "practice_apply": st.session_state.get(
            "edit_practice",
            ""
        ),
        "review": st.session_state.get(
            "edit_review",
            ""
        )
    }


def create_pd_record(
    reflection: Dict[str, Any],
    status: str = "draft",
    evaluation: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:

    what = reflection.get(
        "what",
        {}
    )

    why = reflection.get(
        "why",
        {}
    )

    ai_score = None

    if evaluation:

        ai_score = evaluation.get(
            "overall_score"
        )

    return {

        "id": (
            st.session_state.reflection_id
            or make_unique_id()
        ),

        "teacher_name": (
            st.session_state.teacher_name
        ),

        "teacher_id": None,

        "school": (
            st.session_state.teacher_school
        ),

        "state_zone": (
            st.session_state.teacher_state
        ),

        "consultant": (
            st.session_state.teacher_consultant
        ),

        "module_id": "module_1",

        "module_name": MODULE_1["title"],

        "lesson_grade": what.get(
            "grade",
            ""
        ),

        "lesson_subject": what.get(
            "subject",
            ""
        ),

        "lesson_plan_number": what.get(
            "lesson_plan_number",
            ""
        ),

        "lesson_topic": what.get(
            "topic",
            ""
        ),

        "book": what.get(
            "book",
            ""
        ),

        "page_section": what.get(
            "page_or_section",
            ""
        ),

        "voice_note_path": (
            st.session_state.reflection_audio_path
        ),

        "transcript": (
            st.session_state.reflection_transcript
        ),

        "learning_objective": why.get(
            "learning_objective",
            ""
        ),

        "bloom_level": why.get(
            "bloom_level",
            ""
        ),

        "teacher_activity": reflection.get(
            "teacher_activity",
            ""
        ),

        "student_activity": reflection.get(
            "student_activity",
            ""
        ),

        "practice_apply": reflection.get(
            "practice_apply",
            ""
        ),

        "review": reflection.get(
            "review",
            ""
        ),

        "ai_feedback": (
            json_dumps(evaluation)
            if evaluation
            else None
        ),

        "ai_score": ai_score,

        "ai_evaluation_json": (
            evaluation
            if evaluation
            else None
        ),

        "teacher_confirmed": (
            status != "draft"
        ),

        "module_status": status,

        "assessment_score": (
            st.session_state.final_score
        ),

        "created_at": now_iso(),

        "updated_at": now_iso()
    }


# ============================================================
# DISPLAY AI FEEDBACK
# ============================================================

def display_evaluation(
    evaluation: Dict[str, Any]
):

    st.subheader(
        "🤖 Your Pedagogical Feedback"
    )

    score = evaluation.get(
        "overall_score",
        0
    )

    st.metric(
        "Overall Pedagogical Alignment",
        f"{score}%"
    )

    st.markdown(
        "### What You Did Well"
    )

    for item in evaluation.get(
        "what_you_did_well",
        []
    ):

        st.markdown(
            f"- ✅ {item}"
        )

    st.markdown(
        "### Think About"
    )

    for item in evaluation.get(
        "think_about",
        []
    ):

        st.markdown(
            f"- 💡 {item}"
        )

    st.markdown(
        "### One Practical Suggestion"
    )

    st.info(
        evaluation.get(
            "one_practical_suggestion",
            ""
        )
    )

    st.markdown(
        "### Detailed Rubric"
    )

    categories = [
        (
            "Learning Objective",
            "learning_objective"
        ),
        (
            "Bloom's Alignment",
            "bloom_alignment"
        ),
        (
            "Teacher Activity",
            "teacher_activity"
        ),
        (
            "Student Activity",
            "student_activity"
        ),
        (
            "Practice & Application",
            "practice_apply"
        ),
        (
            "Review",
            "review"
        ),
        (
            "Overall Alignment",
            "overall_alignment"
        )
    ]

    for title, key in categories:

        item = evaluation.get(
            key,
            {}
        )

        score_value = item.get(
            "score",
            0
        )

        feedback = item.get(
            "feedback",
            ""
        )

        with st.expander(
            f"{title} — {score_value}/4"
        ):

            st.write(
                feedback
            )


# ============================================================
# FEEDBACK PAGE
# ============================================================

def render_feedback_page():

    evaluation = (
        st.session_state.reflection_evaluation
    )

    if not evaluation:

        st.info(
            "No AI feedback available yet."
        )

        return

    display_evaluation(
        evaluation
    )


# ============================================================
# FINAL ASSESSMENT
# ============================================================

def render_final_assessment():

    st.subheader(
        "Step 6 — Final Assessment"
    )

    st.write(
        "Complete the final assessment for Module 1."
    )

    with st.form(
        "final_assessment"
    ):

        answers = {}

        for i, question in enumerate(
            FINAL_ASSESSMENT
        ):

            st.markdown(
                f"**{i + 1}. {question['question']}**"
            )

            answers[i] = st.radio(
                "Select one",
                question["options"],
                key=f"final_{i}",
                label_visibility="collapsed"
            )

            st.divider()

        submitted = st.form_submit_button(
            "Submit Final Assessment",
            type="primary",
            use_container_width=True
        )

    if submitted:

        correct = 0

        for i, question in enumerate(
            FINAL_ASSESSMENT
        ):

            if answers[i] == question["options"][
                question["answer"]
            ]:

                correct += 1

        score = calculate_score(
            correct,
            len(FINAL_ASSESSMENT)
        )

        st.session_state.final_score = score
        st.session_state.final_submitted = True

        if score >= 60:

            st.success(
                f"Module completed! "
                f"Your assessment score is {score}%."
            )

            reflection = (
                st.session_state.reflection_draft
            )

            evaluation = (
                st.session_state.reflection_evaluation
            )

            record = create_pd_record(
                reflection,
                status="completed",
                evaluation=evaluation
            )

            record["assessment_score"] = score

            saved = save_pd_record(
                record
            )

            if saved:

                st.balloons()

                st.markdown(
                    """
## 🎉 Module 1 Completed

You have completed the learning journey:

**Learn → Think → Reflect → Feedback → Assess**

### Next step

Apply this thinking in your classroom.

Your next stage is:

**🏫 Classroom Implementation**
"""
                )

                if IMPLEMENTATION_PORTAL_URL:

                    st.link_button(
                        "Go to Classroom Implementation",
                        IMPLEMENTATION_PORTAL_URL,
                        type="primary",
                        use_container_width=True
                    )

        else:

            st.warning(
                f"You scored {score}%. "
                "Review the module and try again."
            )


# ============================================================
# REFLECTION HISTORY
# ============================================================

def render_reflections():

    st.title(
        "📝 My Reflections"
    )

    teacher = st.session_state.teacher_name

    if not teacher:

        st.info(
            "Select your teacher profile first."
        )
        return

    records = get_teacher_pd_records(
        teacher
    )

    if records.empty:

        st.info(
            "You have not submitted any reflections yet."
        )
        return

    display_columns = [
        "module_name",
        "lesson_grade",
        "lesson_subject",
        "lesson_topic",
        "bloom_level",
        "ai_score",
        "assessment_score",
        "module_status",
        "created_at"
    ]

    available = [
        x for x in display_columns
        if x in records.columns
    ]

    st.dataframe(
        records[available],
        use_container_width=True,
        hide_index=True
    )

    st.divider()

    st.subheader(
        "Reflection Details"
    )

    for _, row in records.iterrows():

        label = (
            f"{row.get('lesson_subject', '')} — "
            f"{row.get('lesson_topic', '')} — "
            f"{row.get('created_at', '')}"
        )

        with st.expander(label):

            st.write(
                "**Learning Objective:**",
                row.get(
                    "learning_objective",
                    ""
                )
            )

            st.write(
                "**Bloom Level:**",
                row.get(
                    "bloom_level",
                    ""
                )
            )

            st.write(
                "**Teacher Activity:**",
                row.get(
                    "teacher_activity",
                    ""
                )
            )

            st.write(
                "**Student Activity:**",
                row.get(
                    "student_activity",
                    ""
                )
            )

            st.write(
                "**Practice & Apply:**",
                row.get(
                    "practice_apply",
                    ""
                )
            )

            st.write(
                "**Review:**",
                row.get(
                    "review",
                    ""
                )
            )


# ============================================================
# GROWTH PAGE
# ============================================================

def render_growth():

    st.title(
        "📈 My Growth"
    )

    teacher = st.session_state.teacher_name

    records = get_teacher_pd_records(
        teacher
    )

    if records.empty:

        st.info(
            "Complete your first module to start "
            "building your growth profile."
        )

        return

    col1, col2, col3 = st.columns(3)

    completed = (
        records[
            records.get(
                "module_status",
                pd.Series(dtype=str)
            ) == "completed"
        ]
        if "module_status" in records.columns
        else pd.DataFrame()
    )

    scores = (
        pd.to_numeric(
            records["ai_score"],
            errors="coerce"
        ).dropna()
        if "ai_score" in records.columns
        else pd.Series(dtype=float)
    )

    assessments = (
        pd.to_numeric(
            records["assessment_score"],
            errors="coerce"
        ).dropna()
        if "assessment_score" in records.columns
        else pd.Series(dtype=float)
    )

    with col1:

        st.metric(
            "Modules Completed",
            len(completed)
        )

    with col2:

        st.metric(
            "Average AI Score",
            f"{round(scores.mean()) if len(scores) else 0}%"
        )

    with col3:

        st.metric(
            "Average Assessment",
            f"{round(assessments.mean()) if len(assessments) else 0}%"
        )

    st.divider()

    st.subheader(
        "Your Development Journey"
    )

    st.markdown(
        """
### 📚 Learning

You develop your understanding of pedagogy.

↓

### 🧠 Thinking

You connect concepts to actual classroom situations.

↓

### 🎙️ Reflection

You explain how you would apply the concept.

↓

### 🤖 Feedback

AI identifies strengths and areas to think about.

↓

### 🏫 Implementation

You apply the learning in your classroom.

↓

### 📸 Evidence

Classroom implementation is captured through the
existing implementation system.

↓

### 🔄 Improvement

Your next learning cycle becomes more focused.
"""
    )


# ============================================================
# CLASSROOM IMPLEMENTATION
# ============================================================

def render_implementation():

    st.title(
        "🏫 Classroom Implementation"
    )

    st.markdown(
        """
This is the **implementation/evidence side** of the platform.

Your Professional Development learning happens separately.

Here you apply that learning in your classroom.
"""
    )

    st.info(
        """
**Part A — Learn**

📚 Professional Development

**Part B — Apply**

🏫 Classroom Implementation & Evidence
"""
    )

    if IMPLEMENTATION_PORTAL_URL:

        st.link_button(
            "Open Existing Classroom Implementation Portal",
            IMPLEMENTATION_PORTAL_URL,
            type="primary",
            use_container_width=True
        )

    else:

        st.warning(
            """
The implementation portal URL has not been configured.

Add:

IMPLEMENTATION_PORTAL_URL

to Streamlit secrets or environment variables.
"""
        )

    st.divider()

    st.subheader(
        "Your Learning → Implementation Connection"
    )

    reflection = (
        st.session_state.reflection_draft
    )

    if reflection:

        what = reflection.get(
            "what",
            {}
        )

        why = reflection.get(
            "why",
            {}
        )

        st.write(
            "**Lesson:**",
            what.get(
                "topic",
                ""
            )
        )

        st.write(
            "**Subject:**",
            what.get(
                "subject",
                ""
            )
        )

        st.write(
            "**Learning Objective:**",
            why.get(
                "learning_objective",
                ""
            )
        )

        st.write(
            "**Bloom Level:**",
            why.get(
                "bloom_level",
                ""
            )
        )

        st.caption(
            "Use this thinking while implementing the lesson."
        )

    else:

        st.write(
            "Complete a professional development reflection "
            "to establish a learning context."
        )


# ============================================================
# ADMIN DASHBOARD
# ============================================================

def get_all_pd_records() -> pd.DataFrame:

    if supabase is None:

        return pd.DataFrame(
            st.session_state.get(
                "demo_pd_records",
                []
            )
        )

    try:

        response = (
            supabase
            .table("teacher_pd_records")
            .select("*")
            .order(
                "created_at",
                desc=True
            )
            .execute()
        )

        return pd.DataFrame(
            response.data or []
        )

    except Exception as e:

        st.error(
            f"Could not load PD data: {e}"
        )

        return pd.DataFrame()


def render_admin_dashboard():

    st.title(
        "📊 Admin Dashboard"
    )

    records = get_all_pd_records()

    if records.empty:

        st.info(
            "No PD records available."
        )
        return

    total_teachers = (
        records["teacher_name"]
        .nunique()
        if "teacher_name" in records.columns
        else 0
    )

    total_reflections = len(records)

    completed = (
        (
            records["module_status"]
            == "completed"
        ).sum()
        if "module_status" in records.columns
        else 0
    )

    scores = (
        pd.to_numeric(
            records["ai_score"],
            errors="coerce"
        ).dropna()
        if "ai_score" in records.columns
        else pd.Series(dtype=float)
    )

    c1, c2, c3, c4 = st.columns(4)

    with c1:

        st.metric(
            "Teachers",
            total_teachers
        )

    with c2:

        st.metric(
            "Reflections",
            total_reflections
        )

    with c3:

        st.metric(
            "Completed",
            completed
        )

    with c4:

        st.metric(
            "Average AI Score",
            f"{round(scores.mean()) if len(scores) else 0}%"
        )

    st.divider()

    st.subheader(
        "Teacher Progress"
    )

    if "teacher_name" in records.columns:

        grouped = (
            records
            .groupby("teacher_name")
            .agg(
                Reflections=("teacher_name", "size"),
                Completed=(
                    "module_status",
                    lambda x: (
                        x == "completed"
                    ).sum()
                )
            )
            .reset_index()
        )

        if "ai_score" in records.columns:

            scores_df = (
                records
                .assign(
                    ai_score_numeric=pd.to_numeric(
                        records["ai_score"],
                        errors="coerce"
                    )
                )
                .groupby("teacher_name")
                ["ai_score_numeric"]
                .mean()
                .reset_index(
                    name="Average_AI_Score"
                )
            )

            grouped = grouped.merge(
                scores_df,
                on="teacher_name",
                how="left"
            )

        st.dataframe(
            grouped,
            use_container_width=True,
            hide_index=True
        )

    st.divider()

    st.subheader(
        "Recent PD Activity"
    )

    display = [
        "teacher_name",
        "school",
        "module_name",
        "lesson_subject",
        "lesson_topic",
        "ai_score",
        "assessment_score",
        "module_status",
        "created_at"
    ]

    available = [
        x for x in display
        if x in records.columns
    ]

    st.dataframe(
        records[available].head(100),
        use_container_width=True,
        hide_index=True
    )


# ============================================================
# TEACHER PROGRESS ADMIN
# ============================================================

def render_teacher_progress():

    st.title(
        "👩‍🏫 Teacher Progress"
    )

    records = get_all_pd_records()

    if records.empty:
        st.info("No data.")
        return

    teachers = sorted(
        records["teacher_name"]
        .dropna()
        .astype(str)
        .unique()
    )

    teacher = st.selectbox(
        "Select teacher",
        teachers
    )

    filtered = records[
        records["teacher_name"].astype(str)
        == teacher
    ]

    st.dataframe(
        filtered,
        use_container_width=True,
        hide_index=True
    )


# ============================================================
# ANALYTICS
# ============================================================

def render_reflection_analytics():

    st.title(
        "📈 Reflection Analytics"
    )

    records = get_all_pd_records()

    if records.empty:
        st.info("No reflection data.")
        return

    if "ai_score" in records.columns:

        scores = pd.to_numeric(
            records["ai_score"],
            errors="coerce"
        ).dropna()

        if len(scores):

            st.subheader(
                "AI Pedagogical Scores"
            )

            st.bar_chart(
                scores.reset_index(
                    drop=True
                )
            )

    if "assessment_score" in records.columns:

        assessments = pd.to_numeric(
            records["assessment_score"],
            errors="coerce"
        ).dropna()

        if len(assessments):

            st.subheader(
                "Final Assessment Scores"
            )

            st.bar_chart(
                assessments.reset_index(
                    drop=True
                )
            )


# ============================================================
# ADMIN ROUTER
# ============================================================

def render_admin():

    if not st.session_state.admin_authenticated:

        st.warning(
            "Please authenticate as an administrator."
        )

        return

    page = st.session_state.current_page

    if page == "Admin Dashboard":

        render_admin_dashboard()

    elif page == "Teacher Progress":

        render_teacher_progress()

    elif page == "Reflection Analytics":

        render_reflection_analytics()

    else:

        render_admin_dashboard()


# ============================================================
# TEACHER ROUTER
# ============================================================

def render_teacher():

    page = st.session_state.current_page

    if page == "Dashboard":

        render_teacher_dashboard()

    elif page == "Professional Development":

        render_pd_page()

    elif page == "Module 1":

        render_module_1()

    elif page == "My Reflections":

        render_reflections()

    elif page == "My Growth":

        render_growth()

    elif page == "Classroom Implementation":

        render_implementation()

    else:

        render_teacher_dashboard()


# ============================================================
# MAIN
# ============================================================

render_sidebar()

if st.session_state.role == "Admin":

    render_admin()

else:

    render_teacher()
