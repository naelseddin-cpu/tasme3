"""Accounts + progress flow: create -> put -> get, wrong code -> 401, rate
limiting -> 429, Arabic-Indic digit code entry.
"""

from urllib.parse import quote

import pytest
from fastapi.testclient import TestClient

from server.accounts import normalize_code
from server.asr import FakeASR
from server.main import create_app


@pytest.fixture
def client(tmp_path):
    db_path = str(tmp_path / "test.db")
    app = create_app(asr=FakeASR(""), db_path=db_path, allowed_origins=["*"])
    return TestClient(app)


def test_create_account_returns_formatted_and_raw_code(client):
    resp = client.post("/account", json={"nickname": "أحمد"})
    assert resp.status_code == 200
    body = resp.json()
    assert "code" in body and "code_raw" in body
    assert body["code_raw"].isdigit()
    assert len(body["code_raw"]) == 10
    # formatted as 3-3-4 groups with spaces
    assert body["code"].replace(" ", "") == body["code_raw"]
    assert body["code"].count(" ") == 2
    assert body["nickname"] == "أحمد"


def test_create_account_without_nickname(client):
    resp = client.post("/account", json={})
    assert resp.status_code == 200
    assert resp.json()["nickname"] is None


def test_put_then_get_progress_roundtrip(client):
    created = client.post("/account", json={}).json()
    code = created["code_raw"]
    headers = {"Authorization": f"Bearer {code}"}

    put_resp = client.put(
        "/progress",
        headers=headers,
        content=b'{"streak": 5, "page604": {"done": true}}',
    )
    assert put_resp.status_code == 200

    get_resp = client.get("/progress", headers=headers)
    assert get_resp.status_code == 200
    data = get_resp.json()
    assert data["streak"] == 5
    assert data["page604"] == {"done": True}


def test_progress_last_write_wins_per_key(client):
    created = client.post("/account", json={}).json()
    headers = {"Authorization": f"Bearer {created['code_raw']}"}
    client.put("/progress", headers=headers, content=b'{"streak": 1}')
    client.put("/progress", headers=headers, content=b'{"streak": 2, "other": "x"}')
    data = client.get("/progress", headers=headers).json()
    assert data["streak"] == 2
    assert data["other"] == "x"


def test_get_account_returns_nickname_and_created_at(client):
    created = client.post("/account", json={"nickname": "سارة"}).json()
    headers = {"Authorization": f"Bearer {created['code_raw']}"}
    resp = client.get("/account", headers=headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["nickname"] == "سارة"
    assert "created_at" in body


def test_wrong_code_is_401(client):
    client.post("/account", json={})
    resp = client.get("/progress", headers={"Authorization": "Bearer 0000000000"})
    assert resp.status_code == 401


def test_missing_auth_header_is_401(client):
    resp = client.get("/progress")
    assert resp.status_code == 401


def test_progress_body_over_size_limit_rejected(client):
    created = client.post("/account", json={}).json()
    headers = {"Authorization": f"Bearer {created['code_raw']}"}
    huge_value = "x" * (70 * 1024)
    body = ('{"blob": "' + huge_value + '"}').encode()
    resp = client.put("/progress", headers=headers, content=body)
    assert resp.status_code == 413


def test_progress_body_must_be_json_object(client):
    created = client.post("/account", json={}).json()
    headers = {"Authorization": f"Bearer {created['code_raw']}"}
    resp = client.put("/progress", headers=headers, content=b"[1,2,3]")
    assert resp.status_code == 400


def test_arabic_indic_digit_code_entry_works(client):
    created = client.post("/account", json={}).json()
    western = created["code_raw"]
    arabic_indic_map = str.maketrans("0123456789", "٠١٢٣٤٥٦٧٨٩")
    arabic_code = western.translate(arabic_indic_map)
    assert normalize_code(arabic_code) == western

    # HTTP header values are conventionally ASCII; a real client
    # percent-encodes non-ASCII input before sending it in a header
    # (browsers' fetch() Headers enforce this too) — the server
    # un-percent-encodes then normalizes, see main._extract_bearer_code.
    headers = {"Authorization": f"Bearer {quote(arabic_code)}"}
    resp = client.get("/account", headers=headers)
    assert resp.status_code == 200


def test_code_with_spaces_and_dashes_normalizes(client):
    created = client.post("/account", json={}).json()
    raw = created["code_raw"]
    spaced = f"{raw[0:3]}-{raw[3:6]} {raw[6:10]}"
    headers = {"Authorization": f"Bearer {spaced}"}
    resp = client.get("/account", headers=headers)
    assert resp.status_code == 200


def test_account_rate_limit_429(client):
    # ACCOUNT_RATE_LIMIT is 10/min/IP; TestClient requests all share the
    # same fake client IP ("testclient").
    last = None
    for _ in range(10):
        last = client.post("/account", json={})
        assert last.status_code == 200
    over_limit = client.post("/account", json={})
    assert over_limit.status_code == 429
    assert "Retry-After" in over_limit.headers
