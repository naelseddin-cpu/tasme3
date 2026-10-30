"""tasme3 FastAPI service: ASR-backed recitation matching + frictionless
accounts/progress sync. See docs/BUILD-PLAN.md (Phase 2) for the spec this
implements, and server/RUNBOOK.md for deployment.

Privacy: uploaded audio is transcribed in memory / a briefly-lived temp
file (see asr.py) and is never written to permanent storage or logged.
Live listening (POST /stream) keeps the current take in memory only until
it ends or idles for 2 minutes (see streams.py).
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
from starlette.concurrency import run_in_threadpool
from pydantic import BaseModel

from .accounts import (
    format_code,
    generate_code_digits,
    hash_code,
    normalize_code,
)
from .asr import ASR, WhisperASR
from .matching import fuzzy_equal, match_transcript, normalize_arabic, word_forms
from .streams import StreamError, StreamStore
from .pagedata import MAX_PAGE, MIN_PAGE, PageNotFoundError, expected_words
from .ratelimit import SlidingWindowLimiter
from .store import GroupError, Store

DEFAULT_DB_PATH = str(Path(__file__).resolve().parent / "data" / "tasme3.db")
MAX_PROGRESS_BYTES = 64 * 1024
MAX_AUDIO_BYTES = 15 * 1024 * 1024  # generous cap for a short recitation clip

ACCOUNT_RATE_LIMIT = 10  # attempts / minute / IP
# requests / minute / IP; live listening sends ~40/min per reciter, so a GPU host raises it
EVALUATE_RATE_LIMIT = int(os.environ.get("EVALUATE_RATE_LIMIT", "30"))
STREAM_WINDOW_SECONDS = 25.0  # Whisper never sees more than this (long clips truncate)
ANCHOR_EARLY_SECONDS = 0.6


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
    # Groups (memorize together)
    # ------------------------------------------------------------------

    def _clean(text, field, limit):
        t = (text or "").strip()
        if not t or len(t) > limit:
            raise HTTPException(status_code=400, detail=f"{field} must be 1-{limit} characters")
        return t

    def _group_call(fn, *args):
        try:
            return fn(*args)
        except GroupError as e:
            raise HTTPException(status_code=e.status, detail=e.detail)

    @app.post("/groups")
    async def create_group(request: Request):
        enforce_rate_limit(account_limiter, request)
        code_hash = require_auth(request)
        body = await request.json()
        return _group_call(store.create_group, code_hash, _clean(body.get("name"), "name", 60), _clean(body.get("nickname"), "nickname", 40))

    @app.post("/groups/join")
    async def join_group(request: Request):
        enforce_rate_limit(account_limiter, request)
        code_hash = require_auth(request)
        body = await request.json()
        return _group_call(store.join_group, code_hash, _clean(body.get("invite"), "invite", 16), _clean(body.get("nickname"), "nickname", 40))

    @app.get("/groups")
    def list_groups(request: Request):
        enforce_rate_limit(evaluate_limiter, request)
        return {"groups": store.my_groups(require_auth(request))}

    @app.get("/groups/{gid}")
    def view_group(gid: str, request: Request, today: Optional[str] = None):
        enforce_rate_limit(evaluate_limiter, request)
        code_hash = require_auth(request)
        from datetime import date
        day = today if (today and len(today) == 10) else date.today().isoformat()  # the member's local date
        return _group_call(store.group_view, code_hash, gid, day)

    @app.post("/groups/{gid}/leave")
    def leave_group(gid: str, request: Request):
        enforce_rate_limit(account_limiter, request)
        store.leave_group(require_auth(request), gid)
        return {"ok": True}

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

    streams = StreamStore()
    app.state.streams = streams

    def _pointer_time(expected, pointer, level, words):
        """End time (seconds into the take) of the spoken word that matched
        expected[pointer - 1]: the next window starts there, anchored at
        `pointer`, so already-recited words are never re-matched."""
        if pointer <= 0 or not words:
            return None
        forms = word_forms(expected[pointer - 1])
        for w, _start, end in reversed(words):
            n = normalize_arabic(w)
            if n and any(n == f or fuzzy_equal(n, f, level) for f in forms):
                # word ends are estimates: anchor a little EARLY. Re-hearing the end of
                # a matched word is harmless (leading tokens are skipped); starting
                # late could cut off the next word.
                return round(max(0.0, end - ANCHOR_EARLY_SECONDS), 2)
        return None

    @app.post("/stream")
    async def stream(
        request: Request,
        chunk: UploadFile = File(...),
        sid: str = Form(...),
        seq: int = Form(...),
        page: int = Form(...),
        pointer: int = Form(...),
        level: int = Form(...),
        start: float = Form(0.0),
        final: int = Form(0),
    ):
        """Live listening. The client uploads one continuous take in ordered
        pieces (seq 0, 1, 2, ...: only the new audio each time) and asks, each
        time, which words were recited after `pointer`, listening only from
        `start` seconds into the take (the end time of the last revealed word,
        returned here as pointer_time). The take is held in memory only and is
        dropped on final=1 or after 2 idle minutes."""
        enforce_rate_limit(evaluate_limiter, request)
        if not (MIN_PAGE <= page <= MAX_PAGE):
            raise HTTPException(status_code=400, detail=f"page must be between {MIN_PAGE} and {MAX_PAGE}")
        if pointer < 0 or seq < 0 or start < 0:
            raise HTTPException(status_code=400, detail="pointer, seq and start must be >= 0")
        if level not in (1, 2, 3, 4):
            raise HTTPException(status_code=400, detail="level must be 1-4")
        try:
            expected = expected_words(page)
        except PageNotFoundError:
            raise HTTPException(status_code=404, detail="page not found")
        data = await chunk.read()
        if len(data) > MAX_AUDIO_BYTES:
            raise HTTPException(status_code=413, detail="audio too large")
        try:
            take = streams.append(sid, seq, data)
        except StreamError as e:
            raise HTTPException(status_code=e.status, detail=e.detail)
        try:
            # in a worker thread: concurrent reciters can then share one batched GPU pass
            transcript, words = await run_in_threadpool(asr.transcribe_window, take, start, STREAM_WINDOW_SECONDS)
        finally:
            del take
            if final:
                streams.drop(sid)
        result = match_transcript(expected, pointer, transcript, level)
        response = {
            "matched": result["matched"],
            "pointer": result["pointer"],
            "done": result["pointer"] >= len(expected),
            "pointer_time": _pointer_time(expected, result["pointer"], level, words) if result["pointer"] > pointer else None,
        }
        if request.query_params.get("debug") == "1":
            response["transcript"] = transcript
        return response

    return app


app = create_app()
