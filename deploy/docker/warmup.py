"""Build-time-only warm-up for the converted CTranslate2 Whisper model.

Run once during `docker build` (see deploy/docker/Dockerfile), NOT at
container start. Its purpose:

  1. Fail the IMAGE BUILD, not a live user's first /evaluate request, if the
     conversion produced something faster-whisper can't actually load (bad
     quantization/dtype combo, a missing tokenizer/preprocessor file, etc).
  2. Read every weight file once so they're materialized in the image's
     filesystem layer and warm in the container runtime's page cache --
     a modest, best-effort speed-up for the FIRST real request on a fresh
     container. It is NOT a fix for a scale-to-zero platform's cold-start
     time (e.g. Cloud Run's ~10-20s, see deploy/docker/README.md) --
     nothing at build time can touch that.

This process exits after loading; it holds no server socket and is not the
uvicorn process that actually serves /evaluate at runtime.
"""
import os
import sys

model_dir = os.environ.get("WHISPER_MODEL")
if not model_dir:
    print("warmup: WHISPER_MODEL not set, skipping", file=sys.stderr)
    raise SystemExit(0)

from faster_whisper import WhisperModel  # noqa: E402  (import after env check)

print("warmup: loading", model_dir, "...")
WhisperModel(model_dir, compute_type="int8")
print("warmup: model loaded OK:", model_dir)
