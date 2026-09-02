# hifz-test deploy bundle
Contents to push to the public repo naelseddin-cpu/hifz-test (branch main).
The workflow auto-enables GitHub Pages; site: https://naelseddin-cpu.github.io/hifz-test/
index.html = single-file premium test build (exact mushaf pages 596-604,
browser speech recognition + typing fallback). Next iteration: swap in the
on-device Whisper engine build once hosted (real origin allows model download).

## Pages 1–2 are intentionally excluded

`img/page-001.png` and `img/page-002.png` are present in this bundle but are
**deliberately left out of the `PAGES` array** in `index.html`. This is a
founder decision (recorded in `docs/quran-memorization/AUDIT-2026-08-30.md` in
the ArabiaERP repo): pages 1 and 2 of the mushaf are special ornamental pages
(cover/Al-Fatiha opening spread) that need their own dedicated word-box layout
and review, separate from the standard per-page pipeline used for the rest of
the mushaf. They will be handled at the end, once the other 602 pages are
verified. Do not add them to `PAGES` without that dedicated pass.
