FROM python:3.12-slim-bookworm

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir \
    fastapi>=0.136.1 \
    uvicorn[standard]>=0.30.0 \
    numpy>=1.26.0 \
    && pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu \
    torch \
    torchaudio \
    && pip install --no-cache-dir \
    speechbrain>=1.0.0

COPY app.py ./app.py

RUN addgroup --system app && adduser --system --ingroup app app \
    && mkdir -p /app/models \
    && chown -R app:app /app

USER app

EXPOSE 8090

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8090"]
