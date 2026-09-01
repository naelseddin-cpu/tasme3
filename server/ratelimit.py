"""Simple in-memory sliding-window rate limiter.

Deliberately not Redis/anything external: this is a single-process FastAPI
service on one small VPS (per BUILD-PLAN.md). If the service is ever run
with multiple worker processes, each worker gets its own independent
counters — acceptable for this project's abuse model (see RUNBOOK.md /
BUILD-PLAN.md "deliberate, documented security posture").
"""

from __future__ import annotations

import math
import time
from collections import defaultdict, deque
from typing import Deque, Dict, Optional


class SlidingWindowLimiter:
    def __init__(self, max_requests: int, window_seconds: float = 60.0) -> None:
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._hits: Dict[str, Deque[float]] = defaultdict(deque)

    def check(self, key: str) -> Optional[float]:
        """Record a hit for `key` if under the limit.

        Returns None if the request is allowed. Returns the number of
        whole seconds the caller should wait (Retry-After) if the request
        is over the limit — and does NOT count it as a hit.
        """
        now = time.monotonic()
        dq = self._hits[key]
        while dq and now - dq[0] > self.window_seconds:
            dq.popleft()
        if len(dq) >= self.max_requests:
            retry_after = self.window_seconds - (now - dq[0])
            return max(1, math.ceil(retry_after))
        dq.append(now)
        return None

    def reset(self) -> None:
        """Test helper: clear all recorded hits."""
        self._hits.clear()
