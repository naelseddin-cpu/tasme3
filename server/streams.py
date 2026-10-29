"""In-memory buffers for live recitation takes (POST /stream).

A take is one continuous MediaRecorder recording, uploaded as ordered pieces
(only the new audio each time, so weak connections send a few KB per request).
The buffer lives in process memory for the duration of the take only: it is
never written to disk or logged, it is dropped on the take's final request,
and any take idle for IDLE_SECONDS is swept. Limits keep memory bounded.
"""
from __future__ import annotations

import re
import threading
import time
from typing import Dict

IDLE_SECONDS = 120.0
MAX_STREAM_BYTES = 6 * 1024 * 1024  # ~25 min of opus speech
MAX_STREAMS = 200
SID_RE = re.compile(r"^[A-Za-z0-9_-]{8,64}$")


class StreamError(Exception):
    def __init__(self, status: int, detail: str) -> None:
        super().__init__(detail)
        self.status, self.detail = status, detail


class StreamStore:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._streams: Dict[str, dict] = {}

    def _sweep(self, now: float) -> None:
        for sid in [s for s, v in self._streams.items() if now - v["touched"] > IDLE_SECONDS]:
            del self._streams[sid]

    def append(self, sid: str, seq: int, data: bytes) -> bytes:
        """Add piece `seq` (0 starts a new take) and return the whole take so far."""
        if not SID_RE.match(sid or ""):
            raise StreamError(400, "bad sid")
        now = time.monotonic()
        with self._lock:
            self._sweep(now)
            if seq == 0:
                if sid not in self._streams and len(self._streams) >= MAX_STREAMS:
                    raise StreamError(503, "busy")
                self._streams[sid] = {"buf": bytearray(), "next": 0, "touched": now}
            s = self._streams.get(sid)
            if s is None or seq != s["next"]:
                raise StreamError(409, "seq")  # client restarts the take
            if len(s["buf"]) + len(data) > MAX_STREAM_BYTES:
                del self._streams[sid]
                raise StreamError(413, "take too long")
            s["buf"] += data
            s["next"] += 1
            s["touched"] = now
            return bytes(s["buf"])

    def drop(self, sid: str) -> None:
        with self._lock:
            self._streams.pop(sid, None)

    def __len__(self) -> int:
        return len(self._streams)
