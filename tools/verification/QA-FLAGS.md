# QA Flags — Mushaf Data (WP-B, 2026-09-01)

Every mismatch/anomaly surfaced while regenerating all 604 pages and running
`tools/verify_mushaf.py`, adjudicated. See `tools/verification/REPORT-2026-09-01.{json,md}`
for the full machine/human verification output this list is drawn from.

## Known-expected flags (carried over from mushaf/README.md, 2026-08-28 audit)

These 5 spots were already documented before this work package and are
**expected, non-blocking** — visual confirmation against the printed mushaf
is deferred to the image-rendering work package (out of scope here).

| # | Page(s) | Verse key | Description | Status after WP-B re-verification |
|---|---|---|---|---|
| 1 | p12 | 2:79 | مما split: word-by-word package glyph stream (24 glyphs) vs qpc-fonts repo's independent per-ayah reference `mushaf.txt` (25 glyphs, repeats `ﭾ` twice) | **Reproduced.** Package data is internally self-consistent (check (b) word-alignment passes for this ayah); the reference file's duplicate glyph looks like a data-entry artifact in that older export. Package glyphs used for shipping. |
| 2 | p565 | 68:42 | Marker-code divergence: package's ayah-end marker glyph is `ﰦ` (U+FB66 PUA); the qpc-fonts reference has `û` (U+0075+0302, a Latin character, not an Arabic PUA glyph) in that position | **Reproduced.** Reference-file corruption/encoding artifact, not a package data error — the Latin `û` cannot be a real per-page mushaf glyph. Package glyph used for shipping; visually confirm p565's ayah-end marker renders correctly once page images exist. |
| 3 | p566 | 69:8 | Marker-code divergence: package has 6 total glyphs (5 words + 1 end marker `ﰀ`); reference has 7 (an extra trailing `ﰁ`) | **Reproduced.** Text-word alignment (check b) confirms 5 text words = 5 glyph words for 69:8, so the package's single-glyph end marker is internally consistent; the reference vintage apparently encodes this ayah's marker with two glyphs. Package data used for shipping; visually confirm p566's marker. |
| 4 | p588/p589 | 83:35 | Page-break of 83:35 — two data vintages previously disagreed on which page the ayah's words land on | **NOT reproduced** with the currently pinned sources (npm `@kmaslesa/holy-quran-word-by-word-full-data@1.0.6`, qpc-fonts commit `8a4f39d`): 83:35 sits entirely on page 589 (3 words + 1 end marker), and check (a)/(b) both pass clean for it. Likely fixed upstream in a later package/repo revision than whatever vintage originally flagged it. Recommend a routine visual check anyway since it's a page-boundary ayah, but treat as resolved for now. |
| 5 | — | Surah header / basmala bands | Rendered from the UthmanicHafs text font (calligraphy approximation of the ornamental print bands); the Quran WORDS themselves are glyph-exact. | Unchanged design decision, not a data error — noted for the (later) image-rendering package. |

## New findings from this work package

None of the above are new — all 3 reproducible glyph-stream diffs match the
previously-documented set exactly (by verse key and description), and no
additional glyph-stream or word-alignment exceptions were found across the
full 604 pages / 6236 ayat.

Two **real, previously-undetected bugs** in `gen_mushaf_pages.py` itself were
found and fixed while generating all 604 pages for the first time (the
original 11 committed pages never exercised these code paths):

1. **36:22 SPECIAL-case rule was wrong.** The `مَالِيَ` split rule
   (`('split', 'مَالِيَ', ['مَا','لِيَ'])`) was reused for both 27:20 and
   36:22, but 36:22's actual orthographic token is `وَمَالِيَ` (with a وَ
   prefix baked into the same word — "wa-māliya", unlike 27:20's standalone
   `مَالِيَ`). The correct split is `وَمَا` + `لِيَ`. Caught because page 441
   (containing 36:22) had never been generated before this run; the old rule
   caused a hard word-count mismatch (`gen_mushaf_pages.py` aborted with
   `WORD MISMATCHES` before this fix). Fixed in `SPECIAL['36:22']`.

2. **Diacritic combining-mark order in the pinned v22 JSON isn't always
   canonical**, which broke the literal string-equality SPECIAL-case trigger
   for 15:7 (`لَّوۡمَا`): the source token stores shadda before fatha
   (non-canonical order per Unicode combining-class rules) at that spot,
   while the hardcoded pattern used canonical (fatha-before-shadda) order.
   Fixed by NFC-folding both sides only for the SPECIAL-trigger comparison
   (the emitted token text itself is untouched, so no output changed for any
   other word).

3. **Trailing sura-header/basmala lines were silently dropped.** The original
   line-layout algorithm computed the page's line count as `max(used)` (the
   highest word-bearing line number), so a sura header or basmala band that
   prints as the page's OWN LAST line — because the new surah's first verse
   starts on the *next* page — was never emitted at all, silently shrinking
   the page to 14 (or fewer) lines instead of the mandatory 15. Affected
   **21 pages**: 76, 207, 331, 341, 349, 366, 376, 414, 417, 445, 452, 498,
   506, 525, 548, 555, 557, 584, 586, 590, 594. Fixed by computing the true
   line count as `len(word_lines) + len(meta_lines)` and, for `start_sura`
   lines, reading the sura name directly off the word-by-word package's own
   `metaData.suraName` field instead of inferring it by peeking at the next
   word line (which doesn't exist for a trailing header). All 604 generated
   pages now pass the "15 lines for pages 3–604" structural check (see
   `tools/verify_mushaf.py`'s page-JSON validation, 604/604 OK).

Both fixes were verified not to touch any previously-committed page's `g`/`n`/`k`/`w`/`e`
fields (regression-diffed pages 1, 2, 596–604 before and after each fix — see
report in the WP-B session; only the new optional `a` field was added, 101
occurrences across those 11 pages).

## Summary

- Glyph-stream check (a): 6233/6236 ayat OK, 601/604 pages OK, 3 known/expected DIFFs (all previously documented).
- Word-alignment check (b): 6236/6236 aligned, 0 exceptions.
- Page-JSON structural validation: 604/604 OK.
- 2 generator bugs found and fixed (36:22 special-case rule; trailing sura-header line drop, 21 pages).
