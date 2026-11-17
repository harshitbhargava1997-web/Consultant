# CLAUDE.md — Vision School Platform (Vercel)

## Identity and source of truth
You are working on **Vision School Platform**, a Next.js application deployed through Vercel.
- GitHub: `harshitbhargava1997-web/Consultant`
- Application branch: `commercial-staging` (NOT `main`).
- Application root: `commercial-web/` (this directory).
- Vercel project: `vision-school-commercial-staging`.
- Vision route: `/`; integrated School Success route: `/school-success`.
- This application is separate from the legacy Streamlit files at repository root, even though it shares the GitHub repository.
- Confirm branch, diff, deployment environment, and live code before each change. Do not assume the branch or docs are current.

## Confirmed stack and modules
- Next.js 15, React 19, JavaScript JSX, Supabase JS, server API routes, Vercel.
- Review `package.json`, `app/page.jsx`, `app/RoleHome.jsx`, `app/TeacherPortalWorkspace.jsx`, `app/ConsultantWorkspace.jsx`, `app/SchoolManagementWorkspace.jsx`, `app/TrainingWorkspace.jsx`, `app/AssessorWorkspace.jsx`, `app/api/`, `app/school-success/`, `lib/`, `migrations/`, `tests/`.
- Project documentation in `docs/` is substantive. Start with:
  - `docs/school-success-independent-module.md`
  - `docs/school-success-integration-audit.md` (historical baseline; not current release status)
  - `docs/school360-portfolio.md`
  - `docs/teacher-recording-and-lesson-reports.md`
  - `docs/teacher-360-duration-reports.md`
  - `docs/vision-overview-school-lifecycle.md`
- `README.md` contains early staging notes; newer dated release documents supersede its statements when backed by current code. Verify reality rather than treating any document as exhaustive.

## TWO PROGRAMMES, ONE PORTAL — critical separation
### Vision literacy
Native `literacy_*` entities, school memberships, classes, rosters, student competencies, assessments, progress reports, school management, teacher training and native Teacher Portal. Auth and access are governed by the Vision system.

### Integrated School Success
Independent programme at `/school-success` with its **own school and teacher directory, module school assignments, access checks, CRM, user-metric imports, archival settings, lesson preparation, teacher evidence, review, Teacher 360°, and School 360°**. It is housed in the same Next.js app but its records and authorization are *not* automatically joined to Vision literacy schools/memberships.
- Do NOT make School Success authorization depend on Vision school selection, name/email matching or `success_school_mappings`.
- Do NOT mix school, teacher, record, or role IDs across the two programmes without explicitly approved, verified mapping.
- Public School Success teacher links are scoped capability links with their own permissions and archive checks. Do not make them accessible to admin APIs or Vision teacher APIs.
- The original external School Success portal remains independent; do not silently synchronize, alter or decommission it.
- Preserve existing School Success R2 media objects, identity semantics, reports, imported data, and historical evidence.

## School Success product priorities (owner-provided)
- School 360°: school portfolio, quantitative overview, class/subject/date reports where available, teacher drilldown, chronological evidence flow, review status, reports and exports.
- Teacher 360°: track distinct preparation/lesson identities and dated evidence updates without double counting; include archived data only when explicitly requested; honor report configuration toggles.
- Lesson plans: preserve submission chronology in on-screen views and consolidated PDFs; add deterministic order when timestamps tie.
- Format PDF headings (Topic, Objective, Teacher Activity, Student Activity, Practice, Review/Homework, CFU) clearly where fields exist. Include consultant/coordinator/principal feedback only if recorded.
- Keep Book, E-book, Additional Materials, preparation activity, student writing, phonics, and consultant observations correctly differentiated. Usage is not proof of learning.
- Save preparation, optional audio/text reflection, evidence updates, and feedback without overwriting historical events.
- Preserve School Success-only consultant access, school links and teacher identity rules.

## Education domain and user experience
- ELPS: Experience -> Language -> Pictures -> Symbols; phonics and foundational-literacy progression are central.
- Observation structure: Flow of Class -> High Points -> Recommendations -> Overall Feedback.
- Role-aware, professional, school-friendly dashboards with intuitive navigation, minimal friction for teachers, readable PDF output and mobile usability.
- School owners, consultants, principals, coordinators, teachers, students, and platform administrators are stakeholders; **check actual role grants in source and RLS before implementing any permissions**.

## Collaboration contract — Claude implementation + independent ChatGPT/Codex review
For each owner-submitted task:
1. Confirm `commercial-staging` and working tree; read affected source and docs, relevant migrations, tests and permissions.
2. Clarify assumptions in the task summary; write concise requirements, acceptance criteria, scope, risks and rollback notes.
3. Implement a minimal, scoped change on a branch based on `commercial-staging`, not `main`; do not merge or release automatically.
4. Test affected behaviors and regressions. Run relevant `node --test` tests where present and `npm run build`; use real browser/device checks if available, explicitly distinguish missing coverage.
5. Open a PR targeting `commercial-staging`. Provide a changed-file summary, test results, evidence, risks and known gaps for independent ChatGPT/Codex/human review.
6. Address review findings in a bounded loop (normally two passes); owner approval required before merge, migration, or production release.
7. Never claim a test, deployed click-through, PDF visual inspection, or live DB check happened unless performed.

## Safety and invariants
- No production database migrations, destructive operations, deletion, data transfers, deployments, merges, role-grant expansion, or secrets changes without explicit approval.
- Do not expose Supabase service-role credentials, R2 keys, private signing keys, student data or legacy unsecured tables to client bundles, logs, commits, public endpoints or reports.
- Honor school-scoped authorization, Supabase RLS, server-side checks, signed media links and capability-token rules.
- Historical legacy tables may have unsafe RLS; never make them directly public.
- Preserve stable teacher/lesson identities, timestamp ordering, archive handling, idempotency, import deduplication, period filtering, and report toggles.
- Use synthetic fixtures, secure staging, change review, backups and rollback planning for schema or authorization work.
- Protect current working workflows over unrelated refactoring.

## First action in a new Claude session
Read this file, inspect branch `commercial-staging` and the most relevant docs/source. Explain the two-programme architecture and give a short code-grounded task plan. Do not change code until the owner has submitted a task.
