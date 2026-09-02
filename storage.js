// Versioned, schema-validated localStorage for guest + frictionless-account
// progress. Fixes audit C5a/C5b:
//   C5a — a single corrupted top-level key must NEVER wipe the rest of the
//         user's progress. Every key is validated and repaired
//         independently; only that one key falls back to its default.
//   C5b — "today"/streak day boundaries use LOCAL calendar dates (this
//         function is the ONE place that computes them — every other file
//         must call Tasme3Storage.todayKey(), never build a date string
//         itself), so streaks don't flip at UTC midnight (~3am Istanbul,
//         ~5am Karachi, ~7am Jakarta).
// Also fixes storage-corruption audit findings 1 and 3:
//   Finding 1 — save() re-reads localStorage and MERGEs into it (union of
//         revealed/contextRevealed, max pointer, latest completedAt/streak/
//         today) rather than overwriting from a possibly-stale in-memory
//         snapshot, so two tabs (or a tab + a background sync) never clobber
//         each other's progress. See mergeProgress()/save() below, and
//         app.js's `storage` event listener for the live cross-tab refresh.
//   Finding 3 — repairProgressByPage (and every merge) dedupes revealed/
//         contextRevealed via Set, drops non-integers, and caps each at
//         MAX_INDICES_PER_PAGE so a corrupted or hostile blob can't grow
//         either array without bound.
(function (global) {
  'use strict';

  var KEY = 'tasme3_v1';
  // v2 adds progressByPage[page].contextRevealed (see repairProgressByPage) --
  // purely additive: a v1 blob (or any entry missing the field) repairs to
  // contextRevealed: [] below, so no migration branch is needed beyond the
  // repair defaulting -- old data loads and works exactly as it did.
  // v3 adds the top-level `installPromo` counter (founder idea #2: the PWA
  // install card fires from the user's SECOND session onward, never the
  // first) and settings.focusLineMode (founder idea #3's auto/on/off
  // landscape toggle) -- both purely additive, same repair-defaulting
  // pattern, no migration branch needed.
  var SCHEMA_VERSION = 3;

  // Kept in sync with site/listen.js's CHAINS keys (not read from there
  // directly — this file loads before listen.js and must validate/repair
  // independently of script load order).
  var VALID_RECITER_SETS = ['murattal', 'muallim', 'minshawi', 'abdulbasit', 'alafasy'];

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  // Local (not UTC) calendar-date key, e.g. "2026-09-01". The single shared
  // date helper referenced everywhere streak/today logic needs "which day is
  // this" (audit C5b).
  function todayKey(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  // Days between two "YYYY-MM-DD" local date keys (b - a), using noon to
  // dodge DST edge cases entirely.
  function daysBetween(aKey, bKey) {
    var a = new Date(aKey + 'T12:00:00');
    var b = new Date(bKey + 'T12:00:00');
    return Math.round((b - a) / 86400000);
  }

  function defaultProfile() { return { nickname: null, code: null }; }
  // sessionCount: incremented once per fresh page load (see app.js init) --
  // the install-promo card is eligible only once this reaches 2 (the user's
  // SECOND session), never on their first visit. dismissed: forever, once
  // the user closes the card or installs the app.
  function defaultInstallPromo() { return { sessionCount: 0, dismissed: false }; }
  function defaultStreak() { return { count: 0, lastActiveDate: null }; }
  function defaultToday() { return { date: todayKey(), wordsRevealed: 0, pagesCompleted: 0 }; }
  function defaultSettings() {
    return {
      lang: null, // null = autodetect from browser on first run
      level: 2,
      listenRepeat: false,
      reciterSet: 'murattal',
      lastSyncedAt: null,
      name: null, // optional, user-supplied, never required (founder feature)
      lastPage: null, // raw 1..604 page number; app.js clamps to the navigable
                       // range [3,604] on restore -- pages 1-2 are ornamental
                       // and excluded from the standard flow (founder decision)
      listenPanelOpen: false, // remembers whether the compact bottom bar's
                              // listen/reciter slide-up panel was left open
      focusLineMode: 'auto' // founder idea #3: 'auto' (the landscape+short-
                             // height heuristic) | 'on' (always) | 'off' (never)
    };
  }
  function defaultState() {
    return {
      v: SCHEMA_VERSION,
      profile: defaultProfile(),
      progressByPage: {},
      streak: defaultStreak(),
      today: defaultToday(),
      settings: defaultSettings(),
      installPromo: defaultInstallPromo()
    };
  }

  function isPlainObject(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }

  // Audit finding 3 (unbounded arrays): a corrupted or maliciously-grown
  // revealed/contextRevealed array must never be trusted verbatim -- dedupe
  // via Set (repeated writes/merges can otherwise pile up duplicates
  // forever), drop anything that isn't a non-negative integer (word
  // indices only), and cap at MAX_INDICES_PER_PAGE entries. No real mushaf
  // page holds anywhere near that many words, so the cap only ever bites
  // corrupt/hostile data -- sorted ascending first so a cap always keeps
  // the earliest (lowest-index, most meaningful) words rather than
  // whatever happened to appear first in a scrambled array.
  var MAX_INDICES_PER_PAGE = 400;
  function dedupeCapped(arr, max) {
    if (!Array.isArray(arr)) return [];
    var set = new Set();
    arr.forEach(function (n) { if (Number.isInteger(n) && n >= 0) set.add(n); });
    var out = Array.from(set).sort(function (a, b) { return a - b; });
    if (out.length > max) out = out.slice(0, max);
    return out;
  }

  // Validate/repair ONE top-level key. Never throws; always returns
  // something usable, falling back to the default for just that key.
  function repairProfile(v) {
    if (!isPlainObject(v)) return defaultProfile();
    return {
      nickname: typeof v.nickname === 'string' ? v.nickname.slice(0, 60) : null,
      code: typeof v.code === 'string' && /^\d{10}$/.test(v.code) ? v.code : null
    };
  }
  function repairProgressByPage(v) {
    if (!isPlainObject(v)) return {};
    var out = {};
    for (var key in v) {
      if (!Object.prototype.hasOwnProperty.call(v, key)) continue;
      var pageNum = parseInt(key, 10);
      if (!(pageNum >= 1 && pageNum <= 604)) continue;
      var entry = v[key];
      if (!isPlainObject(entry)) continue;
      var pointer = Number.isFinite(entry.pointer) && entry.pointer >= 0 ? entry.pointer : 0;
      var revealed = dedupeCapped(entry.revealed, MAX_INDICES_PER_PAGE);
      // contextRevealed: word indices shown unveiled as printed CONTEXT
      // (the tail of a preceding surah, unveiled so the reader can see it
      // sits before the chosen surah) after a surah-start jump from the
      // drawer -- see site/app.js's applyPageData(). Tracked separately
      // from `revealed` on purpose and validated the same defensive way:
      // CRITICAL that these two sets are never merged anywhere, since
      // context words were never actually recited and must stay excluded
      // from every completion/counter/certificate/sync computation that
      // reads `revealed`. Missing on any pre-v2 entry -> defaults to [].
      var contextRevealed = dedupeCapped(entry.contextRevealed, MAX_INDICES_PER_PAGE);
      var completedAt = typeof entry.completedAt === 'string' ? entry.completedAt : null;
      out[key] = { pointer: pointer, revealed: revealed, contextRevealed: contextRevealed, completedAt: completedAt };
    }
    return out;
  }
  function repairInstallPromo(v) {
    if (!isPlainObject(v)) return defaultInstallPromo();
    return {
      sessionCount: Number.isFinite(v.sessionCount) && v.sessionCount >= 0 ? v.sessionCount : 0,
      dismissed: typeof v.dismissed === 'boolean' ? v.dismissed : false
    };
  }
  function repairStreak(v) {
    if (!isPlainObject(v)) return defaultStreak();
    return {
      count: Number.isFinite(v.count) && v.count >= 0 ? v.count : 0,
      lastActiveDate: typeof v.lastActiveDate === 'string' ? v.lastActiveDate : null
    };
  }
  function repairToday(v) {
    if (!isPlainObject(v)) return defaultToday();
    var wordsRevealed = Number.isFinite(v.wordsRevealed) && v.wordsRevealed >= 0 ? v.wordsRevealed : 0;
    var pagesCompleted = Number.isFinite(v.pagesCompleted) && v.pagesCompleted >= 0 ? v.pagesCompleted : 0;
    var date = typeof v.date === 'string' ? v.date : todayKey();
    // Roll over to a fresh day if the stored date isn't today (local).
    if (date !== todayKey()) return defaultToday();
    return { date: date, wordsRevealed: wordsRevealed, pagesCompleted: pagesCompleted };
  }
  function repairSettings(v) {
    var d = defaultSettings();
    if (!isPlainObject(v)) return d;
    return {
      lang: typeof v.lang === 'string' ? v.lang : d.lang,
      level: [1, 2, 3, 4].indexOf(v.level) !== -1 ? v.level : d.level,
      listenRepeat: typeof v.listenRepeat === 'boolean' ? v.listenRepeat : d.listenRepeat,
      reciterSet: (VALID_RECITER_SETS.indexOf(v.reciterSet) !== -1) ? v.reciterSet : d.reciterSet,
      lastSyncedAt: typeof v.lastSyncedAt === 'string' ? v.lastSyncedAt : null,
      name: (typeof v.name === 'string' && v.name.trim()) ? v.name.trim().slice(0, 40) : null,
      lastPage: (Number.isFinite(v.lastPage) && v.lastPage >= 1 && v.lastPage <= 604) ? v.lastPage : null,
      listenPanelOpen: typeof v.listenPanelOpen === 'boolean' ? v.listenPanelOpen : false,
      focusLineMode: ['auto', 'on', 'off'].indexOf(v.focusLineMode) !== -1 ? v.focusLineMode : d.focusLineMode
    };
  }

  // Parse + repair the whole blob key-by-key (C5a: one bad key never wipes
  // the others). Also handles totally missing/corrupt localStorage.
  function validate(raw) {
    var parsed = null;
    if (raw) {
      try { parsed = JSON.parse(raw); } catch (_) { parsed = null; }
    }
    if (!isPlainObject(parsed)) parsed = {};
    return {
      v: SCHEMA_VERSION,
      profile: repairProfile(parsed.profile),
      progressByPage: repairProgressByPage(parsed.progressByPage),
      streak: repairStreak(parsed.streak),
      today: repairToday(parsed.today),
      settings: repairSettings(parsed.settings),
      installPromo: repairInstallPromo(parsed.installPromo)
    };
  }

  function load() {
    var raw = null;
    try { raw = global.localStorage.getItem(KEY); } catch (_) { raw = null; }
    return validate(raw);
  }

  // -------------------------------------------------- multi-tab merge
  // Audit finding 1 (multi-tab clobber): save() used to write the whole
  // blob straight from this tab's in-memory snapshot, silently discarding
  // anything a concurrent tab had written to localStorage since this tab's
  // last load/save (two tabs open on different pages, or the same page,
  // each reciting -- one tab's save wiped the other's words). Every merge
  // below is symmetric/commutative (union, max, latest-date) so it gives
  // the same result regardless of which side is "a" and which is "b" --
  // only the non-progress fields (profile/settings/installPromo) need a
  // tie-break, and callers decide that by which side they pass as `b`.

  // completedAt/lastActiveDate/today.date are all todayKey() "YYYY-MM-DD"
  // strings (or null) -- plain lexicographic comparison is correct and
  // sidesteps any timezone/Date-parsing edge case entirely.
  function laterDateStr(a, b) {
    if (!a) return b || null;
    if (!b) return a;
    return a > b ? a : b;
  }

  function mergeProgressEntry(a, b) {
    if (!a) return b;
    if (!b) return a;
    var revealed = dedupeCapped((a.revealed || []).concat(b.revealed || []), MAX_INDICES_PER_PAGE);
    var revealedSet = {};
    revealed.forEach(function (n) { revealedSet[n] = true; });
    // contextRevealed must never include anything now genuinely revealed on
    // either side (see repairProgressByPage's comment on the two sets never
    // mixing) -- filtered out here, not just at repair time.
    var contextRevealed = dedupeCapped((a.contextRevealed || []).concat(b.contextRevealed || []), MAX_INDICES_PER_PAGE)
      .filter(function (n) { return !revealedSet[n]; });
    return {
      pointer: Math.max(a.pointer || 0, b.pointer || 0),
      revealed: revealed,
      contextRevealed: contextRevealed,
      completedAt: laterDateStr(a.completedAt, b.completedAt)
    };
  }

  function mergeProgressByPage(a, b) {
    a = a || {}; b = b || {};
    var out = {};
    var key;
    for (key in a) { if (Object.prototype.hasOwnProperty.call(a, key)) out[key] = a[key]; }
    for (key in b) {
      if (!Object.prototype.hasOwnProperty.call(b, key)) continue;
      out[key] = mergeProgressEntry(out[key], b[key]);
    }
    return out;
  }

  function mergeStreak(a, b) {
    if (!a) return b || defaultStreak();
    if (!b) return a;
    if (a.lastActiveDate === b.lastActiveDate) {
      return { count: Math.max(a.count, b.count), lastActiveDate: a.lastActiveDate };
    }
    if (!a.lastActiveDate) return b;
    if (!b.lastActiveDate) return a;
    return a.lastActiveDate > b.lastActiveDate ? a : b;
  }

  function mergeToday(a, b) {
    if (!a) return b || defaultToday();
    if (!b) return a;
    if (a.date === b.date) {
      return {
        date: a.date,
        wordsRevealed: Math.max(a.wordsRevealed, b.wordsRevealed),
        pagesCompleted: Math.max(a.pagesCompleted, b.pagesCompleted)
      };
    }
    return a.date > b.date ? a : b;
  }

  // Merges just the three progress-shaped keys of two validated states --
  // exported so app.js's cross-tab `storage` listener can fold an
  // externally-written blob into this tab's live in-memory state with the
  // exact same semantics save() uses on write, rather than ever adopting
  // (or discarding) one side wholesale.
  function mergeProgress(a, b) {
    return {
      progressByPage: mergeProgressByPage(a.progressByPage, b.progressByPage),
      streak: mergeStreak(a.streak, b.streak),
      today: mergeToday(a.today, b.today)
    };
  }

  // Tracks the exact JSON string this tab itself last wrote, so a `storage`
  // listener (which normally never even fires for the writing tab's own
  // document per spec) has a cheap, explicit belt-and-suspenders guard
  // against ever treating its own write as an external change.
  var _lastWrittenRaw = null;
  function lastWrittenRaw() { return _lastWrittenRaw; }

  function save(state) {
    try {
      var raw = null;
      try { raw = global.localStorage.getItem(KEY); } catch (_) { raw = null; }
      if (raw) {
        var stored = validate(raw);
        var merged = mergeProgress(stored, state);
        // Reflected back onto the caller's own state object -- so a page
        // that only ever reads `state` (never re-`load()`s) still sees the
        // union immediately, e.g. Storage.totalWordsRevealed(state) right
        // after this call.
        state.progressByPage = merged.progressByPage;
        state.streak = merged.streak;
        state.today = merged.today;
      }
      // v/profile/settings/installPromo are NOT merged -- this tab's
      // current values win outright for those (per spec: they're
      // per-device/session choices, not accumulating progress).
      var out = JSON.stringify(state);
      global.localStorage.setItem(KEY, out);
      _lastWrittenRaw = out;
      return true;
    } catch (_) {
      return false; // storage full/blocked — caller keeps working in memory
    }
  }

  // Ensures streak/today are rolled forward to "now" (call on load and
  // whenever the tab regains focus / at page-complete time), local dates
  // throughout.
  function rollDay(state) {
    var t = todayKey();
    if (state.today.date !== t) {
      state.today = { date: t, wordsRevealed: 0, pagesCompleted: 0 };
    }
    return state;
  }

  // Call once when the user completes their first page of the (local) day.
  // Streak increments only on the FIRST completed page of a new day;
  // consecutive days extend it, a gap resets it to 1.
  function markPageCompleted(state, pageNum) {
    var t = todayKey();
    rollDay(state);
    state.today.pagesCompleted += 1;
    if (state.streak.lastActiveDate !== t) {
      if (state.streak.lastActiveDate && daysBetween(state.streak.lastActiveDate, t) === 1) {
        state.streak.count += 1;
      } else {
        state.streak.count = 1;
      }
      state.streak.lastActiveDate = t;
    }
    var page = state.progressByPage[String(pageNum)];
    if (page) page.completedAt = t;
    return state;
  }

  function addWordsRevealedToday(state, n) {
    if (!n) return state;
    rollDay(state);
    state.today.wordsRevealed += n;
    return state;
  }

  // Lifetime word count for the progress panel. Deliberately sums only
  // `.revealed` (genuinely recited) and never `.contextRevealed` (printed
  // context unveiled by a surah-start jump, never actually recited) --
  // see repairProgressByPage's contextRevealed comment.
  function totalWordsRevealed(state) {
    var total = 0;
    for (var k in state.progressByPage) {
      if (Object.prototype.hasOwnProperty.call(state.progressByPage, k)) {
        total += state.progressByPage[k].revealed.length;
      }
    }
    return total;
  }

  global.Tasme3Storage = {
    KEY: KEY,
    todayKey: todayKey,
    daysBetween: daysBetween,
    defaultState: defaultState,
    validate: validate,
    load: load,
    save: save,
    rollDay: rollDay,
    markPageCompleted: markPageCompleted,
    addWordsRevealedToday: addWordsRevealedToday,
    totalWordsRevealed: totalWordsRevealed,
    mergeProgress: mergeProgress,
    lastWrittenRaw: lastWrittenRaw
  };
})(window);
