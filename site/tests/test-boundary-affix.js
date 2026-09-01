// Regression test for the boundary-affix false-reveal bug (master audit
// 2026-09-01, missed by the merge-loophole/short-n-long-a fix in commit
// 7391880).
//
// The Iron Rule: a word must NEVER be revealed unless genuinely recited.
//
// Repro: expected [{n:'عبد',a:'عباد'}, {n:'الرحمن',a:'الرحمان'}]. A speaker
// says «عبادي» ("my servants" -- a different, unspoken word) glued to
// «الرحمن». The split-verification merge path used to find the cut
// عباد|يالرحمن: part1 ('عباد') is an exact match on word0's alt form, and
// the leftover 'ي' got absorbed into part2 ('يالرحمن') as a cheap
// VOWEL_EDIT_COST=1 insertion in front of 'الرحمن' -- within every level's
// tolerance -- falsely revealing BOTH words even though 'عبادي' was never
// 'عباد الرحمن'. The same leak existed on the single-word and spaced-word
// paths for the trailing 'ي' on 'عبادي' vs {n:'عبد',a:'عباد'}.
//
// Root cause: in Arabic, edge letters (first or last position of a word)
// are meaning-bearing affixes (و "and", ي "my"/1st-person, ا case/dual
// endings, ب/ل/ف/ك prefixes) -- an edit there changes the word, never
// merely its accent, even when the letter itself is vowel-class. The fix
// (app/matcher.js's isEdgePos / weightedEditDistance) forces
// CONSONANT_EDIT_COST for ANY insertion, deletion, or substitution that
// touches the first or last character position of either string being
// compared, regardless of letter class.
//
// This file checks: (1) the exact repro, in all 3 forms (glued / single-word
// / spaced), at all 4 levels -> nothing revealed; (2) genuine 'عباد الرحمن'
// (glued and spaced) still reveals both, at all 4 levels; (3) the interior
// vowel-class cases that MUST remain forgiving (they are not edge edits);
// (4) other edge-rejection cases named in the audit, with the accepted
// Iron-Rule trade-off (a legitimate ASR-variance casualty) documented and
// tested explicitly rather than silently accepted.
const M = require('../../app/matcher.js');

const LEVELS = [1, 2, 3, 4];

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('PASS:', name); }
  else { fail++; console.log('FAIL:', name, extra !== undefined ? JSON.stringify(extra) : ''); }
}

const EXP = [{ n: 'عبد', a: 'عباد' }, { n: 'الرحمن', a: 'الرحمان' }];

// ===================== (1) the exact repro: nothing revealed =====================

LEVELS.forEach(function (level) {
  // (a) glued: 'عبادي' + 'الرحمن' as ONE token, no separator.
  var rGlued = M.matchTranscript(EXP, 0, 'عبادي' + 'الرحمن', level);
  check('glued «عباديالرحمن» reveals nothing at level ' + level,
    rGlued.pointer === 0 && rGlued.matched.length === 0, rGlued);

  // (b) single word alone: 'عبادي' with only word0 pending.
  var rSingle = M.matchTranscript([EXP[0]], 0, 'عبادي', level);
  check('single «عبادي» does not reveal {n:عبد,a:عباد} at level ' + level,
    rSingle.matched.length === 0, rSingle);

  // (c) spaced: 'عبادي الرحمن' as two separate tokens.
  var rSpaced = M.matchTranscript(EXP, 0, 'عبادي الرحمن', level);
  check('spaced «عبادي الرحمن» reveals nothing at level ' + level,
    rSpaced.pointer === 0 && rSpaced.matched.length === 0, rSpaced);
});

// ===================== (2) genuine «عباد الرحمن» still reveals both =====================

LEVELS.forEach(function (level) {
  var rGluedGenuine = M.matchTranscript(EXP, 0, 'عباد' + 'الرحمن', level);
  check('genuine glued «عبادالرحمن» reveals both at level ' + level,
    rGluedGenuine.pointer === 2 && rGluedGenuine.matched.indexOf(0) !== -1 && rGluedGenuine.matched.indexOf(1) !== -1, rGluedGenuine);

  var rSpacedGenuine = M.matchTranscript(EXP, 0, 'عباد الرحمن', level);
  check('genuine spaced «عباد الرحمن» reveals both at level ' + level,
    rSpacedGenuine.pointer === 2 && rSpacedGenuine.matched.indexOf(0) !== -1 && rSpacedGenuine.matched.indexOf(1) !== -1, rSpacedGenuine);
});

// ===================== (3) forgiving INTERIOR vowel-class cases (must still pass, L1-L3) =====================

[1, 2, 3].forEach(function (level) {
  check('السموات matches السماوات (interior ا insertion) at level ' + level,
    M.fuzzyEqual('السموات', 'السماوات', level));
  check('الصلوه matches الصلاه (interior و<->ا) at level ' + level,
    M.fuzzyEqual('الصلوه', 'الصلاه', level));
  check('ابرهيم matches ابراهيم (interior ا insertion) at level ' + level,
    M.fuzzyEqual('ابرهيم', 'ابراهيم', level));
});
// الرحمن/الرحمان goes through the exact alt-form path (n/a), unaffected by
// edge weighting entirely -- confirmed at every level including L4.
LEVELS.forEach(function (level) {
  var r = M.matchTranscript([{ n: 'الرحمن', a: 'الرحمان' }], 0, 'الرحمان', level);
  check('الرحمان matches {n:الرحمن,a:الرحمان} (exact alt form) at level ' + level,
    r.pointer === 1 && r.matched.length === 1, r);
});

// ===================== (4) other edge-rejection cases from the audit =====================

LEVELS.forEach(function (level) {
  // وقل vs قل: leading و ("and") is a prefix affix -- a different word/
  // grammatical construction, not an accent slip.
  check('وقل rejected for قل (leading و affix) at level ' + level,
    !M.fuzzyEqual('وقل', 'قل', level));

  // يالرحمن vs الرحمن: leading ي is exactly the leftover from the repro's
  // merge split -- must be rejected standalone too, at every level.
  check('يالرحمن rejected for الرحمن (leading ي affix) at level ' + level,
    !M.fuzzyEqual('يالرحمن', 'الرحمن', level));
});

// كفوا (ends with ا) vs spoken كفو (ASR dropped the final alif): the edit is
// a DELETION at the LAST letter position -- exactly the affix-bearing edge
// the fix targets. Per the Iron Rule (a false accept is worse than a false
// reject), this is now rejected at every level, even though it is a
// plausible, and not uncommon, ASR/tanween transcription variance (a
// word-final accusative-tanween alif is often dropped or rendered
// inconsistently by ASR). This is a DELIBERATE, DOCUMENTED casualty of the
// boundary-affix fix -- see app/matcher.js's isEdgePos comment and the
// "near-miss triple-glued token" test in app/tests/test-matcher.js
// (كفروا vs كفروه, the same final-letter-vowel-swap class) for the other
// place this trade-off shows up. It is NOT weakened to special-case this.
LEVELS.forEach(function (level) {
  check('كفو rejected for expected كفوا (dropped final alif, edge deletion) at level ' + level,
    !M.fuzzyEqual('كفو', 'كفوا', level));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
