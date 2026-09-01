# tasme3 ASR + accounts service.
# Build context MUST be the repo root (not server/), because the image
# needs app/mushaf/pages/*.json (the page word-token data /evaluate reads).
#
#   docker build -f server/Dockerfile -t tasme3-server .
#
FROM python:3.11-slim

# ffmpeg: system dependency for audio container decoding (webm/mp4/ogg),
# used internally by faster-whisper's decoding pipeline.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Non-root user.
RUN useradd --create-home --uid 10001 appuser
WORKDIR /srv/app

COPY server/requirements.txt /srv/app/server/requirements.txt
RUN pip install --no-cache-dir -r /srv/app/server/requirements.txt

# Server code + the page data it reads (see note above on build context).
COPY server/ /srv/app/server/
COPY app/mushaf/pages/ /srv/app/app/mushaf/pages/

# SQLite file lives here at runtime; mount a volume over it (see
# docker-compose.yml) so it survives container recreation.
RUN mkdir -p /srv/app/server/data && chown -R appuser:appuser /srv/app

USER appuser
EXPOSE 8000

# No default WHISPER_MODEL override here — server/asr.py's own default
# (tarteel-ai/whisper-base-ar-quran, once converted per RUNBOOK.md) applies
# unless overridden by the environment.
CMD ["uvicorn", "server.main:app", "--host", "0.0.0.0", "--port", "8000"]
