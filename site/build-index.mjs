#!/usr/bin/env node
// Build-time only (never fetched at runtime by the app): reads every page's
// layout JSON ONCE from ../app/mushaf/pages/*.json and emits a small static
// site/surah-index.json the client uses for surah/juz/page navigation.
//
// Usage:  node site/build-index.mjs
//
// Output shape:
//   {
//     "surahs": [ { "number": 1, "name": "الفاتحة", "firstPage": 1 }, ... 114 ],
//     "juz":    [ { "number": 1, "firstPage": 1 }, ... 30 ],
//     "pageCount": 604
//   }
//
// Juz (ajzaa) boundaries are NOT in the per-page JSON (there is no 'juz'
// marker in the token schema) so they are hardcoded here from the standard
// Madinah Mushaf 604-page pagination — the same fixed page list every
// print/app using this exact 604-page layout shares.

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

  const surahsByNumber = new Map();
  let pageCount = 0;

  for (const file of files) {
    const pageNum = parseInt(file.slice(5, 8), 10);
    pageCount = Math.max(pageCount, pageNum);
    const data = JSON.parse(fs.readFileSync(path.join(PAGES_DIR, file), 'utf8'));
    const lines = Array.isArray(data.lines) ? data.lines : [];
    for (const line of lines) {
      if (line.t !== 's' || typeof line.sura !== 'number') continue;
      let sura = line.sura;
      let name = line.name || '';
      const fixup = SURAH_MARKER_FIXUPS[`${pageNum}:${sura}`];
      if (fixup) { sura = fixup.sura; name = fixup.name; }
      if (sura < 1 || sura > 114) continue; // defensive: skip any other bad marker
      if (!surahsByNumber.has(sura)) {
        surahsByNumber.set(sura, { number: sura, name, firstPage: pageNum });
      }
    }
  }

  const surahs = [...surahsByNumber.values()].sort((a, b) => a.number - b.number);
  const juz = JUZ_START_PAGES.map((firstPage, i) => ({ number: i + 1, firstPage }));

  const out = { surahs, juz, pageCount };
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2) + '\n');
  console.log(`Wrote ${OUT_FILE}: ${surahs.length} surahs, ${juz.length} juz, pageCount=${pageCount}`);
}

main();
