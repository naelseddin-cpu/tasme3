import { chromium } from 'playwright-core';
import fs from 'fs';
const FD='/home/user/ArabiaERP/apps/quran-trainer/mushaf/fonts';
const b64=f=>fs.readFileSync(`${FD}/${f}`).toString('base64');

const PAGES = [1,2,596,597,598,599,600,601,602,603,604];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1100, height: 2000 }, deviceScaleFactor: 2 });

const html = `<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8"><style>
@font-face { font-family:'UthmanicHafs'; src:url(data:font/woff2;base64,${b64('UthmanicHafs.woff2')}) format('woff2'); }
body { margin:0; background:#fffdf5; }
#sheet { width:1000px; background:#fffdf5; padding:16px 10px; direction:rtl; }
.mline { display:block; text-align:center; direction:rtl; white-space:nowrap; line-height:1.9; }
.mword,.mmark { display:inline-block; padding:0 2px; color:#2a2a20; }
.sura-band { border:2px solid #b8a24a; border-radius:10px; text-align:center;
  font-family:'UthmanicHafs',serif; color:#1a5c38; background:rgba(184,162,74,.10);
  margin:5px 14px; padding:1px 0; font-size:40px; }
.basmala-line { text-align:center; font-family:'UthmanicHafs',serif; font-size:42px; color:#2a2a20; }
</style></head><body><div id="sheet"></div></body></html>`;

const out = {};
for (const p of PAGES) {
  const nnn = String(p).padStart(3,'0');
  await page.setContent(html, { waitUntil: 'load' });
  await page.addStyleTag({ content: `@font-face { font-family:'QP${nnn}'; src:url(data:font/woff2;base64,${b64('QCF_P'+nnn+'.woff2')}) format('woff2'); }` });
  const data = await (await fetch(`http://localhost:8903/mushaf/pages/page-${nnn}.json`)).json();
  await page.evaluate(({data, nnn}) => {
    const BASMALA = 'بِسۡمِ ٱللَّهِ ٱلرَّحۡمَٰنِ ٱلرَّحِيمِ';
    const sheet = document.getElementById('sheet');
    for (const line of data.lines) {
      if (line.t === 's') { const d=document.createElement('div'); d.className='sura-band'; d.textContent='سُورَةُ '+line.name; sheet.appendChild(d); }
      else if (line.t === 'b') { const d=document.createElement('div'); d.className='basmala-line'; d.textContent=BASMALA; sheet.appendChild(d); }
      else {
        const d=document.createElement('div'); d.className='mline'; d.style.fontFamily=`'QP${nnn}'`;
        for (const tk of line.tk) {
          const s=document.createElement('span');
          s.textContent=tk.g;
          s.className = tk.e ? 'mmark' : 'mword';
          s.dataset.n = tk.n || ''; s.dataset.k = tk.k; s.dataset.e = tk.e ? '1':'0';
          d.appendChild(s);
        }
        sheet.appendChild(d);
      }
    }
    // fit: uniform size so widest line fills
    const lines=[...sheet.querySelectorAll('.mline')];
    lines.forEach(l=>{ l.style.fontSize='48px'; l.style.width='max-content'; l.style.margin='0 auto'; });
    const avail=sheet.clientWidth-20;
    let maxW=0; lines.forEach(l=>{ maxW=Math.max(maxW,l.offsetWidth); });
    const size=Math.min(82, 48*avail/maxW);
    lines.forEach(l=>{ l.style.fontSize=size+'px'; });

  }, {data, nnn});
  const loaded = await page.evaluate(async ({nnn}) => {
    const probe = document.querySelector('.mword') ? document.querySelector('.mword').textContent : 'x';
    try { await document.fonts.load(`40px 'QP${nnn}'`, probe); } catch(e) { return 'load-err:'+e.message; }
    await document.fonts.ready;
    return document.fonts.check(`40px 'QP${nnn}'`, probe);
  }, {nnn});
  console.log('page font loaded:', loaded);
  await page.evaluate(() => {
    const sheet = document.getElementById('sheet');
    const lines=[...sheet.querySelectorAll('.mline')];
    lines.forEach(l=>{ l.style.fontSize='48px'; l.style.width='max-content'; l.style.margin='0 auto'; });
    const avail=sheet.clientWidth-20;
    let maxW=0; lines.forEach(l=>{ maxW=Math.max(maxW,l.offsetWidth); });
    const size=Math.min(82, 48*avail/maxW);
    lines.forEach(l=>{ l.style.fontSize=size+'px'; });
    // hard safety: shrink any line that still overflows
    lines.forEach(l=>{
      let fs=size;
      while(l.offsetWidth>avail && fs>14){ fs-=1; l.style.fontSize=fs+'px'; }
    });
  });
  await page.waitForTimeout(300);
  const sheet = page.locator('#sheet');
  const sheetBox = await sheet.boundingBox();
  await sheet.screenshot({ path: `pageimg/page-${nnn}.png` });
  const boxes = await page.evaluate((sb) => {
    const toks=[];
    document.querySelectorAll('.mword,.mmark').forEach(el=>{
      const r=el.getBoundingClientRect();
      toks.push({ x:(r.x-sb.x)/sb.w, y:(r.y-sb.y)/sb.h, w:r.width/sb.w, h:r.height/sb.h,
                  n:el.dataset.n, k:el.dataset.k, e:el.dataset.e==='1'?1:0 });
    });
    return toks;
  }, { x: sheetBox.x, y: sheetBox.y, w: sheetBox.width, h: sheetBox.height });
  out[p] = { ratio: sheetBox.height / sheetBox.width, tokens: boxes };
  console.log('page', p, 'tokens', boxes.length);
}
fs.writeFileSync('pageimg/boxes.json', JSON.stringify(out));
await browser.close();
console.log('done');
