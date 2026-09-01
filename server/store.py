"""SQLite-backed storage for accounts and progress.

Schema (per BUILD-PLAN.md):
  accounts(code_hash TEXT PRIMARY KEY, nickname TEXT, created_at TEXT)
  progress(code_hash TEXT, key TEXT, value TEXT, updated_at TEXT,
           PRIMARY KEY (code_hash, key))

Only the SHA-256 hash of a save code is ever stored — see accounts.py.
A new sqlite3 connection is opened per call; traffic on this service is
small (one VPS, short requests) so this trades a little connection
overhead for straightforward correctness/thread-safety instead of a
shared connection + lock.
"""

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

_SCHEMA = """
CREATE TABLE IF NOT EXISTS accounts (
    code_hash TEXT PRIMARY KEY,
    nickname TEXT,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS progress (
    code_hash TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (code_hash, key)
);
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Store:
    def __init__(self, db_path: str) -> None:
        self.db_path = db_path
        if db_path != ":memory:":
            Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    @contextmanager
    def _conn(self):
        conn = sqlite3.connect(self.db_path)
        try:
            conn.execute("PRAGMA foreign_keys = ON")
            yield conn
            conn.commit()
        finally:
            conn.close()

    def _init_db(self) -> None:
        with self._conn() as conn:
            conn.executescript(_SCHEMA)

    def create_account(self, code_hash: str, nickname: Optional[str]) -> None:
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO accounts (code_hash, nickname, created_at) VALUES (?, ?, ?)",
                (code_hash, nickname, _now()),
            )

    def get_account(self, code_hash: str) -> Optional[Dict[str, Any]]:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT nickname, created_at FROM accounts WHERE code_hash = ?",
                (code_hash,),
            ).fetchone()
        if row is None:
            return None
        return {"nickname": row[0], "created_at": row[1]}

    def account_exists(self, code_hash: str) -> bool:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT 1 FROM accounts WHERE code_hash = ?", (code_hash,)
            ).fetchone()
        return row is not None

    def put_progress(self, code_hash: str, items: Dict[str, Any]) -> None:
        """Upsert each key; last-write-wins per key."""
        now = _now()
        with self._conn() as conn:
            for key, value in items.items():
                conn.execute(
                    """
                    INSERT INTO progress (code_hash, key, value, updated_at)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(code_hash, key) DO UPDATE SET
                        value = excluded.value,
                        updated_at = excluded.updated_at
                    """,
                    (code_hash, key, json.dumps(value), now),
                )

    def get_progress(self, code_hash: str) -> Dict[str, Any]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT key, value FROM progress WHERE code_hash = ?",
                (code_hash,),
            ).fetchall()
        result = {}
        for key, value in rows:
            try:
                result[key] = json.loads(value)
            except (TypeError, ValueError):
                result[key] = value
        return result
