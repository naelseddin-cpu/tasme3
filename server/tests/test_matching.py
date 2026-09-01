"""Python port of the behavioral cases in app/tests/test-matcher.js (the
canonical JS matcher's own test suite), plus the golden-vector runthrough,
re-expressed as pytest. Keep this list in sync with the JS file's cases:
perfect recitation, merged tokens, repeats/restart, unrelated rejection,
punctuation-glued tokens, قال vs {n:قل,a:قال} at all 4 levels, and level
monotonicity.
"""

import json
from pathlib import Path

import pytest

from server.matching import (
    fuzzy_equal,
    levenshtein,
    match_transcript,
    normalize_arabic,
    normalize_arabic_alt,
)

VECTORS_PATH = (
    Path(__file__).resolve().parent.parent.parent
    / "app"
    / "tests"
    / "normalize-vectors.json"
)

FATIHA = (
    "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ "
    "الرَّحْمَٰنِ الرَّحِيمِ مَالِكِ يَوْمِ الدِّينِ إِيَّاكَ نَعْبُدُ وَإِيَّاكَ "
    "نَسْتَعِينُ اهْدِنَا الصِّرَاطَ الْمُسْتَقِيمَ صِرَاطَ الَّذِينَ أَنْعَمْتَ "
    "عَلَيْهِمْ غَيْرِ الْمَغْضُوبِ عَلَيْهِمْ وَلَا الضَّالِّينَ"
)


@pytest.fixture
def exp_norm():
    return [normalize_arabic(w) for w in FATIHA.split()]


# ----------------------- Original 13 behavioral cases -----------------------


def test_first_ayah_plain_text_reveals_4_words(exp_norm):
    r = match_transcript(exp_norm, 0, "بسم الله الرحمن الرحيم.")
    assert r["pointer"] == 4
    assert len(r["matched"]) == 4


def test_second_ayah_advances_to_8(exp_norm):
    r = match_transcript(exp_norm, 4, "الحمد لله رب العالمين")
    assert r["pointer"] == 8


def test_ayah_3_matches(exp_norm):
    r = match_transcript(exp_norm, 8, "الرحمن الرحيم")
    assert r["pointer"] == 10


def test_partial_only_first_word_accepted(exp_norm):
    # ملك fuzzy-matches مالك (len 4 vs 3, tolerance 1 at level default) but
    # الناس does not match يوم, so pointer stops at 11.
    r = match_transcript(exp_norm, 10, "ملك الناس")
    assert r["pointer"] == 11


def test_unrelated_speech_rejected(exp_norm):
    r = match_transcript(exp_norm, 11, "كيف حالك اليوم")
    assert r["pointer"] == 11
    assert r["matched"] == []


def test_restart_with_repeat_words_tolerated(exp_norm):
    r = match_transcript(exp_norm, 11, "مالك يوم الدين")
    assert r["pointer"] == 13


def test_hamza_variants_accepted(exp_norm):
    r = match_transcript(exp_norm, 13, "اياك نعبد واياك نستعين")
    assert r["pointer"] == 17


def test_ayah_6(exp_norm):
    r = match_transcript(exp_norm, 17, "إهدنا الصراط المستقيم")
    assert r["pointer"] == 20


def test_final_ayah_completes_surah(exp_norm):
    r = match_transcript(
        exp_norm,
        20,
        "صراط الذين أنعمت عليهم غير المغضوب عليهم ولا الضالين",
    )
    assert r["pointer"] == len(exp_norm)


def test_short_words_strict():
    assert not fuzzy_equal(normalize_arabic("قل"), normalize_arabic("هل"))


def test_normalize_basmala():
    assert normalize_arabic("بِسْمِ") == "بسم"


def test_normalize_allah():
    assert normalize_arabic("اللَّهِ") == "الله"


def test_normalize_rahman_with_dagger_alif():
    assert normalize_arabic("الرَّحْمَٰنِ") == "الرحمن"


# ----------------------------- New WP-A coverage -----------------------------


def test_golden_vector_runthrough():
    with open(VECTORS_PATH, "r", encoding="utf-8") as f:
        vectors = json.load(f)
    failures = []
    for v in vectors:
        got_n = normalize_arabic(v["input"])
        if got_n != v["n"]:
            failures.append(("n", v["input"], got_n, v["n"]))
        got_a = normalize_arabic_alt(v["input"])
        want_a = v["a"] if "a" in v else v["n"]
        if got_a != want_a:
            failures.append(("a", v["input"], got_a, want_a))
    assert not failures, failures


@pytest.mark.parametrize("level", [1, 2, 3, 4, None])
def test_qaala_matches_qul_qaala_entry_at_every_level(level):
    res = match_transcript([{"n": "قل", "a": "قال"}], 0, "قال", level)
    assert res["pointer"] == 1
    assert len(res["matched"]) == 1


@pytest.mark.parametrize("level", [1, 2, 3, 4, None])
def test_qul_matches_qul_qaala_entry_at_every_level(level):
    res = match_transcript([{"n": "قل", "a": "قال"}], 0, "قل", level)
    assert res["pointer"] == 1
    assert len(res["matched"]) == 1


def test_punctuation_glued_token_matches_at_l3():
    r = match_transcript(["قل"], 0, "قل،", 3)
    assert r["pointer"] == 1
    assert len(r["matched"]) == 1


def test_level_monotonicity_over_random_word_pairs(exp_norm):
    # Note: this uses Python's own seeded PRNG rather than a port of the JS
    # file's mulberry32 — the property under test (monotonicity of the
    # tolerance table) does not depend on which specific pairs are drawn,
    # only on decent coverage of the vector pool; a fixed seed keeps this
    # test reproducible without needing bit-exact JS RNG parity.
    import random

    with open(VECTORS_PATH, "r", encoding="utf-8") as f:
        vectors = json.load(f)
    pool = []
    for v in vectors:
        if v.get("n"):
            pool.append(v["n"])
        if v.get("a"):
            pool.append(v["a"])
    pool.extend(w for w in exp_norm if w)

    rng = random.Random(42)

    def pick():
        return rng.choice(pool)

    violations = []
    for _ in range(200):
        a, b = pick(), pick()
        l3 = fuzzy_equal(a, b, 3)
        l2 = fuzzy_equal(a, b, 2)
        l1 = fuzzy_equal(a, b, 1)
        if l3 and not l2:
            violations.append(("L3->L2", a, b))
        if l2 and not l1:
            violations.append(("L2->L1", a, b))
    assert not violations


def test_merged_token_matches_via_alternate_forms_at_l4():
    r = match_transcript(
        [{"n": "ملك", "a": "مالك"}, "يوم"], 0, "مالكيوم", 4
    )
    assert r["pointer"] == 2
    assert r["matched"] == [0, 1]


def test_merged_n_only_combo_is_not_exact_match_sanity():
    assert levenshtein("ملكيوم", "مالكيوم") > 0
