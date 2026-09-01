# tasme3 server — deploy runbook

Target: any 2 vCPU VPS (per docs/BUILD-PLAN.md). This service is the only
heavy component; the client is a static PWA served elsewhere (CDN/GitHub
Pages).

## Privacy statement (put this in the app's UI copy too)

**Audio is processed in memory for the duration of one request and is
never stored.** `/evaluate` reads the uploaded clip into memory, hands it
to the transcriber (which itself deletes any temp file it created
immediately after decoding — see `server/asr.py`), and nothing about the
audio bytes is logged or written to disk. The transcript itself is not
returned to the client by default either — only which printed words were
recognized (index list). Pass `?debug=1` only for local development to see
the raw transcript in the response.

No accounts collect email, phone, or password — see "Frictionless
accounts" in `docs/BUILD-PLAN.md`. Only a SHA-256 hash of a random 10-digit
code is stored; the code itself is never persisted.

## 1. System dependencies

```bash
sudo apt-get update
sudo apt-get install -y python3.11 python3.11-venv ffmpeg
```

`ffmpeg` is required so the ASR pipeline (faster-whisper's internal
decoder) can accept uploaded audio containers (webm/mp4/ogg), not just raw
wav/pcm.

## 2. Install

```bash
cd /path/to/tasme3
python3.11 -m venv server/.venv
source server/.venv/bin/activate
pip install -r server/requirements.txt
```

## 3. Model — Quran-tuned Whisper (default) and the CT2 conversion step

**The default model is `tarteel-ai/whisper-base-ar-quran`** (a Whisper
checkpoint fine-tuned on Quranic recitation — founder decision, chosen
over generic Whisper for this domain). It is configured via the
`WHISPER_MODEL` env var and can be:

- a HuggingFace model id in **CTranslate2** format (what faster-whisper
  needs directly), or
- a local path to a CTranslate2 model directory, or
- a generic size string (`base`, `small`, `large-v3`, ...) for faster-whisper
  to fetch and convert on the fly — this works for stock Whisper sizes but
  **not** for `tarteel-ai/whisper-base-ar-quran`, because that repo on
  HuggingFace is published as a plain **transformers** checkpoint, not
  CTranslate2. Loading it directly will fail; `server/asr.py` catches this
  and raises a clear error pointing back here instead of silently falling
  back or crashing the request.

### One-time conversion (run once at deploy time, not per-request)

```bash
source server/.venv/bin/activate
pip install ctranslate2 transformers[torch]

ct2-transformers-converter \
  --model tarteel-ai/whisper-base-ar-quran \
  --output_dir models/whisper-base-ar-quran-ct2 \
  --quantization int8 \
  --copy_files tokenizer_config.json preprocessor_config.json

# Point the service at the converted directory:
export WHISPER_MODEL=models/whisper-base-ar-quran-ct2
```

Before running the conversion, check whether someone has already published
a pre-converted CTranslate2 build of this model on HuggingFace (search
`whisper-base-ar-quran ct2` / `whisper-base-ar-quran faster-whisper`) — if
one exists, set `WHISPER_MODEL` to that repo id directly and skip the
conversion. This could not be verified from inside the build sandbox
(HuggingFace network access is blocked there by the proxy); check from the
actual VPS, which has normal internet access.

### A/B comparison against generic Whisper

Generic sizes remain valid values for `WHISPER_MODEL` (faster-whisper
downloads + auto-converts these on first use, no manual conversion step
needed): `base`, `small`, `medium`, `large-v3`. Useful for comparing
recognition quality against the Quran-tuned model once live:

```bash
WHISPER_MODEL=base ...      # generic multilingual base model
WHISPER_MODEL=small ...     # larger, slower, generally more accurate
```

### Guarding against a blocked/slow model load

The model loads **lazily** on first `/evaluate` call, not at process
start — the service still boots and answers `/healthz` even if the model
can't be reached yet. `GET /healthz` reports `model_loaded: false` until
the first successful load. If the model can never be reached (network
issue, wrong path), `/evaluate` degrades to an empty transcript (no words
matched) rather than crashing — check the service logs for `[asr] ...`
lines, which name the failure (network vs. wrong/unconverted model format).

Pre-warm the model at deploy time so the first real user isn't the one
waiting on the load/conversion:

```bash
curl -s -X POST http://localhost:8000/evaluate \
  -F "page=604" -F "pointer=0" -F "level=2" \
  -F "audio=@/dev/null;type=audio/wav"
curl -s http://localhost:8000/healthz   # model_loaded should now be true
```

## 4. Configuration (environment variables)

| Var | Default | Notes |
|---|---|---|
| `WHISPER_MODEL` | `tarteel-ai/whisper-base-ar-quran` | See §3. Must be CT2 format or a generic size string. |
| `ALLOWED_ORIGINS` | `*` | Comma-separated list of allowed CORS origins. **Lock this to the site's real origin(s) before going live** — e.g. `ALLOWED_ORIGINS=https://tasme3.example.com,https://username.github.io`. The `*` default is for local testing only. |
| `DB_PATH` | `server/data/tasme3.db` | SQLite file for accounts/progress. |

## 5. Run

### Docker (recommended)

```bash
cd /path/to/tasme3
ALLOWED_ORIGINS=https://tasme3.example.com docker compose -f server/docker-compose.yml up -d --build
```

(See `server/docker-compose.yml` — build context is the repo root because
the image needs `app/mushaf/pages/*.json`.)

To use a converted CT2 model, put it under `./models/whisper-base-ar-quran-ct2`
next to `docker-compose.yml` and set `WHISPER_MODEL=/models/whisper-base-ar-quran-ct2`.

### systemd (alternative to Docker)

`/etc/systemd/system/tasme3-server.service`:

```ini
[Unit]
Description=tasme3 ASR + accounts service
After=network.target

[Service]
Type=simple
User=tasme3
WorkingDirectory=/path/to/tasme3
Environment=ALLOWED_ORIGINS=https://tasme3.example.com
Environment=WHISPER_MODEL=/path/to/tasme3/models/whisper-base-ar-quran-ct2
ExecStart=/path/to/tasme3/server/.venv/bin/uvicorn server.main:app --host 0.0.0.0 --port 8000
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now tasme3-server
```

Put a reverse proxy (Caddy/Nginx) in front for TLS; it is not included
here since it's independent of this app.

## 6. Backups

`server/data/tasme3.db` is the entire state (account code hashes +
progress key/value pairs — no audio, no PII). It is small; back it up like
any SQLite file:

```bash
# Safe hot backup (doesn't require stopping the service):
sqlite3 server/data/tasme3.db ".backup /backups/tasme3-$(date +%F).db"
```

Cron this daily; keep a handful of rotations. Losing this file only loses
save-code -> progress mappings — per the frictionless-accounts design this
is an accepted, documented risk (see docs/BUILD-PLAN.md), not a
catastrophic one.

## 7. Load target

10 concurrent short recitation clips on 2 vCPU (int8 `base`-sized model,
per docs/BUILD-PLAN.md). Re-benchmark once the Quran-tuned CT2 model is in
place — its size/latency profile should be close to stock `base` since
it's the same architecture, but confirm on the actual VPS.

## 8. Client fallback

If the server is unreachable, the client should fall back to typed input
with a clear "offline / recognition unavailable" message (see
docs/BUILD-PLAN.md, Phase 2) — this is a client-side (Phase 3) concern, not
implemented in this server.
