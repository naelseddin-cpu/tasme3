// Playwright regression tests for the 10-persona residual-findings re-audit
// (see the task's A/B/C list). Same harness conventions as the other
// site/tests/*.js: drives the REAL site/ app.js against a headless browser,
// reads back localStorage/the DOM directly, never pokes at app.js internals.
const { chromium } = require('playwright-core');

const SITE_URL = process.env.SITE_URL || 'http://127.0.0.1:8842';
const EXEC = '/opt/pw-browsers/chromium';

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('PASS:', name); }
  else { fail++; console.log('FAIL:', name, extra !== undefined ? JSON.stringify(extra) : ''); }
}

function isExpectedNoise(url) {
  // Pre-existing, documented, expected noise across every site/tests/*.js
  // file: certificate.js probes up to 6 optional certificate-background
  // artwork slots via fetch() and treats a 404 as "not present yet" -- this
  // repo ships only 3 of them.
  return /certificate-bg-/.test(url || '');
}

async function freshPage(browser, consoleErrors, opts) {
  const context = await browser.newContext(opts && opts.contextOptions);
  const page = await context.newPage();
  page.on('console', function (msg) {
    if (msg.type() !== 'error') return;
    var loc = msg.location() || {};
    if (isExpectedNoise(loc.url)) return;
    consoleErrors.push(msg.text() + ' @ ' + (loc.url || ''));
  });
  page.on('pageerror', function (err) { consoleErrors.push('pageerror: ' + err.message); });
  await page.goto(SITE_URL + '/index.html' + (opts && opts.qs ? opts.qs : ''), { waitUntil: 'load' });
  await page.waitForFunction(function () {
    var t = document.getElementById('total');
    return t && t.textContent && t.textContent.length > 0;
  }, { timeout: 10000 });
  return { context, page };
}

async function pageWords(page, nnn) {
  return page.evaluate(function (p) {
    return fetch('pages/page-' + p + '.json').then(function (r) { return r.json(); }).then(function (d) {
      var out = [];
      d.tokens.forEach(function (tk) { if (!tk.e) out.push(tk.n); });
      return out;
    });
  }, nnn);
}

async function typeWords(page, words, n) {
  await page.evaluate(function () {
    var el = document.getElementById('micHelpLink');
    if (el) el.click();
  });
  await page.waitForTimeout(20);
  var acc = '';
  for (var i = 0; i < n; i++) {
    acc += (acc ? ' ' : '') + words[i];
    await page.evaluate(function (v) {
      var inp = document.getElementById('typeInput');
      inp.value = v; inp.dispatchEvent(new Event('input', { bubbles: true }));
    }, acc);
    await page.waitForTimeout(20);
  }
}

(async function main() {
  const browser = await chromium.launch({ executablePath: EXEC, headless: true });
  const consoleErrors = [];

  // ==================================================================
  // A1: surah-completion celebration banner uses `hidden`, actually shows.
  // ==================================================================
  {
    const { context, page } = await freshPage(browser, consoleErrors, { qs: '?page=604' });
    const words = await pageWords(page, '604');
    // celebrateNewlyCompletedSurahs() only ever fires once the whole PAGE
    // is done (see applyMatches()'s `done` gate) -- page 604 packs three
    // single-page surahs (الإخلاص/الفلق/الناس), so reciting only the first
    // of them (15/58 words) never completes the page. Reciting every word
    // on the page completes all three surahs together and triggers the
    // celebration for the first of them.
    await typeWords(page, words, words.length);
    await page.waitForFunction(function () {
      var raw = localStorage.getItem('tasme3_v1');
      if (!raw) return false;
      var e = JSON.parse(raw).progressByPage['604'];
      return e && e.completedAt;
    }, { timeout: 10000 });
    await page.waitForTimeout(300);
    const hidden = await page.evaluate(function () { return document.getElementById('surahCelebrate').hidden; });
    check('(A1) surahCelebrate.hidden is false after a genuine surah completion', hidden === false, hidden);
    const displayStyle = await page.evaluate(function () {
      return getComputedStyle(document.getElementById('surahCelebrate')).display;
    });
    check('(A1) surahCelebrate is actually visually displayed (computed display != none)', displayStyle !== 'none', displayStyle);
    await page.click('#surahCelebrateClose');
    const hiddenAfterClose = await page.evaluate(function () { return document.getElementById('surahCelebrate').hidden; });
    check('(A1) close button hides the banner again', hiddenAfterClose === true, hiddenAfterClose);
    await context.close();
  }

  // ==================================================================
  // A2: typed fallback is usable immediately after tapping micHelpLink
  // from inside the (still-open) setup sheet.
  // ==================================================================
  {
    const { context, page } = await freshPage(browser, consoleErrors);
    await page.click('#setupBtn');
    await page.waitForFunction(function () { return document.getElementById('setupSheet').classList.contains('open'); }, { timeout: 5000 });
    await page.click('#micHelpLink');
    await page.waitForTimeout(100);
    const sheetOpen = await page.evaluate(function () { return document.getElementById('setupSheet').classList.contains('open'); });
    check('(A2) the sheet closed itself when micHelpLink was used', sheetOpen === false, sheetOpen);
    const isInert = await page.evaluate(function () { return document.getElementById('typeInput').closest('[inert]') !== null; });
    check('(A2) #typeInput is no longer inert', isInert === false, isInert);
    const activeIsTypeInput = await page.evaluate(function () { return document.activeElement && document.activeElement.id === 'typeInput'; });
    check('(A2) focus actually landed on #typeInput', activeIsTypeInput === true, activeIsTypeInput);
    await page.fill('#typeInput', 'بسم الله');
    const val = await page.evaluate(function () { return document.getElementById('typeInput').value; });
    check('(A2) #typeInput accepts fill() (genuinely focusable/typable)', val === 'بسم الله', val);
    await context.close();
  }

  // ==================================================================
  // A3: rapid browser-Back presses never escape the app.
  // ==================================================================
  {
    const { context, page } = await freshPage(browser, consoleErrors);
    // Fire 10 goBack() calls back-to-back with no await between them.
    const backs = [];
    for (let i = 0; i < 10; i++) backs.push(page.goBack());
    await Promise.allSettled(backs);
    await page.waitForTimeout(1000);
    const url = page.url();
    check('(A3) URL still on the app after 10 rapid Backs', url.indexOf(SITE_URL) === 0, url);
    const stillFunctional = await page.evaluate(function () {
      var t = document.getElementById('total');
      return !!(t && t.textContent);
    });
    check('(A3) the app is still functional after 10 rapid Backs', stillFunctional === true, stillFunctional);
    await context.close();
  }
  {
    // A single Back with the sheet open still closes the sheet and stays in-app.
    const { context, page } = await freshPage(browser, consoleErrors);
    await page.click('#setupBtn');
    await page.waitForFunction(function () { return document.getElementById('setupSheet').classList.contains('open'); }, { timeout: 5000 });
    await page.goBack();
    await page.waitForTimeout(300);
    const sheetOpen = await page.evaluate(function () { return document.getElementById('setupSheet').classList.contains('open'); });
    check('(A3) a single Back with the sheet open closes the sheet', sheetOpen === false, sheetOpen);
    const url = page.url();
    check('(A3) a single Back with the sheet open stays in the app', url.indexOf(SITE_URL) === 0, url);
    await context.close();
  }

  // ==================================================================
  // A4: a cross-tab `storage` event before i18n is ready must not throw.
  // ==================================================================
  {
    const context = await browser.newContext();
    const pageB = await context.newPage();
    await pageB.goto(SITE_URL + '/index.html', { waitUntil: 'load' });
    await pageB.waitForFunction(function () {
      var t = document.getElementById('total');
      return t && t.textContent && t.textContent.length > 0;
    }, { timeout: 10000 });

    const a4Errors = [];
    const pageA = await context.newPage();
    pageA.on('pageerror', function (err) { a4Errors.push('pageerror: ' + err.message); });
    pageA.on('console', function (msg) {
      if (msg.type() !== 'error') return;
      var loc = msg.location() || {};
      if (isExpectedNoise(loc.url)) return;
      a4Errors.push(msg.text() + ' @ ' + (loc.url || ''));
    });
    // Start navigating tab A but don't wait for it to finish loading --
    // fire tab B's storage write as early as possible afterwards, racing
    // to land while tab A's `t` (Tasme3I18n.t) is still null.
    const navPromise = pageA.goto(SITE_URL + '/index.html', { waitUntil: 'domcontentloaded' });
    await pageB.evaluate(function () {
      localStorage.setItem('tasme3_v1', JSON.stringify({
        v: 3,
        progressByPage: { '5': { pointer: 2, revealed: [0, 1], contextRevealed: [], completedAt: null } },
        streak: { count: 1, lastDay: null },
        today: { day: null, wordsRevealed: 3 }
      }));
    });
    await navPromise;
    await pageA.waitForFunction(function () {
      var t = document.getElementById('total');
      return t && t.textContent && t.textContent.length > 0;
    }, { timeout: 10000 }).catch(function () {});
    await pageA.waitForTimeout(500);
    check('(A4) no pageerror from a storage event racing i18n readiness', a4Errors.length === 0, a4Errors);
    await context.close();
  }

  // ==================================================================
  // A5: page-chip surah name is derived from the page's own tokens, not
  // surahForPage()'s "last surah with firstPage <= p".
  // ==================================================================
  {
    const cases = [
      { page: 604, name: 'الإخلاص' },
      { page: 603, name: 'الكافرون' },
      { page: 599, name: 'الزلزلة' },
      { page: 293, name: 'الكهف' },
      { page: 76, name: 'آل عمران' },
      { page: 3, name: 'البقرة' }
    ];
    for (const c of cases) {
      const { context, page } = await freshPage(browser, consoleErrors, { qs: '?page=' + c.page });
      // #pageChip is first rendered from surahForPage()'s cheap synchronous
      // guess (the bare "Page NNN" label) and only gets the real per-token
      // surah name once site/surah-index.json's fetch resolves -- reading it
      // right away is a race that flakes on a slow/cold fetch. Wait for the
      // chip to actually carry the expected surah name (or, failing that,
      // for it to at least have moved off the bare page-number label) before
      // asserting anything.
      await page.waitForFunction(function (name) {
        var el = document.getElementById('pageChip');
        var txt = el && el.textContent || '';
        return txt.indexOf(name) !== -1 || !/^Page \d+$/.test(txt.trim());
      }, c.name, { timeout: 5000 }).catch(function () {});
      // Read the chip text and the aria-label together in one evaluate() so
      // a second surah-index resolution landing between two separate reads
      // can never make them drift relative to each other.
      const snap = await page.evaluate(function () {
        return {
          chipText: document.getElementById('pageChip').textContent,
          ariaLabel: document.getElementById('pagecanvas').getAttribute('aria-label'),
          role: document.getElementById('pagecanvas').getAttribute('role')
        };
      });
      check('(A5) page ' + c.page + ' chip shows ' + c.name, snap.chipText.indexOf(c.name) !== -1, snap.chipText);
      // C7: #pagecanvas's aria-label must be kept in sync with the chip.
      check('(C7) page ' + c.page + ' #pagecanvas aria-label matches the chip text', snap.ariaLabel === snap.chipText, snap);
      check('(C7) page ' + c.page + ' #pagecanvas has role="img"', snap.role === 'img', snap.role);
      await context.close();
    }
  }

  // ==================================================================
  // B8: go-to-page rejects anything but ASCII/Arabic-Indic digits.
  // ==================================================================
  async function openPageTab(page) {
    await page.click('#menuBtn');
    await page.click('.drawer-tabs button[data-tab="page"]');
    await page.waitForFunction(function () { return !document.getElementById('drawerJump').hidden; }, { timeout: 5000 });
  }
  const invalidInputs = ['-5', '0', '605', 'abc', '3.7', '3 7'];
  for (const raw of invalidInputs) {
    const { context, page } = await freshPage(browser, consoleErrors);
    await openPageTab(page);
    await page.fill('#drawerPageInput', raw);
    await page.click('#drawerGoBtn');
    await page.waitForTimeout(150);
    const toastShown = await page.evaluate(function () { return document.getElementById('toast').classList.contains('show'); });
    check('(B8) "' + raw + '" is rejected with a toast', toastShown === true, toastShown);
    const lastPage = await page.evaluate(function () {
      var raw2 = localStorage.getItem('tasme3_v1');
      return raw2 ? JSON.parse(raw2).settings.lastPage : null;
    });
    check('(B8) "' + raw + '" never navigates away from the default landing page', lastPage === 3, lastPage);
    await context.close();
  }
  const validInputs = ['٢٩٣', '293'];
  for (const raw of validInputs) {
    const { context, page } = await freshPage(browser, consoleErrors);
    await openPageTab(page);
    await page.fill('#drawerPageInput', raw);
    await page.click('#drawerGoBtn');
    await page.waitForFunction(function () {
      var raw2 = localStorage.getItem('tasme3_v1');
      return raw2 && JSON.parse(raw2).settings.lastPage === 293;
    }, { timeout: 5000 }).catch(function () {});
    const lastPage = await page.evaluate(function () {
      var raw2 = localStorage.getItem('tasme3_v1');
      return raw2 ? JSON.parse(raw2).settings.lastPage : null;
    });
    check('(B8) "' + raw + '" navigates to page 293', lastPage === 293, lastPage);
    await context.close();
  }

  // ==================================================================
  // C3: a second ☰ tap, at the SAME physical spot, closes the open drawer.
  //
  // The open drawer (z-index 31) slides in OVER the ☰ button's own screen
  // position (both are anchored to the same screen edge, mirrored by
  // `dir`) -- previously the element that ended up under that exact spot
  // was the drawer header's <h2> title (see the .drawer-head fix in
  // style.css), so a real second tap there hit inert title text and never
  // reached #menuBtn's own toggle logic at all. Dispatching the click
  // event straight at #menuBtn (the old approach) could never have caught
  // that -- it bypasses hit-testing entirely -- so this drives it with
  // real page.mouse.click()s at the ☰ button's own on-screen coordinates,
  // exactly as an elderly user's second tap would land, in both RTL and
  // LTR. It also re-checks the accessibility expectations a header
  // reshuffle could plausibly have broken: #drawerClose stays a 44x44
  // target, opening still moves focus into the drawer, and Escape still
  // closes it.
  // ==================================================================
  for (const loc of [{ locale: 'ar-SA', dir: 'rtl' }, { locale: 'en-US', dir: 'ltr' }]) {
    const { context, page } = await freshPage(browser, consoleErrors, {
      contextOptions: { locale: loc.locale, viewport: { width: 390, height: 844 } }
    });
    const dir = await page.evaluate(function () { return document.documentElement.dir; });
    check('(C3) ' + loc.locale + ' context actually renders dir=' + loc.dir, dir === loc.dir, dir);

    // The topbar is hidden (translated off-screen) until showChrome() runs
    // on initial load and its .28s CSS transition settles -- read ☰'s
    // coordinates only once that's done, or they'd be a mid-transition
    // position rather than its real resting spot.
    await page.waitForFunction(function () { return document.body.classList.contains('chrome-visible'); }, { timeout: 5000 });
    await page.waitForTimeout(350);
    const menuBox = await page.locator('#menuBtn').boundingBox();
    const cx = menuBox.x + menuBox.width / 2, cy = menuBox.y + menuBox.height / 2;

    // ---- first tap: opens the drawer ----
    await page.mouse.click(cx, cy);
    await page.waitForFunction(function () { return document.getElementById('drawer').classList.contains('open'); }, { timeout: 5000 });
    await page.waitForTimeout(350); // let the drawer's own .25s slide-in transition settle

    const closeBox = await page.locator('#drawerClose').boundingBox();
    check('(a11y) ' + loc.locale + ' #drawerClose is a 44x44 touch target',
      closeBox.width === 44 && closeBox.height === 44, closeBox);
    const closeCenter = { x: closeBox.x + closeBox.width / 2, y: closeBox.y + closeBox.height / 2 };
    // #drawerClose's center must land inside ☰'s own on-screen box -- the
    // same physical spot a second tap targets.
    const withinMenuBox = closeCenter.x >= menuBox.x && closeCenter.x <= menuBox.x + menuBox.width &&
      closeCenter.y >= menuBox.y && closeCenter.y <= menuBox.y + menuBox.height;
    check('(C3) ' + loc.locale + ' #drawerClose sits under ☰\'s own spot', withinMenuBox, { menuBox, closeBox, closeCenter });

    const focusInDrawer = await page.evaluate(function () {
      var a = document.activeElement;
      return !!(a && document.getElementById('drawer').contains(a));
    });
    check('(a11y) ' + loc.locale + ' focus moved into the drawer on open', focusInDrawer, focusInDrawer);

    // ---- second tap, same physical (cx, cy): must close the drawer ----
    await page.mouse.click(cx, cy);
    await page.waitForTimeout(350);
    const openAfterSecondTap = await page.evaluate(function () { return document.getElementById('drawer').classList.contains('open'); });
    check('(C3) ' + loc.locale + ' a second tap at the SAME ☰ spot closes the already-open drawer',
      openAfterSecondTap === false, openAfterSecondTap);

    // ---- Escape still closes the drawer too ----
    await page.mouse.click(cx, cy);
    await page.waitForFunction(function () { return document.getElementById('drawer').classList.contains('open'); }, { timeout: 5000 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    const openAfterEscape = await page.evaluate(function () { return document.getElementById('drawer').classList.contains('open'); });
    check('(a11y) ' + loc.locale + ' Escape still closes the drawer', openAfterEscape === false, openAfterEscape);

    await context.close();
  }

  // ---- zero unexpected console errors across all of the above ----
  check('(Z) zero unexpected console errors', consoleErrors.length === 0, consoleErrors);

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('FATAL', e); process.exit(1); });
