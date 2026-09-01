"""Loads mushaf page JSON (app/mushaf/pages/page-NNN.json) and builds the
flat "expected" word list the matcher walks, in page order.

Token schema (see app/mushaf/pages/page-604.json for reference), per token
object `tk[i]`: {g, n, k, e?, a?}
  g  glyph (display only, not used here)
  n  normalized expected form (matcher's word_forms base form)
  k  sura:ayah key (display only, not used here)
  e  truthy on ayah-end marker tokens, which carry no `n`/`w` — these are
     NOT recitable words and must be excluded from the expected list
  a  optional alternate normalized form (dagger-alif variant), included
     only when it differs from `n`
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Dict, List

PAGES_DIR = Path(__file__).resolve().parent.parent / "app" / "mushaf" / "pages"

MIN_PAGE = 1
MAX_PAGE = 604


class PageNotFoundError(Exception):
    pass


def page_path(page: int) -> Path:
    return PAGES_DIR / f"page-{page:03d}.json"


@lru_cache(maxsize=None)
def load_page_raw(page: int) -> dict:
    path = page_path(page)
    if not path.is_file():
        raise PageNotFoundError(f"page {page} not found at {path}")
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def expected_words(page: int) -> List[Dict[str, str]]:
    """Flat, in-order list of {'n':.., 'a':optional} expected-word items for
    the whole page, across all word-lines, skipping ayah-end markers and any
    non-word lines (surah-name headers, basmala lines)."""
    data = load_page_raw(page)
    expected: List[Dict[str, str]] = []
    for line in data.get("lines", []):
        if line.get("t") != "w":
            continue
        for tok in line.get("tk", []):
            if tok.get("e"):
                continue
            if "n" not in tok:
                continue
            item: Dict[str, str] = {"n": tok["n"]}
            alt = tok.get("a")
            if alt and alt != tok["n"]:
                item["a"] = alt
            expected.append(item)
    return expected
