#!/usr/bin/env node
// Generalized print-exact page renderer for all 604 mushaf pages (WP-E).
//
// Renders each page/mushaf/pages/page-NNN.json against its per-page
// QCF_PNNN.woff2 glyph font (+ UthmanicHafs for sura-header bands and
// basmala lines) using headless Chromium, exactly reproducing the layout
// logic proven by the original 11-page pilot (tools/render_page_images.mjs)
// but generalized to: read everything from local disk (no localhost
// server), any page range, any line count per page, and emit a webp image
// + a compact fractional-coordinate boxes JSON per page instead of one
// shared boxes.json for all pages.
//
// Usage:
//   node tools/render_pages.mjs --pages 1-604 --out site/pages
//   node tools/render_pages.mjs --pages 1,2,596-604 --quality 78 --width 1080
//
// Deterministic: identical inputs (page JSON + fonts + this script) always
// produce byte-identical output, given the same pinned Chromium build.

import { chromium } from 'playwright-core';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PAGES_DIR = path.join(ROOT, 'app/mushaf/pages');
const FONTS_DIR = path.join(ROOT, 'app/mushaf/fonts');
const CHROMIUM_PATH =
  process.env.PW_CHROMIUM_PATH ||
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const BASMALA = 'بِسۡمِ ٱللَّهِ ٱلرَّحۡمَٰنِ ٱلرَّحِيمِ';
const PAPER = '#fffdf5';

// ---------------------------------------------------------------- CLI ----

function parsePageSpec(spec) {
  const pages = new Set();
  for (let part of spec.split(',')) {
    part = part.trim();
    if (!part) continue;
    if (part.includes('-')) {
      const [a, b] = part.split('-').map((x) => parseInt(x, 10));
      for (let p = a; p <= b; p++) pages.add(p);
    } else {
      pages.add(parseInt(part, 10));
    }
  }
  return [...pages].sort((a, b) => a - b);
}

function parseArgs(argv) {
  const out = {
    pages: null,
    out: 'site/pages',
    width: 1080, // final webp width (px)
    quality: 82, // webp quality, tuned so typical page <= ~200KB
    concurrency: 1,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--pages') out.pages = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--width') out.width = parseInt(argv[++i], 10);
    else if (a === '--quality') out.quality = parseInt(argv[++i], 10);
    else throw new Error(`unknown arg: ${a}`);
  }
  if (!out.pages) throw new Error('--pages is required, e.g. --pages 1-604');
  return out;
}

// ------------------------------------------------------------- layout ----
// Same DOM structure & auto-fit strategy as the pilot (render_page_images.mjs):
//  - #sheet holds one <div> per visual line (from page JSON's `lines` array)
//  - word/marker spans carry data-n/k/e so boxes can be extracted post-layout
//  - sura-header + basmala lines render in UthmanicHafs inside styled bands
//  - font size is fit so the widest line's natural width matches the sheet's
//    available width, then re-fit once document.fonts confirms the page's
//    glyph font is actually loaded (avoids measuring fallback-font metrics),
//    then a per-line safety loop shrinks any line that still overflows.

const SHEET_CSS_WIDTH = 1000;
const VIEWPORT_CSS_WIDTH = 1100;

function buildHtml(uthmanicB64, pageFontB64) {
  return `<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8"><style>
@font-face { font-family:'UthmanicHafs'; src:url(data:font/woff2;base64,${uthmanicB64}) format('woff2'); }
@font-face { font-family:'QCFPage'; src:url(data:font/woff2;base64,${pageFontB64}) format('woff2'); }
html,body { margin:0; padding:0; background:${PAPER}; }
#sheet { width:${SHEET_CSS_WIDTH}px; background:${PAPER}; padding:16px 10px; direction:rtl; }
.mline { display:block; text-align:center; direction:rtl; white-space:nowrap; line-height:1.9; }
.mword,.mmark { display:inline-block; padding:0 2px; color:#2a2a20; }
.sura-band { border:2px solid #b8a24a; border-radius:10px; text-align:center;
  font-family:'UthmanicHafs',serif; color:#1a5c38; background:rgba(184,162,74,.10);
  margin:5px 14px; padding:1px 0; font-size:40px; }
.basmala-line { text-align:center; font-family:'UthmanicHafs',serif; font-size:42px; color:#2a2a20; }
</style></head><body><div id="sheet"></div></body></html>`;
}

async function renderPage(page, pageNum, pageData, pageFontB64, uthmanicB64) {
  const html = buildHtml(uthmanicB64, pageFontB64);
  await page.setContent(html, { waitUntil: 'load' });

  await page.evaluate(
    ({ data, basmala }) => {
      const sheet = document.getElementById('sheet');
      for (const line of data.lines) {
        if (line.t === 's') {
          const d = document.createElement('div');
          d.className = 'sura-band';
          d.textContent = 'سُورَةُ ' + line.name;
          sheet.appendChild(d);
        } else if (line.t === 'b') {
          const d = document.createElement('div');
          d.className = 'basmala-line';
          d.textContent = basmala;
          sheet.appendChild(d);
        } else {
          const d = document.createElement('div');
          d.className = 'mline';
          d.style.fontFamily = `'QCFPage'`;
          for (const tk of line.tk) {
            const s = document.createElement('span');
            s.textContent = tk.g;
            s.className = tk.e ? 'mmark' : 'mword';
            s.dataset.n = tk.n || '';
            s.dataset.k = tk.k;
            s.dataset.e = tk.e ? '1' : '0';
            if (tk.a) s.dataset.a = tk.a;
            d.appendChild(s);
          }
          sheet.appendChild(d);
        }
      }
      // initial fit pass (fallback-font metrics; refined once fonts.ready)
      const lines = [...sheet.querySelectorAll('.mline')];
      lines.forEach((l) => {
        l.style.fontSize = '48px';
        l.style.width = 'max-content';
        l.style.margin = '0 auto';
      });
      const avail = sheet.clientWidth - 20;
      let maxW = 0;
      lines.forEach((l) => {
        maxW = Math.max(maxW, l.offsetWidth);
      });
      const size = Math.min(82, (48 * avail) / (maxW || 1));
      lines.forEach((l) => {
        l.style.fontSize = size + 'px';
      });
    },
    { data: pageData, basmala: BASMALA }
  );

  // Wait for the page's own glyph font to actually be loaded before
  // trusting any width measurement (fallback-font widths are wrong).
  const loaded = await page.evaluate(async () => {
    const probeEl = document.querySelector('.mword') || document.querySelector('.mmark');
    const probe = probeEl ? probeEl.textContent : 'x';
    try {
      await document.fonts.load(`40px 'QCFPage'`, probe);
    } catch (e) {
      return 'load-err:' + e.message;
    }
    await document.fonts.ready;
    return document.fonts.check(`40px 'QCFPage'`, probe);
  });

  await page.evaluate(() => {
    const sheet = document.getElementById('sheet');
    const lines = [...sheet.querySelectorAll('.mline')];
    lines.forEach((l) => {
      l.style.fontSize = '48px';
      l.style.width = 'max-content';
      l.style.margin = '0 auto';
    });
    const avail = sheet.clientWidth - 20;
    let maxW = 0;
    lines.forEach((l) => {
      maxW = Math.max(maxW, l.offsetWidth);
    });
    const size = Math.min(82, (48 * avail) / (maxW || 1));
    lines.forEach((l) => {
      l.style.fontSize = size + 'px';
    });
    // hard per-line overflow safety: shrink any line that still overflows
    lines.forEach((l) => {
      let fs = size;
      while (l.offsetWidth > avail && fs > 14) {
        fs -= 1;
        l.style.fontSize = fs + 'px';
      }
    });
  });

  const sheetLoc = page.locator('#sheet');
  const sheetBox = await sheetLoc.boundingBox();
  const pngBuf = await sheetLoc.screenshot();

  const tokens = await page.evaluate((sb) => {
    const out = [];
    document.querySelectorAll('.mword,.mmark').forEach((el) => {
      const r = el.getBoundingClientRect();
      const tok = {
        x: (r.x - sb.x) / sb.w,
        y: (r.y - sb.y) / sb.h,
        w: r.width / sb.w,
        h: r.height / sb.h,
        n: el.dataset.n || '',
        k: el.dataset.k,
        e: el.dataset.e === '1' ? 1 : 0,
      };
      if (el.dataset.a) tok.a = el.dataset.a;
      out.push(tok);
    });
    return out;
  }, { x: sheetBox.x, y: sheetBox.y, w: sheetBox.width, h: sheetBox.height });

  return { pngBuf, ratio: sheetBox.height / sheetBox.width, tokens, fontLoaded: loaded };
}

// -------------------------------------------------------------- main ----

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const pageNums = parsePageSpec(args.pages);
  const outDir = path.resolve(ROOT, args.out);
  fs.mkdirSync(outDir, { recursive: true });

  const uthmanicB64 = fs
    .readFileSync(path.join(FONTS_DIR, 'UthmanicHafs.woff2'))
    .toString('base64');

  const browser = await chromium.launch({ executablePath: CHROMIUM_PATH });
  const page = await browser.newPage({
    viewport: { width: VIEWPORT_CSS_WIDTH, height: 2200 },
    deviceScaleFactor: 2,
  });

  const results = [];
  for (const p of pageNums) {
    const nnn = String(p).padStart(3, '0');
    const jsonPath = path.join(PAGES_DIR, `page-${nnn}.json`);
    const fontPath = path.join(FONTS_DIR, `QCF_P${nnn}.woff2`);
    if (!fs.existsSync(jsonPath)) {
      console.error(`SKIP page ${nnn}: missing ${jsonPath}`);
      results.push({ page: p, ok: false, error: 'missing page json' });
      continue;
    }
    if (!fs.existsSync(fontPath)) {
      console.error(`SKIP page ${nnn}: missing ${fontPath}`);
      results.push({ page: p, ok: false, error: 'missing font' });
      continue;
    }
    const pageData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const pageFontB64 = fs.readFileSync(fontPath).toString('base64');

    try {
      const { pngBuf, ratio, tokens, fontLoaded } = await renderPage(
        page,
        p,
        pageData,
        pageFontB64,
        uthmanicB64
      );
      if (fontLoaded !== true) {
        console.error(`WARN page ${nnn}: font check returned`, fontLoaded);
      }

      const meta = await sharp(pngBuf).metadata();
      const targetWidth = Math.min(args.width, meta.width);
      const webpBuf = await sharp(pngBuf)
        .resize({ width: targetWidth })
        .webp({ quality: args.quality })
        .toBuffer();

      const webpPath = path.join(outDir, `page-${nnn}.webp`);
      const jsonOutPath = path.join(outDir, `page-${nnn}.json`);
      fs.writeFileSync(webpPath, webpBuf);
      fs.writeFileSync(
        jsonOutPath,
        JSON.stringify({ ratio, veil: PAPER, tokens })
      );

      results.push({
        page: p,
        ok: true,
        webpBytes: webpBuf.length,
        tokenCount: tokens.length,
      });
      console.log(
        `page ${nnn}: OK webp=${(webpBuf.length / 1024).toFixed(1)}KB tokens=${tokens.length}`
      );
    } catch (err) {
      console.error(`FAIL page ${nnn}:`, err.message);
      results.push({ page: p, ok: false, error: err.message });
    }
  }

  await browser.close();

  const failed = results.filter((r) => !r.ok);
  console.log(
    `\ndone: ${results.length - failed.length}/${results.length} pages OK` +
      (failed.length ? `, FAILED: ${failed.map((f) => f.page).join(',')}` : '')
  );
  if (failed.length) process.exitCode = 1;
}

main();
