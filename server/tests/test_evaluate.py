"""/evaluate end-to-end with FakeASR, against the real page-604 JSON."""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from server.asr import FakeASR
from server.main import create_app
from server.pagedata import expected_words

PAGE_604_PATH = (
    Path(__file__).resolve().parent.parent.parent
    / "app"
    / "mushaf"
    / "pages"
    / "page-604.json"
)

DUMMY_AUDIO = b"RIFF0000WAVEfmt not-real-audio-fake-asr-ignores-bytes"


def build_fake_transcript() -> str:
    """Joins every real word token's raw form ('w') from page 604 into one
    string — a stand-in for "the user recited exactly what's printed"."""
    with open(PAGE_604_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    words = []
    for line in data["lines"]:
        if line.get("t") != "w":
            continue
        for tok in line.get("tk", []):
            if tok.get("e"):
                continue
            if "w" in tok:
                words.append(tok["w"])
    return " ".join(words)


@pytest.fixture
def fake_asr():
    return FakeASR("")


@pytest.fixture
def client(tmp_path, fake_asr):
    db_path = str(tmp_path / "test.db")
    app = create_app(asr=fake_asr, db_path=db_path, allowed_origins=["*"])
    return TestClient(app)


def test_healthz(client):
    resp = client.get("/healthz")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["model_loaded"] is True  # FakeASR is always "ready"


def test_evaluate_full_correct_recitation_matches_all_words(client, fake_asr):
    expected = expected_words(604)
    fake_asr.set_preset(build_fake_transcript())

    resp = client.post(
        "/evaluate",
        data={"page": 604, "pointer": 0, "level": 2},
        files={"audio": ("clip.webm", DUMMY_AUDIO, "audio/webm")},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["pointer"] == len(expected)
    assert body["matched"] == list(range(len(expected)))
    assert body["done"] is True
    assert "transcript" not in body  # no debug flag -> never leaks the transcript


def test_evaluate_wrong_transcript_matches_nothing(client, fake_asr):
    fake_asr.set_preset("كيف حالك اليوم هذا كلام غير مرتبط بالمصحف تماما")

    resp = client.post(
        "/evaluate",
        data={"page": 604, "pointer": 0, "level": 2},
        files={"audio": ("clip.webm", DUMMY_AUDIO, "audio/webm")},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["matched"] == []
    assert body["pointer"] == 0
    assert body["done"] is False


def test_evaluate_debug_flag_includes_transcript(client, fake_asr):
    fake_asr.set_preset("قل هو الله احد")
    resp = client.post(
        "/evaluate?debug=1",
        data={"page": 604, "pointer": 0, "level": 2},
        files={"audio": ("clip.webm", DUMMY_AUDIO, "audio/webm")},
    )
    assert resp.status_code == 200
    assert resp.json()["transcript"] == "قل هو الله احد"


def test_evaluate_partial_recitation_advances_pointer_only_partway(client, fake_asr):
    fake_asr.set_preset("قل هو الله احد")
    resp = client.post(
        "/evaluate",
        data={"page": 604, "pointer": 0, "level": 2},
        files={"audio": ("clip.webm", DUMMY_AUDIO, "audio/webm")},
    )
    body = resp.json()
    assert body["matched"] == [0, 1, 2, 3]
    assert body["pointer"] == 4
    assert body["done"] is False


def test_evaluate_rejects_out_of_range_page(client, fake_asr):
    fake_asr.set_preset("قل")
    resp = client.post(
        "/evaluate",
        data={"page": 605, "pointer": 0, "level": 2},
        files={"audio": ("clip.webm", DUMMY_AUDIO, "audio/webm")},
    )
    assert resp.status_code == 400


def test_evaluate_rejects_invalid_level(client, fake_asr):
    fake_asr.set_preset("قل")
    resp = client.post(
        "/evaluate",
        data={"page": 604, "pointer": 0, "level": 9},
        files={"audio": ("clip.webm", DUMMY_AUDIO, "audio/webm")},
    )
    assert resp.status_code == 400


def test_evaluate_rate_limit_429(client, fake_asr):
    fake_asr.set_preset("")
    last = None
    for _ in range(30):
        last = client.post(
            "/evaluate",
            data={"page": 604, "pointer": 0, "level": 2},
            files={"audio": ("clip.webm", DUMMY_AUDIO, "audio/webm")},
        )
        assert last.status_code == 200
    over_limit = client.post(
        "/evaluate",
        data={"page": 604, "pointer": 0, "level": 2},
        files={"audio": ("clip.webm", DUMMY_AUDIO, "audio/webm")},
    )
    assert over_limit.status_code == 429
    assert "Retry-After" in over_limit.headers
