# Portal loading investigation and deployed improvements

23 October 2026. Vision staging: https://vision-school-commercial-staging.vercel.app/ . Independent School Success module: https://vision-school-commercial-staging.vercel.app/school-success .

Runtime commit `c5ecb0659dceabb8698a876cf72ef1d630049960` is deployed as `dpl_HZoCbpDmHbAAujWVgWeEhseJseWz`, READY, with the canonical staging alias confirmed. The original standalone School Success deployment was not changed.

## Findings and changes

The public teacher request downloaded the whole period's usage data before filtering it to the selected teacher. The October 1–23 query had 10,541 raw records. It also read CRM, calendar and other administrative data that the public form did not use. Teacher requests now apply the authorized school, teacher and uploader predicates inside the database request, use the school's own roster, and skip administrative reads. Existing final authorization checks remain in place.

Many independent reads ran sequentially. They now run concurrently, including bounded parallel pagination for complete administrative reports. A report exceeding the supported row limit fails with a request to narrow the period instead of silently losing records. No historical records were removed to improve speed.

Vercel functions previously ran in `iad1` while the existing Supabase project is in Mumbai (`ap-south-1`). The existing staging project now explicitly uses `bom1`, next to its database. No database migration to another region or hosting provider was required.

Vision initially loaded almost every workspace's JavaScript, and its startup performed separate role, school, consultant and module-access checks. Workspaces now load when opened. `/api/workspace` returns the current verified user's permitted schools, roles, enabled UI grants and independent School Success access in one request. Server authorization and database policies continue to enforce access; grants are not cached across users. The browser reuses one Supabase client, while server requests retain separate clients.

The first optimization exposed a scalar equality quoting error in the teacher feed. Preparations and evidence were saved but absent from the feed. The final runtime corrects this, and both API and real public-browser checks confirm preparation and successive evidence events appear together.

## Measurements

Actual canonical-deployment API calls from the same Node probe environment, including response download. These are endpoint measurements, not full-page paint timings or a guarantee for every network/device. Each range contains two samples; this is a small diagnostic sample, not a load test.

| Request | Before | Final deployment |
| --- | ---: | ---: |
| School Success public teacher, empty temporary school | 13.129–13.209 s | 0.516–0.894 s |
| School Success admin, October 1–23 | 14.586–30.428 s | 3.554–3.929 s |
| Vision startup identity | 3.360–8.340 s, consultant-summary request only | 1.453–6.728 s, combined workspace request |

The startup requests are different workloads: the new one includes memberships, schools, role permissions and module access previously obtained separately. Its final server timings were 0.345–1.093 s; one 6.728 s end-to-end sample shows network/connection delay remains material. Do not interpret the server timing as the user's total wait.

For the first optimization deployment, the admin response retained exactly 7,867 mapped entries and 2,565,147 bytes. A SHA-256 comparison of entries, archives, rosters, report settings, calendars and CRM archive matched the original response. Final regression fixtures added 11 feed entries temporarily: the final measurements above had 7,878 entries and 2,574,466 bytes. These fixtures are removed after verification. The teacher response is intentionally different: it includes only the authorized teacher's data and roster, without unused administrative datasets.

| Next.js build output | Before | After |
| --- | ---: | ---: |
| Vision root page-specific JavaScript | 70.0 kB | 11.0 kB |
| Vision root total First Load JS | 238 kB | 182 kB |
| School Success page-specific JavaScript | 44.2 kB | 13.8 kB |
| School Success total First Load JS | 225 kB | 197 kB |

These are build-reported bundle sizes, not page-load speed percentages. CRM/report code is downloaded when its workspace is opened.

## Database changes

Applied migration `portal_loading_performance`; reproducible SQL is appended to `migrations/school-success.sql`.

- Private `school_success_school_roster(text)` queries the requested school's roster. It is SECURITY INVOKER, with execution denied to `anon` and `authenticated` and granted only to `service_role`.
- Added indexes for teacher scope, preparation date, evidence date, normalized roster school and member school/name.
- An EXPLAIN check still showed a broad historical scan for the all-school month query. The measured improvement must not be attributed to a proven index-plan improvement; request scoping, concurrency and region placement are the main verified changes.

## Verification

- Production Next.js build passed. Local business/report/native teacher regression suite: **48 passed, zero failed**.
- Deployed checks passed for administrator access, anonymous denial, explicit consultant school scope, foreign-school/teacher denial, consultant revocation, ticket updates, unanswered-call exclusion, template persistence/revisions, repeated workbook import deduplication and new-session retention, and school/teacher archive/restore.
- Final corrected deployment passed two-period preparation, retained preparation PDF and WAV, teacher/date lookup, return grants, repeated evidence updates, original file retention, and successful teacher download responses.
- PNG, WAV, PDF and a 6 MiB MP4 payload used direct R2 uploads. Canonical-origin CORS preflight and PUT passed. MP4 bytes were synthetic: this checks transport, not movie playback. WAV was a valid tone, not microphone speech.
- Actual deployed data generated combined PDF, two school PDFs in ZIP, and a workbook summary. PDF regressions cover KPI exclusions, consolidated opening, preparation sessions/minutes, dated period comparison, independent consultant-observation selection and separate resource types.
- Combined workspace endpoint passed administrator, unassigned teacher/consultant and anonymous checks. Unassigned users received no native schools, memberships or UI role grants.
- Native Vision school, membership, lesson, public-link and historical mapping rowsets compared unchanged after School Success writes. Module public links could not authorize the native Vision teacher API.
- Real public Chrome UI loaded the teacher form, selected the authorized teacher, displayed preparation and evidence history, and found saved lessons for the planned date. Screenshot: `portal-performance-check-20261023.jpg`.
- Final deployment error/fatal runtime-log query returned no matching entries at the time checked; this is not continuous monitoring.
- Cleanup completed: eight QA-only R2 objects, both temporary school datasets and all eight temporary accounts were removed. The verification function was replaced with a disabled handler and JWT enforcement restored. Final database checks found zero QA runs, members, records or accounts; the existing 61,524 usage/lesson records remain. Native data at the final check contains eight schools, 43 memberships, two historical implementation entries, three public-link records, zero native lessons and one retained historical mapping. Cleanup targets only fixture identities and does not reset concurrent user activity.

## Limits and remaining performance work

The full monthly administrative response remains about 2.6 MB and several seconds. Large all-school report ranges still require full records for the preserved report calculations. Server-side aggregation and separately loaded dashboard/report datasets are possible future improvements, with report-equivalence checks required.

Physical iPhone Safari, Android Chrome, microphone recording and live speech recognition were not tested in this performance pass. Browser speech availability and local connectivity can affect those features. No physical-device performance claim is made. The original standalone portal's performance is outside these deployed changes.
