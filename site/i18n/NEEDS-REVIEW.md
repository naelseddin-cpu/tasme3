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

## How to review

1. Open `app/i18n/<lang>.json`, diff against `app/i18n/en.json` and
   `app/i18n/ar.json` for the same keys (see the key list in
   `/tmp/.../new_i18n_keys.py` used to generate this batch — or simply the
   52 keys added after the original 78 in each file).
2. Fix any wording directly in `app/i18n/<lang>.json` (the source of truth).
3. Re-run `node site/build-assets.mjs` to propagate the fix into
   `site/i18n/<lang>.json`.
