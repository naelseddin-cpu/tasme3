# Delegation prompts (founder workflow)

The founder generates heavy assets with external AI tools to save Claude usage;
Claude acts as master agent: reviews, merges, tests, and finalizes on the branch.

## Prompt 1 — Kimi (full code)

```
You are building a complete, production-quality website. Deliver FULL code files, not snippets or explanations.

PROJECT: "Quran Memorization Trainer" — a free charity web app that helps people memorize the Quran by reciting aloud. The app listens through the microphone, checks the recitation against the known Quran text, and reveals each word on screen only when recited correctly. Wrong/missed words stay hidden so the user retries.

HARD CONSTRAINTS (do not violate any):
1. Browser-only static site. NO backend, NO server code, NO database, NO API keys, NO user accounts in this version. All state in localStorage.
2. Plain HTML + CSS + vanilla JavaScript (ES modules). NO React/Vue/build step. It must run by opening index.html from any static host.
3. Speech recognition runs 100% on-device in the browser using @huggingface/transformers (transformers.js v3) loaded from jsDelivr CDN, model "onnx-community/whisper-base", pipeline "automatic-speech-recognition", language "arabic", task "transcribe". Audio is captured with MediaRecorder, decoded via AudioContext, resampled to 16 kHz mono Float32Array via OfflineAudioContext, then passed to the pipeline. Show a download progress bar the first time the model loads. NEVER upload audio anywhere.
4. The Quran text is displayed in Arabic with full tashkeel, RTL, in a mushaf-like cream/gold page style, using the "Amiri Quran" font from Google Fonts. Each word is a <span>. Hidden words show as soft placeholder boxes; correctly recited words reveal with a gentle green animation. Ayah numbers shown as ﴿١﴾ ﴿٢﴾ in Arabic numerals.
5. Matching logic must be its own module (matcher.js) with pure functions, no DOM access:
   - normalizeArabic(s): strip tashkeel/quranic marks/tatweel; unify آأإٱ→ا, ة→ه, ى→ي; drop non-Arabic chars.
   - levenshtein(a,b)
   - fuzzyEqual(a,b,level): tolerance depends on difficulty level (see 6) and word length.
   - matchTranscript(expectedNormalizedWords, pointerIndex, transcriptText, level) → {pointer, matched:[indices]}: greedy alignment that advances only on matches, skips ASR noise tokens, tolerates a token that merges two consecutive expected words, and ignores repeats of recently revealed words (user restarting an ayah). Never auto-passes an unmatched word.
6. Difficulty levels chosen by the user (a visible selector, persisted per user in localStorage):
   Level 1 "مبتدئ / Beginner": very forgiving (larger edit-distance tolerance, short words allow distance 1).
   Level 2 "متوسط / Intermediate" (default): moderate tolerance.
   Level 3 "متقن / Precise": near-exact match required.
   Progress records store the level they were earned at.
7. Multilingual UI via a translations object: one JSON file per language in /i18n (ar, en, ur, id, tr, fr). Auto-detect navigator.language with a manual switcher; full RTL/LTR flipping. The Quran text itself is ALWAYS Arabic and never translated. All UI strings must go through the t() function — no hardcoded UI text.
8. Content: include at least these surahs as a data file (quran-data.js), full Uthmani-style text with tashkeel, split into ayat: Al-Fatiha (1), Al-Ikhlas (112), Al-Falaq (113), An-Nas (114), Al-Kawthar (108), Al-Asr (103). Structure so more surahs can be appended easily.
9. Profile & training plan (all localStorage): user nickname, chosen daily target (ayat per day), difficulty level, per-surah progress (highest word index memorized + level earned), daily streak counter, and a simple review scheduler: each day, before new memorization, the app asks the user to re-recite yesterday's portion (review-first spaced repetition). A simple progress screen shows: streak, ayat memorized total, per-surah completion bars.
10. PWA: manifest.json + service worker caching the app shell, fonts CSS, i18n files, and quran-data.js so the UI opens offline (the ASR model is cached automatically by the browser after first load).
11. Accessibility & tone: large touch targets, works on mobile Safari and Chrome, encouraging feedback messages (never shaming), e.g. "أحسنت، أكمل…" on success and a gentle "حاول مرة أخرى" on failure.

DELIVERABLES — output complete content of every file:
/index.html, /style.css, /app.js, /matcher.js, /quran-data.js, /i18n/ar.json, /i18n/en.json, /i18n/ur.json, /i18n/id.json, /i18n/tr.json, /i18n/fr.json, /manifest.json, /sw.js, /README.md (how to host on any static server).

QUALITY BAR: code must run as-is with no missing pieces; handle mic-permission denial, model-load failure (show retry), and empty transcription gracefully. Keep it simple and readable — no fancy abstractions.
```

## Prompt 2 — Nano Banana (design mockup images) — v2, chrome-only

The Quran page itself is NEVER designed by an image model (founder decision:
exact printed mushaf, rendered by code). Nano Banana designs only the web
chrome around a blank reserved panel.

```
Design a UI mockup for a free Quran memorization web app. IMPORTANT: the center of the screen contains a large tall rectangular panel that is a RESERVED AREA — render it as a plain blank cream-colored sheet (#fffdf5) with a very thin gold border and NO text inside it at all: this space will be filled by software with a real printed Quran page, so do not draw any Arabic letters, calligraphy, or fake verses in it. Your job is to design everything AROUND that blank panel.

Style: calm, respectful, modern-minimal Islamic aesthetic — cream/ivory background (#f5f1e6), deep green accents (#1a5c38), soft gold details (#b8a24a), subtle abstract geometric ornament, generous whitespace, soft rounded corners, gentle shadows. Mobile phone screen, 9:16.

Around the blank panel design: a slim top bar with a menu icon, the app logo as a simple geometric emblem (no lettering), and a language switcher globe icon; below the panel a large round deep-green microphone button with a soft glow, flanked by a settings gear and a small difficulty selector of three dots labeled easy / medium / precise; at the bottom a thin daily progress bar, a small flame streak icon with a number, and a gold daily-goal ring; small page navigation arrows on the sides of the blank panel and a page-number chip below it.

No people, no faces, no photos, no mosque imagery, no Arabic or fake-Arabic text anywhere — icons, geometry, and Latin micro-labels only. Clean flat UI, high fidelity, like a Figma screenshot.
```

Variations to request (same style; blank-panel rule applies where relevant):
1. Home/dashboard — greeting, today's plan card (review + new memorization),
   continue button, bottom nav (recite, progress, groups, settings).
2. Progress — streak flame, total memorized counter, per-surah bars, and a
   grid map of 604 tiny page squares, memorized pages filled green.
3. Groups (halaqah) — group name header, member rows with geometric avatars
   (no faces), collective weekly total card, invite-by-link button.
4. Desktop 16:9 main screen — blank reserved panel centered like an open
   book, controls in a sidebar.


## Prompt 2 — v3 (founder layout corrections: page ~84% edge-to-edge, controls strip 10%)

```
Design a UI mockup for a free Quran memorization web app. Mobile phone screen, 9:16.

LAYOUT PROPORTIONS ARE STRICT: a slim top bar (about 6% of screen height); below it one large vertical rectangular panel that fills almost the ENTIRE screen — edge to edge horizontally with only a hair-thin margin, and stretching down to leave only a small strip at the bottom; the panel takes about 84% of the screen height. The bottom strip is a SINGLE compact control bar of about 10% of screen height, containing in one row: a small settings gear, a medium round deep-green microphone button (its diameter no taller than the strip), three small difficulty dots labeled easy/medium/precise, a tiny flame streak icon with a number, and a thin progress line along the very bottom edge.

THE LARGE PANEL IS A RESERVED AREA: render it as a plain blank cream sheet (#fffdf5) with only a hair-thin gold inner border and ABSOLUTELY NOTHING inside — no text, no Arabic letters, no calligraphy, no fake verses, no ornament inside the panel. Software will fill it with a real printed Quran page. Do not decorate inside it.

Top bar: menu icon, a small gold calligraphic logo, language globe icon, and a tiny page-number chip.

Style: calm modern-minimal Islamic aesthetic — cream/ivory background (#f5f1e6), deep green accents (#1a5c38), soft gold details (#b8a24a), flat clean UI with subtle shadows only; no 3D metal, no gemstones, no thick ornamental frames. No people, faces, photos, or mosque imagery; no Arabic or fake-Arabic text anywhere. High fidelity, like a Figma screenshot.
```


## Prompt set — remaining screens (v3 flat style, approved 2026-08-28)

Shared style preamble in each: cream #f5f1e6 / green #1a5c38 / gold #b8a24a,
flat clean UI, no 3D/gemstones, no people/faces/photos/mosque imagery, no
Arabic or fake-Arabic anywhere, Figma-screenshot fidelity. Only the desktop
screen contains the blank RESERVED mushaf panel (nothing inside, ever).

### Screen 2 — Home/Dashboard (mobile 9:16)
Slim top bar (menu, gold Quran-emblem logo, globe); greeting area; "today's
plan" card (review row + new-memorization row + wide green continue button);
two stat cards (flame streak, gold goal ring); bottom 4-icon nav (book active,
chart, group, gear).

### Screen 3 — Progress (mobile 9:16)
Top bar (back, logo); three stat chips (streak, total memorized, goal ring);
main feature: memorization map — grid of 604 tiny squares (~20/row), first
tenth filled deep green, few half-filled, rest pale outlines; three surah
completion bars with percentages; bottom nav, chart icon active.

### Screen 4 — Groups/Halaqah (mobile 9:16)
Top bar (back, logo); group header card (geometric emblem avatar, name label,
member-count chip); "this week together" collective card (big green number,
thin collective bar); 5 member rows (circular geometric-pattern avatars — NO
faces, nickname label, green check / gray dash for recited-today, tiny weekly
bar); gold-outlined invite-by-link button; bottom nav, group icon active.

### Screen 5 — Desktop main (16:9)
Left sidebar ~15%: logo, vertical nav icons, bottom cluster (round green mic,
difficulty dots easy/medium/precise, flame streak, thin progress bar). Right
~85%: large centered blank RESERVED panel, portrait book proportions,
hair-thin gold border, ABSOLUTELY NOTHING inside (real Quran page rendered by
software); floating side page arrows; tiny page-number chip below.


## Prompt 3 — Kimi export (single downloadable file)

Ask Kimi to deliver the whole project as quran-trainer.zip (preferred) or,
if it cannot make archives, one quran-trainer-bundle.txt concatenating all
14 files, each preceded by a marker line:
===== FILE: path/filename =====
Rules: complete runnable files, no placeholders/omissions; on length limits
say CONTINUING and resume from the exact character. The marker format lets
Claude split the bundle back into real files automatically.


## Prompt 4 — Kimi i18n catalogs (sent 2026-08-28)

Full 77-key master catalog defined by Claude (covers all five screens, mic
help, levels, planner, groups, settings). Kimi translates into 12 languages
(ar en ur id ms tr fr bn fa sw ru es), one JSON per language, zip or marker
bundle. Rules: keys unchanged, placeholders kept, Islamic terms in locally
natural form, warm non-shaming tone, ar as reference translation.
The master catalog lives in the chat prompt; on return, files go to
apps/quran-trainer/i18n/ after Claude spot-checks ar/ur/fr.
