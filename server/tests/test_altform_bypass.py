"""Python parity port of site/tests/test-altform-bypass.js -- the alt-form
false-reveal fix (re-audit #10, a5-recite/altform-exploit-scan.json +
targets.json, 2026-09-01). Keep in sync with the JS file.

toleranceFor()'s "normalized length <=3 -> exact-match-only" clamp used to
key off whichever SINGLE form was being compared (tok vs n, or tok vs a)
rather than off the expected word's own identity. For an expected item
{n, a} where `n` is <=3 letters but its alternate `a` is longer (dagger-alif
-> alif adds a letter: e.g. n:'عبد'(3) a:'عباد'(4)), comparing the spoken
token against the LONGER `a` form fell through to the ordinary length-4+
tolerance table, so words that merely resemble `a` -- but were never
actually said -- were fuzzy-accepted. 88 such {n,a} pairs exist in the full
mushaf corpus (every pair where len(n)<=3 and len(a)>3).

The fix (server/matching.py's _is_short_forms/_form_matches, mirroring
app/matcher.js's isShortForms/formMatches): if the SHORTEST form among an
expected word's {n, a} is <=3, the spoken token must EXACTLY equal n or a --
no fuzzy tolerance against either form -- in matches_word and both merge
paths.
"""

import json
from pathlib import Path

import pytest

from server.matching import match_transcript, matches_word

ROOT = Path(__file__).resolve().parent.parent.parent
MUSHAF_DIR = ROOT / "app" / "mushaf" / "pages"
PAGES_DIR = ROOT / "site" / "pages"


def _load_targets_and_corpus():
    targets_map = {}
    corpus_words = set()
    for f in sorted(MUSHAF_DIR.glob("*.json")):
        with open(f, "r", encoding="utf-8") as fh:
            d = json.load(fh)
        for line in d.get("lines", []):
            if line.get("t") != "w":
                continue
            for tk in line.get("tk", []):
                n = tk.get("n")
                a = tk.get("a")
                if not n:
                    continue
                corpus_words.add(n)
                if a and a != n and len(n) <= 3 and len(a) > 3:
                    targets_map[(n, a)] = {"n": n, "a": a}
    return list(targets_map.values()), list(corpus_words)


def _load_page_words(page_num):
    p = PAGES_DIR / ("page-%03d.json" % page_num)
    with open(p, "r", encoding="utf-8") as f:
        d = json.load(f)
    out = []
    for tk in d["tokens"]:
        if tk.get("e"):
            continue
        out.append({"n": tk["n"], "a": tk.get("a")})
    return out


TARGETS, CORPUS_POOL = _load_targets_and_corpus()


def test_88_unique_short_n_long_a_target_pairs_found():
    assert len(TARGETS) == 88


def test_corpus_pool_is_non_trivial():
    assert len(CORPUS_POOL) > 10000


@pytest.mark.parametrize("level", [1, 2, 3, 4, None])
def test_zero_false_accept_opportunities_across_full_corpus(level):
    """For all 88 {n,a} short-n/long-a pairs, no OTHER unique word-form
    anywhere in the full 604-page corpus is fuzzy-accepted against either
    form, at any difficulty level."""
    findings = []
    for t in TARGETS:
        for w in CORPUS_POOL:
            if w == t["n"] or w == t["a"]:
                continue  # exact match on either form is CORRECT acceptance
            if matches_word(w, t, level):
                findings.append((t, w))
    assert not findings, findings[:5]


# ----------------------- named in-app repros -----------------------

PAGE_490 = _load_page_words(490)
PAGE_562 = _load_page_words(562)


def test_page490_idx88_is_abd_ibaad():
    assert PAGE_490[88]["n"] == "عبد" and PAGE_490[88]["a"] == "عباد"


def test_page490_idx89_is_alrahman():
    assert PAGE_490[89]["n"] == "الرحمن"


@pytest.mark.parametrize("level", [1, 2, 3, 4, None])
@pytest.mark.parametrize("wrong_word", ["عبادي", "عبادا", "عباده", "وعباد"])
def test_page490_idx88_wrong_word_alone_rejected(level, wrong_word):
    assert not matches_word(wrong_word, PAGE_490[88], level)


@pytest.mark.parametrize("level", [1, 2, 3, 4, None])
@pytest.mark.parametrize("wrong_word", ["عبادي", "عبادا", "عباده", "وعباد"])
def test_page490_idx88_realistic_transcript_does_not_reveal(level, wrong_word):
    transcript = wrong_word + " الرحمن"
    r = match_transcript(PAGE_490, 88, transcript, level)
    assert 88 not in r["matched"]


def test_page562_idx89_is_bali_baliya():
    assert PAGE_562[89]["n"] == "بلي" and PAGE_562[89]["a"] == "بليا"


@pytest.mark.parametrize("level", [1, 2, 3, 4, None])
def test_page562_idx89_wrong_word_storm_reveals_nothing(level):
    wrong_storm = "قد في لن او لو مع كي بل عن"
    r = match_transcript(PAGE_562, 89, wrong_storm, level)
    assert r["matched"] == []
    assert r["pointer"] == 89


@pytest.mark.parametrize("level", [1, 2, 3, 4, None])
def test_genuine_abd_alrahman_still_reveals_both(level):
    r = match_transcript(PAGE_490, 88, "عباد الرحمن", level)
    assert r["pointer"] == 90
    assert 88 in r["matched"] and 89 in r["matched"]


@pytest.mark.parametrize("level", [1, 2, 3, 4, None])
def test_genuine_bali_still_reveals(level):
    r = match_transcript(PAGE_562, 89, "بلي", level)
    assert r["pointer"] == 90
    assert 89 in r["matched"]


@pytest.mark.parametrize("level", [1, 2, 3, 4, None])
def test_genuine_alt_form_ibaad_alone_still_reveals(level):
    r = match_transcript(PAGE_490, 88, "عباد", level)
    assert 88 in r["matched"]
