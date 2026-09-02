(function () {
  'use strict';

  // F3 fix (translation function null before catalogs load): `t` used to
  // start out as a bare `null`, only ever assigned once Tasme3I18n's own
  // setLanguage() promise resolved further down in this file. Anything that
  // could run before that promise settles -- a user tapping "microphone not
  // working?" or typing a word within the first second after a reload --
  // called `t(...)` while it was still `null` and threw
  // "TypeError: t is not a function", uncaught.
  //
  // Fix: `t` starts life as a fail-soft delegate to window.Tasme3I18n.t,
  // which already returns a sane fallback (the current dict's value, else
  // the English dict's, else the bare key -- see site/i18n.js's own t())
  // even before any catalog has finished loading, so nothing here has to
  // wait. The later `t = Tasme3I18n.t` assignments (once setLanguage()
  // resolves) simply swap in the real bound function afterwards -- both
  // states behave identically, this delegate just never throws in between.
  var t = function (key, params) {
    var I = window.Tasme3I18n;
    return (I && typeof I.t === 'function') ? I.t(key, params) : key;
  };
  var Utils = window.Tasme3Utils;
  var Storage = window.Tasme3Storage;
  var Matcher = window.QuranMatcher;

  // Flaky-network guard (audit a3 #38): config.js/utils.js/storage.js/
  // i18n.js/vendor/matcher.js/account.js load as plain <script> tags before
  // this one -- on a bad connection any one of them can fail its own network
  // request and never execute, leaving its global undefined. Before this
  // guard, the very next real statements below called Storage.load() and
  // window.Tasme3Account.attachGroupedInput() unconditionally and threw an
  // uncaught "Cannot read properties of undefined" that crashed the whole
  // app before anything else on the page could even try to recover
  // (site/i18n.js's own Storage.load() calls are already wrapped in
  // try/catch -- this file's top-level one was not). A same-origin reload
  // almost always succeeds the second time (browser HTTP cache/service
  // worker), so this is a plain, unmissable retry prompt rather than a
  // silent retry loop -- and it can't route through the i18n catalog
  // system, since i18n.js itself may be one of the scripts that failed to
  // load. Tasme3I18n/Tasme3Account are checked here too (residual audit
  // B1) -- previously only Utils/Storage/Matcher were, so a failed
  // account.js still reached the unconditional attachGroupedInput() call
  // below and threw past this guard instead of showing the same retry UI.
  if (!Utils || !Storage || !Matcher || !window.Tasme3I18n || !window.Tasme3Account) {
    var failDiv = document.createElement('div');
    failDiv.className = 'pageerror';
    failDiv.style.cssText = 'display:flex;position:fixed;inset:0;z-index:99;';
    var failP = document.createElement('p');
    failP.textContent = 'تعذر تحميل التطبيق بالكامل — تحقق من اتصالك وأعد المحاولة / Failed to fully load the app — check your connection and retry';
    var failBtn = document.createElement('button');
    failBtn.type = 'button';
    failBtn.textContent = 'إعادة المحاولة / Retry';
    failBtn.onclick = function () { location.reload(); };
    failDiv.appendChild(failP);
    failDiv.appendChild(failBtn);
    document.body.appendChild(failDiv);
    return;
  }

  var SERVER_URL = ((window.TASME3_CONFIG || {}).SERVER_URL || '').replace(/\/+$/, '');
  var SERVER_MODE = !!SERVER_URL;

  var MIN_PAGE = 1, MAX_PAGE = 604, NAV_MIN = 3, NAV_MAX = 604;
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
  // Residual audit A4: set true when the cross-tab `storage` listener fires
  // before `t` (Tasme3I18n.t) is assigned -- flushed by the init promise
  // below the moment `t` actually becomes callable. See that listener's own
  // comment for why.
  var pendingExternalRender = false;
  // Words on the current page BEFORE a surah-start jump's target index --
  // printed CONTEXT (the tail of a preceding surah), rendered unveiled so
  // the reader can see it, but NEVER counted as recited (see applyPageData,
  // draw(), and updateCounter()). Always empty except right after a drawer
  // "surah" selection landed mid-page; juz selection and go-to-page never
  // populate it.
  var contextRevealed = new Set();
  var pageImage = null;
  var evalInFlight = false;
  var surahIndex = null; // { surahs:[], juz:[], pageCount }
  var recorder = new window.Tasme3Recorder();
  var listener = new window.Tasme3Listen.Listener();

  // Lines derived from the current page's word tokens (founder idea #3,
  // landscape focus-line mode) -- see computeLines()/updateFocusMode() below.
  var pageLines = []; // [{y, h, indices:[wordIndex,...]}], sorted top-to-bottom
  var wordLine = []; // wordLine[wordIndex] -> index into pageLines
  var focusCropY0 = null, focusCropY1 = null; // currently-drawn crop, fraction 0..1 of page height (null = full page)
  var focusAnimFrame = null;
  var lastFocusActive = false, lastFocusLine = null;

  function prefersReducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function pad3(n) { return String(n).padStart(3, '0'); }
  // Exported via Tasme3Utils (wave-2 fix a4/G5) so share.js can reuse the
  // exact same language-aware digit logic instead of hardcoding Arabic-Indic
  // digits regardless of the current UI language.
  var digits = Utils.digits;

  // ------------------------------------------------------------- elements
  var el = {};
  [
    'menuBtn', 'langSelect', 'fsBtn', 'pageChip', 'zoomWarn', 'pagebox',
    'pagecanvas', 'pageError', 'pageErrorRetry', 'pageSpinner', 'doneBanner', 'shareBar', 'shareBtn',
    'shareProgressBtn', 'status', 'recBtn', 'setupBtn', 'setupSheet', 'setupBackdrop', 'setupClose',
    'levels', 'count', 'total', 'listenBtn', 'repeatBtn',
    'reciterSelect', 'listenPanel', 'pbar', 'pbarTop', 'micHelpLink', 'fallback', 'typeInput', 'helpBox',
    'openTab', 'streakNum', 'wordsTodayLabel', 'wordsTodayNum', 'wordsTotalLabel',
    'wordsTotalNum', 'acctDisabled', 'acctGuest', 'acctCodeShown', 'acctLoggedIn',
    'saveProgressBtn', 'showLoginBtn', 'loginRow', 'loginInput', 'loginBtn', 'acctMsg',
    'codeBig', 'sendWaBtn', 'copyCodeBtn', 'acctSyncState', 'logoutBtn', 'privacyLine',
    'drawerBackdrop', 'drawer', 'drawerClose', 'drawerJump', 'drawerPageInput',
    'drawerGoBtn', 'drawerList', 'toast',
    'greetingLine', 'namePromptRow', 'nameInput', 'nameSaveBtn', 'nameSkipBtn',
    'surahCelebrate', 'surahCelebrateText', 'viewCertBtn', 'surahCelebrateClose',
    'certModal', 'certCanvas', 'certCloseBtn', 'certShareBtn', 'certDownloadBtn',
    'certListPanel', 'certList', 'certListEmpty',
    'topBar', 'focusLineToggle',
    'installPromo', 'installPromoClose', 'installPromoIos', 'installPromoBtn', 'installPromoDismiss',
    'chromeHandle', 'firstRunHint'
  ].forEach(function (id) { el[id] = document.getElementById(id); });
  el.firstRunHintArrow = el.firstRunHint ? el.firstRunHint.querySelector('.first-run-hint-arrow') : null;
  window.Tasme3Account.attachGroupedInput(el.loginInput);
  var ctx = el.pagecanvas.getContext('2d');

  function showToast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add('show');
    clearTimeout(showToast._tm);
    showToast._tm = setTimeout(function () { el.toast.classList.remove('show'); }, 2600);
  }

  // #status is a visually-hidden ARIA live region (role="status",
  // aria-live="polite" -- see index.html/style.css .visually-hidden) that
  // announces recite feedback to screen readers; forcing a brief clear
  // before writing the new text means back-to-back IDENTICAL announcements
  // (e.g. "Well done" twice in a row) still get spoken, since aria-live only
  // fires on an actual mutation.
  function announceStatus(text) {
    el.status.textContent = '';
    void el.status.offsetWidth; // force a reflow between the two writes
    el.status.textContent = text;
  }

  // The old bottom bar carried a persistent status line ("listening…",
  // "well done", errors); the minimal main screen has no permanent chrome
  // for that, so this is now the ONE place that reports recite feedback --
  // it still updates the (visually-hidden, screen-reader-only) #status node
  // too, so nothing that reads el.status.textContent elsewhere breaks.
  function setStatus(text, cls) {
    el.status.className = cls ? 'visually-hidden status ' + cls : 'visually-hidden status';
    announceStatus(text);
    showToast(text);
  }

  // ------------------------------------------------------------ rendering
  // useFocus/cropY0/cropY1: founder idea #3 (landscape focus-line mode).
  // cropY0/cropY1 are fractions (0..1) of the FULL page image height; when
  // null (or the setting is off), the whole page renders exactly as before
  // -- the math below reduces to the original full-page draw() byte-for-byte
  // when cropY0=0/cropY1=1, so normal portrait/tall-landscape rendering is
  // unchanged. Both branches share one pxPerUnitY (px per unit of the
  // FULL page's y-fraction) so a word's on-screen size only ever grows when
  // the container is wider (e.g. landscape vs portrait), never as a side
  // effect of cropping alone.
  function draw() {
    if (!pageImage || !pageImage.naturalWidth) return;
    var cssW = el.pagecanvas.parentElement.clientWidth;
    var scale = cssW / pageImage.naturalWidth;
    var dpr = window.devicePixelRatio || 1;
    var useFocus = focusCropY0 != null && focusCropY1 != null;
    var cropY0 = useFocus ? focusCropY0 : 0;
    var cropY1 = useFocus ? focusCropY1 : 1;
    var cropFrac = Math.max(0.001, cropY1 - cropY0);
    var pxPerUnitY = pageImage.naturalHeight * scale;
    var cssH = Math.round(cropFrac * pxPerUnitY);
    el.pagecanvas.style.width = cssW + 'px';
    el.pagecanvas.style.height = cssH + 'px';
    el.pagecanvas.width = Math.round(cssW * dpr);
    el.pagecanvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var sy = cropY0 * pageImage.naturalHeight;
    var sh = cropFrac * pageImage.naturalHeight;
    ctx.drawImage(pageImage, 0, sy, pageImage.naturalWidth, sh, 0, 0, cssW, cssH);
    var px = 0.005 * cssW, py = 0.004 * cssH;
    words.forEach(function (w, i) {
      // A context word is printed text the reader can already see (it's
      // never "revealed" by recitation) -- it and its ayah markers render
      // unveiled exactly like a genuinely-recited word, just never counted
      // as one (see updateCounter()/applyMatches()).
      if (revealed.has(i) || contextRevealed.has(i)) return;
      var wy = (w.y - cropY0) * pxPerUnitY, wh = w.h * pxPerUnitY;
      if (useFocus && (wy + wh < 0 || wy > cssH)) return; // outside the drawn crop
      ctx.fillStyle = currentVeil;
      ctx.fillRect(w.x * cssW - px, wy - py, w.w * cssW + 2 * px, wh + 2 * py);
      if (markersByWord[i]) markersByWord[i].forEach(function (m) {
        var my = (m.y - cropY0) * pxPerUnitY, mh = m.h * pxPerUnitY;
        ctx.fillRect(m.x * cssW - px, my - py, m.w * cssW + 2 * px, mh + 2 * py);
      });
    });
    if (pointer < words.length) {
      var w = words[pointer];
      var wy = (w.y - cropY0) * pxPerUnitY, wh = w.h * pxPerUnitY;
      ctx.strokeStyle = GOLD; ctx.lineWidth = 2;
      ctx.strokeRect(w.x * cssW - px, wy - py, w.w * cssW + 2 * px, wh + 2 * py);
    }
  }

  // ----------------------------------------------- focus-line mode (idea #3)
  // Mushaf pages have a fixed 15-line layout; tokens on the same visual line
  // share (to floating-point noise) the same `y` -- bucketing by a rounded
  // key is exact for every page in this corpus and needs no font-metric
  // guessing.
  function computeLines() {
    var buckets = {};
    words.forEach(function (w, i) {
      var key = Math.round(w.y * 2000);
      var b = buckets[key];
      if (!b) { b = buckets[key] = { y: w.y, h: w.h, indices: [] }; }
      else if (w.h > b.h) b.h = w.h;
      b.indices.push(i);
    });
    pageLines = Object.keys(buckets).map(function (k) { return buckets[k]; })
      .sort(function (a, b) { return a.y - b.y; });
    wordLine = new Array(words.length);
    pageLines.forEach(function (line, li) {
      line.indices.forEach(function (i) { wordLine[i] = li; });
    });
  }

  function currentLineIndex() {
    if (!words.length || !pageLines.length) return 0;
    var idx = Utils.clamp(pointer, 0, words.length - 1);
    return wordLine[idx] != null ? wordLine[idx] : 0;
  }

  function focusLineSettingActive() {
    var mode = state.settings.focusLineMode || 'auto';
    if (mode === 'off') return false;
    if (mode === 'on') return true;
    // auto (wave-2 fix a9, aspect-aware): the original heuristic only ever
    // checked `height<500 && landscape`, which missed shorter-but-not-THAT-
    // short landscape windows entirely -- a 1024x600 tablet/laptop landscape
    // window (height 600, well above 500) never engaged focus-line mode even
    // though its aspect ratio is just as cramped for a full-page portrait
    // view as a phone's. Both branches below require landscape (w>h) first:
    //   - height<500, any landscape width at all (matches a phone in
    //     landscape, e.g. 844x390 -- the original check, unchanged);
    //   - a genuinely wide aspect ratio (>=1.3) with height<700 (catches
    //     1024x600 and similar small-laptop/tablet-landscape windows the
    //     old check missed).
    // A portrait/near-square window like 390x400 (width<=height) never
    // satisfies `w>h` and so never engages either branch, regardless of how
    // short it is -- this mode is landscape-only by design.
    var w = window.innerWidth, h = window.innerHeight;
    if (w <= h) return false;
    if (h < 500) return true;
    return h < 700 && (w / h) >= 1.3;
  }

  function targetCropForLine(li) {
    var n = pageLines.length;
    if (!n) return null;
    var lo = Math.max(0, li - 1), hi = Math.min(n - 1, li + 1);
    var pad = 0.012;
    return {
      y0: Math.max(0, pageLines[lo].y - pad),
      y1: Math.min(1, pageLines[hi].y + pageLines[hi].h + pad)
    };
  }

  function setFocusCrop(y0, y1, animate) {
    if (focusAnimFrame) { cancelAnimationFrame(focusAnimFrame); focusAnimFrame = null; }
    if (!animate || prefersReducedMotion()) {
      focusCropY0 = y0; focusCropY1 = y1;
      draw();
      return;
    }
    var fromY0 = focusCropY0 == null ? y0 : focusCropY0;
    var fromY1 = focusCropY1 == null ? y1 : focusCropY1;
    var start = null, dur = 240;
    function step(ts) {
      if (start == null) start = ts;
      var p = Math.min(1, (ts - start) / dur);
      var e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; // easeInOutQuad
      focusCropY0 = fromY0 + (y0 - fromY0) * e;
      focusCropY1 = fromY1 + (y1 - fromY1) * e;
      draw();
      if (p < 1) focusAnimFrame = requestAnimationFrame(step);
      else focusAnimFrame = null;
    }
    focusAnimFrame = requestAnimationFrame(step);
  }

  // Recomputes whether focus-line mode should be active and, if so, which
  // line-cluster crop should be showing -- called after every pointer
  // change, on page load, on resize/orientation/fullscreen changes, and
  // when the sheet's auto/on/off toggle changes. `animate` is ignored (and
  // treated as false) the moment the mode itself switches on/off, or on a
  // fresh page, since sliding FROM nothing (or from a wholly different
  // page's line geometry) is not a meaningful motion to animate.
  function updateFocusMode(animate) {
    var active = focusLineSettingActive() && pageLines.length > 0;
    if (!active) {
      var wasActive = lastFocusActive;
      lastFocusActive = false; lastFocusLine = null;
      if (wasActive) { focusCropY0 = focusCropY1 = null; }
      draw();
      return;
    }
    var li = currentLineIndex();
    var justActivated = !lastFocusActive;
    if (li === lastFocusLine && !justActivated && focusCropY0 !== null) { draw(); return; }
    lastFocusActive = true;
    lastFocusLine = li;
    var crop = targetCropForLine(li);
    if (!crop) { draw(); return; }
    setFocusCrop(crop.y0, crop.y1, !!animate && !justActivated);
  }

  // ------------------------------------------------- auto-follow scroll (idea #4)
  // Full-page PORTRAIT view only (focus-line mode, when active, already
  // keeps the active line centered in its own crop -- see updateFocusMode()
  // above, which skips this call whenever it is). Never fights the user: any
  // manual scroll/touch/wheel pauses auto-follow for AUTO_FOLLOW_PAUSE_MS.
  //
  // Which element actually scrolls: html/body both carry `overflow-x:hidden`
  // (style.css), and per the CSS overflow spec that forces the OTHER axis to
  // compute as `auto` rather than `visible` -- combined with body's own
  // `height:100%` this makes BODY (not the document/window) the real
  // scrolling container here, so window.scrollBy()/window.scrollY would
  // silently do nothing. autoScrollEl() finds whichever of
  // document.scrollingElement / document.body actually has overflow, so
  // this keeps working even if that CSS changes later.
  var AUTO_FOLLOW_PAUSE_MS = 5000;
  var autoFollowPausedUntil = 0;
  var autoFollowProgrammatic = false;
  function pauseAutoFollow() { autoFollowPausedUntil = Date.now() + AUTO_FOLLOW_PAUSE_MS; }
  function autoScrollEl() {
    var se = document.scrollingElement || document.documentElement;
    if (se && se.scrollHeight > se.clientHeight + 1) return se;
    if (document.body && document.body.scrollHeight > document.body.clientHeight + 1) return document.body;
    return se;
  }
  // wheel/touchmove are genuine scroll-drag gestures; deliberately NOT
  // 'pointerdown' -- that would fire on every ordinary tap anywhere on the
  // page (the mic button, ⚙️, a drawer row...), pausing auto-follow as an
  // unwanted side effect of actions that have nothing to do with scrolling.
  ['wheel', 'touchmove'].forEach(function (ev) {
    window.addEventListener(ev, pauseAutoFollow, { passive: true });
  });
  // 'scroll' does not bubble for element-level scrolling, so both the
  // window (document/viewport scrolling) and document.body (this page's
  // actual scroll container) are listened on directly; whichever one never
  // actually scrolls simply never fires.
  [window, document.body].forEach(function (target) {
    target.addEventListener('scroll', function () {
      if (autoFollowProgrammatic) return;
      pauseAutoFollow();
    }, { passive: true });
  });

  function maybeAutoFollow() {
    if (Date.now() < autoFollowPausedUntil) return;
    if (!pageImage || !pageImage.naturalWidth) return;
    if (!words.length) return;
    if (focusCropY0 != null) return; // idea #3's own crop is centering the view instead
    // Portrait (or square) only -- a wide/short viewport is landscape's job
    // (idea #3), not this one.
    if (window.innerWidth > window.innerHeight) return;
    var rect = el.pagecanvas.getBoundingClientRect();
    if (rect.height <= window.innerHeight + 1) return; // page already fits -- nothing to follow
    var idx = Utils.clamp(pointer, 0, words.length - 1);
    var w = words[idx];
    if (!w) return;
    var cssW = el.pagecanvas.clientWidth;
    var pxPerUnitY = (cssW / pageImage.naturalWidth) * pageImage.naturalHeight;
    var wordCenterInCanvas = (w.y + w.h / 2) * pxPerUnitY;
    var wordViewportY = rect.top + wordCenterInCanvas;
    var vh = window.innerHeight;
    var lowBand = vh * 0.2, highBand = vh * 0.8; // middle 60%
    if (wordViewportY >= lowBand && wordViewportY <= highBand) return;
    var desiredY = vh * 0.4;
    var delta = wordViewportY - desiredY;
    autoFollowProgrammatic = true;
    autoScrollEl().scrollBy({ top: delta, left: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    setTimeout(function () { autoFollowProgrammatic = false; }, 600);
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

  // No more --bar-h to measure (no persistent bottom bar) -- .frame's
  // padding-bottom is a static safe-area-only value set in CSS. Resize/
  // rotate/fullscreen all re-run the focus-line heuristic (idea #3's
  // auto mode keys off innerWidth/innerHeight) before redrawing.
  //
  // Wave-2 fix a9: also re-runs idea #4's auto-follow-scroll afterwards --
  // maybeAutoFollow() already guards against firing while focus-line mode is
  // active (focusCropY0 != null) or in landscape, so this is a no-op in
  // every case except the one it's meant for: a rotation INTO portrait that
  // leaves the previously-active line off-center once updateFocusMode()
  // above has finished handing crop control back to the plain full-page
  // view, re-centering it in the same gesture instead of waiting for the
  // next reveal to notice.
  function handleViewportChange() {
    updateFocusMode(false);
    maybeAutoFollow();
    // F4 fix: a rotation/resize while the first-run hint is still visible
    // (its 3s window) must re-run its positioning -- see positionFirstRunHint()
    // below for why a one-time placement goes stale across a rotation.
    if (el.firstRunHint && !el.firstRunHint.hidden) positionFirstRunHint();
  }
  // Debounced (wave-2 fix a9, extended to `resize` by residual audit B4):
  // some devices/browsers fire orientationchange more than once per physical
  // rotation (occasionally alongside a burst of resize events mid-rotation),
  // and a resize storm (a desktop window being dragged, or a mobile
  // keyboard/toolbar animating in and out) can fire dozens of `resize`
  // events in a few hundred ms -- without the clearTimeout guard, each one
  // used to queue its own handleViewportChange (cheap individually, but not
  // free, and pointless work repeated dozens of times for what is really
  // one logical viewport change). Both listeners now share the exact same
  // debounce path/timer: only the LAST firing within the 250ms settle
  // window actually runs handleViewportChange -- which still calls
  // maybeAutoFollow() every time it finally runs, so the rotation-return
  // auto-follow (idea #4) fires exactly as before, just once per settled
  // change instead of once per raw event.
  var viewportChangeTimer = null;
  function debouncedViewportChange() {
    clearTimeout(viewportChangeTimer);
    viewportChangeTimer = setTimeout(function () {
      viewportChangeTimer = null;
      handleViewportChange();
    }, 250);
  }
  window.addEventListener('resize', debouncedViewportChange);
  window.addEventListener('orientationchange', debouncedViewportChange);
  document.addEventListener('fullscreenchange', function () { setTimeout(handleViewportChange, 50); });

  // Word-progress counter: mirrored in two places -- the always-visible 3px
  // strip under the top bar, and the fuller "N/total" counter inside the
  // setup sheet. Both read straight off `revealed`/`contextRevealed`/
  // `expected`, so this is the ONE place the counter is computed -- call it
  // after anything that can change any of those three.
  //
  // Counter-semantics choice (founder spec, surah-start-jump bug fix):
  // context words are excluded from BOTH the numerator and the denominator,
  // not just hidden from the veil. So after a surah-start jump, the counter
  // reads recited/(words from the jump's pointer-start onward) -- e.g.
  // النصر+المسد's own word count on page 603, never 68 (page total
  // including الكافرون's context words) and never inflated by them.
  // `recited` is deliberately `revealed` words that are NOT also in
  // `contextRevealed` (rather than just `revealed.size`) so this stays
  // correct even in the rare case a page's `revealed` set already held
  // some indices below the jump target from before the jump happened.
  // With no jump ever made on this page, contextRevealed is empty and this
  // reduces to the original recited/total-on-page behavior.
  function updateCounter() {
    var total = Math.max(0, expected.length - contextRevealed.size);
    var recited = 0;
    revealed.forEach(function (i) { if (!contextRevealed.has(i)) recited++; });
    el.total.textContent = digits(total);
    el.count.textContent = digits(recited);
    var pct = (100 * recited / Math.max(1, total)) + '%';
    el.pbar.style.width = pct;
    el.pbarTop.style.width = pct;
    // Returned so callers that need the just-computed numbers (the a11y
    // reveal announcement in applyMatches() -- residual audit C7) don't have
    // to duplicate this exact recited/total math themselves.
    return { recited: recited, total: total };
  }

  // Writes the live pointer/revealed/contextRevealed for the current page
  // into state.progressByPage and saves -- the one place that does so, used
  // both after a match and right after a surah-start jump computes its
  // pointer/contextRevealed (so an immediate reload, before any recitation,
  // still restores the jump correctly -- req. "lastPage restore").
  function persistPageProgress() {
    var entry = state.progressByPage[String(pageNum)] || { pointer: 0, revealed: [], contextRevealed: [], completedAt: null };
    entry.pointer = pointer;
    entry.revealed = Array.from(revealed);
    entry.contextRevealed = Array.from(contextRevealed);
    state.progressByPage[String(pageNum)] = entry;
    Storage.save(state);
  }

  // -------------------------------------------------------------- paging
  // opts.surahNumber: set only when the drawer's SURAH tab was used to get
  // here (never juz / go-to-page / lastPage restore, per founder spec) --
  // see applySurahStartJump() below for what it does to pointer/contextRevealed.
  function applyPageData(data, opts) {
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
      contextRevealed = new Set((saved.contextRevealed || []).filter(function (i) { return i >= 0 && i < expected.length; }));
    } else {
      pointer = 0; revealed = new Set(); contextRevealed = new Set();
    }
    applySurahStartJump(opts);
    // A new page has entirely different line geometry -- force updateFocusMode
    // to treat this as a fresh entry (no slide-from-the-old-page's crop) and
    // never carry the previous page's completed animation frame across.
    if (focusAnimFrame) { cancelAnimationFrame(focusAnimFrame); focusAnimFrame = null; }
    focusCropY0 = focusCropY1 = null;
    lastFocusActive = false; lastFocusLine = null;
    computeLines();
    updateCounter();
    el.doneBanner.style.display = (pointer >= expected.length && expected.length > 0) ? 'block' : 'none';
    el.shareBar.style.display = 'none';
    updatePageChip(); // words[]/pointer for this page are ready now -- safe to derive the surah
    updateFocusMode(false); // immediate: no slide-in on a fresh page
  }

  // Founder-reported bug: choosing سورة النصر from the drawer landed on its
  // page (603) with the pointer at the TOP of the page, on الكافرون's first
  // word -- forcing the user to recite a surah they never chose. The fix:
  // when a surah was chosen (drawer SURAH tab only), find its first word on
  // this page by its token key `k` ("surah:ayah") and park the pointer
  // there instead of at page-top; every word before it is already printed
  // on the page, so it's shown unveiled as CONTEXT (contextRevealed) rather
  // than left veiled -- but it is NOT added to `revealed`, so it can never
  // be counted as recited (see updateCounter() and the certificate.js audit
  // in celebrateNewlyCompletedSurahs()/renderCertList()).
  //
  // Only rewinds-forward, never back: if this page already has genuine
  // progress at or past the chosen surah's start (a earlier visit already
  // recited that far for real), the existing pointer/revealed are left
  // exactly as they are -- selecting a surah you've already passed must
  // never erase real progress or manufacture context for words already
  // legitimately revealed.
  function applySurahStartJump(opts) {
    if (!opts || !Number.isFinite(opts.surahNumber)) return;
    var startIdx = -1;
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      var sNum = w && w.k ? parseInt(String(w.k).split(':')[0], 10) : NaN;
      if (sNum === opts.surahNumber) { startIdx = i; break; }
    }
    if (startIdx <= 0 || pointer >= startIdx) return; // not found, or already past it -- nothing to do
    pointer = startIdx;
    var ctxSet = new Set();
    for (var j = 0; j < startIdx; j++) ctxSet.add(j);
    contextRevealed = ctxSet;
    persistPageProgress(); // so an immediate reload (before any recitation) restores the jump too
  }

  function pageLabel(p) { return t('recite.page', { count: digits(p) }); }

  // ---------------------------------------------------- surah chip (top bar)
  // Founder: "it is not showing the Surah name" -- the chip must always show
  // the current surah, derived from the page (last surah entry whose
  // firstPage <= page), refined to the exact word at the reading pointer
  // when that's cheaply available so a page spanning a surah boundary shows
  // the surah actually being recited rather than just the page's first one.
  function surahForPage(p) {
    if (!surahIndex || !surahIndex.surahs || !surahIndex.surahs.length) return null;
    var found = null;
    for (var i = 0; i < surahIndex.surahs.length; i++) {
      if (surahIndex.surahs[i].firstPage <= p) found = surahIndex.surahs[i]; else break;
    }
    return found;
  }
  function surahByNumber(n) {
    if (!surahIndex || !surahIndex.surahs) return null;
    for (var i = 0; i < surahIndex.surahs.length; i++) {
      if (surahIndex.surahs[i].number === n) return surahIndex.surahs[i];
    }
    return null;
  }
  // Residual audit A5 (replaces the wave-2 a6 #4 boundary override below):
  // a deep link / go-to-page / lastPage-restore landing on a boundary page
  // (a surah's OWN firstPage, where that surah actually starts mid-page --
  // e.g. page 293: الإسراء's tail runs through word 91, الكهف begins at
  // word 92) used to show the PREVIOUS surah in the chip, because pointer
  // sits at 0 (nothing recited/jumped yet) and word[0]'s `k` is still
  // الإسراء's leftover printed CONTEXT from an EARLIER page. The old fix
  // (surahForPage() -- the LAST surah in the index with firstPage <= this
  // page) got pages 594/596/599/600 wrong whenever more than one surah
  // starts on the same page (it always picked the LAST of them, not the one
  // the reader actually landed on), and page 76 wrong the other way (its
  // surah-index firstPage bookkeeping made an unrelated, later surah look
  // like it "started" there even though it doesn't).
  //
  // TOKEN-BASED fix: scan this page's own word tokens in page (reading)
  // order -- the same order they're rendered/recited in -- for the FIRST
  // one whose `k` ("surah:ayah") has ayah number 1; that word is the first
  // word of whichever surah genuinely begins on this page, so its surah is
  // exactly the one a fresh reader landed here for (page 604's three
  // same-page surahs correctly resolve to the FIRST of them, الإخلاص, not
  // surahForPage()'s last). No token on the page has ayah===1 (page 76,
  // page 3 -- no surah starts there at all) -- fall through to word[0]'s own
  // surah exactly as before. Verified against every page's own token data:
  // the basmala is never emitted as a word token in this corpus (see
  // build-assets.mjs / the mushaf page-JSON generator), so there is no
  // ayah-0 "basmala token" that could be mistaken for a false ayah-1 start.
  //
  // This replacement only ever changes the POINTER===0 case (a fresh page
  // load, nothing recited/jumped into yet) -- once pointer advances past 0
  // (genuine recitation, or applySurahStartJump's own jump), the word-level
  // `bySurah` lookup below is unchanged and keeps tracking whichever surah
  // is actually being recited right now, exactly as before.
  function chipSurahStartOnPage() {
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (!w || !w.k) continue;
      var parts = w.k.split(':');
      if (parseInt(parts[1], 10) === 1) {
        var sNum = parseInt(parts[0], 10);
        return Number.isFinite(sNum) ? surahByNumber(sNum) : null;
      }
    }
    return null;
  }
  function currentSurah() {
    var idx = Utils.clamp(pointer, 0, words.length - 1);
    var w = words[idx];
    var bySurah = null;
    if (w && w.k) {
      var sNum = parseInt(w.k.split(':')[0], 10);
      bySurah = Number.isFinite(sNum) ? surahByNumber(sNum) : null;
    }
    if (pointer === 0) {
      var startSurah = chipSurahStartOnPage();
      if (startSurah) return startSurah;
    }
    if (bySurah) return bySurah;
    return surahForPage(pageNum);
  }
  function updatePageChip() {
    // Guards a real race: surah-index.json can resolve before the initial
    // i18n setLanguage() promise does (see the "surah-index" fetch below,
    // which is independent of the init chain and calls this eagerly the
    // moment it arrives) -- loadPage()'s own call into this always runs
    // after t is ready, so skipping here just means that early arrival
    // waits the same short moment everything else already does.
    if (!t) return;
    var s = currentSurah();
    // The surah name is always Arabic (RTL) even inside an LTR catalog's
    // template ("Surah {surah} · {page}") -- without isolating it, the
    // bidi algorithm can visually swap the name and the page number around
    // the "·" (Unicode RLI/PDI, U+2067/U+2069) keep the name's script
    // contained so the surrounding words/number stay in their authored
    // order regardless of document direction.
    var isolatedName = s ? '⁧' + s.name + '⁩' : '';
    if (!s) {
      el.pageChip.textContent = pageLabel(pageNum);
    } else {
      var full = t('chip.surahPage', { surah: isolatedName, page: digits(pageNum) });
      // a11y F8: wrap the (always-Arabic) surah-name run in lang="ar" so
      // assistive tech pronounces it correctly even when the UI language
      // isn't Arabic -- the isolate characters above are still needed for
      // correct bidi *visual* order and stay untouched either way.
      el.pageChip.innerHTML = '';
      var idx = full.indexOf(isolatedName);
      if (idx === -1) {
        el.pageChip.textContent = full;
      } else {
        el.pageChip.appendChild(document.createTextNode(full.slice(0, idx)));
        var nameSpan = document.createElement('span');
        nameSpan.lang = 'ar';
        nameSpan.textContent = isolatedName;
        el.pageChip.appendChild(nameSpan);
        el.pageChip.appendChild(document.createTextNode(full.slice(idx + isolatedName.length)));
      }
    }
    // a11y C7: #pagecanvas carries role="img" (index.html) since the veiled
    // Mushaf page is genuinely an image to assistive tech -- its aria-label
    // is read straight off the chip's own just-built rendered text (page
    // number + surah name, the same thing a sighted reader sees in the top
    // bar) so the two can never drift out of sync, and it NEVER carries any
    // actual Quran text (a word is only ever revealed by genuine recitation
    // -- see draw()/applyMatches() -- so exposing it here would bypass that
    // entirely for a screen-reader user).
    el.pagecanvas.setAttribute('aria-label', el.pageChip.textContent);
  }

  // Loading spinner (wave-2 fix #1): distinguishes "the page is still on its
  // way" from "loaded but veiled, tap the mic to reveal words" -- shown a
  // beat (150ms) into ANY page load/turn so a fast, cache-hit load never
  // flickers it, hidden the instant the image actually decodes (onload) or
  // the error state takes over instead. showPageSpinnerSoon() is called once
  // per navigation, right as loadPage() starts (covers the page-JSON fetch
  // *and* the image fetch as one visual "loading" span); hidePageSpinner()
  // is called from both success (loadPageImage's onload) and failure
  // (showPageError, which every failure path in this file already funnels
  // through) so there is exactly one place each that needs to know about it.
  var pageSpinnerTimer = null;
  function showPageSpinnerSoon() {
    clearTimeout(pageSpinnerTimer);
    pageSpinnerTimer = setTimeout(function () { el.pageSpinner.classList.add('show'); }, 150);
  }
  function hidePageSpinner() {
    clearTimeout(pageSpinnerTimer);
    pageSpinnerTimer = null;
    el.pageSpinner.classList.remove('show');
  }

  function loadPageImage(src, onFail) {
    el.pageError.style.display = 'none';
    pageImage = new Image();
    pageImage.onload = function () { hidePageSpinner(); el.pageError.style.display = 'none'; draw(); };
    pageImage.onerror = function () { if (onFail) onFail(); else showPageError(); };
    pageImage.src = src;
  }
  function showPageError() { hidePageSpinner(); pageImage = null; el.pageError.style.display = 'flex'; }

  // opts.surahNumber: passed straight through to applyPageData()'s
  // surah-start jump -- ONLY the drawer's SURAH tab sets this (see
  // renderDrawerList()); juz selection, go-to-page, deep links, and the
  // lastPage restore on startup all call loadPage() with no opts, keeping
  // their existing top-of-page behavior (founder spec, req. 6).
  function loadPage(p, opts) {
    // Pages 1-2 are ornamental and excluded from the standard flow until
    // built properly (founder decision) -- every caller of loadPage funnels
    // through this one clamp, so no path can ever land on page 1 or 2.
    p = Utils.clamp(p, NAV_MIN, NAV_MAX);
    pageNum = p;
    showPageSpinnerSoon(); // covers this whole navigation's JSON+image fetch span
    recorder.abort();
    listener.stop();
    stopListening();
    el.pageChip.textContent = pageLabel(p);
    state.settings.lastPage = p;
    Storage.save(state);
    showChrome(true); // briefly reveal the bar (with the new surah·page chip) on every page change

    // Wave-3 fix: every page 1-604 ships modern page-NNN.json + page-NNN.webp
    // (verified against site/pages/ -- no gaps), so the old boxes.js/PNG
    // fallback below this comment used to fall back to is permanently dead:
    // it existed only to bridge pages not yet migrated to the modern format,
    // and that migration is complete. On any real fetch/decode failure now,
    // the normal error state (with its retry button) is the right and only
    // UI, same as every other page -- not a silent switch to a lower-quality
    // asset that only 11 specific pages happened to still carry around.
    var nnn = pad3(p);
    fetch('pages/page-' + nnn + '.json').then(function (r) {
      if (!r.ok) throw new Error('404');
      return r.json();
    }).then(function (data) {
      applyPageData(data, opts);
      loadPageImage('pages/page-' + nnn + '.webp', showPageError);
      renderStatusIdle();
    }).catch(function () { showPageError(); });
  }

  el.pageErrorRetry.onclick = function () { loadPage(pageNum); };
  // No dedicated next/prev buttons in the top bar (founder: minimal main
  // screen) -- goNext/goPrev are the one shared implementation behind the
  // keyboard arrows and the canvas swipe below.
  function goNext() { loadPage(pageNum >= NAV_MAX ? NAV_MIN : Math.max(pageNum + 1, NAV_MIN)); }
  // Prev stops dead at page 3 -- pages 1-2 are ornamental/excluded, so unlike
  // "next" (which wraps around at the end), "prev" must never wrap back
  // into them.
  function goPrev() { if (pageNum > NAV_MIN) loadPage(pageNum - 1); }
  el.pageChip.onclick = function () { openDrawer('page'); };

  document.addEventListener('keydown', function (e) {
    if (e.target && /^(input|textarea)$/i.test(e.target.tagName)) return;
    if (overlayStack.length) return; // an open drawer/sheet/modal/install-card must swallow page-turn (power B1/B3)
    if (e.key === 'ArrowLeft') goPrev();
    else if (e.key === 'ArrowRight') goNext();
  });

  // ------------------------------------------------- overlay a11y utility
  // Shared machinery for the four overlay surfaces (drawer, setup sheet,
  // cert modal, install card -- audit a11y F2/F3/F4, power #2/2a-2d):
  //   - inert (+ aria-hidden) everything BEHIND the topmost open overlay, so
  //     Tab/AT navigation can never leak into hidden background controls
  //     (power M1: focus landing on a hidden #langSelect);
  //   - trap Tab within the topmost overlay;
  //   - Escape closes the topmost overlay;
  //   - closing restores focus to whatever opened it.
  // A tiny stack (rather than a single slot) because the cert modal can
  // legitimately open ON TOP of an already-open setup sheet (its "My
  // Certificates" list lives inside the sheet) -- only the true top needs
  // to be interactive at any moment.
  var FOCUSABLE_SEL = 'a[href], button:not([disabled]), input:not([disabled]), ' +
    'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  var overlayStack = [];
  function topOverlay() { return overlayStack.length ? overlayStack[overlayStack.length - 1] : null; }
  // Walks from `target` up to (and including) document.body, toggling
  // inert+aria-hidden on every SIBLING at each level (never on `target`
  // itself, its own ancestors, or `backdropEl`, which must stay clickable
  // to close the overlay). For a body-level overlay (drawer/sheet/install
  // card) this is one pass over body's children; for the cert modal
  // (nested inside .frame) it also reaches up through .frame's own
  // siblings -- exactly the two levels that separate it from body.
  function setInertSiblings(target, backdropEl, on) {
    var node = target;
    for (;;) {
      var parent = node.parentElement;
      if (!parent) break;
      Array.prototype.forEach.call(parent.children, function (sib) {
        if (sib === node || sib === backdropEl) return;
        if (on) { sib.setAttribute('inert', ''); sib.setAttribute('aria-hidden', 'true'); }
        else { sib.removeAttribute('inert'); sib.removeAttribute('aria-hidden'); }
      });
      if (parent === document.body) break;
      node = parent;
    }
  }
  // Un-inerts every entry CURRENTLY LISTED (before any push/splice the
  // caller is about to do), then re-inerts only whichever overlay is on
  // top afterwards -- simpler and safer than incremental add/remove when
  // overlays can nest (cert modal opening on top of an already-open sheet)
  // or close out of order. Callers must pass the full "before" list
  // (including an entry about to be removed) so its inert is properly
  // undone -- a plain `overlayStack.forEach` after the splice would already
  // be missing the very entry that needs un-inerting.
  function reconcileStackInert(entriesToClear) {
    entriesToClear.forEach(function (entry) { setInertSiblings(entry.el, entry.backdrop, false); });
    var top = topOverlay();
    if (top) setInertSiblings(top.el, top.backdrop, true);
  }
  function registerOverlayOpen(elx, backdropEl, closeFn) {
    var top = topOverlay();
    if (top && top.el === elx) return; // already the topmost open overlay -- never double-push
    var before = overlayStack.slice();
    overlayStack.push({ el: elx, backdrop: backdropEl, opener: document.activeElement, close: closeFn });
    reconcileStackInert(before);
    setTimeout(function () {
      var f = elx.querySelector(FOCUSABLE_SEL);
      (f || elx).focus();
    }, 0);
  }
  function registerOverlayClose(elx) {
    var idx = -1;
    for (var i = overlayStack.length - 1; i >= 0; i--) { if (overlayStack[i].el === elx) { idx = i; break; } }
    if (idx === -1) return;
    var entry = overlayStack[idx];
    var before = overlayStack.slice();
    overlayStack.splice(idx, 1);
    reconcileStackInert(before);
    if (entry.opener && document.contains(entry.opener) && typeof entry.opener.focus === 'function') {
      entry.opener.focus();
    }
  }
  // Residual audit A2: closes every currently-open overlay, topmost first --
  // used by showMicHelp() below so the typed fallback (a body-level sibling
  // of #setupSheet) is never left inert behind an overlay the reveal itself
  // didn't think to close.
  function closeAllOverlays() {
    var top;
    while ((top = topOverlay())) top.close();
  }
  // Tab trap: only the topmost overlay's own focusable elements are ever
  // allowed to hold focus while any overlay is open.
  document.addEventListener('keydown', function (e) {
    var top = topOverlay();
    if (!top || e.key !== 'Tab') return;
    var focusables = Array.prototype.filter.call(top.el.querySelectorAll(FOCUSABLE_SEL), function (fe) {
      return fe.offsetParent !== null || fe === document.activeElement;
    });
    if (!focusables.length) { e.preventDefault(); return; }
    var first = focusables[0], last = focusables[focusables.length - 1];
    var active = document.activeElement;
    if (e.shiftKey) {
      if (active === first || !top.el.contains(active)) { e.preventDefault(); last.focus(); }
    } else if (active === last || !top.el.contains(active)) { e.preventDefault(); first.focus(); }
  }, true);
  // Escape closes whatever overlay is currently on top.
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var top = topOverlay();
    if (top) top.close();
  });

  // ------------------------------------------ back-button / edge-swipe trap
  // Critical chaos-audit finding: a right-swipe starting within ~10px of the
  // left screen edge triggers the BROWSER's own native back gesture (not
  // this app's swipe-to-turn listener below) -- landing on about:blank with
  // no in-app recovery inside an installed/standalone PWA (no address bar to
  // navigate back from). Three independent layers:
  //   (a) the page-turn swipe listener below ignores any touch starting
  //       within 20px of either screen edge, so it never arms there;
  //   (b) `overscroll-behavior-x:none` (style.css) suppresses Chrome's
  //       edge-swipe back/forward navigation gesture where supported;
  //   (c) this history.pushState buffer -- a same-URL dummy entry pushed on
  //       boot, and re-pushed on every popstate -- so an accidental (or
  //       deliberate) browser-back can never actually leave the app: it
  //       just closes whatever overlay is open (if any) and lands right
  //       back where it was.
  //
  // Residual audit A3: the original version pushed exactly ONE guard entry
  // at boot and re-pushed exactly one per popstate -- fine for isolated back
  // presses, but several fast presses in a row can outrun a single-entry
  // buffer (each popstate's own re-push is a separate JS turn; if the
  // browser advances the session-history pointer back by more than one step
  // before that turn runs -- a real risk with rapid/coalesced back
  // navigations -- the single spare entry is already used up and the next
  // press escapes). GUARD_MAX_DEPTH+1 entries are kept buffered at all
  // times instead of just one: each carries its own `depth` (0..7) so a
  // popstate landing anywhere in the buffer can tell how far it fell and
  // top the buffer back up to full depth in one go, rather than only ever
  // replacing the single step just consumed.
  var GUARD_MAX_DEPTH = 7;
  function pushGuardState(depth) {
    try { history.pushState({ tasme3Guard: true, depth: depth }, '', location.href); } catch (_) {}
  }
  for (var guardBootDepth = 0; guardBootDepth <= GUARD_MAX_DEPTH; guardBootDepth++) pushGuardState(guardBootDepth);
  window.addEventListener('popstate', function () {
    var top = topOverlay();
    if (top) top.close();
    var st = history.state;
    var fromDepth = (st && st.tasme3Guard && typeof st.depth === 'number') ? st.depth : -1;
    if (fromDepth >= GUARD_MAX_DEPTH) return; // buffer already full -- nothing to top up
    for (var d = fromDepth + 1; d <= GUARD_MAX_DEPTH; d++) pushGuardState(d);
  });

  // ---------------------------------------------------------- swipe to turn
  // No next/prev buttons on the minimal main screen, so the page canvas
  // itself must support a page-turn swipe. The Mushaf's page order is fixed
  // RTL regardless of the current UI language (the Arabic text is always
  // RTL even when the chrome is English) -- pages advance moving toward the
  // physical left, same direction a paper Mushaf turns -- so swiping left
  // always goes to the next page and swiping right always goes back,
  // independent of html[dir].
  (function wireSwipe() {
    var target = el.pagebox;
    if (!target) return;
    var startX = null, startY = null, startT = 0;
    var MIN_DX = 40, MAX_DY = 60, MAX_MS = 700;
    var EDGE_DEAD_ZONE = 20; // chaos audit: never arm the page-turn swipe this close to either edge
    target.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) { startX = null; return; }
      var x = e.touches[0].clientX;
      if (x < EDGE_DEAD_ZONE || x > window.innerWidth - EDGE_DEAD_ZONE) { startX = null; return; }
      startX = x; startY = e.touches[0].clientY; startT = Date.now();
    }, { passive: true });
    target.addEventListener('touchend', function (e) {
      if (startX === null) return;
      var touch = e.changedTouches[0];
      var dx = touch.clientX - startX, dy = touch.clientY - startY;
      startX = null;
      if (Date.now() - startT > MAX_MS) return;
      if (Math.abs(dx) < MIN_DX || Math.abs(dy) > MAX_DY) return;
      if (dx < 0) goNext(); else goPrev();
    }, { passive: true });
  })();

  // -------------------------------------------------- immersive mode (idea #1)
  // The top bar is hidden by default (see .topbar's overlay CSS); a single
  // TAP on the page canvas toggles it, distinguished from the swipe-to-turn
  // gesture above by a much smaller movement threshold. Both listeners sit
  // on the same el.pagebox and run independently: a real swipe (dx>=40 in
  // wireSwipe's own check) always exceeds this tap's tiny TAP_MAX_MOVE, so
  // it never also toggles the bar; a genuine tap (dx/dy under 10px) never
  // reaches wireSwipe's MIN_DX=40 threshold, so it never also turns the page.
  var CHROME_AUTOHIDE_MS = 4000;
  var chromeVisible = false, chromeHideTimer = null;
  function isOverlayOpen() {
    return overlayStack.length > 0;
  }
  function showChrome(autoHide) {
    chromeVisible = true;
    document.body.classList.add('chrome-visible');
    clearTimeout(chromeHideTimer);
    if (autoHide && !isOverlayOpen()) {
      chromeHideTimer = setTimeout(function () {
        if (!isOverlayOpen()) hideChrome();
      }, CHROME_AUTOHIDE_MS);
    }
  }
  function hideChrome() {
    if (isOverlayOpen()) return;
    chromeVisible = false;
    document.body.classList.remove('chrome-visible');
    clearTimeout(chromeHideTimer);
  }
  function toggleChrome() {
    if (chromeVisible) hideChrome(); else showChrome(true);
  }

  (function wireImmersiveTap() {
    var target = el.pagebox;
    if (!target) return;
    var tStartX = null, tStartY = null, tStartT = 0;
    var TAP_MAX_MOVE = 10, TAP_MAX_MS = 500;
    var suppressClickUntil = 0;
    target.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) { tStartX = null; return; }
      tStartX = e.touches[0].clientX; tStartY = e.touches[0].clientY; tStartT = Date.now();
    }, { passive: true });
    target.addEventListener('touchend', function (e) {
      if (tStartX === null) return;
      var touch = e.changedTouches[0];
      var dx = touch.clientX - tStartX, dy = touch.clientY - tStartY;
      tStartX = null;
      if (Date.now() - tStartT > TAP_MAX_MS) return;
      if (Math.abs(dx) > TAP_MAX_MOVE || Math.abs(dy) > TAP_MAX_MOVE) return; // a swipe, not a tap
      suppressClickUntil = Date.now() + 500; // the synthetic mouse click that follows this touch must not double-toggle
      toggleChrome();
    }, { passive: true });
    // Non-touch (mouse/trackpad) input never fires touchstart/touchend above.
    target.addEventListener('click', function () {
      if (Date.now() < suppressClickUntil) return;
      toggleChrome();
    });
  })();

  // Chrome-discoverability affordance (elderly audit #1): the slim gold tab
  // at the top edge that stays visible whenever the bar itself is hidden --
  // tapping it reveals the bar exactly like the immersive-tap gesture above.
  if (el.chromeHandle) el.chromeHandle.onclick = function () { showChrome(true); };

  // ------------------------------------------------------------- matching
  // Surah number of a word index, read straight off its token `k`
  // ("surah:ayah") -- null when the index is out of range or the token has
  // no key (shouldn't happen for real page data, but this must never throw).
  function surahOfIndex(idx) {
    var w = words[idx];
    if (!w || !w.k) return null;
    var n = parseInt(w.k.split(':')[0], 10);
    return Number.isFinite(n) ? n : null;
  }

  // Founder-reported bug: a re-delivered/echoed final transcript (Web
  // Speech restart quirk) can hand the matcher a token that happens to
  // greedily match whatever word the pointer now sits on -- including the
  // NEXT surah's opening word, right after the previous surah's last word
  // was revealed. A word revealed that was not freshly recited is this
  // project's worst failure class, so a single matcher result may only ever
  // advance the pointer within the surah it started in. Whatever `r.matched`
  // contains beyond the first index that belongs to a different surah than
  // `oldPointer`'s is discarded outright -- not carried over, not queued --
  // and the pointer parks exactly on that next surah's first word,
  // unrevealed. Only a subsequent, independent result (a fresh recognition
  // result, or a typed keystroke) may reveal into the new surah. Applied
  // here -- the one place every path (Web Speech final results, the typed
  // fallback, and the server /evaluate response) funnels through before
  // touching `revealed` -- rather than in each caller.
  function gateSurahBoundary(oldPointer, r) {
    var matched = (r.matched || []).slice().sort(function (a, b) { return a - b; });
    if (!matched.length) return r;
    var baseSurah = surahOfIndex(oldPointer);
    if (baseSurah == null) return r; // no k data to gate against -- pass through unchanged
    var cut = -1;
    for (var i = 0; i < matched.length; i++) {
      var s = surahOfIndex(matched[i]);
      if (s != null && s !== baseSurah) { cut = i; break; }
    }
    if (cut === -1) return r; // this result never left the surah it started in
    var kept = matched.slice(0, cut);
    var newPointer = kept.length ? (kept[kept.length - 1] + 1) : oldPointer;
    var out = { pointer: newPointer, matched: kept };
    // The finishing surah's last word (index newPointer-1) is necessarily
    // still on this page (there's a discarded word after it in `matched`),
    // so a page can never read as "done" out of a gated result -- only
    // recompute `done` when the caller (the server path) supplied one.
    if ('done' in r) out.done = (newPointer >= expected.length);
    return out;
  }

  function applyMatches(r) {
    r = gateSurahBoundary(pointer, r);
    var before = revealed.size;
    (r.matched || []).forEach(function (i) { revealed.add(i); });
    pointer = r.pointer;
    var newlyRevealed = revealed.size - before;
    var counts = updateCounter();
    updatePageChip(); // cheap -- catches the pointer crossing a surah boundary mid-page
    // updateFocusMode() redraws either way -- sliding the focus-line crop to
    // the pointer's new line when idea #3 is active, or a plain draw() when
    // it isn't, in which case idea #4's auto-follow-scroll takes over
    // (skipped while focus-line mode is active -- it already keeps the
    // pointer centered in its own crop).
    updateFocusMode(true);
    maybeAutoFollow();

    persistPageProgress();
    // newlyRevealed comes from `revealed` only (never contextRevealed), so
    // today's word count -- and everything derived from it (streak/today
    // panel, server sync tallies) -- only ever credits genuinely recited
    // words, exactly like the certificate completion checks below.
    if (newlyRevealed > 0) Storage.addWordsRevealedToday(state, newlyRevealed);
    renderProgressPanel();

    var done = ('done' in r) ? r.done : (pointer >= expected.length);
    if (done && expected.length > 0) {
      var streakBefore = state.streak.count;
      Storage.markPageCompleted(state, pageNum);
      el.doneBanner.style.display = 'block';
      announceStatus(t('recite.pageComplete'));
      stopListening();
      recorder.abort();
      showShareBar(streakBefore);
      window.Tasme3Account.scheduleSync(function () { return state; });
      celebrateNewlyCompletedSurahs(pageNum);
    } else if ((r.matched || []).length) {
      setStatus(t('recite.wellDone'), 'good');
    }
    // a11y (residual audit C7): every reveal batch also gets an explicit
    // spoken word count, appended after whatever status text was just
    // announced above -- screen-reader users otherwise have no way to know
    // HOW MUCH just appeared on the page. This used to announce only
    // newlyRevealed (the size of THIS batch), which for the common
    // one-word-at-a-time typed/spoken case repeated the unhelpful "1 words
    // revealed" after every single word; announcing the page's running
    // cumulative total (from updateCounter()'s just-computed counts, the
    // same recited/total shown in the setup sheet's counter) instead gives
    // real progress information every time.
    if (newlyRevealed > 0) {
      var countMsg = t('a11y.wordsRevealed', { n: digits(counts.recited), m: digits(counts.total) });
      el.status.textContent = (el.status.textContent ? el.status.textContent + ' ' : '') + countMsg;
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

  // Always-reachable "share" entry inside the setup sheet (founder spec:
  // share button belongs in the setup popup, not only as a transient banner
  // right after finishing a page) -- shares today's furthest progress on
  // this page regardless of whether it was *just* completed.
  el.shareProgressBtn.onclick = function () {
    var text = window.Tasme3Share.pageCompleteText(pageNum);
    var statLine = t('recite.page', { count: digits(pageNum) });
    window.Tasme3Share.shareAchievement(text, statLine);
  };

  // ------------------------------------------------------ level selector
  // Full-name 4-option control inside the setup sheet (founder: show full
  // names, not just numbers) -- each segment still carries its level number
  // for the matcher plus a visible translated name.
  el.levels.addEventListener('click', function (e) {
    var elm = e.target.closest('.level-seg');
    if (!elm) return;
    level = +elm.dataset.l;
    state.settings.level = level;
    Storage.save(state);
    activateLevelUI();
    syncReciterDefault();
  });
  // a11y F7: aria-pressed mirrors the visual .active state for AT users.
  function activateLevelUI() {
    el.levels.querySelectorAll('.level-seg').forEach(function (x) {
      var active = +x.dataset.l === level;
      x.classList.toggle('active', active);
      x.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }
  // The visible digit inside each segment must follow the current
  // language's numeral system (Arabic-Indic vs. Latin), same as every other
  // on-screen count -- re-run whenever the language changes.
  function populateLevelSegDigits() {
    el.levels.querySelectorAll('.level-seg-num').forEach(function (x) { x.textContent = digits(x.parentElement.dataset.l); });
  }

  // Focus-line auto/on/off toggle (founder idea #3) -- reuses .level-seg's
  // look but is a fully separate control scoped to el.focusLineToggle, so
  // clicking here never touches the (unrelated) difficulty-level segments
  // above and vice versa.
  el.focusLineToggle.addEventListener('click', function (e) {
    var elm = e.target.closest('.level-seg');
    if (!elm) return;
    state.settings.focusLineMode = elm.dataset.mode;
    Storage.save(state);
    activateFocusLineUI();
    updateFocusMode(false);
  });
  function activateFocusLineUI() {
    el.focusLineToggle.querySelectorAll('.level-seg').forEach(function (x) {
      var active = x.dataset.mode === (state.settings.focusLineMode || 'auto');
      x.classList.toggle('active', active);
      x.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  // --------------------------------------------------- server ASR (tap/tap)
  function renderStatusIdle() {
    el.status.className = 'visually-hidden status';
    el.status.textContent = SERVER_MODE ? t('record.tapToStart') : t('recite.instruction');
  }

  // a11y F5: #recBtn's aria-label tracks its actual recording/listening
  // state (data-i18n-aria-label alone only ever set it once, at load, to
  // "tap to start" -- never updated back after the mic started/stopped).
  function updateRecBtnLabel() {
    if (!t) return;
    var active = SERVER_MODE ? recorder.isRecording() : listening;
    el.recBtn.setAttribute('aria-label', t(active ? 'record.tapToStop' : 'record.tapToStart'));
  }

  function onRecordDone(blob, mimeType, token) {
    el.recBtn.classList.remove('listening');
    el.recBtn.classList.add('busy');
    el.recBtn.disabled = true;
    evalInFlight = true;
    updateRecBtnLabel();
    setStatus(t('record.uploading'));
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
        setStatus(t('record.error.network'), 'err');
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
    updateRecBtnLabel();
    if (reason === 'mic') { showMicHelp(); return; }
    setStatus(reason === 'format' || reason === 'unsupported'
      ? t('record.error.format') : t('record.error.generic'), 'err');
  }

  el.recBtn.onclick = function () {
    if (SERVER_MODE) {
      if (recorder.isRecording()) {
        recorder.stop();
        setStatus(t('record.uploading'));
      } else if (!recorder.isBusy() && !evalInFlight) {
        recorder.start(onRecordDone, onRecordError);
        el.recBtn.classList.add('listening');
        setStatus(t('record.tapToStop'));
      }
      updateRecBtnLabel();
    } else {
      listening ? (stopListening(), setStatus(t('recite.paused'))) : startListening();
    }
  };

  // -------------------------------------------- interim (Web Speech) path
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var rec = null, listening = false, processed = 0, typingWired = false;
  var retryCount = 0, retryTimer = null;
  // Restart-echo guard: browsers occasionally re-deliver/overlap a final
  // transcript's tail right after a recognition session restarts (our
  // backoff restarts included) -- e.g. the founder-reported case where the
  // end of سورة الإخلاص echoed into the session that started over الفلق.
  // `processed` is a count into the CURRENT session's ev.results, so it
  // must be zeroed every time rec.start() is called again (a fresh session
  // always renumbers its own results from 0) -- and for a short window
  // right after that restart, final results are dropped rather than
  // matched, since that's exactly when an echoed tail can arrive. This is a
  // second line of defense; gateSurahBoundary() above is the primary one.
  var restartSuppressUntil = 0;
  var RESTART_SUPPRESS_MS = 800;
  function noteRestart() { processed = 0; restartSuppressUntil = Date.now() + RESTART_SUPPRESS_MS; }
  var RETRYABLE_ERRORS = { network: 1, 'no-speech': 1, 'audio-capture': 1 };
  var RETRY_BACKOFF_MS = [500, 1000, 2000, 2000, 2000];
  function clearRetryTimer() { if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; } }
  function wireTyping() {
    if (typingWired) return; typingWired = true;
    el.typeInput.addEventListener('input', function () {
      applyMatches(Matcher.matchTranscript(expected, pointer, el.typeInput.value, level));
    });
  }
  // Residual audit A2: #helpBox/#fallback/#typeInput are body-level siblings
  // of #setupSheet -- while the sheet (or any other overlay) is open, the
  // overlay stack's setInertSiblings() marks them `inert`, so simply
  // revealing them here was not enough: the only path INTO this function
  // from a real user gesture is #micHelpLink, which lives INSIDE the sheet,
  // so the typed fallback stayed genuinely unfocusable/untypable until the
  // user separately closed the sheet. Closing every open overlay first (the
  // sheet's own closeSetupSheet() un-inerts its siblings as part of its
  // normal registerOverlayClose() bookkeeping) then focusing #typeInput
  // fixes both problems in the one place every mic-help path funnels
  // through (the sheet link, a real mic-permission error, and the
  // no-SpeechRecognition-support path below all call this).
  function showMicHelp() {
    closeAllOverlays();
    el.helpBox.style.display = 'block';
    el.fallback.style.display = 'block';
    wireTyping();
    setStatus(t('mic.needPermission'), 'err');
    el.typeInput.focus();
  }
  el.micHelpLink.onclick = function (e) { e.preventDefault(); showMicHelp(); };
  el.openTab.onclick = function () { window.open(location.href, '_blank'); };

  // Elderly audit #7: guard set synchronously, BEFORE the getUserMedia
  // promise settles -- a second tap while the permission prompt/resolution
  // is still pending is a no-op instead of racing a second concurrent
  // getUserMedia() call (which could otherwise leave two overlapping
  // recognition sessions, or resolve out of order).
  var micRequestPending = false;
  function startListening() {
    if (SERVER_MODE || !SR) return;
    if (micRequestPending) return;
    micRequestPending = true;
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (s) {
      micRequestPending = false;
      s.getTracks().forEach(function (tr) { tr.stop(); });
      rec = new SR(); rec.lang = 'ar-SA'; rec.continuous = true; rec.interimResults = true;
      processed = 0; restartSuppressUntil = 0; // fresh, user-initiated session -- no echo risk yet
      rec.onresult = function (ev) {
        retryCount = 0;
        // Interim results must never reach the matcher -- only a `isFinal`
        // result is a confirmed transcript; matching against words still in
        // flux is exactly how an unconfirmed guess could reveal a word that
        // was never actually (finally) recited.
        for (var i = processed; i < ev.results.length; i++) {
          var r = ev.results[i];
          if (!r.isFinal) continue;
          processed = i + 1;
          if (Date.now() < restartSuppressUntil) continue; // restart-echo suppression window
          applyMatches(Matcher.matchTranscript(expected, pointer, r[0].transcript, level));
        }
      };
      rec.onerror = function (e) {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { stopListening(); showMicHelp(); return; }
        if (RETRYABLE_ERRORS[e.error]) {
          if (retryCount >= RETRY_BACKOFF_MS.length) { stopListening(); showMicHelp(); return; }
          // Residual audit C5: RETRY_BACKOFF_MS sums to ~7.5s before the help
          // box finally appears -- total silence for that whole stretch,
          // easy to read as the app having simply frozen. A brief interim
          // toast on the FIRST retryable error of this listening session
          // (retryCount is still 0 here, before it's bumped below, and gets
          // reset to 0 by noteRestart()/stopListening() on every fresh
          // start) gives an immediate, honest "something's happening"
          // signal without needing to persist for the whole backoff.
          if (retryCount === 0) showToast(t('mic.retrying'));
          var delay = RETRY_BACKOFF_MS[retryCount]; retryCount++;
          clearRetryTimer();
          retryTimer = setTimeout(function () { retryTimer = null; if (listening) { noteRestart(); try { rec.start(); } catch (_) {} } }, delay);
        }
      };
      rec.onend = function () {
        if (!listening) return;
        if (retryTimer) return;
        noteRestart();
        try { rec.start(); } catch (_) {}
      };
      try {
        rec.start(); listening = true;
        el.recBtn.classList.add('listening'); el.recBtn.textContent = '⏹';
        updateRecBtnLabel();
        setStatus(t('recite.listening'));
      } catch (_) { setStatus(t('record.error.generic'), 'err'); }
    }).catch(function () { micRequestPending = false; showMicHelp(); });
  }
  function stopListening() {
    listening = false;
    el.recBtn.classList.remove('listening'); el.recBtn.textContent = '🎙️';
    updateRecBtnLabel();
    clearRetryTimer(); retryCount = 0;
    if (rec) { try { rec.onend = null; rec.stop(); } catch (_) {} rec = null; }
  }
  if (!SERVER_MODE && !SR) {
    el.recBtn.disabled = true;
    el.fallback.style.display = 'block';
    wireTyping();
    setStatus(t('mic.notSupported'), 'err');
  }

  // ---------------------------------------------------------------- listen
  // Wave-2 fix #10 (a3 G2/G3): the button used to sit on its idle "Listen"
  // text/state for the ENTIRE stall while audio was fetching (everyayah.com
  // can take many seconds on a slow link) -- zero feedback that the tap even
  // registered, and a second tap mid-stall just called play() again with a
  // fresh <audio>.src (restarting the fetch) rather than offering any way to
  // cancel. listener.onStateChange now also fires a 'loading' state (added
  // in listen.js's play(), right before the network request starts) so the
  // button can show a distinct pending look+label, and a retap while pending
  // calls listener.cancel() (pause + clear src) instead of play() again.
  listener.onStateChange(function (s) {
    if (s === 'error') { showToast(t('listen.error')); el.listenBtn.classList.remove('on', 'pending'); el.listenBtn.textContent = t('listen.button'); }
    else if (s === 'loading') { el.listenBtn.classList.add('pending'); el.listenBtn.classList.remove('on'); el.listenBtn.textContent = t('listen.loading'); }
    else if (s === 'playing') { el.listenBtn.classList.remove('pending'); el.listenBtn.classList.add('on'); el.listenBtn.textContent = t('listen.playing'); }
    else { el.listenBtn.classList.remove('on', 'pending'); el.listenBtn.textContent = t('listen.button'); }
    updateListenBtnLabel();
  });
  function updateListenBtnLabel() {
    if (!t) return;
    var key = listener.isPending() ? 'listen.loading' : (listener.isPlaying() ? 'listen.playing' : 'listen.button');
    el.listenBtn.setAttribute('aria-label', t(key));
  }
  function currentAyahKey() {
    var idx = Utils.clamp(pointer, 0, words.length - 1);
    var w = words[idx];
    if (!w || !w.k) return null;
    var parts = w.k.split(':');
    return { surah: +parts[0], ayah: +parts[1] };
  }
  el.listenBtn.onclick = function () {
    if (listener.isPending()) {
      listener.cancel();
      el.listenBtn.classList.remove('on', 'pending');
      el.listenBtn.textContent = t('listen.button');
      updateListenBtnLabel();
      return;
    }
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
  // Listen/repeat/reciter now live directly in the setup sheet's "listen"
  // section (no more slide-up toggle -- the sheet itself is the reveal).
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
        lang: lang,
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
      registerOverlayOpen(el.certModal, null, closeCertModal);
    }).catch(function () { showToast(t('error.generic')); });
  }

  function closeCertModal() {
    if (el.certModal.hidden) return;
    registerOverlayClose(el.certModal);
    el.certModal.hidden = true;
    el.certModal.style.display = 'none';
  }
  el.certCloseBtn.onclick = closeCertModal;
  el.certModal.addEventListener('click', function (e) {
    if (e.target === el.certModal) closeCertModal();
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
    // completedSurahList() is async (see certificate.js) -- it must verify
    // word-level completion, not just a page's completedAt flag, for any
    // page a surah-start jump ever touched (context-word integrity audit).
    window.Tasme3Certificate.completedSurahList(state, surahIndex).then(function (list) {
      el.certList.innerHTML = '';
      el.certListEmpty.hidden = !!list.length;
      list.forEach(function (item) {
        var row = document.createElement('button');
        row.type = 'button';
        row.className = 'cert-item';
        var nameSpan = document.createElement('span');
        nameSpan.className = 'cert-name';
        nameSpan.lang = 'ar'; // surah name is always Arabic script (a11y F8)
        nameSpan.textContent = item.name;
        var dateSpan = document.createElement('span');
        dateSpan.className = 'cert-date';
        dateSpan.textContent = item.completedAt || '';
        row.appendChild(nameSpan);
        row.appendChild(dateSpan);
        row.onclick = function () { openCertificateFor({ number: item.number, name: item.name }); };
        el.certList.appendChild(row);
      });
    });
  }

  // Called right after a page is marked complete (see applyMatches) -- finds
  // any surah whose full page range just became complete and offers to
  // celebrate + view the certificate. Transient in-session banner, not a
  // blocking modal; the certificate itself is always re-derivable later
  // from the "شهاداتي" list, so missing this banner costs nothing.
  function celebrateNewlyCompletedSurahs(justCompletedPageNum) {
    if (!surahIndex || !surahIndex.surahs || !surahIndex.surahs.length) return;
    // newlyCompletedSurahs() is async (see certificate.js) -- a page can
    // complete (pointer reaching its end) via a surah-start jump without
    // ever genuinely reciting a preceding surah shown only as context, so
    // completion is verified at the word level for any page a jump ever
    // touched, not just via the page's completedAt flag. A surah shown as
    // context must never trigger this celebration or earn a certificate.
    window.Tasme3Certificate.newlyCompletedSurahs(state, surahIndex, justCompletedPageNum).then(function (newlyDone) {
      if (!newlyDone.length) return;
      renderCertList();
      var surah = newlyDone[0];
      // Residual audit A1: this banner used to toggle style.display, but
      // #surahCelebrate carries the HTML `hidden` attribute (index.html) --
      // style.css's global `[hidden]{display:none!important}` rule always
      // wins over an equal-specificity inline style.display, so
      // style.display='block' here could never actually show it. Toggling
      // the `hidden` property directly is what index.html's own attribute
      // was already set up for.
      el.surahCelebrate.hidden = false;
      announceStatus(t('recite.surahComplete'));
      el.viewCertBtn.onclick = function () {
        el.surahCelebrate.hidden = true;
        openCertificateFor(surah);
      };
    });
  }
  el.surahCelebrateClose.onclick = function () { el.surahCelebrate.hidden = true; };

  // ------------------------------------------------------ cross-tab sync
  // Multi-tab clobber audit (finding 1): Storage.save() now merges into
  // whatever is currently in localStorage instead of overwriting it (see
  // site/storage.js), so no tab's write can ever erase another tab's
  // progress -- but without this listener a SECOND open tab would still
  // sit there showing stale counts/veil state until its own next save()
  // happened to read the merged blob back in. The `storage` event is the
  // browser's own cross-document signal for exactly this: per spec it
  // fires in every OTHER same-origin document that has this page open,
  // and NEVER in the document whose own script called setItem() -- so
  // there is no risk of this tab reacting to its own write. The
  // `lastWrittenRaw()` comparison below is an extra belt-and-suspenders
  // guard against that same (should-be-impossible) case.
  window.addEventListener('storage', function (e) {
    if (e.key !== Storage.KEY || !e.newValue) return;
    if (e.newValue === Storage.lastWrittenRaw()) return; // guard: never react to our own write
    var fresh = Storage.validate(e.newValue);
    // Fold the externally-written blob into THIS tab's live state with the
    // same union/max/latest-wins merge save() uses -- protects any of this
    // tab's own not-yet-saved progress from being replaced wholesale by
    // the other tab's snapshot, while still picking up everything new the
    // other tab genuinely added.
    var merged = Storage.mergeProgress(state, fresh);
    state.progressByPage = merged.progressByPage;
    state.streak = merged.streak;
    state.today = merged.today;

    // If the page currently on screen has progress from the other tab,
    // refresh its live reveal display + counters too -- not just the
    // panels below.
    var saved = state.progressByPage[String(pageNum)];
    if (saved && expected.length) {
      var mergedRevealed = new Set((saved.revealed || []).filter(function (i) { return i >= 0 && i < expected.length; }));
      var mergedContext = new Set((saved.contextRevealed || []).filter(function (i) { return i >= 0 && i < expected.length; }));
      if (mergedRevealed.size !== revealed.size || mergedContext.size !== contextRevealed.size) {
        revealed = mergedRevealed;
        contextRevealed = mergedContext;
        pointer = Math.max(pointer, saved.pointer || 0);
        updateCounter();
        updateFocusMode(true);
        el.doneBanner.style.display = (pointer >= expected.length && expected.length > 0) ? 'block' : 'none';
      }
    }
    // Residual audit A4: this listener can fire before Tasme3I18n's
    // setLanguage() promise has resolved -- e.g. a second tab writes
    // progress the instant this tab finishes loading, well before its own
    // i18n fetch settles -- and renderProgressPanel() calls `t(...)`, which
    // is still null at that point (see the top of this file: `var t =
    // null`, assigned only once the init promise below resolves). Calling
    // it anyway threw an uncaught "t is not a function" and crashed the
    // whole handler (including the state merge above, which had already
    // completed by then, but also renderCertList() below, which never ran).
    // The state merge itself is unconditional and safe (uses no i18n); only
    // the render is deferred -- to right after `t` is actually assigned,
    // via pendingExternalRender's flush in the init promise below.
    if (typeof t === 'function') renderProgressPanel();
    else pendingExternalRender = true;
    renderCertList();
  });

  // --------------------------------------------------------------- drawer
  function pad3n(n) { return pad3(n); }
  function openDrawer(tab) {
    closeSetupSheet();
    el.drawer.classList.add('open');
    el.drawerBackdrop.style.display = 'block';
    if (tab) setDrawerTab(tab);
    showChrome(false); // stays visible for as long as the drawer is open
    registerOverlayOpen(el.drawer, el.drawerBackdrop, closeDrawer);
  }
  function closeDrawer() {
    if (!el.drawer.classList.contains('open')) return;
    registerOverlayClose(el.drawer);
    el.drawer.classList.remove('open');
    el.drawerBackdrop.style.display = 'none';
    showChrome(true); // resume the normal auto-hide countdown
  }
  // Residual audit C3: a second tap on ☰ while the drawer is already open
  // used to unconditionally call openDrawer() again -- harmless (it's
  // idempotent, see registerOverlayOpen's already-topmost guard) but not
  // what a reader expects from a menu button: a second tap should close it,
  // same as tapping it again on any standard hamburger menu.
  el.menuBtn.onclick = function () {
    if (el.drawer.classList.contains('open')) closeDrawer();
    else openDrawer('surah');
  };
  el.drawerClose.onclick = closeDrawer;
  el.drawerBackdrop.onclick = closeDrawer;

  // ------------------------------------------------------------ setup sheet
  // Everything that used to live in the always-on bottom bar (level, listen/
  // repeat/reciter, word counter) plus the account/progress/certificate
  // panels that used to sit below the page -- founder: "all info in the
  // buttons can come out and be in a pop window for setup".
  function openSetupSheet() {
    closeDrawer();
    el.setupSheet.classList.add('open');
    el.setupBackdrop.style.display = 'block';
    showChrome(false); // stays visible for as long as the sheet is open
    registerOverlayOpen(el.setupSheet, el.setupBackdrop, closeSetupSheet);
  }
  function closeSetupSheet() {
    if (!el.setupSheet.classList.contains('open')) return;
    registerOverlayClose(el.setupSheet);
    el.setupSheet.classList.remove('open');
    el.setupBackdrop.style.display = 'none';
    showChrome(true); // resume the normal auto-hide countdown
  }
  el.setupBtn.onclick = function () { openSetupSheet(); };
  el.setupClose.onclick = closeSetupSheet;
  el.setupBackdrop.onclick = closeSetupSheet;

  function setDrawerTab(tab) {
    document.querySelectorAll('.drawer-tabs button').forEach(function (b) {
      var active = b.dataset.tab === tab;
      b.classList.toggle('active', active);
      if (active) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
    });
    el.drawerJump.hidden = tab !== 'page';
    // Wave-2 fix #2 (a3 F1): surah-index.json failing used to leave the
    // surah/juz tabs silently empty forever, indistinguishable from "there's
    // just nothing here" -- render a retry row instead whenever the last
    // fetch attempt failed (see loadSurahIndex() below), on EITHER of the
    // two tabs that actually depend on it (the page-jump tab never did).
    if (tab === 'surah') { if (surahIndexFailed) renderDrawerIndexError(); else renderDrawerList(surahIndex ? surahIndex.surahs : [], 'name', 'number', true); }
    else if (tab === 'juz') { if (surahIndexFailed) renderDrawerIndexError(); else renderDrawerList(surahIndex ? surahIndex.juz : [], null, 'number', false); }
    else el.drawerList.innerHTML = '';
  }
  // Error row shown in place of the surah/juz list when surah-index.json's
  // most recent fetch failed -- a visible "couldn't load, tap to retry"
  // instead of an unexplained empty drawer (audit finding: "looks broken/
  // empty rather than couldn't load index, tap to retry").
  function renderDrawerIndexError() {
    el.drawerList.innerHTML = '';
    var wrap = document.createElement('div');
    wrap.className = 'drawer-error';
    var p = document.createElement('p');
    p.textContent = t('drawer.indexLoadError');
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ghostbtn';
    btn.textContent = t('common.retry');
    btn.onclick = function () {
      btn.disabled = true;
      loadSurahIndex().then(function () { btn.disabled = false; });
    };
    wrap.appendChild(p);
    wrap.appendChild(btn);
    el.drawerList.appendChild(wrap);
  }
  document.querySelectorAll('.drawer-tabs button').forEach(function (b) {
    b.addEventListener('click', function () { setDrawerTab(b.dataset.tab); });
  });
  // isSurahTab: true only for the SURAH list -- a surah selection jumps the
  // pointer straight to that surah's first word on its page (see loadPage's
  // opts.surahNumber / applySurahStartJump), showing anything printed
  // before it on that page as unveiled context. The JUZ list (isSurahTab
  // false) keeps landing at the top of the page, unchanged (founder spec,
  // req. 6) -- juz entries share the same `number` field but it means
  // something else entirely (a juz number, not a surah number), so this
  // flag is what keeps the two from ever being confused.
  //
  // Rows are real <button> elements (a11y F1 / power O1-O2): keyboard-
  // focusable and Enter/Space-activatable, mirroring .cert-item. The surah
  // name (always Arabic script) is wrapped in lang="ar" (a11y F8) so
  // assistive tech pronounces it correctly regardless of the UI language.
  function renderDrawerList(items, nameKey, numKey, isSurahTab) {
    el.drawerList.innerHTML = '';
    items.forEach(function (it) {
      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'drawer-item';
      var labelSpan = document.createElement('span');
      if (nameKey) {
        labelSpan.appendChild(document.createTextNode(digits(it[numKey]) + '. '));
        var nameSpan = document.createElement('span');
        nameSpan.lang = 'ar';
        nameSpan.textContent = it[nameKey];
        labelSpan.appendChild(nameSpan);
      } else {
        labelSpan.textContent = t('nav.juz') + ' ' + digits(it[numKey]);
      }
      var pgSpan = document.createElement('span');
      pgSpan.className = 'pg';
      pgSpan.textContent = digits(it.firstPage);
      row.appendChild(labelSpan);
      row.appendChild(pgSpan);
      row.onclick = function () {
        // Surah 1 (al-Fatihah) and Juz 1 both start on page 1, which is
        // excluded from the standard flow (founder decision) -- land on the
        // first navigable page instead and say why. (No surah-start jump
        // in this case -- the front pages aren't in the standard flow at
        // all yet, so there's no page data to jump within.)
        if (it.firstPage < NAV_MIN) {
          showToast(t('nav.frontPagesInProgress'));
          loadPage(NAV_MIN);
        } else if (isSurahTab) {
          loadPage(it.firstPage, { surahNumber: it.number });
        } else {
          loadPage(it.firstPage);
        }
        closeDrawer();
      };
      el.drawerList.appendChild(row);
    });
  }
  // Elderly audit #5 / chaos #2: invalid go-to-page input used to fail
  // completely silently (0, out-of-range, or garbage input just did
  // nothing). Every rejected case now gets the app's existing toast
  // pattern -- 1/2 reuse the existing "front pages in progress" message
  // (they ARE valid page numbers, just not open yet); everything else
  // (0, negative, out-of-range, non-numeric) gets the new invalid-page
  // toast.
  //
  // Residual audit B8: this used to run the raw input through
  // window.Tasme3Account.normalizeCode(), which (by design, for the
  // account-code field it was built for) STRIPS every non-digit character
  // rather than rejecting them -- so "3.7" silently became "37" and
  // navigated to page 37, and "3 7" silently became page 37 too, neither of
  // which the reader typed. Digit conversion here now only ever CONVERTS
  // Arabic-Indic/Extended-Arabic-Indic digits to Western (matching what a
  // reader typing "٢٩٣" expects) without dropping anything else; the result
  // is then required to be ASCII-digits-only (a leading '-' included) before
  // it's ever parsed as a page number, so any stray punctuation, space, or
  // letter is now a rejection instead of a silent reinterpretation.
  var ARABIC_INDIC_DIGIT_RE = /[٠-٩۰-۹]/g;
  function convertDigitsToWestern(s) {
    return String(s).replace(ARABIC_INDIC_DIGIT_RE, function (ch) {
      var code = ch.charCodeAt(0);
      return String(code - (code >= 0x06F0 ? 0x06F0 : 0x0660));
    });
  }
  function submitGoToPage() {
    var raw = (el.drawerPageInput.value || '').trim();
    var converted = convertDigitsToWestern(raw);
    if (!/^[0-9]+$/.test(converted)) { showToast(t('nav.invalidPage')); return; }
    var n = parseInt(converted, 10);
    if (n >= MIN_PAGE && n < NAV_MIN) { showToast(t('nav.frontPagesInProgress')); return; }
    if (n < MIN_PAGE || n > NAV_MAX) { showToast(t('nav.invalidPage')); return; }
    loadPage(n);
    closeDrawer();
  }
  el.drawerGoBtn.onclick = submitGoToPage;
  // Power-user finding #3: Enter in the page-number field should submit,
  // same as clicking the Go button.
  el.drawerPageInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); submitGoToPage(); }
  });

  // Wave-2 fix #2 (a3 F1): wrapped in a named, re-callable function so a
  // failed fetch can be retried on demand (the drawer's error-row button --
  // see renderDrawerIndexError() above) instead of failing silently forever.
  // surahIndexFailed distinguishes "the most recent attempt failed" (show
  // the retry row) from "still loading" or "loaded, genuinely has content"
  // (both render the normal list -- an in-flight first load simply renders
  // an empty list exactly as it always did, no retry row needed since
  // nothing has failed yet).
  var surahIndexFailed = false;
  function loadSurahIndex() {
    return fetch('surah-index.json').then(function (r) {
      if (!r.ok) throw new Error('surah-index http_' + r.status);
      return r.json();
    }).then(function (data) {
      surahIndex = data;
      surahIndexFailed = false;
      updatePageChip(); // the chip may have rendered with just the page number before this arrived
      if (el.drawer.classList.contains('open')) {
        var activeTab = document.querySelector('.drawer-tabs button.active');
        if (activeTab) setDrawerTab(activeTab.dataset.tab);
      }
      renderCertList();
    }).catch(function () {
      surahIndex = surahIndex || { surahs: [], juz: [] };
      surahIndexFailed = true;
      if (el.drawer.classList.contains('open')) {
        var activeTab2 = document.querySelector('.drawer-tabs button.active');
        if (activeTab2) setDrawerTab(activeTab2.dataset.tab);
      }
    });
  }
  loadSurahIndex();

  // --------------------------------------------------------------- header
  // a11y F6: aria-label reflects the actual toggle direction (enter/exit)
  // instead of the old static, English-only "fullscreen" label.
  function updateFsBtnLabel() {
    if (!t) return;
    el.fsBtn.setAttribute('aria-label', t(document.fullscreenElement ? 'nav.fullscreenExit' : 'nav.fullscreenEnter'));
  }
  el.fsBtn.onclick = function () {
    var elm = document.documentElement;
    var p = document.fullscreenElement ? document.exitFullscreen() :
      (elm.requestFullscreen ? elm.requestFullscreen() : (elm.webkitRequestFullscreen ? Promise.resolve(elm.webkitRequestFullscreen()) : Promise.reject()));
    Promise.resolve(p).catch(function () { showToast(t('common.retry')); });
  };
  document.addEventListener('fullscreenchange', updateFsBtnLabel);

  // --------------------------------------------- PWA install promotion (idea #2)
  // One-time, dismissible-forever, and never shown before the user's SECOND
  // session (state.installPromo.sessionCount, incremented once per fresh
  // page load -- see init below) or while already running standalone.
  function isStandaloneDisplay() {
    return !!((window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
      window.navigator.standalone === true);
  }
  function isIOSDevice() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS reports as Mac
  }
  function isIOSSafari() {
    var ua = navigator.userAgent;
    return isIOSDevice() && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
  }
  var deferredInstallPrompt = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredInstallPrompt = e;
    maybeShowInstallPromo();
  });
  function dismissInstallPromo() {
    if (el.installPromo.hidden) return;
    registerOverlayClose(el.installPromo);
    el.installPromo.hidden = true;
    state.installPromo.dismissed = true;
    Storage.save(state);
  }
  function maybeShowInstallPromo() {
    if (isStandaloneDisplay()) return;
    if (state.installPromo.dismissed) return;
    if (state.installPromo.sessionCount < 2) return;
    if (!el.installPromo.hidden) return; // already showing
    var showIOS = isIOSSafari();
    var showAndroid = !!deferredInstallPrompt;
    if (!showIOS && !showAndroid) return; // no actionable install path on this browser
    el.installPromoIos.hidden = !showIOS;
    el.installPromoBtn.hidden = !showAndroid;
    el.installPromo.hidden = false;
    registerOverlayOpen(el.installPromo, null, dismissInstallPromo);
  }
  el.installPromoClose.onclick = dismissInstallPromo;
  el.installPromoDismiss.onclick = dismissInstallPromo;
  el.installPromoBtn.onclick = function () {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    deferredInstallPrompt.userChoice.finally(function () {
      deferredInstallPrompt = null;
      dismissInstallPromo();
    });
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
    updatePageChip();
    updateCounter(); // wave-2 fix #6: the page/total counters (and their progress bars) carry
                      // digits() output baked in at render time -- a language switch alone
                      // never re-ran it, so an Arabic-Indic count kept showing after e.g.
                      // switching to English until the next reveal.
    renderStatusIdle();
    renderProgressPanel();
    renderGreeting();
    updateRecBtnLabel();
    updateFsBtnLabel();
    updateListenBtnLabel();
    el.privacyLine.setAttribute('data-i18n', SERVER_MODE ? 'server.privacyServer' : 'server.privacyInterim');
    window.Tasme3I18n.applyTranslations(document);
    populateLevelSegDigits();
    if (surahIndex) {
      var activeTab = document.querySelector('.drawer-tabs button.active');
      if (activeTab) setDrawerTab(activeTab.dataset.tab);
    }
  });

  // Elderly audit: a one-time, non-blocking 3-second hint pointing at the
  // mic on a genuinely fresh install -- dismissed by a tap on it, or after
  // the timeout, and never shown again once the flag is set. Plain
  // localStorage (not Tasme3Storage's versioned schema) since this is a
  // purely per-device UI nicety, not app data worth migrating/merging.
  var FIRST_RUN_HINT_KEY = 'tasme3FirstRunHintShown';
  // Residual audit C4: the hint used to rely purely on CSS (inset-inline-end
  // anchoring, same edge as .floatbar) to sit "near" the mic button, but its
  // own box can be up to 220px wide (max-width) while #recBtn is only 56px --
  // anchoring both to the same edge lines up their EDGES, not their centers,
  // leaving the hint's arrow visibly off-center from the button it's meant
  // to point at. This computes #recBtn's actual on-screen center and
  // positions the hint (via a plain physical `left`, which as an inline
  // style beats the CSS's logical inset-inline-end regardless of RTL/LTR)
  // so the two centers always coincide, however wide the hint's text
  // happens to wrap in the current language.
  //
  // F4 fix, part 1 (hint doesn't survive a rotation): the box's `left` was
  // only ever computed ONCE, when the hint is first shown -- a device
  // rotation during the hint's 3s visible window (viewport width changes,
  // #recBtn moves) left the already-positioned box stranded wherever it was
  // computed for the OLD viewport, up to hundreds of px from the mic. Fixed
  // by re-running this same positioning from handleViewportChange() below
  // whenever the hint is currently visible, not just on first show.
  //
  // F4 fix, part 2 (arrow can't reach the mic at narrow widths): at 390px
  // width the hint box itself gets clamped against the viewport edge (the
  // `Math.max(margin, Math.min(...))` above) well before its CENTER can
  // reach #recBtn's center, since .floatbar sits only 16px from the
  // inline-end edge while the (up to 220px wide) hint box needs its own
  // half-width of clearance just to stay on-screen -- centering the whole
  // BOX on the mic is geometrically impossible there, so the box's clamped
  // left previously left the arrow (which just inherited the box's
  // text-align:center) up to ~74px away from the button it's meant to point
  // at. Fixed by decoupling the two: the BOX position keeps clamping to the
  // viewport as before (readable text is still the priority), but the ARROW
  // is now absolutely positioned WITHIN the box, independently offset so
  // its own center-x always equals #recBtn's center-x, clamped only to the
  // box's own inner width (so it can still slide close to an edge of the
  // box, but never past it, to point at a mic that sits outside the box's
  // horizontal center).
  function positionFirstRunHint() {
    if (!el.firstRunHint || !el.recBtn) return;
    var micRect = el.recBtn.getBoundingClientRect();
    var centerX = micRect.left + micRect.width / 2;
    var hintRect = el.firstRunHint.getBoundingClientRect();
    var margin = 8;
    var left = centerX - hintRect.width / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - hintRect.width - margin));
    el.firstRunHint.style.insetInlineEnd = 'auto';
    el.firstRunHint.style.right = 'auto';
    el.firstRunHint.style.left = left + 'px';

    if (!el.firstRunHintArrow) return;
    // Re-measure the box's actual on-screen rect now that `left` is applied
    // (hintRect above was captured before this move) so arrowLeft is
    // computed against where the box really ends up.
    var boxRect = el.firstRunHint.getBoundingClientRect();
    var arrowWidth = el.firstRunHintArrow.offsetWidth || 20;
    var arrowMargin = 6; // keep the arrow's glyph clear of the box's own rounded corner/border
    var arrowLeft = centerX - boxRect.left - arrowWidth / 2;
    arrowLeft = Math.max(arrowMargin, Math.min(arrowLeft, boxRect.width - arrowWidth - arrowMargin));
    // The CSS default (`left:50%; transform:translateX(-50%)`) is only the
    // pre-JS fallback -- once a pixel `left` is computed here it fully
    // replaces that centering, so the transform must be cleared or it would
    // shift the arrow another half-width off from this already-precise
    // position.
    el.firstRunHintArrow.style.transform = 'none';
    el.firstRunHintArrow.style.left = arrowLeft + 'px';
  }
  function maybeShowFirstRunHint() {
    if (!el.firstRunHint) return;
    var shown;
    try { shown = localStorage.getItem(FIRST_RUN_HINT_KEY); } catch (_) { shown = '1'; }
    if (shown) return;
    el.firstRunHint.hidden = false;
    positionFirstRunHint();
    var tm = setTimeout(dismiss, 3000);
    function dismiss() {
      clearTimeout(tm);
      el.firstRunHint.hidden = true;
      el.firstRunHint.removeEventListener('click', dismiss);
      try { localStorage.setItem(FIRST_RUN_HINT_KEY, '1'); } catch (_) {}
    }
    el.firstRunHint.addEventListener('click', dismiss);
  }

  // ----------------------------------------------------------------- init
  populateLangSelect();
  window.Tasme3I18n.setLanguage(window.Tasme3I18n.initialLanguage()).then(function () {
    t = window.Tasme3I18n.t;
    // Residual audit A4: `t` just became callable for the first time --
    // flush a render the cross-tab `storage` listener above deferred
    // because it fired while `t` was still null.
    if (pendingExternalRender) { pendingExternalRender = false; renderProgressPanel(); }
    el.privacyLine.setAttribute('data-i18n', SERVER_MODE ? 'server.privacyServer' : 'server.privacyInterim');
    window.Tasme3I18n.applyTranslations(document);
    activateLevelUI();
    populateLevelSegDigits();
    activateFocusLineUI();
    syncReciterDefault();
    renderAccountPanel();
    renderProgressPanel();
    renderGreeting();
    renderCertList();
    updateRecBtnLabel();
    updateFsBtnLabel();
    updateListenBtnLabel();
    maybeShowFirstRunHint();

    // Idea #2: every fresh page load is one "session" -- the install-promo
    // card is eligible only from the SECOND one onward, never the first.
    state.installPromo.sessionCount += 1;
    Storage.save(state);
    maybeShowInstallPromo(); // covers iOS Safari immediately; the Android/Chrome
                              // path additionally re-checks on beforeinstallprompt

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
