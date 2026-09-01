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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
