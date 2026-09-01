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
(function (global) {
  'use strict';

  var KEY = 'tasme3_v1';
  var SCHEMA_VERSION = 1;

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
  function defaultStreak() { return { count: 0, lastActiveDate: null }; }
  function defaultToday() { return { date: todayKey(), wordsRevealed: 0, pagesCompleted: 0 }; }
  function defaultSettings() {
    return {
      lang: null, // null = autodetect from browser on first run
      level: 2,
      listenRepeat: false,
      reciterSet: 'murattal',
      lastSyncedAt: null
    };
  }
  function defaultState() {
    return {
      v: SCHEMA_VERSION,
      profile: defaultProfile(),
      progressByPage: {},
      streak: defaultStreak(),
      today: defaultToday(),
      settings: defaultSettings()
    };
  }

  function isPlainObject(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }

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
      var revealed = Array.isArray(entry.revealed)
        ? entry.revealed.filter(function (n) { return Number.isFinite(n) && n >= 0; })
        : [];
      var completedAt = typeof entry.completedAt === 'string' ? entry.completedAt : null;
      out[key] = { pointer: pointer, revealed: revealed, completedAt: completedAt };
    }
    return out;
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
      reciterSet: (v.reciterSet === 'murattal' || v.reciterSet === 'muallim') ? v.reciterSet : d.reciterSet,
      lastSyncedAt: typeof v.lastSyncedAt === 'string' ? v.lastSyncedAt : null
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
      settings: repairSettings(parsed.settings)
    };
  }

  function load() {
    var raw = null;
    try { raw = global.localStorage.getItem(KEY); } catch (_) { raw = null; }
    return validate(raw);
  }

  function save(state) {
    try {
      global.localStorage.setItem(KEY, JSON.stringify(state));
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
    totalWordsRevealed: totalWordsRevealed
  };
})(window);
