import json, glob, collections, sys
root='/tmp/dsh-sessions-raw'
types=collections.Counter(); keys=collections.defaultdict(collections.Counter); samples={}
sub=collections.Counter(); bad=0
for f in glob.glob(root+'/*/*.jsonl'):
    for line in open(f,encoding='utf-8',errors='replace'):
        try: o=json.loads(line)
        except Exception: bad+=1; continue
        t=o.get('type'); types[t]+=1
        for k in o: keys[t][k]+=1
        st = o.get('kind') or o.get('event') or (o.get('message') or {}).get('role') if isinstance(o.get('message'),dict) else o.get('kind')
        sub[(t,str(st))]+=1
        if (t,str(st)) not in samples: samples[(t,str(st))]=line[:700]
print('bad',bad)
for t,c in types.most_common(): print(t,c,dict(keys[t].most_common(25)))
print()
for k,c in sub.most_common(80): print(k,c)
print()
for k,v in samples.items(): print('==',k,'\n',v)
