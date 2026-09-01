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

  // Letters where an edit is a plausible accent/orthography slip rather than
  // a different word: long vowels, ta-marbuta/ha, hamza and its carriers.
  // Everything else in the ء-ي range is a true consonant — swapping one
  // changes the word's meaning (e.g. والاصر/والعصر), so it must cost more.
  var VOWEL_LETTERS = (function () {
    var set = {};
    'اويىةهءأإآؤئ'.split('').forEach(function (c) { set[c] = true; });
    return set;
  })();
  function isVowelLetter(c) { return !!VOWEL_LETTERS[c]; }

  // A pure-vowel edit (insert/delete/substitute a vowel-class letter, or
  // substitute one vowel-class letter for another) costs 1 — the same slip
  // ASR/typing routinely makes on alef/ya/ha/hamza. Any edit that touches a
  // true consonant costs 3. 3 (not the naively "matching" 2) is deliberate:
  // it must exceed L1's length<=6 tolerance of 2, otherwise a single
  // consonant swap on a mid-length word (e.g. والاصر vs والعصر, both len 6)
  // would still slip through at L1. See docs note in matching.py for the
  // parity requirement.
  var CONSONANT_EDIT_COST = 3;
  var VOWEL_EDIT_COST = 1;

  // Weighted edit distance: like Levenshtein, but each insertion/deletion of
  // a single character costs 1 if that character is vowel-class else
  // CONSONANT_EDIT_COST; each substitution costs 1 only if BOTH characters
  // are vowel-class, else CONSONANT_EDIT_COST. Used everywhere fuzzy word
  // matching happens instead of plain levenshtein() (kept above, unweighted,
  // for anyone who needs raw edit distance).
  function weightedEditDistance(a, b) {
    if (a === b) return 0;
    var m = a.length, n = b.length;
    var i, j, ca, cb, delCost, insCost, subCost;
    var prev = new Array(n + 1), cur = new Array(n + 1);
    prev[0] = 0;
    for (j = 1; j <= n; j++) {
      prev[j] = prev[j - 1] + (isVowelLetter(b.charAt(j - 1)) ? VOWEL_EDIT_COST : CONSONANT_EDIT_COST);
    }
    for (i = 1; i <= m; i++) {
      ca = a.charAt(i - 1);
      delCost = isVowelLetter(ca) ? VOWEL_EDIT_COST : CONSONANT_EDIT_COST;
      cur[0] = prev[0] + delCost;
      for (j = 1; j <= n; j++) {
        cb = b.charAt(j - 1);
        insCost = isVowelLetter(cb) ? VOWEL_EDIT_COST : CONSONANT_EDIT_COST;
        if (ca === cb) {
          subCost = 0;
        } else {
          subCost = (isVowelLetter(ca) && isVowelLetter(cb)) ? VOWEL_EDIT_COST : CONSONANT_EDIT_COST;
        }
        cur[j] = Math.min(
          prev[j] + delCost,
          cur[j - 1] + insCost,
          prev[j - 1] + subCost
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
  //
  // Words of normalized length <=3 are exact-match only (0) at EVERY level,
  // including L1: 2-3 letter Arabic particles (ان/من/لم/لا/هل/...) are
  // semantically load-bearing -- a same-length edit is a different word, not
  // an accent slip. This is enforced up front, before the per-level table,
  // which now only ever sees len > 3.
  function toleranceFor(level, len) {
    if (len <= 3) return 0;
    switch (level) {
      case 1: return len <= 6 ? 2 : 3;
      case 3: return len <= 4 ? 0 : len <= 7 ? 1 : 2;
      case 4: return 0;
      case 2:
      default: return len <= 5 ? 1 : 2;
    }
  }

  // Tolerance grows with word length: short words must be near-exact.
  // Distance is the weighted edit distance (see above), so a meaning-
  // changing consonant swap needs a much larger allowance than a vowel slip.
  function fuzzyEqual(a, b, level) {
    if (a === b) return true;
    var len = Math.max(a.length, b.length);
    var maxDist = toleranceFor(level, len);
    if (maxDist <= 0) return false;
    return weightedEditDistance(a, b) <= maxDist;
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

  // Merged token covering two consecutive expected words. A merged match
  // must be a verified SPLIT: some cut point of tok such that the prefix
  // fuzzy-matches word1 under word1's OWN per-word tolerance and the suffix
  // fuzzy-matches word2 under word2's OWN per-word tolerance (each tried
  // against both its n/a forms). There is deliberately no tolerance derived
  // from the concatenated length any more -- that was the false-reveal
  // loophole (a lone word2 could satisfy a loose tolerance sized for
  // word1+word2 combined, revealing the never-spoken word1).
  function matchesMerged(tok, item1, item2, level) {
    var forms1 = wordForms(item1), forms2 = wordForms(item2);
    for (var k = 1; k < tok.length; k++) {
      var part1 = tok.slice(0, k), part2 = tok.slice(k);
      for (var i = 0; i < forms1.length; i++) {
        if (!fuzzyEqual(part1, forms1[i], level)) continue;
        for (var j = 0; j < forms2.length; j++) {
          if (fuzzyEqual(part2, forms2[j], level)) return true;
        }
      }
    }
    return false;
  }

  // Merged token covering three consecutive expected words: same split-
  // verification principle, with two cut points. Handles genuinely
  // triple-glued ASR/typed input (three words run together with no
  // separator) that a two-word merge alone would reject outright.
  function matchesMerged3(tok, item1, item2, item3, level) {
    var forms1 = wordForms(item1), forms2 = wordForms(item2), forms3 = wordForms(item3);
    for (var k1 = 1; k1 < tok.length - 1; k1++) {
      var part1 = tok.slice(0, k1);
      var i, matched1 = false;
      for (i = 0; i < forms1.length; i++) {
        if (fuzzyEqual(part1, forms1[i], level)) { matched1 = true; break; }
      }
      if (!matched1) continue;
      for (var k2 = k1 + 1; k2 < tok.length; k2++) {
        var part2 = tok.slice(k1, k2), part3 = tok.slice(k2);
        var j, matched2 = false;
        for (j = 0; j < forms2.length; j++) {
          if (fuzzyEqual(part2, forms2[j], level)) { matched2 = true; break; }
        }
        if (!matched2) continue;
        for (var l = 0; l < forms3.length; l++) {
          if (fuzzyEqual(part3, forms3[l], level)) return true;
        }
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
      // merged token covering the next three expected words (genuinely
      // triple-glued input, e.g. no separators at all between them)
      if (pointer + 2 < expected.length &&
          matchesMerged3(tok, expected[pointer], expected[pointer + 1], expected[pointer + 2], level)) {
        matched.push(pointer, pointer + 1, pointer + 2);
        pointer += 3;
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
    weightedEditDistance: weightedEditDistance,
    toleranceFor: toleranceFor,
    fuzzyEqual: fuzzyEqual,
    matchesMerged: matchesMerged,
    matchesMerged3: matchesMerged3,
    matchTranscript: matchTranscript
  };
});
