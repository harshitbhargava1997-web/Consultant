FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY service.py .
ENV DATA_DIR=/data WHISPER_MODEL=small CPU_THREADS=2 PYTHONUNBUFFERED=1
# One process/replica only: the persistent queue and model belong to this worker.
CMD ["sh", "-c", "exec uvicorn service:create_app --factory --host 0.0.0.0 --port ${PORT:-8080} --workers 1 --no-access-log"]
