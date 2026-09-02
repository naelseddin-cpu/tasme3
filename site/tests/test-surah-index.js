// Node-only regression test for F2 (surah index one page early for 21
// surahs). Verifies site/surah-index.json against the same ground truth
// site/build-index.mjs derives firstPage from: app/mushaf/pages/*.json's
// own word tokens (`k` === "<sura>:1" marks ayah 1 of a surah actually
// present on that page). No browser needed.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const PAGES_DIR = path.join(ROOT, 'app/mushaf/pages');
const INDEX_FILE = path.join(ROOT, 'site/surah-index.json');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('PASS:', name); }
  else { fail++; console.log('FAIL:', name, extra !== undefined ? JSON.stringify(extra) : ''); }
}

// Same fixup build-index.mjs applies for the one malformed marker in the
// source data (page 187: surah 9's header line carries {sura:0}).
const SURAH_MARKER_FIXUPS = { '187:0': { sura: 9, name: 'التوبة' } };

function main() {
  const files = fs.readdirSync(PAGES_DIR)
    .filter((f) => /^page-\d{3}\.json$/.test(f))
    .sort();
  check('found mushaf page files', files.length === 604, files.length);

  const pageAyah1Suras = new Map(); // pageNum -> Set<suraNumber>
  const pageData = new Map();
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

  // Ground-truth header pages + firstPage, computed independently of
  // build-index.mjs's own code (re-derived here rather than imported) so
  // this test can't pass merely because it shares a bug with the generator.
  const expected = new Map(); // suraNumber -> {firstPage, headerPage}
  for (const file of files) {
    const pageNum = parseInt(file.slice(5, 8), 10);
    const data = pageData.get(pageNum);
    const lines = Array.isArray(data.lines) ? data.lines : [];
    for (const line of lines) {
      if (line.t !== 's' || typeof line.sura !== 'number') continue;
      let sura = line.sura;
      const fixup = SURAH_MARKER_FIXUPS[`${pageNum}:${sura}`];
      if (fixup) sura = fixup.sura;
      if (sura < 1 || sura > 114) continue;
      if (expected.has(sura)) continue;
      let firstPage = pageNum;
      for (let p = pageNum; p <= pageCount; p++) {
        const suras = pageAyah1Suras.get(p);
        if (suras && suras.has(sura)) { firstPage = p; break; }
      }
      expected.set(sura, { firstPage, headerPage: pageNum });
    }
  }
  check('derived firstPage/headerPage for all 114 surahs', expected.size === 114, expected.size);

  const idx = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
  check('surah-index.json has 114 surahs', idx.surahs.length === 114, idx.surahs.length);
  check('surah-index.json pageCount is 604', idx.pageCount === 604, idx.pageCount);

  // The 21 surahs the F2 audit named as one page early before the fix.
  const F2_SURAHS = [4, 10, 22, 23, 24, 26, 27, 32, 33, 37, 38, 45, 47, 53, 60, 64, 65, 80, 82, 86, 91];

  let mismatches = [];
  for (const s of idx.surahs) {
    const exp = expected.get(s.number);
    if (!exp) { mismatches.push({ number: s.number, reason: 'not found in mushaf source' }); continue; }
    if (s.firstPage !== exp.firstPage) {
      mismatches.push({ number: s.number, gotFirstPage: s.firstPage, expectedFirstPage: exp.firstPage });
    }
    if (typeof s.headerPage !== 'number' || s.headerPage !== exp.headerPage) {
      mismatches.push({ number: s.number, gotHeaderPage: s.headerPage, expectedHeaderPage: exp.headerPage });
    }
  }
  check('every surah\'s firstPage equals the token-derived page (all 114)', mismatches.length === 0, mismatches);

  // Every one of the 21 F2 surahs must actually have headerPage < firstPage
  // (the specific bug shape: header sits on the previous surah's last page).
  const notOffByOne = F2_SURAHS.filter((n) => {
    const s = idx.surahs.find((x) => x.number === n);
    return !s || s.headerPage !== s.firstPage - 1;
  });
  check('all 21 F2 surahs have headerPage === firstPage - 1', notOffByOne.length === 0, notOffByOne);

  // Every OTHER surah (not in the F2 list) must have headerPage === firstPage
  // (header and ayah 1 share a page, the common/unaffected case).
  const otherSurahsWrong = idx.surahs.filter((s) => {
    if (F2_SURAHS.indexOf(s.number) !== -1) return false;
    return s.headerPage !== s.firstPage;
  });
  check('every non-F2 surah has headerPage === firstPage', otherSurahsWrong.length === 0, otherSurahsWrong);

  // firstPage must be monotonically non-decreasing in surah-number order
  // (canonical Quran order == page order) -- surahForPage()/app.js relies
  // on this to find "the last surah whose firstPage <= p".
  let nonMonotonic = [];
  for (let i = 1; i < idx.surahs.length; i++) {
    if (idx.surahs[i].firstPage < idx.surahs[i - 1].firstPage) {
      nonMonotonic.push([idx.surahs[i - 1], idx.surahs[i]]);
    }
  }
  check('firstPage is monotonically non-decreasing across all 114 surahs', nonMonotonic.length === 0, nonMonotonic);

  // Juz pages are a fixed, hardcoded table in build-index.mjs -- unaffected
  // by the F2 fix. Spot-check length and the well-known juz 1 / juz 30 pages.
  check('juz array unchanged: 30 entries', idx.juz.length === 30, idx.juz.length);
  check('juz 1 starts on page 1', idx.juz[0].number === 1 && idx.juz[0].firstPage === 1, idx.juz[0]);
  check('juz 30 starts on page 582', idx.juz[29].number === 30 && idx.juz[29].firstPage === 582, idx.juz[29]);

  // Spot checks named explicitly in the audit.
  const nisa = idx.surahs.find((s) => s.number === 4);
  check('النساء (4) firstPage is 77 (not 76)', nisa && nisa.firstPage === 77, nisa);
  const taghabun = idx.surahs.find((s) => s.number === 64);
  check('التغابن (64) firstPage is 556 (not 555)', taghabun && taghabun.firstPage === 556, taghabun);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

main();
