"""Word matching for Quran recitation checking — Python port of app/matcher.js.

This MUST stay in exact behavioral parity with the canonical JS matcher
(app/matcher.js). Do not "improve" anything here without updating both
implementations and re-running app/tests/normalize-vectors.json against
both. The expected text is always known, so this is alignment, not open
dictation: we only decide whether the next expected word was said.

Regex character classes below are transcribed from app/matcher.js by exact
Unicode codepoint (see server/tests for the derivation notes); they are not
re-typed by hand from the Arabic glyphs to avoid transcription drift.
"""

from __future__ import annotations

import re
from typing import List, Optional, Sequence, Union

# ---------------------------------------------------------------------------
# Normalization (mirrors app/matcher.js normalizeArabic / normalizeArabicAlt)
# ---------------------------------------------------------------------------

# Tashkeel + Quranic annotation marks + tatweel, exactly matching JS
# /[ً-ٰٟۖ-ۭـؐ-ؚ]/g == [U+064B-U+0670, U+065F, U+06D6-U+06ED, U+0640, U+0610-U+061A]
_TASHKEEL_RE = re.compile("[ً-ٰٟۖ-ۭـؐ-ؚ]")

# آأإٱٲٳٵ → ا, matching JS /[آأإٱٲٳٵ]/g
_ALIF_RE = re.compile("[آأإٱٲٳٵ]")

# Keep ONLY Arabic letters ء-ي (U+0621-U+064A), matching JS /[^ء-ي]/g
_KEEP_ONLY_ARABIC_RE = re.compile("[^ء-ي]")

# Dagger alif U+0670, mapped to plain alif BEFORE the tashkeel strip in the
# alternate-form normalizer.
_DAGGER_ALIF_RE = re.compile("ٰ")

# Tokenizer split pattern, matching JS /[^ء-ٰٟ-ۭ]+/
# == split on anything outside [U+0621-U+0670] union [U+065F-U+06ED]
_TOKENIZE_SPLIT_RE = re.compile("[^ء-ٰٟ-ۭ]+")


def normalize_arabic(s: str) -> str:
    """Strip tashkeel/annotation/tatweel, unify letter forms, keep only
    Arabic letters ء-ي. Identical pipeline to JS normalizeArabic()."""
    s = _TASHKEEL_RE.sub("", s)
    s = _ALIF_RE.sub("ا", s)
    s = s.replace("ة", "ه")
    s = s.replace("ى", "ي")
    s = _KEEP_ONLY_ARABIC_RE.sub("", s)
    return s


def normalize_arabic_alt(s: str) -> str:
    """Identical to normalize_arabic, but dagger alif (U+0670) is mapped to
    plain alif BEFORE the tashkeel strip instead of being deleted with it.
    Fixes قَٰلَ ("he said") normalizing to the same string as قُلْ ("Say!")."""
    s = _DAGGER_ALIF_RE.sub("ا", s)
    s = _TASHKEEL_RE.sub("", s)
    s = _ALIF_RE.sub("ا", s)
    s = s.replace("ة", "ه")
    s = s.replace("ى", "ي")
    s = _KEEP_ONLY_ARABIC_RE.sub("", s)
    return s


def tokenize(text: str) -> List[str]:
    """Split raw ASR text into candidate Arabic word tokens."""
    parts = _TOKENIZE_SPLIT_RE.split(text)
    words = [normalize_arabic(w) for w in parts]
    return [w for w in words if len(w) > 0]


# ---------------------------------------------------------------------------
# Edit distance + tolerance
# ---------------------------------------------------------------------------


def levenshtein(a: str, b: str) -> int:
    if a == b:
        return 0
    m, n = len(a), len(b)
    if m == 0:
        return n
    if n == 0:
        return m
    prev = list(range(n + 1))
    cur = [0] * (n + 1)
    for i in range(1, m + 1):
        cur[0] = i
        for j in range(1, n + 1):
            cost = 0 if a[i - 1] == b[j - 1] else 1
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
        prev, cur = cur, prev
    return prev[n]


# Letters where an edit is a plausible accent/orthography slip rather than a
# different word: long vowels, ta-marbuta/ha, hamza and its carriers.
# Everything else in the ء-ي range is a true consonant -- swapping one
# changes the word's meaning (e.g. والاصر/والعصر), so it must cost more.
# Mirrors app/matcher.js's VOWEL_LETTERS exactly (same 12 codepoints).
_VOWEL_LETTERS = frozenset("اويىةهءأإآؤئ")


def _is_vowel_letter(c: str) -> bool:
    return c in _VOWEL_LETTERS


# A pure-vowel edit (insert/delete/substitute a vowel-class letter, or
# substitute one vowel-class letter for another) costs 1 -- the same slip
# ASR/typing routinely makes on alef/ya/ha/hamza. Any edit that touches a
# true consonant costs CONSONANT_EDIT_COST. 3 (not the naively "matching" 2)
# is deliberate: it must exceed the LARGEST tolerance in the table at ANY
# level/length (2, since the Iron Rule tightening capped L1 at 2 for every
# length -- see tolerance_for below), so a single consonant swap (e.g.
# والاصر vs والعصر, both len 6) is rejected at every level, not merely at
# L2+. Must stay in lockstep with app/matcher.js's CONSONANT_EDIT_COST /
# VOWEL_EDIT_COST.
CONSONANT_EDIT_COST = 3
VOWEL_EDIT_COST = 1


# Boundary-affix fix (master audit 2026-09-01, false-reveal missed by JS
# commit 7391880): a word's FIRST and LAST letter positions are where Arabic
# affixes attach -- و "and", ي "my"/1st-person, ا case/dual endings, and the
# ب/ل/ف/ك prefix letters -- so an edit there changes the word's *meaning*
# (a different word or a different grammatical person/case), never merely
# its *accent*, even when the letter itself is vowel-class. 'عباد' + trailing
# ي ("my servants" -> "عبادي", a different, unspoken word) used to cost only
# VOWEL_EDIT_COST (ي is vowel-class) and so slid under every level's
# tolerance.
#
# _edge_run() computes, for a given string (compared against the OTHER
# string's length), the set of indices that count as "the boundary" -- NOT
# just {0, length-1}. A plain single-index check is exploitable two
# different ways, both found live via the affix-variant corpus scan (see
# site/tests/test-boundary-affix.js):
#
# 1. Identical-letter ties. If the affix letter being prepended/appended
#    happens to equal the word's own boundary letter (e.g. prefixing 'ا'
#    onto 'الذين', which already starts with 'ا', giving 'االذين'), the two
#    adjacent identical letters make deleting EITHER of them produce the
#    same result string -- so the DP is free to attribute the edit to the
#    second 'ا' (index 1, "interior" under a naive check) instead of the
#    first (index 0, "edge"), and pays only VOWEL_EDIT_COST (429
#    leaks/level with only a single-index check). Fix: the boundary is the
#    entire leading run of characters equal to the first letter, and the
#    entire trailing run of characters equal to the last letter -- any
#    index inside either run is edge, since an edit anywhere in it is
#    indistinguishable in effect from editing the true boundary letter.
#
# 2. Multi-letter length differences. Appending a whole extra affix onto an
#    already-longer alternate form (e.g. 'وعليا' (the 'a' form) + 'ي' =
#    'وعلياي', compared against the shorter 'n' form 'وعلي') needs 2
#    trailing edits, not 1. Only the true last character (index len-1) is
#    caught by rule 1 above; the second-to-last character ('ا', not equal
#    to the final 'ي', so no identical run) still reads as "interior" even
#    though it only exists because of the length mismatch -- both edits
#    together constitute the affix change and both must be edge (still 6
#    leaks/level after rule 1 alone). Fix: the boundary additionally always
#    includes the leading and trailing window of size `excess` = max(0,
#    this_len - other_len) -- the minimum number of characters that MUST be
#    inserted/deleted at start or end for the lengths to reconcile,
#    regardless of which specific characters an optimal alignment happens
#    to pick.
#
# Both rules only WIDEN the boundary beyond {0, length-1}; interior edits
# for same-length or off-by-one words (all of the "must stay forgiving"
# cases -- السموات/السماوات, الصلوه/الصلاه, ابرهيم/ابراهيم, ملك/مالك -- have
# length difference <=1 and no boundary-adjacent identical-letter run
# there) are completely unaffected; confirmed via the corpus scan reaching
# 0 leaks at every level with both rules combined. Mirrors app/matcher.js's
# edgeRun()/isEdgePos() exactly.
def _edge_run(s: str, other_len: int) -> tuple:
    length = len(s)
    lead_end = 0
    while lead_end + 1 < length and s[lead_end + 1] == s[0]:
        lead_end += 1
    trail_start = length - 1
    while trail_start - 1 >= 0 and s[trail_start - 1] == s[length - 1]:
        trail_start -= 1
    excess = max(0, length - other_len)
    if excess - 1 > lead_end:
        lead_end = excess - 1
    trail_bound = length - excess
    if trail_bound < trail_start:
        trail_start = trail_bound
    return (lead_end, trail_start)


def _is_edge_pos(idx: int, run: tuple) -> bool:
    return idx <= run[0] or idx >= run[1]


def weighted_edit_distance(a: str, b: str) -> int:
    """Like levenshtein(), but each insertion/deletion of a single character
    costs VOWEL_EDIT_COST if that character is vowel-class else
    CONSONANT_EDIT_COST; each substitution costs VOWEL_EDIT_COST only if BOTH
    characters are vowel-class, else CONSONANT_EDIT_COST -- UNLESS the edit
    touches a boundary position of `a` or `b` (see _edge_run/_is_edge_pos
    above), in which case it always costs CONSONANT_EDIT_COST regardless of
    letter class: edge letters are meaning-bearing affixes, so an edit there
    must never be treated as a cheap accent slip. Mirrors app/matcher.js's
    weightedEditDistance() exactly. Used everywhere fuzzy word matching
    happens instead of plain levenshtein()."""
    if a == b:
        return 0
    m, n = len(a), len(b)
    run_a, run_b = _edge_run(a, n), _edge_run(b, m)
    prev = [0] * (n + 1)
    for j in range(1, n + 1):
        ins_cost = (
            CONSONANT_EDIT_COST
            if _is_edge_pos(j - 1, run_b)
            else (VOWEL_EDIT_COST if _is_vowel_letter(b[j - 1]) else CONSONANT_EDIT_COST)
        )
        prev[j] = prev[j - 1] + ins_cost
    cur = [0] * (n + 1)
    for i in range(1, m + 1):
        ca = a[i - 1]
        edge_a = _is_edge_pos(i - 1, run_a)
        del_cost = CONSONANT_EDIT_COST if edge_a else (VOWEL_EDIT_COST if _is_vowel_letter(ca) else CONSONANT_EDIT_COST)
        cur[0] = prev[0] + del_cost
        for j in range(1, n + 1):
            cb = b[j - 1]
            edge_b = _is_edge_pos(j - 1, run_b)
            ins_cost = CONSONANT_EDIT_COST if edge_b else (VOWEL_EDIT_COST if _is_vowel_letter(cb) else CONSONANT_EDIT_COST)
            if ca == cb:
                sub_cost = 0
            elif edge_a or edge_b:
                sub_cost = CONSONANT_EDIT_COST
            elif _is_vowel_letter(ca) and _is_vowel_letter(cb):
                sub_cost = VOWEL_EDIT_COST
            else:
                sub_cost = CONSONANT_EDIT_COST
            cur[j] = min(prev[j] + del_cost, cur[j - 1] + ins_cost, prev[j - 1] + sub_cost)
        prev, cur = cur, prev
    return prev[n]


def tolerance_for(level: Optional[int], length: int) -> int:
    """Tolerance table per difficulty level. Strictly decreasing as level
    rises (L1 >= L2 >= L3 >= L4 at every length). Level omitted (None)
    behaves exactly like level 2 (the default).

    Words of normalized length <=3 are exact-match only (0) at EVERY level,
    including L1: 2-3 letter Arabic particles (ان/من/لم/لا/هل/...) are
    semantically load-bearing -- a same-length edit is a different word, not
    an accent slip. This is enforced up front, before the per-level table,
    which now only ever sees length > 3. NOTE: this length<=3 clamp keys off
    whichever single form is being compared right now (tok vs one of n/a) --
    it is NOT sufficient on its own when an expected word's short `n` has a
    longer alternate `a` (e.g. {n:'ملك',a:'مالك'}): comparing against `a`
    sees length 4 and falls through to the ordinary table. The real fix for
    that (keying exactness off the expected word's OWN identity, checked
    before any form-by-form fuzzy comparison happens) lives in matches_word /
    matches_merged / matches_merged3 below -- see their shared
    _form_matches() helper. This clamp stays as defense in depth for direct
    fuzzy_equal() callers that never go through word_forms().

    Iron Rule tightening: L1 is capped at 2 for every length > 3 (not 3 for
    length > 6 as before) so that CONSONANT_EDIT_COST (3) always exceeds
    every level's tolerance -- a single interior consonant substitution is
    never accepted at ANY level, ANY length. L1 remains more forgiving than
    L2 only for length 4-5 (L1 allows 2 vowel-class edits there, L2 allows
    1); at length 6+ L1 and L2 coincide at 2.
    """
    if length <= 3:
        return 0
    if level == 1:
        return 2
    if level == 3:
        return 0 if length <= 4 else 1 if length <= 7 else 2
    if level == 4:
        return 0
    # level 2, or default
    return 1 if length <= 5 else 2


# M4 fix -- the "echo" attack on weighted_edit_distance (master audit
# 2026-09-02), ported from app/matcher.js's fuzzy_equal fix: a 2-letter
# vowel-class affix that happens to repeat the word's own trailing/leading
# bigram -- e.g. كفروا + its own trailing "وا" glued back on -> كفرواوا, or
# ءامنوا + "وا" -> ءامنواوا, or "يا" glued in front of يايها -> يايايها --
# lets the DP align that echoed pair by deleting the INTERIOR copy instead
# of the copy actually sitting at the edge. Both copies are the very same
# vowel letters repeated, so either alignment costs the DP the same 2 (two
# VOWEL_EDIT_COST=1 deletions) -- weighted_edit_distance('كفرواوا', 'كفروا')
# == 2 either way -- but only ONE of those two alignments is the truth: the
# spoken word really is كفروا with a bogus extra "وا" TACKED ON AT THE EDGE
# (an edge edit, CONSONANT_EDIT_COST=3 under the edge rule, correctly
# rejected), never a genuine vowel slip sitting safely in the interior.
# Because plain Levenshtein-style DP has no way to prefer one alignment over
# an equal-cost other, it silently picks the interior one and falsely
# accepts at L1/L2 (and, depending on which pair of vowel letters, roughly
# half the time at L3 too).
#
# Fix: fuzzy_equal no longer runs a generic DP at all. Rather than hoping an
# edit-cost table happens to penalize the wrong alignment enough, it
# enumerates only the edit SHAPES the Iron Rule actually permits and checks
# each directly, so there is no alignment choice left for an echo to hide
# inside:
#   - equal length: substitutions only, no indels at all -- an indel pair
#     (one deletion + one insertion) is exactly the shape an echo needs to
#     smuggle itself through, so it is never on the table regardless of
#     cost. Edge positions (first/last) always cost CONSONANT_EDIT_COST;
#     interior positions cost VOWEL_EDIT_COST only when BOTH characters are
#     vowel-class, else CONSONANT_EDIT_COST -- summed and compared to
#     tolerance_for(level, length), same tolerances as before.
#   - length differs by exactly 1: accepted ONLY as a single INTERIOR
#     (never first, never last position) ا/و indel -- _single_interior_indel
#     below -- gated by tolerance_for(level, max length) >= 1 so it is still
#     unavailable at L4 and short words. This is the one genuine "extra
#     vowel letter in the middle of the word" case (e.g. يايها/ياايها,
#     السموات/السماوات, داود/داوود) the old DP was built to allow; an echo
#     never qualifies because the repeated letters -- by construction -- sit
#     at the boundary between the real word and the echoed copy, i.e. at
#     position 0 or at the very end, exactly what _single_interior_indel
#     rejects.
#   - length differs by 2+: rejected outright.
# weighted_edit_distance/_edge_run/_is_edge_pos are kept unchanged (still
# used by tests/tools) but fuzzy_equal no longer calls weighted_edit_distance.
def _single_interior_indel(longer: str, shorter: str) -> bool:
    """longer's length == shorter's length + 1: true only if removing ONE
    interior (not first/last) alif or waw from `longer` yields `shorter`."""
    n = len(shorter)
    i = 0
    while i < n and longer[i] == shorter[i]:
        i += 1
    if i == 0 or i == n:
        return False  # the extra char sits at an edge -- never a genuine interior vowel slip
    ch = longer[i]
    if ch != "ا" and ch != "و":
        return False
    return longer[i + 1:] == shorter[i:]


def fuzzy_equal(a: str, b: str, level: Optional[int] = None) -> bool:
    """Tolerance grows with word length: short words must be near-exact.
    See the M4 fix comment above for why this no longer runs a generic
    edit-distance DP."""
    if a == b:
        return True
    diff = len(a) - len(b)
    if diff > 1 or diff < -1:
        return False
    if diff != 0:
        if tolerance_for(level, max(len(a), len(b))) < 1:
            return False
        return _single_interior_indel(a, b) if diff > 0 else _single_interior_indel(b, a)
    # Same length: substitutions only (no indel pairs that could
    # re-attribute an echoed affix into the interior). Edge substitutions
    # always cost CONSONANT_EDIT_COST.
    length = len(a)
    max_dist = tolerance_for(level, length)
    cost = 0
    for i in range(length):
        ca, cb = a[i], b[i]
        if ca == cb:
            continue
        if i == 0 or i == length - 1:
            cost += CONSONANT_EDIT_COST
        else:
            cost += VOWEL_EDIT_COST if (_is_vowel_letter(ca) and _is_vowel_letter(cb)) else CONSONANT_EDIT_COST
        if cost > max_dist:
            return False
    return cost <= max_dist


# ---------------------------------------------------------------------------
# Expected-word items: a plain normalized string (legacy) or {'n': ..,
# 'a': optional alternate normalized form}.
# ---------------------------------------------------------------------------

ExpectedItem = Union[str, dict]


def word_forms(item: ExpectedItem) -> List[str]:
    """Returns the list of normalized forms a spoken token may match against."""
    if isinstance(item, str):
        return [item]
    forms = [item["n"]]
    alt = item.get("a")
    if alt and alt != item["n"]:
        forms.append(alt)
    return forms


def _is_short_forms(forms: Sequence[str]) -> bool:
    """Exact-only rule keyed on the expected WORD's identity, not on
    whichever form happens to be compared. A word is short (and therefore
    semantically load-bearing per tolerance_for's length<=3 rule) if its
    SHORTEST known form is <=3 -- normally that's `n`, since `a` only ever
    adds letters (dagger alif -> alif, e.g. n:'ملك'(3) a:'مالك'(4)). Using
    the shortest of all forms (rather than just len(n)) keeps this correct
    even if a future data entry ever has `a` shorter than `n`. Mirrors
    app/matcher.js's isShortForms() exactly."""
    return min(len(f) for f in forms) <= 3


def _form_matches(tok: str, forms: Sequence[str], level: Optional[int]) -> bool:
    """Does `tok` match this expected word's form set under `level`? Short
    words (see _is_short_forms) bypass fuzzy_equal entirely and require an
    exact match against n or a -- this is the fix for the false-reveal where
    a short `n` with a longer `a` (e.g. {n:'عبد',a:'عباد'}) let wrong words
    like 'عبادي'/'عبادا' slip through by fuzzy-matching the longer `a` form
    under the ordinary (non-exact) length-4+ tolerance table. Mirrors
    app/matcher.js's formMatches() exactly."""
    if _is_short_forms(forms):
        return tok in forms
    return any(fuzzy_equal(tok, form, level) for form in forms)


def matches_word(tok: str, item: ExpectedItem, level: Optional[int] = None) -> bool:
    return _form_matches(tok, word_forms(item), level)


def matches_merged(
    tok: str, item1: ExpectedItem, item2: ExpectedItem, level: Optional[int] = None
) -> bool:
    """Merged token covering two consecutive expected words. A merged match
    must be a verified SPLIT: some cut point of tok such that the prefix
    fuzzy-matches word1 under word1's OWN per-word tolerance and the suffix
    fuzzy-matches word2 under word2's OWN per-word tolerance (each tried
    against both its n/a forms). There is deliberately no tolerance derived
    from the concatenated length any more -- that was the false-reveal
    loophole (a lone word2 could satisfy a loose tolerance sized for
    word1+word2 combined, revealing the never-spoken word1)."""
    forms1, forms2 = word_forms(item1), word_forms(item2)
    for k in range(1, len(tok)):
        part1, part2 = tok[:k], tok[k:]
        if not _form_matches(part1, forms1, level):
            continue
        if _form_matches(part2, forms2, level):
            return True
    return False


def matches_merged3(
    tok: str,
    item1: ExpectedItem,
    item2: ExpectedItem,
    item3: ExpectedItem,
    level: Optional[int] = None,
) -> bool:
    """Merged token covering three consecutive expected words: same split-
    verification principle, with two cut points. Handles genuinely
    triple-glued ASR/typed input (three words run together with no
    separator) that a two-word merge alone would reject outright."""
    forms1, forms2, forms3 = word_forms(item1), word_forms(item2), word_forms(item3)
    for k1 in range(1, len(tok) - 1):
        part1 = tok[:k1]
        if not _form_matches(part1, forms1, level):
            continue
        for k2 in range(k1 + 1, len(tok)):
            part2, part3 = tok[k1:k2], tok[k2:]
            if not _form_matches(part2, forms2, level):
                continue
            if _form_matches(part3, forms3, level):
                return True
    return False


def match_transcript(
    expected: Sequence[ExpectedItem],
    pointer: int,
    transcript_text: str,
    level: Optional[int] = None,
) -> dict:
    """Greedy alignment of one utterance against the expected sequence,
    starting at `pointer`. ASR noise tokens are skipped; two consecutive
    expected words may be matched by one merged ASR token.

    Returns {"pointer": pointer, "matched": [indices revealed this call]}.
    """
    tokens = tokenize(transcript_text)
    matched: List[int] = []
    for tok in tokens:
        if pointer >= len(expected):
            break
        if matches_word(tok, expected[pointer], level):
            matched.append(pointer)
            pointer += 1
            continue
        # merged token covering the next two expected words
        if pointer + 1 < len(expected) and matches_merged(
            tok, expected[pointer], expected[pointer + 1], level
        ):
            matched.append(pointer)
            matched.append(pointer + 1)
            pointer += 2
            continue
        # merged token covering the next three expected words (genuinely
        # triple-glued input, e.g. no separators at all between them)
        if pointer + 2 < len(expected) and matches_merged3(
            tok, expected[pointer], expected[pointer + 1], expected[pointer + 2], level
        ):
            matched.append(pointer)
            matched.append(pointer + 1)
            matched.append(pointer + 2)
            pointer += 3
            continue
        # token is a repeat of an already-revealed recent word (user
        # restarted the ayah) — ignore it rather than treating it as an error
        is_repeat = False
        for back in range(max(0, pointer - 8), pointer):
            if matches_word(tok, expected[back], level):
                is_repeat = True
                break
        if is_repeat:
            continue
        # otherwise: unrecognized word — skip it, pointer stays (user must retry)

    return {"pointer": pointer, "matched": matched}
