// Playwright regression test for the founder-reported "select سورة النصر ->
// pointer starts on الكافرون" bug. Drives the REAL site/ app.js (drawer
// click and all) against a fake SpeechRecognition (unused here -- this
// scenario recites via the typed fallback) and reads back the persisted
// localStorage progress (site/storage.js's KEY 'tasme3_v1'), same
// convention as site/tests/test-surah-boundary.js.
const { chromium } = require('playwright-core');

const SITE_URL = process.env.SITE_URL || 'http://127.0.0.1:8842';
const EXEC = '/opt/pw-browsers/chromium';

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('PASS:', name); }
  else { fail++; console.log('FAIL:', name, extra !== undefined ? JSON.stringify(extra) : ''); }
}

async function freshPage(browser, consoleErrors) {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('console', function (msg) {
    if (msg.type() !== 'error') return;
    var loc = msg.location() || {};
    // Pre-existing, documented, expected noise -- see test-surah-boundary.js.
    if (/certificate-bg-/.test(loc.url || '')) return;
    consoleErrors.push(msg.text() + ' @ ' + (loc.url || ''));
  });
  page.on('pageerror', function (err) { consoleErrors.push('pageerror: ' + err.message); });
  await page.goto(SITE_URL + '/index.html', { waitUntil: 'load' });
  await page.waitForFunction(function () {
    var t = document.getElementById('total');
    return t && t.textContent && t.textContent.length > 0;
  }, { timeout: 10000 });
  return { context, page };
}

// Opens the drawer (defaults to the SURAH tab), waits for the list to be
// populated from surah-index.json (a real async fetch, can lag the initial
// page load), and clicks the row whose visible name matches `surahName`.
// `expectPage` is the page that selection must land on. loadPage() is
// async (fetches pages/page-NNN.json + the .webp) -- waiting on
// localStorage's settings.lastPage alone is not enough (it's written
// synchronously, before those fetches even start), and a surah that needs
// NO context (starts a page at index 0, see Scenarios B/C) never creates a
// progressByPage entry at all until something is actually recited -- so
// this waits for the network to go idle (both fetches settled) plus a
// short buffer for the promise chain that follows them to finish updating
// state, then sanity-checks lastPage actually landed where expected.
async function pickSurahFromDrawer(page, surahName, expectPage) {
  await page.click('#menuBtn');
  await page.waitForFunction(function () {
    return document.querySelectorAll('#drawerList .drawer-item').length > 0;
  }, { timeout: 10000 });
  const clicked = await page.evaluate(function (name) {
    var rows = Array.from(document.querySelectorAll('#drawerList .drawer-item'));
    var row = rows.find(function (r) { return r.textContent.indexOf(name) !== -1; });
    if (!row) return false;
    row.click();
    return true;
  }, surahName);
  if (!clicked) throw new Error('drawer row not found for ' + surahName);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(200);
  const lastPage = await page.evaluate(function () {
    return JSON.parse(localStorage.getItem('tasme3_v1')).settings.lastPage;
  });
  if (lastPage !== expectPage) throw new Error('expected to land on page ' + expectPage + ', got ' + lastPage);
}

async function readState(page) {
  return page.evaluate(function () {
    var raw = localStorage.getItem('tasme3_v1');
    return raw ? JSON.parse(raw) : null;
  });
}

// Normalizes Arabic-Indic digits to Western so counter assertions are
// script-agnostic. Not just belt-and-suspenders: site/i18n.js's
// setLanguage() persists the language choice via its OWN fresh
// load-modify-save of localStorage, independent of app.js's long-lived
// in-memory `state` -- a later Storage.save(state) from app.js (e.g. after
// reciting) writes app.js's own (stale, pre-switch) settings.lang back over
// it. That's a pre-existing quirk of the language-persistence plumbing,
// unrelated to and out of scope for this fix, but it does mean a reload
// can legitimately land back on the browser-detected language rather than
// the one explicitly selected right before it -- so counter digits are
// compared numerically here rather than by script.
var AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
function toWesternDigits(s) {
  return String(s).replace(/[٠-٩]/g, function (ch) { return String(AR_DIGITS.indexOf(ch)); });
}
function readCounter(page) {
  return page.evaluate(function () {
    return { count: document.getElementById('count').textContent, total: document.getElementById('total').textContent };
  }).then(function (c) {
    return { count: toWesternDigits(c.count), total: toWesternDigits(c.total) };
  });
}

// Feeds `text` through the typed-recitation fallback exactly like a user
// who tapped "الميكروفون لا يعمل؟" would -- wireTyping() is what site/app.js
// binds the #typeInput 'input' listener through, and .fill() fires a single
// 'input' event with the full value, same as the matcher tests elsewhere
// expect (see app/tests/test-matcher.js's transcript-per-call shape).
async function typeRecite(page, text) {
  await page.evaluate(function () { document.getElementById('micHelpLink').click(); });
  await page.fill('#typeInput', text);
}

(async function main() {
  const browser = await chromium.launch({ executablePath: EXEC, headless: true });
  const consoleErrors = [];

  // ---- Scenario A: النصر from the drawer on page 603 (the founder's bug) ----
  {
    const { context, page } = await freshPage(browser, consoleErrors);
    // Force Arabic so the counter's digit assertions below are deterministic
    // regardless of the headless browser's default Accept-Language.
    // #langSelect lives inside the drawer, which (wave-1 a11y fix: a closed
    // drawer is now genuinely invisible/unfocusable, not just off-screen)
    // must be opened before Playwright can interact with it -- same as a
    // real user would have to. Escape re-closes it afterwards (also a wave-1
    // fix) so pickSurahFromDrawer's own #menuBtn click below reopens a
    // genuinely-closed drawer rather than fighting an already-open one for
    // the same on-screen click target.
    await page.click('#menuBtn');
    await page.selectOption('#langSelect', 'ar');
    await page.waitForTimeout(200);
    await page.keyboard.press('Escape');
    // Wait on the actual post-close state (drawer closed, background no
    // longer inert) rather than a fixed delay -- the close transition plus
    // the a11y inert/visibility reconciliation should be done well within
    // one second, but a bare timeout close to that margin is exactly the
    // kind of thing that flakes under load.
    await page.waitForFunction(function () {
      return !document.getElementById('drawer').classList.contains('open') &&
        !document.querySelector('.frame').hasAttribute('inert');
    }, { timeout: 5000 });
    await pickSurahFromDrawer(page, 'النصر', 603);

    let st = await readState(page);
    let entry = st.progressByPage['603'];
    check('(A) lastPage now 603', st.settings.lastPage === 603, st.settings);
    check('(A) pointer parked at 26 (النصر\'s اذا, unrevealed)', entry && entry.pointer === 26, entry);
    const ctxExpected = Array.from({ length: 26 }, function (_, i) { return i; });
    check('(A) contextRevealed is exactly indices 0-25 (الكافرون)',
      entry && JSON.stringify(entry.contextRevealed.slice().sort(function (a, b) { return a - b; })) === JSON.stringify(ctxExpected),
      entry && entry.contextRevealed);
    check('(A) genuine revealed set is empty (nothing recited yet)', entry && entry.revealed.length === 0, entry);

    let counter = await readCounter(page);
    // Counter-semantics choice (documented in site/app.js's updateCounter()):
    // context excluded from both sides -- 68 page words - 26 context = 42
    // (النصر's 12 + المسد's 30), 0 recited so far.
    check('(A) counter total excludes the 26 context words (68-26=42)', counter.total === '42', counter);
    check('(A) counter recited starts at 0', counter.count === '0', counter);

    // Residual audit A5 (word-level pointer path, unaffected by the chip
    // token-based fix -- see site/tests/test-residuals.js's (A5) block for
    // the pointer===0 fresh-load pages the fix itself targets): the pointer
    // just landed on النصر's own first word, so the chip must already show
    // النصر, never الكافرون (the printed-context surah before it).
    let chipText = await page.evaluate(function () { return document.getElementById('pageChip').textContent; });
    check('(A) chip shows النصر right after the surah-start jump lands on its first word',
      chipText.indexOf('النصر') !== -1 && chipText.indexOf('الكافرون') === -1, chipText);

    // ---- typed-fallback recite النصر's opening ----
    await typeRecite(page, 'اذا جاء نصر الله والفتح');
    st = await readState(page);
    entry = st.progressByPage['603'];
    check('(A) typed recitation reveals 26-30 from the pointer',
      [26, 27, 28, 29, 30].every(function (i) { return entry.revealed.indexOf(i) !== -1; }), entry);
    check('(A) typed recitation never touches 0-25 (still context, not revealed)',
      ctxExpected.every(function (i) { return entry.revealed.indexOf(i) === -1; }), entry);
    check('(A) pointer advances to 31', entry.pointer === 31, entry);
    counter = await readCounter(page);
    check('(A) counter recited is 5 after the opening (12 words of النصر total)', counter.count === '5', counter);

    // ---- reload mid-way: context + progress must restore ----
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(function () {
      var t = document.getElementById('total');
      return t && t.textContent && t.textContent.length > 0;
    }, { timeout: 10000 });
    counter = await readCounter(page);
    check('(A) after reload, counter total still excludes context (42)', counter.total === '42', counter);
    check('(A) after reload, counter recited still 5', counter.count === '5', counter);
    st = await readState(page);
    entry = st.progressByPage['603'];
    check('(A) after reload, contextRevealed restored (26 entries)', entry && entry.contextRevealed.length === 26, entry);
    check('(A) after reload, pointer restored to 31', entry && entry.pointer === 31, entry);

    // ---- finish the rest of the page: النصر's remaining ayat, then, as a
    // SEPARATE result (the bb0684d surah-boundary gate, req. 5, still
    // applies here -- one result may only ever advance within the surah it
    // started in), all of المسد.
    await typeRecite(page, 'ورايت الناس يدخلون في دين الله افواجا فسبح بحمد ربك واستغفره انه كان توابا');
    let midEntry = (await readState(page)).progressByPage['603'];
    check('(A) surah-boundary gate still holds: parks at 45 (المسد\'s تبت), not past it',
      midEntry.pointer === 45, midEntry);
    await typeRecite(page,
      'تبت يدا ابي لهب وتب ما اغني عنه ماله وما كسب سيصلي نارا ذات لهب ' +
      'وامراته حماله الحطب في جيدها حبل من مسد');

    // celebrateNewlyCompletedSurahs()/renderCertList() are async now (they
    // verify word-level completion for any page with a context jump) --
    // give the fetch+Promise chain a moment to settle.
    await page.waitForFunction(function () {
      var raw = localStorage.getItem('tasme3_v1');
      if (!raw) return false;
      var e = JSON.parse(raw).progressByPage['603'];
      return e && e.completedAt;
    }, { timeout: 10000 });
    await page.waitForTimeout(300);

    st = await readState(page);
    entry = st.progressByPage['603'];
    check('(A) page 603 completedAt set (page genuinely finished)', !!entry.completedAt, entry);
    check('(A) الكافرون words (0-25) still absent from the genuine revealed set',
      ctxExpected.every(function (i) { return entry.revealed.indexOf(i) === -1; }), entry.revealed);
    check('(A) all of النصر+المسد (26-67) are genuinely revealed',
      Array.from({ length: 42 }, function (_, i) { return i + 26; }).every(function (i) { return entry.revealed.indexOf(i) !== -1; }),
      entry.revealed);

    const celebrateShown = await page.evaluate(function () { return document.getElementById('surahCelebrate').hidden === false; });
    check('(A) a celebration did show (for a real completion)', celebrateShown === true);
    // viewCertBtn's onclick -> openCertificateFor() is async (templates +
    // basmala + font all fetched/loaded before the modal is shown).
    await page.evaluate(function () { document.getElementById('viewCertBtn').click(); });
    await page.waitForFunction(function () { return document.getElementById('certModal').hidden === false; }, { timeout: 10000 });
    const celebrateSurah = await page.evaluate(function () { return document.getElementById('certModal').hidden === false; });
    check('(A) clicking the celebration opens a certificate modal', celebrateSurah === true);

    const certList = await page.evaluate(function () {
      return Array.from(document.querySelectorAll('#certList .cert-name')).map(function (n) { return n.textContent; });
    });
    check('(A) شهاداتي list does NOT include الكافرون', certList.indexOf('الكافرون') === -1, certList);
    check('(A) شهاداتي list DOES include النصر (genuinely completed)', certList.indexOf('النصر') !== -1, certList);

    await context.close();
  }

  // ---- Scenario B: surah starting exactly at a page's top needs no context ----
  // (both الإخلاص/604 and الملك/562 start their page at word index 0, so
  // applySurahStartJump() never fires -- the page loads exactly like a
  // plain top-of-page visit, and no progressByPage entry is created until
  // something is actually recited, same as any other never-visited page.)
  {
    const { context, page } = await freshPage(browser, consoleErrors);
    await pickSurahFromDrawer(page, 'الإخلاص', 604);
    let st = await readState(page);
    let entry = st.progressByPage['604'];
    check('(B) الإخلاص on page 604: no context entry fabricated', !entry || !entry.contextRevealed || entry.contextRevealed.length === 0, entry);
    let counter = await readCounter(page);
    check('(B) counter total is the plain page total (58), nothing excluded', counter.total === '58', counter);
    check('(B) counter recited starts at 0', counter.count === '0', counter);
    // Sanity: reciting from the very top (قل هو الله احد) genuinely reveals
    // word 0 -- confirms the pointer really is at 0, not merely un-jumped.
    await typeRecite(page, 'قل هو الله احد');
    st = await readState(page);
    entry = st.progressByPage['604'];
    check('(B) reciting from the top reveals word 0', entry && entry.revealed.indexOf(0) !== -1, entry);
    await context.close();
  }
  {
    const { context, page } = await freshPage(browser, consoleErrors);
    await pickSurahFromDrawer(page, 'الملك', 562);
    let st = await readState(page);
    let entry = st.progressByPage['562'];
    check('(C) الملك on page 562 (starts the page): no context entry fabricated', !entry || !entry.contextRevealed || entry.contextRevealed.length === 0, entry);
    let counter = await readCounter(page);
    check('(C) counter total is the plain page total (131), nothing excluded', counter.total === '131', counter);
    await typeRecite(page, 'تبرك الذي بيده الملك');
    st = await readState(page);
    entry = st.progressByPage['562'];
    check('(C) reciting from the top reveals word 0', entry && entry.revealed.indexOf(0) !== -1, entry);
    await context.close();
  }

  // ---- Scenario D: same jump, English UI ----
  {
    const { context, page } = await freshPage(browser, consoleErrors);
    // See Scenario A's comment: the drawer must be open for #langSelect to
    // be interactable now that a closed drawer is genuinely hidden, and
    // closed again (Escape) before pickSurahFromDrawer reopens it fresh.
    await page.click('#menuBtn');
    await page.selectOption('#langSelect', 'en');
    await page.waitForTimeout(200);
    await page.keyboard.press('Escape');
    // Wait on the actual post-close state (drawer closed, background no
    // longer inert) rather than a fixed delay -- the close transition plus
    // the a11y inert/visibility reconciliation should be done well within
    // one second, but a bare timeout close to that margin is exactly the
    // kind of thing that flakes under load.
    await page.waitForFunction(function () {
      return !document.getElementById('drawer').classList.contains('open') &&
        !document.querySelector('.frame').hasAttribute('inert');
    }, { timeout: 5000 });
    await pickSurahFromDrawer(page, 'النصر', 603);
    const st = await readState(page);
    const entry = st.progressByPage['603'];
    check('(D, en) pointer parked at 26 regardless of UI language', entry && entry.pointer === 26, entry);
    check('(D, en) contextRevealed has 26 entries regardless of UI language', entry && entry.contextRevealed.length === 26, entry);
    const counter = await readCounter(page);
    check('(D, en) counter renders Latin digits (42 total)', counter.total === '42', counter);
    await context.close();
  }

  // ---- zero unexpected console errors across all of the above ----
  check('(E) zero unexpected console errors', consoleErrors.length === 0, consoleErrors);

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('FATAL', e); process.exit(1); });
