"""Single-instance, persistent transcription worker. API is server-to-server only."""
import hashlib
import hmac
import os
import sqlite3
import shutil
import threading
import time
import uuid
from contextlib import contextmanager, asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException, Request

MAX_BYTES = int(os.environ.get("MAX_UPLOAD_MB", "5")) * 1024 * 1024
RETENTION = 2 * 86400


class Jobs:
    def __init__(self, root):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        with self.db() as db:
            db.execute('''CREATE TABLE IF NOT EXISTS jobs (
                id TEXT PRIMARY KEY, owner TEXT NOT NULL, digest TEXT NOT NULL,
                language TEXT, state TEXT NOT NULL, text TEXT, attempts INTEGER DEFAULT 0,
                created REAL NOT NULL, next_try REAL DEFAULT 0)''')
            db.execute("UPDATE jobs SET state='queued' WHERE state='processing'")

    @contextmanager
    def db(self):
        with self.lock:
            db = sqlite3.connect(self.root / 'jobs.sqlite')
            db.row_factory = sqlite3.Row
            try:
                with db:
                    yield db
            finally:
                db.close()

    def create(self, job_id, owner, language, audio):
        digest = hashlib.sha256(audio).hexdigest()
        with self.db() as db:
            previous = db.execute('SELECT * FROM jobs WHERE id=?', (job_id,)).fetchone()
            if previous:
                if (previous['owner'], previous['digest'], previous['language']) != (owner, digest, language):
                    raise HTTPException(409, 'Recording identity already used')
                return self.public(previous)
            if db.execute("SELECT COUNT(*) FROM jobs WHERE state IN ('queued','processing')").fetchone()[0] >= 10:
                raise HTTPException(429, 'Queue full. Keep the recording and retry later.')
            if db.execute("SELECT COUNT(*) FROM jobs WHERE owner=? AND state IN ('queued','processing')", (owner,)).fetchone()[0] >= 5:
                raise HTTPException(429, 'Please wait for your pending recordings.')
            if shutil.disk_usage(self.root).free < len(audio) + 30 * 1024 * 1024:
                raise HTTPException(507, 'Storage full. Keep the recording and retry later.')
            path = self.root / (job_id + '.audio')
            path.write_bytes(audio)
            try:
                db.execute('INSERT INTO jobs (id,owner,digest,language,state,created) VALUES (?,?,?,?,?,?)',
                           (job_id, owner, digest, language, 'queued', time.time()))
            except Exception:
                path.unlink(missing_ok=True)
                raise
        return {'id': job_id, 'state': 'queued', 'text': None}

    @staticmethod
    def public(row):
        return {key: row[key] for key in ('id', 'state', 'text')}

    def get(self, job_id, owner):
        with self.db() as db:
            row = db.execute('SELECT * FROM jobs WHERE id=? AND owner=?', (job_id, owner)).fetchone()
            if not row:
                raise HTTPException(404, 'Recording not found or expired')
            return self.public(row)

    def process_one(self, model):
        with self.db() as db:
            row = db.execute("SELECT * FROM jobs WHERE state='queued' AND next_try<=? ORDER BY created LIMIT 1", (time.time(),)).fetchone()
            if not row:
                return False
            db.execute("UPDATE jobs SET state='processing', attempts=attempts+1 WHERE id=?", (row['id'],))
        try:
            # Decode once with a duration bound before invoking the model.
            from faster_whisper.audio import decode_audio
            samples = decode_audio(str(self.root / (row['id'] + '.audio')), sampling_rate=16000)
            if len(samples) > 16000 * 120:
                raise ValueError('Recording exceeds two minutes')
            segments, _ = model.transcribe(samples, language=row['language'], task='transcribe',
                                            vad_filter=True, beam_size=1, condition_on_previous_text=False)
            text = ' '.join(segment.text.strip() for segment in segments).strip()
            with self.db() as db:
                db.execute("UPDATE jobs SET state='completed', text=? WHERE id=?", (text, row['id']))
        except Exception:
            # Never log teacher audio, transcript, or provider exception details.
            state = 'failed' if row['attempts'] + 1 >= 3 else 'queued'
            with self.db() as db:
                db.execute('UPDATE jobs SET state=?,next_try=? WHERE id=?',
                           (state, time.time() + 10 * (row['attempts'] + 1), row['id']))
        return True

    def cleanup(self):
        with self.db() as db:
            rows = db.execute("SELECT id FROM jobs WHERE created<? AND state IN ('completed','failed')", (time.time() - RETENTION,)).fetchall()
            for row in rows:
                (self.root / (row['id'] + '.audio')).unlink(missing_ok=True)
                db.execute('DELETE FROM jobs WHERE id=?', (row['id'],))


def create_app(model_factory=None):
    token = os.environ.get('TRANSCRIPTION_API_TOKEN', '')
    if len(token) < 32:
        raise RuntimeError('Set a random TRANSCRIPTION_API_TOKEN of at least 32 characters')
    jobs = Jobs(os.environ.get('DATA_DIR', '/data'))

    def authenticate(authorization, owner):
        if not hmac.compare_digest(authorization or '', 'Bearer ' + token):
            raise HTTPException(401, 'Unauthorized')
        if not owner or len(owner) > 128:
            raise HTTPException(400, 'Trusted owner identity required')

    @asynccontextmanager
    async def lifespan(app):
        if model_factory:
            model = model_factory()
        else:
            from faster_whisper import WhisperModel
            model = WhisperModel(os.environ.get('WHISPER_MODEL', 'base'), device='cpu', compute_type='int8',
                                 cpu_threads=int(os.environ.get('CPU_THREADS', '1')),
                                 download_root=str(jobs.root / 'models'))
        stop = threading.Event()
        def run():
            while not stop.is_set():
                jobs.cleanup()
                if not jobs.process_one(model):
                    stop.wait(1)
        worker = threading.Thread(target=run, daemon=True)
        worker.start()
        app.state.worker = worker
        yield
        stop.set()
        worker.join(timeout=5)

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

    @app.get('/health')
    def health():
        if not getattr(app.state, 'worker', None) or not app.state.worker.is_alive():
            raise HTTPException(503, 'Worker unavailable')
        return {'ready': True}

    @app.post('/jobs', status_code=202)
    async def submit(request: Request, authorization: str = Header(default=''),
                     x_owner: str = Header(default=''), x_job_id: str = Header(default=''),
                     x_language: str = Header(default='auto')):
        authenticate(authorization, x_owner)
        try:
            job_id = str(uuid.UUID(x_job_id))
        except ValueError:
            raise HTTPException(400, 'Valid recording UUID required')
        if x_language not in ('en', 'hi', 'auto'):
            raise HTTPException(400, 'Choose English, Hindi or auto')
        audio = bytearray()
        async for chunk in request.stream():
            if len(audio) + len(chunk) > MAX_BYTES:
                raise HTTPException(413, 'Recording exceeds upload limit')
            audio.extend(chunk)
        if not audio:
            raise HTTPException(400, 'Empty recording')
        return jobs.create(job_id, x_owner, None if x_language == 'auto' else x_language, audio)

    @app.get('/jobs/{job_id}')
    def status(job_id: str, authorization: str = Header(default=''), x_owner: str = Header(default='')):
        authenticate(authorization, x_owner)
        return jobs.get(job_id, x_owner)

    return app
