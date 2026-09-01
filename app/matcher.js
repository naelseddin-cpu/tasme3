// Word matching for Quran recitation checking.
// The expected text is always known, so this is alignment, not open dictation:
// we only decide whether the next expected word was said.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QuranMatcher = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  // Strip everything that differs between Uthmani script, plain typing, and
  // ASR output: tashkeel, quranic annotation marks, tatweel; unify alef,
  // ya/alef-maqsura and ta-marbuta forms.
  function normalizeArabic(s) {
    return s
      .replace(/[ً-ٰٟۖ-ۭـؐ-ؚ]/g, '')
      .replace(/[آأإٱٲٳٵ]/g, 'ا') // آأإٱ… → ا
      .replace(/ة/g, 'ه')  // ة → ه
      .replace(/ى/g, 'ي')  // ى → ي
      .replace(/[^ء-ي]/g, '');
  }

  // Split raw ASR text into candidate Arabic word tokens.
  function tokenize(text) {
    return text
      .split(/[^ء-ٰٟ-ۭ]+/)
      .map(normalizeArabic)
      .filter(function (w) { return w.length > 0; });
  }

  function levenshtein(a, b) {
    if (a === b) return 0;
    var m = a.length, n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    var prev = new Array(n + 1), cur = new Array(n + 1), i, j;
    for (j = 0; j <= n; j++) prev[j] = j;
    for (i = 1; i <= m; i++) {
      cur[0] = i;
      for (j = 1; j <= n; j++) {
        cur[j] = Math.min(
          prev[j] + 1,
          cur[j - 1] + 1,
          prev[j - 1] + (a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1)
        );
      }
      var t = prev; prev = cur; cur = t;
    }
    return prev[n];
  }

  // Tolerance grows with word length: short words must be near-exact.
  function fuzzyEqual(a, b) {
    if (a === b) return true;
    var len = Math.max(a.length, b.length);
    var maxDist = len <= 3 ? 0 : len <= 5 ? 1 : 2;
    return levenshtein(a, b) <= maxDist;
  }

  // Greedy alignment of one utterance against the expected sequence,
  // starting at `pointer`. ASR noise tokens are skipped; two consecutive
  // expected words may be matched by one merged ASR token.
  // Returns { pointer, matched: [indices revealed this call] }.
  function matchTranscript(expectedNormalized, pointer, transcriptText) {
    var tokens = tokenize(transcriptText);
    var matched = [];
    for (var i = 0; i < tokens.length && pointer < expectedNormalized.length; i++) {
      var tok = tokens[i];
      if (fuzzyEqual(tok, expectedNormalized[pointer])) {
        matched.push(pointer);
        pointer++;
        continue;
      }
      // merged token covering the next two expected words
      if (pointer + 1 < expectedNormalized.length &&
          fuzzyEqual(tok, expectedNormalized[pointer] + expectedNormalized[pointer + 1])) {
        matched.push(pointer, pointer + 1);
        pointer += 2;
        continue;
      }
      // token is a repeat of an already-revealed recent word (user restarted
      // the ayah) — ignore it rather than treating it as an error
      var isRepeat = false;
      for (var back = Math.max(0, pointer - 8); back < pointer; back++) {
        if (fuzzyEqual(tok, expectedNormalized[back])) { isRepeat = true; break; }
      }
      if (isRepeat) continue;
      // otherwise: unrecognized word — skip it, pointer stays (user must retry)
    }
    return { pointer: pointer, matched: matched };
  }

  return {
    normalizeArabic: normalizeArabic,
    tokenize: tokenize,
    levenshtein: levenshtein,
    fuzzyEqual: fuzzyEqual,
    matchTranscript: matchTranscript
  };
});
