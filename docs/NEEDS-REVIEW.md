# Translations needing native-speaker review

**Date:** 2026-09-01 · **Context:** wave-1 critical/UX/accessibility fixes
(10-auditor review -- edge-swipe back-navigation trap, modal/drawer a11y
semantics, screen-reader announcements, elderly-usability affordances).
Six new keys were added to all 25 `app/i18n/*.json` catalogs:

- `nav.showBar` — aria-label for the new persistent chrome-affordance handle
  shown whenever the top bar auto-hides.
- `nav.fullscreenEnter` / `nav.fullscreenExit` — the ⛶ button's aria-label
  now toggles between these instead of a single static "fullscreen" string.
- `nav.invalidPage` — toast shown for a go-to-page value that is malformed,
  out of range, zero, or negative (an accidental "-5" is now rejected rather
  than silently treated as page 5); `nav.frontPagesInProgress` continues to
  cover the in-range-but-not-yet-available pages 1-2.
- `hint.firstRun` — the one-time onboarding hint pointing at the microphone
  on first launch. Arabic is the founder's own literal wording (from the
  task spec, adapted from the existing `recite.instruction` string); English
  is a matching native-fluent translation.
- `a11y.wordsRevealed` — spoken by the screen-reader-only `#status` live
  region after each reveal batch, e.g. "{n} words revealed".

Arabic and English are high-confidence (founder-specified / native-fluent).
**All 23 other languages are machine/LLM-drafted for these six keys and
should get a native-speaker pass before shipping**, same as every other
non-Arabic/English catalog on this page.

**Date:** 2026-09-01 · **Context:** minimal-UI redesign (founder decision --
"it is not showing the Surah name; all info in the buttons can come out and
be in a pop window for setup"). Two new keys were added to all 25
`app/i18n/*.json` catalogs and should get the same native-speaker pass as
everything else on this page:

- `chip.surahPage` — the always-visible top-bar chip template, e.g. Arabic
  `"سورة {surah} · {page}"`. `{surah}` is always the Arabic surah name (never
  translated, per the existing convention below) and `{page}` is the page
  number in the UI language's own digits; only the surrounding word for
  "Surah" and its word order are language-specific. Arabic and English are
  high-confidence (founder/native-fluent, matching the rest of this doc); all
  23 other languages are machine-drafted, including the word order chosen for
  languages where "Surah" more naturally follows the name than precedes it
  (Turkish `"{surah} Suresi"`, Uzbek `"{surah} surasi"`, Azerbaijani `"{surah}
  surəsi"`) — a native speaker should confirm both the word choice and that
  placement.
- `progress.pageProgress` — short label ("Page progress") for the word
  counter now inside the setup sheet. Low risk, same machine-drafted status
  as other short UI strings on this page.

**Date:** 2026-09-01 · **Context:** certificate-of-completion feature
(founder decision — see the git log for the "certificate" commit); updated
the same day for the 12 → 25 language expansion (also a founder decision).

The new `cert.*` and name/greeting i18n keys added to all 12 original
`app/i18n/*.json` catalogs were drafted by the AI agent implementing the
feature, not sourced from a professional translator. Arabic and English are
high-confidence (Arabic is the founder's own literal wording where specced;
English is the agent's native-fluent language). **The other 10 languages —
Bengali, Spanish, Persian/Farsi, French, Indonesian, Malay, Russian, Swahili,
Turkish, Urdu — are machine/LLM-drafted and should get a native-speaker pass
before this ships to real users**, especially the longer, more idiomatic
`cert.congrats` line (a "warm words of congratulations" sentence, the kind
of text that reads most awkwardly when machine-translated).

## New languages added in the 12 → 25 expansion

Thirteen entirely new catalogs were added: Hausa (`ha`), Pashto (`ps`),
Somali (`so`), Uzbek (`uz`), Azerbaijani (`az`), Bosnian (`bs`), Albanian
(`sq`), German (`de`), Dutch (`nl`), Portuguese (`pt`), Tamil (`ta`),
Malayalam (`ml`), and Chinese Simplified (`zh`). **Every key in all 13 of
these catalogs is machine/LLM-drafted end-to-end (not only the certificate
keys) and should get a native-speaker pass before shipping to real users** —
this is a full-catalog review, broader in scope than the certificate-keys-only
review documented below for the original 10 languages.

**Highest priority for native review** — the languages the agent has least
confidence in, and whose communities are most likely to notice awkward
phrasing quickly: **Hausa (`ha`), Somali (`so`), Pashto (`ps`), Uzbek (`uz`),
and Azerbaijani (`az`)**. Within these, `app.tagline`, `cert.congrats`,
`share.pageDone`, and `share.streakMilestone` are the longest and most
idiomatic lines and the likeliest to read stiffly.

Lower (but still unverified) priority: Bosnian (`bs`) and Albanian (`sq`) —
less-resourced languages than mainstream European ones; German (`de`), Dutch
(`nl`), Portuguese (`pt`) — well-resourced languages with comparatively
higher machine-translation confidence, but still never reviewed by a native
speaker; Tamil (`ta`), Malayalam (`ml`), and Chinese Simplified (`zh`) — a
native reader should confirm register and any transliteration choices
(reciter names and Islamic terms rendered phonetically in-script).

Note on `ps` (Pashto) `app.name`: per the founder's brand spec for this
language it is the Arabic form in guillemets, `«تسميع»`, rather than the
Latin+Arabic pairing used for Latin/Cyrillic-script languages — please
confirm this presentation reads naturally to a Pashto speaker.

## Keys to review, per language (certificate/greeting feature, original 10)

For each of `bn, es, fa, fr, id, ms, ru, sw, tr, ur`:

- `cert.title` — short, low risk ("Certificate of Completion" equivalent).
- `cert.congrats` — **highest priority for review.** A warm congratulatory
  sentence referencing Allah's grace; tone and register matter here more
  than literal accuracy.
- `cert.completedSurah` — short, templated with `{surah}` (the surah name
  itself is never translated — always Arabic from `surah-index.json`).
- `account.namePrompt`, `account.namePlaceholder`, `account.nameSkip` — very
  short UI strings, lower risk but still worth a glance.
- `greeting.hello` — short, templated with `{name}`.
- `cert.panelTitle`, `cert.empty`, `cert.viewButton`, `cert.share`,
  `cert.download` — short UI strings, lower risk.

## Where they live

All in `app/i18n/<lang>.json` (and mechanically copied into
`site/i18n/<lang>.json` by `node site/build-assets.mjs` — edit the
`app/i18n/` source, then re-run that script, never hand-edit `site/i18n/`
directly).

## Not flagged

- `ar` (Arabic) — the founder's own literal specced wording for
  `cert.congrats`/`cert.completedSurah`/the basmala; not machine-translated.
- `en` (English) — native-fluent, high confidence.
- The basmala itself — never translated in any language; extracted
  mechanically from `app/mushaf/pages/page-001.json` by
  `site/build-assets.mjs`'s `generateBasmala()`, not hand-typed anywhere.
- Surah names — always the Arabic string from `site/surah-index.json`,
  in every language, by design (existing app convention).
