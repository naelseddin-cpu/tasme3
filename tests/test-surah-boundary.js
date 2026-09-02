// Playwright regression test for the surah-boundary reveal bug (page 604:
// الإخلاص -> الفلق). Drives the REAL site/ app.js against a fake
// SpeechRecognition, and reads back the persisted localStorage progress
// (site/storage.js's KEY 'tasme3_v1') rather than poking at app.js
// internals -- app.js is exercised exactly as a real browser session would.
const { chromium } = require('playwright-core');
const path = require('path');

const SITE_URL = process.env.SITE_URL || 'http://127.0.0.1:8842';
const EXEC = '/opt/pw-browsers/chromium';

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('PASS:', name); }
  else { fail++; console.log('FAIL:', name, extra !== undefined ? JSON.stringify(extra) : ''); }
}

const INIT_SCRIPT = `
(function () {
  function FakeSpeechRecognition() {
    this.lang = ''; this.continuous = false; this.interimResults = false;
    this.onresult = null; this.onerror = null; this.onend = null;
    window.__latestRec = this;
    window.__recStartCount = (window.__recStartCount || 0) + 1;
  }
  FakeSpeechRecognition.prototype.start = function () {
    window.__recStartCount = (window.__recStartCount || 0) + 1;
  };
  FakeSpeechRecognition.prototype.stop = function () {};
  window.SpeechRecognition = FakeSpeechRecognition;
  window.webkitSpeechRecognition = FakeSpeechRecognition;

  var fakeStream = { getTracks: function () { return []; } };
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: function () { return Promise.resolve(fakeStream); } }
  });
})();
`;

async function freshPage(browser, consoleErrors) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.addInitScript(INIT_SCRIPT);
  page.on('console', function (msg) {
    if (msg.type() !== 'error') return;
    var loc = msg.location() || {};
    // Pre-existing, documented, expected noise: certificate.js probes up to
    // 6 optional certificate-background artwork slots via fetch() and
    // treats a 404 as "not present yet" (site/certificate.js's
    // tryLoadAnyExt) -- this repo ships only 3 of them, so slots 4-6 404 on
    // EVERY page load, completely unrelated to speech recognition/matching,
    // and present identically before this fix (verified against an
    // untouched load with no scenario interaction). Every other console
    // error is real and fails the check.
    if (/certificate-bg-/.test(loc.url || '')) return;
    consoleErrors.push(msg.text() + ' @ ' + (loc.url || ''));
  });
  page.on('pageerror', function (err) {
    consoleErrors.push('pageerror: ' + err.message);
  });
  await page.goto(SITE_URL + '/index.html?page=604', { waitUntil: 'load' });
  await page.waitForFunction(function () {
    var t = document.getElementById('total');
    return t && t.textContent && t.textContent.length > 0;
  }, { timeout: 10000 });
  await page.click('#recBtn');
  await page.waitForFunction(function () {
    return !!(window.__latestRec && typeof window.__latestRec.onresult === 'function');
  }, { timeout: 10000 });
  return { context, page };
}

// Real SpeechRecognition's ev.results accumulates across events within one
// session (indices only ever grow) -- so appendFinal mirrors that: it
// extends the page-held results list with new finalized entries, then
// fires onresult with the FULL accumulated list, exactly like the browser
// would. refire() re-delivers that same accumulated list completely
// unchanged, simulating the browser re-firing/duplicating an event.
function appendFinal(page, transcripts) {
  return page.evaluate(function (texts) {
    window.__srResults = window.__srResults || [];
    texts.forEach(function (t) { window.__srResults.push({ isFinal: true, length: 1, 0: { transcript: t } }); });
    window.__latestRec.onresult({ results: window.__srResults });
  }, transcripts);
}
function refire(page) {
  return page.evaluate(function () {
    window.__latestRec.onresult({ results: window.__srResults || [] });
  });
}

async function readProgress(page) {
  return page.evaluate(function () {
    var raw = localStorage.getItem('tasme3_v1');
    if (!raw) return null;
    var st = JSON.parse(raw);
    return st.progressByPage['604'] || null;
  });
}

(async function main() {
  const browser = await chromium.launch({ executablePath: EXEC, headless: true });
  const consoleErrors = [];

  // ---- Scenario (a) + (b): boundary gate, then a fresh legitimate result ----
  {
    const { context, page } = await freshPage(browser, consoleErrors);

    // Full سورة الإخلاص, immediately followed (same result / same final
    // transcript blob) by a duplicated echo of its own opening phrase --
    // reproduces the founder report where the echo's "قل" landed directly
    // on الفلق's own opening "قل".
    const combined = 'قل هو الله احد الله الصمد لم يلد ولم يولد ولم يكن له كفوا احد' +
      ' قل هو الله احد';
    await appendFinal(page, [combined]);
    let prog = await readProgress(page);
    const revealedA = new Set(prog ? prog.revealed : []);
    const ikhlasFull = Array.from({ length: 15 }, function (_, i) { return i; }); // indices 0..14
    check('(a) every الإخلاص word (0-14) revealed', ikhlasFull.every(function (i) { return revealedA.has(i); }), prog);
    check('(a) الفلق\'s قل (index 15) still veiled', !revealedA.has(15), prog);
    check('(a) pointer parked at 15 (الفلق\'s قل, unrevealed)', prog && prog.pointer === 15, prog);

    // (b) A fresh, separate result: the actual, correct opening of الفلق.
    await appendFinal(page, ['قل اعوذ برب الفلق']);
    prog = await readProgress(page);
    const revealedB = new Set(prog.revealed);
    check('(b) الفلق opening words (15-18) reveal on a fresh result',
      [15, 16, 17, 18].every(function (i) { return revealedB.has(i); }), prog);
    check('(b) pointer advances to 19', prog.pointer === 19, prog);

    await context.close();
  }

  // ---- Scenario (c): identical final result delivered twice ----
  {
    const { context, page } = await freshPage(browser, consoleErrors);
    await appendFinal(page, ['قل هو الله احد']);
    const progAfterFirst = await readProgress(page);

    // Re-deliver the exact same ev.results (same index space, same
    // content) -- simulates the browser re-firing/duplicating a result
    // event without the app-level `processed` counter having moved.
    await refire(page);
    const progAfterSecond = await readProgress(page);

    check('(c) duplicate final result reveals nothing new',
      JSON.stringify(progAfterFirst.revealed) === JSON.stringify(progAfterSecond.revealed),
      { first: progAfterFirst, second: progAfterSecond });
    check('(c) duplicate final result does not advance pointer further',
      progAfterFirst.pointer === progAfterSecond.pointer, { first: progAfterFirst, second: progAfterSecond });

    await context.close();
  }

  // ---- Scenario (d): page-604 chip surah name on a fresh load (residual
  // audit A5 -- surahForPage() used to return the LAST surah with
  // firstPage<=p, which for this exact page happened to still agree with
  // the TOKEN-BASED fix's answer, so this is a same-page regression guard
  // for the boundary logic this file already exercises, not new coverage
  // of the bug itself -- see site/tests/test-residuals.js's (A5) block for
  // the pages that actually caught the bug). ----
  {
    const { context, page } = await freshPage(browser, consoleErrors);
    const chipText = await page.evaluate(function () { return document.getElementById('pageChip').textContent; });
    check('(d) page 604 chip shows الإخلاص on a fresh load', chipText.indexOf('الإخلاص') !== -1, chipText);
    await context.close();
  }

  // ---- (e) console errors across all of the above ----
  check('(e) zero unexpected console errors', consoleErrors.length === 0, consoleErrors);

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('FATAL', e); process.exit(1); });
