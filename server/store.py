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
CREATE TABLE IF NOT EXISTS groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    invite TEXT NOT NULL UNIQUE,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS group_members (
    group_id TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    nickname TEXT NOT NULL,
    joined_at TEXT NOT NULL,
    PRIMARY KEY (group_id, code_hash)
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


# ---------------------------------------------------------------------------
# Groups: people who memorize together. A member shares only summary numbers
# (pages memorized, words, streak, today's words, last active), computed from
# the progress that member's device already syncs -- never audio or page text.
# ---------------------------------------------------------------------------
MAX_GROUPS_PER_ACCOUNT = 20
MAX_MEMBERS = 200


def _summary(progress: Dict[str, Any], today: str) -> Dict[str, Any]:
    pages = progress.get("progressByPage") or {}
    memorized = sum(1 for v in pages.values() if isinstance(v, dict) and v.get("completedAt"))
    words = sum(len(v.get("revealed") or []) for v in pages.values() if isinstance(v, dict))
    streak = progress.get("streak") or {}
    t = progress.get("today") or {}
    words_today = t.get("wordsRevealed", 0) if t.get("date") == today else 0
    last = streak.get("lastActiveDate")
    count = streak.get("count", 0) if last in (today,) or (last and last >= _yesterday(today)) else 0
    return {"pages": memorized, "words": words, "streak": count, "words_today": words_today,
            "recited_today": words_today > 0, "last_active": last}


def _yesterday(today: str) -> str:
    from datetime import date, timedelta
    return (date.fromisoformat(today) - timedelta(days=1)).isoformat()


class GroupError(Exception):
    def __init__(self, status: int, detail: str) -> None:
        super().__init__(detail)
        self.status, self.detail = status, detail


def _group_methods():
    import secrets as _secrets

    def create_group(self, code_hash: str, name: str, nickname: str) -> Dict[str, Any]:
        with self._conn() as conn:
            n = conn.execute("SELECT COUNT(*) FROM group_members WHERE code_hash = ?", (code_hash,)).fetchone()[0]
            if n >= MAX_GROUPS_PER_ACCOUNT:
                raise GroupError(409, "too many groups")
            gid = _secrets.token_urlsafe(9)
            invite = "".join(_secrets.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") for _ in range(8))
            now = _now()
            conn.execute("INSERT INTO groups (id, name, invite, created_by, created_at) VALUES (?, ?, ?, ?, ?)",
                         (gid, name, invite, code_hash, now))
            conn.execute("INSERT INTO group_members (group_id, code_hash, nickname, joined_at) VALUES (?, ?, ?, ?)",
                         (gid, code_hash, nickname, now))
        return {"id": gid, "name": name, "invite": invite}

    def join_group(self, code_hash: str, invite: str, nickname: str) -> Dict[str, Any]:
        with self._conn() as conn:
            row = conn.execute("SELECT id, name, invite FROM groups WHERE invite = ?", (invite.upper(),)).fetchone()
            if row is None:
                raise GroupError(404, "unknown invite")
            members = conn.execute("SELECT COUNT(*) FROM group_members WHERE group_id = ?", (row[0],)).fetchone()[0]
            if members >= MAX_MEMBERS:
                raise GroupError(409, "group full")
            conn.execute("""INSERT INTO group_members (group_id, code_hash, nickname, joined_at) VALUES (?, ?, ?, ?)
                            ON CONFLICT(group_id, code_hash) DO UPDATE SET nickname = excluded.nickname""",
                         (row[0], code_hash, nickname, _now()))
        return {"id": row[0], "name": row[1], "invite": row[2]}

    def leave_group(self, code_hash: str, gid: str) -> None:
        with self._conn() as conn:
            conn.execute("DELETE FROM group_members WHERE group_id = ? AND code_hash = ?", (gid, code_hash))
            left = conn.execute("SELECT COUNT(*) FROM group_members WHERE group_id = ?", (gid,)).fetchone()[0]
            if left == 0:
                conn.execute("DELETE FROM groups WHERE id = ?", (gid,))

    def my_groups(self, code_hash: str) -> list:
        with self._conn() as conn:
            rows = conn.execute("""SELECT g.id, g.name, g.invite, (SELECT COUNT(*) FROM group_members m2 WHERE m2.group_id = g.id)
                                   FROM groups g JOIN group_members m ON m.group_id = g.id WHERE m.code_hash = ?
                                   ORDER BY m.joined_at""", (code_hash,)).fetchall()
        return [{"id": r[0], "name": r[1], "invite": r[2], "members": r[3]} for r in rows]

    def group_view(self, code_hash: str, gid: str, today: str) -> Dict[str, Any]:
        with self._conn() as conn:
            g = conn.execute("SELECT id, name, invite FROM groups WHERE id = ?", (gid,)).fetchone()
            mine = conn.execute("SELECT 1 FROM group_members WHERE group_id = ? AND code_hash = ?", (gid, code_hash)).fetchone()
            if g is None or mine is None:
                raise GroupError(404, "not a member")
            members = conn.execute("SELECT code_hash, nickname FROM group_members WHERE group_id = ? ORDER BY joined_at", (gid,)).fetchall()
        out = []
        for h, nick in members:
            row = _summary(self.get_progress(h), today)
            row["nickname"] = nick
            row["me"] = h == code_hash
            out.append(row)
        out.sort(key=lambda m: (-m["words_today"], -m["streak"], -m["pages"]))
        return {"id": g[0], "name": g[1], "invite": g[2], "today": today, "members": out,
                "together": {"recited_today": sum(1 for m in out if m["recited_today"]), "members": len(out),
                             "words_today": sum(m["words_today"] for m in out), "pages": sum(m["pages"] for m in out)}}

    return create_group, join_group, leave_group, my_groups, group_view


(Store.create_group, Store.join_group, Store.leave_group, Store.my_groups, Store.group_view) = _group_methods()
