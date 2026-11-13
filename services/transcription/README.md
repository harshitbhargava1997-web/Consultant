# Vision transcription worker — deployment candidate

Status: prepared, not deployed or connected to the teacher portal. Do not switch
teachers to this service until the deployment and real-audio acceptance tests pass.

## Deployment

Use `services/transcription` as the Docker build root. Keep one replica and one
Uvicorn worker. Attach a persistent volume at `/data`; never use ephemeral storage
for jobs. On Railway disable Serverless/app sleeping. Configure automatic restart
and a `/health` check; model initialization must finish before readiness succeeds.
Initial model download requires outbound access to Hugging Face. Model files stay
on the volume, and the model remains loaded while the process is running.

Pilot configuration (not a capacity guarantee): 2 CPU threads, up to 8 GB memory,
10 GB volume, multilingual `small` model with CPU int8. Measure actual CPU/RAM,
latency, Hindi/English/mixed accuracy and concurrent submissions before selecting
production resources. A larger multilingual model or GPU may be necessary.

Set `TRANSCRIPTION_API_TOKEN` using a secret manager to a cryptographically random
value of at least 32 characters. Never put it in browser code or Git. TLS is required.
Set `DATA_DIR=/data`, `WHISPER_MODEL=small`, `CPU_THREADS=2`.

Cloud hosting is billable; final account/region/resource limits and pricing remain
to be selected. This package does not create or purchase cloud resources.

## Portal integration contract (remaining work)

The authenticated portal backend must authorize the signed-in teacher/school link
and derive an opaque owner identity itself. Never accept owner identity directly
from an untrusted browser. Forward it as X-Owner and attach the secret bearer token.
All endpoints except health require this token. Expose neither token nor raw worker
access to teachers. Add per-teacher request limits at the portal gateway.

POST /jobs: raw recorded audio body, X-Job-ID (stable UUID for this segment),
X-Language (hi/en/auto), X-Owner and Authorization. Same ID + same recording is
idempotent; conflicting contents return 409. Poll GET /jobs/{id} with the same
owner and authorization. States: queued, processing, completed, failed.
An empty completed transcript means no recognized speech; ask the teacher to review,
not to accept invented text. Do not auto-overwrite existing typed or reviewed notes.

Upload directly using a short-lived, scoped upload grant or existing private media
storage integration when implementing the portal; do not proxy 25 MB bodies through
a function with a smaller platform request limit. The current worker expects a
trusted backend upload, so this grant/storage bridge must be implemented before use.

Retain the original segment and its planning-section identity in a browser draft
until upload is acknowledged; store the job ID for reload/poll recovery. The service
retains accepted audio and results for seven days, including terminal failures.
The portal must copy accepted results into the saved lesson before expiry. Display
that retention window accurately. This is not permanent lesson storage.

## Recovery and limits

SQLite queue and audio persist on the volume. Interrupted processing is requeued
on restart. Three processing attempts with delay are allowed. At most 30 active jobs
globally and 5 per teacher; overflow returns 429 without accepting a recording.
Limit each recording to 25 MB and 10 minutes. Add an edge body-size limit and
request timeout in hosting configuration. Only one recording is processed at a time.
Seven-day retention is enforced for terminal jobs; volume monitoring is necessary.
A single server can restart or fail; always-on does not imply high availability.
Backups and restoration should be tested before school rollout.

## Verification

Run `python -m unittest discover -s services/transcription -p 'test_*.py'` from repo
root with FastAPI/httpx installed. Tests use a stub model/decoder; they test API
access, ownership, queue recovery and retries, not transcription accuracy.

Before activation: build the container; verify real model download/readiness;
transcribe representative Android/iPhone recordings (Hindi, English, code-switching,
noise, silence); measure latency and RAM at 1, 5 and 10 submitted jobs; restart during
processing; test expired/unauthorized access; test portal upload disconnect/retry and
that reviewed text is never silently overwritten. Portal integration is pending.
