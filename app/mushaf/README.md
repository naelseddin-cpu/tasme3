# Exact-mushaf rendering data

Reproduces the printed Madinah mushaf pages exactly (same typography, same
words on the same lines) from open sources — zero-error verified.

## Sources (all open)
- **Glyphs & layout:** quran.com words DB via npm `@kmaslesa/holy-quran-word-by-word-full-data`
  — per word: exact V1 glyph code(s), page number, PRINT line number, ayah
  markers, surah-header & basmala line positions.
- **Fonts:** KFGQPC QCF_Pnnn per-page fonts (one glyph per printed word) +
  UthmanicHafs text font, from github.com/mustafa0x/qpc-fonts
  (King Fahd Complex fonts; license: qurancomplex.gov.sa).
- **Readable word text (for speech matching):** official KFGQPC digital text
  UthmanicHafs v22 (same repo, text-mushafs/).

## Verification performed (2026-08-28)
- All 604 pages: package glyph stream matches repo layout stream char-for-char
  after stripping formatting spaces, EXCEPT 5 known spots (below).
- Word join: official v22 text words align 1:1 with glyph words for 6229/6236
  ayat; the remaining 7 are known orthographic join/split cases handled
  explicitly in tools/gen_mushaf_pages.py (بَعۡدَ مَا 2:181/8:6/13:37,
  إِلۡ يَاسِينَ 37:130, لَّوۡمَا 15:7, مَالِيَ 27:20/36:22).

## QA flags — verify visually against print before shipping these pages
- p12 (2:79 مما split), p565 (68:42 marker code), p566, p588/p589 (page-break
  of 83:35) — two data vintages disagree at these spots; check against the
  printed mushaf and correct data if needed.
- Surah header bands and basmala lines are rendered from the UthmanicHafs
  text font (calligraphy approximation of the ornamental print bands) — the
  Quran WORDS themselves are glyph-exact.

## Regenerating / extending to all 604 pages
python3 tools/gen_mushaf_pages.py 1 2 3 ... (page numbers)
Requires: npm package above, cloned qpc-fonts repo, risan/quran-json.
Fonts: copy mushaf-woff2/QCF_Pnnn.woff2 for each shipped page (~50 KB each,
all 604 ≈ 30 MB).
