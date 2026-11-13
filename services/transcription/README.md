# Low-memory transcription pilot

Deployment target: one always-running process, 1 GB memory limit, 1 CPU,
500 MB persistent volume at /data, multilingual base model using CPU int8.
Model fit, real-audio accuracy and speed must be measured before portal activation.
This pilot is not a promise of school-wide capacity or permanently free hosting.

Set TRANSCRIPTION_API_TOKEN in the platform secret store (32+ random characters),
WHISPER_MODEL=base, CPU_THREADS=1, DATA_DIR=/data and MAX_UPLOAD_MB=5.
Disable app sleeping. Build this directory's Dockerfile. Readiness is /health.
Keep one replica and one worker. The queue is durable on the persistent volume.

Limits: 5 MB per recording, two minutes of decoded speech, ten queued/processing
jobs globally, five per owner, one inference at a time. Terminal results/audio expire
after 48 hours. Uploads are rejected when free storage would fall below 30 MB.
Use compressed original phone recordings rather than combined PCM WAV files.

Portal integration remains pending. The trusted portal backend must authenticate
teachers, derive X-Owner, apply request limits and attach the secret bearer token.
POST /jobs takes raw audio, X-Job-ID (stable UUID), X-Owner and X-Language (hi/en/auto).
Poll GET /jobs/{id} with the same owner and token. Keep the original recording until
accepted; copy completed text into the saved lesson before expiry. Never silently
overwrite edited text. Do not expose the shared secret in browser code.

The large-upload bridge must use scoped grants or private object storage to avoid
function request size limits. No bridge is implemented yet. Real recordings and
restart/concurrency tests are required before teacher rollout.

Tests: python -m unittest discover -s services/transcription -p 'test_*.py'
Queue/API tests use model stubs and do not establish speech recognition accuracy.
