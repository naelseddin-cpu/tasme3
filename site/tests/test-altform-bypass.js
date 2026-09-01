// Regression test for the alt-form false-reveal bug (re-audit #10,
// a5-recite/altform-exploit-scan.json + targets.json, 2026-09-01).
//
// The Iron Rule: a word must NEVER be revealed unless genuinely recited.
//
// toleranceFor()'s "normalized length <=3 -> exact-match-only" clamp used to
// key off whichever SINGLE form was being compared (tok vs n, or tok vs a)
// rather than off the expected word's own identity. For an expected item
// {n, a} where `n` is <=3 letters but its alternate `a` is longer (dagger-
// alif -> alif adds a letter: e.g. n:'عبد'(3) a:'عباد'(4)), comparing the
// spoken token against the LONGER `a` form fell through to the ordinary
// length-4+ tolerance table, so words that merely resemble `a` -- but were
// never actually said -- were fuzzy-accepted. 88 such {n,a} pairs exist in
// the full mushaf corpus (every pair where len(n)<=3 and len(a)>3).
//
// The fix (app/matcher.js's isShortForms/formMatches, mirrored in
// server/matching.py's _is_short_forms/_form_matches): if the SHORTEST form
// among an expected word's {n, a} is <=3, the spoken token must EXACTLY
// equal n or a -- no fuzzy tolerance against either form -- in matchesWord
// and both merge paths. This file has two parts:
//
//   (A) Full-corpus cross-check: for all 88 {n,a} short-n/long-a pairs
//       found in app/mushaf/pages/*.json, verify no OTHER unique word-form
//       anywhere in the full 604-page corpus is fuzzy-accepted against
//       either form, at any of the 4 difficulty levels. (A full-corpus scan
//       is a superset of -- and thus subsumes -- the re-auditor's curated
//       near-miss candidate list, which found 568/107/30/0 false-accept
//       opportunities at L1/L2/L3/L4 respectively before this fix.)
//
//   (B) The two named in-app repros from the audit, run directly against
//       the canonical matcher with real page data (page 490 idx88
//       {n:'عبد',a:'عباد'} merged with 'الرحمن'; page 562 idx89
//       {n:'بلي',a:'بليا'} in a wrong-word storm) -- each must reveal
//       NOTHING at any level after the fix, while genuine «عباد الرحمن»
//       must still reveal normally.
const fs = require('fs');
const path = require('path');
const M = require(path.join(__dirname, '..', '..', 'app', 'matcher.js'));

const ROOT = path.join(__dirname, '..', '..');
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
    if (tk.e) return;
    out.push({ n: tk.n, a: tk.a });
  });
  return out;
}

// ===================== (A) full-corpus alt-form exploit scan =====================
// Load every mushaf page (source of truth for n/a token pairs), collect the
// unique {n,a} target pairs (len(n)<=3 && len(a)>3), and the unique corpus
// of normalized word-forms (the "wrongWord" candidate pool), exactly as the
// re-auditor's targets.json / altform-exploit-scan.json did.
const mushafDir = path.join(ROOT, 'app', 'mushaf', 'pages');
const mushafFiles = fs.readdirSync(mushafDir).filter(function (f) { return f.endsWith('.json'); });

const targetsMap = new Map();
const corpusWords = new Set();
mushafFiles.forEach(function (f) {
  const d = JSON.parse(fs.readFileSync(path.join(mushafDir, f), 'utf8'));
  (d.lines || []).forEach(function (line) {
    if (line.t !== 'w') return;
    (line.tk || []).forEach(function (tk) {
      const n = tk.n, a = tk.a;
      if (!n) return;
      corpusWords.add(n);
      if (a && a !== n && n.length <= 3 && a.length > 3) {
        targetsMap.set(n + '|' + a, { n: n, a: a });
      }
    });
  });
});
const targets = Array.from(targetsMap.values());
const corpusPool = Array.from(corpusWords);

check('88 unique short-n/long-a {n,a} target pairs found in the mushaf corpus',
  targets.length === 88, targets.length);
check('corpus word-form pool is non-trivial (sanity)', corpusPool.length > 10000, corpusPool.length);

LEVELS.forEach(function (level) {
  const findings = [];
  targets.forEach(function (t) {
    corpusPool.forEach(function (w) {
      if (w === t.n || w === t.a) return; // exact match on either form is CORRECT acceptance
      if (M.matchesWord(w, t, level)) {
        findings.push({ target: t, wrongWord: w });
      }
    });
  });
  check('0 false-accept opportunities at level ' + level +
    ' (' + targets.length + ' targets x ' + corpusPool.length + ' corpus words)',
    findings.length === 0, findings.slice(0, 5));
});

// ===================== (B) named in-app repros =====================

// --- Repro 1: page 490 idx88 {n:'عبد',a:'عباد'} merged with idx89 'الرحمن' ---
// Feeding a wrong word that merely resembles the longer alt form 'عباد',
// glued (no separator) with the genuinely-next exact word 'الرحمن', used to
// falsely reveal the unspoken idx88 at L1/L2/L3 via the merge split check.
const page490 = loadPageWords(490);
check('page 490 idx88 is {n:عبد,a:عباد}', page490[88].n === 'عبد' && page490[88].a === 'عباد', page490[88]);
check('page 490 idx89 is الرحمن', page490[89].n === 'الرحمن', page490[89]);

['عبادي', 'عبادا', 'عباده', 'وعباد'].forEach(function (wrongWord) {
  // Direct single-word check: the exact bug from the audit's exploit scan --
  // wrongWord used to fuzzy-match the longer alt form 'عباد' under the old
  // per-form length clamp (dist 1-2, well within the length-4+ tolerance
  // table at L1-L3).
  LEVELS.forEach(function (level) {
    check('page490 idx88: ' + wrongWord + ' alone does not fuzzy-match {n:عبد,a:عباد} at level ' + level,
      !M.matchesWord(wrongWord, page490[88], level));
  });
  // Realistic transcript: wrongWord spoken, then the genuinely-next word
  // الرحمن spoken normally (space-separated, as real ASR/typed input would
  // produce) -- must not reveal idx88 at any level.
  LEVELS.forEach(function (level) {
    const transcript = wrongWord + ' الرحمن';
    const r = M.matchTranscript(page490, 88, transcript, level);
    check('page490 idx88: "' + transcript + '" does not reveal unspoken عبد/عباد at level ' + level,
      r.matched.indexOf(88) === -1, r);
  });
});

// --- Repro 2: page 562 idx89 {n:'بلي',a:'بليا'}, wrong-word storm containing 'بل' ---
// A storm of short unrelated words that happens to include 'بل' used to
// reveal idx89 at L1 (بل fuzzy-matched 'بليا' under the old per-form clamp).
const page562 = loadPageWords(562);
check('page 562 idx89 is {n:بلي,a:بليا}', page562[89].n === 'بلي' && page562[89].a === 'بليا', page562[89]);

const wrongStorm = 'قد في لن او لو مع كي بل عن';
LEVELS.forEach(function (level) {
  const r = M.matchTranscript(page562, 89, wrongStorm, level);
  check('page562 idx89: wrong-word storm containing بل reveals nothing at level ' + level,
    r.matched.length === 0 && r.pointer === 89, r);
});

// --- Genuine recitation of both repro words must still work normally ---
LEVELS.forEach(function (level) {
  const r = M.matchTranscript(page490, 88, 'عباد الرحمن', level);
  check('genuine «عباد الرحمن» still reveals idx88 and idx89 at level ' + level,
    r.pointer === 90 && r.matched.indexOf(88) !== -1 && r.matched.indexOf(89) !== -1, r);
});
LEVELS.forEach(function (level) {
  const r = M.matchTranscript(page562, 89, 'بلي', level);
  check('genuine «بلي» still reveals idx89 at level ' + level,
    r.pointer === 90 && r.matched.indexOf(89) !== -1, r);
});
// The 'a' alternate form spoken directly must also still be accepted exactly.
LEVELS.forEach(function (level) {
  const r = M.matchTranscript(page490, 88, 'عباد', level);
  check('genuine alt-form «عباد» alone still reveals idx88 at level ' + level,
    r.matched.indexOf(88) !== -1, r);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
