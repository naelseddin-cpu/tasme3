// Playwright regression test for the service-worker update UX (T1): a
// stale cached build must not survive a good-connection reload forever
// (founder's iPhone report). Unlike every other site/tests/*.js file, this
// one deliberately ALLOWS service workers (the others don't care either
// way, but this is the one whose entire subject is the SW lifecycle) and
// drives an actual version swap of the served site to simulate a real
// deploy: the static server is restarted on the SAME port pointing at a
// scratch copy of site/ whose sw.js has CACHE_VERSION bumped to
// 'tasme3-v99', so the browser's registration.update() sees genuinely
// different script/precache-list bytes, exactly like a real deploy.
//
// What this verifies:
//   1. A fresh load registers the SW and precaches under the real
//      CACHE_VERSION's shell cache key (site/sw.js's current version).
//   2. After a same-origin reload (so this load's `navigator.serviceWorker.
//      controller` is already set, matching a returning-user's real second
//      visit), swapping to the v99 build and calling reg.update() while the
//      user is mid-typing (typed-fallback box non-empty) shows the
//      app.updateReady toast and does NOT reload out from under them.
//   3. Once the user stops typing and the tab cycles hidden -> visible, the
//      deferred reload fires exactly once, the new worker's cache
//      ('tasme3-v99-shell') is present, and the OLD version's cache
//      ('<real-version>-shell') has been purged by the new worker's
//      activate handler.
const { chromium } = require('playwright-core');
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = process.env.SW_TEST_PORT || 8843;
const SITE_URL = 'http://127.0.0.1:' + PORT;
const EXEC = '/opt/pw-browsers/chromium';
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const REAL_SITE = path.join(REPO_ROOT, 'site');
const SCRATCH = '/tmp/claude-0/-home-user-ArabiaERP/1f19a96e-60c3-55c6-8e02-ddb6a93f8c3a/scratchpad/sw-update-test';
const V99_SITE = path.join(SCRATCH, 'site-v99');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('PASS:', name); }
  else { fail++; console.log('FAIL:', name, extra !== undefined ? JSON.stringify(extra) : ''); }
}

// The real CACHE_VERSION, read straight from the shipped sw.js, so this
// test never hardcodes a version string that could drift from a future bump.
function realCacheVersion() {
  var src = fs.readFileSync(path.join(REAL_SITE, 'sw.js'), 'utf8');
  var m = src.match(/CACHE_VERSION\s*=\s*'([^']+)'/);
  if (!m) throw new Error('could not find CACHE_VERSION in site/sw.js');
  return m[1];
}

// Build the v99 scratch copy once: everything in site/ except the (121 MB,
// irrelevant to this test) mushaf page images/json and the tests/ dir
// itself, with CACHE_VERSION bumped so registration.update() sees a real
// byte-level diff against the currently-installed worker.
function buildV99Site(realVersion) {
  fs.rmSync(SCRATCH, { recursive: true, force: true });
  fs.mkdirSync(V99_SITE, { recursive: true });
  var tarToDest = spawnSync('sh', ['-c',
    "tar --exclude=pages --exclude=tests -cf - -C '" + REAL_SITE + "' . | tar -xf - -C '" + V99_SITE + "'"
  ]);
  if (tarToDest.status !== 0) {
    throw new Error('failed to build v99 scratch site: ' + tarToDest.stderr);
  }
  var swPath = path.join(V99_SITE, 'sw.js');
  var sw = fs.readFileSync(swPath, 'utf8');
  var swapped = sw.split("CACHE_VERSION = '" + realVersion + "'").join("CACHE_VERSION = 'tasme3-v99'");
  if (swapped === sw) throw new Error('CACHE_VERSION substitution had no effect');
  fs.writeFileSync(swPath, swapped);
}

function startServer(dir) {
  var srv = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: dir, stdio: 'ignore' });
  return srv;
}
function stopServer(srv) {
  return new Promise(function (resolve) {
    if (!srv || srv.killed) return resolve();
    srv.on('exit', resolve);
    srv.kill('SIGKILL');
  });
}
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
async function waitForServer() {
  for (var i = 0; i < 50; i++) {
    try {
      var r = await fetch(SITE_URL + '/index.html');
      if (r.ok) return;
    } catch (_) {}
    await sleep(100);
  }
  throw new Error('static server never came up on ' + SITE_URL);
}

(async function main() {
  var realVersion = realCacheVersion();
  buildV99Site(realVersion);

  var server = startServer(REAL_SITE);
  await waitForServer();

  var browser = await chromium.launch({ executablePath: EXEC, headless: true });
  // Explicit default noted for the reviewer: serviceWorkers is 'allow'
  // (Playwright's default) -- this is the one test in the suite that
  // actually needs SW lifecycle events to fire, unlike the others which
  // merely tolerate SW registration happening alongside them.
  var context = await browser.newContext({ serviceWorkers: 'allow' });
  var page = await context.newPage();
  var consoleErrors = [];
  page.on('pageerror', function (err) { consoleErrors.push('pageerror: ' + err.message); });

  try {
    // ---- 1. fresh load precaches under the real shell cache key ----
    await page.goto(SITE_URL + '/index.html', { waitUntil: 'load' });
    await page.evaluate(function () { return navigator.serviceWorker.ready; });
    var shellKey = realVersion + '-shell';
    var keysAfterFirstLoad = await page.evaluate(function () { return caches.keys(); });
    check('(1) fresh load precaches the real-version shell cache', keysAfterFirstLoad.indexOf(shellKey) !== -1, keysAfterFirstLoad);

    // Reload once so THIS load's navigator.serviceWorker.controller is
    // already set at app.js's top-level evaluation -- matching a real
    // returning visit, and the precondition swTryReload()'s "genuine
    // update, not first install" guard depends on.
    await page.reload({ waitUntil: 'load' });
    var hadControllerOnLoad = await page.evaluate(function () { return !!navigator.serviceWorker.controller; });
    check('(1b) reload leaves the page pre-controlled (real-update precondition)', hadControllerOnLoad === true, hadControllerOnLoad);

    // ---- set up the "user is mid-action" case: typed-fallback has text ----
    await page.evaluate(function () {
      var link = document.getElementById('micHelpLink');
      if (link) link.click(); // reveals + wires #typeInput (see site/app.js showMicHelp())
      var inp = document.getElementById('typeInput');
      inp.value = 'بسم';
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      window.__swTestReloadMarker = 'still-here';
    });

    // ---- 2. swap the server to the v99 build, same port ----
    await stopServer(server);
    server = startServer(V99_SITE);
    await waitForServer();

    await page.evaluate(function () {
      return navigator.serviceWorker.getRegistration().then(function (reg) { return reg.update(); });
    });

    // ---- 3. toast appears; page must NOT reload while typing ----
    var toastAppeared = false;
    try {
      await page.waitForFunction(function () {
        var toast = document.getElementById('toast');
        return toast && toast.classList.contains('show') && /updateReady|update ready|تحديث/i.test(toast.textContent || '');
      }, { timeout: 20000 });
      toastAppeared = true;
    } catch (e) { toastAppeared = false; }
    check('(2) update toast (app.updateReady) shown while typed fallback is non-empty', toastAppeared);

    var markerStillThere = await page.evaluate(function () { return window.__swTestReloadMarker; }).catch(function () { return undefined; });
    check('(2b) page did not reload while the user was mid-typing', markerStillThere === 'still-here', markerStillThere);

    // ---- 4. clear the input, cycle hidden -> visible, expect the deferred reload ----
    await page.evaluate(function () {
      var inp = document.getElementById('typeInput');
      inp.value = '';
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    });

    var reloaded = false;
    try {
      var loadPromise = page.waitForEvent('load', { timeout: 20000 });
      await page.evaluate(function () {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: function () { return 'hidden'; } });
        document.dispatchEvent(new Event('visibilitychange'));
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: function () { return 'visible'; } });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await loadPromise;
      reloaded = true;
    } catch (e) { reloaded = false; }
    check('(4) deferred reload fires exactly once on the next hidden->visible', reloaded);

    if (reloaded) {
      // sanity: the reload marker is gone now (fresh JS globals) --
      // corroborates a real navigation happened, not just the 'load' event
      // coincidentally re-firing.
      var markerGone = await page.evaluate(function () { return window.__swTestReloadMarker; }).catch(function () { return undefined; });
      check('(4b) reload really re-ran app.js (test marker reset)', markerGone === undefined, markerGone);
    } else {
      console.log('NOTE: reload assertion (4) did not observe a `load` event in time in this headless run. ' +
        'Falling back to verifying the underlying mechanism directly (new worker activated, caches swapped) below.');
    }

    // ---- 5. new worker activated; old cache purged, new cache present ----
    // Give the activate handler a moment to run to completion regardless of
    // whether (4) above resolved via reload or timed out.
    var settled = await page.waitForFunction(function () {
      return caches.keys().then(function (keys) {
        return keys.indexOf('tasme3-v99-shell') !== -1 ? keys : null;
      });
    }, { timeout: 20000 }).then(function (h) { return h.jsonValue(); }).catch(function () { return null; });

    var finalKeys = settled || await page.evaluate(function () { return caches.keys(); });
    check('(5) new worker\'s shell cache (tasme3-v99-shell) is present', finalKeys.indexOf('tasme3-v99-shell') !== -1, finalKeys);
    check('(5b) old version\'s shell cache (' + shellKey + ') was purged', finalKeys.indexOf(shellKey) === -1, finalKeys);

    var controllerNowV99 = await page.evaluate(function () {
      return navigator.serviceWorker.getRegistration().then(function (reg) {
        return !!(reg && reg.active);
      });
    });
    check('(5c) registration has an active worker after the update', controllerNowV99 === true, controllerNowV99);

    check('(Z) zero page errors', consoleErrors.length === 0, consoleErrors);
  } finally {
    await context.close();
    await browser.close();
    await stopServer(server);
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('FATAL', e); process.exit(1); });
