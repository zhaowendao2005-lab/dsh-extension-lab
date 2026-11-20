import json, glob, collections
root='/tmp/dsh-sessions-raw'
toolnames=collections.Counter(); jobkinds=collections.Counter(); inboxsrc=collections.Counter(); usersrc=collections.Counter()
samp=collections.defaultdict(list); jobstatus=collections.Counter()
want={'subagent','subagent_fork','send_message','wait_agent','list_agents','interrupt_agent','workflow','ralph','create_goal','update_goal','get_goal','schedule_create','spawn_teammate','team_task_create'}
callids={}
for f in glob.glob(root+'/*/*.jsonl'):
    for line in open(f,encoding='utf-8'):
        o=json.loads(line); t=o['type']; d=o.get('data',{})
        if t=='tool/call':
            toolnames[d['name']]+=1
            if d['name'] in want: callids[d['callId']]=d['name']
            if d['name'] in want and len(samp['call:'+d['name']])<2: samp['call:'+d['name']].append(line[:900])
        elif t=='tool/result':
            cid=d['message'].get('toolCallId')
            n=callids.get(cid)
            if n and len(samp['res:'+n])<2: samp['res:'+n].append(line[:1500])
        elif t in('job/registered','job/settled'):
            jobkinds[(t,d.get('kind'))]+=1
            if t=='job/settled': jobstatus[(d.get('kind'),d.get('status'),d.get('cause'))]+=1
            if d.get('kind') not in('bash',) and len(samp[t+':'+str(d.get('kind'))])<2: samp[t+':'+str(d.get('kind'))].append(line[:1200])
        elif t=='agent/inbox/spliced':
            for m in d.get('inserted',[]):
                k=(m.get('source') or {}).get('kind'); inboxsrc[(d.get('target'),k)]+=1
                if len(samp['inbox:'+str(k)])<2: samp['inbox:'+str(k)].append(line[:1500])
        elif t=='user/message':
            k=(d.get('source') or {}).get('kind'); usersrc[k]+=1
            if len(samp['user:'+str(k)])<2 and k!='user': samp['user:'+str(k)].append(line[:1200])
        elif t in('subagent/descriptor','goal/change','team/task','team/member','team/mode','subagent/catalog','compaction/start','compaction/end','compaction/prune','llm/retry','session/end-seed','turn/end'):
            if len(samp[t])<3: samp[t].append(line[:900])
print(toolnames.most_common(80)); print(jobkinds); print(jobstatus.most_common(40)); print(inboxsrc); print(usersrc)
for k,v in samp.items():
    print('=====',k)
    for x in v: print(x); print('--')
