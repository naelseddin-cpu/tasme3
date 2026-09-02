// Regression test for the "View Certificate" focus-restore bug (T3):
// #surahCelebrate's viewCertBtn.onclick used to hide the celebration
// banner (and itself, as its descendant) BEFORE openCertificateFor()'s
// promise chain got around to calling registerOverlayOpen(), which reads
// document.activeElement as the "opener" to restore focus to on close --
// by then that read back `body`, so closing the certificate modal (e.g.
// via Escape) dropped focus to the document instead of anywhere visible.
//
// Fix: site/app.js's viewCertBtn.onclick now captures the opener BEFORE
// hiding the banner and passes it through to registerOverlayOpen(); and
// registerOverlayClose() now falls back to #setupBtn if that opener is no
// longer visible when the overlay closes (which it always is here, since
// hiding #surahCelebrate hides viewCertBtn along with it).
//
// Same conventions as the other site/tests/*.js: drives the REAL site/
// app.js against a headless browser, seeds a completed surah exactly like
// test-cert-integrity.js / test-residuals.js's (A1) scenario, and reads
// back document.activeElement directly -- never pokes at app.js internals.
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
  // file (see test-residuals.js): certificate.js probes up to 6 optional
  // certificate-background artwork slots via fetch() and treats a 404 as
  // "not present yet" -- this repo ships only 3 of them.
  return /certificate-bg-/.test(url || '');
}

async function freshPage(browser, consoleErrors) {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('console', function (msg) {
    if (msg.type() !== 'error') return;
    var loc = msg.location() || {};
    if (isExpectedNoise(loc.url)) return;
    consoleErrors.push(msg.text() + ' @ ' + (loc.url || ''));
  });
  page.on('pageerror', function (err) { consoleErrors.push('pageerror: ' + err.message); });
  await page.goto(SITE_URL + '/index.html?page=604', { waitUntil: 'load' });
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

  const { context, page } = await freshPage(browser, consoleErrors);

  // Reciting every word on page 604 completes all three of its single-page
  // surahs (الإخلاص/الفلق/الناس) together, triggering the celebration
  // banner for the first of them -- same setup as test-residuals.js (A1).
  const words = await pageWords(page, '604');
  await typeWords(page, words, words.length);

  await page.waitForFunction(function () {
    var banner = document.getElementById('surahCelebrate');
    return banner && !banner.hidden;
  }, { timeout: 10000 });

  // ---- activate "View Certificate" BY KEYBOARD (focus + Enter, no click) ----
  await page.evaluate(function () { document.getElementById('viewCertBtn').focus(); });
  const focusedViewCert = await page.evaluate(function () { return document.activeElement && document.activeElement.id; });
  check('(pre) viewCertBtn is focused before activation', focusedViewCert === 'viewCertBtn', focusedViewCert);

  await page.keyboard.press('Enter');

  await page.waitForFunction(function () {
    var modal = document.getElementById('certModal');
    return modal && !modal.hidden;
  }, { timeout: 10000 });

  const bannerHiddenAfterOpen = await page.evaluate(function () { return document.getElementById('surahCelebrate').hidden; });
  check('(1) opening the certificate hides the celebration banner (and its viewCertBtn) behind it', bannerHiddenAfterOpen === true, bannerHiddenAfterOpen);

  // ---- close with Escape, assert focus landed somewhere real ----
  await page.keyboard.press('Escape');
  await page.waitForFunction(function () {
    var modal = document.getElementById('certModal');
    return modal && modal.hidden;
  }, { timeout: 5000 });
  // Give the overlay-close focus restore (registerOverlayClose) a tick --
  // it runs synchronously, but a rAF/microtask margin costs nothing here.
  await page.waitForTimeout(30);

  const active = await page.evaluate(function () {
    var a = document.activeElement;
    if (!a) return null;
    return {
      id: a.id,
      tagName: a.tagName,
      isBody: a === document.body,
      visible: a.offsetParent !== null,
    };
  });
  check('(2) focus after Escape is NOT on <body>', active && active.isBody === false, active);
  check('(3) focus after Escape is on a visible element', active && active.visible === true, active);
  check('(4) focus after Escape landed on a real button (id set)', active && !!active.id && active.tagName === 'BUTTON', active);
  // The banner's own viewCertBtn is hidden by now (see check (1)), so the
  // fix's fallback path (#setupBtn) is exactly what should have fired.
  check('(5) focus after Escape specifically fell back to #setupBtn', active && active.id === 'setupBtn', active);

  check('(Z) zero unexpected console errors', consoleErrors.length === 0, consoleErrors);

  await context.close();
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('FATAL', e); process.exit(1); });
