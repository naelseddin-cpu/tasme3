const path = require('path');
const fs = require('fs');
const M = require(path.join(__dirname, '..', 'matcher.js'));

const fatiha = 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ الرَّحْمَٰنِ الرَّحِيمِ مَالِكِ يَوْمِ الدِّينِ إِيَّاكَ نَعْبُدُ وَإِيَّاكَ نَسْتَعِينُ اهْدِنَا الصِّرَاطَ الْمُسْتَقِيمَ صِرَاطَ الَّذِينَ أَنْعَمْتَ عَلَيْهِمْ غَيْرِ الْمَغْضُوبِ عَلَيْهِمْ وَلَا الضَّالِّينَ';
const expWords = fatiha.split(/\s+/);
const expNorm = expWords.map(M.normalizeArabic);
console.log('expected normalized:', expNorm.join(' '));

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('PASS:', name); }
  else { fail++; console.log('FAIL:', name); }
}

// ===================== Original 13 cases (must keep passing) =====================

// 1. Perfect recitation of first ayah, typical Whisper output (plain script, punctuation)
let r = M.matchTranscript(expNorm, 0, 'بسم الله الرحمن الرحيم.');
check('first ayah plain text reveals 4 words', r.pointer === 4 && r.matched.length === 4);

// 2. Continue: second ayah with Whisper writing العالمين
r = M.matchTranscript(expNorm, 4, 'الحمد لله رب العالمين');
check('second ayah advances to 8', r.pointer === 8);

// 3. Wrong word: user says الرحيم الرحمن reversed order -> الرحمن matches (word 8), الرحيم matches 9
r = M.matchTranscript(expNorm, 8, 'الرحمن الرحيم');
check('ayah 3 matches', r.pointer === 10);

// 4. User says wrong word entirely
r = M.matchTranscript(expNorm, 10, 'ملك الناس');
// ملك fuzzy-matches مالك? normalized مالك vs ملك: len4 vs 3 -> maxDist for len 4 = 1, lev=1 -> matches.
console.log('  pointer after "ملك الناس":', r.pointer);
check('partial: only first word accepted, wrong second rejected', r.pointer === 11);

// 5. Completely wrong utterance
r = M.matchTranscript(expNorm, 11, 'كيف حالك اليوم');
check('unrelated speech rejected', r.pointer === 11 && r.matched.length === 0);

// 6. User restarts ayah from beginning (repeat of revealed words then new word)
// pointer=11 (يوم). User says: مالك يوم الدين
r = M.matchTranscript(expNorm, 11, 'مالك يوم الدين');
check('restart with repeat words tolerated', r.pointer === 13);

// 7. Long ayah with hamza variants and ta marbuta differences
r = M.matchTranscript(expNorm, 13, 'اياك نعبد واياك نستعين');
check('hamza variants accepted', r.pointer === 17);

// 8. اهدنا الصراط المستقيم
r = M.matchTranscript(expNorm, 17, 'إهدنا الصراط المستقيم');
check('ayah 6', r.pointer === 20);

// 9. Final ayah
r = M.matchTranscript(expNorm, 20, 'صراط الذين أنعمت عليهم غير المغضوب عليهم ولا الضالين');
check('final ayah completes surah', r.pointer === expNorm.length);

// 10. Short-word strictness: قل should NOT match هل ? lev=1, len2 -> maxDist 0 -> reject
check('short words strict', !M.fuzzyEqual(M.normalizeArabic('قل'), M.normalizeArabic('هل')));

// 11. normalizeArabic keeps letters
check('normalize basmala', M.normalizeArabic('بِسْمِ') === 'بسم');
check('normalize allah', M.normalizeArabic('اللَّهِ') === 'الله');
check('normalize rahman with dagger alif', M.normalizeArabic('الرَّحْمَٰنِ') === 'الرحمن');

// ===================== New coverage (WP-A) =====================

// Golden-vector runthrough: both n and a for every vector.
const vectors = JSON.parse(fs.readFileSync(path.join(__dirname, 'normalize-vectors.json'), 'utf8'));
let vectorFail = 0;
vectors.forEach(function (v) {
  const gotN = M.normalizeArabic(v.input);
  if (gotN !== v.n) {
    vectorFail++;
    console.log('  vector n mismatch for', JSON.stringify(v.input), 'got', JSON.stringify(gotN), 'want', JSON.stringify(v.n));
  }
  const gotA = M.normalizeArabicAlt(v.input);
  const wantA = ('a' in v) ? v.a : v.n; // alt form is only emitted when it differs from n
  if (gotA !== wantA) {
    vectorFail++;
    console.log('  vector a mismatch for', JSON.stringify(v.input), 'got', JSON.stringify(gotA), 'want', JSON.stringify(wantA));
  }
});
check('golden-vector runthrough (' + vectors.length + ' vectors, n and a)', vectorFail === 0);

// قال spoken against expected {n:'قل', a:'قال'} matches at every level (exact
// match on the alternate form short-circuits the tolerance check).
[1, 2, 3, 4, undefined].forEach(function (level) {
  const res = M.matchTranscript([{ n: 'قل', a: 'قال' }], 0, 'قال', level);
  check('قال matches {n:قل,a:قال} at level ' + level, res.pointer === 1 && res.matched.length === 1);
});

// قل spoken against the same expected entry still matches at every level.
[1, 2, 3, 4, undefined].forEach(function (level) {
  const res = M.matchTranscript([{ n: 'قل', a: 'قال' }], 0, 'قل', level);
  check('قل matches {n:قل,a:قال} at level ' + level, res.pointer === 1 && res.matched.length === 1);
});

// Punctuation-glued token 'قل،' matches expected قل at L3 (root matcher does
// not have the Kimi comma-retention bug).
r = M.matchTranscript(['قل'], 0, 'قل،', 3);
check('punctuation-glued token matches at L3', r.pointer === 1 && r.matched.length === 1);

// Level monotonicity: for random word pairs drawn from the golden vectors, if
// L3 accepts then L2 must accept, and if L2 accepts then L1 must accept.
// (Holds by construction of the tolerance table; this guards against a future
// edit breaking that invariant.)
const pool = [];
vectors.forEach(function (v) {
  if (v.n) pool.push(v.n);
  if (v.a) pool.push(v.a);
});
// pad the pool with a few plain fatiha words too, for variety
expNorm.forEach(function (w) { if (w) pool.push(w); });

function pick(rng) { return pool[Math.floor(rng() * pool.length)]; }
// simple deterministic PRNG so the test is reproducible
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(42);
let monotonicityViolations = 0;
for (let k = 0; k < 200; k++) {
  const a = pick(rng), b = pick(rng);
  const l3 = M.fuzzyEqual(a, b, 3);
  const l2 = M.fuzzyEqual(a, b, 2);
  const l1 = M.fuzzyEqual(a, b, 1);
  if (l3 && !l2) { monotonicityViolations++; console.log('  monotonicity violation L3->L2:', a, b); }
  if (l2 && !l1) { monotonicityViolations++; console.log('  monotonicity violation L2->L1:', a, b); }
}
check('level monotonicity over 200 random word pairs', monotonicityViolations === 0);

// Merged-token match that only succeeds via the alternate ('a') forms:
// expected two words {n:'ملك',a:'مالك'} + 'يوم'; spoken merged token
// 'مالكيوم' equals alt+n exactly, but n+n ('ملكيوم') is 1 edit away, which at
// level 4 (exact-only tolerance) is rejected — so this only passes if the
// merge logic tries the alternate-form combinations too.
r = M.matchTranscript([{ n: 'ملك', a: 'مالك' }, 'يوم'], 0, 'مالكيوم', 4);
check('merged token matches via alternate forms at L4', r.pointer === 2 && r.matched.length === 2 && r.matched[0] === 0 && r.matched[1] === 1);
// sanity: the plain n+n merge alone would NOT satisfy L4 exact tolerance
check('merged n-only combo is not an exact match (sanity)', M.levenshtein('ملكيوم', 'مالكيوم') > 0);

// ===================== New coverage (merge-loophole audit fix) =====================
// Adversarial audit 2026-09-01 (a5-recite/browser-results.json finding G1)
// confirmed FALSE-REVEAL bugs; the Iron Rule is a word must NEVER be
// revealed unless genuinely recited. See site/tests/test-merge-loophole.js
// for the full 637-consecutive-pair scan across real page data; the cases
// below cover the matcher's unit-level acceptance criteria directly.

// --- Rule 1+2: merge split verification (2-word and 3-word) -----------------

// A lone word[1] must never reveal an unspoken word[0] via the merge path,
// at any level (this is the exact G1 audit finding, at unit level).
[1, 2, 3, 4, undefined].forEach(function (level) {
  r = M.matchTranscript([{ n: 'ان' }, { n: 'الذين' }], 0, 'الذين', level);
  check('lone الذين does not reveal unspoken ان at level ' + level, r.matched.indexOf(0) === -1);
});

// Genuinely glued 'انالذين' (both words truly present, no separator) must
// reveal both, at every level.
[1, 2, 3, 4, undefined].forEach(function (level) {
  r = M.matchTranscript([{ n: 'ان' }, { n: 'الذين' }], 0, 'انالذين', level);
  check('glued انالذين reveals both at level ' + level, r.pointer === 2 && r.matched.length === 2);
});

// Triple-glued 'انالذينكفروا' as ONE token (no separators at all) must
// reveal all three at L1-L3, since 3-word merge support is new.
[1, 2, 3].forEach(function (level) {
  r = M.matchTranscript([{ n: 'ان' }, { n: 'الذين' }, { n: 'كفروا' }], 0, 'انالذينكفروا', level);
  check('triple-glued token reveals all three at level ' + level, r.pointer === 3 && r.matched.length === 3);
});
// At L4 (exact-only), the same verbatim-concatenated triple-glued token
// still reveals all three, because every part is an exact split.
r = M.matchTranscript([{ n: 'ان' }, { n: 'الذين' }, { n: 'كفروا' }], 0, 'انالذينكفروا', 4);
check('triple-glued exact-concatenation token reveals all three at L4', r.pointer === 3 && r.matched.length === 3);
// A triple-glued token that is only APPROXIMATELY the concatenation (one
// part off by one vowel edit) is rejected at L4 (exact-only) but still
// accepted at L1-L3 (which tolerate a single vowel edit at this length).
r = M.matchTranscript([{ n: 'ان' }, { n: 'الذين' }, { n: 'كفروا' }], 0, 'انالذينكفروه', 4);
check('near-miss triple-glued token rejected at L4', r.pointer === 0 && r.matched.length === 0);
r = M.matchTranscript([{ n: 'ان' }, { n: 'الذين' }, { n: 'كفروا' }], 0, 'انالذينكفروه', 3);
check('near-miss triple-glued token still accepted at L3 (1 vowel edit within tolerance)', r.pointer === 3 && r.matched.length === 3);

// The old merge loophole itself, reproduced directly: expected [ان, الذين],
// spoken ONLY 'الذين' at pointer 0 must not advance the pointer or reveal
// anything -- word[0]='ان' is short (rule 3: exact-only) so no split of
// 'الذين' can satisfy it, and word[1] cannot be matched out of order at
// pointer 0. Old code's concatenated-length tolerance for len('انالذين')=7
// would have wrongly accepted this as a merge.
r = M.matchTranscript([{ n: 'ان' }, { n: 'الذين' }], 0, 'الذين', 2);
check('merge-loophole reproduction: ان stays veiled, pointer does not advance', r.pointer === 0 && r.matched.length === 0);

// --- Rule 3: short words (normalized length <=3) are exact-match only, at ALL levels ---

[1, 2, 3, 4, undefined].forEach(function (level) {
  check('ان vs من rejected at level ' + level, !M.fuzzyEqual('ان', 'من', level));
  check('لم vs لا rejected at level ' + level, !M.fuzzyEqual('لم', 'لا', level));
  check('هم vs ام rejected at level ' + level, !M.fuzzyEqual('هم', 'ام', level));
});
// Sanity: an exact-length-3-or-less word still matches itself exactly.
check('exact short word still matches at L1', M.fuzzyEqual('ان', 'ان', 1));
check('toleranceFor(1, 2) is 0 (was 1 before the fix)', M.toleranceFor(1, 2) === 0);
check('toleranceFor(1, 3) is 0 (was 1 before the fix)', M.toleranceFor(1, 3) === 0);

// --- Rule 4: weighted edit distance rejects meaning-changing consonant swaps ---

[1, 2, 3, 4, undefined].forEach(function (level) {
  check('والاصر rejected for والعصر at level ' + level, !M.fuzzyEqual('والاصر', 'والعصر', level));
});
check('weightedEditDistance(والاصر, والعصر) is 3 (one consonant swap)', M.weightedEditDistance('والاصر', 'والعصر') === 3);
check('plain levenshtein(والاصر, والعصر) is 1 (unweighted, for contrast)', M.levenshtein('والاصر', 'والعصر') === 1);

// Forgiving cases that MUST STILL PASS at L1-L3 (pure vowel/orthography edits):
[1, 2, 3].forEach(function (level) {
  check('السموات matches السماوات (insert ا) at level ' + level, M.fuzzyEqual('السموات', 'السماوات', level));
  check('الصلوه matches الصلاه (و<->ا) at level ' + level, M.fuzzyEqual('الصلوه', 'الصلاه', level));
  check('ابرهيم matches ابراهيم (insert ا) at level ' + level, M.fuzzyEqual('ابرهيم', 'ابراهيم', level));
});
// الرحمن vs الرحمان: real usage goes through the n/a alternate-form pair
// (see normalize-vectors.json), which is an exact match on the alt form and
// so is unaffected by tolerance/weighting entirely -- confirmed via
// matchTranscript against the {n,a} expected entry, at every level.
[1, 2, 3, 4, undefined].forEach(function (level) {
  r = M.matchTranscript([{ n: 'الرحمن', a: 'الرحمان' }], 0, 'الرحمان', level);
  check('الرحمان matches {n:الرحمن,a:الرحمان} at level ' + level, r.pointer === 1 && r.matched.length === 1);
});

// ملك (len3) vs مالك (len4, insert ا, cost 1): the length used for the
// tolerance lookup is max(3,4)=4, so rule 3's len<=3 exact-only guard does
// NOT apply here (it only fires when the LONGER side is also <=3) -- this
// stays accepted at the default level exactly as before the fix (existing
// case 4 above already covers this via the fatiha pointer-11 assertion).
// At L4 (exact-only) it is rejected, as it always was.
check('ملك vs مالك still accepted at default level (unchanged)', M.fuzzyEqual('ملك', 'مالك'));
check('ملك vs مالك rejected at L4 (exact-only, unchanged)', !M.fuzzyEqual('ملك', 'مالك', 4));

// ===================== Re-audit #10 fixes (2026-09-01) =====================

// --- Bug 1: short-n/long-a {n,a} pairs must be exact-only against EITHER
// form, keyed on the word's own identity -- not on whichever form is being
// compared. Before the fix, comparing against the longer `a` form fell
// through to the ordinary length-4+ tolerance table. See
// site/tests/test-altform-bypass.js for the full 88-pair x full-corpus
// cross-check (0 false-accept opportunities at every level).
[1, 2, 3, 4, undefined].forEach(function (level) {
  // عبادي/عبادا/عباده/وعباد used to fuzzy-match the longer alt form 'عباد'
  // (dist 1-2) under the old per-form clamp; now rejected outright since
  // min('عبد'.length, 'عباد'.length) = 3 <= 3 forces exact-only.
  ['عبادي', 'عبادا', 'عباده', 'وعباد'].forEach(function (wrongWord) {
    check('short-n/long-a: ' + wrongWord + ' rejected for {n:عبد,a:عباد} at level ' + level,
      !M.matchesWord(wrongWord, { n: 'عبد', a: 'عباد' }, level));
  });
  // بل used to fuzzy-match the longer alt form 'بليا' at L1.
  check('short-n/long-a: بل rejected for {n:بلي,a:بليا} at level ' + level,
    !M.matchesWord('بل', { n: 'بلي', a: 'بليا' }, level));
  // Exact matches on EITHER form must still be accepted at every level --
  // this is the documented, intentional behavior: an expected word with
  // n.length<=3 requires the token to equal n or a exactly, and 'مالك' IS
  // the exact 'a' form of {n:'ملك',a:'مالك'}, so ASR saying مالك is still
  // correctly recognized (it is not a fuzzy match -- it is an exact one).
  check('short-n/long-a: exact n ملك accepted for {n:ملك,a:مالك} at level ' + level,
    M.matchesWord('ملك', { n: 'ملك', a: 'مالك' }, level));
  check('short-n/long-a: exact a مالك accepted for {n:ملك,a:مالك} at level ' + level,
    M.matchesWord('مالك', { n: 'ملك', a: 'مالك' }, level));
  // But a near-miss of the longer `a` form (e.g. ملكا, a single-vowel edit
  // away from مالك) is now correctly rejected -- this is exactly the class
  // of false-reveal the fix closes.
  check('short-n/long-a: near-miss ملكا rejected for {n:ملك,a:مالك} at level ' + level,
    !M.matchesWord('ملكا', { n: 'ملك', a: 'مالك' }, level));
});

// --- Bug 2: L1 tolerance is now 2 for every length > 3 (was 3 for len>6) --
// a single interior consonant substitution must be rejected at every level,
// even on long (10-11 letter) real Quran words, since CONSONANT_EDIT_COST
// (3) now exceeds the largest tolerance anywhere in the table (2).
check('toleranceFor(1, 7) is 2 (was 3 before the Iron Rule tightening)', M.toleranceFor(1, 7) === 2);
check('toleranceFor(1, 11) is 2 (was 3 before the Iron Rule tightening)', M.toleranceFor(1, 11) === 2);
var longWordSwaps = [
  ['فليستجيبوا', 'فبيستجيبوا'],
  ['والمستغفرين', 'وابمستغفرين'],
  ['والمستضعفين', 'وابمستضعفين'],
  ['المستضعفين', 'ابمستضعفين'],
  ['ويستغفرونه', 'ويبتغفرونه'],
  ['واسترهبوهم', 'وابترهبوهم'],
  ['فسينفقونها', 'فبينفقونها'],
  ['وبالمؤمنين', 'وتالمؤمنين']
];
longWordSwaps.forEach(function (pair) {
  [1, 2, 3, 4, undefined].forEach(function (level) {
    check('long-word (len' + pair[0].length + ') single consonant swap ' + pair[0] + '->' + pair[1] +
      ' rejected at level ' + level, !M.fuzzyEqual(pair[0], pair[1], level));
  });
});
// L1 stays strictly more forgiving than L2 only at length 4-5 (2 vowel-class
// edits vs 1); at length 6+ they now coincide at 2.
check('toleranceFor(1,4) > toleranceFor(2,4) (L1 more forgiving at len 4)', M.toleranceFor(1, 4) > M.toleranceFor(2, 4));
check('toleranceFor(1,5) > toleranceFor(2,5) (L1 more forgiving at len 5)', M.toleranceFor(1, 5) > M.toleranceFor(2, 5));
check('toleranceFor(1,6) === toleranceFor(2,6) (L1/L2 coincide at len 6+)', M.toleranceFor(1, 6) === M.toleranceFor(2, 6));
check('toleranceFor(1,9) === toleranceFor(2,9) (L1/L2 coincide at len 6+)', M.toleranceFor(1, 9) === M.toleranceFor(2, 9));

// --- Wrong-word storm at a short word: 0 reveals at all levels --------------
[1, 2, 3, 4, undefined].forEach(function (level) {
  r = M.matchTranscript([{ n: 'ان' }, { n: 'الذين' }, { n: 'كفروا' }], 0,
    'براءه من واعلموا مخزي الناس قال معي بعدها عذرا استطعما هل لن كي', level);
  check('wrong-word storm at short-word pointer reveals nothing at level ' + level, r.matched.length === 0 && r.pointer === 0);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
