# Build Plan — Quran Memorization Trainer (حِفْظ)

**Date:** 2026-08-30 · **Supersedes:** INTEGRATION_GUIDE.md (kept for history)
**Inputs:** AUDIT-2026-08-30.md (four-agent audit) + founder decisions of 2026-08-30.

---

## Architecture (final)

Users have weak internet and old phones. Everything heavy lives on the server;
the client is a thin static PWA.

```
CLIENT (static PWA, tiny)                    SERVER (founder's VPS)
┌────────────────────────────┐               ┌─────────────────────────────┐
│ Canvas renderer            │               │ FastAPI                     │
│  page image + word veils   │   audio clip  │  POST /evaluate             │
│  (single coordinate space) │ ────────────► │   faster-whisper (base/int8)│
│ Record short clip          │               │   + canonical matcher       │
│ Reveal matched words       │ ◄──────────── │   → matched word indices    │
│ Progress in localStorage   │  indices JSON │  no audio ever stored       │
└────────────────────────────┘               └─────────────────────────────┘
        │ per page: 1 image (~100–200 KB webp) + boxes JSON (~5 KB)
        ▼
STATIC ASSETS (free CDN / GitHub Pages)
  604 page images rendered print-exact from official KFGQPC fonts + layout data
```

Why this fits the constraints:
- **Old phone, bad internet:** a session costs one small image per page; no model
  download, no font rendering on device, no WASM.
- **Real print:** the image IS the print — rendered from the official King Fahd
  per-page glyph fonts, verified against ground truth. Unrecited words hidden by
  paper-colored veils in the same canvas (already Playwright-verified aligned).
- **Best recognition:** full Whisper on the server, constrained matching against
  the known expected text (alignment, not open dictation).
- **Cost:** static assets are free (CDN); the VPS handles only short-clip
  transcription. faster-whisper int8 `base` transcribes a ~10 s clip in ~1–2 s on
   2 CPU cores. Privacy: clips processed in memory, never written to disk.

---

## Normalization spec (single source of truth — C1/C2 fixes)

Applies identically in the Python generator, the JS matcher, and the server matcher.
Golden test vectors live in `apps/quran-trainer/tests/normalize-vectors.json` and
are run by BOTH language implementations.

1. Strip tashkeel, Quranic annotation marks, tatweel (as today).
2. Keep ONLY Arabic letters `[ء-ي]` — everything else (Arabic punctuation `،؛؟`,
   Arabic-Indic digits, Latin, symbols) is deleted. (Fixes Kimi punctuation bug.)
3. Unify: `آأإٱ→ا`, `ة→ه`, `ى→ي` (as today).
4. **Alternate form:** each expected word also gets form `a` = same pipeline but
   with dagger-alif U+0670 → `ا`, emitted in page JSON only when it differs from
   `n`. The matcher accepts a token that matches either `n` or `a`.
   (Fixes قَٰلَ→قل vs spoken قال false-reject without touching any other word.)

Difficulty levels (from PLAN.md, 4 levels; Kimi's 3-level tolerance table extended):
L1 مبتدئ len≤3→1, ≤6→2, else 3 · L2 متوسط 0/1/2 · L3 متقن len≤4→0, ≤7→1, else 2 ·
L4 إجازة exact only (later phase; reserved in the API now).

---

## Work packages

### Phase 0 — Critical fixes (client + matcher) — Sonnet agent WP-A
- Canonical `matcher.js`: port Kimi's level parameter into root matcher, add
  alternate-form (`a`) acceptance, keep `[ء-ي]` filter; extend the 13-case test
  suite with: punctuation-glued tokens, قال/قل both directions, level
  monotonicity, golden vectors.
- hifz-test client: fix bottombar occlusion of mic-help/typed-fallback (C4);
  `pageImage.onerror` + draw() guard (M5); `fullscreenchange` redraw; arrow-key
  nav; recognition restart backoff; mic-stream release on page switch (M1).
- Document pages 1–2 exclusion as intentional in hifz-test README.
- Delete/mark superseded: `mobile-test-template.html`, note on `deploy-test/`.

### Phase 1 — Data & assets foundation — Sonnet agent WP-B (long pole)
1. Re-acquire and PIN upstream sources (record exact versions/commits in
   `tools/SOURCES.lock.md`): `@kmaslesa/holy-quran-word-by-word-full-data`,
   KFGQPC UthmanicHafs v22 JSON, verse-order `quran.json`,
   `mustafa0x/qpc-fonts` (all 604 `QCF_P*.woff2`).
2. Update `gen_mushaf_pages.py`: emit `a` field per the spec; parametrize page
   range; run for ALL 604 pages (pages 1–2 generated but flagged special).
3. Implement BOTH verification checks with committed evidence:
   (a) glyph-stream char-for-char vs package layout, (b) v22 word alignment.
   Output `tools/verification/REPORT-<date>.json` + human summary → committed.
   Adjudicate every QA flag explicitly (extend the known 7+5 list).
4. Generalize `render_page_images.mjs`: CLI page range, read JSON from disk,
   emit per-page webp (quality tuned ≤ ~200 KB at 2× mobile width) + boxes.
   Render all 604; spot-check 10 random pages visually.
5. Commit: fonts (~30 MB), 604 page JSONs (~3 MB), boxes; page images published
   to the static-hosting repo (not the monorepo) to keep ArabiaERP lean.

### Phase 2 — ASR server — Sonnet agent WP-C
- FastAPI service `server/`: `POST /evaluate` {audio blob, page, pointer, level}
  → faster-whisper (int8, `base`; Arabic, constrained temperature) → normalize →
  canonical matcher (Python port sharing golden vectors) → {matched, pointer,
  transcript?}. `GET /healthz`. CORS locked to the site origin. Rate limiting.
  Audio processed in memory only; explicit no-retention.
- Dockerfile + docker-compose; deploy runbook for the founder's VPS; load
  test target: 10 concurrent clips on 2 vCPU.
- Fallback path when server unreachable: typed input + clear offline message.

### Phase 3 — Unified client — Sonnet agent WP-D (after 0/1 land)
- hifz-test canvas base + merged 12-language i18n + Kimi's progress/review/streak
  concepts rebuilt with: schema-validated versioned storage (C5a), LOCAL-date
  day boundaries via one shared date helper (C5b), busy-guard on record button,
  `AudioContext` cleanup, `mediaRecorder.onerror`.
- Recording UX per founder decisions: tap to start / tap to stop; landscape
  supported; fullscreen enforced.
- Service worker: versioned cache with activation cleanup (M7); caches visited
  page images for repeat review offline (recognition still needs network).
- Privacy copy updated: "processed on our server, never stored."

### Phase 4 — Verify & ship
- Playwright E2E at 390×844 / 844×390 / 1280×800 against a local server stub.
- Deploy client to GitHub Pages (hifz-test), server to VPS; founder tests on
  real devices; iterate.

## Sequencing

WP-A ∥ WP-B start immediately (independent). WP-C starts once the normalization
golden vectors exist (early WP-A output). WP-D starts after WP-A + WP-B assets.
Every WP is audited (Fable) before its commit is pushed.

## Open items for the founder (non-blocking, defaults chosen)
1. Server hosting target for the ASR service (any 2 vCPU VPS is enough to start).
2. Whether the transcript is ever shown to the user (currently: no — only the
   printed words appear, per founder's earlier instruction).
3. Domain name for production (Pages URL fine for testing).
