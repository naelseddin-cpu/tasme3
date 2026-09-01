/**
 * matcher.js — Pure text-matching logic for Quran recitation.
 * No DOM access. No side effects.
 */

/**
 * Strip tashkeel, quranic marks, tatweel; unify letter variants;
 * keep only Arabic letters and spaces.
 */
export function normalizeArabic(s) {
  if (!s || typeof s !== "string") return "";
  return (
    s
      // Tatweel (kashida)
      .replace(/ـ/g, "")
      // Tashkeel / diacritics
      .replace(/[ً-ٰٟ]/g, "")
      // Quranic annotation signs (pause marks, sajda, etc.)
      .replace(/[ؐ-ؚۖ-ۭ]/g, "")
      // Hamza placement marks
      .replace(/[ٕٓٔ]/g, "")
      // Unify alef variants
      .replace(/[آأإٱ]/g, "ا")
      // Unify ta marbuta
      .replace(/ة/g, "ه")
      // Unify alif maksura
      .replace(/ى/g, "ي")
      // Keep only Arabic block letters and whitespace
      .replace(/[^؀-ۿ\s]/g, "")
      // Collapse multiple spaces
      .replace(/\s+/g, " ")
      .trim()
  );
}

/**
 * Standard Levenshtein edit distance.
 */
export function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  // Use two rows for O(min(m,n)) space
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    const ai = a[i - 1];
    for (let j = 1; j <= n; j++) {
      const cost = ai === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,      // deletion
        curr[j - 1] + 1,  // insertion
        prev[j - 1] + cost // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/**
 * Fuzzy equality with tolerance based on difficulty level and word length.
 * level: 1 = Beginner, 2 = Intermediate, 3 = Precise
 */
export function fuzzyEqual(a, b, level) {
  if (a === b) return true;
  const dist = levenshtein(a, b);
  const len = Math.max(a.length, b.length);

  let tolerance;
  if (level === 1) {
    // Beginner — very forgiving
    if (len <= 3) tolerance = 1;
    else if (len <= 6) tolerance = 2;
    else tolerance = 3;
  } else if (level === 2) {
    // Intermediate — moderate
    if (len <= 3) tolerance = 0;
    else if (len <= 6) tolerance = 1;
    else tolerance = 2;
  } else {
    // Precise — near-exact
    if (len <= 4) tolerance = 0;
    else if (len <= 7) tolerance = 1;
    else tolerance = 2;
  }

  return dist <= tolerance;
}

/**
 * Greedy alignment of ASR transcript against expected Quran words.
 *
 * @param {string[]} expectedNormalizedWords — normalized expected words
 * @param {number}   pointerIndex            — next word index to match
 * @param {string}   transcriptText          — normalized ASR output
 * @param {number}   level                   — difficulty 1|2|3
 * @returns {{pointer: number, matched: number[]}}
 *
 * Rules:
 *  - Advances pointer only on a match.
 *  - Skips tokens that look like ASR noise.
 *  - Tolerates one token that merges two consecutive expected words.
 *  - Ignores repeats of words revealed in the current window.
 *  - Never auto-passes an unmatched word.
 */
export function matchTranscript(expectedNormalizedWords, pointerIndex, transcriptText, level) {
  const tokens = transcriptText.split(/\s+/).filter((t) => t.length > 0);
  const matched = [];
  let pointer = pointerIndex;
  const recentlyRevealedWindow = 5; // how far back we ignore repeats

  for (const token of tokens) {
    if (pointer >= expectedNormalizedWords.length) break;

    // 1) Direct match at current pointer
    if (fuzzyEqual(token, expectedNormalizedWords[pointer], level)) {
      matched.push(pointer);
      pointer++;
      continue;
    }

    // 2) Merged-word tolerance: one spoken token = two written words concatenated
    if (pointer + 1 < expectedNormalizedWords.length) {
      const merged = expectedNormalizedWords[pointer] + expectedNormalizedWords[pointer + 1];
      if (fuzzyEqual(token, merged, level)) {
        matched.push(pointer);
        matched.push(pointer + 1);
        pointer += 2;
        continue;
      }
    }

    // 3) Ignore repeats of recently revealed words (user restarting an ayah)
    let isRepeat = false;
    const startCheck = Math.max(0, pointer - recentlyRevealedWindow);
    for (let i = startCheck; i < pointer; i++) {
      if (fuzzyEqual(token, expectedNormalizedWords[i], level)) {
        isRepeat = true;
        break;
      }
    }
    if (isRepeat) continue;

    // 4) Noise token — skip silently
  }

  return { pointer, matched };
}
