"""Zero-error verification for the exact-mushaf page data (WP-B, build plan
Phase 1 step 3). Implements BOTH checks described in mushaf/README.md:

 (a) Glyph-stream check: the word-by-word DB's glyph codes (code_v1), read
     per-ayah in Quran order, must match the independently-sourced
     qpc-fonts repo's per-ayah glyph reference (tools/data/qpc_mushaf_glyph_ref.txt,
     aka "mushaf.txt" upstream) char-for-char after stripping formatting
     spaces. This cross-checks two independent data vintages of the same
     KFGQPC print, at the finest (single-glyph) granularity.

 (b) Word-alignment check: the official v22 Uthmani text, tokenized into
     words (with the 7 known orthographic join/split cases applied), must
     align 1:1 in COUNT with the glyph-word tokens (char_type_name=='word')
     for every one of the 6236 ayat. (This is the check gen_mushaf_pages.py
     itself only partially enforces: it aborts on "too few text words" but
     never checked "too many" i.e. leftover unconsumed text words for an
     ayah wholly contained on one page.)

Also validates every generated page-NNN.json: parses, has the expected
line count, every non-marker token carries g/n/k, and "a" is present only
when it differs from "n".

Usage: python3 tools/verify_mushaf.py
Writes tools/verification/REPORT-<date>.json (machine) and a .md summary.
"""
import json, os, re, sys, unicodedata, datetime

ROOT = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(ROOT, '..'))
PAGES_DIR = os.path.join(REPO, 'apps/quran-trainer/mushaf/pages')

sys.path.insert(0, ROOT)
import importlib.util
_spec = importlib.util.spec_from_file_location('gen_mushaf_pages', os.path.join(ROOT, 'gen_mushaf_pages.py'))
gen = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(gen)


def load_sources():
    d = json.load(open(os.path.join(ROOT, 'node_modules/@kmaslesa/holy-quran-word-by-word-full-data/data.json')))
    hafs = json.load(open(os.path.join(ROOT, 'data/uthmanic_hafs_v22.json')))
    quran = json.load(open(os.path.join(ROOT, 'data/quran.json')))
    order = [(s['id'], v['id']) for s in quran for v in s['verses']]
    vk_text = {f'{s}:{a}': hafs[i][0] for i, (s, a) in enumerate(order)}
    return d, hafs, quran, order, vk_text


def build_ayah_words(vk_text):
    """Mirrors gen_mushaf_pages.build()'s ayah_words computation exactly
    (including the NFC-tolerant SPECIAL matching), so check (b) measures
    the generator's actual behavior, not a re-derivation that could drift."""
    ayah_words = {}
    for k, t in vk_text.items():
        toks = gen.text_tokens(t)
        sp = gen.SPECIAL.get(k)
        out = []
        i = 0
        while i < len(toks):
            tok_nfc = unicodedata.normalize('NFC', toks[i])
            if sp and sp[0] == 'merge' and tok_nfc == unicodedata.normalize('NFC', sp[1]) and i + 1 < len(toks):
                out.append(toks[i] + ' ' + toks[i + 1]); i += 2; sp = None
            elif sp and sp[0] == 'split' and tok_nfc == unicodedata.normalize('NFC', sp[1]):
                out.extend(sp[2]); i += 1; sp = None
            else:
                out.append(toks[i]); i += 1
        ayah_words[k] = out
    return ayah_words


def check_glyph_stream(d, order):
    """(a) package (npm) code_v1 stream vs qpc-fonts repo's independent
    per-ayah glyph reference, compared per verse-key, attributed to page(s)."""
    ref_lines = [l for l in open(os.path.join(ROOT, 'data/qpc_mushaf_glyph_ref.txt'), encoding='utf-8').read().split('\n') if l]
    assert len(ref_lines) == len(order) == 6236, f'reference line count {len(ref_lines)} != {len(order)}'
    ref_glyphs = {}
    for i, (s, a) in enumerate(order):
        _, glyphs = ref_lines[i].split(',', 1)
        ref_glyphs[f'{s}:{a}'] = glyphs.replace(' ', '')

    pkg_glyphs = {}      # verse-key -> concatenated code_v1 (spaces stripped)
    pkg_pages = {}       # verse-key -> ordered list of pages it appears on
    for pg in d:
        pno = pg['page']
        for a in pg['ayahs']:
            for w in a['words']:
                k = w['parentAyahVerseKey']
                pkg_glyphs.setdefault(k, '')
                pkg_glyphs[k] += w['code_v1'].replace(' ', '')
                plist = pkg_pages.setdefault(k, [])
                if not plist or plist[-1] != pno:
                    plist.append(pno)

    exceptions = []
    page_has_diff = set()
    for k in ref_glyphs:
        pkg = pkg_glyphs.get(k, '')
        ref = ref_glyphs[k]
        if pkg != ref:
            pages = pkg_pages.get(k, [])
            exceptions.append({'verse_key': k, 'pages': pages, 'package_glyphs': pkg, 'reference_glyphs': ref})
            for p in pages:
                page_has_diff.add(p)

    all_pages = sorted({pg['page'] for pg in d})
    per_page = {p: ('DIFF' if p in page_has_diff else 'OK') for p in all_pages}
    return {
        'total_ayat_compared': len(ref_glyphs),
        'ayat_ok': len(ref_glyphs) - len(exceptions),
        'ayat_diff': len(exceptions),
        'pages_ok': sum(1 for v in per_page.values() if v == 'OK'),
        'pages_diff': sum(1 for v in per_page.values() if v == 'DIFF'),
        'per_page': per_page,
        'exceptions': exceptions,
    }


def check_word_alignment(d, ayah_words):
    """(b) v22 text-word count vs glyph-word count, per ayah, all 6236 ayat."""
    glyph_word_count = {}
    for pg in d:
        for a in pg['ayahs']:
            for w in a['words']:
                if w['char_type_name'] == 'word':
                    k = w['parentAyahVerseKey']
                    glyph_word_count[k] = glyph_word_count.get(k, 0) + 1

    exceptions = []
    aligned = 0
    for k, words in ayah_words.items():
        text_n = len(words)
        glyph_n = glyph_word_count.get(k, 0)
        if text_n == glyph_n:
            aligned += 1
        else:
            exceptions.append({'verse_key': k, 'text_word_count': text_n, 'glyph_word_count': glyph_n})
    return {
        'total_ayat': len(ayah_words),
        'aligned': aligned,
        'exceptions': exceptions,
    }


def validate_page_json():
    results = []
    ok = 0
    for p in range(1, 605):
        fn = os.path.join(PAGES_DIR, f'page-{p:03d}.json')
        entry = {'page': p, 'ok': True, 'issues': []}
        try:
            data = json.load(open(fn, encoding='utf-8'))
        except Exception as e:
            entry['ok'] = False
            entry['issues'].append(f'parse error: {e}')
            results.append(entry)
            continue
        lines = data.get('lines', [])
        word_lines = [l for l in lines if l.get('t') == 'w']
        # Pages 1-2 are special (short first page + basmala-heavy); all others
        # must have exactly 15 printed lines total (standard Madinah mushaf layout).
        if p >= 3 and len(lines) != 15:
            entry['ok'] = False
            entry['issues'].append(f'expected 15 lines, got {len(lines)}')
        for li, line in enumerate(lines):
            if line.get('t') != 'w':
                continue
            for ti, tok in enumerate(line.get('tk', [])):
                if tok.get('e'):
                    continue  # end-of-ayah marker: no g/n/k/w text requirement beyond g/k
                for key in ('g', 'n', 'k'):
                    if key not in tok or tok[key] in (None, ''):
                        entry['ok'] = False
                        entry['issues'].append(f'line {li} tok {ti}: missing/empty "{key}"')
                if 'a' in tok and tok['a'] == tok.get('n'):
                    entry['ok'] = False
                    entry['issues'].append(f'line {li} tok {ti}: "a" present but equals "n" ({tok["a"]!r})')
        if entry['ok']:
            ok += 1
        results.append(entry)
    return {'total_pages': len(results), 'pages_ok': ok, 'pages_with_issues': [r for r in results if not r['ok']]}


def main():
    print('Loading sources...')
    d, hafs, quran, order, vk_text = load_sources()
    ayah_words = build_ayah_words(vk_text)

    print('Running check (a) glyph-stream...')
    check_a = check_glyph_stream(d, order)
    print(f"  ayat: {check_a['ayat_ok']}/{check_a['total_ayat_compared']} OK, pages: {check_a['pages_ok']} OK / {check_a['pages_diff']} DIFF")

    print('Running check (b) word-alignment...')
    check_b = check_word_alignment(d, ayah_words)
    print(f"  aligned: {check_b['aligned']}/{check_b['total_ayat']}")

    print('Validating generated page JSON files...')
    check_json = validate_page_json()
    print(f"  pages OK: {check_json['pages_ok']}/{check_json['total_pages']}")

    report = {
        'date': datetime.date.today().isoformat(),
        'sources': {
            'word_by_word_pkg_version': json.load(open(os.path.join(ROOT, 'node_modules/@kmaslesa/holy-quran-word-by-word-full-data/package.json')))['version'],
            'total_pages_in_pkg': len(d),
            'total_ayat_in_quran_json': sum(len(s['verses']) for s in quran),
        },
        'check_a_glyph_stream': check_a,
        'check_b_word_alignment': check_b,
        'page_json_validation': check_json,
    }

    outdir = os.path.join(ROOT, 'verification')
    os.makedirs(outdir, exist_ok=True)
    date_str = datetime.date.today().isoformat()
    json_path = os.path.join(outdir, f'REPORT-{date_str}.json')
    md_path = os.path.join(outdir, f'REPORT-{date_str}.md')

    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    with open(md_path, 'w', encoding='utf-8') as f:
        f.write(f'# Mushaf Data Verification Report — {date_str}\n\n')
        f.write('## Check (a) — glyph-stream (package code_v1 vs qpc-fonts repo reference)\n\n')
        f.write(f"- Ayat compared: {check_a['total_ayat_compared']}\n")
        f.write(f"- Ayat OK: {check_a['ayat_ok']}\n")
        f.write(f"- Ayat DIFF: {check_a['ayat_diff']}\n")
        f.write(f"- Pages OK: {check_a['pages_ok']} / 604\n")
        f.write(f"- Pages DIFF: {check_a['pages_diff']}\n")
        if check_a['exceptions']:
            f.write('\n### Exceptions\n\n')
            f.write('| verse_key | pages | package glyphs | reference glyphs |\n|---|---|---|---|\n')
            for e in check_a['exceptions']:
                f.write(f"| {e['verse_key']} | {e['pages']} | `{e['package_glyphs']}` | `{e['reference_glyphs']}` |\n")
        f.write('\n## Check (b) — word alignment (v22 text words vs glyph words, per ayah)\n\n')
        f.write(f"- Ayat: {check_b['total_ayat']}\n")
        f.write(f"- Aligned: {check_b['aligned']}\n")
        f.write(f"- Exceptions: {len(check_b['exceptions'])}\n")
        if check_b['exceptions']:
            f.write('\n| verse_key | text_word_count | glyph_word_count |\n|---|---|---|\n')
            for e in check_b['exceptions']:
                f.write(f"| {e['verse_key']} | {e['text_word_count']} | {e['glyph_word_count']} |\n")
        f.write('\n## Page JSON validation\n\n')
        f.write(f"- Pages OK: {check_json['pages_ok']} / {check_json['total_pages']}\n")
        if check_json['pages_with_issues']:
            f.write('\n### Pages with issues\n\n')
            for r in check_json['pages_with_issues']:
                f.write(f"- page {r['page']}: {'; '.join(r['issues'])}\n")

    print(f'Wrote {json_path}')
    print(f'Wrote {md_path}')
    return report


if __name__ == '__main__':
    main()
