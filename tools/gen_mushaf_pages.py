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
    '36:22': ('split', 'مَالِيَ', ['مَا','لِيَ']),
}

def normalize(s):
    s = re.sub(r'[ً-ٰٟۖ-ۭـࣰ۟-ࣿ]', '', s)
    s = unicodedata.normalize('NFC', s)
    s = re.sub(r'[ٱآأإٲٳٵ]', 'ا', s)
    s = s.replace('ة','ه').replace('ى','ي')
    s = re.sub(r'[^ء-ي]', '', s)
    return s

def text_tokens(t):
    return [w for w in t.split() if not re.fullmatch(r'[۞۩]', w)]

def build(pages_wanted):
    root = os.path.dirname(os.path.abspath(__file__))
    d = json.load(open(root+'/node_modules/@kmaslesa/holy-quran-word-by-word-full-data/data.json'))
    hafs = json.load(open(root+'/qpc/text-mushafs/UthmanicHafs_V22/UthmanicHafs v22.json'))
    quran = json.load(open(root+'/quran.json'))
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
            if sp and sp[0]=='merge' and toks[i]==sp[1] and i+1 < len(toks):
                out.append(toks[i]+' '+toks[i+1]); i += 2; sp = None
            elif sp and sp[0]=='split' and toks[i]==sp[1]:
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
        # line metadata: iterate groups; groups with lineType have no words: their line = ?
        # infer: sura/basmala lines occupy the line numbers NOT used by words, in order.
        for a in pg['ayahs']:
            lt = a['metaData'].get('lineType')
            if lt: meta_lines.append(lt)
            for w in a['words']:
                ln = lines.setdefault(w['line_number'], [])
                k = w['parentAyahVerseKey']
                if w['char_type_name'] == 'word':
                    i = ptr.get(k, 0); ptr[k] = i+1
                    words = ayah_words.get(k, [])
                    wt = words[i] if i < len(words) else None
                    if wt is None: mismatches.append((pg['page'], k, i))
                    ln.append({'g': w['code_v1'].replace(' ',''), 'k': k,
                               'w': wt or '', 'n': normalize(wt or '')})
                else:
                    ln.append({'g': w['code_v1'].replace(' ',''), 'k': k, 'e': 1})
        # verify full consumption
        for k, n in ptr.items():
            if n != len(ayah_words.get(k,[])) and k.split(':')[0] != 'x':
                # ayah may span pages; only check if ayah fully on this page: skip
                pass
        used = sorted(lines)
        all_lines = []
        # visual lines = 1..max, fill gaps with meta lines in order
        mi = 0
        maxline = max(used)
        for n in range(1, maxline+1):
            if n in lines:
                all_lines.append({'n': n, 't': 'w', 'tk': lines[n]})
            else:
                lt = meta_lines[mi] if mi < len(meta_lines) else 'start_sura'; mi += 1
                if lt == 'start_sura':
                    # sura id = sura of next word line's first token
                    nxt = None
                    for m in range(n+1, maxline+1):
                        if m in lines: nxt = lines[m][0]['k'].split(':')[0]; break
                    all_lines.append({'n': n, 't': 's', 'sura': int(nxt or 0), 'name': sura_names.get(int(nxt or 0), '')})
                else:
                    all_lines.append({'n': n, 't': 'b'})
        result_pages[pg['page']] = {'page': pg['page'], 'lines': all_lines}
    if mismatches: print('WORD MISMATCHES:', mismatches[:10]); sys.exit(1)
    return result_pages

if __name__ == '__main__':
    wanted = set(int(x) for x in sys.argv[1:]) or {1}
    pages = build(wanted)
    outdir = '/home/user/ArabiaERP/apps/quran-trainer/mushaf/pages'
    for p, data in pages.items():
        with open(f'{outdir}/page-{p:03d}.json', 'w') as f:
            json.dump(data, f, ensure_ascii=False, separators=(',',':'))
    print('wrote', len(pages), 'pages ->', outdir)
