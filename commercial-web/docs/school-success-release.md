# School Success in Vision — release and verification

22 October 2026. Target is the existing Vision staging project, not a new application.

- Vision: https://vision-school-commercial-staging.vercel.app/
- Module: https://vision-school-commercial-staging.vercel.app/school-success
- Super Admin import, backup and mapping interface: https://vision-school-commercial-staging.vercel.app/school-success/migration
- Independent original: https://school-success-portal.harshitbhargava1997.chatgpt.site
- Repository: `harshitbhargava1997-web/Consultant`; app root `commercial-web`.

## Data and access

The source records were copied into Vision's Supabase database with their source IDs. Source Cloudflare D1 configuration was copied into private `success_*` tables. Existing R2 media remains in its original bucket; its stored configuration was re-encrypted server-side with Vision's new encryption key. No source customer records were changed. This is a one-time copy, not continuous synchronization.

Imported baseline: 61,523 usage/lesson records, 52 observations, 9 call logs, 1 ticket, 6 school contacts, 1 evidence review and 4 import-run records, plus local roster, settings, audit and legacy CRM snapshots. The 61,523 records are not 61,523 teachers.

Vision retains its existing schools, accounts, assessments, content and implementation records. Active teacher preparation uses School Success. Legacy implementation records remain available in read-only Implementation history; their existing reporting APIs are retained.

The Super Admin must approve school/teacher mappings by Vision IDs. Matching names alone never authorizes access. An unmapped imported school remains visible only to Super Admin. Alternatively, select a Vision school and create a fresh workspace from that school's assigned teacher IDs. Generate new public teacher links from School Success after this setup. Old shared/return links are not migrated, as authorized. Source links continue to belong to the independent original portal.

Protected features verify Vision's Supabase user, administrative role, school assignment and feature permissions on the server. Public school links can access only the selected school's teacher form and that teacher's public-link submissions, not CRM or administration. New tables and RPCs are private to the server service role. Credentials/signing keys are environment secrets, never browser variables or committed values.

## Feature checklist

“Live passed” means exercised against deployed Vision with disposable schools/accounts, not customer records. “Regression passed” means the actual ported logic passed automated tests; it is not a real-device acceptance claim.

| Original feature | Integration / verification |
| --- | --- |
| Dashboard, overview, filters and usage counts | Original components and calculations ported; deployed filtered data and scoped roster checked |
| Tickets, notes, priority, follow-up, open/due/resolved views | Ported; live ticket creation, revision and resolution passed; date views regression passed |
| Pending/completed connect calls | Ported; live call writes passed |
| Two connected stakeholder calls per school/week | Live passed: unanswered call excluded, exactly two Connected calls meet target |
| Historical CRM archive and downloads | Snapshot data copied; archive/export implementation ported; not every historical download clicked live |
| Editable call scripts and WhatsApp templates | Live save/reload and stale-edit rejection passed |
| School/contact directory | Ported with explicit access mappings; original contacts copied |
| School and individual teacher archive/restore | Live passed; restoring school does not restore separately archived teacher |
| Excel/CSV metrics import and deduplication | Live repeated XLSX import passed; new session retained; CSV parsing/normalization regression passed |
| Usage and Teacher 360° reports | Ported; preparation/evidence consolidation and school isolation regression passed |
| Report KPI settings and saved defaults | Copied; disabled/zero KPI omission checked in generated PDF text |
| Consolidated start, preparation sessions/minutes, period comparison dates | Generated PDF regression passed |
| Teacher evidence versus consultant observation selection | Independent selection and default exclusion regression passed |
| Book, E-book, Additional Materials | Separate aggregation regression passed |
| Combined PDF, school PDF ZIP, workbook and other exports | Original export paths retained; not every bulk export exercised through deployed browser |
| School-wise public teacher links | Live anonymous access passed; foreign-school teacher and administrative APIs denied |
| Protected teacher/consultant/Super Admin access | Live passed using temporary Vision identities; consultant school isolation passed |
| Multiple periods, date/class/section/subject, reflection and materials | Live API passed; actual browser saved two-period preparation and generated retained PDFs |
| Recording and transcription choice | Original MediaRecorder and browser speech-recognition workflow retained; no “optional” label; real microphone/transcription not tested |
| Preparation saved separately from later evidence | Live passed; independent dated feed events and teacher/date lookup |
| Repeat evidence updates without losing earlier files | Live passed across two successive evidence commits |
| Teacher downloads | Live GET of saved PDF/audio/photo/video-transport URLs passed |
| Uploads above Vercel body limit | Live 6 MiB direct R2 PUT/preflight passed; file bodies bypass Vercel functions |
| R2 CORS and permissions | Live PUT, GET and exact canonical origin preflight passed; existing CORS rules retained |
| Super Admin database backup | Implemented as authenticated NDJSON stream; final deployment verification required |
| Fresh Vision-school workspace | Implemented with explicit school/user IDs; final deployed new-workspace creation not yet exercised |
| iPhone Safari / Android Chrome | Responsive source retained; physical-device microphone, speech and usability tests outstanding |

## Verification commands and limits

- Original School Success baseline: 52 tests passed.
- Ported Vision regression suite: `node --test tests/success-*.test.mjs` — 37 passed, including generated PDF text assertions.
- Vision `npm run build` passed after the navigation/history and Super Admin additions.
- Deployed API acceptance: 13 stories passed using disposable accounts and records. The video check verifies 6 MiB transport, not playback: synthetic bytes were used rather than a decodable movie. Recording retention was tested with a valid WAV tone, not a spoken recording or live transcription.
- Browser acceptance: signed-out protected view denied data; public school form saved two real browser-generated period PDFs and showed a successful preparation receipt.
- No claim is made that every export option or actual mobile browser has been acceptance-tested.

## Operations and safety

Keep `SCHOOL_SUCCESS_TRANSFER_KEY` and `SCHOOL_SUCCESS_SIGNING_KEY` stable; the former decrypts the copied R2 configuration and the latter validates new upload/return grants. They are configured as sensitive Vercel environment variables. Keep `SUPABASE_SERVICE_ROLE_KEY` server-side. Preview deployments require their own server credentials; use the existing staging project's production environment for the canonical tested URL.

`NEXT_PUBLIC_SCHOOL_SUCCESS_ACTIVE=1` switches the active navigation. Removing that flag and redeploying restores the old navigation, while the two data stores remain intact. Do not run the import again after new Vision submissions. Use the protected backup and a reviewed restore procedure instead.

Source export/import services are disabled after transfer, and the source app was republished without the temporary export route. Disposable test accounts/media must be removed and the QA service disabled before handoff. Test cleanup only targets recorded QA-run IDs, never customer schools.

Supabase advisor review: new integration tables intentionally use RLS without client policies, with client grants revoked and server-only RPCs. Existing project warnings concerning pre-existing SECURITY DEFINER functions and disabled leaked-password protection were not changed as part of this migration. Review password protection separately: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection
