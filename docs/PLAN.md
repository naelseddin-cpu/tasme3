# Quran Memorization Trainer — Product & Technical Plan

**Status:** Assessment / planning document (no code yet)
**Date:** 2026-08-27

**Nature of the project:** Free charity (sadaqah jariyah). No monetization, ever.
The founder contributes development (with Claude) and pays the server fees.
Consequences for the design:
- **Minimal server cost is a first-class requirement.** Speech recognition runs
  on the user's own device (whisper.cpp / WASM / WebGPU); the server stores only
  accounts, progress, and schedules. A small VPS ($10–40/month) should serve
  thousands of users. No audio is uploaded by default → privacy by design and
  offline mode for free.
- **The code should be open source** (MIT/Apache) to attract volunteer
  developers, hafiz reviewers, and translators, and so the project can outlive
  any single server or maintainer.
- Market/competition risk is irrelevant; existing apps (Tarteel) are treated as
  an ecosystem resource (their open models/data), not competition.
- **Browser-only, permanently (founder decision).** This will never be a native
  app: no app stores, no fees or review gatekeeping, instant updates, one
  codebase. Delivered as a PWA — installable to the home screen, offline after
  first visit (service worker caches the app, mushaf fonts, and model file).
  ASR runs in-browser via WASM/WebGPU (transformers.js / whisper.cpp). Design
  constraints this imposes: a clear first-load "downloading engine" progress
  screen (model files are 40–150 MB, cached afterwards), and early testing on
  iOS Safari — the weakest target — to pick the smallest model tier that runs
  well there.
- **Accessible from anywhere with zero friction.** One URL, any device with a
  browser. The app, mushaf fonts, Quran text, and model file are all static
  assets, so they are served from a free global CDN (e.g. Cloudflare Pages) —
  fast on every continent, no cost to the founder. The paid server carries only
  the small accounts/progress API and database.
- **Community-built around groups (founder decision).** Users can create groups
  (halaqat) — family, friends, a mosque or school class — joinable by link or
  code, and share results. Design principles: an optional group leader
  (teacher/muhaffiz) can set the group plan and see member progress in detail;
  sharing is framed as collective encouragement ("the group completed 240 ayat
  this week"), not competitive ranking; per-person accuracy detail is visible
  only to the member and the leader; group membership is opt-in with nickname
  support (children), and only word-progress counts are ever shared — never
  audio. Groups are lightweight database rows, so server cost is unchanged.
  Community is also the growth engine: each teacher brings a class, each family
  brings itself.
- **Multilingual interface, as many languages as possible (founder decision).**
  The Quran text itself is always Arabic, untouched; only UI strings (small,
  ~100–200 phrases) are translated via one JSON file per language, with
  auto-detection from the browser plus a language switcher, and full RTL/LTR
  support. Priority order by memorizer population: ar, en, ur, id/ms, tr, fr,
  bn, fa, ha/sw, ru, es — then community volunteers add further languages
  (each translation file is a trivially reviewable open-source contribution).
  Claude drafts all initial translations; native speakers verify.
- **The Quran pages are the exact printed mushaf, unchanged (founder decision).**
  The real Madinah mushaf page layout — all 604 pages, 15 lines per page, the
  same words on the same lines, same page numbers — rendered with the official
  KFGQPC page fonts and the QUL layout database. Never an imitation or
  redesign; the only difference from print is that unrecited words are veiled
  until spoken correctly. AI-generated design (Nano Banana) applies ONLY to
  the web chrome around the page (frame, buttons, menus, progress screens);
  nothing image-generated ever touches the Quran text or page layout.

## 1. Vision (as requested)

A software that helps people memorize the Holy Quran:

- The user recites in Arabic; the app listens and compares the speech to the Quran text.
- When a word is recited correctly, it appears on screen **exactly as printed in the mushaf page layout**; wrong or missed words stay hidden so the user knows to retry.
- Every user has a profile, a daily memorization target, and an automatically planned training schedule (new memorization + review).
- Official reciter (qari) recordings are available for listen-and-repeat.
- The system improves as more users use it — approaching a "personal human trainer".

## 2. Key architectural decision (read this first)

**Do NOT build/train a speech engine from scratch on qari MP3 libraries.**

Two reasons:

1. **The target text is always known.** This is not open dictation — it is *forced alignment / constrained decoding*: "is the user saying word N of this known ayah?" Constraining the recognizer to the expected text raises accuracy dramatically, especially for accented, non-native speakers.
2. **Professional qari audio is the wrong training data for our users.** Our users sound like hesitant beginners with accents — not like Al-Husary. Open models fine-tuned on Quran recitation already exist (see Resources). Qari libraries should power the *playback / listen-and-repeat* feature (word-timestamp data for dozens of reciters is already published openly by QUL), not model training. Later fine-tuning should use **consented recordings of real users**, which is what actually makes the engine better at accents.

This decision converts a multi-year ML research project into a ~6-month achievable product.

## 3. Plan — phases

### Phase 1 — MVP (2–3 months)
- Hafs riwayah only.
- True mushaf page rendering: KFGQPC page fonts + QUL page-layout database (604 pages, word positions).
- ASR: open Quran-fine-tuned Whisper (e.g. `tarteel-ai/whisper-base-ar-quran`) in constrained mode; streaming word-by-word match; matched word revealed, unmatched stays hidden.
- Browser-based PWA (the only delivery target — see above), simple session flow: pick surah/page → recite → reveal.

### Phase 2 — Profiles, planner & groups (2–3 months)
- Accounts, per-user daily target (e.g. N lines/ayat per day).
- Spaced-repetition scheduler: automatic mix of new memorization + review of previously memorized portions (review is where memorization actually sticks).
- Progress dashboard: memorized map of the mushaf, streaks, weak-word list.
- Groups (halaqat): create/join by link or code, optional leader role with group
  plan and detailed member view, weekly collective summaries shared to members
  (encouragement framing, no competitive ranking; per-person detail private to
  the member and leader).

### Phase 3 — Accent adaptation (2–3 months)
- Per-user strictness calibration (initial calibration recitation).
- Confidence thresholds + phonetic-distance fallback for near-misses.
- Consented collection of misrecognized clips → labeled review queue → periodic fine-tuning dataset.

### Phase 4 — Multi-qari & qira'at (2–3 months)
- Listen-and-repeat mode using official reciter audio with existing word-level timestamps (QUL) — highlight-follow-along, echo mode.
- Additional riwayat (Warsh, Qalun…) using open qira'at text databases; recognizer constrained per-riwayah.

### Phase 5 — Learning flywheel (ongoing)
- Fine-tune cycles on accumulated consented user audio; optional per-accent-region model variants.
- On-device inference (whisper.cpp, tiny/base models) → offline mode + zero server cost per recitation.
- Institutional mode: teacher dashboards, class targets, parent reports (differentiator vs consumer apps).

## 4. Risks (ranked)

1. **False accept** (app says "correct" for a wrong recitation) — religiously and reputationally the worst failure. Mitigate: strict thresholds, show full tashkeel, never claim tajweed certification in v1, hafiz review of the matching rules.
2. **False reject** (correct but accented users get rejected) — the #1 UX killer, causes churn. Mitigate: per-user leniency, word-level (not phoneme-level) matching first, encouraging retry UX.
3. **Privacy & minors** — voice recordings, many users are children. Consent flows, data retention policy, opt-in only for training data, from day one.
4. **Sustainability** — a charity project lives on the founder's time and server budget. Mitigate: on-device ASR keeps the server bill at VPS level; open-sourcing the code lets volunteers share the load and anyone re-host it.
5. **Serving cost** — real-time server ASR is expensive. Solved architecturally: recognition runs on-device; the server never processes audio. GPUs are rented only for occasional fine-tuning rounds.

## 5. Resources

**Open data & models (all free):**
- Tanzil.net — verified Uthmani Quran text.
- QUL (qul.tarteel.ai) — mushaf page layouts, word-by-word data, reciter audio with word-level timestamps.
- KFGQPC (King Fahd Complex) mushaf fonts — per-page glyph fonts for exact printed rendering.
- Hugging Face: `tarteel-ai/whisper-base-ar-quran`, EveryAyah dataset, various wav2vec2 Quran models.
- whisper.cpp / faster-whisper for on-device & efficient server inference.

**Team (minimum viable):** 1 ML engineer, 1–2 app developers, 1 hafiz/Quran expert as validator (non-negotiable), part-time designer.

**Budget (rough):** MVP infra & tooling $5–15k; each fine-tuning round $500–2,000 in rented GPU time; main cost is people, not compute — because the base models already exist.

## 6. Challenges → solutions

| Challenge | Solution |
|---|---|
| Heavy accents / non-native speakers | Constrained decoding vs known text; per-user calibration; fine-tune on real user audio over time |
| Exact printed-page display | QUL layout DB + KFGQPC fonts; reveal word-by-word in true page position |
| Different qira'at wordings | Open qira'at text databases; recognizer constrained per riwayah; qari audio for playback only |
| Accept/reject judgment | Confidence score + phonetic distance, applied through the user-chosen difficulty level (below); never silent auto-pass |
| Frustration / quitting | **User-customizable difficulty levels (founder decision):** the strictness dial belongs to the user, like teaching a child — start easy to build confidence, raise the level as they grow. Levels: 1 مبتدئ Beginner (very forgiving, celebratory — children/first-timers), 2 متوسط Intermediate (default — clearly right word, small accent slips tolerated), 3 متقن Precise (strict word matching — preparing to recite before a teacher), 4 إجازة Mastery (later phase, strictest). Safeguards: the app gently suggests moving up after sustained high scores, and progress records the level it was earned at, so ease never becomes self-deception |
| "Personal trainer" feel | Spaced-repetition planner + per-user weakness map (words/ayat repeatedly missed) |
| Tajweed correction | Out of scope for v1–v3; research-grade problem; revisit after word-level accuracy is proven |

## 7. Honest success estimates

| Goal | Probability |
|---|---|
| Word-by-word tracking works for clear speech | ~95% (proven technology) |
| Good accuracy for heavy accents at MVP | ~70%, → 85–90% after 2–3 fine-tune cycles on real user data |
| Useful MVP shipped in ~6 months using open models | ~80% |
| Same MVP if training own engine from qari MP3s instead | ~20% (do not do this) |
| Full "human trainer" vision incl. tajweed correction | ~35–40% over 2–3 years |
| Charity success (a free app people genuinely memorize with) | ~85% — market risk does not apply; the technology is proven and the goal is usefulness, not revenue |
| Institutional adoption (Quran schools, mosques) as free tooling | ~60%+ with teacher/class features |

## 8. Recommended next step

Build a 2-week proof of concept: one surah (e.g. Al-Fatiha + short surahs), browser mic → Quran-tuned Whisper (constrained) → word-reveal on a true mushaf-rendered page. This de-risks the two hardest claims (accent tolerance, exact page rendering) before any further investment.

## Mushaf source decision (2026-08-28)

Founder provided the reference print: **مصحف التجويد الملون** (color-coded
Tajweed mushaf, Dar Al-Ma'rifah style; 201 MB PDF on the founder's Drive),
front/back explanatory pages to be trimmed — only the 604 Quran pages count.

Assessment:
- The tajweed COLOR-CODING of that print is the publisher's intellectual
  property; publishing scans of it on a public site needs their permission
  (the Quran text itself is free). Options: request a charity license from
  the publisher, or rebuild the identical result from open sources.
- Recommended path: render the same 604 Madinah-layout pages with the freely
  licensed KFGQPC fonts + QUL layout data, and apply tajweed coloring from
  open-licensed tajweed-rule data — same pages, same colors, fully legal.
- The founder's PDF serves as VISUAL GROUND TRUTH: rendered pages are
  verified against it page-by-page.
- Technical bonus of the font path: every word is a live element (word-reveal
  plugs in directly, no pixel masks over scans), pages are sharp at any size,
  and the full mushaf ships in a few MB instead of ~200 MB.

## Hosting decision (2026-08-28)
Founder: sandbox/viewer mic friction is a serious user obstacle — real testing
requires proper hosting. Immediate: GitHub Pages on public repo
naelseddin-cpu/hifz-test (founder creates empty repo; Claude pushes the deploy
bundle in apps/quran-trainer/deploy-test/ — workflow auto-enables Pages).
There the REAL on-device Whisper engine is testable (model download allowed on
a normal origin). Long-term production: own domain on a global CDN
(e.g. Cloudflare Pages) per the plan's zero-cost static architecture.
