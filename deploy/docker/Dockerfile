# tasme3 ASR + accounts service — provider-neutral deploy image. Works
# unmodified on: an Oracle Cloud "Always Free" ARM VM, any small VPS, or
# Google Cloud Run. See deploy/docker/README.md for setup steps on each
# (English + Arabic, non-developer level), and server/RUNBOOK.md for the
# fuller operational picture.
#
# This image is entirely self-contained: it `git clone`s the real tasme3
# source at BUILD time (so this deploy/docker/ folder need never be copied
# alongside a full checkout — only these two files, plus warmup.py, matter),
# installs it, pre-converts + pre-warms the Quran-tuned Whisper model, and
# serves on $PORT (default 8000; Cloud Run overrides this itself).
#
# Multi-stage build: the Quran-tuned Whisper checkpoint
# (tarteel-ai/whisper-base-ar-quran) is published on HuggingFace as a plain
# transformers checkpoint, not the CTranslate2 format faster-whisper needs
# (server/RUNBOOK.md "Quran-tuned model conversion" has the full story) —
# converting it needs ctranslate2 + transformers[torch], but ACTUALLY
# SERVING it at runtime only ever needs ctranslate2 (a faster-whisper
# dependency) and ffmpeg. Doing the conversion in a throwaway `convert`
# stage keeps torch (several hundred MB, otherwise dead weight at runtime)
# out of the final image entirely. Every package this Dockerfile installs
# (ctranslate2, faster-whisper and its faster-whisper[conversion] extras,
# torch) publishes manylinux **aarch64** wheels as well as x86_64 — this
# image builds and runs unmodified on an Oracle Cloud A1 (ARM) VM, not just
# x86_64 VPS/Cloud Run instances.

# ---------------------------------------------------------------- convert
FROM python:3.11-slim AS convert

RUN pip install --no-cache-dir ctranslate2 "transformers[torch]"

# Before rebuilding this image, check whether someone has already published
# a pre-converted CTranslate2 build of this model on HuggingFace (search
# "whisper-base-ar-quran ct2" / "whisper-base-ar-quran faster-whisper") —
# if one exists, delete this whole `convert` stage, drop the COPY --from
# below, and just set WHISPER_MODEL to that repo id directly in the
# `runtime` stage's ENV instead. This could not be verified from inside the
# build sandbox this Dockerfile was authored in (HuggingFace network access
# is blocked there); a real build host has normal internet access.
RUN ct2-transformers-converter \
      --model tarteel-ai/whisper-base-ar-quran \
      --output_dir /model \
      --quantization int8 \
      --copy_files tokenizer_config.json preprocessor_config.json

# ---------------------------------------------------------------- runtime
FROM python:3.11-slim

# ffmpeg: system dependency for audio container decoding (webm/mp4/ogg),
# same as server/Dockerfile. git: to clone the app source below (build-time
# only — not needed once the clone completes, but stripping it after the
# fact isn't worth a second apt layer).
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg git \
    && rm -rf /var/lib/apt/lists/*

# Non-root user.
RUN useradd --create-home --uid 1000 user
USER user
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH
WORKDIR /home/user/app

# --- App source: cloned fresh at build time (see file-header note above).
# Pin TASME3_REF to a tag/commit once the project stabilizes; `main` is
# fine while a rebuild is an explicit action, never triggered automatically
# by an upstream push.
ARG TASME3_REPO=https://github.com/naelseddin-cpu/tasme3
ARG TASME3_REF=main
RUN git clone --depth 1 --branch ${TASME3_REF} ${TASME3_REPO} src

RUN pip install --no-cache-dir --user -r src/server/requirements.txt

# --- Pre-converted Quran-tuned Whisper model (see the `convert` stage) ---
COPY --from=convert /model /home/user/app/models/whisper-base-ar-quran-ct2
ENV WHISPER_MODEL=/home/user/app/models/whisper-base-ar-quran-ct2

# Pre-warm: load the model once at build time so a broken conversion fails
# the build, not a live user's first request (see warmup.py's own header
# for exactly what this does and does not buy you).
COPY --chown=user:user warmup.py /home/user/app/warmup.py
RUN PYTHONPATH=/home/user/app/src python3 /home/user/app/warmup.py

# --- Writable data dir for SQLite (accounts/progress) ---
# This directory is INSIDE the container's own filesystem layer, so it is
# wiped on every `docker run`/redeploy unless the host mounts a volume over
# it (`-v tasme3-data:/home/user/app/data`, or Cloud Run's own storage —
# see deploy/docker/README.md's per-option persistence notes). The provided
# docker-compose.yml already mounts a named volume here.
RUN mkdir -p /home/user/app/data
ENV DB_PATH=/home/user/app/data/tasme3.db

# --- CORS: lock to the deployed static site's real origin ---
# Founder decision: the GitHub Pages site. Comma-separate more origins if
# the app is ever mirrored elsewhere. Overridable at `docker run -e
# ALLOWED_ORIGINS=...` without rebuilding the image.
ENV ALLOWED_ORIGINS=https://naelseddin-cpu.github.io

WORKDIR /home/user/app/src
ENV PYTHONPATH=/home/user/app/src

# $PORT is read at container START (shell-form CMD), not baked in at build
# time, so the same image works unmodified on a plain VPS (default 8000)
# and on Google Cloud Run (which injects its own $PORT, normally 8080, and
# expects the container to honor it).
ENV PORT=8000
EXPOSE 8000
CMD uvicorn server.main:app --host 0.0.0.0 --port ${PORT:-8000}
