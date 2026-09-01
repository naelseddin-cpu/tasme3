# Audio Sources — Listen/Reference Feature (al-Husary)

**Date:** 2026-09-01 · **Status:** research spec, no client code changed.
**Requested by:** founder — optional "listen to the ayah I'm memorizing" reference
audio, reciter **Sheikh Mahmoud Khalil al-Husary**, for weak-internet/old-phone
users → must stream small per-ayah files on demand, **never** a bulk download.

---

## 0. IMPORTANT — network verification was blocked in this sandbox

Task instructions asked for live HTTP HEAD/GET verification (status, content-type,
file size, CORS headers) of every candidate source. I attempted this from the
sandboxed research session and **every Quran-audio-related domain was rejected by
the outbound proxy's egress policy** (`403`, `connect_rejected` — organization
policy, not a site-side failure). This is not something to route around; per the
proxy's own guidance it must be reported, not retried.

### Exact results of the domains tested

| Domain | Result | Detail |
|---|---|---|
| `everyayah.com` | **BLOCKED** | `CONNECT tunnel failed, response 403` — proxy log: `connect_rejected`, "gateway answered 403 to CONNECT (policy denial or upstream failure)" |
| `api.quran.com` | **BLOCKED** | same (403 connect_rejected) |
| `quran.com` | **BLOCKED** | same |
| `audio.qurancdn.com` | **BLOCKED** | same |
| `verses.quran.com` (untested directly, same host class) | assumed BLOCKED | not independently tested after pattern was clear |
| `qul.tarteel.ai` | **BLOCKED** | same |
| `mp3quran.net` | **BLOCKED** | same |
| `static.qurancdn.com` | **BLOCKED** | same |
| `download.quranicaudio.com` | **BLOCKED** | same |
| `cdn.islamic.network` / `api.alquran.cloud` (extra candidates I tried) | not reached — probe stopped by session's own command-classifier before result returned | |
| `cdn.jsdelivr.net`, `cdnjs.cloudflare.com`, `httpbin.org`, `google.com`, `archive.org`, `en.wikipedia.org` | **BLOCKED** | same 403 pattern — confirms this is a narrow allowlist, not a Quran-specific block |
| `api.github.com`, `raw.githubusercontent.com`, `fonts.googleapis.com` | reachable | but GitHub API calls are further restricted to *this session's own attached repos* — general code/repo search ("find a GitHub mirror of everyayah's file-size manifest") returned `403 sessions are bound to their configured repositories` |
| `add_repo` for an unrelated public repo (tried `risan/quran-audio` as a possible pre-built URL/size manifest) | **BLOCKED** | "cross-tier adds are not supported... session already has repos from owner(s) [naelseddin-cpu]" |

**Net effect:** this session has no path to the open internet beyond GitHub (scoped
to already-attached repos), npm/PyPI package registries, and Google Fonts. None of
the three candidate audio sources — everyayah.com, quran.com/QuranCDN, qul.tarteel.ai
— nor any generic fallback (jsDelivr, a plain GET to a news site) could be reached.

**What this means for the rest of this document:** the URL patterns, bitrates,
file-size estimates, CORS behavior, and license notes below are **documented from
established, publicly-known specifications of these services, not measured live in
this session.** Every such claim is marked `[UNVERIFIED]`. **Before shipping,
re-run the verification commands in §4 from an environment with normal internet
access** (a developer laptop, the founder's VPS, or a future session whose proxy
allowlists these domains) and paste the real output into this doc, replacing the
`[UNVERIFIED]` markers.

---

## 1. Candidate sources

### 1a. everyayah.com — per-ayah static MP3 files `[UNVERIFIED — see §0]`

- **URL pattern:** `https://everyayah.com/data/{reciter_dir}/{SSS}{AAA}.mp3`
  where `SSS` = surah number zero-padded to 3 digits, `AAA` = ayah number
  zero-padded to 3 digits (e.g. `001001.mp3` = 1:1, `002282.mp3` = 2:282).
  This scheme is long-standing and widely mirrored/documented across Quran
  developer tooling; it is the most stable, low-risk part of this whole
  research because it requires no API call, just string formatting from the
  `surah:ayah` we already have.
- **Husary directories** documented on the site (folder names must be
  reconfirmed against the live `/data/` listing, which I could not fetch):
  - `Husary_64kbps` — standard murattal (measured recitation), 64 kbps.
  - `Husary_128kbps` — same recitation, higher bitrate.
  - `Husary_Muallim_128kbps` — the **مصحف المعلم** teaching recitation: al-Husary
    recites each ayah, pauses, then repeats it — exactly the "beginner mode"
    the founder is describing. This is the standout reason to use al-Husary
    specifically; very few reciters have a Muallim edition at this quality.
  - (Possibly also a `Husary_Mujawwad_64kbps` — a separate, ornamented style,
    slower and heavier per file; lower priority for a memorization app.)
- **Bulk downloads:** the site also offers per-reciter ZIP archives (whole
  Quran) for offline use — **do not use these client-side** (violates the
  "never bulk download" constraint), but this is exactly the mechanism to use
  **server-side once**, if we choose to self-host (§3).
- **File size estimate (arithmetic, not measured):** MP3 size ≈ bitrate ×
  duration. At Husary's murattal pace:
  - 1:1 (بسم الله الرحمن الرحيم، ~4–5 s) → 64 kbps ≈ **32–40 KB**; 128 kbps ≈ **64–80 KB**.
  - 2:282 (the longest ayah in the Quran, ~60–90 s at a measured pace) →
    64 kbps ≈ **480–720 KB**; 128 kbps ≈ **~1–1.4 MB**.
  These are back-of-envelope, not measured — re-run §4's `curl -I` /
  `curl -o file -w '%{size_download}'` once the domain is reachable.
- **CORS:** everyayah.com is a plain Apache static file server; it is **widely
  reported not to send `Access-Control-Allow-Origin`**. This matters only if
  the client does a `fetch()`/`XMLHttpRequest` to the file (e.g. to cache it
  in a Service Worker or feed it to the Web Audio API) — it does **not** block
  a plain `<audio src="https://everyayah.com/...">` element from playing
  cross-origin (media elements are exempt from CORS for playback-only use).
  `[UNVERIFIED]` — confirm with `curl -I` and check `Access-Control-Allow-Origin`.
- **License/terms:** no formal machine-readable license; the site has operated
  for close to two decades as a free aggregator of reciter recordings for
  Islamic educational/non-commercial redistribution, and is one of the most
  widely embedded sources in the Quran-app developer ecosystem (it is the de
  facto dataset behind many open per-ayah audio tools). No explicit written
  permission was obtained for this project — recommend the founder send a
  short attribution/permission email before production launch, and always
  display "Recitation: Sheikh Mahmoud Khalil al-Husary — audio courtesy of
  everyayah.com" (or the actual final host) in the UI.
- **Reliability impression (reputation, not measured):** single-operator,
  volunteer-run infrastructure, no real CDN — historically usable but not
  enterprise-grade; occasional slowness/downtime reported anecdotally in the
  developer community. This is the main argument for self-hosting (§3) rather
  than depending on it live for weak-connectivity end users.

### 1b. quran.com / QuranCDN API `[UNVERIFIED — see §0]`

- **Reciter discovery:** `GET https://api.quran.com/api/v4/resources/recitations`
  lists reciters with numeric `id`s and style (Murattal/Mujawwad/Muallim).
  al-Husary's Murattal recitation is commonly documented (in prior public API
  responses/community references) as **reciter id ≈ 5** — this must be
  reconfirmed by actually calling the endpoint; do not hardcode an
  unconfirmed ID into the app.
- **Per-ayah audio:** `GET /api/v4/recitations/{id}/by_ayah/{surah}:{ayah}`
  returns an `audio_files[]` entry with a relative `url` (e.g.
  `Husary/mp3/001001.mp3`), resolved against a CDN base that has moved over
  the service's history — currently understood to be `audio.qurancdn.com`
  (older integrations used `verses.quran.com`). **Both hostnames were
  proxy-blocked in this session**, so the current authoritative base must be
  re-confirmed from the live API response's `url`/base fields, not assumed.
- **Bitrate:** typically served at 128 kbps only (no low-bitrate tier
  documented for most reciters) — worse fit than everyayah for "weak
  internet, old phone" unless a lower-bitrate variant is confirmed to exist.
- **CORS:** quran.com publishes `api-docs.quran.com` explicitly inviting
  third-party frontend integration, so its API and CDN are commonly assumed
  to send permissive `Access-Control-Allow-Origin: *`. `[UNVERIFIED]` —
  this is the single most important thing to confirm live, since it decides
  whether this source can be fetch()'d for caching/Web Audio use, not just
  played.
- **License/terms:** quran.com's API has a published terms-of-service page
  (`api-docs.quran.com` → Terms) that historically requires attribution and
  restricts some commercial redistribution/resale of the audio — read the
  actual current terms before shipping, don't assume.
- **Reliability impression:** backed by a real product team and (per public
  architecture discussion) fronted by a CDN/Cloudflare — expected to be more
  reliable than a single-operator static host, but this is reputation, not a
  measurement made in this session.

### 1c. QUL (qul.tarteel.ai) — downloadable archives with word timestamps `[UNVERIFIED — see §0]`

- QUL publishes **downloadable** (not streaming-API) resource packages:
  mushaf layouts, word-by-word morphology, and — most relevant here —
  **recitation audio bundled with word-level timestamp segment data**
  (start/end time per word within each ayah's audio file) for a curated set
  of reciters. The paused, per-word-clear **Husary Muallim** recitation is
  exactly the kind of recording that this style of dataset is built from
  (segmentation is far easier on a teaching recitation with natural pauses),
  which makes it plausible Husary Muallim is one of the datasets included —
  but this must be confirmed on the live downloads page; I cannot assume it.
- **How it's meant to be used:** QUL is explicitly a *dataset distribution*
  site, not a per-ayah streaming CDN — you download the archive once (server
  side, not from the end user's phone), then serve slices from your own
  infrastructure. This fits the "self-host" path in §3, and — importantly —
  is the raw material for the **future word-level follow-along highlighting**
  feature the founder is interested in (matching what `PLAN.md` §5 already
  names as a Phase-4 idea: "Listen-and-repeat mode using official reciter
  audio with existing word-level timestamps (QUL)").
- **License:** QUL requires a free account to download, and states a license
  per individual resource (some public-domain, some CC-BY-style, some with an
  attribution requirement) — **read the specific license shown on whichever
  Husary package is chosen**, it is not one blanket site-wide license.
- **Recommendation on QUL specifically:** treat it as the source for the
  *word-timestamp* data needed for a later highlighting feature, not as the
  answer to "where do we stream today's per-ayah listen audio from." For the
  MVP listen feature, everyayah/quran.com per-ayah files are simpler and
  sufficient.

---

## 2. Recommendation

**Primary:** self-host a Husary **64 kbps murattal** per-ayah set (§3) on the
same free static-asset CDN already used for the 604 mushaf page images
(per `BUILD-PLAN.md`'s architecture). This removes the CORS question entirely
(same-origin, or a CDN we control that we explicitly configure with
`Access-Control-Allow-Origin: *`), removes dependency on either third party's
uptime for a "weak internet" audience where every extra failure point hurts,
and gives full control over compression to keep files as small as possible
(64 kbps mono is likely enough for spoken-word recitation; even a modest
further re-encode is worth testing).

**Fallback #1 (if self-hosting isn't ready for launch, or for the Muallim set
if self-hosting is deferred):** everyayah.com direct URLs (§1a) — no API
round-trip needed, one predictable `{surah}{ayah}.mp3` pattern, and it is the
only `[UNVERIFIED]`-but-documented source with a genuine Muallim (teaching)
edition, which directly answers the founder's "beginner mode" interest.

**Fallback #2:** quran.com/QuranCDN per-ayah API (§1b) — better-resourced
infrastructure, but adds an API round-trip (reciter-id lookup, then per-ayah
lookup) before the audio URL is even known, unless the URL pattern turns out
to be as predictable as everyayah's once confirmed live.

**Self-hosting size (why it's affordable):** the whole Quran is ~6,236 ayat.
At Husary's murattal pace the full recitation runs roughly 10–11 hours.
Arithmetic estimate (not measured): 64 kbps × ~10.5 h ≈ **~300 MB** for the
complete per-ayah set; community-cited full-Quran 64 kbps zip sizes for
this reciter are commonly in the low-to-mid hundreds of MB, consistent with
this math. That is on the same order as the ~30 MB of already-committed QCF
fonts plus 604 page images, i.e. entirely affordable for a free static
host/CDN, and dramatically smaller than any bulk-download-to-device model
(which is explicitly ruled out anyway — the client only ever fetches the one
ayah in view). A Muallim set would be somewhat larger per ayah (pause +
repeat) but is still a low-hundreds-of-MB one-time server-side asset, not
something any user's phone ever bulk-downloads.

**Practical hosting mechanism for self-hosted files:** rather than the
founder's own VPS bandwidth (real cost, and a single-region single point of
failure for a global weak-connectivity audience), commit the per-ayah MP3s to
a public GitHub repo (or GitHub Release assets, to avoid bloating a
git-cloned working tree with thousands of small binary files) and serve them
through **jsDelivr** (`cdn.jsdelivr.net/gh/<owner>/<repo>@<tag>/...`) — free,
globally cached, and jsDelivr sends `Access-Control-Allow-Origin: *` by
default, which sidesteps the CORS uncertainty on both third-party sources
entirely. This mirrors the project's existing "static assets are free"
principle (`BUILD-PLAN.md` Architecture section) and keeps the same
separation already planned for page images: **audio assets live in the
static-hosting repo, not the ArabiaERP monorepo.**

---

## 3. Integration spec (spec only — no client code changed)

### 3.1 Mapping the current position to an ayah key

Confirmed directly from a real page JSON in this repo
(`apps/quran-trainer/mushaf/pages/page-001.json` and `page-596.json`): each
word token in a page's `lines[].tk[]` array carries a key field

```json
{"g":"ﭑ","k":"1:1","w":"بِسۡمِ","n":"بسم"}
```

`k` is **`"{surah}:{ayah}"`** (e.g. `"1:1"`, `"92:15"`) — **not**
`surah:ayah:word` as the task brief speculated. There is no separate word
index in `k`; word order within an ayah is simply token order in the `tk[]`
array, and ayah-end tokens carry `"e":1` instead of a `w`/`n` pair. This is
exactly what's needed: whatever word/token the trainer's existing
word-reveal pointer currently sits on already carries the `k` string, so:

```js
// pseudocode — spec only
function ayahKeyForCurrentPointer(token) {
  const [surah, ayah] = token.k.split(':').map(Number);
  return { surah, ayah };
}

function ayahAudioPath(surah, ayah) {
  const s = String(surah).padStart(3, '0');
  const a = String(ayah).padStart(3, '0');
  return `${s}${a}.mp3`; // e.g. "001001.mp3", "002282.mp3"
}
```

### 3.2 Playback

- A single, reused `<audio>` element (not one per ayah/word) owned by the
  trainer's existing audio/recording lifecycle code (`processAudio`/mic
  handling already exists in `apps/quran-trainer/vendor/kimi/app.js` and the
  root client — the listen feature should live alongside that, not duplicate
  its own audio-context management).
- **"Listen" toggle button** near the existing record button: tapping it
  resolves the *current* ayah's `k`, builds the URL for the configured
  primary source (self-hosted → everyayah → quran.com, per §2's fallback
  order), sets `audio.src`, and calls `.play()`. Tapping again pauses.
- **On-demand only, no prefetch:** per the "never bulk download" constraint,
  the client must fetch **only** the single ayah currently in view, and only
  when the user actively taps Listen — never prefetch the next ayah, the rest
  of the page, or the surah, even speculatively. This is a stricter rule than
  typical "prefetch the next item" UX patterns and should be called out in
  code review for this feature.
- **Fallback chain on failure:** if the primary source's request errors or
  times out (`audio.onerror`), the client retries once against the next
  source in the configured order before showing a small non-blocking
  "audio unavailable" indicator — the listen feature must never block or
  degrade the core recitation-practice flow (same fallback philosophy
  `BUILD-PLAN.md` already applies to the ASR server being unreachable).
- **Repeat-ayah mode:** a simple toggle setting `audio.loop = true`, or a
  "repeat" icon that re-triggers `.play()` from `currentTime = 0` on
  `ended` — useful for the drilling/repetition workflow of memorization.
  Persist the toggle in the same versioned localStorage settings object
  already used for progress (per Phase 3's schema-validated storage work),
  not a separate ad hoc key.
- **Muallim (beginner) mode:** a second reciter-set selector — Murattal
  (default) vs Muallim (paused teaching style) — changes only which
  directory/reciter-id prefix is used to build the URL; everything else in
  §3.1/§3.2 is identical. Natural to default Muallim on for difficulty
  levels L1/L2 (مبتدئ/متوسط) and Murattal for L3/L4, matching the existing
  difficulty-level framework in `BUILD-PLAN.md`, though this should remain a
  user-visible, user-overridable setting rather than an automatic silent
  switch.
- **CORS note for implementers:** plain `<audio src>` playback does not
  require `Access-Control-Allow-Origin` from the source — CORS only matters
  if the client ever needs to `fetch()`/`XMLHttpRequest` the file bytes (e.g.
  to feed the Web Audio API for a future word-highlight-via-timestamp
  feature, or to explicitly cache it in the Service Worker). Don't block the
  basic listen feature on a CORS finding; do block the *future* word-level
  highlighting feature on it, since that needs `fetch()` access to the audio
  buffer and/or the QUL timestamp sidecar data.
- **Offline/caching:** out of scope for the MVP listen feature. If added
  later, cache at most a small bounded LRU (e.g. last 5 played ayat) in the
  Service Worker's existing versioned cache (Phase 3), never a surah/juz/full
  mushaf bulk cache.

### 3.3 What is explicitly NOT in scope here

- No client code was changed for this task — this document is the spec only.
- No reciter ID, hostname, or bucket has been hardcoded anywhere; §4 below
  gives the exact commands to run once network access allows, and the
  `[UNVERIFIED]` markers in §1–§2 must be resolved before any of this ships.
- Word-level highlighting (using QUL timestamp data) is **not** part of this
  spec's scope — §1c only documents QUL as the eventual data source for that
  separately-scoped future feature per `PLAN.md`'s Phase 4 note.

---

## 4. Commands to re-run once network access is unblocked

```bash
# 1. everyayah directory listing — confirm exact Husary folder names
curl -sS https://everyayah.com/data/ | grep -io 'Husary[A-Za-z0-9_]*' | sort -u

# 2. everyayah short + long ayah, both bitrates — status/type/size/CORS
for dir in Husary_64kbps Husary_128kbps Husary_Muallim_128kbps; do
  for f in 001001 002282; do
    echo "== $dir/$f =="
    curl -sS -D - -o /dev/null \
      "https://everyayah.com/data/$dir/$f.mp3" \
      | egrep -i 'HTTP/|content-type|content-length|access-control-allow-origin'
  done
done

# 3. quran.com reciter list — find Husary's real numeric id(s) and styles
curl -sS https://api.quran.com/api/v4/resources/recitations \
  | python3 -m json.tool | grep -i -B2 -A2 husary

# 4. quran.com per-ayah lookup — confirm URL pattern + current CDN host
curl -sS "https://api.quran.com/api/v4/recitations/<ID>/by_ayah/1:1"
curl -sS "https://api.quran.com/api/v4/recitations/<ID>/by_ayah/2:282"

# 5. Whichever CDN host §4.4 reveals — status/type/size/CORS for both ayat
curl -sS -D - -o /dev/null "<resolved_url_for_1:1>" \
  | egrep -i 'HTTP/|content-type|content-length|access-control-allow-origin'
curl -sS -D - -o /dev/null "<resolved_url_for_2:282>" \
  | egrep -i 'HTTP/|content-type|content-length|access-control-allow-origin'

# 6. QUL — check what's downloadable for Husary and its stated license
#    (requires visiting https://qul.tarteel.ai/resources/audio-files in a
#     browser with an account; not a simple curl — record findings manually)
```

Replace every `[UNVERIFIED]` tag above with the real measured values, and
update §2's recommendation if reality differs (e.g. if quran.com turns out to
send permissive CORS and everyayah does not, that shifts weight toward
quran.com for any feature that needs `fetch()` access).
