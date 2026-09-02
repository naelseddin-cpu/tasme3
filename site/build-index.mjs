#!/usr/bin/env node
// Build-time only (never fetched at runtime by the app): reads every page's
// layout JSON ONCE from ../app/mushaf/pages/*.json and emits a small static
// site/surah-index.json the client uses for surah/juz/page navigation.
//
// Usage:  node site/build-index.mjs
//
// Output shape:
//   {
//     "surahs": [ { "number": 1, "name": "الفاتحة", "firstPage": 1, "headerPage": 1 }, ... 114 ],
//     "juz":    [ { "number": 1, "firstPage": 1 }, ... 30 ],
//     "pageCount": 604
//   }
//
// Juz (ajzaa) boundaries are NOT in the per-page JSON (there is no 'juz'
// marker in the token schema) so they are hardcoded here from the standard
// Madinah Mushaf 604-page pagination — the same fixed page list every
// print/app using this exact 604-page layout shares.
//
// firstPage vs headerPage (F2 fix): a surah's name-header line ('t':'s' in
// the per-page JSON) is typeset wherever the previous surah's text runs out
// -- for most surahs that's the top of a fresh page, but for 21 surahs
// (4, 10, 22, 23, 24, 26, 27, 32, 33, 37, 38, 45, 47, 53, 60, 64, 65, 80,
// 82, 86, 91) the header sits at the very BOTTOM of the previous surah's
// last page, with ayah 1's actual words not starting until the page after
// that. Using the header's page as "firstPage" landed the surah-start jump
// (site/app.js) one page too early -- on the previous surah's last page,
// which visually still shows the previous surah. firstPage is therefore
// derived independently of the header line: it is the first page whose
// word tokens actually contain ayah 1 of that surah (token key `k` ===
// "<sura>:1"), searching forward from the header's page. headerPage is
// kept as a separate field (the page the header LINE itself renders on)
// for anyone who needs that instead.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PAGES_DIR = path.join(ROOT, 'app/mushaf/pages');
const OUT_FILE = path.join(__dirname, 'surah-index.json');

// Standard Madinah Mushaf (604-page Uthmani layout) juz-start page numbers,
// juz 1..30 in order.
const JUZ_START_PAGES = [
  1, 22, 42, 62, 82, 102, 121, 142, 162, 182,
  201, 222, 242, 262, 282, 302, 322, 342, 362, 382,
  402, 422, 442, 462, 482, 502, 522, 542, 562, 582
];

// KNOWN DATA FIXUP (do not remove without checking upstream first): the
// surah-marker line on page-187.json is malformed in the committed source
// data — {"sura":0,"name":"Et-Tevbe"} instead of surah 9's real number and
// Arabic name ("Et-Tevbe" is Turkish for "At-Tawbah"). This is the only such
// anomaly across all 604 page files (verified: every other 's' line has a
// valid 1-114 surah number and an Arabic name). Surah 9 also has no Bismillah
// line, which is likely how the generator's placeholder value slipped through
// undetected. Patched here (consumer-side) rather than editing the shared
// page-data file, which is out of this work package's write scope; flagged
// upstream for a real fix at the source.
const SURAH_MARKER_FIXUPS = {
  '187:0': { sura: 9, name: 'التوبة' }
};

function main() {
  const files = fs.readdirSync(PAGES_DIR)
    .filter((f) => /^page-\d{3}\.json$/.test(f))
    .sort();

  if (files.length === 0) {
    console.error('No page JSON files found in', PAGES_DIR);
    process.exit(1);
  }

  // Pass 1: for every page, record which surahs have an ayah-1 word token
  // actually on that page (pageAyah1Suras[pageNum] = Set<suraNumber>), and
  // parse each page's data once (reused in pass 2 below).
  const pageData = new Map(); // pageNum -> parsed JSON
  const pageAyah1Suras = new Map(); // pageNum -> Set<suraNumber>
  let pageCount = 0;

  for (const file of files) {
    const pageNum = parseInt(file.slice(5, 8), 10);
    pageCount = Math.max(pageCount, pageNum);
    const data = JSON.parse(fs.readFileSync(path.join(PAGES_DIR, file), 'utf8'));
    pageData.set(pageNum, data);

    const ayah1Suras = new Set();
    const lines = Array.isArray(data.lines) ? data.lines : [];
    for (const line of lines) {
      const tokens = Array.isArray(line.tk) ? line.tk : [];
      for (const tok of tokens) {
        if (typeof tok.k !== 'string') continue;
        const parts = tok.k.split(':');
        if (parts.length !== 2 || parts[1] !== '1') continue;
        const sura = parseInt(parts[0], 10);
        if (Number.isFinite(sura)) ayah1Suras.add(sura);
      }
    }
    pageAyah1Suras.set(pageNum, ayah1Suras);
  }

  // Pass 2: find each surah's header-marker line (as before), then derive
  // firstPage by scanning forward from the header page for the first page
  // whose ayah1Suras set actually contains this surah (see comment above
  // main()). headerPage is kept alongside for reference.
  const surahsByNumber = new Map();

  for (const file of files) {
    const pageNum = parseInt(file.slice(5, 8), 10);
    const data = pageData.get(pageNum);
    const lines = Array.isArray(data.lines) ? data.lines : [];
    for (const line of lines) {
      if (line.t !== 's' || typeof line.sura !== 'number') continue;
      let sura = line.sura;
      let name = line.name || '';
      const fixup = SURAH_MARKER_FIXUPS[`${pageNum}:${sura}`];
      if (fixup) { sura = fixup.sura; name = fixup.name; }
      if (sura < 1 || sura > 114) continue; // defensive: skip any other bad marker
      if (surahsByNumber.has(sura)) continue;

      let firstPage = pageNum;
      for (let p = pageNum; p <= pageCount; p++) {
        const suras = pageAyah1Suras.get(p);
        if (suras && suras.has(sura)) { firstPage = p; break; }
        if (p === pageCount) {
          console.error(`WARNING: could not find ayah 1 of surah ${sura} on or after header page ${pageNum}; falling back to header page`);
        }
      }

      surahsByNumber.set(sura, { number: sura, name, firstPage, headerPage: pageNum });
    }
  }

  const surahs = [...surahsByNumber.values()].sort((a, b) => a.number - b.number);
  const juz = JUZ_START_PAGES.map((firstPage, i) => ({ number: i + 1, firstPage }));

  const out = { surahs, juz, pageCount };
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2) + '\n');
  console.log(`Wrote ${OUT_FILE}: ${surahs.length} surahs, ${juz.length} juz, pageCount=${pageCount}`);
}

main();
