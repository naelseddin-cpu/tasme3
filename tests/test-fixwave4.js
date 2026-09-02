// Playwright regression tests for the F1/F3/F4/F5 fixes (third verification
// pass, 10-auditor re-audit). Same harness conventions as
// site/tests/test-residuals.js: drives the REAL site/ app.js against a
// headless browser, reads back the DOM/localStorage directly.
const { chromium } = require('playwright-core');

const SITE_URL = process.env.SITE_URL || 'http://127.0.0.1:8842';
const EXEC = '/opt/pw-browsers/chromium';

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('PASS:', name); }
  else { fail++; console.log('FAIL:', name, extra !== undefined ? JSON.stringify(extra) : ''); }
}

function isExpectedNoise(url) {
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

(async function main() {
  const browser = await chromium.launch({ executablePath: EXEC, headless: true });
  const consoleErrors = [];

  // ==================================================================
  // F1: certificate localized text must never render Urdu/Farsi/Pashto
  // (or any non-Arabic-UI) strings in UthmanicHafs (a Quranic-text-only
  // font) -- only Arabic-language, basic-Arabic-charset strings (and the
  // basmala / app name, unconditionally) get UthmanicHafs.
  // ==================================================================
  {
    const { context, page } = await freshPage(browser, consoleErrors);

    // Fetch each language's cert.title straight from the built catalogs
    // (site/i18n/*.json, produced by site/build-assets.mjs from
    // app/i18n/*.json) -- exercising the real shipped strings, not
    // hand-typed stand-ins.
    const titles = await page.evaluate(async function () {
      const langs = ['ar', 'ur', 'fa', 'ps', 'de', 'zh'];
      const out = {};
      for (const l of langs) {
        const r = await fetch('i18n/' + l + '.json');
        const d = await r.json();
        out[l] = d['cert.title'];
      }
      return out;
    });
    check('(F1) fetched cert.title for all 6 languages', Object.keys(titles).length === 6, titles);

    const basmala = await page.evaluate(function () {
      return fetch('basmala.json').then(function (r) { return r.json(); }).then(function (d) { return d.text; });
    });

    // Monkeypatch fillText globally (renderCertificate() creates its OWN
    // internal <canvas>, so this is the only way to observe the font string
    // actually in effect at the moment each line is drawn) -- record every
    // (text, font) pair, then call the REAL renderCertificate() for each
    // language and inspect what font it used for the title/basmala/app-name
    // lines.
    const results = await page.evaluate(async function (data) {
      var titles = data.titles, basmala = data.basmala;
      var calls = [];
      var proto = CanvasRenderingContext2D.prototype;
      var orig = proto.fillText;
      proto.fillText = function (text) {
        calls.push({ text: text, font: this.font });
        return orig.apply(this, arguments);
      };

      var out = {};
      var langs = ['ar', 'ur', 'fa', 'ps', 'de', 'zh'];
      for (const lang of langs) {
        calls.length = 0;
        var dir = (lang === 'ar' || lang === 'ur' || lang === 'fa' || lang === 'ps') ? 'rtl' : 'ltr';
        await window.Tasme3Certificate.renderCertificate({
          name: null,
          surahName: 'الفاتحة',
          titleText: titles[lang],
          congratsText: 'congrats text ' + lang,
          completedSurahText: 'completed ' + lang + ' الفاتحة',
          dateStr: '2026',
          dir: dir,
          lang: lang,
          template: null,
          appLink: 'https://example.test/'
        });
        var titleCall = calls.find(function (c) { return c.text === titles[lang]; });
        var basmalaCall = calls.find(function (c) { return c.text === basmala; });
        var appNameCall = calls.find(function (c) { return c.text === 'تَسْمِيع'; });
        out[lang] = {
          titleFont: titleCall ? titleCall.font : null,
          basmalaFont: basmalaCall ? basmalaCall.font : null,
          appNameFont: appNameCall ? appNameCall.font : null
        };
      }
      proto.fillText = orig;
      return out;
    }, { titles, basmala });

    check('(F1) ar title font uses UthmanicHafs',
      results.ar.titleFont && results.ar.titleFont.indexOf('UthmanicHafs') !== -1, results.ar);
    ['ur', 'fa', 'ps', 'de', 'zh'].forEach(function (lang) {
      check('(F1) ' + lang + ' title font does NOT use UthmanicHafs',
        results[lang].titleFont && results[lang].titleFont.indexOf('UthmanicHafs') === -1, results[lang]);
    });
    // basmala + app name always UthmanicHafs regardless of UI language.
    ['ar', 'ur', 'fa', 'ps', 'de', 'zh'].forEach(function (lang) {
      check('(F1) ' + lang + ' basmala stays in UthmanicHafs',
        results[lang].basmalaFont && results[lang].basmalaFont.indexOf('UthmanicHafs') !== -1, results[lang]);
      check('(F1) ' + lang + ' app name (تَسْمِيع) stays in UthmanicHafs',
        results[lang].appNameFont && results[lang].appNameFont.indexOf('UthmanicHafs') !== -1, results[lang]);
    });

    // measureText width proof: for ur/fa/ps, the title measured under the
    // OLD (forced-UthmanicHafs) stack must differ from the width measured
    // under the font the fix actually applies -- UthmanicHafs maps these
    // languages' extra letters (ٹ ڈ ڑ ں ہ ۃ پ etc.) to a blank placeholder
    // glyph (borrowed from an invisible formatting character), so the
    // measured advance width is materially different from a font that
    // draws them as real letterforms.
    const widths = await page.evaluate(function (data) {
      var titles = data.titles;
      var c = document.createElement('canvas');
      var ctx = c.getContext('2d');
      var out = {};
      ['ur', 'fa', 'ps'].forEach(function (lang) {
        ctx.font = '700 40px "UthmanicHafs", serif';
        var oldWidth = ctx.measureText(titles[lang]).width;
        ctx.font = '700 40px system-ui, "Segoe UI", "Noto Naskh Arabic", "Noto Sans Arabic", "Noto Nastaliq Urdu", "DejaVu Sans", sans-serif';
        var newWidth = ctx.measureText(titles[lang]).width;
        out[lang] = { oldWidth: oldWidth, newWidth: newWidth };
      });
      return out;
    }, { titles });
    ['ur', 'fa', 'ps'].forEach(function (lang) {
      check('(F1) ' + lang + ' measureText width differs between UthmanicHafs and the new stack',
        widths[lang].oldWidth !== widths[lang].newWidth, widths[lang]);
    });

    await context.close();
  }

  // ==================================================================
  // F3: `t` must never be null/throw before i18n catalogs resolve.
  // ==================================================================
  {
    // (a) tap "microphone not working?" at 0ms delay, 5 fresh contexts.
    for (let i = 0; i < 5; i++) {
      const errs = [];
      const context = await browser.newContext();
      const page = await context.newPage();
      page.on('pageerror', function (err) { errs.push('pageerror: ' + err.message); });
      page.on('console', function (msg) {
        if (msg.type() !== 'error') return;
        var loc = msg.location() || {};
        if (isExpectedNoise(loc.url)) return;
        errs.push(msg.text() + ' @ ' + (loc.url || ''));
      });
      await page.goto(SITE_URL + '/index.html?page=8', { waitUntil: 'domcontentloaded' });
      // No wait at all -- click #micHelpLink as early as the DOM allows,
      // exactly the race the audit named (before Tasme3I18n.setLanguage()
      // has any chance to resolve).
      await page.evaluate(function () {
        var el = document.getElementById('micHelpLink');
        if (el) el.click();
      });
      await page.waitForTimeout(300);
      check('(F3) micHelpLink at 0ms, run ' + (i + 1) + '/5: zero pageerror', errs.length === 0, errs);
      await context.close();
    }

    // (b) reload and type a word immediately (0ms) -- applyMatches() ->
    // renderProgressPanel() calls t() on the very first typed keystroke.
    const errs2 = [];
    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    page2.on('pageerror', function (err) { errs2.push('pageerror: ' + err.message); });
    page2.on('console', function (msg) {
      if (msg.type() !== 'error') return;
      var loc = msg.location() || {};
      if (isExpectedNoise(loc.url)) return;
      errs2.push(msg.text() + ' @ ' + (loc.url || ''));
    });
    await page2.goto(SITE_URL + '/index.html?page=8', { waitUntil: 'domcontentloaded' });
    await page2.evaluate(function () {
      var el = document.getElementById('micHelpLink');
      if (el) el.click();
      var inp = document.getElementById('typeInput');
      if (inp) { inp.value = 'قل'; inp.dispatchEvent(new Event('input', { bubbles: true })); }
    });
    await page2.waitForTimeout(300);
    check('(F3) typing a word at 0ms after reload: zero pageerror', errs2.length === 0, errs2);
    await context2.close();
  }

  // ==================================================================
  // F4: first-run hint's arrow must stay centered on #recBtn, before and
  // after a rotation, at a narrow (390px) viewport in both ar and en.
  // ==================================================================
  for (const locale of [{ lang: 'ar', qs: '' }, { lang: 'en', qs: '' }]) {
    const { context, page } = await freshPage(browser, consoleErrors, {
      contextOptions: { viewport: { width: 390, height: 844 } }
    });
    if (locale.lang === 'en') {
      await page.click('#menuBtn');
      await page.selectOption('#langSelect', 'en');
      await page.waitForTimeout(150);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(150);
    }
    // Force the hint to show right now regardless of localStorage state or
    // its own gating, by calling the exact same functions app.js's init
    // path would have called -- avoids depending on a real fresh-install
    // localStorage state that a previous test in this same browser profile
    // may have already consumed. positionFirstRunHint/maybeShowFirstRunHint
    // aren't exported, so drive it the same way a genuine first run does:
    // clear the flag and reload.
    await page.evaluate(function () { try { localStorage.removeItem('tasme3FirstRunHintShown'); } catch (_) {} });
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(function () {
      var t = document.getElementById('total');
      return t && t.textContent && t.textContent.length > 0;
    }, { timeout: 10000 });
    await page.waitForFunction(function () {
      var h = document.getElementById('firstRunHint');
      return h && !h.hidden;
    }, { timeout: 5000 }).catch(function () {});

    function measure() {
      return page.evaluate(function () {
        var mic = document.getElementById('recBtn').getBoundingClientRect();
        var arrow = document.querySelector('.first-run-hint-arrow').getBoundingClientRect();
        return {
          micCenter: mic.left + mic.width / 2,
          arrowCenter: arrow.left + arrow.width / 2
        };
      });
    }

    const before = await measure();
    check('(F4) ' + locale.lang + ' arrow centered on mic before rotation (<=4px)',
      Math.abs(before.arrowCenter - before.micCenter) <= 4, before);

    // Rotate: 390x844 -> 844x390.
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(500); // clear the 250ms debounced resize handler (site/app.js's B4 fix)
    const after = await measure();
    check('(F4) ' + locale.lang + ' arrow centered on mic after rotation (<=4px)',
      Math.abs(after.arrowCenter - after.micCenter) <= 4, after);

    await context.close();
  }

  // ==================================================================
  // F5: elderly residuals -- font floors, touch targets.
  // ==================================================================
  for (const locale of ['ar', 'de']) {
    const { context, page } = await freshPage(browser, consoleErrors, {
      contextOptions: { viewport: { width: 390, height: 844 } }
    });
    if (locale === 'de') {
      await page.click('#menuBtn');
      await page.selectOption('#langSelect', 'de');
      await page.waitForTimeout(150);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(150);
    }
    await page.click('#setupBtn');
    await page.waitForFunction(function () { return document.getElementById('setupSheet').classList.contains('open'); }, { timeout: 5000 });

    const sizes = await page.evaluate(function () {
      function px(el) { return el ? parseFloat(getComputedStyle(el).fontSize) : null; }
      var h3 = document.querySelector('.sheet-section h3');
      var panelrow = document.querySelector('.panelrow');
      var chip = document.getElementById('pageChip');
      var tab = document.querySelector('.drawer-tabs button');
      return { h3: px(h3), panelrow: px(panelrow), chip: px(chip), tab: px(tab) };
    });
    check('(F5) ' + locale + ' .sheet-section h3 font-size >= 14px', sizes.h3 >= 14, sizes);
    check('(F5) ' + locale + ' .panelrow font-size >= 14px', sizes.panelrow >= 14, sizes);
    check('(F5) ' + locale + ' #pageChip font-size >= 14px', sizes.chip >= 14, sizes);
    check('(F5) ' + locale + ' .drawer-tabs button font-size >= 14px', sizes.tab >= 14, sizes);

    // No horizontal overflow at 390px width.
    const overflowX = await page.evaluate(function () {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
    });
    check('(F5) ' + locale + ' no horizontal overflow at 390px', overflowX === false, overflowX);

    await page.click('#setupClose');
    await page.waitForFunction(function () { return !document.getElementById('setupSheet').classList.contains('open'); }, { timeout: 5000 });

    // Language <select> min-height >= 44px (open the drawer to reach it).
    await page.click('#menuBtn');
    await page.waitForFunction(function () { return document.getElementById('drawer').classList.contains('open'); }, { timeout: 5000 });
    const langSelectH = await page.evaluate(function () {
      return document.getElementById('langSelect').getBoundingClientRect().height;
    });
    check('(F5) ' + locale + ' #langSelect height >= 44px', langSelectH >= 44, langSelectH);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);

    // #chromeHandle: visual size unchanged (64x14), invisible hit area
    // (::before) at least 44px tall. It's only rendered (display != none)
    // once the top bar has auto-hidden (body.chrome-visible removed) --
    // force that state directly rather than waiting out the real 4s
    // auto-hide timer.
    await page.evaluate(function () { document.body.classList.remove('chrome-visible'); });
    const handleGeom = await page.evaluate(function () {
      var el = document.getElementById('chromeHandle');
      var rect = el.getBoundingClientRect();
      var before = getComputedStyle(el, '::before');
      return {
        visualWidth: rect.width, visualHeight: rect.height,
        beforeContent: before.content, beforePosition: before.position,
        beforeHeight: parseFloat(before.height), beforeTop: before.top, beforeBottom: before.bottom
      };
    });
    check('(F5) ' + locale + ' #chromeHandle visual size unchanged (64x14)',
      Math.round(handleGeom.visualWidth) === 64 && Math.round(handleGeom.visualHeight) === 14, handleGeom);
    check('(F5) ' + locale + ' #chromeHandle ::before is an absolutely-positioned overlay',
      handleGeom.beforeContent !== 'none' && handleGeom.beforePosition === 'absolute', handleGeom);
    check('(F5) ' + locale + ' #chromeHandle invisible hit area is >= 44px tall',
      handleGeom.beforeHeight >= 44, handleGeom);

    await context.close();
  }

  // ---- zero unexpected console errors across all of the above ----
  check('(Z) zero unexpected console errors', consoleErrors.length === 0, consoleErrors);

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('FATAL', e); process.exit(1); });
