(function () {
  'use strict';

  var t = null; // set after i18n ready: Tasme3I18n.t
  var Utils = window.Tasme3Utils;
  var Storage = window.Tasme3Storage;
  var Matcher = window.QuranMatcher;

  var SERVER_URL = ((window.TASME3_CONFIG || {}).SERVER_URL || '').replace(/\/+$/, '');
  var SERVER_MODE = !!SERVER_URL;

  var MIN_PAGE = 1, MAX_PAGE = 604, NAV_MIN = 3, NAV_MAX = 604;
  var LEGACY_PAGES = new Set([1, 2, 596, 597, 598, 599, 600, 601, 602, 603, 604]);
  var SHEET = '#fffdf5', GOLD = '#b8a24a';
  var STREAK_MILESTONES = [7, 30, 100];

  // ---------------------------------------------------------------- state
  var state = Storage.load();
  Storage.rollDay(state);
  Storage.save(state);

  var level = state.settings.level || 2;
  var pageNum = 3;
  var ratio = 1, currentVeil = SHEET;
  var tokens = [], words = [], expected = [], markersByWord = {};
  var pointer = 0, revealed = new Set();
  var pageImage = null;
  var evalInFlight = false;
  var surahIndex = null; // { surahs:[], juz:[], pageCount }
  var recorder = new window.Tasme3Recorder();
  var listener = new window.Tasme3Listen.Listener();
  var pageBoxesPromise = null;

  function pad3(n) { return String(n).padStart(3, '0'); }
  function digits(n) {
    var lang = window.Tasme3I18n.currentLang();
    return lang === 'ar' ? Utils.toArabicDigits(n) : String(n);
  }

  // ------------------------------------------------------------- elements
  var el = {};
  [
    'menuBtn', 'langSelect', 'fsBtn', 'nextPg', 'prevPg', 'pageChip', 'zoomWarn',
    'pagecanvas', 'pageError', 'pageErrorRetry', 'doneBanner', 'shareBar', 'shareBtn',
    'status', 'recBtn', 'levels', 'count', 'total', 'listenBtn', 'repeatBtn',
    'reciterSelect', 'listenToggle', 'listenPanel', 'pbar', 'micHelpLink', 'fallback', 'typeInput', 'helpBox',
    'openTab', 'streakNum', 'wordsTodayLabel', 'wordsTodayNum', 'wordsTotalLabel',
    'wordsTotalNum', 'acctDisabled', 'acctGuest', 'acctCodeShown', 'acctLoggedIn',
    'saveProgressBtn', 'showLoginBtn', 'loginRow', 'loginInput', 'loginBtn', 'acctMsg',
    'codeBig', 'sendWaBtn', 'copyCodeBtn', 'acctSyncState', 'logoutBtn', 'privacyLine',
    'drawerBackdrop', 'drawer', 'drawerClose', 'drawerJump', 'drawerPageInput',
    'drawerGoBtn', 'drawerList', 'toast',
    'greetingLine', 'namePromptRow', 'nameInput', 'nameSaveBtn', 'nameSkipBtn',
    'surahCelebrate', 'surahCelebrateText', 'viewCertBtn', 'surahCelebrateClose',
    'certModal', 'certCanvas', 'certCloseBtn', 'certShareBtn', 'certDownloadBtn',
    'certListPanel', 'certList', 'certListEmpty'
  ].forEach(function (id) { el[id] = document.getElementById(id); });
  window.Tasme3Account.attachGroupedInput(el.loginInput);
  var ctx = el.pagecanvas.getContext('2d');

  function showToast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add('show');
    clearTimeout(showToast._tm);
    showToast._tm = setTimeout(function () { el.toast.classList.remove('show'); }, 2600);
  }

  // ------------------------------------------------------------ rendering
  function draw() {
    if (!pageImage || !pageImage.naturalWidth) return;
    var cssW = el.pagecanvas.parentElement.clientWidth;
    var scale = cssW / pageImage.naturalWidth;
    var cssH = Math.round(pageImage.naturalHeight * scale);
    var dpr = window.devicePixelRatio || 1;
    el.pagecanvas.style.width = cssW + 'px';
    el.pagecanvas.style.height = cssH + 'px';
    el.pagecanvas.width = Math.round(cssW * dpr);
    el.pagecanvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.drawImage(pageImage, 0, 0, cssW, cssH);
    var px = 0.005 * cssW, py = 0.004 * cssH;
    words.forEach(function (w, i) {
      if (revealed.has(i)) return;
      ctx.fillStyle = currentVeil;
      ctx.fillRect(w.x * cssW - px, w.y * cssH - py, w.w * cssW + 2 * px, w.h * cssH + 2 * py);
      if (markersByWord[i]) markersByWord[i].forEach(function (m) {
        ctx.fillRect(m.x * cssW - px, m.y * cssH - py, m.w * cssW + 2 * px, m.h * cssH + 2 * py);
      });
    });
    if (pointer < words.length) {
      var w = words[pointer];
      ctx.strokeStyle = GOLD; ctx.lineWidth = 2;
      ctx.strokeRect(w.x * cssW - px, w.y * cssH - py, w.w * cssW + 2 * px, w.h * cssH + 2 * py);
    }
  }

  function zoomCheck() {
    var vv = window.visualViewport;
    if (vv && (vv.scale > 1.03 || vv.offsetLeft > 2)) el.zoomWarn.style.display = 'block';
    else el.zoomWarn.style.display = 'none';
  }
  if (window.visualViewport) {
    visualViewport.addEventListener('resize', zoomCheck);
    visualViewport.addEventListener('scroll', zoomCheck);
    setInterval(zoomCheck, 1500);
  }

  var frameEl = document.querySelector('.frame'), bottombarEl = document.querySelector('.bottombar');
  function syncFramePadding() {
    if (!frameEl || !bottombarEl) return;
    // .bottombar's own rendered height only -- the listen/reciter slide-up
    // panel is absolutely positioned above it (see .listenpanel) precisely
    // so opening/closing it never perturbs this measurement.
    var h = bottombarEl.getBoundingClientRect().height;
    document.documentElement.style.setProperty('--bar-h', h + 'px');
    frameEl.style.paddingBottom = 'calc(' + h + 'px + env(safe-area-inset-bottom) + 16px)';
  }
  window.addEventListener('load', syncFramePadding);
  window.addEventListener('resize', function () { draw(); syncFramePadding(); });
  window.addEventListener('orientationchange', function () { setTimeout(function () { draw(); syncFramePadding(); }, 250); });
  document.addEventListener('fullscreenchange', function () { setTimeout(function () { draw(); syncFramePadding(); }, 50); });
  syncFramePadding();

  // -------------------------------------------------------------- paging
  function ensureBoxesLoaded() {
    if (pageBoxesPromise) return pageBoxesPromise;
    pageBoxesPromise = new Promise(function (resolve) {
      var s = document.createElement('script');
      s.src = 'boxes.js';
      s.onload = function () { resolve(window.PAGE_BOXES || {}); };
      s.onerror = function () { resolve({}); };
      document.head.appendChild(s);
    });
    return pageBoxesPromise;
  }

  function applyPageData(data) {
    ratio = data.ratio || 1;
    currentVeil = data.veil || SHEET;
    tokens = data.tokens || [];
    words = []; expected = []; markersByWord = {};
    var wi = -1;
    tokens.forEach(function (tk) {
      if (tk.e) { (markersByWord[wi] = markersByWord[wi] || []).push(tk); }
      else { wi++; words.push(tk); expected.push({ n: tk.n, a: tk.a }); }
    });
    var saved = state.progressByPage[String(pageNum)];
    if (saved) {
      pointer = Math.min(saved.pointer || 0, expected.length);
      revealed = new Set((saved.revealed || []).filter(function (i) { return i >= 0 && i < expected.length; }));
    } else {
      pointer = 0; revealed = new Set();
    }
    el.total.textContent = digits(expected.length);
    el.count.textContent = digits(pointer);
    el.pbar.style.width = (100 * pointer / Math.max(1, expected.length)) + '%';
    el.doneBanner.style.display = (pointer >= expected.length && expected.length > 0) ? 'block' : 'none';
    el.shareBar.style.display = 'none';
  }

  function pageLabel(p) { return t('recite.page', { count: digits(p) }); }

  function loadPageImage(src, onFail) {
    el.pageError.style.display = 'none';
    pageImage = new Image();
    pageImage.onload = function () { el.pageError.style.display = 'none'; draw(); };
    pageImage.onerror = function () { if (onFail) onFail(); else showPageError(); };
    pageImage.src = src;
  }
  function showPageError() { pageImage = null; el.pageError.style.display = 'flex'; }

  function loadPage(p) {
    // Pages 1-2 are ornamental and excluded from the standard flow until
    // built properly (founder decision) -- every caller of loadPage funnels
    // through this one clamp, so no path can ever land on page 1 or 2.
    p = Utils.clamp(p, NAV_MIN, NAV_MAX);
    pageNum = p;
    recorder.abort();
    listener.stop();
    stopListening();
    el.pageChip.textContent = pageLabel(p);
    state.settings.lastPage = p;
    Storage.save(state);

    var nnn = pad3(p);
    fetch('pages/page-' + nnn + '.json').then(function (r) {
      if (!r.ok) throw new Error('404');
      return r.json();
    }).then(function (data) {
      applyPageData(data);
      loadPageImage('pages/page-' + nnn + '.webp', function () { legacyFallback(p, nnn); });
      renderStatusIdle();
    }).catch(function () { legacyFallback(p, nnn); });
  }

  function legacyFallback(p, nnn) {
    if (!LEGACY_PAGES.has(p)) { showPageError(); return; }
    ensureBoxesLoaded().then(function (boxes) {
      var info = boxes[String(p)];
      if (!info) { showPageError(); return; }
      applyPageData(info);
      loadPageImage('img/page-' + nnn + '.png', showPageError);
      renderStatusIdle();
    });
  }

  el.pageErrorRetry.onclick = function () { loadPage(pageNum); };
  el.nextPg.onclick = function () { loadPage(pageNum >= NAV_MAX ? NAV_MIN : Math.max(pageNum + 1, NAV_MIN)); };
  // Prev stops dead at page 3 -- pages 1-2 are ornamental/excluded, so unlike
  // "next" (which wraps around at the end), "prev" must never wrap back
  // into them.
  el.prevPg.onclick = function () { if (pageNum > NAV_MIN) loadPage(pageNum - 1); };
  el.pageChip.onclick = function () { openDrawer('page'); };

  document.addEventListener('keydown', function (e) {
    if (e.target && /^(input|textarea)$/i.test(e.target.tagName)) return;
    if (e.key === 'ArrowLeft') el.prevPg.click();
    else if (e.key === 'ArrowRight') el.nextPg.click();
  });

  // ------------------------------------------------------------- matching
  function applyMatches(r) {
    var before = revealed.size;
    (r.matched || []).forEach(function (i) { revealed.add(i); });
    pointer = r.pointer;
    var newlyRevealed = revealed.size - before;
    el.count.textContent = digits(pointer);
    el.pbar.style.width = (100 * pointer / Math.max(1, expected.length)) + '%';
    draw();

    state.progressByPage[String(pageNum)] = state.progressByPage[String(pageNum)] || { pointer: 0, revealed: [], completedAt: null };
    state.progressByPage[String(pageNum)].pointer = pointer;
    state.progressByPage[String(pageNum)].revealed = Array.from(revealed);
    if (newlyRevealed > 0) Storage.addWordsRevealedToday(state, newlyRevealed);
    renderProgressPanel();

    var done = ('done' in r) ? r.done : (pointer >= expected.length);
    if (done && expected.length > 0) {
      var streakBefore = state.streak.count;
      Storage.markPageCompleted(state, pageNum);
      el.doneBanner.style.display = 'block';
      el.status.textContent = '';
      stopListening();
      recorder.abort();
      showShareBar(streakBefore);
      window.Tasme3Account.scheduleSync(function () { return state; });
      celebrateNewlyCompletedSurahs(pageNum);
    } else if ((r.matched || []).length) {
      el.status.textContent = t('recite.wellDone');
      el.status.className = 'status good';
    }
    Storage.save(state);
  }

  function showShareBar(streakBefore) {
    el.shareBar.style.display = 'block';
    var reachedMilestone = STREAK_MILESTONES.indexOf(state.streak.count) !== -1 && state.streak.count !== streakBefore;
    el.shareBtn.onclick = function () {
      var text = reachedMilestone
        ? window.Tasme3Share.streakMilestoneText(state.streak.count)
        : window.Tasme3Share.pageCompleteText(pageNum);
      var statLine = reachedMilestone ? (digits(state.streak.count) + ' 🔥') : t('recite.page', { count: digits(pageNum) });
      window.Tasme3Share.shareAchievement(text, statLine);
    };
  }

  // ------------------------------------------------------ level selector
  // Compact 4-segment control (numbers, not full labels) -- each segment's
  // `title` carries the full level name (level.beginner/intermediate/
  // precise/ijazah) for anyone who long-presses or hovers.
  el.levels.addEventListener('click', function (e) {
    var elm = e.target.closest('.level-seg');
    if (!elm) return;
    level = +elm.dataset.l;
    state.settings.level = level;
    Storage.save(state);
    document.querySelectorAll('.level-seg').forEach(function (x) { x.classList.toggle('active', x === elm); });
    syncReciterDefault();
  });
  function activateLevelUI() {
    document.querySelectorAll('.level-seg').forEach(function (x) { x.classList.toggle('active', +x.dataset.l === level); });
  }
  // The visible digit inside each segment must follow the current
  // language's numeral system (Arabic-Indic vs. Latin), same as every other
  // on-screen count -- re-run whenever the language changes.
  function populateLevelSegDigits() {
    document.querySelectorAll('.level-seg').forEach(function (x) { x.textContent = digits(x.dataset.l); });
  }

  // --------------------------------------------------- server ASR (tap/tap)
  function renderStatusIdle() {
    el.status.className = 'status';
    el.status.textContent = SERVER_MODE ? t('record.tapToStart') : t('recite.instruction');
  }

  function onRecordDone(blob, mimeType, token) {
    el.recBtn.classList.remove('listening');
    el.recBtn.classList.add('busy');
    el.recBtn.disabled = true;
    evalInFlight = true;
    el.status.className = 'status';
    el.status.textContent = t('record.uploading');
    var form = new FormData();
    var ext = mimeType.indexOf('mp4') !== -1 ? 'mp4' : 'webm';
    form.append('audio', blob, 'clip.' + ext);
    form.append('page', String(pageNum));
    form.append('pointer', String(pointer));
    form.append('level', String(level));
    fetch(SERVER_URL + '/evaluate', { method: 'POST', body: form })
      .then(function (r) { if (!r.ok) throw new Error('http_' + r.status); return r.json(); })
      .then(function (data) {
        if (token !== recorder.currentToken()) return; // stale response guard (M2)
        applyMatches(data);
        if (!(('done' in data) ? data.done : pointer >= expected.length)) renderStatusIdle();
      })
      .catch(function () {
        el.status.className = 'status err';
        el.status.textContent = t('record.error.network');
      })
      .finally(function () {
        evalInFlight = false;
        el.recBtn.disabled = false;
        el.recBtn.classList.remove('busy');
      });
  }

  function onRecordError(reason) {
    el.recBtn.classList.remove('listening', 'busy');
    el.recBtn.disabled = false;
    if (reason === 'mic') { showMicHelp(); return; }
    el.status.className = 'status err';
    el.status.textContent = reason === 'format' || reason === 'unsupported'
      ? t('record.error.format') : t('record.error.generic');
  }

  el.recBtn.onclick = function () {
    if (SERVER_MODE) {
      if (recorder.isRecording()) {
        recorder.stop();
        el.status.textContent = t('record.uploading');
      } else if (!recorder.isBusy() && !evalInFlight) {
        recorder.start(onRecordDone, onRecordError);
        el.recBtn.classList.add('listening');
        el.status.className = 'status';
        el.status.textContent = t('record.tapToStop');
      }
    } else {
      listening ? (stopListening(), el.status.textContent = t('recite.paused')) : startListening();
    }
  };

  // -------------------------------------------- interim (Web Speech) path
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var rec = null, listening = false, processed = 0, typingWired = false;
  var retryCount = 0, retryTimer = null;
  var RETRYABLE_ERRORS = { network: 1, 'no-speech': 1, 'audio-capture': 1 };
  var RETRY_BACKOFF_MS = [500, 1000, 2000, 2000, 2000];
  function clearRetryTimer() { if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; } }
  function wireTyping() {
    if (typingWired) return; typingWired = true;
    el.typeInput.addEventListener('input', function () {
      applyMatches(Matcher.matchTranscript(expected, pointer, el.typeInput.value, level));
    });
  }
  function showMicHelp() {
    el.helpBox.style.display = 'block';
    el.fallback.style.display = 'block';
    wireTyping();
    el.status.className = 'status err';
    el.status.textContent = t('mic.needPermission');
  }
  el.micHelpLink.onclick = function (e) { e.preventDefault(); showMicHelp(); };
  el.openTab.onclick = function () { window.open(location.href, '_blank'); };

  function startListening() {
    if (SERVER_MODE || !SR) return;
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (s) {
      s.getTracks().forEach(function (tr) { tr.stop(); });
      rec = new SR(); rec.lang = 'ar-SA'; rec.continuous = true; rec.interimResults = true; processed = 0;
      rec.onresult = function (ev) {
        retryCount = 0;
        var interim = '';
        for (var i = processed; i < ev.results.length; i++) {
          var r = ev.results[i];
          if (r.isFinal) { processed = i + 1; applyMatches(Matcher.matchTranscript(expected, pointer, r[0].transcript, level)); }
          else interim += r[0].transcript;
        }
        if (interim) applyMatches(Matcher.matchTranscript(expected, pointer, interim, level));
      };
      rec.onerror = function (e) {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { stopListening(); showMicHelp(); return; }
        if (RETRYABLE_ERRORS[e.error]) {
          if (retryCount >= RETRY_BACKOFF_MS.length) { stopListening(); showMicHelp(); return; }
          var delay = RETRY_BACKOFF_MS[retryCount]; retryCount++;
          clearRetryTimer();
          retryTimer = setTimeout(function () { retryTimer = null; if (listening) { try { rec.start(); } catch (_) {} } }, delay);
        }
      };
      rec.onend = function () {
        if (!listening) return;
        if (retryTimer) return;
        try { rec.start(); } catch (_) {}
      };
      try {
        rec.start(); listening = true;
        el.recBtn.classList.add('listening'); el.recBtn.textContent = '⏹';
        el.status.className = 'status'; el.status.textContent = t('recite.listening');
      } catch (_) { el.status.textContent = t('record.error.generic'); }
    }).catch(function () { showMicHelp(); });
  }
  function stopListening() {
    listening = false;
    el.recBtn.classList.remove('listening'); el.recBtn.textContent = '🎙️';
    clearRetryTimer(); retryCount = 0;
    if (rec) { try { rec.onend = null; rec.stop(); } catch (_) {} rec = null; }
  }
  if (!SERVER_MODE && !SR) {
    el.recBtn.disabled = true;
    el.fallback.style.display = 'block';
    wireTyping();
    el.status.textContent = t('mic.notSupported');
  }

  // ---------------------------------------------------------------- listen
  listener.onStateChange(function (s) {
    if (s === 'error') { showToast(t('listen.error')); el.listenBtn.classList.remove('on'); }
    else if (s === 'playing') { el.listenBtn.classList.add('on'); el.listenBtn.textContent = t('listen.playing'); }
    else { el.listenBtn.classList.remove('on'); el.listenBtn.textContent = t('listen.button'); }
  });
  function currentAyahKey() {
    var idx = Utils.clamp(pointer, 0, words.length - 1);
    var w = words[idx];
    if (!w || !w.k) return null;
    var parts = w.k.split(':');
    return { surah: +parts[0], ayah: +parts[1] };
  }
  el.listenBtn.onclick = function () {
    var ay = currentAyahKey();
    if (!ay) { showToast(t('listen.error')); return; }
    listener.play(ay.surah, ay.ayah, el.reciterSelect.value);
  };
  el.repeatBtn.onclick = function () {
    var on = !el.repeatBtn.classList.contains('on');
    el.repeatBtn.classList.toggle('on', on);
    listener.setRepeat(on);
    state.settings.listenRepeat = on;
    Storage.save(state);
  };
  // Listen/repeat/reciter live inside a slide-up panel behind the compact
  // 🎧 toggle (bottom bar space is tight on phones) -- state remembered so
  // a user who keeps it open sees it open again next visit.
  function setListenPanelOpen(open) {
    el.listenPanel.classList.toggle('open', open);
    el.listenToggle.classList.toggle('active', open);
    el.listenToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    state.settings.listenPanelOpen = open;
    Storage.save(state);
  }
  el.listenToggle.onclick = function () { setListenPanelOpen(!el.listenPanel.classList.contains('open')); };
  el.reciterSelect.onchange = function () {
    state.settings.reciterSet = el.reciterSelect.value;
    Storage.save(state);
  };
  function syncReciterDefault() {
    // Muallim is a natural default for beginner levels but always
    // user-overridable (docs/AUDIO-SOURCES.md §3.2) — only auto-pick it the
    // first time a level is chosen in this session, never override an
    // explicit user choice already stored in settings.
    if (state.settings.reciterSet) { el.reciterSelect.value = state.settings.reciterSet; return; }
    el.reciterSelect.value = (level <= 2) ? 'muallim' : 'murattal';
  }

  // -------------------------------------------------------------- progress
  function renderProgressPanel() {
    el.streakNum.textContent = digits(state.streak.count);
    el.wordsTodayLabel.textContent = t('progress.wordsToday', { count: digits(state.today.wordsRevealed) });
    el.wordsTotalLabel.textContent = t('progress.totalWords', { count: digits(Storage.totalWordsRevealed(state)) });
    el.wordsTodayNum.textContent = '';
    el.wordsTotalNum.textContent = '';
  }

  // -------------------------------------------------------------- account
  function renderAccountPanel() {
    var enabled = window.Tasme3Account.isEnabled();
    el.acctDisabled.hidden = enabled;
    el.acctGuest.hidden = !enabled || !!state.profile.code;
    el.acctCodeShown.hidden = true; // only shown transiently right after creation
    el.acctLoggedIn.hidden = !enabled || !state.profile.code;
    if (state.profile.code) {
      el.acctSyncState.textContent = state.settings.lastSyncedAt ? t('account.synced') : t('account.syncing');
    }
  }
  el.saveProgressBtn.onclick = function () {
    el.acctMsg.textContent = '';
    window.Tasme3Account.createAccount(state.profile.nickname).then(function (res) {
      state.profile.code = res.code_raw;
      Storage.save(state);
      el.codeBig.textContent = window.Tasme3Account.formatCode(res.code_raw);
      el.acctGuest.hidden = true;
      el.acctCodeShown.hidden = false;
      el.sendWaBtn.onclick = function () {
        window.open(window.Tasme3Account.whatsAppUrl(t('account.whatsappMessage', { code: window.Tasme3Account.formatCode(res.code_raw) })), '_blank', 'noopener');
      };
      el.copyCodeBtn.onclick = function () {
        navigator.clipboard && navigator.clipboard.writeText(res.code_raw).then(function () {
          showToast(t('account.copied'));
        });
      };
      window.Tasme3Account.scheduleSync(function () { return state; });
      maybePromptForName();
    }).catch(function () {
      el.acctMsg.className = 'msg err';
      el.acctMsg.textContent = t('account.error.network');
    });
  };
  el.showLoginBtn.onclick = function () { el.loginRow.hidden = !el.loginRow.hidden; };
  el.loginBtn.onclick = function () {
    var digitsIn = window.Tasme3Account.normalizeCode(el.loginInput.value);
    if (digitsIn.length !== 10) {
      el.acctMsg.className = 'msg err'; el.acctMsg.textContent = t('account.error.invalidCode'); return;
    }
    window.Tasme3Account.fetchProgress(digitsIn).then(function (serverData) {
      state = window.Tasme3Account.mergeServerIntoLocal(state, serverData);
      state.profile.code = digitsIn;
      Storage.save(state);
      renderAccountPanel();
      renderProgressPanel();
      renderGreeting();
      el.acctMsg.className = 'msg ok'; el.acctMsg.textContent = t('account.synced');
      maybePromptForName();
    }).catch(function (err) {
      el.acctMsg.className = 'msg err';
      el.acctMsg.textContent = (err && err.status === 401) ? t('account.error.invalidCode') : t('account.error.network');
    });
  };
  el.logoutBtn.onclick = function () {
    state.profile.code = null;
    Storage.save(state);
    renderAccountPanel();
  };

  // --------------------------------------------------- name & greeting
  // Optional, never required (founder feature): after creating a save code
  // or logging in with one, gently offer a one-tap-skippable name field.
  // Not re-shown on every panel re-render -- only right after those two
  // events, and only when no name is stored yet -- and this in-session
  // `nameDismissed` flag (not persisted) keeps it from popping again for
  // the rest of the visit once the user has skipped it once.
  var nameDismissed = false;
  function maybePromptForName() {
    if (state.settings.name || nameDismissed) { el.namePromptRow.hidden = true; return; }
    el.namePromptRow.hidden = false;
    el.nameInput.value = '';
    el.nameInput.focus();
  }
  el.nameSaveBtn.onclick = function () {
    var v = (el.nameInput.value || '').trim().slice(0, 40);
    if (!v) { el.nameSkipBtn.click(); return; }
    state.settings.name = v;
    Storage.save(state);
    el.namePromptRow.hidden = true;
    renderGreeting();
    window.Tasme3Account.scheduleSync(function () { return state; });
  };
  el.nameSkipBtn.onclick = function () {
    nameDismissed = true;
    el.namePromptRow.hidden = true;
  };

  // One subtle line, not a popup -- shown only when a name is on file.
  function renderGreeting() {
    if (state.settings.name) {
      el.greetingLine.textContent = t('greeting.hello', { name: state.settings.name });
      el.greetingLine.hidden = false;
    } else {
      el.greetingLine.hidden = true;
    }
  }

  // ----------------------------------------------------- certificates
  var certTemplatesPromise = window.Tasme3Certificate.loadTemplates();
  var currentCertCanvas = null;
  var currentCertFilename = 'certificate.png';

  function certAppLink() { return window.Tasme3Share.APP_LINK; }

  function openCertificateFor(surah) {
    var lang = window.Tasme3I18n.currentLang();
    var dir = (window.Tasme3I18n.LANGS[lang] || {}).dir || 'rtl';
    certTemplatesPromise.then(function (templates) {
      var template = window.Tasme3Certificate.templateForSurah(surah.number, templates);
      return window.Tasme3Certificate.renderCertificate({
        name: state.settings.name || null,
        surahName: surah.name,
        titleText: t('cert.title'),
        congratsText: t('cert.congrats'),
        completedSurahText: t('cert.completedSurah', { surah: surah.name }),
        dateStr: window.Tasme3Certificate.certificateDate(lang),
        dir: dir,
        template: template,
        appLink: certAppLink()
      });
    }).then(function (canvas) {
      currentCertCanvas = canvas;
      currentCertFilename = 'tasmee-certificate-surah-' + surah.number + '.png';
      var ctx2d = el.certCanvas.getContext('2d');
      el.certCanvas.width = canvas.width;
      el.certCanvas.height = canvas.height;
      ctx2d.drawImage(canvas, 0, 0);
      el.certModal.hidden = false;
      el.certModal.style.display = 'flex';
    }).catch(function () { showToast(t('error.generic')); });
  }

  el.certCloseBtn.onclick = function () { el.certModal.hidden = true; el.certModal.style.display = 'none'; };
  el.certModal.addEventListener('click', function (e) {
    if (e.target === el.certModal) { el.certModal.hidden = true; el.certModal.style.display = 'none'; }
  });
  el.certShareBtn.onclick = function () {
    if (!currentCertCanvas) return;
    window.Tasme3Certificate.shareCertificate(currentCertCanvas, t('share.button'), currentCertFilename);
  };
  el.certDownloadBtn.onclick = function () {
    if (!currentCertCanvas) return;
    window.Tasme3Certificate.downloadCanvas(currentCertCanvas, currentCertFilename);
  };

  function renderCertList() {
    if (!surahIndex || !surahIndex.surahs || !surahIndex.surahs.length) return;
    var list = window.Tasme3Certificate.completedSurahList(state, surahIndex);
    el.certList.innerHTML = '';
    el.certListEmpty.hidden = !!list.length;
    list.forEach(function (item) {
      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'cert-item';
      var nameSpan = document.createElement('span');
      nameSpan.className = 'cert-name';
      nameSpan.textContent = item.name;
      var dateSpan = document.createElement('span');
      dateSpan.className = 'cert-date';
      dateSpan.textContent = item.completedAt || '';
      row.appendChild(nameSpan);
      row.appendChild(dateSpan);
      row.onclick = function () { openCertificateFor({ number: item.number, name: item.name }); };
      el.certList.appendChild(row);
    });
  }

  // Called right after a page is marked complete (see applyMatches) -- finds
  // any surah whose full page range just became complete and offers to
  // celebrate + view the certificate. Transient in-session banner, not a
  // blocking modal; the certificate itself is always re-derivable later
  // from the "شهاداتي" list, so missing this banner costs nothing.
  function celebrateNewlyCompletedSurahs(justCompletedPageNum) {
    if (!surahIndex || !surahIndex.surahs || !surahIndex.surahs.length) return;
    var newlyDone = window.Tasme3Certificate.newlyCompletedSurahs(state, surahIndex, justCompletedPageNum);
    if (!newlyDone.length) return;
    renderCertList();
    var surah = newlyDone[0];
    el.surahCelebrate.style.display = 'block';
    el.viewCertBtn.onclick = function () {
      el.surahCelebrate.style.display = 'none';
      openCertificateFor(surah);
    };
  }
  el.surahCelebrateClose.onclick = function () { el.surahCelebrate.style.display = 'none'; };

  // --------------------------------------------------------------- drawer
  function pad3n(n) { return pad3(n); }
  function openDrawer(tab) {
    el.drawer.classList.add('open');
    el.drawerBackdrop.style.display = 'block';
    if (tab) setDrawerTab(tab);
  }
  function closeDrawer() {
    el.drawer.classList.remove('open');
    el.drawerBackdrop.style.display = 'none';
  }
  el.menuBtn.onclick = function () { openDrawer('surah'); };
  el.drawerClose.onclick = closeDrawer;
  el.drawerBackdrop.onclick = closeDrawer;

  function setDrawerTab(tab) {
    document.querySelectorAll('.drawer-tabs button').forEach(function (b) {
      b.classList.toggle('active', b.dataset.tab === tab);
    });
    el.drawerJump.hidden = tab !== 'page';
    if (tab === 'surah') renderDrawerList(surahIndex ? surahIndex.surahs : [], 'name', 'number');
    else if (tab === 'juz') renderDrawerList(surahIndex ? surahIndex.juz : [], null, 'number');
    else el.drawerList.innerHTML = '';
  }
  document.querySelectorAll('.drawer-tabs button').forEach(function (b) {
    b.addEventListener('click', function () { setDrawerTab(b.dataset.tab); });
  });
  function renderDrawerList(items, nameKey, numKey) {
    el.drawerList.innerHTML = '';
    items.forEach(function (it) {
      var row = document.createElement('div');
      row.className = 'drawer-item';
      var label = nameKey ? (digits(it[numKey]) + '. ' + it[nameKey]) :
        (t('nav.juzs').replace(/s$/, '') + ' ' + digits(it[numKey]));
      row.innerHTML = '<span>' + label + '</span><span class="pg">' + digits(it.firstPage) + '</span>';
      row.onclick = function () {
        // Surah 1 (al-Fatihah) and Juz 1 both start on page 1, which is
        // excluded from the standard flow (founder decision) -- land on the
        // first navigable page instead and say why.
        if (it.firstPage < NAV_MIN) {
          showToast(t('nav.frontPagesInProgress'));
          loadPage(NAV_MIN);
        } else {
          loadPage(it.firstPage);
        }
        closeDrawer();
      };
      el.drawerList.appendChild(row);
    });
  }
  el.drawerGoBtn.onclick = function () {
    var n = parseInt(window.Tasme3Account.normalizeCode(el.drawerPageInput.value), 10);
    if (!Number.isFinite(n)) return;
    if (n >= MIN_PAGE && n < NAV_MIN) { showToast(t('nav.frontPagesInProgress')); return; }
    if (n >= NAV_MIN && n <= NAV_MAX) { loadPage(n); closeDrawer(); }
  };

  fetch('surah-index.json').then(function (r) { return r.json(); }).then(function (data) {
    surahIndex = data;
    if (el.drawer.classList.contains('open')) setDrawerTab(document.querySelector('.drawer-tabs button.active').dataset.tab);
    renderCertList();
  }).catch(function () { surahIndex = { surahs: [], juz: [] }; });

  // --------------------------------------------------------------- header
  el.fsBtn.onclick = function () {
    var elm = document.documentElement;
    var p = document.fullscreenElement ? document.exitFullscreen() :
      (elm.requestFullscreen ? elm.requestFullscreen() : (elm.webkitRequestFullscreen ? Promise.resolve(elm.webkitRequestFullscreen()) : Promise.reject()));
    Promise.resolve(p).catch(function () { showToast(t('common.retry')); });
  };

  // hard-block zoom gestures (iOS keeps zoom state otherwise and breaks fixed bars)
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (ev) {
    document.addEventListener(ev, function (e) { e.preventDefault(); }, { passive: false });
  });
  var lastTouch = 0;
  document.addEventListener('touchend', function (e) {
    var now = Date.now();
    if (now - lastTouch < 320 && !e.target.closest('button,select,input,a')) e.preventDefault();
    lastTouch = now;
  }, { passive: false });

  // ------------------------------------------------------------------ i18n
  function populateLangSelect() {
    var LANGS = window.Tasme3I18n.LANGS;
    el.langSelect.innerHTML = '';
    Object.keys(LANGS).forEach(function (code) {
      var opt = document.createElement('option');
      opt.value = code; opt.textContent = LANGS[code].label;
      el.langSelect.appendChild(opt);
    });
  }
  el.langSelect.onchange = function () { window.Tasme3I18n.setLanguage(el.langSelect.value); };
  document.addEventListener('tasme3:lang-changed', function () {
    t = window.Tasme3I18n.t;
    el.langSelect.value = window.Tasme3I18n.currentLang();
    el.pageChip.textContent = pageLabel(pageNum);
    renderStatusIdle();
    renderProgressPanel();
    renderGreeting();
    el.privacyLine.setAttribute('data-i18n', SERVER_MODE ? 'server.privacyServer' : 'server.privacyInterim');
    window.Tasme3I18n.applyTranslations(document);
    populateLevelSegDigits();
    if (surahIndex) {
      var activeTab = document.querySelector('.drawer-tabs button.active');
      if (activeTab) setDrawerTab(activeTab.dataset.tab);
    }
  });

  // ----------------------------------------------------------------- init
  populateLangSelect();
  window.Tasme3I18n.setLanguage(window.Tasme3I18n.initialLanguage()).then(function () {
    t = window.Tasme3I18n.t;
    el.privacyLine.setAttribute('data-i18n', SERVER_MODE ? 'server.privacyServer' : 'server.privacyInterim');
    window.Tasme3I18n.applyTranslations(document);
    activateLevelUI();
    populateLevelSegDigits();
    setListenPanelOpen(!!state.settings.listenPanelOpen);
    syncReciterDefault();
    renderAccountPanel();
    renderProgressPanel();
    renderGreeting();
    renderCertList();

    // Fresh user (or a stored lastPage that predates this restriction) lands
    // on NAV_MIN (3), never page 1 -- pages 1-2 are ornamental and excluded
    // from the standard flow until built properly (founder decision). A
    // deep link (?page=) is likewise clamped into [3,604] rather than
    // trusted verbatim.
    var params = new URLSearchParams(location.search);
    var qp = parseInt(params.get('page'), 10);
    var restored = Number.isFinite(state.settings.lastPage)
      ? Utils.clamp(state.settings.lastPage, NAV_MIN, NAV_MAX) : NAV_MIN;
    var startPage = Number.isFinite(qp) ? Utils.clamp(qp, NAV_MIN, NAV_MAX) : restored;
    loadPage(startPage);
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    });
  }

  window.addEventListener('beforeunload', function () { recorder.abort(); listener.stop(); });
})();
