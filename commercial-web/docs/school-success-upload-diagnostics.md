# Teacher evidence uploads: diagnostics and retries

18 November 2026. Scope: browser uploads of School Success evidence (lesson preparation, classroom evidence) via `lib/school-success/client.js`.

## Report

On an iPhone, after **Save lesson preparation** with no audio recorded, a teacher saw "Storage upload failed. Please retry this file."

That message was returned only when the browser's presigned `PUT` to R2 produced a **readable non-success response**.
- A CORS or network failure makes `fetch` throw instead; Safari shows "Load failed".
- So R2 (or something answering for it with CORS headers) rejected the upload.
- The code did not keep the status, R2 error code or reference, so the original answer is lost. No production request records remain either: the plan keeps runtime logs for about an hour.

## Investigation against the real bucket

`scripts/r2-upload-selfcheck.mjs` replays exactly what a browser sends. It uses the production `evidencePlan()` keys and `presignUpload()` signer, sends a CORS preflight followed by a `PUT` with `Origin` and `Content-Type`, and works on a synthetic school/teacher. It was run with Production settings in a build designed to always fail, so it could never be served (`dpl_2XHebveii4xdYkh9nX3fpnaqi5bH`).

| Request | Preflight | PUT |
|---|---|---|
| Generated preparation PDF (file ID = period ID) | 204 | 200, HEAD 200 |
| Same key again (what a retry does) | 204 | 200 |
| 3 MB photo attachment | 204 | 200 |
| PDF attachment | 204 | 200 |
| Names with spaces, punctuation and Devanagari | 204 | 200 |
| Optional m4a audio | 204 | 200 |

The bucket CORS rule is: origin `https://vision-school-commercial-staging.vercel.app`; methods GET, HEAD, PUT; headers `*`; exposes `ETag`; max age 3600.

**Conclusion.** Signing, content types, expiry, CORS for the live origin, key encoding, overwrite-on-retry and audio all work for a well-formed request. The teacher's failure was **not reproduced**, and its root cause is **not confirmed**.
- What remains are device- or network-specific answers, for example a slow mobile upload timing out (`400 RequestTimeout`) or transient R2 errors.
- The changes below report the exact answer next time and recover from transient ones.
- Nothing in signing, content type, expiry, CORS or body handling was changed.

## Changes

- **`lib/school-success/storage-upload.js`** (used by `client.js` for every evidence upload):
  - **Storage rejection** (R2 answered): the message names the file kind, R2 status, R2 error code and request reference when the error body carries one. Example: "Storage upload failed: storage refused the lesson preparation PDF (R2 403 AccessDenied) …".
  - **Network/CORS failure** (`fetch` threw): "… could not reach storage (network connection lost or the browser blocked the upload) …".
  - **Transient answers** are retried up to 3 attempts in total, each with a fresh presigned URL: network errors, 5xx, 408, 429, `RequestTimeout`, `SlowDown`. Permanent rejections, such as 403 or `SignatureDoesNotMatch`, are not retried.
  - The `Blob` is sent as-is, so the browser sets `Content-Length`; no manual `Content-Length`.
- **The upload ticket** (`/api/school-success/evidence/upload`) also returns a coarse file kind: `generated-preparation-pdf`, `lesson_plan`, `voice`, ….
- **`POST /api/school-success/evidence/upload-report`** (authenticated) logs only `{event, kind, file, status, code, ref, attempt, final, agent}`. The agent is coarse, for example `iPhone 18 Safari`. A strict schema refuses URLs, tokens, file names and any other field. The upload ticket header is stripped before reporting.
- **Both upload pages** prefix the message with "File i of n".
  - Entered text and selected files stay on the page after any failure.
  - A retry reuses the same submission ID, so keys and the commit are idempotent: no duplicate submission.
  - A committed submission returns "already saved" and is never re-uploaded.
  - Audio stays optional.

## Verification

- **Unit and route tests** (`tests/success-storage-upload.test.mjs`):
  - success;
  - 403 with no retry and a safe message and report;
  - 503 → `RequestTimeout` → success with fresh tickets;
  - network failure ×3;
  - ticket errors passed through;
  - safe parsing;
  - report route: authentication, strict schema, origin check, logs free of names.
- **Simulated browser check:** Chromium with iPhone 13 emulation (**not Safari/WebKit and not a physical device**), the real teacher-portal UI and real `client.js`, with our API and R2 scripted. It covered: saving without audio; with a recorded audio note; 403 then manual retry; 503 auto-recovery; network failure ×3 then manual retry. In each case the text was kept, one submission ID and one commit were used, and the page did not scroll sideways.
- **Not verified:**
  - Safari/WebKit and a physical iPhone;
  - the real teacher's network;
  - the actual R2 answer from the original failure.
- **After deploying, the next failure will show it:** the R2 status and code appear on screen, and a `browser-upload-failed` entry appears in the production logs (retained about one hour).

## Rollback

Revert the PR. There are no schema, settings or bucket changes. The synthetic objects from the check are under `schools/ZZ Synthetic Upload Check/…` and `schools/ZZ Synthetic School (Check) & Co's/…`; there are 5 (the retry overwrote its own synthetic key) and no records reference them.
