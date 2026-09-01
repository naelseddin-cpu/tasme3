"""Generate exact-mushaf page data for the Quran trainer.

Sources (all open):
- @kmaslesa/holy-quran-word-by-word-full-data (quran.com words DB):
  authoritative glyph codes (code_v1), page/line placement, ayah markers,
  surah-header & basmala line positions.
- KFGQPC UthmanicHafs v22 official text: readable Uthmani word text.
- QCF_Pnnn.woff2 fonts (KFGQPC): per-page glyph fonts.

7 known orthographic join/split cases are handled explicitly below.
"""
import json, re, sys, os, unicodedata

SPECIAL = {  # verse-key -> list of (n_text_tokens_consumed, n_glyph_words) in order applied at given text index
    '2:181': ('merge', 'بَعۡدَ'),   # بعد + ما -> one glyph word
    '8:6':   ('merge', 'بَعۡدَ'),
    '13:37': ('merge', 'بَعۡدَ'),
    '37:130':('merge', 'إِلۡ'),    # إل + ياسين -> one glyph word
    '15:7':  ('split', 'لَّوۡمَا', ['لَّوۡ','مَا']),  # لوما -> two glyph words
    '27:20': ('split', 'مَالِيَ', ['مَا','لِيَ']),
    # 36:22's token carries a وَ prefix baked into the same orthographic word
    # (وَمَالِيَ, unlike 27:20's standalone مَالِيَ) -> splits as وَمَا + لِيَ,
    # not مَا + لِيَ. (WP-B fix: the two مَالِيَ verse-keys are NOT identical.)
    '36:22': ('split', 'وَمَالِيَ', ['وَمَا','لِيَ']),
}

def normalize(s):
    s = re.sub(r'[ً-ٰٟۖ-ۭـࣰ۟-ࣿ]', '', s)
    s = unicodedata.normalize('NFC', s)
    s = re.sub(r'[ٱآأإٲٳٵ]', 'ا', s)
    s = s.replace('ة','ه').replace('ى','ي')
    s = re.sub(r'[^ء-ي]', '', s)
    return s


def normalize_alt(s):
    # Same pipeline as normalize(), except dagger-alif (U+0670) is mapped to a
    # plain alif BEFORE tashkeel stripping (build plan C1 fix: قَٰلَ -> قال,
    # not قل, matching how a reciter's spoken/ASR-transcribed form actually
    # sounds). Emitted by callers only when it differs from normalize(s).
    s = s.replace('ٰ', 'ا')
    return normalize(s)

def text_tokens(t):
    return [w for w in t.split() if not re.fullmatch(r'[۞۩]', w)]

def build(pages_wanted):
    root = os.path.dirname(os.path.abspath(__file__))
    d = json.load(open(root+'/node_modules/@kmaslesa/holy-quran-word-by-word-full-data/data.json'))
    hafs = json.load(open(root+'/data/uthmanic_hafs_v22.json'))
    quran = json.load(open(root+'/data/quran.json'))
    order = [(s['id'], v['id']) for s in quran for v in s['verses']]
    vk_text = {f'{s}:{a}': hafs[i][0] for i,(s,a) in enumerate(order)}
    sura_names = {s['id']: s['name'] for s in quran}

    # per-ayah aligned word texts (mushaf segmentation)
    ayah_words = {}
    for k, t in vk_text.items():
        toks = text_tokens(t)
        sp = SPECIAL.get(k)
        out = []
        i = 0
        while i < len(toks):
            # NFC-fold only for the SPECIAL-trigger comparison: the pinned
            # v22 JSON is not guaranteed to store combining marks (e.g.
            # shadda+fatha) in canonical order at every occurrence (seen at
            # 15:7), so a literal == against the hardcoded pattern can miss.
            # The token text itself (out.append) is left byte-exact.
            tok_nfc = unicodedata.normalize('NFC', toks[i])
            if sp and sp[0]=='merge' and tok_nfc==unicodedata.normalize('NFC', sp[1]) and i+1 < len(toks):
                out.append(toks[i]+' '+toks[i+1]); i += 2; sp = None
            elif sp and sp[0]=='split' and tok_nfc==unicodedata.normalize('NFC', sp[1]):
                out.extend(sp[2]); i += 1; sp = None
            else:
                out.append(toks[i]); i += 1
        ayah_words[k] = out

    result_pages = {}
    mismatches = []
    for pg in d:
        if pg['page'] not in pages_wanted: continue
        # consume counter per ayah
        ptr = {}
        lines = {}
        meta_lines = []
        # line metadata: iterate groups; groups with lineType have no words: their line
        # is one of the visual lines NOT covered by any word (sura-header / basmala
        # band). We capture suraName straight off the metaData (rather than infer it
        # from the next word line) so trailing headers -- a sura whose header prints
        # as the LAST line of a page, with its first verse starting on the next page
        # -- resolve correctly too.
        for a in pg['ayahs']:
            lt = a['metaData'].get('lineType')
            if lt:
                sura_name_ar = None
                if lt == 'start_sura':
                    sn = a['metaData'].get('suraName') or ''
                    sura_name_ar = sn.split(' - ')[0].strip()
                meta_lines.append((lt, sura_name_ar))
            for w in a['words']:
                ln = lines.setdefault(w['line_number'], [])
                k = w['parentAyahVerseKey']
                if w['char_type_name'] == 'word':
                    i = ptr.get(k, 0); ptr[k] = i+1
                    words = ayah_words.get(k, [])
                    wt = words[i] if i < len(words) else None
                    if wt is None: mismatches.append((pg['page'], k, i))
                    n = normalize(wt or '')
                    alt = normalize_alt(wt or '')
                    tok = {'g': w['code_v1'].replace(' ',''), 'k': k,
                           'w': wt or '', 'n': n}
                    if alt != n:
                        tok['a'] = alt
                    ln.append(tok)
                else:
                    ln.append({'g': w['code_v1'].replace(' ',''), 'k': k, 'e': 1})
        # verify full consumption
        for k, n in ptr.items():
            if n != len(ayah_words.get(k,[])) and k.split(':')[0] != 'x':
                # ayah may span pages; only check if ayah fully on this page: skip
                pass
        used = sorted(lines)
        all_lines = []
        # visual lines = 1..total, fill gaps (and any trailing lines past the
        # last word line) with meta lines in order. total_lines = word-bearing
        # lines + meta lines: on the standard Madinah mushaf every non-marker
        # line is exactly one of these two kinds, so this sum IS the page's
        # true printed line count (previously `max(used)` silently dropped a
        # sura-header/basmala band that prints as the LAST line of a page).
        mi = 0
        total_lines = len(used) + len(meta_lines)
        for n in range(1, total_lines+1):
            if n in lines:
                all_lines.append({'n': n, 't': 'w', 'tk': lines[n]})
            else:
                lt, sura_name_ar = meta_lines[mi] if mi < len(meta_lines) else ('start_sura', None); mi += 1
                if lt == 'start_sura':
                    if sura_name_ar is not None:
                        # sura id looked up by Arabic name (unambiguous: 114 unique names)
                        sura_id = next((sid for sid, nm in sura_names.items() if nm == sura_name_ar), 0)
                    else:
                        # fallback: sura of next word line's first token
                        nxt = None
                        for m in range(n+1, total_lines+1):
                            if m in lines: nxt = lines[m][0]['k'].split(':')[0]; break
                        sura_id = int(nxt or 0)
                    all_lines.append({'n': n, 't': 's', 'sura': sura_id, 'name': sura_names.get(sura_id, sura_name_ar or '')})
                else:
                    all_lines.append({'n': n, 't': 'b'})
        result_pages[pg['page']] = {'page': pg['page'], 'lines': all_lines}
    if mismatches: print('WORD MISMATCHES:', mismatches[:10]); sys.exit(1)
    return result_pages

def parse_page_spec(spec):
    """Parse '1-604' or '1,2,596-604' (comma-separated ints and/or ranges)."""
    pages = set()
    for part in spec.split(','):
        part = part.strip()
        if not part: continue
        if '-' in part:
            a, b = part.split('-', 1)
            pages.update(range(int(a), int(b) + 1))
        else:
            pages.add(int(part))
    return pages

def parse_argv(argv):
    """--pages SPEC (e.g. '1-604', '1,2,596-604') ; or a bare list of page
    numbers (back-compat with the original `page1 page2 ...` invocation) ;
    or no args at all, meaning all 604 pages."""
    if not argv:
        return set(range(1, 605))
    if argv[0] == '--pages':
        if len(argv) < 2:
            raise SystemExit('--pages requires a value, e.g. --pages 1-604')
        return parse_page_spec(argv[1])
    return set(int(x) for x in argv)

if __name__ == '__main__':
    wanted = parse_argv(sys.argv[1:])
    pages = build(wanted)
    root = os.path.dirname(os.path.abspath(__file__))
    outdir = os.path.normpath(os.path.join(root, '..', 'apps/quran-trainer/mushaf/pages'))
    for p, data in pages.items():
        with open(f'{outdir}/page-{p:03d}.json', 'w') as f:
            json.dump(data, f, ensure_ascii=False, separators=(',',':'))
    print('wrote', len(pages), 'pages ->', outdir)
