# School Success → Vision integration inventory

Inspected 22 October 2026. This is the original inspection baseline, not the release status. See [school-success-release.md](school-success-release.md) for the subsequent implementation and verification results.

## Exact sources and release state

- School Success: https://school-success-portal.harshitbhargava1997.chatgpt.site
- Sites project: `appgprj_6ad0f097250c81918e17764a35b63298`; published version 26.
- Source checkout synchronized with repository commit `d6c8985d1a2a849c357c92cd1214b4ea2409eab6`.
- Vision: https://vision-school-commercial-staging.vercel.app/
- GitHub: `harshitbhargava1997-web/Consultant`, branch `commercial-staging`, commit `91fbd6edea245c3d3d80a9d94c32084ffb463b0f` at inspection.
- Next.js app root: `commercial-web`. Existing pending VC course changes are unrelated and must be preserved.
- Vercel project: `prj_xBPUsY6pGbZYyu7gWao8Q3np2WSm`, team `team_fHHqNVdYsWxTue6yribMawd3`.
- No application code, navigation, records, credentials or active deployment changed during this audit.

## Feature preservation checklist

All rows below are found in School Success source. None is verified in an integrated Vision deployment yet.

| Area | Source of truth | Required preservation / verification |
| --- | --- | --- |
| Overview | `app/portal.tsx`, `app/crm-priorities.tsx` | School/teacher/submission counts, resource usage, due actions, weekly connected-call totals, filters and navigation |
| CRM | `app/crm-workspace.tsx`, `lib/crm.ts`, gateway | Tickets, priority, notes, next actions, responsible person, due dates, linked calls, resolved state, archive and downloads |
| Weekly KPI | `lib/crm.ts:weeklyConnects` | Two connected calls per school per week; outcome must be Connected; no unanswered, archived, future or ticket records counted |
| Historical CRM | `lib/crm-archive.ts`, `lib/live-mapping.ts` | Preserve snapshot membership and creation date; historical conversations remain read-only; retain legacy JSON-backed contacts/calls |
| Reusable templates | `app/crm-templates.tsx`, `lib/crm-templates.ts`, template API | Bilingual scripts/WhatsApp templates, unresolved placeholders, saved revisions, stale-write protection |
| Directory | `app/school-directory.tsx`, `lib/directory.ts` | Active and archived schools/teachers, school-specific teacher identity, restore, historical report inclusion |
| Shared school links | `app/school-sharing-links.tsx`, `lib/server.ts` | Existing opaque tokens, roster selection, archive enforcement; no sign-in for intended school forms |
| Imports | `app/usage-import.tsx`, `lib/usage-import.ts`, `lib/workbook-import.ts`, gateway/RPC | XLSX/CSV, preview, rejected source row numbers, dates/durations, stable deduplication, genuinely new sessions retained |
| Usage / 360 reports | `app/report-workspace.tsx`, `lib/reports.ts`, `lib/report-comparison.ts` | Filters, saved targets/calendars, zero-usage teachers, archived inclusion, distinct Book/E-book/Additional Materials |
| PDF behavior | `lib/report-pdf.ts` | Consolidated opening, teacher preparation sessions/minutes, independent observation selection, separate dated period comparison; disabled/zero KPI sections omitted |
| Exports | `app/report-workspace.tsx`, `lib/domain.ts` | Teacher PDF, combined PDF, school PDFs ZIP, workbook, evidence CSV, CRM downloads; formula-safe CSV |
| Teacher preparation | `app/teacher-portal.tsx`, `lib/teacher-submissions.ts` | Teacher/date/class/section/subject and multiple periods, structured reflection and materials, submission identity |
| Voice | `app/voice-reflection.tsx` | Browser speech recognition, typed fallback, retained MediaRecorder audio and transcript; no optional label. Real mobile device verification still required |
| Preparation PDF | `lib/preparation-pdf.ts`, teacher portal | Generate a PDF per period, retain it with preparation and recording links |
| Later evidence | `app/lesson-evidence.tsx`, `lib/lesson-workflow.ts`, evidence API | Teacher/date lookup, signed resume grant, immutable period identities, optimistic version, idempotent append updates |
| Evidence history | `lib/live-mapping.ts`, gateway/RPC | Preparation and each evidence update remain separate feed events; prior media and history never overwritten |
| Media | `lib/r2-evidence.ts`, evidence/upload API | Photo, audio, video, PDF; object identity and links; authenticated download authorization; direct-to-R2 upload redesign for Vercel |
| Vision preservation | `commercial-web/app/page.jsx`, API routes and permissions | Assessments, digital content, user management, role grants, historical implementation records and dependent reports |

## Data / authentication / storage findings

### School Success

- Runtime is Vinext on Cloudflare Workers, not ordinary Node Next.js.
- `cloudflare:workers` supplies hosted D1 `DB` and R2 `BUCKET` bindings.
- Authentication uses Sites-supplied identity headers and a D1 owner/member registry. These headers must NOT be trusted directly on Vercel.
- Public school-form identity is a capability token stored in D1. Its pseudonymous uploader identity is derived from SHA-256 of the exact token plus teacher identity; changing this breaks lesson lookup and grants.
- Supabase project `hddqakqtfhvhjpmwdkqv` (Consultant Portal) retains source records; private Edge Function `school-success-gateway` fronts it.
- Read-only counts at inspection: 61,523 `teacher_records`, 9 `portal_call_logs`, 1 `portal_tickets`, 6 `portal_contacts`, 52 `classroom_observations`. Teacher records include usage and lessons, not 61,523 distinct teachers.
- Legacy CRM objects are also read from the Supabase `teacher_uploads` bucket: `school_crm_data.json` and `school_call_logs_store.json`.
- Original media bucket expected by the source is `onelern-media` in Cloudflare R2.

### Hosted D1 inventory (schema/source confirmed; production row counts not accessible)

| Table / keys | Meaning | Migration condition |
| --- | --- | --- |
| `portal_entries` | Local school records, ownership, version | Preserve IDs, payloads, versions, timestamps |
| `portal_members` | Teacher roster / private access | Explicitly map to Vision IDs; do not authorize on matching names |
| `portal_audit` | Actor/action/record history | Preserve append-only history |
| `portal_config:owner` | Original owner identity | Do not bootstrap ownership from first Vision visitor |
| `schoolLink:*`, `schoolLinkToken:*` | School capabilities and rosters | Preserve tokens exactly; explicitly map school and teacher IDs |
| `directoryArchive:*` | School and individual teacher archive flags | Retain flags and audit fields; school restore must not unarchive individual teachers |
| `reportSettings` | Targets, sections, calendars/defaults | Preserve configured values, not defaults only |
| `crmTemplate:*` | Saved scripts and template revisions | Preserve revisions and content |
| CRM archive snapshot key from `lib/crm-archive.ts` | Historical call membership | Preserve exact membership; never recreate it from the current live dataset |
| `r2CredentialsEncryptedV1` | AES-GCM encrypted R2 key pair | Requires original encryption key or authorized server-side re-encryption |

### Secret compatibility

- Sites environment metadata confirms `MEDIA_SETTINGS_ENCRYPTION_KEY` and `SUPABASE_GATEWAY_TOKEN` exist as secrets; their values are not returned.
- The gateway token is ALSO the source HMAC key for upload plans and lesson-return tokens. Source resume grants last up to 365 days. Blind rotation invalidates existing return links.
- Existing encrypted media configuration cannot be decrypted with a newly invented encryption key.
- Source school-link tokens/owner configuration must not be committed to Git or included in this report.
- Vision Vercel metadata lists `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`. Service role is configured only for production, not preview, at inspection.
- No School Success gateway, source database, signing, encryption or R2 configuration is currently present in Vision's listed environment variables.

### Vision

- Supabase Auth and PostgreSQL project `amtjvwroaennfypurkji` are separate from source Supabase.
- Access is derived server-side from platform admins, consultant assignments, memberships and role-feature grants.
- Read-only counts: 8 schools, 43 memberships, 2 historical implementation entries. Retain these entries and files unchanged.
- Existing implementation uploads use Supabase Storage `vision-implementation`; source School Success uses R2. Do not silently move or discard either history.

## Required integration design

1. Preserve source business logic/components in a namespaced Next.js module; replace Cloudflare runtime bindings with supported Node-side data/storage adapters.
2. Protected routes use verified Vision Supabase sessions, server-side feature grants and explicit school assignment checks. Consultant access must be filtered before data reaches the client; source's broad admin view is not sufficient.
3. Store explicit approved mappings between source schools/teachers and Vision school/user IDs. Keep source identities as provenance. Unmapped sources are denied, never matched implicitly by name.
4. Preserve source data in place initially or transfer with stable IDs, checksums, counts and a rollback plan; never point Vision's primary auth client at the source database.
5. Transfer D1 configuration using an authorized owner-only migration mechanism, not public endpoints or database credentials exposed to clients.
6. Preserve signing/encryption compatibility through an authorized secret transition or narrowly scoped legacy verification service; do not rotate originals until old grants are handled.
7. Replace source's Worker streaming upload with short-lived presigned R2 PUT URLs (or multipart upload for larger files), exact scope/MIME/size restrictions and server HEAD verification before commit. Keep file bodies out of Vercel Functions. Verify bucket CORS for exact Vision origin and HEAD/PUT requirements. The source's `FixedLengthStream` implementation is Cloudflare-specific and cannot simply be copied.
8. Keep source shared links active until validated redirect/forward compatibility is deployed. Preserve query parameters and private resume permissions; do not expose them in logs.
9. Deploy an isolated staging candidate, verify all required flows, then switch active navigation. Keep old implementation history readable and rollback possible.

## Tests actually run

Command in the original source checkout:

```sh
node --test tests/domain.test.mjs tests/crm.test.mjs tests/crm-templates.test.mjs tests/reports.test.mjs tests/report-pdf.test.mjs tests/directory.test.mjs tests/teacher-submissions.test.mjs tests/lesson-workflow-api.test.mjs tests/usage-import.test.mjs tests/workbook-import.test.mjs tests/school-links-auth.test.mjs tests/evidence-feed.test.mjs
```

Result: **52 passed, 0 failed, 0 skipped**. Includes generated PDF text assertions for KPI exclusions, observations/evidence independence, preparation consolidation and dated comparison layout. API tests use mocks and source-level validation; they do not establish deployed auth, live database writes, live deduplication, real R2 permissions/CORS or real device/browser behavior.

## Blocking access / unverified acceptance checks

- Available Sites tools support source access and environment metadata, but no hosted D1 query/export operation was found.
- Existing secret values are withheld by the normal Sites environment API. Do not extract secrets via source changes or route workarounds without an explicitly approved secure transfer procedure.
- No Cloudflare plugin was returned by connected plugin discovery.
- Need an authorized owner-only D1 export/transfer path and a safe original-key transition before cutover.
- Still untested: integrated administrator/teacher access, cross-school denial, actual CRM/template persistence, duplicate workbook ingestion against staging DB, archive/restore, real multi-period preparation and repeated uploads, retained recording/transcription/PDF, teacher-date lookup and downloads, >4.5 MB upload, R2 CORS, combined/ZIP/workbook reports, iPhone Safari and Android Chrome.
- Integration is NOT deployed. Do not represent this inventory or the 52 source tests as completed integration.
