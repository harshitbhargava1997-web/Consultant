# Vision literacy Teacher Portal

22 October 2026. This supersedes the earlier full School Success integration direction.

Vision's main navigation contains **Teacher Portal**. Its directory uses the selected Vision school, teacher membership IDs and class assignments. Preparation uses Vision's published literacy competencies. No School Success mapping is required.

The portal retains structured typed or spoken planning, teaching-learning materials, multiple periods, generated preparation PDFs, audio recordings, teacher/date lookup, subsequent evidence updates, file downloads and leader feedback. Voice recording is a choice. Preparations and each later evidence update remain distinct. Competency proficiency is established through assessments, not inferred from an upload.

New lesson data lives in `literacy_teacher_lessons`. School teacher capabilities live in `literacy_teacher_portal_links`; only token hashes are stored. New media uses the existing private `vision-implementation` bucket under a `teacher-portal/<school ID>/<teacher ID>/...` prefix. Signed uploads go directly from browser to Supabase Storage. They do not pass file bodies through Vercel. Signed download grants are specific to a file, school and teacher, with an independent `VISION_TEACHER_PORTAL_SIGNING_KEY` configured server-side in Vercel production. Public-link media grants are invalidated when that link is revoked.

Protected requests validate Vision authentication and implementation permissions. Teachers see their own work. Principals/coordinators/consultants with implementation review permission see only their assigned schools. Public teacher links select from native Vision teacher IDs and do not grant CRM or administrative access. User-management permission is needed to create/revoke public school links.

Teacher and school progress reports combine the native Vision implementation history and new Vision lessons. Preparations/sessions/minutes are shown separately from implemented periods. School Success records never enter these reports. Historical implementation attachments remain accessible through the read-only **Implementation history** navigation item.

**School Success folder** remains a separate Super Admin entry. Its copied records, CRM, templates, archives and reports are retained. Ordinary Vision stakeholders cannot access that folder; its old shared capabilities and school/teacher mapping controls are paused. The existing mapping rows are retained as history but no longer authorize access. The independent original School Success portal is unchanged and remains at https://school-success-portal.harshitbhargava1997.chatgpt.site.

Validation: Next.js production build passed. `node --test tests/vision-teacher-portal.test.mjs tests/success-*.test.mjs` passed 43 tests. Deployed acceptance and browser checks are recorded after release verification. Real microphone/speech recognition on physical iPhone Safari and Android Chrome still requires device testing.
