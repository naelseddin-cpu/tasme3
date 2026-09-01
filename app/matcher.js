// Word matching for Quran recitation checking.
// The expected text is always known, so this is alignment, not open dictation:
// we only decide whether the next expected word was said.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QuranMatcher = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  // Strip everything that differs between Uthmani script, plain typing, and
  // ASR output: tashkeel, quranic annotation marks, tatweel; unify alef,
  // ya/alef-maqsura and ta-marbuta forms. Keep ONLY Arabic letters ء-ي —
  // everything else (Arabic punctuation ،؛؟, Arabic-Indic digits, Latin,
  // symbols) is deleted.
  function normalizeArabic(s) {
    return s
      .replace(/[ً-ٰٟۖ-ۭـؐ-ؚ]/g, '')
      .replace(/[آأإٱٲٳٵ]/g, 'ا') // آأإٱ… → ا
      .replace(/ة/g, 'ه')  // ة → ه
      .replace(/ى/g, 'ي')  // ى → ي
      .replace(/[^ء-ي]/g, '');
  }

  // Alternate form: identical pipeline, but dagger-alif (U+0670) is mapped to
  // a plain alif BEFORE the tashkeel strip, instead of being deleted with it.
  // Fixes قَٰلَ ("he said") normalizing to the same string as قُلْ ("Say!");
  // the matcher accepts a token matching either normalizeArabic() or this.
  function normalizeArabicAlt(s) {
    return s
      .replace(/ٰ/g, 'ا') // dagger alif → ا, applied before the strip below
      .replace(/[ً-ٰٟۖ-ۭـؐ-ؚ]/g, '')
      .replace(/[آأإٱٲٳٵ]/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/ى/g, 'ي')
      .replace(/[^ء-ي]/g, '');
  }

  // Split raw ASR text into candidate Arabic word tokens.
  function tokenize(text) {
    return text
      .split(/[^ء-ٰٟ-ۭ]+/)
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

  // Tolerance table per difficulty level. Strictly decreasing as level rises
  // (L1 >= L2 >= L3 >= L4 at every length) so acceptance at a stricter level
  // implies acceptance at every looser level.
  // Level omitted (undefined) behaves exactly like level 2 (today's default).
  function toleranceFor(level, len) {
    switch (level) {
      case 1: return len <= 3 ? 1 : len <= 6 ? 2 : 3;
      case 3: return len <= 4 ? 0 : len <= 7 ? 1 : 2;
      case 4: return 0;
      case 2:
      default: return len <= 3 ? 0 : len <= 5 ? 1 : 2;
    }
  }

  // Tolerance grows with word length: short words must be near-exact.
  function fuzzyEqual(a, b, level) {
    if (a === b) return true;
    var len = Math.max(a.length, b.length);
    var maxDist = toleranceFor(level, len);
    return levenshtein(a, b) <= maxDist;
  }

  // An expected-word entry is either a plain normalized string (legacy) or
  // {n, a} where `a` is an optional alternate normalized form. Returns the
  // list of forms a spoken token may match against.
  function wordForms(item) {
    if (typeof item === 'string') return [item];
    var forms = [item.n];
    if (item.a && item.a !== item.n) forms.push(item.a);
    return forms;
  }

  function matchesWord(tok, item, level) {
    var forms = wordForms(item);
    for (var i = 0; i < forms.length; i++) {
      if (fuzzyEqual(tok, forms[i], level)) return true;
    }
    return false;
  }

  // Merged token covering two consecutive expected words: try all
  // combinations of each word's n/a forms.
  function matchesMerged(tok, item1, item2, level) {
    var forms1 = wordForms(item1), forms2 = wordForms(item2);
    for (var i = 0; i < forms1.length; i++) {
      for (var j = 0; j < forms2.length; j++) {
        if (fuzzyEqual(tok, forms1[i] + forms2[j], level)) return true;
      }
    }
    return false;
  }

  // Greedy alignment of one utterance against the expected sequence,
  // starting at `pointer`. ASR noise tokens are skipped; two consecutive
  // expected words may be matched by one merged ASR token. `expected` is an
  // array of either strings or {n, a} objects (see wordForms above).
  // Returns { pointer, matched: [indices revealed this call] }.
  function matchTranscript(expected, pointer, transcriptText, level) {
    var tokens = tokenize(transcriptText);
    var matched = [];
    for (var i = 0; i < tokens.length && pointer < expected.length; i++) {
      var tok = tokens[i];
      if (matchesWord(tok, expected[pointer], level)) {
        matched.push(pointer);
        pointer++;
        continue;
      }
      // merged token covering the next two expected words
      if (pointer + 1 < expected.length &&
          matchesMerged(tok, expected[pointer], expected[pointer + 1], level)) {
        matched.push(pointer, pointer + 1);
        pointer += 2;
        continue;
      }
      // token is a repeat of an already-revealed recent word (user restarted
      // the ayah) — ignore it rather than treating it as an error
      var isRepeat = false;
      for (var back = Math.max(0, pointer - 8); back < pointer; back++) {
        if (matchesWord(tok, expected[back], level)) { isRepeat = true; break; }
      }
      if (isRepeat) continue;
      // otherwise: unrecognized word — skip it, pointer stays (user must retry)
    }
    return { pointer: pointer, matched: matched };
  }

  return {
    normalizeArabic: normalizeArabic,
    normalizeArabicAlt: normalizeArabicAlt,
    tokenize: tokenize,
    levenshtein: levenshtein,
    fuzzyEqual: fuzzyEqual,
    matchTranscript: matchTranscript
  };
});
