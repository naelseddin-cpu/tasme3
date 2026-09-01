#!/usr/bin/env node
// Validates the rendered page assets in site/pages/ against the source
// page data in app/mushaf/pages/ (WP-E acceptance check).
//
// For every requested page:
//   - page-NNN.webp exists and is > 10KB
//   - page-NNN.json parses
//   - every token satisfies 0<=x, 0<=y, x+w<=1, y+h<=1, w>0, h>0
//   - token count === word+marker token count from app/mushaf/pages/page-NNN.json
//
// Usage:
//   node tools/validate_page_assets.mjs --pages 1-604 --dir site/pages
//
// Exits non-zero and prints every violation if any are found; otherwise
// prints a summary (page count, total asset size).

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC_PAGES_DIR = path.join(ROOT, 'app/mushaf/pages');

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
  const out = { pages: '1-604', dir: 'site/pages' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--pages') out.pages = argv[++i];
    else if (a === '--dir') out.dir = argv[++i];
    else throw new Error(`unknown arg: ${a}`);
  }
  return out;
}

function sourceTokenCount(pageData) {
  let n = 0;
  for (const line of pageData.lines) {
    if (line.t === 'w') n += line.tk.length;
  }
  return n;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const pageNums = parsePageSpec(args.pages);
  const outDir = path.resolve(ROOT, args.dir);

  const violations = [];
  let totalBytes = 0;
  let checkedPages = 0;
  const MIN_WEBP_BYTES = 10 * 1024;
  const EPS = 1e-9;

  for (const p of pageNums) {
    const nnn = String(p).padStart(3, '0');
    const webpPath = path.join(outDir, `page-${nnn}.webp`);
    const jsonPath = path.join(outDir, `page-${nnn}.json`);
    const srcPath = path.join(SRC_PAGES_DIR, `page-${nnn}.json`);

    if (!fs.existsSync(webpPath)) {
      violations.push(`page ${nnn}: MISSING webp`);
      continue;
    }
    const webpStat = fs.statSync(webpPath);
    totalBytes += webpStat.size;
    if (webpStat.size <= MIN_WEBP_BYTES) {
      violations.push(`page ${nnn}: webp too small (${webpStat.size} bytes)`);
    }

    if (!fs.existsSync(jsonPath)) {
      violations.push(`page ${nnn}: MISSING boxes json`);
      continue;
    }
    totalBytes += fs.statSync(jsonPath).size;

    let data;
    try {
      data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    } catch (e) {
      violations.push(`page ${nnn}: JSON parse error: ${e.message}`);
      continue;
    }

    if (!Array.isArray(data.tokens)) {
      violations.push(`page ${nnn}: no tokens array`);
      continue;
    }

    let boxViolationCount = 0;
    for (const [i, t] of data.tokens.entries()) {
      const bad =
        !(t.x >= -EPS) ||
        !(t.y >= -EPS) ||
        !(t.x + t.w <= 1 + EPS) ||
        !(t.y + t.h <= 1 + EPS) ||
        !(t.w > 0) ||
        !(t.h > 0);
      if (bad) {
        boxViolationCount++;
        if (boxViolationCount <= 3) {
          violations.push(
            `page ${nnn}: token[${i}] out of bounds x=${t.x} y=${t.y} w=${t.w} h=${t.h}`
          );
        }
      }
    }
    if (boxViolationCount > 3) {
      violations.push(`page ${nnn}: ...and ${boxViolationCount - 3} more box violations`);
    }

    if (!fs.existsSync(srcPath)) {
      violations.push(`page ${nnn}: no matching source page json at ${srcPath}`);
    } else {
      const srcData = JSON.parse(fs.readFileSync(srcPath, 'utf8'));
      const expected = sourceTokenCount(srcData);
      if (data.tokens.length !== expected) {
        violations.push(
          `page ${nnn}: token count mismatch: got ${data.tokens.length}, expected ${expected}`
        );
      }
    }

    checkedPages++;
  }

  console.log(`checked ${checkedPages}/${pageNums.length} requested pages`);
  console.log(`total asset bytes (webp+json, requested pages only): ${totalBytes} (${(totalBytes / 1024 / 1024).toFixed(2)} MB)`);

  if (violations.length) {
    console.log(`\n${violations.length} VIOLATIONS:`);
    for (const v of violations) console.log(' - ' + v);
    process.exitCode = 1;
  } else {
    console.log('\nZero violations.');
  }
}

main();
