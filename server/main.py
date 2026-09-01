"""tasme3 FastAPI service: ASR-backed recitation matching + frictionless
accounts/progress sync. See docs/BUILD-PLAN.md (Phase 2) for the spec this
implements, and server/RUNBOOK.md for deployment.

Privacy: uploaded audio is transcribed in memory / a briefly-lived temp
file (see asr.py) and is never written to permanent storage or logged.
By default /evaluate does not return the transcript either (the app
"never writes the Quran, only reveals the print") — pass ?debug=1 to
include it for local debugging.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import List, Optional
from urllib.parse import unquote

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .accounts import (
    format_code,
    generate_code_digits,
    hash_code,
    normalize_code,
)
from .asr import ASR, WhisperASR
from .matching import match_transcript
from .pagedata import MAX_PAGE, MIN_PAGE, PageNotFoundError, expected_words
from .ratelimit import SlidingWindowLimiter
from .store import Store

DEFAULT_DB_PATH = str(Path(__file__).resolve().parent / "data" / "tasme3.db")
MAX_PROGRESS_BYTES = 64 * 1024
MAX_AUDIO_BYTES = 15 * 1024 * 1024  # generous cap for a short recitation clip

ACCOUNT_RATE_LIMIT = 10  # attempts / minute / IP
EVALUATE_RATE_LIMIT = 30  # requests / minute / IP


class AccountCreate(BaseModel):
    nickname: Optional[str] = None


def _parse_origins(raw: str) -> List[str]:
    raw = (raw or "*").strip()
    if raw == "*":
        return ["*"]
    return [o.strip() for o in raw.split(",") if o.strip()]


def _client_ip(request: Request) -> str:
    if request.client:
        return request.client.host
    return "unknown"


def _extract_bearer_code(authorization: Optional[str]) -> Optional[str]:
    """Extracts the code from `Authorization: Bearer <code>`.

    HTTP header values are conventionally ASCII/Latin-1; a code entered in
    Arabic-Indic digits (٠-٩) must be percent-encoded by the client to
    travel safely in a header (browsers' fetch() Headers also reject raw
    non-ASCII header values), so this un-percent-encodes before handing
    off to normalize_code(), which then converts Arabic-Indic -> Western
    digits and strips spaces/dashes. A plain Western-digit code round-trips
    through unquote() unchanged.
    """
    if not authorization:
        return None
    parts = authorization.split(None, 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    return unquote(parts[1])


def create_app(
    asr: Optional[ASR] = None,
    db_path: Optional[str] = None,
    allowed_origins: Optional[List[str]] = None,
) -> FastAPI:
    app = FastAPI(title="tasme3-server")

    asr = asr if asr is not None else WhisperASR()
    db_path = db_path if db_path is not None else os.environ.get("DB_PATH", DEFAULT_DB_PATH)
    store = Store(db_path)
    origins = (
        allowed_origins
        if allowed_origins is not None
        else _parse_origins(os.environ.get("ALLOWED_ORIGINS", "*"))
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    account_limiter = SlidingWindowLimiter(ACCOUNT_RATE_LIMIT, 60.0)
    evaluate_limiter = SlidingWindowLimiter(EVALUATE_RATE_LIMIT, 60.0)

    app.state.asr = asr
    app.state.store = store

    def enforce_rate_limit(limiter: SlidingWindowLimiter, request: Request) -> None:
        retry_after = limiter.check(_client_ip(request))
        if retry_after is not None:
            raise HTTPException(
                status_code=429,
                detail="rate limit exceeded",
                headers={"Retry-After": str(retry_after)},
            )

    def require_auth(request: Request) -> str:
        """Returns the account's code_hash, or raises 401."""
        code = _extract_bearer_code(request.headers.get("Authorization"))
        if not code:
            raise HTTPException(status_code=401, detail="missing bearer code")
        digits = normalize_code(code)
        if not digits:
            raise HTTPException(status_code=401, detail="invalid code")
        code_hash = hash_code(digits)
        if not store.account_exists(code_hash):
            raise HTTPException(status_code=401, detail="unknown code")
        return code_hash

    # ------------------------------------------------------------------
    # Ops
    # ------------------------------------------------------------------

    @app.get("/healthz")
    def healthz():
        return {"status": "ok", "model_loaded": asr.is_ready()}

    # ------------------------------------------------------------------
    # Accounts + progress
    # ------------------------------------------------------------------

    @app.post("/account")
    def post_account(body: AccountCreate, request: Request):
        enforce_rate_limit(account_limiter, request)
        digits = generate_code_digits()
        nickname = (body.nickname or "").strip() or None
        store.create_account(hash_code(digits), nickname)
        return {
            "code": format_code(digits),
            "code_raw": digits,
            "nickname": nickname,
        }

    @app.get("/account")
    def get_account(request: Request):
        enforce_rate_limit(account_limiter, request)
        code_hash = require_auth(request)
        account = store.get_account(code_hash)
        if account is None:
            raise HTTPException(status_code=401, detail="unknown code")
        return account

    @app.put("/progress")
    async def put_progress(request: Request):
        enforce_rate_limit(account_limiter, request)
        code_hash = require_auth(request)
        raw_body = await request.body()
        if len(raw_body) > MAX_PROGRESS_BYTES:
            raise HTTPException(status_code=413, detail="progress payload too large")
        try:
            data = json.loads(raw_body or b"{}")
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="invalid JSON body")
        if not isinstance(data, dict):
            raise HTTPException(
                status_code=400, detail="body must be a JSON object of key -> value"
            )
        store.put_progress(code_hash, data)
        return {"ok": True, "keys": list(data.keys())}

    @app.get("/progress")
    def get_progress(request: Request):
        enforce_rate_limit(account_limiter, request)
        code_hash = require_auth(request)
        return store.get_progress(code_hash)

    # ------------------------------------------------------------------
    # ASR evaluation
    # ------------------------------------------------------------------

    @app.post("/evaluate")
    async def evaluate(
        request: Request,
        audio: UploadFile = File(...),
        page: int = Form(...),
        pointer: int = Form(...),
        level: int = Form(...),
    ):
        enforce_rate_limit(evaluate_limiter, request)

        if not (MIN_PAGE <= page <= MAX_PAGE):
            raise HTTPException(
                status_code=400, detail=f"page must be between {MIN_PAGE} and {MAX_PAGE}"
            )
        if pointer < 0:
            raise HTTPException(status_code=400, detail="pointer must be >= 0")
        if level not in (1, 2, 3, 4):
            raise HTTPException(status_code=400, detail="level must be 1-4")

        try:
            expected = expected_words(page)
        except PageNotFoundError:
            raise HTTPException(status_code=404, detail="page not found")

        audio_bytes = await audio.read()
        if len(audio_bytes) > MAX_AUDIO_BYTES:
            raise HTTPException(status_code=413, detail="audio too large")

        # Audio lives only in this local variable for the duration of this
        # request; asr.transcribe() does not persist it (see asr.py), and
        # no code path here writes it to disk or logs it.
        transcript = asr.transcribe(audio_bytes)

        result = match_transcript(expected, pointer, transcript, level)
        done = result["pointer"] >= len(expected)

        response = {
            "matched": result["matched"],
            "pointer": result["pointer"],
            "done": done,
        }
        if request.query_params.get("debug") == "1":
            response["transcript"] = transcript
        return response

    return app


app = create_app()
