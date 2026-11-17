# CLAUDE.md — Consultant / School Success Portal

## Purpose
This repository contains a Streamlit-based school-success, teacher-evidence, academic-consulting, and literacy-assessment portal. The platform helps schools and consultants track implementation, review teaching evidence, coordinate follow-up actions, and assess foundational literacy.

Read this file and the relevant source modules before proposing changes. This document records product direction as well as verified repository architecture; **do not confuse desired functionality with features already implemented**.

## Verified repository structure (main branch, reviewed 2026-11-17)
- `admin_app.py`: administrative Streamlit application.
- `teacher_app.py`: teacher-facing Streamlit application.
- `consultant_workspace.py`: consultant actions, school plans, evidence review, and leadership PDF.
- `portal_core.py`: shared side-effect-free portal logic, evidence column definitions, usage/report utilities and PDF font setup.
- `assessment_module.py`, `assessment_app.py`: literacy assessment module and standalone entrypoint.
- `platform_admin_module.py`: platform administration support.
- `assessment_migration.sql`, `assessment_spiral_upgrade.sql`, `platform_admin_migration.sql`: database change scripts.
- `requirements.txt`: Python dependencies including Streamlit, pandas, Supabase, SQLAlchemy, boto3, ReportLab, openpyxl, and pypdf.
- `README_GITHUB.md`: assessment pilot instructions and explicit limitations.
Repository uses PostgreSQL/Supabase and includes boto3 integration; verify exact storage paths and connection configuration in code before touching them.

## Product goals and stakeholders (owner-provided context)
School success should connect teacher submissions, academic coordinator/principal feedback, consultant review, evidence, school-level reporting, and competency assessment.
Stakeholder roles across the broader roadmap: Super Admin, Consultant, School Owner, Principal, Coordinator, Teacher, and Student. **Confirm which roles and permissions are actually implemented in this repository.**
Typical evidence includes lesson plans, classroom activities, phonics, student written work, assessments, and supporting media. Preserve compatibility with existing records and import/export mappings.

## School Success Dashboard reporting requirements (requested; verify implementation)
- A school-wise 360-degree report should filter by school, class, subject, and selected reporting period.
- Show the number of lesson plans and provide a consolidated downloadable report.
- Show submissions in chronological submission-date order and retain that same order in the consolidated report; use a deterministic tie-breaker where timestamps match.
- Include principal/coordinator/consultant feedback when it exists; do not create empty mandatory feedback sections.
- Clearly distinguish submission date from implementation/lesson date.
- PDF lesson plans must emphasize headings such as Topic, Objective, Teacher Activity, Student Activity, Student Practice, Review/Homework, and Check for Understanding where present in source data. Do not fabricate missing fields.
- Reports should be readable, professionally formatted, printable, and robust to long text, Unicode, multiple pages, and absent optional fields.
- Evidence coverage is not the same as verified learning improvement.

## Education domain
- ELPS: Experience -> Language -> Pictures -> Symbols.
- Panchadi: Adhiti -> Bodh -> Abhyas -> Prayog -> Prasar.
- Phonics progression and age/grade-specific literacy assessment matter; do not assert a child's mastery from upload counts alone.
- Classroom observation feedback should be structured: Flow of Class -> High Points -> Recommendations -> Overall Feedback.
- Prefer clear, actionable, evidence-based implementation indicators rather than unsupported pedagogical claims.

## Engineering collaboration protocol: ChatGPT + Claude
For each task:
1. Read this file, the relevant modules, the current Git diff, and schema/migration references.
2. Restate the exact scope, acceptance criteria, affected files, and any uncertainty.
3. Implement the smallest coherent change on a feature branch; avoid unrelated refactoring.
4. Run appropriate syntax/static checks, unit/integration tests when available, and verify PDF output visually when changed.
5. Provide a concise implementation summary, changed paths, checks run/results, untested paths, and known risks.
6. Submit a PR for independent ChatGPT/Codex or human review. Address actionable findings with a bounded review loop (normally max two iterations).
7. Never claim tests ran, screenshots were inspected, or behavior was verified unless they actually were.

## Safety and data-integrity rules
- Never commit credentials, Supabase service-role keys, tokens, student personally identifiable information, or real school records.
- Use the least-privileged Supabase credentials in client-facing code; validate tenancy/role boundaries and RLS.
- No production schema migrations, destructive queries, deletion of records, bulk modifications, secret changes, merges, or deployments without explicit approval.
- Keep existing application entrypoints, database schema, uploads, CSV exports, and PDF interfaces working unless change is explicitly approved.
- Use parameterized SQL; validate file uploads and avoid leaking private attachments/URLs.
- Maintain predictable time handling (business reporting usually Asia/Kolkata) and clear chronological ordering.
- Before changing a migration, inspect the live schema or migration history when access is available; do not assume a migration has already run.
- `README_GITHUB.md` notes that initial literacy cutoffs and curriculum seeds are provisional, not validated diagnostic rules. Preserve this distinction.

## Working style
- Ask only for genuinely blocking information; otherwise state assumptions and proceed with reversible changes.
- Do not silently overwrite working features.
- Keep documentation aligned with the code.
- Treat this as a live school-facing application: correctness, student privacy, auditability, ease of use, and readable reports take priority over cosmetic refactoring.

## Current context boundary
The product owner also has a broader BolChaal / Vision Literacy project and future Next.js commercial-platform ambitions. Those are **separate initiatives** and are not automatically part of this repository. Do not copy their architecture or requirements into this codebase without an explicit task.
