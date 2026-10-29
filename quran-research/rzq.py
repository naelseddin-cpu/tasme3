import json,re,collections,sys
M=sys.argv[1]; Q=sys.argv[2]
d=json.load(open(Q)); names={s['id']:(s['name'],s['type']) for s in d}
text={(s['id'],v['id']):v['text'] for s in d for v in s['verses']}
rows=[l.rstrip('\n').split('\t') for l in open(M)]
seg=collections.defaultdict(list)
for loc,f,pos,feat in rows:
    s,a,w,k=map(int,loc.split(':')); seg[(s,a,w)].append((f,pos,feat))
def root(feat):
    m=re.search(r'ROOT:([^|]+)',feat); return m.group(1) if m else None
def lem(feat):
    m=re.search(r'LEM:([^|]+)',feat); return m.group(1) if m else None
hits=[]
for (s,a,w),segs in seg.items():
    for f,pos,feat in segs:
        if root(feat)=='رزق': hits.append((s,a,w,pos,feat))
L=collections.Counter(lem(h[4]) for h in hits); print('LEMMAS',L)
P=collections.Counter(h[3] for h in hits); print('POS',P)
V=[h for h in hits if h[3]=='V']
print('VERB aspect',collections.Counter(next((x for x in ('PERF','IMPF','IMPV') if x in h[4]),'?') for h in V))
print('VERB passive',sum('PASS' in h[4] for h in V))
print('VERB form',collections.Counter(re.search(r'VF:(\d+)',h[4]).group(1) if 'VF' in h[4] else '1' for h in V))
pers=collections.Counter(h[4].split('|')[-1] for h in V); print('VERB person',pers)
print('MECCA/MEDINA',collections.Counter(names[h[0]][1] for h in hits))
bys=collections.Counter(h[0] for h in hits)
print('BY SURAH',[(s,names[s][0],c) for s,c in sorted(bys.items(),key=lambda x:-x[1])])
# co-occurring roots in same verses
vs={(h[0],h[1]) for h in hits}
co=collections.Counter()
for (s,a,w),segs in seg.items():
    if (s,a) in vs:
        for f,pos,feat in segs:
            r=root(feat)
            if r and r!='رزق': co[r]+=1
print('CO-ROOTS',co.most_common(45))
# baseline ratio for selected roots
tot=collections.Counter(root(f[2]) for v in seg.values() for f in v if root(f[2]))
print('LIFT',[(r,c,tot[r],round(c/tot[r]*6236/len(vs),1)) for r,c in co.most_common(80) if tot[r]>=8 and c>=4 and c/tot[r]*6236/len(vs)>4])
# all verses
for (s,a) in sorted(vs):
    ws=[ (h[2],lem(h[4]),h[3], h[4].split('|')[0]) for h in hits if (h[0],h[1])==(s,a)]
    print(f'{s}:{a}',names[s][0],names[s][1][:3],ws, text[(s,a)])
