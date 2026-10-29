// Pre-generate the explorer's standard "wisdom" answers, so pressing those buttons
// costs no AI time for visitors. Drives the real page on this PC (the owner gets the
// Claude CLI through server.py), with the same prompts, verse tools and rules, and
// saves each finished answer to explorer/wisdom/<hash>.json. Resumable: existing
// files are skipped. Needs playwright-core (any install) and server.py on :8000.
//
//   node pregen.js [subjects|roots|stories|surahs ...]     (default: all, in that order)
const path = require('path'), fs = require('fs');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const OUT = path.join(__dirname, 'explorer');
const ITEM_TIMEOUT = 8 * 60 * 1000;

(async () => {
  const want = process.argv.slice(2).length ? process.argv.slice(2) : ['subjects', 'roots', 'stories', 'surahs'];
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true });
  const p = await (await b.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ar' })).newPage();
  await p.goto('http://localhost:8000/#count', { waitUntil: 'networkidle' });
  await p.waitForFunction(() => typeof D !== 'undefined' && D.text.length > 6000 && typeof SAMPLE !== 'undefined' && SAMPLE, null, { timeout: 60000 });
  if (await p.evaluate(() => ENGINE) !== 'Claude') throw new Error('not running as owner (expected Claude engine)');
  const lists = await p.evaluate(() => ({
    subjects: SUBJECTS.map((x, i) => `(() => { const [t, def] = SUBJECTS[${i}]; const s = subjectCodes(def); showItem({ title: t, kind: 'موضوع', codes: s.codes, roots: s.roots, forms: s.forms }); })()`),
    roots: Object.keys(D.roots).filter(r => !STOP.has(r)).sort((a, b) => D.rootDf[b] - D.rootDf[a]).slice(0, 150).map(r => `openRoot(${JSON.stringify(r)})`),
    stories: Object.keys(NAMEKIND_OF).filter(n => D.lemmas[n] && D.lemmas[n].codes.length >= 2 && NAMEKIND_OF[n] !== 'idol').map(n => `openLemma(${JSON.stringify(n)}, 'story')`),
    surahs: D.surahs.map((_, i) => `showSurah(${i + 1})`),
  }));
  let done = 0, skipped = 0, failed = 0;
  for (const group of want) {
    for (const open of lists[group]) {
      await p.evaluate(open);
      const btn = await p.waitForSelector('#panel button.ask', { state: 'attached' });
      const key = await btn.getAttribute('data-key');
      const file = path.join(OUT, await p.evaluate(k => keyFile(k), key));
      if (fs.existsSync(file)) { skipped++; continue; }
      await p.evaluate(() => { const b = document.querySelector('#panel button.ask'); b.dataset.fresh = '1'; b.hidden = false; b.click(); });
      const t0 = Date.now();
      const res = await p.waitForFunction(() => {
        const o = document.querySelector('#panel .answer');
        if (o && o.dataset.answer) return { text: o.dataset.answer };
        const n = o && o.querySelector('.note'); if (n && !o.dataset.answer && /تعذّر|أُوقف|كثيرة|مشغول|أكبر/.test(n.textContent)) return { error: n.textContent };
        return null;
      }, null, { timeout: ITEM_TIMEOUT, polling: 2000 }).then(h => h.jsonValue()).catch(e => ({ error: 'timeout' }));
      if (res.text) {
        const h = res.text.search(/^#/m); if (h > 0) res.text = res.text.slice(h); // drop the "fetching verses…" preamble
        // the rules forbid typing verse text from memory: refuse anything that quotes a run of diacritized words
        if (/(?:[\u0621-\u064A]+[\u064B-\u0652\u0670]+[\u0621-\u0652\u0670]*\s+){4,}/.test(res.text)) res = { error: 'quotes verse-like text; not saved' };
      }
      if (res.text && res.text.length > 200) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify({ key, text: res.text, engine: 'Claude', generated: new Date().toISOString() }));
        done++;
        console.log(`[${group}] ok ${key} (${Math.round((Date.now() - t0) / 1000)}s)`);
      } else {
        failed++;
        console.log(`[${group}] FAIL ${key}: ${res.error || 'short answer'}`);
        if (/كثيرة|rate/i.test(res.error || '')) await new Promise(r => setTimeout(r, 10 * 60 * 1000)); // usage limit: wait
      }
      await p.evaluate(() => closePanel());
    }
  }
  console.log(`done ${done}, already saved ${skipped}, failed ${failed}`);
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
