"""Tajweed feedback service (runs in its own venv: quran-muaalem + PyTorch).

    CUDA_VISIBLE_DEVICES=1 ~/.local/share/muaalem-venv/bin/uvicorn server.tajweed_service:app --port 8011

POST /tajweed  multipart: audio (WAV, 16 kHz mono), ayat (JSON list of "s:a",
               the verses recited completely in this audio, in order)
  -> {"ayat": [{"k": "s:a", "words": n, "errors": [
        {"word": i, "kind": "tajweed"|"tashkeel"|"normal", "op": "insert"|"delete"|"replace",
         "rules": [{"ar":..., "en":...}], "expected_len": n|None, "heard_len": n|None}]}]}

How: obadx/muaalem-model-v3_2 (MIT; "Automatic Pronunciation Error Detection and
Correction of the Holy Quran's Learners", 2025) transcribes the audio into the
Quran Phonetic Script (phonemes + sifat); quran_transcript phonetizes the
reference verses for Hafs (murattal, madd lengths below) and explain_error names
each difference (madd length, ghunna, tafkheem, tashkeel, ...). Feedback is
guidance, never an ijazah. Audio is processed in memory and never stored.
"""
from __future__ import annotations

import io
import json
import os
import threading

import numpy as np
import soundfile as sf
from fastapi import FastAPI, File, Form, HTTPException, UploadFile

app = FastAPI(title="tasme3 tajweed")
_lock = threading.Lock()
_model = None
MAX_AUDIO_BYTES = 3 * 1024 * 1024  # ~90 s of 16-bit 16 kHz audio: one take of a few verses
# madd lengths a learner is not told off for (counts): small timing drift is normal
MADD_TOLERANCE = int(os.environ.get("TAJWEED_MADD_TOLERANCE", "1"))


def _moshaf():
    from quran_transcript import MoshafAttributes
    return MoshafAttributes(rewaya="hafs", recitation_speed="murattal", madd_monfasel_len=4,
                            madd_mottasel_len=4, madd_mottasel_waqf=4, madd_aared_len=4)


def model():
    global _model
    if _model is None:
        import torch
        from quran_muaalem import Muaalem
        _model = Muaalem(device="cuda" if torch.cuda.is_available() else "cpu")
    return _model


def _free_gpu():
    try:
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        pass


def _word_index(text: str, pos: int) -> int:
    return text[:pos].count(" ")


WAQF_MARKS = set("\u06d6\u06d7\u06d8\u06d9\u06da\u06db")  # ۖ ۗ ۘ ۙ ۚ ۛ
_PAUSE_WORDS = None


def _pause_words(k):
    """Word indices in verse k followed by a waqf mark, from the official KFGQPC text
    (tools/data/quran.json): quran_transcript's Uthmani text omits the waqf marks.
    Only used when both texts split the verse into the same number of words."""
    global _PAUSE_WORDS
    if _PAUSE_WORDS is None:
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        q = json.load(open(os.path.join(root, "tools", "data", "quran.json"), encoding="utf-8"))
        _PAUSE_WORDS = {}
        for su in q:
            for v in su["verses"]:
                ws = v["text"].split()
                # a waqf mark is either attached to the word or written as its own token
                marked = {i for i, w in enumerate(ws) if any(c in WAQF_MARKS for c in w)}
                _PAUSE_WORDS[(su["id"], v["id"])] = (len([w for w in ws if not all(c in WAQF_MARKS for c in w)]), marked, ws)
    return _PAUSE_WORDS.get(k)


def _at_permitted_pause(k, text: str, span) -> bool:
    """True when the error is at the end of a word that a waqf mark follows (the
    ending a pause there allows is not a mistake)."""
    info = _pause_words(k)
    if not info or info[0] != len(text.split()):
        return False
    _, marked, ws = info
    wi = _word_index(text, span[0])
    if wi not in marked and not (wi + 1 < len(ws) and all(c in WAQF_MARKS for c in ws[wi + 1])):
        return False
    word_end = text.find(" ", span[0]); word_end = len(text) if word_end < 0 else word_end
    return word_end - span[1] <= 3   # the last letters of the word


def _split_heard(heard: str, refs: list[str]) -> list[str]:
    """Split the heard phoneme string into one part per verse, by aligning it to
    the verses' references laid end to end (edit-distance opcodes)."""
    import Levenshtein
    joined = "".join(refs)
    cut_ref, acc = [], 0
    for r in refs[:-1]:
        acc += len(r); cut_ref.append(acc)
    to_heard = {}
    for tag, i1, i2, j1, j2 in Levenshtein.opcodes(joined, heard):
        for i in range(i1, i2 + 1):
            to_heard.setdefault(i, j1 + min(i - i1, j2 - j1) if tag != "insert" else j1)
    cuts = [to_heard.get(c, len(heard)) for c in cut_ref]
    bounds = [0] + cuts + [len(heard)]
    return [heard[bounds[i]:bounds[i + 1]] for i in range(len(refs))]


@app.get("/healthz")
def healthz():
    return {"status": "ok", "model_loaded": _model is not None}


@app.post("/tajweed")
async def tajweed(audio: UploadFile = File(...), ayat: str = Form(...)):
    from quran_transcript import Aya, explain_error, quran_phonetizer

    data = await audio.read()
    if len(data) > MAX_AUDIO_BYTES:
        raise HTTPException(413, "audio too long")
    try:
        keys = [tuple(int(x) for x in k.split(":")) for k in json.loads(ayat)][:20]
    except Exception:
        raise HTTPException(400, "ayat must be a JSON list of \"s:a\"")
    if not keys:
        raise HTTPException(400, "no ayat")
    try:
        wave, sr = sf.read(io.BytesIO(data), dtype="float32")
    except Exception:
        raise HTTPException(400, "audio must be WAV")
    if wave.ndim > 1:
        wave = wave.mean(axis=1)
    if sr != 16000:
        raise HTTPException(400, "audio must be 16 kHz")

    moshaf = _moshaf()
    texts = [Aya(s, a).get().uthmani for s, a in keys]
    # Each verse is phonetized on its own, so it ends in the pause (waqf) form a reciter
    # uses at a verse end; one continuous text would expect the verses to run on.
    refs = [quran_phonetizer(t, moshaf, remove_spaces=True) for t in texts]
    full_ref = quran_phonetizer(" ".join(texts), moshaf, remove_spaces=True)  # only to condition the model
    with _lock:  # one GPU pass at a time; ~0.1-0.8 s per verse
        heard = model()([np.asarray(wave)], [full_ref], sampling_rate=16000)[0].phonemes.text
        _free_gpu()  # GPU 1 is shared (ALRASSAI's Gemma): keep only the weights (~1.2 GB) between checks
    parts = _split_heard(heard, [r.phonemes for r in refs])

    out = []
    for (s, a), t, ref, part in zip(keys, texts, refs, parts):
        item = {"k": f"{s}:{a}", "words": len(t.split()), "errors": []}
        for e in explain_error(uthmani_text=t, ref_ph_text=ref.phonemes, predicted_ph_text=part, mappings=ref.mappings):
            pos = e.uthmani_pos[0]
            if e.speech_error_type == "insert" and (pos <= 0 or pos >= len(t)):
                continue  # audio of a neighbouring, partly recited verse
            if e.expected_len is not None and e.predicted_len is not None and abs(e.expected_len - e.predicted_len) <= MADD_TOLERANCE:
                continue
            if _at_permitted_pause((s, a), t, e.uthmani_pos):
                continue  # the ending a pause allows at a waqf mark (ۖ ۗ ۚ ...) is not a mistake
            rules = [r for r in (e.ref_tajweed_rules or []) + (e.replaced_tajweed_rules or []) + (e.inserted_tajweed_rules or [])]
            item["errors"].append({
                "word": _word_index(t, pos), "kind": e.error_type, "op": e.speech_error_type,
                "rules": [{"ar": r.name.ar, "en": r.name.en} for r in rules],
                "expected_len": e.expected_len, "heard_len": e.predicted_len,
            })
        out.append(item)
    return {"ayat": out}
