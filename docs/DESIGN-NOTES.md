# Design language — extracted from approved Nano Banana mockup (v2, chrome-only)

Source: founder-approved mockup (2026-08-28). The image itself is kept by the
founder; these notes capture everything needed to implement it in CSS.

## Verdict
Blank reserved mushaf panel worked: empty cream sheet, ornate gold frame, no
generated Arabic. All requested chrome elements present. Style is luxury-3D
(metallic gold body, malachite, mother-of-pearl); per the founder's "simple,
no fancy" directive we KEEP THE SOUL, FLATTEN THE BODY: same palette, layout
and identity, implemented as clean flat CSS. Mushaf page is always the visual
hero; chrome stays quiet.

## Design tokens
- --bg-page:      #f5f1e6  (ivory app background)
- --bg-chrome:    #d4b96a → flatten to soft warm gold-beige #e9dcb8 surfaces
- --mushaf-sheet: #fffdf5  (the reserved panel; real mushaf rendered inside)
- --frame-gold:   #b8a24a  (thin ornamental border of the mushaf panel)
- --accent-green: #1a5c38  (primary actions; flattened "malachite")
- --accent-green-deep: #0e3d24 (pressed/hover)
- --text-ink:     #2a2a20
- --streak-flame: #e07b2a
- Radii: outer card 24px, panel 12px, chips pill-shaped
- Shadows: soft, low-elevation only (no 3D bevels/metal gradients)

## Layout (mobile, top→bottom) — founder-corrected proportions (2026-08-28)
1. Slim top bar, ~6% of viewport height: menu, small gold calligraphic logo
   "حِفْظ", language globe, tiny page-number chip.
2. Mushaf panel, ~84% of viewport height, near edge-to-edge horizontally
   (hair-thin margins); hair-thin gold inner border only — no thick
   ornamental frame; side page-nav arrows overlaid subtly.
3. ONE compact bottom control strip, ~10% of viewport height, single row:
   settings gear · round green mic button (diameter ≤ strip height) ·
   difficulty dots (easy/medium/precise) · flame streak + count · thin
   progress line along the bottom edge.
Founder feedback driving this: the Quran page must dominate — "almost edge
to edge"; the recording controls must never exceed ~10% of the screen.

## Rules
- The generated image contributes chrome only; the mushaf panel content is the
  exact printed Madinah mushaf (KFGQPC fonts + QUL layout) rendered by code.
- Ornament: one subtle geometric motif max per screen; never behind Quran text.
- The luxury 3D rendering may be reused for marketing art, not for the app UI.

## APPROVED BUILD REFERENCE (2026-08-28, v3 output)
Two images produced; founder shared both:
1. Flat Figma-style mockup — THE build reference. Matches the corrected
   proportions: ~6% top bar (menu / small gold Quran-emblem logo / globe /
   page chip), ~84% blank cream mushaf panel near edge-to-edge with
   hair-thin gold border, ~10% single-row control strip: gear · round green
   mic (fits strip height) · difficulty dots labeled easy/medium/precise
   (active level = filled deep green) · flame streak + count · thin green
   progress line at the very bottom edge.
2. 3D luxury device render — marketing artwork only (social/landing hero);
   nothing structural taken from it.
Build the recitation screen to image 1 with the tokens above. Remaining
mockups (home, progress, groups, desktop) may follow the same v3 style.

## Home screen approved (2026-08-28, flat version = build reference)
Greeting row (sun icon + single greeting line from i18n — the mockup's doubled
"Good Day" text is an artifact, not spec); "today's plan" card with thin gold
border: review row (refresh icon + progress pill), new-memorization row (plus
icon + "5 Ayats" count chip), wide deep-green CONTINUE button; two white stat
cards: flame streak + number, gold goal ring + percent; bottom 4-tab nav with
active tab deep green with a small top indicator line (labels localized:
Recite/Progress/Groups/Settings, not book/chart/group/gear). 3D luxury
version = marketing art only.

## Kimi status: file manifest received (15 files, matches prompt structure
exactly); actual file contents still pending from the founder.

## Progress screen approved (2026-08-28, flat version = build reference)
Top: back arrow + emblem logo. Three stat chips: flame streak+n, memorized
counter, gold daily-goal ring+percent. Centerpiece: memorization map — grid
of exactly 604 rounded squares (one per mushaf page, in page order, ~16-20
per row), memorized = deep green fill, partially memorized = light green,
untouched = pale beige outline. Below: three completion bars with right-side
percentages: surah completion / juz completion / total Quran (green fill on
gold-tinted track). Mockup artifacts to correct in build: "164/108" is
nonsense — real counter shows pages (n/604) or ayat; nav tabs stay our
defined four (Recite/Progress/Groups/Settings — the map lives inside
Progress), not the mockup's HOME/PROGRESS/MAP/PROFILE. 3D jade/pearl tile
version = marketing art only.

## Groups screen approved (2026-08-28, flat version = build reference)
Top: back arrow + emblem logo. Group header card: rounded geometric emblem
avatar, group name, member-count chip. "This week together" celebratory card
(thin gold border): ONE large deep-green collective number (ayat recited this
week — mockup's "20 6030" is an artifact) + small book icon + thin collective
progress bar. Member list rows: circular geometric-pattern avatars (varied
tile patterns, NO faces), nickname, recited-today indicator (green check OR
gray dash — mockup shows all checked, real rows vary), small personal weekly
bar. Wide gold-outlined INVITE BY LINK button (flat outline style per the
flat mockup, not filled malachite). Bottom nav: People/Groups tab active with
top indicator line. 3D malachite version = marketing art only.

## Desktop screen approved (2026-08-28, flat version = build reference)
DESIGN PHASE COMPLETE — all five screens approved (recitation, home,
progress, groups, desktop). Desktop layout: left sidebar ~15% (emblem logo
top; vertical nav with icon+label, active = filled deep green; bottom
cluster: flame streak+n, round green mic, difficulty dots easy/medium/
precise, thin progress bar) ; content area: centered mushaf panel with
hair-thin gold border, side page arrows, page-number chip below. Build
corrections: enlarge the panel to dominate the content area (mockup leaves
too much empty cream; the page is the hero), and unify nav labels with
mobile (one localized set: Recite/Progress/Groups/Settings). Browser chrome
in mockups is context, not design. 3D wood/gold version = marketing art
(excellent hero image candidate).

## FOUNDER OVERRIDE (2026-08-28): PREMIUM design is the app design
The founder chose the premium/luxury Nano Banana direction for the app itself
(not the flat version): brushed-gold chrome frame on a deep-green velvet
ground, malachite (radial deep-green) mic button with gold ring, pearl-tone
chips/buttons with gold borders, double-gold-framed cream mushaf sheet,
gem-style difficulty dots, gold progress track with malachite fill.
Implemented in pure CSS (gradients, no images) in the mobile test build
(apps/quran-trainer/mobile-test-template.html) and published as the test
artifact. Earlier "flatten the body" recommendation is superseded. The
mushaf sheet interior remains exact print rendering — premium applies to
chrome only.

## Kimi delivery audit (2026-08-28) — files in apps/quran-trainer/vendor/kimi
- All 14 files delivered, runnable structure, correct transformers.js usage
  (onnx-community/whisper-base via jsdelivr), solid localStorage
  profile/streak/review scheduler (~800-line app.js).
- KEEP/MERGE: planner & profile logic, PWA manifest + service worker,
  i18n mechanism.
- DISCARD: quran-data.js (plain non-Uthmani typing text — superseded by the
  glyph-exact mushaf rendering); its matcher (ours is test-covered).
- FIX: i18n files are too thin (6 keys) — full string catalogs needed.

## FOUNDER DECISION (2026-08-28): image-based page rendering
The mushaf page is delivered as an IMAGE of the printed page; words are
hidden by page-colored layers ("white layers") lifted one by one on correct
recitation. Pipeline: pages rendered from the official KFGQPC page fonts at
2x (tools flow in scratchpad render_pages.mjs — to be committed), word
bounding boxes captured in the same render (image and coordinates can never
disagree), veils positioned as % of image size (responsive). Engine cannot
write text — it only lifts veils. This engine works with ANY page image +
box data, so licensed scans (e.g. the colored tajweed print) can be swapped
in later unchanged. Deployed to naelseddin-cpu.github.io/hifz-test.

## Kimi i18n delivery (2026-08-28): ACCEPTED
12 languages × 78 keys, identical key sets, zero placeholder errors, correct
Islamic greetings/terms, fluent ar/ur/fr on spot-check. Committed to
apps/quran-trainer/i18n/. Native-speaker review still recommended pre-launch.
