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


def tolerance_for(level: Optional[int], length: int) -> int:
    """Tolerance table per difficulty level. Strictly decreasing as level
    rises (L1 >= L2 >= L3 >= L4 at every length). Level omitted (None)
    behaves exactly like level 2 (the default)."""
    if level == 1:
        return 1 if length <= 3 else 2 if length <= 6 else 3
    if level == 3:
        return 0 if length <= 4 else 1 if length <= 7 else 2
    if level == 4:
        return 0
    # level 2, or default
    return 0 if length <= 3 else 1 if length <= 5 else 2


def fuzzy_equal(a: str, b: str, level: Optional[int] = None) -> bool:
    """Tolerance grows with word length: short words must be near-exact."""
    if a == b:
        return True
    length = max(len(a), len(b))
    max_dist = tolerance_for(level, length)
    return levenshtein(a, b) <= max_dist


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


def matches_word(tok: str, item: ExpectedItem, level: Optional[int] = None) -> bool:
    return any(fuzzy_equal(tok, form, level) for form in word_forms(item))


def matches_merged(
    tok: str, item1: ExpectedItem, item2: ExpectedItem, level: Optional[int] = None
) -> bool:
    """Merged token covering two consecutive expected words: try all
    combinations of each word's n/a forms."""
    forms1, forms2 = word_forms(item1), word_forms(item2)
    return any(
        fuzzy_equal(tok, f1 + f2, level) for f1 in forms1 for f2 in forms2
    )


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
