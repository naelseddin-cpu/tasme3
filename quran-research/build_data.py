"""Build explorer data from the official text (quran.json) and the Quranic
Arabic Corpus morphology. Occurrences are encoded as g*256+w, where g is the
global verse index (0..6235) and w the 1-based word number (0 = no highlight)."""
import json, re, sys, collections
Q = json.load(open(sys.argv[1])); M = sys.argv[2]; OUT = sys.argv[3]
off = {}; g = 0; surahs = []; text = []
for s in Q:
    off[s['id']] = g
    words = sum(len(v['text'].split()) for v in s['verses'])
    surahs.append([s['name'] if s['id'] != 14 else 'إبراهيم', s['transliteration'], 'm' if s['type'] == 'meccan' else 'd', len(s['verses']), words])
    for v in s['verses']: text.append(v['text']); g += 1
assert g == 6236
nwords = collections.Counter(); seen = set()
roots = collections.defaultdict(list); lem = collections.defaultdict(list)
lemroot = {}; lempos = {}; pn = collections.Counter(); rootlem = collections.defaultdict(collections.Counter)
for l in open(M):
    loc, f, pos, feat = l.rstrip('\n').split('\t')
    s, a, w, k = map(int, loc.split(':'))
    gi = off[s] + a - 1; nwords[gi] = max(nwords[gi], w)
    r = re.search(r'ROOT:([^|]+)', feat); lm = re.search(r'LEM:([^|]+)', feat)
    parts = feat.split('|')
    if 'PREF' in parts or 'SUFF' in parts: continue
    code = gi * 256 + w
    if r and (r.group(1), code) not in seen:
        seen.add((r.group(1), code)); roots[r.group(1)].append(code)
        if lm: rootlem[r.group(1)][lm.group(1)] += 1
    if lm and (lm.group(1), code) not in seen:
        seen.add((lm.group(1), code)); L = lm.group(1); lem[L].append(code)
        lemroot[L] = r.group(1) if r else ''; lempos[L] = pos
        if 'PN' in parts: pn[L] += 1
# verses whose word split differs from the corpus: drop word positions there
bad = {gi for gi in range(6236) if len(text[gi].split()) != nwords[gi]}
def fix(codes): return [c - (c % 256) if c // 256 in bad else c for c in sorted(codes)]
def delta(codes):
    out = []; p = 0
    for c in codes: out.append(c - p); p = c
    return out
data = {
  'surahs': surahs,
  'roots': {r: delta(fix(c)) for r, c in roots.items()},
  'rootLem': {r: [[k, v] for k, v in c.most_common()] for r, c in rootlem.items()},
  'lemmas': {L: [lemroot[L], lempos[L], delta(fix(c))] for L, c in lem.items()},
  'pn': [k for k, _ in pn.most_common()],
}
assert len(roots['رزق']) == 123, len(roots['رزق'])
json.dump(data, open(OUT + '/data.json', 'w'), ensure_ascii=False, separators=(',', ':'))
json.dump(text, open(OUT + '/text.json', 'w'), ensure_ascii=False, separators=(',', ':'))
print('roots', len(roots), 'lemmas', len(lem), 'pn', len(pn), 'bad', len(bad), 'total root occ', sum(map(len, roots.values())))
