// Regression test for the merge-loophole false-reveal bug (adversarial
// audit 2026-09-01, a5-recite/browser-results.json finding G1 + the
// matcher-level 637-pair scan referenced in the same audit).
//
// The Iron Rule: a word must NEVER be revealed unless genuinely recited.
// matchesMerged() used to size its fuzzy tolerance off the CONCATENATED
// length of word[i]+word[i+1], which let a lone word[i+1] (never actually
// preceded by word[i]) satisfy that loose tolerance and falsely reveal the
// unspoken word[i]. The fix requires a verified SPLIT: some cut point of the
// spoken token where the prefix fuzzy-matches word[i] under word[i]'s OWN
// per-word tolerance and the suffix fuzzy-matches word[i+1] under word[i+1]'s
// own tolerance.
//
// This test re-runs that scan directly against the canonical matcher
// (app/matcher.js) over every consecutive word pair on the same 6 audit
// pages (3, 187, 302, 562, 603, 604 -- 637 consecutive pairs total) at every
// difficulty level, and asserts zero false reveals.
const path = require('path');
const fs = require('fs');
const M = require(path.join(__dirname, '..', '..', 'app', 'matcher.js'));

const ROOT = path.join(__dirname, '..', '..');
const PAGES = [3, 187, 302, 562, 603, 604];
const LEVELS = [1, 2, 3, 4, undefined];

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('PASS:', name); }
  else { fail++; console.log('FAIL:', name, extra !== undefined ? JSON.stringify(extra) : ''); }
}

function loadPageWords(pageNum) {
  const p = path.join(ROOT, 'site/pages', 'page-' + String(pageNum).padStart(3, '0') + '.json');
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));
  const out = [];
  d.tokens.forEach(function (tk) {
    if (tk.e) return; // ayah-end markers are not words
    out.push({ n: tk.n, a: tk.a });
  });
  return out;
}

let totalPairs = 0;
const perLevelFalseReveals = {};
LEVELS.forEach(function (l) { perLevelFalseReveals[String(l)] = []; });

PAGES.forEach(function (pageNum) {
  const words = loadPageWords(pageNum);
  for (let i = 0; i < words.length - 1; i++) {
    totalPairs++;
    LEVELS.forEach(function (level) {
      // Speak ONLY word[i+1] (word[i] is never uttered), starting at pointer i.
      const r = M.matchTranscript(words, i, words[i + 1].n, level);
      if (r.matched.indexOf(i) !== -1) {
        perLevelFalseReveals[String(level)].push({ page: pageNum, i: i, w0: words[i].n, w1: words[i + 1].n });
      }
    });
  }
});

check('637-pair scan covers exactly 637 consecutive pairs across pages 3/187/302/562/603/604', totalPairs === 637, totalPairs);

LEVELS.forEach(function (level) {
  const bad = perLevelFalseReveals[String(level)];
  check('0 false reveals at level ' + level + ' (' + totalPairs + ' pairs checked)', bad.length === 0, bad.slice(0, 5));
});

// -------------------------------------------------------------------------
// Targeted case from audit finding G1 / page 3: idx0 = 'ان' (unspoken),
// idx1 = 'الذين'. Speaking ONLY 'الذين' must reveal idx1 alone, never idx0,
// at every level.
LEVELS.forEach(function (level) {
  const r = M.matchTranscript([{ n: 'ان' }, { n: 'الذين' }], 0, 'الذين', level);
  check('lone الذين never reveals unspoken ان at level ' + level, r.matched.indexOf(0) === -1, r);
});

// Genuinely glued 'انالذين' (both words truly present, no separator) must
// reveal both, at every level.
LEVELS.forEach(function (level) {
  const r = M.matchTranscript([{ n: 'ان' }, { n: 'الذين' }], 0, 'انالذين', level);
  check('glued انالذين reveals both ان and الذين at level ' + level,
    r.pointer === 2 && r.matched.indexOf(0) !== -1 && r.matched.indexOf(1) !== -1, r);
});

// Triple-glued 'انالذينكفروا' (three words, no separators) must reveal all
// three at L1-L3; at L4 (exact-only) each part must be exact, which it is
// here since the glue is a verbatim concatenation.
[1, 2, 3, 4].forEach(function (level) {
  const r = M.matchTranscript(
    [{ n: 'ان' }, { n: 'الذين' }, { n: 'كفروا' }], 0, 'انالذينكفروا', level
  );
  check('triple-glued انالذينكفروا reveals all three at level ' + level,
    r.pointer === 3 && [0, 1, 2].every(function (idx) { return r.matched.indexOf(idx) !== -1; }), r);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
