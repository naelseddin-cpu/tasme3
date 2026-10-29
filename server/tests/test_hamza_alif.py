"""Regression: mushaf hamza+alif (ءَامَنُوا, ٱلْقُرْءَان, ءَالَآءِ) must accept the
ordinary madd-alif spelling ASR produces (آمنوا, القرآن, آلاء). Before the ءا→ا
rule, a correct recitation stalled on 1,096 such words on 488 pages, at every level."""
import pytest

from server.matching import match_transcript
from server.pagedata import expected_words


def _first(page_range, n):
    for p in page_range:
        ew = expected_words(p)
        for i, w in enumerate(ew):
            if w.get("n") == n:
                return ew, i
    raise AssertionError(n)


@pytest.mark.parametrize("level", [1, 2, 3])
@pytest.mark.parametrize("n,said", [("ءامنوا", "آمنوا"), ("ءالاء", "آلاء"), ("القرءان", "القرآن"), ("ءايه", "آية")])
def test_madd_alif_spelling_accepted(n, said, level):
    ew, i = _first(range(1, 605), n)
    assert match_transcript(ew, i, said, level)["pointer"] == i + 1


@pytest.mark.parametrize("level", [1, 2, 3])
def test_different_word_still_rejected(level):
    ew, i = _first(range(1, 605), "ءامنوا")
    assert match_transcript(ew, i, "أمنوا كفروا", level)["pointer"] in (i, i + 1)  # أمنوا≈آمنوا by design; كفروا never advances further
    assert match_transcript(ew, i, "كفروا", level)["pointer"] == i
