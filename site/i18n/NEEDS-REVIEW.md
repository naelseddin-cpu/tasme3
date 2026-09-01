# i18n — translations needing native-speaker review

`app/i18n/*.json` is the source of truth (see `app/i18n/README.md`-equivalent
note in `site/build-assets.mjs`); `site/i18n/*.json` is a mechanical copy made
by `node site/build-assets.mjs`.

## WP-D additions (2026-09-01) — 52 new keys per language

Added for: level 4 (إجازة/ijazah), the surah/juz/page navigation drawer, the
tap-to-start/stop recording flow and its error states, the server/interim ASR
privacy notes, frictionless accounts (save code, WhatsApp self-send, login),
WhatsApp achievement sharing, the Husary "listen" feature, and the daily
progress panel (today/total word counts).

**Arabic (`ar`) and English (`en`)**: written directly, not machine-translated
— these are the two languages the founder and target reviewers can verify
directly; treat them as final pending normal proofreading.

**Careful manual translation, high confidence** (idiomatic phrasing checked
against the existing 78 keys' tone and register in each catalog):
- Spanish (`es`)
- French (`fr`)
- Turkish (`tr`)

**Manual translation, best-effort — please have a native speaker confirm
register/idiom before shipping** (translated key-by-key against the English
and Arabic source text, consistent with the existing catalog's terms for
"page", "surah", "streak", etc., but not verified against a live reviewer):
- Persian (`fa`)
- Urdu (`ur`)
- Indonesian (`id`)
- Malay (`ms`)
- Russian (`ru`)

**Manual translation, LOWEST confidence — please prioritize native-speaker
review of these two before shipping** (fewest available reference patterns to
check tone/register against; translations are literal and should be correct
in meaning but may read stiffly):
- Bengali (`bn`)
- Swahili (`sw`)

## WP-E additions (2026-09-01) — 9 new keys per language ("build all four")

Added for the founder's four-idea package: the PWA install-promotion card
(`install.title`, `install.iosStep1`, `install.iosStep2`, `install.button`,
`install.dismiss`) and the landscape focus-line auto/on/off toggle in the
setup sheet (`focusLine.label`, `focusLine.auto`, `focusLine.on`,
`focusLine.off`).

**Arabic (`ar`) and English (`en`)**: written directly (the Arabic
`install.title` wording is the founder's own spec text, verbatim); treat as
final pending normal proofreading.

**Manual translation, best-effort — please have a native speaker confirm
register/idiom before shipping** (translated key-by-key against the English
and Arabic source text, consistent with each catalog's existing terms for
the app name/"page"/"settings" etc., but not verified against a live
reviewer) — this batch covers every remaining catalog, so unlike WP-D's
tiers, treat ALL of the following as equally best-effort and equally in need
of a native check before shipping:
- Turkish (`tr`), French (`fr`), Spanish (`es`)
- Persian (`fa`), Urdu (`ur`), Pashto (`ps`)
- Indonesian (`id`), Malay (`ms`)
- Russian (`ru`), Bengali (`bn`)
- Swahili (`sw`), Hausa (`ha`), Somali (`so`)
- Uzbek (`uz`), Azerbaijani (`az`), Bosnian (`bs`), Albanian (`sq`)
- German (`de`), Dutch (`nl`), Portuguese (`pt`)
- Tamil (`ta`), Malayalam (`ml`)
- Chinese (`zh`)

The install card's iOS/Android copy is short and UI-label-like (2-4 words for
most keys), so mistranslation risk is lower than WP-D's longer sentences, but
the two illustrated iOS steps (`install.iosStep1`/`install.iosStep2`) in
particular should read naturally as short imperative instructions.

## Wave 3 fix (2026-09-01) — `nav.juz` (1 new key per language)

Wave-3 audit finding: the drawer's JUZ list rows built their "Juz N" label by
taking the TAB's plural string (`nav.juzs`, e.g. Arabic `الأجزاء`, "the
Juzes") and doing `.replace(/s$/, '')` on it to fake a singular. That regex
only works by accident for English-shaped strings ending in a literal `s`
(and even then guesses wrong for irregular plurals); for every other
language it either did nothing (Arabic: `الأجزاء` has no trailing `s`, so
every row read "The Juzes 1", "The Juzes 2", …) or mangled the string. Fixed
by adding a real `nav.juz` (singular) key next to the existing `nav.juzs`
(plural, still used for the tab label only) in every catalog, and
`site/app.js`'s drawer row renderer now reads `nav.juz` directly instead of
regex-mangling the plural.

**Arabic (`ar`) and English (`en`)**: correct by construction — `الجزء` and
`Juz` are the two languages' actual singular forms, not derived guesses.

**Directly derived from the existing (already-shipped) `nav.juzs` plural,
high confidence** — languages where singular is either grammatically
invariant or a simple, well-known un-suffixing of the existing plural
(German, French, Dutch, Portuguese, Indonesian, Tamil, Chinese, Somali,
Uzbek all use the same loanword for singular and plural in this catalog's
existing style; Turkish/Azerbaijani/Bosnian/Albanian/Russian/Persian/Urdu/
Pashto/Malayalam singulars are the standard grammatical un-suffixing of the
plural noun already in the catalog):
- German (`de`), French (`fr`), Dutch (`nl`), Portuguese (`pt`)
- Indonesian (`id`), Tamil (`ta`), Chinese (`zh`)
- Somali (`so`), Uzbek (`uz`)
- Turkish (`tr`), Azerbaijani (`az`), Bosnian (`bs`), Albanian (`sq`)
- Russian (`ru`), Persian (`fa`), Urdu (`ur`), Pashto (`ps`), Malayalam (`ml`)

**Best-effort, please have a native speaker confirm before shipping**
(loanword singular/plural agreement rules are less certain to this
non-native derivation):
- Malay (`ms`) — kept `Juzuk` for both; Malay classifier nouns don't
  inflect for number the way the existing plural entry's spelling implies
- Hausa (`ha`) — kept `Juzu'i` for both; unconfirmed whether the existing
  `nav.juzs` value was already meant as singular
- Swahili (`sw`) — kept `Juzuu` for both, matching the catalog's existing
  invariant-loanword pattern
- Bengali (`bn`) — kept `পারা` for both; Bengali often doesn't overtly mark
  plural on a counted noun, so this may already be correct as-is
- Spanish (`es`) — kept `Yuz` for both, matching the catalog's existing
  (already slightly unusual) choice to leave `nav.juzs` unpluralized

## How to review

1. Open `app/i18n/<lang>.json`, diff against `app/i18n/en.json` and
   `app/i18n/ar.json` for the same keys (see the key list in
   `/tmp/.../new_i18n_keys.py` used to generate this batch — or simply the
   52 keys added after the original 78 in each file for WP-D, or the last 9
   keys in each file for WP-E).
2. Fix any wording directly in `app/i18n/<lang>.json` (the source of truth).
3. Re-run `node site/build-assets.mjs` to propagate the fix into
   `site/i18n/<lang>.json`.
