// Frictionless accounts: guest-by-default, one-tap "save your progress",
// login-by-code-only. Talks to the server contract in server/main.py:
//   POST /account  {nickname?}         -> {code, code_raw, nickname}
//   GET  /progress  (Bearer <digits>)  -> {key: value, ...}
//   PUT  /progress  (Bearer <digits>)  -> body {key: value, ...}
// No SERVER_URL configured => isEnabled() is false and the UI shows a
// "coming soon" state; the app remains fully usable as guest either way.
(function (global) {
  'use strict';

  // Mirrors server/accounts.py normalize_code(): Arabic-Indic (٠-٩) and
  // Extended Arabic-Indic (۰-۹) digits -> Western, strip everything else.
  var DIGIT_MAP = {};
  for (var i = 0; i < 10; i++) {
    DIGIT_MAP[String.fromCharCode(0x0660 + i)] = String(i);
    DIGIT_MAP[String.fromCharCode(0x06F0 + i)] = String(i);
  }
  function normalizeCode(raw) {
    if (!raw) return '';
    var out = '';
    for (var j = 0; j < raw.length; j++) {
      var ch = raw[j];
      if (DIGIT_MAP[ch]) out += DIGIT_MAP[ch];
      else if (ch >= '0' && ch <= '9') out += ch;
    }
    return out;
  }
  function formatCode(digits) {
    if (digits.length !== 10) return digits;
    return digits.slice(0, 3) + ' ' + digits.slice(3, 6) + ' ' + digits.slice(6, 10);
  }

  function serverUrl() {
    var cfg = global.TASME3_CONFIG || {};
    return (cfg.SERVER_URL || '').replace(/\/+$/, '');
  }
  function isEnabled() { return !!serverUrl(); }

  function apiFetch(path, opts) {
    opts = opts || {};
    var url = serverUrl() + path;
    return fetch(url, opts).then(function (r) {
      if (!r.ok) {
        var err = new Error('http_' + r.status);
        err.status = r.status;
        throw err;
      }
      return r.json();
    });
  }

  function createAccount(nickname) {
    if (!isEnabled()) return Promise.reject(new Error('server_disabled'));
    return apiFetch('/account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname: nickname || null })
    });
  }

  function authHeaders(codeDigits) {
    return { Authorization: 'Bearer ' + codeDigits };
  }

  function fetchProgress(codeDigits) {
    if (!isEnabled()) return Promise.reject(new Error('server_disabled'));
    return apiFetch('/progress', { headers: authHeaders(codeDigits) });
  }

  function putProgress(codeDigits, data) {
    if (!isEnabled()) return Promise.reject(new Error('server_disabled'));
    return apiFetch('/progress', {
      method: 'PUT',
      headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders(codeDigits)),
      body: JSON.stringify(data)
    });
  }

  // Merge server progress into local state: server wins per top-level key
  // (progressByPage / streak / today / profile) when that key was returned,
  // per the sync spec in docs/BUILD-PLAN.md.
  function mergeServerIntoLocal(state, serverData) {
    if (!serverData || typeof serverData !== 'object') return state;
    var validate = global.Tasme3Storage.validate;
    var merged = {
      v: 1,
      profile: Object.prototype.hasOwnProperty.call(serverData, 'profile') ? serverData.profile : state.profile,
      progressByPage: Object.prototype.hasOwnProperty.call(serverData, 'progressByPage') ? serverData.progressByPage : state.progressByPage,
      streak: Object.prototype.hasOwnProperty.call(serverData, 'streak') ? serverData.streak : state.streak,
      today: Object.prototype.hasOwnProperty.call(serverData, 'today') ? serverData.today : state.today,
      settings: state.settings
    };
    // Re-validate after merge (a malformed server payload must not corrupt
    // local storage either — same C5a discipline applies to remote data).
    return validate(JSON.stringify(merged));
  }

  var syncTimer = null;
  var SYNC_DEBOUNCE_MS = 1500;

  // Debounced PUT of the four syncable top-level keys. Call after each
  // completed page. No-ops when logged out or server disabled.
  function scheduleSync(getState) {
    if (!isEnabled()) return;
    var state = getState();
    if (!state.profile.code) return;
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(function () {
      syncTimer = null;
      var s = getState();
      if (!s.profile.code) return;
      putProgress(s.profile.code, {
        progressByPage: s.progressByPage,
        streak: s.streak,
        today: s.today,
        profile: { nickname: s.profile.nickname }
      }).then(function () {
        s.settings.lastSyncedAt = new Date().toISOString();
        global.Tasme3Storage.save(s);
      }).catch(function () { /* best-effort; next completed page retries */ });
    }, SYNC_DEBOUNCE_MS);
  }

  function whatsAppUrl(text) {
    return 'https://wa.me/?text=' + encodeURIComponent(text);
  }

  global.Tasme3Account = {
    isEnabled: isEnabled,
    normalizeCode: normalizeCode,
    formatCode: formatCode,
    createAccount: createAccount,
    fetchProgress: fetchProgress,
    putProgress: putProgress,
    mergeServerIntoLocal: mergeServerIntoLocal,
    scheduleSync: scheduleSync,
    whatsAppUrl: whatsAppUrl
  };
})(window);
