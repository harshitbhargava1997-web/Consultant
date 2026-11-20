# School Success submission performance

## Scope and acceptance

Teachers reported evidence submissions taking 10–15 seconds and intermittent browser “Load failed” errors. This change targets lesson preparation, evidence submission and the teacher landing page in the integrated School Success module. It does not change native Vision, report contents or school authorization.

Acceptance: fewer network round trips; bounded simultaneous transfers; automatic recovery from transient network failures; no duplicate evidence event after a lost commit response; retained drafts after failed submissions; success shown without waiting for an unrelated workspace refresh.

## Changes

- Prepare can return upload permissions with the existing sealed file tokens. Clients without this opt-in keep the earlier flow. Each successful normal upload avoids a separate permission request; a failed transfer obtains a fresh permission when retrying.
- Browser transfers use a pool of three. Active work drains before reporting failure, preventing a manual retry from overlapping the previous batch. Add Evidence remembers successful files within the current draft.
- Reads and the existing idempotent prepare/commit requests retry transient connection errors and HTTP 408/429/5xx responses up to three attempts. Permission, validation and version conflicts still return immediately. Retry requests retain the submission/update identity.
- Commit checks media with bounded concurrency and stores immutable written reflections concurrently. The database append still happens only after all required storage checks succeed.
- The school-teacher landing request returns identity, roster and settings after existing authorization. It skips bulk history and reflection loading; lesson lookup remains available on demand. Admin reads retain their full data.
- A successful commit closes the draft and displays its receipt immediately. Teachers can reopen the saved lesson explicitly. Admin report refresh runs separately and cannot turn a successful save into an upload failure.
- Reflection reads clear their timeout and apply it through response-body completion.

## Validation (21 November 2026)

- Offline suite: 257 tests, 255 passed, 2 opt-in real-R2 tests skipped. Production build passed.
- New regression coverage includes bounded queue draining, interrupted JSON responses, non-retryable permission/conflict responses, bundled upload permissions, teacher bootstrap scoping, missing-file rejection and a real-route lost commit response that creates exactly one evidence update.
- A local Chromium mobile-viewport run against the application UI and real evidence handlers with synthetic authentication, database and storage completed a six-file upload plus written reflection. With first prepare, media transfers and the commit response interrupted, retries recovered one saved evidence event. Reopening showed all six files and the written reflection. The healthy run used no separate upload-permission requests.
- These browser checks use simulated storage and network conditions. They do not establish real mobile upload times. Physical Safari/Android, live school accounts and production storage have not been tested for this change. A further browser scenario exhausting all upload attempts was interrupted by the workspace restart and is not counted as passing.

## Risks and release

File size and connection bandwidth still determine upload time. Parallel uploads reduce serial overhead but do not increase a phone's available bandwidth. Retry traffic is bounded; simultaneous work remains limited. Files are not recompressed or altered.

No migration, credential change or storage-layout change is required. Existing clients and signed tokens remain supported. Before merge/release, review the PR and its CI. Rollback is a code/deployment rollback to the previous release; teacher records and existing evidence remain intact.
