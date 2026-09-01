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
    matches_word,
    normalize_arabic,
    normalize_arabic_alt,
    tolerance_for,
    weighted_edit_distance,
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


# ----------------------- Merge-loophole audit fix coverage -----------------------
# Adversarial audit 2026-09-01 (a5-recite/browser-results.json finding G1)
# confirmed FALSE-REVEAL bugs; the Iron Rule is a word must NEVER be
# revealed unless genuinely recited. Python port of the new cases in
# app/tests/test-matcher.js -- keep both files in sync.

PAGES_DIR = Path(__file__).resolve().parent.parent.parent / "site" / "pages"
AUDIT_PAGES = [3, 187, 302, 562, 603, 604]


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


@pytest.mark.parametrize("level", [1, 2, 3, 4, None])
def test_637_pair_merge_loophole_scan_zero_false_reveals(level):
    """For every consecutive word pair on the 6 audit pages, speaking ONLY
    word[i+1] (word[i] never uttered) must never reveal word[i] via the
    merge path, at any level. Mirrors site/tests/test-merge-loophole.js."""
    total = 0
    bad = []
    for page_num in AUDIT_PAGES:
        words = _load_page_words(page_num)
        for i in range(len(words) - 1):
            total += 1
            r = match_transcript(words, i, words[i + 1]["n"], level)
            if i in r["matched"]:
                bad.append((page_num, i, words[i]["n"], words[i + 1]["n"]))
    assert total == 637
    assert not bad, bad[:5]


@pytest.mark.parametrize("level", [1, 2, 3, 4, None])
def test_lone_second_word_does_not_reveal_unspoken_first_word(level):
    r = match_transcript([{"n": "ان"}, {"n": "الذين"}], 0, "الذين", level)
    assert 0 not in r["matched"]


@pytest.mark.parametrize("level", [1, 2, 3, 4, None])
def test_glued_two_words_reveals_both(level):
    r = match_transcript([{"n": "ان"}, {"n": "الذين"}], 0, "انالذين", level)
    assert r["pointer"] == 2
    assert len(r["matched"]) == 2


@pytest.mark.parametrize("level", [1, 2, 3])
def test_triple_glued_token_reveals_all_three(level):
    r = match_transcript(
        [{"n": "ان"}, {"n": "الذين"}, {"n": "كفروا"}], 0, "انالذينكفروا", level
    )
    assert r["pointer"] == 3
    assert len(r["matched"]) == 3


def test_triple_glued_exact_concatenation_reveals_all_three_at_l4():
    r = match_transcript(
        [{"n": "ان"}, {"n": "الذين"}, {"n": "كفروا"}], 0, "انالذينكفروا", 4
    )
    assert r["pointer"] == 3
    assert len(r["matched"]) == 3


def test_near_miss_triple_glued_rejected_at_l4():
    r = match_transcript(
        [{"n": "ان"}, {"n": "الذين"}, {"n": "كفروا"}], 0, "انالذينكفروه", 4
    )
    assert r["pointer"] == 0
    assert r["matched"] == []


def test_near_miss_triple_glued_accepted_at_l3():
    r = match_transcript(
        [{"n": "ان"}, {"n": "الذين"}, {"n": "كفروا"}], 0, "انالذينكفروه", 3
    )
    assert r["pointer"] == 3
    assert len(r["matched"]) == 3


def test_merge_loophole_reproduction_an_stays_veiled():
    r = match_transcript([{"n": "ان"}, {"n": "الذين"}], 0, "الذين", 2)
    assert r["pointer"] == 0
    assert r["matched"] == []


@pytest.mark.parametrize("level", [1, 2, 3, 4, None])
def test_short_particle_pairs_rejected_at_every_level(level):
    assert not fuzzy_equal("ان", "من", level)
    assert not fuzzy_equal("لم", "لا", level)
    assert not fuzzy_equal("هم", "ام", level)


def test_short_word_exact_match_still_works():
    assert fuzzy_equal("ان", "ان", 1)


def test_tolerance_for_short_words_is_zero_at_l1():
    assert tolerance_for(1, 2) == 0
    assert tolerance_for(1, 3) == 0


@pytest.mark.parametrize("level", [1, 2, 3, 4, None])
def test_consonant_swap_rejected_at_every_level(level):
    assert not fuzzy_equal("والاصر", "والعصر", level)


def test_weighted_edit_distance_consonant_swap_costs_3():
    assert weighted_edit_distance("والاصر", "والعصر") == 3


def test_plain_levenshtein_consonant_swap_costs_1_for_contrast():
    assert levenshtein("والاصر", "والعصر") == 1


@pytest.mark.parametrize("level", [1, 2, 3])
@pytest.mark.parametrize(
    "a,b",
    [
        ("السموات", "السماوات"),
        ("الصلوه", "الصلاه"),
        ("ابرهيم", "ابراهيم"),
    ],
)
def test_forgiving_vowel_edits_still_pass(level, a, b):
    assert fuzzy_equal(a, b, level)


@pytest.mark.parametrize("level", [1, 2, 3, 4, None])
def test_rahman_alternate_form_matches_at_every_level(level):
    r = match_transcript([{"n": "الرحمن", "a": "الرحمان"}], 0, "الرحمان", level)
    assert r["pointer"] == 1
    assert len(r["matched"]) == 1


def test_malik_vs_maalik_still_accepted_at_default_level():
    assert fuzzy_equal("ملك", "مالك")


def test_malik_vs_maalik_rejected_at_l4():
    assert not fuzzy_equal("ملك", "مالك", 4)


# ===================== Re-audit #10 fixes (2026-09-01) =====================

# --- Bug 1: short-n/long-a {n,a} pairs must be exact-only against EITHER
# form, keyed on the word's own identity -- not on whichever form is being
# compared. Before the fix, comparing against the longer `a` form fell
# through to the ordinary length-4+ tolerance table. See
# site/tests/test-altform-bypass.js for the full 88-pair x full-corpus
# cross-check (0 false-accept opportunities at every level).


@pytest.mark.parametrize("level", [1, 2, 3, 4, None])
@pytest.mark.parametrize("wrong_word", ["عبادي", "عبادا", "عباده", "وعباد"])
def test_short_n_long_a_wrong_word_rejected_for_abd_ibaad(level, wrong_word):
    # عبادي/عبادا/عباده/وعباد used to fuzzy-match the longer alt form 'عباد'
    # (dist 1-2) under the old per-form clamp; now rejected outright since
    # min(len('عبد'), len('عباد')) = 3 <= 3 forces exact-only.
    assert not matches_word(wrong_word, {"n": "عبد", "a": "عباد"}, level)


@pytest.mark.parametrize("level", [1, 2, 3, 4, None])
def test_short_n_long_a_bal_rejected_for_bali_baliya(level):
    # بل used to fuzzy-match the longer alt form 'بليا' at L1.
    assert not matches_word("بل", {"n": "بلي", "a": "بليا"}, level)


@pytest.mark.parametrize("level", [1, 2, 3, 4, None])
def test_short_n_long_a_exact_forms_still_accepted(level):
    # Exact matches on EITHER form must still be accepted at every level --
    # this is the documented, intentional behavior: an expected word with
    # len(n)<=3 requires the token to equal n or a exactly, and 'مالك' IS the
    # exact 'a' form of {n:'ملك',a:'مالك'}, so ASR saying مالك is still
    # correctly recognized (it is not a fuzzy match -- it is an exact one).
    assert matches_word("ملك", {"n": "ملك", "a": "مالك"}, level)
    assert matches_word("مالك", {"n": "ملك", "a": "مالك"}, level)


@pytest.mark.parametrize("level", [1, 2, 3, 4, None])
def test_short_n_long_a_near_miss_rejected(level):
    # A near-miss of the longer `a` form (e.g. ملكا, a single-vowel edit away
    # from مالك) is now correctly rejected -- exactly the class of
    # false-reveal the fix closes.
    assert not matches_word("ملكا", {"n": "ملك", "a": "مالك"}, level)


# --- Bug 2: L1 tolerance is now 2 for every length > 3 (was 3 for len>6) --
# a single interior consonant substitution must be rejected at every level,
# even on long (10-11 letter) real Quran words, since CONSONANT_EDIT_COST (3)
# now exceeds the largest tolerance anywhere in the table (2).


def test_tolerance_for_l1_is_2_at_length_7():
    assert tolerance_for(1, 7) == 2  # was 3 before the Iron Rule tightening


def test_tolerance_for_l1_is_2_at_length_11():
    assert tolerance_for(1, 11) == 2  # was 3 before the Iron Rule tightening


LONG_WORD_SWAPS = [
    ("فليستجيبوا", "فبيستجيبوا"),
    ("والمستغفرين", "وابمستغفرين"),
    ("والمستضعفين", "وابمستضعفين"),
    ("المستضعفين", "ابمستضعفين"),
    ("ويستغفرونه", "ويبتغفرونه"),
    ("واسترهبوهم", "وابترهبوهم"),
    ("فسينفقونها", "فبينفقونها"),
    ("وبالمؤمنين", "وتالمؤمنين"),
]


@pytest.mark.parametrize("level", [1, 2, 3, 4, None])
@pytest.mark.parametrize("original,mutated", LONG_WORD_SWAPS)
def test_long_word_single_consonant_swap_rejected_at_every_level(level, original, mutated):
    assert not fuzzy_equal(original, mutated, level)


def test_l1_more_forgiving_than_l2_at_length_4():
    assert tolerance_for(1, 4) > tolerance_for(2, 4)


def test_l1_more_forgiving_than_l2_at_length_5():
    assert tolerance_for(1, 5) > tolerance_for(2, 5)


def test_l1_l2_coincide_at_length_6():
    assert tolerance_for(1, 6) == tolerance_for(2, 6)


def test_l1_l2_coincide_at_length_9():
    assert tolerance_for(1, 9) == tolerance_for(2, 9)


@pytest.mark.parametrize("level", [1, 2, 3, 4, None])
def test_wrong_word_storm_at_short_word_pointer_reveals_nothing(level):
    r = match_transcript(
        [{"n": "ان"}, {"n": "الذين"}, {"n": "كفروا"}],
        0,
        "براءه من واعلموا مخزي الناس قال معي بعدها عذرا استطعما هل لن كي",
        level,
    )
    assert r["matched"] == []
    assert r["pointer"] == 0
