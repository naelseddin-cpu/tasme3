"""POST /stream: live listening over one continuous take uploaded in pieces."""
from fastapi.testclient import TestClient

from server.asr import FakeASR
from server.main import create_app
from server.pagedata import expected_words

SID = "test-take-0001"


def _client(text):
    asr = FakeASR(text)
    return TestClient(create_app(asr=asr, db_path=":memory:")), asr


def _post(c, seq, pointer=0, start=0.0, final=0, sid=SID, page=1, level=2):
    return c.post("/stream", data={"sid": sid, "seq": seq, "page": page, "pointer": pointer, "level": level,
                                   "start": start, "final": final},
                  files={"chunk": ("c.webm", b"x" * 10, "audio/webm")})


def test_pieces_accumulate_and_words_match():
    c, asr = _client("بسم الله الرحمن الرحيم")
    r = _post(c, 0); assert r.status_code == 200
    r = _post(c, 1); d = r.json()
    assert d["pointer"] == 4 and d["matched"] == [0, 1, 2, 3]
    assert asr.last_audio_len == 20  # both pieces handed over as one take
    assert d["pointer_time"] == 1.4  # 4th fake word ends at 4 * 0.5 s, anchored 0.6 s early


def test_window_start_is_passed_to_asr():
    c, asr = _client("بسم")
    _post(c, 0, start=3.5)
    assert asr.last_window_start == 3.5


def test_out_of_order_piece_is_rejected():
    c, _ = _client("بسم")
    assert _post(c, 0).status_code == 200
    assert _post(c, 2).status_code == 409
    assert _post(c, 1, sid="never-started-take").status_code == 409


def test_final_drops_the_take():
    c, _ = _client("بسم")
    _post(c, 0); _post(c, 1, final=1)
    assert len(c.app.state.streams) == 0
    assert _post(c, 2).status_code == 409


def test_no_advance_gives_no_pointer_time():
    c, _ = _client("كلام لا علاقة له")
    d = _post(c, 0).json()
    assert d["pointer"] == 0 and d["pointer_time"] is None


def test_bad_sid_rejected():
    c, _ = _client("بسم")
    assert _post(c, 0, sid="x").status_code == 400
