"""Pilot: map a scanned mushaf page to word boxes using verified layout data.

Usage: python3 tools/scan_to_boxes.py <scan.png> <page_number> <out_dir>

Method (no OCR needed):
1. We already KNOW (zero-error verified) which tokens sit on each print line.
2. Detect horizontal ink strips inside the page's text column.
3. Assign strips in order to the known line sequence (header/basmala/words).
4. Split each word-line's ink span into token boxes using the token width
   PROPORTIONS from the synthetic render (same layout family), RTL.
5. Emit app-format JSON {ratio, veil, tokens:[{x,y,w,h,n,k,e}]} + a debug
   overlay image for visual QA (every box drawn on the scan).
"""
import json, sys, os
import numpy as np
from PIL import Image, ImageDraw

def main(scan_path, page, out_dir):
    page = int(page)
    im = Image.open(scan_path).convert('RGB')
    W, H = im.size
    a = np.asarray(im).astype(np.int32)
    # ink mask: dark or saturated (colored tajweed letters), excluding paper
    v = a.max(axis=2); s = a.max(axis=2) - a.min(axis=2)
    ink = (v < 150) | ((s > 60) & (v < 230))

    # text column: central area, exclude decorative border by finding the
    # widest low-ink vertical gutters near edges
    colsum = ink.sum(axis=0)
    # find inner bounds: scan inward until ink density drops (past border art)
    def inner_bound(profile, frm, to, step):
        # skip border blob, then find first calm zone followed by content
        thresh = profile.max() * 0.5
        i = frm
        while i != to and profile[i] > thresh: i += step   # border
        calm = i
        return calm
    x0 = inner_bound(colsum, 0, W//2, 1)
    x1 = inner_bound(colsum, W-1, W//2, -1)
    # margin inside the frame
    pad = int(W*0.01); x0 += pad; x1 -= pad
    sub = ink[:, x0:x1]

    rowsum = sub.sum(axis=1)
    on = rowsum > max(3, int(0.01*(x1-x0)))
    strips = []
    y = 0
    while y < H:
        if on[y]:
            y2 = y
            while y2 < H and (on[y2] or (y2+4 < H and on[y2:y2+5].any())): y2 += 1
            if y2 - y > H*0.008: strips.append((y, y2))
            y = y2
        y += 1
    # load known layout
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    pdata = json.load(open(f'{root}/apps/quran-trainer/mushaf/pages/page-{page:03d}.json'))
    lines = pdata['lines']
    print(f'strips found: {len(strips)}, expected lines: {len(lines)}')
    if len(strips) != len(lines):
        print('STRIP MISMATCH — dumping strip heights for manual mapping:')
        for i,(sy,sy2) in enumerate(strips): print(' ', i, sy, sy2, sy2-sy)
        sys.exit(2)
    # synthetic proportions per word line
    synth = json.load(open(f'{root}/apps/quran-trainer/mushaf/pages/page-{page:03d}.json'))
    # need synthetic boxes widths: use imgapp boxes if available
    boxes_all = json.load(open(f'{root}/../hifz-test/boxes.json'.replace('const PAGE_BOXES=',''))) if False else None

    tokens_out = []
    dbg = im.copy(); draw = ImageDraw.Draw(dbg)
    wl = 0
    # group synthetic tokens by their line: reconstruct from page json lines
    for (sy, sy2), line in zip(strips, lines):
        if line['t'] != 'w':
            continue
        tk = line['tk']
        strip = ink[sy:sy2, x0:x1]
        cs = strip.sum(axis=0)
        nz = np.nonzero(cs > 0)[0]
        if len(nz) == 0: continue
        ix0, ix1 = nz[0], nz[-1]
        span = ix1 - ix0
        # widths from glyph char count as proxy if no synthetic widths: better:
        # measure relative widths from glyph string lengths weighted (markers wider)
        weights = []
        for t in tk:
            if t.get('e'): weights.append(2.2)          # ayah medallion
            else: weights.append(max(1.6, len(t['g'])*1.0 + len(t['n'])*0.55))
        total = sum(weights)
        # RTL: first token at right
        acc = 0
        for t, wgt in zip(tk, weights):
            fx1 = ix1 - int(acc/total*span)
            acc += wgt
            fx0 = ix1 - int(acc/total*span)
            X0, X1 = x0+fx0, x0+fx1
            tokens_out.append({'x': X0/W, 'y': sy/H, 'w': (X1-X0)/W, 'h': (sy2-sy)/H,
                               'n': t.get('n',''), 'k': t['k'], 'e': 1 if t.get('e') else 0})
            draw.rectangle([X0, sy, X1, sy2], outline=(200,30,30) if not t.get('e') else (30,90,200), width=2)
        wl += 1
    # veil color: median paper color inside column
    paper = a[(~ink)][:len(a[(~ink)])]
    med = np.median(a[~ink].reshape(-1,3), axis=0).astype(int)
    veil = '#%02x%02x%02x' % tuple(med)
    os.makedirs(out_dir, exist_ok=True)
    im.save(f'{out_dir}/page-{page:03d}-book.png')
    dbg.save(f'{out_dir}/page-{page:03d}-debug.png')
    out = {'ratio': H/W, 'veil': veil, 'tokens': tokens_out}
    json.dump(out, open(f'{out_dir}/page-{page:03d}-book.json','w'), ensure_ascii=False)
    print('tokens:', len(tokens_out), 'veil:', veil, '→', out_dir)

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2], sys.argv[3])
