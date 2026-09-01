// Regression test for the storage-corruption audit's certificate-forgery
// (finding 2) and multi-tab clobber (finding 1) fixes.
//
// Finding 2 -- site/certificate.js's isSurahComplete() used to trust a
// page's `completedAt` outright whenever `contextRevealed` was empty, so a
// hand-crafted localStorage entry ({completedAt: '...', revealed: []})
// with ZERO genuine recitation minted a real, downloadable certificate.
// The fix always word-verifies every page in a surah's range (via
// pageSurahWordsGenuinelyRevealed()); `completedAt` is advisory only.
//
// Finding 1 -- site/storage.js's save() used to write the whole blob from
// a possibly-stale in-memory snapshot, so two tabs (or a tab racing a
// background sync) could clobber each other's progress outright. The fix
// merges into whatever is currently in localStorage (union of revealed/
// contextRevealed, max pointer, latest completedAt/streak/today) on every
// save() rather than overwriting it.
//
// Same conventions as the other site/tests/*.js: drives the REAL site/
// app.js + certificate.js + storage.js against a real (headless) browser,
// reads back localStorage/`Tasme3Certificate.completedSurahList()`
// directly, never pokes at internals.
const { chromium } = require('playwright-core');

const SITE_URL = process.env.SITE_URL || 'http://127.0.0.1:8842';
const EXEC = '/opt/pw-browsers/chromium';

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('PASS:', name); }
  else { fail++; console.log('FAIL:', name, extra !== undefined ? JSON.stringify(extra) : ''); }
}

// Navigates and waits for the app to actually be ready (the counter has
// rendered) BEFORE the caller pokes at localStorage -- app.js's own async
// init chain calls Storage.save() itself (sessionCount++, loadPage()'s
// lastPage write); poking localStorage before that settles is a race that
// has nothing to do with this file's fixes, so every helper below waits
// past it first, exactly like site/tests/test-surah-start-jump.js does.
async function freshReadyPage(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(SITE_URL + '/index.html', { waitUntil: 'load' });
  await page.waitForFunction(function () {
    var t = document.getElementById('total');
    return t && t.textContent && t.textContent.length > 0;
  }, { timeout: 10000 });
  return { context, page };
}

function setRawState(page, blob) {
  return page.evaluate(function (b) { localStorage.setItem('tasme3_v1', JSON.stringify(b)); }, blob);
}

async function certList(page) {
  return page.evaluate(async function () {
    var idx = await fetch('surah-index.json').then(function (r) { return r.json(); });
    var state = JSON.parse(localStorage.getItem('tasme3_v1'));
    return window.Tasme3Certificate.completedSurahList(state, idx);
  });
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

async function pageWords(page, nnn) {
  return page.evaluate(function (p) {
    return fetch('pages/page-' + p + '.json').then(function (r) { return r.json(); }).then(function (d) {
      var out = [];
      d.tokens.forEach(function (tk) { if (!tk.e) out.push(tk.n); });
      return out;
    });
  }, nnn);
}

async function surahWordCountOnPage(page, nnn, surahNumber) {
  return page.evaluate(function (args) {
    return fetch('pages/page-' + args.p + '.json').then(function (r) { return r.json(); }).then(function (d) {
      var n = 0;
      d.tokens.forEach(function (tk) {
        if (!tk.e && tk.k && parseInt(tk.k.split(':')[0], 10) === args.s) n++;
      });
      return n;
    });
  }, { p: nnn, s: surahNumber });
}

async function stateOf(page) {
  return page.evaluate(function () {
    try { return JSON.parse(localStorage.getItem('tasme3_v1')); } catch (e) { return null; }
  });
}

(async function main() {
  const browser = await chromium.launch({ executablePath: EXEC, headless: true });

  // ---- Forgery repro 1: single-page surah 112 الإخلاص (page 604), all
  // fabricated (completedAt set, revealed=[]) -- must credit NOTHING.
  {
    const { context, page } = await freshReadyPage(browser);
    await setRawState(page, {
      v: 3,
      progressByPage: { '604': { pointer: 0, revealed: [], contextRevealed: [], completedAt: '2020-01-01' } }
    });
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(400);
    const list = await certList(page);
    check('forgery: fabricated completedAt on single-page surah 112 (page 604) credits ZERO surahs',
      list.length === 0, list);
    await context.close();
  }

  // ---- Forgery repro 2: 2-page surah 111 المسد (pages 603-604), both
  // fabricated -- must credit NOTHING (not even the single-page surahs
  // 109/110/112/113/114 whose entire range happens to be one of those
  // two forged pages).
  {
    const { context, page } = await freshReadyPage(browser);
    await setRawState(page, {
      v: 3,
      progressByPage: {
        '603': { pointer: 0, revealed: [], contextRevealed: [], completedAt: '2020-01-01' },
        '604': { pointer: 0, revealed: [], contextRevealed: [], completedAt: '2020-01-01' }
      }
    });
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(400);
    const list = await certList(page);
    check('forgery: fabricated completedAt on pages 603+604 credits ZERO surahs (109-114 all forged-adjacent)',
      list.length === 0, list);
    await context.close();
  }

  // ---- Forgery repro 3: the "one-liner" -- every one of the 604 pages
  // fabricated at once. Must still credit ZERO certificates.
  {
    const { context, page } = await freshReadyPage(browser);
    const blob = await page.evaluate(function () {
      var pbp = {};
      for (var p = 1; p <= 604; p++) {
        pbp[String(p)] = { pointer: 0, revealed: [], contextRevealed: [], completedAt: '2020-01-01' };
      }
      return { v: 3, progressByPage: pbp };
    });
    await setRawState(page, blob);
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(600);
    const list = await certList(page);
    check('forgery: all-604-pages completedAt-only fabrication credits ZERO certificates', list.length === 0, list);
    await context.close();
  }

  // ---- Control (pre-existing behavior, must still hold): completedAt SET
  // but contextRevealed non-empty and revealed=[] -- word-level re-check
  // must still fail closed.
  {
    const { context, page } = await freshReadyPage(browser);
    await setRawState(page, {
      v: 3,
      progressByPage: { '604': { pointer: 5, revealed: [], contextRevealed: [0, 1, 2], completedAt: '2020-01-01' } }
    });
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(400);
    const list = await certList(page);
    check('control: completedAt + non-empty contextRevealed + revealed=[] still fails closed', list.length === 0, list);
    await context.close();
  }

  // ---- Genuine credit: actually recite (typed fallback) every one of
  // page 604's surah-112 (الإخلاص) words -- must be credited for real.
  {
    const { context, page } = await freshReadyPage(browser);
    await page.goto(SITE_URL + '/index.html?page=604', { waitUntil: 'load' });
    await page.waitForFunction(function () {
      var t = document.getElementById('total');
      return t && t.textContent && t.textContent.length > 0;
    }, { timeout: 10000 });
    const words = await pageWords(page, '604');
    const n = await surahWordCountOnPage(page, '604', 112);
    await typeWords(page, words, n);
    await page.waitForTimeout(300);
    const list = await certList(page);
    check('genuine recitation of page 604\'s الإخلاص IS credited', list.some(function (c) { return c.number === 112; }), list);
    await context.close();
  }

  // ---- Multi-tab union (finding 1): two tabs on the SAME page, one
  // recites fewer words but its save() call lands LAST (slower typing) --
  // must not clobber the other tab's larger, already-saved progress.
  {
    const ctx = await browser.newContext();
    const a = await ctx.newPage();
    const b = await ctx.newPage();
    await Promise.all([
      a.goto(SITE_URL + '/index.html?page=5', { waitUntil: 'load' }),
      b.goto(SITE_URL + '/index.html?page=5', { waitUntil: 'load' }),
    ]);
    await Promise.all([
      a.waitForFunction(function () { var t = document.getElementById('total'); return t && t.textContent; }, { timeout: 10000 }),
      b.waitForFunction(function () { var t = document.getElementById('total'); return t && t.textContent; }, { timeout: 10000 }),
    ]);
    const words = await pageWords(a, '005');
    // A recites 8 words fast; B recites only 3 words but slowly, so B's
    // save() call is the one that lands LAST in wall-clock time.
    await Promise.all([
      typeWords(a, words, 8),
      (async function () {
        await b.evaluate(function () { var el = document.getElementById('micHelpLink'); if (el) el.click(); });
        for (let i = 1; i <= 3; i++) {
          await b.evaluate(function (v) {
            var inp = document.getElementById('typeInput');
            inp.value = v; inp.dispatchEvent(new Event('input', { bubbles: true }));
          }, words.slice(0, i).join(' '));
          await b.waitForTimeout(180);
        }
      })()
    ]);
    await a.waitForTimeout(300); await b.waitForTimeout(300);
    const st = await stateOf(a);
    const entry = st.progressByPage['5'];
    check('multi-tab: tab A\'s 8-word progress survives a tab B save landing last with only 3 words',
      entry && entry.revealed.length === 8, entry);
    await ctx.close();
  }

  // ---- Multi-tab union: two tabs on DIFFERENT pages, concurrent -- both
  // pages' progress must survive in progressByPage (no whole-blob clobber).
  {
    const ctx = await browser.newContext();
    const a = await ctx.newPage();
    const b = await ctx.newPage();
    await Promise.all([
      a.goto(SITE_URL + '/index.html?page=3', { waitUntil: 'load' }),
      b.goto(SITE_URL + '/index.html?page=4', { waitUntil: 'load' }),
    ]);
    await Promise.all([
      a.waitForFunction(function () { var t = document.getElementById('total'); return t && t.textContent; }, { timeout: 10000 }),
      b.waitForFunction(function () { var t = document.getElementById('total'); return t && t.textContent; }, { timeout: 10000 }),
    ]);
    const words3 = await pageWords(a, '003');
    const words4 = await pageWords(b, '004');
    await Promise.all([typeWords(a, words3, 8), typeWords(b, words4, 6)]);
    await a.waitForTimeout(300); await b.waitForTimeout(300);
    const st = await stateOf(a);
    check('multi-tab: page 3 and page 4 progress both survive concurrent different-page writes',
      st.progressByPage['3'] && st.progressByPage['3'].revealed.length === 8 &&
      st.progressByPage['4'] && st.progressByPage['4'].revealed.length === 6,
      st.progressByPage);
    await ctx.close();
  }

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('FATAL', e); process.exit(1); });
