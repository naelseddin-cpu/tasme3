# Integration Guide: Kimi Code + Test Site Rendering

**Date:** 2026-08-30  
**Status:** Ready for integration  
**Branch:** claude/quraan-voice-memorization-3t4pad  

---

## Overview

This guide describes how to integrate the Kimi implementation (frontend logic, matching, i18n, progress tracking) with the test site's canvas-based mushaf page rendering to create the unified Quran memorization app.

**Current State:**
- ✅ Kimi code reviewed: `/apps/quran-trainer/vendor/kimi/` (matching, i18n, progress, ASR)
- ✅ Test site rendering ready: `/hifz-test/` (canvas, page images, word boxes)
- ✅ Code review doc: `docs/quran-memorization/KIMI_CODE_REVIEW.md`

**Goal:** Single unified app combining Kimi's logic with test site's mushaf rendering.

---

## Architecture

```
app/
├─ index.html                    # Unified entry point (Kimi UI adapted)
├─ app.js                        # Main logic (Kimi, with rendering hooks)
├─ matcher.js                    # Text matching (Kimi, no changes)
├─ quran-data.js                 # Surahs data (extend to 114)
├─ canvas-renderer.js            # Page rendering (from test site)
├─ i18n/
│  ├─ ar.json, en.json, ...      # (Kimi, keep as-is)
├─ mushaf/
│  ├─ fonts/                     # KFGQPC glyphs (QCF_P*.woff2)
│  └─ pages/                     # Page data (page-NNN.json)
├─ style.css                     # Design (Kimi base + canvas adaptations)
├─ manifest.json                 # PWA (Kimi)
└─ sw.js                         # Service worker (Kimi + page caching)
```

---

## Step 1: Merge Frontend Code

### A. Preserve Kimi's Matching & Logic

**Files to copy/keep as-is:**
```bash
# From vendor/kimi/ to project root:
app.js                           # Main logic (with fixes below)
matcher.js                       # No changes needed
i18n/                            # All 6 language files
style.css                        # CSS base (adapt for canvas)
manifest.json                    # PWA metadata
sw.js                            # Service worker
```

**Files to extend:**
```bash
quran-data.js                    # Add 114 surahs (currently has 4)
                                 # Keep format: id, name, englishName, ayat[]
```

### B. Add Canvas Rendering

**Files to add from test site:**
```bash
/hifz-test/index.html           → Extract canvas rendering logic
                                → Adapt UI to Kimi's structure
```

**New files to create:**
```bash
canvas-renderer.js              # Encapsulate canvas page rendering
                                # Methods: renderPage(pageNum), revealWord(index)
```

---

## Step 2: Extend Quran Data

### Current State
- 4 surahs: Fatiha, Al-Asr, Al-Kawthar, Al-Ikhlas
- Each surah: id, name, englishName, ayat[] (array of words per ayah)

### Target State
- 114 surahs with verified Uthmani text
- Each word tagged with: surahId, ayahIndex, wordIndex, pageNum, boxCoords

### Data Flow

```javascript
// 1. quran-data.js (for matching)
surahs[surahId].ayat[ayahIndex][wordIndex]  // "الْحَمْدُ"

// 2. Mapping (new file: surahs-to-pages.js)
word → pageNum, lineNum, boxCoords

// 3. Page data (page-NNN.json, from scan-to-boxes)
{
  lines: [
    { t: 'w', tk: [{g: glyph, n: normalized, k: token_key, e: marker_bool}] }
  ]
}
```

### Generation Steps

1. **Source Quran text:** Use Tanzil.net verified Uthmani text
   - https://tanzil.net/res/text/uthmani/quran-uthmani.txt
   
2. **Extend quran-data.js:**
   ```bash
   python3 tools/build_quran_data.py \
     --input tanzil-uthmani.txt \
     --output apps/quran-trainer/quran-data.js
   ```

3. **Generate all 604 pages:**
   ```bash
   python3 tools/render_page_images.mjs \
     --pages 1-604 \
     --font mushaf/fonts/KFGQPC*.woff2 \
     --output mushaf/pages/
   ```

4. **Extract word boxes from pages:**
   ```bash
   python3 tools/scan_to_boxes.py \
     --input mushaf/images/page-*.png \
     --output mushaf/pages/page-*.json
   ```

5. **Validate alignment:**
   ```bash
   node tools/validate-page-alignment.js \
     --quran-data quran-data.js \
     --page-json mushaf/pages/ \
     --expected-total-words 77430
   ```

---

## Step 3: Adapt ASR & Matching Pipeline

### Current (Kimi)

```javascript
// app.js:321-334, handleTranscript()
const normalizedExpected = ayahWords.map(normalizeArabic);
const result = matchTranscript(normalizedExpected, pointer, normalized, level);

// Result: matched = [word_indices]
//         pointer = next expected index
```

### Adapted (Unified)

```javascript
// Same logic, but:
// 1. Get page layout from current page number
// 2. Map matched indices to canvas word boxes
// 3. Trigger canvas reveal animation

const pageNum = currentSession.pageNum;
const pageLayout = PAGE_BOXES[pageNum];  // from boxes.js

for (const idx of result.matched) {
  const box = pageLayout.tokens[idx];
  canvas.revealWord(box);
}
```

---

## Step 4: Update UI for Page-Based Navigation

### Current (Kimi)
```html
<button data-view="select">Select Surah</button>
<div id="surah-grid"><!-- Grid of surahs --></div>
<div id="ayah-text"><!-- Text display --></div>
```

### Adapted (Unified)
```html
<button data-view="select">Select Surah</button>
<div id="surah-grid"><!-- Grid of surahs --></div>
<div id="mushaf-page"><!-- Canvas rendering --></div>
<div class="ayah-nav">
  <button id="prev-page">←</button>
  <span id="page-number">1</span>
  <button id="next-page">→</button>
</div>
```

### Changes Needed
1. Replace `#ayah-text` with `#mushaf-page` (canvas container)
2. Add page navigation buttons (← →)
3. Add breadcrumb: "Surah / Juz / Page"
4. Adapt progress tracking: ayah-level → page-level (or both)

---

## Step 5: Robustness Fixes

### High Priority

#### A. ASR Model Loading — Add Cancellation

```javascript
// app.js:202-243, initASR()
// BEFORE:
state.asr = await pipeline(ASR_PIPELINE, ASR_MODEL, {...});

// AFTER:
const abortCtrl = new AbortController();
state.asr = await pipeline(ASR_PIPELINE, ASR_MODEL, {
  ...options,
  signal: abortCtrl.signal
});
state.asrAbortCtrl = abortCtrl;

// On view change:
if (state.asrAbortCtrl) state.asrAbortCtrl.abort();
```

#### B. MediaRecorder Format Validation

```javascript
// app.js:249-251
// BEFORE:
const mimeType = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4";

// AFTER:
const mimeType = MediaRecorder.isTypeSupported("audio/webm")
  ? "audio/webm"
  : MediaRecorder.isTypeSupported("audio/mp4")
  ? "audio/mp4"
  : null;

if (!mimeType) {
  setFeedback("msg.noAudioFormat", "error");
  return;
}
```

#### C. localStorage Validation

```javascript
// app.js:75-95, loadState()
// AFTER each JSON.parse, validate schema:
try {
  const data = JSON.parse(localStorage.getItem(key));
  if (!isValidProfile(data)) throw new Error("Invalid schema");
  return data;
} catch (e) {
  console.warn("Corrupt localStorage, using defaults", e);
  return getDefaultProfile();
}
```

### Medium Priority

#### D. Service Worker Cache Versioning

```javascript
// sw.js
const CACHE_VERSION = 'v2-mushaf-pages-604';
const ASSET_CACHE = [
  'index.html',
  'app.js',
  'matcher.js',
  'style.css',
  'i18n/ar.json',
  ...  // all i18n files
];
const PAGE_CACHE = [
  'mushaf/pages/page-001.json',
  'mushaf/pages/page-002.json',
  ...  // all 604 page JSONs
];
const FONT_CACHE = [
  'mushaf/fonts/QCF_P001.woff2',
  ...  // all 12 font files
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll([...ASSET_CACHE, ...PAGE_CACHE, ...FONT_CACHE]))
  );
});
```

---

## Step 6: Testing

### Unit Tests

**File:** `tests/matcher.test.js`
```javascript
import { fuzzyEqual, matchTranscript, normalizeArabic } from '../matcher.js';

describe('matcher.js', () => {
  test('normalizeArabic removes tashkeel', () => {
    expect(normalizeArabic('الْحَمْدُ')).toBe('الحمد');
  });
  
  test('fuzzyEqual level 1 (beginner) forgiving', () => {
    expect(fuzzyEqual('الحمد', 'الحمه', 1)).toBe(true);
  });
  
  test('fuzzyEqual level 3 (precise) strict', () => {
    expect(fuzzyEqual('قل', 'هل', 3)).toBe(false);
  });
  
  test('matchTranscript handles merged tokens', () => {
    const expected = ['الحمد', 'لله', 'رب'];
    const result = matchTranscript(expected, 0, 'الحمدلله رب', 2);
    expect(result.matched).toContain(0);
    expect(result.matched).toContain(1);
    expect(result.pointer).toBe(2);
  });
});
```

**Run:** `npm test matcher.test.js`

### Integration Tests

**File:** `tests/integration.test.js`
```javascript
describe('ASR → Matching → Canvas', () => {
  test('Fatiha: Perfect recitation reveals all words', async () => {
    // 1. Load page 1 (Fatiha)
    // 2. Simulate ASR output: "بسم الله الرحمن الرحيم"
    // 3. Check: all 4 words revealed in canvas
  });
  
  test('Al-Asr: Accented recitation with difficulty level', async () => {
    // Simulate beginner speaker, level 1
    // Check: forgiving matching
  });
  
  test('Offline mode: App works without Whisper model', () => {
    // Disable ASR, try to load page
    // Check: page renders, recording button disabled gracefully
  });
});
```

### E2E Tests (Manual on Real Devices)

1. **iOS Safari (iPhone, iPad)**
   - [ ] Load app at naelseddin-cpu.github.io/hifz-test/
   - [ ] Grant microphone permission
   - [ ] Recite Fatiha (accent test)
   - [ ] Switch to landscape
   - [ ] Test offline mode (turn off WiFi, continue reciting)

2. **Android Chrome**
   - [ ] Load app
   - [ ] Test microphone permission flow
   - [ ] Recite Al-Asr (easy surah)
   - [ ] Test language switching

3. **Desktop (Chrome, Safari, Firefox)**
   - [ ] Test all 6 languages
   - [ ] Test all 3 difficulty levels
   - [ ] Check progress persistence across refresh

---

## Step 7: Deployment

### Test Deploy

1. **Build & test locally:**
   ```bash
   cd /home/user/ArabiaERP/apps/quran-trainer
   python3 -m http.server 8000
   # Open http://localhost:8000
   ```

2. **Deploy to GitHub Pages:**
   ```bash
   git add apps/quran-trainer/
   git commit -m "feat(quran-trainer): integrate Kimi + canvas rendering, all 604 pages"
   git push -u origin claude/quraan-voice-memorization-3t4pad
   ```

3. **Test at:** naelseddin-cpu.github.io/hifz-test/ (update with new version)

### Production Deploy

1. **Setup custom domain** (founder's choice)
   - Cloudflare Pages or GitHub Pages + custom domain
   - Enable CDN caching (fonts, pages)

2. **Monitor metrics:**
   - Whisper model download time (target: <2 min on 4G)
   - Page load time (target: <3 sec after model cache)
   - localStorage usage (target: <10 MB)

3. **Track user feedback:**
   - Accuracy reports (ASR false accepts/rejects)
   - Microphone permission issues
   - Language-specific issues

---

## Estimated Timeline

| Task | Effort | Owner |
|------|--------|-------|
| Code integration | 2–3 days | Claude |
| Extend to 114 surahs | 1–2 days | Claude + generation scripts |
| Generate 604 pages | 2–4 hours | Automated (scan-to-boxes) |
| Robustness fixes | 1 day | Claude |
| Unit tests | 1 day | Claude |
| Integration tests | 1 day | Claude |
| Manual E2E testing | 2–3 days | Owner (real devices) |
| **Total** | **~2 weeks** | |

---

## Files Checklist

### To Create
- [ ] `canvas-renderer.js` — Canvas rendering wrapper
- [ ] `surahs-to-pages.js` — Word-to-page mapping
- [ ] `tests/matcher.test.js` — Unit tests
- [ ] `tests/integration.test.js` — Integration tests
- [ ] `tools/build-quran-data.py` — Generate quran-data.js from Tanzil

### To Modify
- [ ] `app.js` — Add rendering hooks, fix ASR cancellation
- [ ] `index.html` — Replace text rendering with canvas
- [ ] `style.css` — Adapt for page-based layout
- [ ] `sw.js` — Add cache versioning
- [ ] `quran-data.js` — Extend to 114 surahs

### To Keep As-Is
- [ ] `matcher.js` — No changes
- [ ] `i18n/*` — No changes
- [ ] `manifest.json` — No changes

---

## Next Steps

1. ✅ **Code review complete** (KIMI_CODE_REVIEW.md)
2. ✅ **Integration guide written** (this file)
3. 🔄 **Await approval to begin integration**
4. 📝 Start with Step 1: Copy Kimi code to project root
5. 📝 Step 2: Extend quran-data.js to 114 surahs
6. 📝 Continue through Step 7 as guided above

---

**Status:** Ready for integration. Awaiting go-ahead to proceed.
