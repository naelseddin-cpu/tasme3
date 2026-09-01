"""Runs the exact cross-language golden vector file
(app/tests/normalize-vectors.json) against the Python matcher — the same
file app/tests/test-matcher.js runs against the JS matcher. This IS the
cross-language contract; do not copy/duplicate the vectors, load the file
itself so both languages can never silently drift apart.
"""

import json
from pathlib import Path

from server.matching import normalize_arabic, normalize_arabic_alt

VECTORS_PATH = (
    Path(__file__).resolve().parent.parent.parent
    / "app"
    / "tests"
    / "normalize-vectors.json"
)


def load_vectors():
    with open(VECTORS_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def test_vectors_file_exists_and_nonempty():
    vectors = load_vectors()
    assert isinstance(vectors, list)
    assert len(vectors) > 0


def test_normalize_arabic_matches_all_vectors():
    vectors = load_vectors()
    failures = []
    for v in vectors:
        got = normalize_arabic(v["input"])
        if got != v["n"]:
            failures.append((v["input"], got, v["n"]))
    assert not failures, f"normalize_arabic mismatches: {failures}"


def test_normalize_arabic_alt_matches_all_vectors():
    vectors = load_vectors()
    failures = []
    for v in vectors:
        got = normalize_arabic_alt(v["input"])
        want = v["a"] if "a" in v else v["n"]
        if got != want:
            failures.append((v["input"], got, want))
    assert not failures, f"normalize_arabic_alt mismatches: {failures}"
