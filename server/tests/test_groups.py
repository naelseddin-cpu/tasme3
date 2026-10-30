"""Groups: create, invite by code, join, the shared summary, leave."""
import json
from datetime import date

from fastapi.testclient import TestClient

from server.asr import FakeASR
from server.main import create_app


def _client(tmp_path):
    return TestClient(create_app(asr=FakeASR(""), db_path=str(tmp_path / "t.db")))


def _account(c):
    code = c.post("/account", json={}).json()["code_raw"]
    return {"Authorization": "Bearer " + code}


def test_group_flow(tmp_path):
    c = _client(tmp_path)
    a, b = _account(c), _account(c)
    today = date.today().isoformat()
    g = c.post("/groups", json={"name": "حلقة الفجر", "nickname": "أحمد"}, headers=a).json()
    assert g["name"] == "حلقة الفجر" and len(g["invite"]) == 8
    c.put("/progress", headers=b, content=json.dumps({
        "progressByPage": {"3": {"pointer": 127, "revealed": list(range(127)), "completedAt": today}},
        "streak": {"count": 4, "lastActiveDate": today}, "today": {"date": today, "wordsRevealed": 127}}))
    j = c.post("/groups/join", json={"invite": g["invite"].lower(), "nickname": "سارة"}, headers=b)
    assert j.status_code == 200 and j.json()["id"] == g["id"]
    view = c.get(f"/groups/{g['id']}?today={today}", headers=a).json()
    assert [m["nickname"] for m in view["members"]] == ["سارة", "أحمد"]       # most recited today first
    sara = view["members"][0]
    assert sara == {"pages": 1, "words": 127, "streak": 4, "words_today": 127, "recited_today": True,
                    "last_active": today, "nickname": "سارة", "me": False}
    assert view["together"] == {"recited_today": 1, "members": 2, "words_today": 127, "pages": 1}
    assert c.get("/groups", headers=b).json()["groups"][0]["members"] == 2


def test_only_members_can_view_and_bad_invite(tmp_path):
    c = _client(tmp_path)
    a, x = _account(c), _account(c)
    g = c.post("/groups", json={"name": "G", "nickname": "a"}, headers=a).json()
    assert c.get(f"/groups/{g['id']}", headers=x).status_code == 404
    assert c.post("/groups/join", json={"invite": "NOPE0000", "nickname": "x"}, headers=x).status_code == 404
    assert c.post("/groups", json={"name": "", "nickname": "a"}, headers=a).status_code == 400
    assert c.post("/groups", json={"name": "G", "nickname": "a"}).status_code == 401


def test_leave_last_member_deletes_group(tmp_path):
    c = _client(tmp_path)
    a = _account(c)
    g = c.post("/groups", json={"name": "G", "nickname": "a"}, headers=a).json()
    assert c.post(f"/groups/{g['id']}/leave", headers=a).json()["ok"]
    assert c.get("/groups", headers=a).json()["groups"] == []
