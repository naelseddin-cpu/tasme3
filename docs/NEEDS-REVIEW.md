# Translations needing native-speaker review

**Date:** 2026-09-01 · **Context:** certificate-of-completion feature
(founder decision — see the git log for the "certificate" commit).

The new `cert.*` and name/greeting i18n keys added to all 12
`app/i18n/*.json` catalogs were drafted by the AI agent implementing the
feature, not sourced from a professional translator. Arabic and English are
high-confidence (Arabic is the founder's own literal wording where specced;
English is the agent's native-fluent language). **The other 10 languages —
Bengali, Spanish, Persian/Farsi, French, Indonesian, Malay, Russian, Swahili,
Turkish, Urdu — are machine/LLM-drafted and should get a native-speaker pass
before this ships to real users**, especially the longer, more idiomatic
`cert.congrats` line (a "warm words of congratulations" sentence, the kind
of text that reads most awkwardly when machine-translated).

## Keys to review, per language

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
