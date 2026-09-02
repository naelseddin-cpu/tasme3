// Node-only regression test for the M4 fix (master audit 2026-09-02): the
// boundary-affix rule could be defeated by an "echo" -- a 2-letter
// vowel-class affix that repeats the word's own trailing/leading bigram
// (كفروا+وا = كفرواوا, ءامنوا+وا, يا+يايها). weightedEditDistance's DP used
// to delete the INTERIOR copy of that echoed pair (two interior vowel edits
// = 2, within L1/L2 tolerance) instead of the copy genuinely sitting at the
// edge (which correctly costs CONSONANT_EDIT_COST per the edge rule). See
// app/matcher.js's fuzzyEqual for the full fix rationale.
//
// This file covers: (1) a corpus scan across >=10 real mushaf pages for all
// four attack shapes (trailing/leading echo, glued forward/backward) --
// expect 0 false-accepts at every level; (2) the specific
// forgiving/rejected pair table named in the audit's required evidence.
const fs = require('fs');
const path = require('path');
const M = require('../../app/matcher.js');

const ROOT = path.resolve(__dirname, '..', '..');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('PASS:', name); }
  else { fail++; console.log('FAIL:', name, extra !== undefined ? JSON.stringify(extra) : ''); }
}

const LEVELS = [1, 2, 3, 4];
const VOWELS = 'اويىةهءأإآؤئ'.split('');
function isV(c) { return VOWELS.indexOf(c) !== -1; }

function loadPageWords(pageNum) {
  const p = path.join(ROOT, 'site/pages', 'page-' + String(pageNum).padStart(3, '0') + '.json');
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));
  const out = [];
  d.tokens.forEach(function (tk) { if (tk.e) return; out.push({ n: tk.n, a: tk.a }); });
  return out;
}

// =====================================================================
// Corpus scan: >=10 pages across the mushaf, all four attack shapes.
// =====================================================================
(function corpusScan() {
  const PAGES = [1, 3, 30, 50, 77, 114, 187, 293, 400, 500, 550, 604];
  let trailTotal = 0, leadTotal = 0, mergeFwdTotal = 0, mergeBwdTotal = 0;
  const trailHits = { 1: 0, 2: 0, 3: 0, 4: 0 };
  const leadHits = { 1: 0, 2: 0, 3: 0, 4: 0 };
  const mergeFwdHits = { 1: 0, 2: 0, 3: 0, 4: 0 };
  const mergeBwdHits = { 1: 0, 2: 0, 3: 0, 4: 0 };

  PAGES.forEach(function (pageNum) {
    const words = loadPageWords(pageNum);
    words.forEach(function (item, i) {
      const w = item.n;
      if (w.length < 4) return;

      const lastTwo = w.slice(-2);
      if (isV(lastTwo[0]) && isV(lastTwo[1])) {
        trailTotal++;
        const variant = w + lastTwo; // trailing echo: word + its own trailing bigram
        LEVELS.forEach(function (l) { if (M.fuzzyEqual(variant, w, l)) trailHits[l]++; });
        if (i + 1 < words.length) {
          mergeFwdTotal++;
          const tok = variant + words[i + 1].n; // glued forward: echoed word + real next word
          LEVELS.forEach(function (l) { if (M.matchesMerged(tok, item, words[i + 1], l)) mergeFwdHits[l]++; });
        }
      }

      const firstTwo = w.slice(0, 2);
      if (isV(firstTwo[0]) && isV(firstTwo[1])) {
        leadTotal++;
        const variant = firstTwo + w; // leading echo: its own leading bigram + word
        LEVELS.forEach(function (l) { if (M.fuzzyEqual(variant, w, l)) leadHits[l]++; });
        if (i - 1 >= 0) {
          mergeBwdTotal++;
          const tok = words[i - 1].n + variant; // glued backward: real prev word + echoed word
          LEVELS.forEach(function (l) { if (M.matchesMerged(tok, words[i - 1], item, l)) mergeBwdHits[l]++; });
        }
      }
    });
  });

  check('scanned >= 10 pages (' + PAGES.length + ')', PAGES.length >= 10, PAGES.length);
  check('trailing-echo occurrences found (' + trailTotal + ')', trailTotal > 0, trailTotal);
  check('leading-echo occurrences found (' + leadTotal + ')', leadTotal > 0, leadTotal);
  LEVELS.forEach(function (l) {
    check('trailing echo: 0 false-accepts at L' + l + ' (of ' + trailTotal + ')', trailHits[l] === 0, trailHits);
    check('leading echo: 0 false-accepts at L' + l + ' (of ' + leadTotal + ')', leadHits[l] === 0, leadHits);
    check('glued forward: 0 false-accepts at L' + l + ' (of ' + mergeFwdTotal + ')', mergeFwdHits[l] === 0, mergeFwdHits);
    check('glued backward: 0 false-accepts at L' + l + ' (of ' + mergeBwdTotal + ')', mergeBwdHits[l] === 0, mergeBwdHits);
  });
})();

// =====================================================================
// Named pair table (audit's required evidence).
// =====================================================================
LEVELS.concat([undefined]).forEach(function (level) {
  check('كفرواوا vs كفروا rejected at level ' + level, !M.fuzzyEqual('كفرواوا', 'كفروا', level));
  check('يايايها vs ياايها rejected at level ' + level, !M.fuzzyEqual('يايايها', 'ياايها', level));
});

[1, 2, 3].forEach(function (level) {
  [
    ['السموات', 'السماوات'],
    ['الصلوه', 'الصلاه'],
    ['ابرهيم', 'ابراهيم'],
    ['داود', 'داوود'],
    ['يايها', 'ياايها'],
    ['مؤمنون', 'مومنون']
  ].forEach(function (pair) {
    check(pair[0] + ' vs ' + pair[1] + ' accepted at level ' + level, M.fuzzyEqual(pair[0], pair[1], level));
  });
});

LEVELS.concat([undefined]).forEach(function (level) {
  [
    ['كفوا', 'كفو'],
    ['عبد', 'عبادي'],
    ['والعصر', 'والاصر']
  ].forEach(function (pair) {
    check(pair[0] + ' vs ' + pair[1] + ' rejected at level ' + level, !M.fuzzyEqual(pair[0], pair[1], level));
  });
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
