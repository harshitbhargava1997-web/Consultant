import os
import sys
import tempfile
import unittest
import uuid
from types import SimpleNamespace, ModuleType
from unittest.mock import patch
from fastapi import HTTPException
from fastapi.testclient import TestClient
from service import Jobs, create_app


class QueueTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.jobs = Jobs(self.temp.name)
        self.id = str(uuid.uuid4())
    def tearDown(self):
        self.temp.cleanup()
    def add(self):
        return self.jobs.create(self.id, 'teacher-a', 'hi', b'audio')
    def test_idempotency_and_owner_isolation(self):
        self.add()
        self.assertEqual(self.add()['id'], self.id)
        with self.assertRaises(HTTPException) as e:
            self.jobs.get(self.id, 'teacher-b')
        self.assertEqual(e.exception.status_code, 404)
        with self.assertRaises(HTTPException) as e:
            self.jobs.create(self.id, 'teacher-b', 'hi', b'audio')
        self.assertEqual(e.exception.status_code, 409)
    def test_restart_recovers_interrupted_jobs(self):
        self.add()
        with self.jobs.db() as db:
            db.execute("UPDATE jobs SET state='processing' WHERE id=?", (self.id,))
        restarted = Jobs(self.temp.name)
        self.assertEqual(restarted.get(self.id, 'teacher-a')['state'], 'queued')
        self.assertTrue((restarted.root / (self.id + '.audio')).exists())
    def test_success_and_bounded_retries_retain_audio(self):
        self.add()
        module = ModuleType('faster_whisper.audio')
        module.decode_audio = lambda *args, **kw: [0] * 160
        model = SimpleNamespace(transcribe=lambda *a, **kw: ([SimpleNamespace(text=' शिक्षक की योजना ')], None))
        with patch.dict(sys.modules, {'faster_whisper.audio': module}):
            self.jobs.process_one(model)
        self.assertEqual(self.jobs.get(self.id, 'teacher-a')['text'], 'शिक्षक की योजना')
        with self.jobs.db() as db:
            db.execute("UPDATE jobs SET state='queued',attempts=0")
        module.decode_audio = lambda *a, **kw: (_ for _ in ()).throw(ValueError('bad audio'))
        with patch.dict(sys.modules, {'faster_whisper.audio': module}):
            for i in range(3):
                with self.jobs.db() as db:
                    db.execute('UPDATE jobs SET next_try=0')
                self.jobs.process_one(model)
        self.assertEqual(self.jobs.get(self.id, 'teacher-a')['state'], 'failed')
        self.assertTrue((self.jobs.root / (self.id + '.audio')).exists())
    def test_per_teacher_capacity(self):
        for i in range(5):
            self.jobs.create(str(uuid.uuid4()), 'teacher-a', None, b'audio')
        with self.assertRaises(HTTPException) as e:
            self.add()
        self.assertEqual(e.exception.status_code, 429)
    def test_expiry_removes_terminal_audio(self):
        self.add()
        with self.jobs.db() as db:
            db.execute("UPDATE jobs SET state='completed',created=0")
        self.jobs.cleanup()
        self.assertFalse((self.jobs.root / (self.id + '.audio')).exists())


class ApiTests(unittest.TestCase):
    def test_auth_validation_and_idempotent_upload(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {'DATA_DIR': folder, 'TRANSCRIPTION_API_TOKEN': 'a' * 40}):
            # Without lifespan: test request handling without starting a model worker.
            client = TestClient(create_app())
            self.assertEqual(client.post('/jobs', content=b'audio').status_code, 401)
            headers = {'Authorization': 'Bearer ' + 'a'*40, 'X-Owner': 'teacher-a', 'X-Job-ID': str(uuid.uuid4())}
            self.assertEqual(client.post('/jobs', headers=headers, content=b'').status_code, 400)
            first = client.post('/jobs', headers=headers, content=b'audio')
            self.assertEqual(first.status_code, 202)
            self.assertEqual(client.post('/jobs', headers=headers, content=b'audio').json(), first.json())
            self.assertEqual(client.post('/jobs', headers=headers, content=b'different').status_code, 409)
            self.assertEqual(client.get('/jobs/'+headers['X-Job-ID'], headers={**headers, 'X-Owner': 'teacher-b'}).status_code, 404)
            with patch('service.MAX_BYTES', 3):
                self.assertEqual(client.post('/jobs', headers=headers, content=b'longer').status_code, 413)
    def test_missing_secret_fails_closed(self):
        with patch.dict(os.environ, {'TRANSCRIPTION_API_TOKEN': ''}):
            with self.assertRaises(RuntimeError):
                create_app()


if __name__ == '__main__':
    unittest.main()
