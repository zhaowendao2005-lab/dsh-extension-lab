"""Multi-agent runtime analysis over decompressed DSH session logs.

Usage: python3 -I analyze.py [/tmp/dsh-sessions-raw] > out.json
Input is produced by decompress.mjs (read-only copy of ~/.dsh/sessions).
"""
import json, glob, os, sys, re, collections, statistics

ROOT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/dsh-sessions-raw'
AGENT_TOOLS = {'subagent', 'subagent_fork', 'send_message', 'wait_agent', 'list_agents', 'interrupt_agent',
               'workflow', 'ralph', 'create_goal', 'update_goal', 'get_goal', 'spawn_teammate',
               'team_task_create', 'team_task_update', 'team_task_list', 'team_task_get',
               'schedule_create', 'schedule_edit', 'schedule_list', 'schedule_view', 'job_output', 'job_kill'}


def pct(xs, p):
    if not xs: return None
    xs = sorted(xs); k = (len(xs) - 1) * p / 100; f = int(k); c = min(f + 1, len(xs) - 1)
    return xs[f] + (xs[c] - xs[f]) * (k - f)


def dist(xs):
    xs = [x for x in xs if x is not None]
    if not xs: return {'n': 0}
    return {'n': len(xs), 'p50': round(pct(xs, 50), 1), 'p90': round(pct(xs, 90), 1), 'max': round(max(xs), 1),
            'mean': round(statistics.mean(xs), 1), 'sum': round(sum(xs), 1)}


def turn_start_at(sess, t):
    st = [a for a, b, _ in sess.turns if a <= t + 1]
    return max(st) if st else sess.first_t


def text_of(content):
    return ''.join(c.get('text', '') for c in content or [] if isinstance(c, dict) and c.get('type') == 'text')


# ---------------------------------------------------------------- load
class S:  # one session
    pass


sessions = {}
for f in glob.glob(ROOT + '/*/*.jsonl'):
    lines = open(f, encoding='utf-8').read().splitlines()
    h = json.loads(lines[0])
    s = S(); s.id = h['id']; s.h = h; s.project = os.path.basename(os.path.dirname(f))
    s.parent = h.get('parentSession'); s.created = h['createdAt']; s.seeded = h['isSeeded']
    evs = [json.loads(l) for l in lines[1:]]
    if s.seeded:  # drop inherited history copied from the parent: cut at session/end-seed{inherited:true}
        cut = next((i for i, e in enumerate(evs) if e['type'] == 'session/end-seed' and (e.get('data') or {}).get('inherited')), None)
        if cut is None:
            cut = max([i for i, e in enumerate(evs) if (e.get('time') or 0) < s.created - 1000] or [-1])
        s.inherited_events = cut + 1
        evs = evs[cut + 1:]
    else:
        s.inherited_events = 0
    s.evs = evs
    sessions[s.id] = s

for s in sessions.values():
    s.children = [c.id for c in sessions.values() if c.parent == s.id]

# ---------------------------------------------------------------- per-session derived data
for s in sessions.values():
    s.turns = []; open_turn = None; s.tool_calls = []; calls = {}; s.usage = []; s.inbox = []; s.users = []
    s.retries = 0; s.compactions = 0; s.prunes = 0; s.turn_end_reasons = collections.Counter(); s.repeat_rem = 0
    s.steps = 0; s.gen = []; step_start = None; s.label = None; s.provider = None; s.model = None; s.goal = []
    s.ptc = collections.Counter(); s.team_members = {}; s.last_t = s.created
    for e in s.evs:
        t = e.get('type'); d = e.get('data', {}); tm = e.get('time')
        if tm: s.last_t = max(s.last_t, tm)
        if t == 'turn/start':
            open_turn = [tm, None, d.get('turn')]
        elif t == 'turn/end':
            if open_turn: open_turn[1] = tm; s.turns.append(open_turn); open_turn = None
            r = d.get('reason', {}); k = r.get('kind')
            if k == 'aborted': k += ':' + str((r.get('reason') or {}).get('kind'))
            if k == 'error': k += ':' + str((r.get('error') or {}).get('code'))
            s.turn_end_reasons[k] += 1
        elif t == 'step/start':
            s.steps += 1; step_start = tm
        elif t == 'assistant/message':
            u = d.get('usage') or {}
            if u: s.usage.append((tm, u))
            if step_start: s.gen.append((step_start, tm))
            step_start = None
        elif t == 'tool/call':
            c = {'id': d['callId'], 'name': d['name'], 'args': d.get('arguments', ''), 't0': tm, 't1': None, 'res': None}
            calls[d['callId']] = c; s.tool_calls.append(c)
        elif t == 'tool/result':
            m = d.get('message', {}); c = calls.get(m.get('toolCallId'))
            if c: c['t1'] = tm; c['res'] = text_of(m.get('content')); c['err'] = m.get('isError')
        elif t == 'tool/ptc-dispatch':
            s.ptc[d.get('name')] += 1
        elif t == 'agent/inbox/spliced':
            for m in d.get('inserted', []):
                src = m.get('source') or {}
                s.inbox.append({'t': tm, 'kind': src.get('kind'), 'target': d.get('target'), 'src': src,
                                'text': text_of(m.get('content'))})
        elif t == 'llm/retry':
            s.retries += 1
        elif t == 'compaction/start':
            s.compactions += 1
        elif t == 'compaction/prune':
            s.prunes += 1
        elif t == 'subagent/descriptor':
            s.label = d.get('label'); s.provider = d.get('provider'); s.model = d.get('agentModel')
        elif t == 'goal/change':
            s.goal.append((tm, d))
        elif t == 'team/member':
            mm = d.get('member', {}); s.team_members[mm.get('id')] = mm
        elif t == 'model/selection' and not s.model:
            s.model = d.get('model')
    if open_turn:
        open_turn[1] = s.last_t; s.turns.append(open_turn); s.turn_end_reasons['(unclosed)'] += 1
    for c in s.tool_calls:
        if c['t1'] is None: c['t1'] = c['t0']
    s.repeat_rem = sum(1 for i in s.inbox if i['kind'] == 'repeat-tool-reminder')
    s.active_ms = sum(b - a for a, b, _ in s.turns)
    s.first_t = s.turns[0][0] if s.turns else s.created
    s.end_t = s.turns[-1][1] if s.turns else s.created
    s.out_tok = sum(u.get('outputTokens', 0) for _, u in s.usage)
    s.prompt_tok = sum(max(u.get('totalTokens', 0) - u.get('outputTokens', 0), u.get('inputTokens', 0)) for _, u in s.usage)
    s.peak_ctx = max([max(u.get('totalTokens', 0) - u.get('outputTokens', 0), u.get('inputTokens', 0)) for _, u in s.usage] or [0])
    s.gen_ms = sum(b - a for a, b in s.gen)
    s.tool_ms = sum(c['t1'] - c['t0'] for c in s.tool_calls)

roots = [s for s in sessions.values() if not s.parent]
children = [s for s in sessions.values() if s.parent]
R = {}

# ---------------------------------------------------------------- spawn method of each child
# teammate children are team/member ids in the parent; the rest are subagent/subagent_fork (descriptor.provider spawn/fork)
for c in children:
    p = sessions[c.parent]
    if c.id in p.team_members: c.kind = 'teammate'
    elif c.provider == 'fork': c.kind = 'subagent_fork'
    else: c.kind = 'subagent'

# ---------------------------------------------------------------- 0. corpus
R['corpus'] = {
    'sessions': len(sessions), 'roots': len(roots), 'children': len(children),
    'children_seeded(fork)': sum(1 for c in children if c.seeded),
    'inherited_events_dropped': sum(s.inherited_events for s in sessions.values()),
    'child_kind': collections.Counter(c.kind for c in children),
    'max_depth': max(s.h['delegationDepth'] for s in sessions.values()),
    'time_range': [min(s.created for s in sessions.values()), max(s.last_t for s in sessions.values())],
    'tool_calls_total': sum(len(s.tool_calls) for s in sessions.values()),
    'agent_tool_calls': collections.Counter(c['name'] for s in sessions.values() for c in s.tool_calls if c['name'] in AGENT_TOOLS),
    'agent_tool_calls_via_ptc': collections.Counter({k: v for s in sessions.values() for k, v in s.ptc.items() if k in AGENT_TOOLS}),
    'agent_tool_calls_by_role': {
        'root': collections.Counter(c['name'] for s in roots for c in s.tool_calls if c['name'] in AGENT_TOOLS),
        'child': collections.Counter(c['name'] for s in children for c in s.tool_calls if c['name'] in AGENT_TOOLS)},
}
# ptc counter merge fix
ptc = collections.Counter()
for s in sessions.values():
    for k, v in s.ptc.items():
        if k in AGENT_TOOLS: ptc[k] += v
R['corpus']['agent_tool_calls_via_ptc'] = ptc

# ---------------------------------------------------------------- 1. roots using subagents
mroots = [s for s in roots if s.children]
R['q1'] = {
    'roots_with_children': len(mroots), 'roots_total': len(roots),
    'children_per_root': dist([len(s.children) for s in mroots]),
    'children_per_root_hist': collections.Counter(len(s.children) for s in mroots),
    'depth_hist': collections.Counter(s.h['delegationDepth'] for s in sessions.values()),
    'top_roots': sorted([(len(s.children), s.id, s.project[-40:], collections.Counter(sessions[c].kind for c in s.children)) for s in mroots], reverse=True)[:10],
    'roots_by_kind': collections.Counter(k for s in mroots for k in set(sessions[c].kind for c in s.children)),
}

# ---------------------------------------------------------------- 2. child runtime
def child_row(c):
    tools = collections.Counter(x['name'] for x in c.tool_calls)
    return {'id': c.id, 'parent': c.parent, 'kind': c.kind, 'label': c.label, 'model': c.model,
            'wall_s': round((c.end_t - c.created) / 1000, 1), 'active_s': round(c.active_ms / 1000, 1),
            'turns': len(c.turns), 'steps': c.steps, 'tool_calls': len(c.tool_calls),
            'out_tok': c.out_tok, 'prompt_tok': c.prompt_tok, 'peak_ctx': c.peak_ctx,
            'gen_s': round(c.gen_ms / 1000, 1), 'tool_s': round(c.tool_ms / 1000, 1),
            'retries': c.retries, 'compactions': c.compactions, 'prunes': c.prunes, 'repeat_reminders': c.repeat_rem,
            'end_reasons': dict(c.turn_end_reasons), 'top_tools': tools.most_common(5)}

rows = [child_row(c) for c in children]
R['q2'] = {
    'active_s': dist([r['active_s'] for r in rows]), 'wall_s': dist([r['wall_s'] for r in rows]),
    'turns': dist([r['turns'] for r in rows]), 'steps': dist([r['steps'] for r in rows]),
    'tool_calls': dist([r['tool_calls'] for r in rows]),
    'out_tok': dist([r['out_tok'] for r in rows]), 'prompt_tok': dist([r['prompt_tok'] for r in rows]),
    'peak_ctx': dist([r['peak_ctx'] for r in rows]),
    'gen_share_of_active': round(sum(c.gen_ms for c in children) / max(1, sum(c.active_ms for c in children)), 3),
    'tool_share_of_active': round(sum(c.tool_ms for c in children) / max(1, sum(c.active_ms for c in children)), 3),
    'by_kind': {k: {'n': len(v), 'active_s': dist([r['active_s'] for r in v]), 'tool_calls': dist([r['tool_calls'] for r in v])}
                for k, v in collections.groupby(sorted(rows, key=lambda r: r['kind']), key=lambda r: r['kind'])}
    if False else None,
    'child_tool_mix': collections.Counter(x['name'] for c in children for x in c.tool_calls).most_common(15),
    'step_latency_s': dist([(b - a) / 1000 for c in children for a, b in c.gen]),
}
bk = collections.defaultdict(list)
for r in rows: bk[r['kind']].append(r)
R['q2']['by_kind'] = {k: {'n': len(v), 'active_s': dist([r['active_s'] for r in v]), 'tool_calls': dist([r['tool_calls'] for r in v]),
                          'out_tok': dist([r['out_tok'] for r in v])} for k, v in bk.items()}
bm = collections.defaultdict(list)
for r in rows: bm[r['model']].append(r)
R['q2']['by_model'] = {str(k): {'n': len(v), 'active_s': dist([r['active_s'] for r in v]),
                                'step_p50_s': round(pct([(b - a) / 1000 for c in children if c.model == k for a, b in c.gen] or [0], 50), 1)}
                       for k, v in bm.items()}
# share of root totals
R['q2']['token_share_children'] = {
    'child_out': sum(c.out_tok for c in children), 'root_out': sum(s.out_tok for s in roots),
    'child_prompt': sum(c.prompt_tok for c in children), 'root_prompt': sum(s.prompt_tok for s in roots)}


# ---------------------------------------------------------------- 3. parent activity while children run (1-second bins)
def bins(a, b):
    return range(int(a // 1000), int(b // 1000) + 1)


q3_rows = []
tot = collections.Counter()
for p in mroots:
    # parent + teammates: treat only direct children; parents could be children themselves (depth max 1)
    run = set()
    for cid in p.children:
        for a, b, _ in sessions[cid].turns: run.update(bins(a, b))
    if not run: continue
    in_turn = set(); wait = set(); poll = set(); tool = set(); gen = set()
    for a, b, _ in p.turns: in_turn.update(bins(a, b))
    for c in p.tool_calls:
        bs = set(bins(c['t0'], c['t1'])) if c['t1'] - c['t0'] >= 1000 else set()
        if c['name'] == 'wait_agent': wait |= bs
        elif c['name'] in ('job_output', 'list_agents') or (c['name'] == 'bash' and re.search(r'\bsleep\s+\d', c['args'] or '')): poll |= bs
        else: tool |= bs
    for a, b in p.gen:
        if b - a >= 1000: gen.update(bins(a, b))
    st = collections.Counter()
    for x in run:
        if x not in in_turn: st['idle_turn_ended'] += 1
        elif x in wait: st['wait_agent'] += 1
        elif x in poll: st['poll_sleep_joboutput'] += 1
        elif x in gen: st['llm_generating'] += 1
        elif x in tool: st['other_tool'] += 1
        else: st['in_turn_other'] += 1
    tot.update(st)
    q3_rows.append({'root': p.id, 'children': len(p.children), 'child_run_s': len(run), **st,
                    'blocked_share': round((st['idle_turn_ended'] + st['wait_agent'] + st['poll_sleep_joboutput']) / len(run), 3)})
R['q3'] = {'totals_s': tot, 'total_run_s': sum(tot.values()),
           'shares': {k: round(v / max(1, sum(tot.values())), 3) for k, v in tot.items()},
           'blocked_share_per_root': dist([r['blocked_share'] for r in q3_rows]),
           'rows': sorted(q3_rows, key=lambda r: -r['child_run_s'])[:15]}
# wait_agent details
wa = [c for s in sessions.values() for c in s.tool_calls if c['name'] == 'wait_agent']
R['q3']['wait_agent'] = {'calls': len(wa), 'dur_s': dist([(c['t1'] - c['t0']) / 1000 for c in wa]),
                         'timedOut': sum(1 for c in wa if '"timedOut":true' in (c['res'] or '')),
                         'aborted': sum(1 for c in wa if 'aborted' in (c['res'] or '')),
                         'requested_timeout_ms': collections.Counter(json.loads(c['args'] or '{}').get('timeout_ms') for c in wa).most_common(6)}
# polling calls during child runs
pollc = collections.Counter()
for p in mroots:
    run = set()
    for cid in p.children:
        for a, b, _ in sessions[cid].turns: run.update(bins(a, b))
    for c in p.tool_calls:
        if int(c['t0'] // 1000) in run and c['name'] in ('list_agents', 'wait_agent', 'job_output', 'job_list'):
            pollc[c['name']] += 1
        if int(c['t0'] // 1000) in run and c['name'] == 'bash' and re.search(r'\bsleep\s+\d', c['args'] or ''):
            pollc['bash_sleep'] += 1
R['q3']['polling_calls_during_child_run'] = pollc

# ---------------------------------------------------------------- 4. send_message
p2c = []; c2p = []
for c in children:
    p = sessions[c.parent]
    for i in c.inbox:
        if i['kind'] == 'agent-message' and i['src'].get('senderSessionId') == p.id:
            p2c.append({'child': c.id, 'parent': p.id, 'dt_s': (i['t'] - c.first_t) / 1000, 'dt_turn_s': (i['t'] - turn_start_at(c, i['t'])) / 1000, 'text': i['text'][:160],
                        'child_running': any(a <= i['t'] <= b for a, b, _ in c.turns), 'len': len(i['text'])})
    for x in c.tool_calls:
        if x['name'] == 'send_message':
            a = json.loads(x['args'] or '{}')
            c2p.append({'child': c.id, 'parent': p.id, 'dt_s': (x['t0'] - c.first_t) / 1000, 'dt_turn_s': (x['t0'] - turn_start_at(c, x['t0'])) / 1000,
                        'turn_len_s': next(((b - a) / 1000 for a, b, _ in c.turns if a <= x['t0'] <= b + 1), None),
                        'frac_of_active': None, 'target': a.get('target') or a.get('agent'), 'len': len(a.get('message', '')),
                        'text': a.get('message', '')[:160], 'last_turn_end': c.end_t, 't': x['t0']})
for m in c2p:
    c = sessions[m['child']]
    m['before_end_s'] = round((c.end_t - m['t']) / 1000, 1)
    tl = m['turn_len_s'] or 0
    m['before_turn_end_s'] = tl - m['dt_turn_s']
    m['midway'] = m['before_turn_end_s'] > 60  # sent >60s before the child's current turn finished
    tgt = (m['target'] or '')
    m['to'] = 'parent' if tgt in ('lead', c.parent) or tgt.startswith('lead') else 'sibling/other'
STATUS_RE = re.compile(r'进度|状态|status|progress|还在|怎么样|多久|完成了吗|汇报|report back|how is|update me|只等你|不再等', re.I)
sib = collections.Counter(); sib_samples = []
for p in mroots:  # sibling messages (child->child)
    for cid in p.children:
        c = sessions[cid]
        for i in c.inbox:
            if i['kind'] == 'agent-message' and i['src'].get('senderSessionId') in p.children:
                sib['child->child'] += 1
R['q4'] = {
    'parent_to_child': len(p2c), 'children_receiving': len({m['child'] for m in p2c}),
    'p2c_dt_s': dist([m['dt_s'] for m in p2c]),
    'p2c_while_child_running': sum(1 for m in p2c if m['child_running']),
    'p2c_status_chasing': sum(1 for m in p2c if STATUS_RE.search(m['text'])),
    'p2c_status_samples': [m for m in p2c if STATUS_RE.search(m['text'])][:8],
    'child_to_parent': len(c2p), 'children_sending': len({m['child'] for m in c2p}),
    'children_total': len(children),
    'c2p_by_kind': collections.Counter(sessions[m['child']].kind for m in c2p),
    'c2p_to': collections.Counter(m['to'] for m in c2p),
    'c2p_to_parent': sum(1 for m in c2p if m['to'] == 'parent'),
    'children_sending_to_parent': len({m['child'] for m in c2p if m['to'] == 'parent'}),
    'c2p_parent_dt_turn_s': dist([m['dt_turn_s'] for m in c2p if m['to'] == 'parent']),
    'c2p_parent_frac_of_turn': dist([m['dt_turn_s'] / m['turn_len_s'] for m in c2p if m['to'] == 'parent' and m['turn_len_s']]),
    'c2p_parent_midway': sum(1 for m in c2p if m['to'] == 'parent' and m['midway']),
    'children_with_midway_parent_report': len({m['child'] for m in c2p if m['to'] == 'parent' and m['midway']}),
    'c2p_parent_by_kind': collections.Counter(sessions[m['child']].kind for m in c2p if m['to'] == 'parent'),
    'c2p_targets': collections.Counter(m['target'] for m in c2p).most_common(10),
    'p2c_dt_turn_s': dist([m['dt_turn_s'] for m in p2c]),
    'c2p_dt_s': dist([m['dt_s'] for m in c2p]),
    'c2p_before_end_s': dist([m['before_end_s'] for m in c2p]),
    'c2p_midway(>60s before child end)': sum(1 for m in c2p if m['midway']),
    'children_with_midway_report': len({m['child'] for m in c2p if m['midway']}),
    'c2p_len': dist([m['len'] for m in c2p]),
    'sibling': sib,
    'root_send_message_calls': sum(1 for s in roots for c in s.tool_calls if c['name'] == 'send_message'),
}
# duplicate dispatch: same parent, prompts very similar (jaccard on char 3-grams of first 600 chars)
def grams(t):
    t = re.sub(r'\s+', ' ', t[:800]); return {t[i:i + 3] for i in range(max(0, len(t) - 2))}
dups = []
for p in roots:
    sp = [x for x in p.tool_calls if x['name'] in ('subagent', 'subagent_fork', 'spawn_teammate')]
    G = []
    for x in sp:
        try: a = json.loads(x['args'] or '{}')
        except Exception: a = {}
        G.append((x, grams(a.get('prompt', '')), a.get('name') or a.get('description')))
    for i in range(len(G)):
        for j in range(i + 1, len(G)):
            A, B = G[i][1], G[j][1]
            if A and B:
                jac = len(A & B) / len(A | B)
                if jac > 0.85:
                    dups.append({'root': p.id, 'a': G[i][2], 'b': G[j][2], 'jaccard': round(jac, 2),
                                 'gap_s': round((G[j][0]['t0'] - G[i][0]['t0']) / 1000, 1)})
R['q4']['near_duplicate_spawns'] = {'pairs': len(dups), 'pairs_gap_gt_60s': sum(1 for d in dups if d['gap_s'] > 60),
                                    'samples': [d for d in dups if d['gap_s'] > 60][:10]}
# spawn error/rejections
spawn_err = [(s.id, c['name'], (c['res'] or '')[:160]) for s in sessions.values() for c in s.tool_calls
             if c['name'] in ('subagent', 'subagent_fork', 'spawn_teammate', 'send_message') and c.get('err')]
R['q4']['agent_tool_errors'] = {'n': len(spawn_err), 'samples': spawn_err[:12],
                                'by_msg': collections.Counter(re.sub(r'[0-9a-f-]{8,}|\d+', '#', e[2])[:90] for e in spawn_err).most_common(8)}

# ---------------------------------------------------------------- 5. settled notices & reaction
notices = []
for p in sessions.values():
    for i in p.inbox:
        if i['kind'] != 'subagent-settled': continue
        cid = i['src'].get('senderSessionId'); c = sessions.get(cid)
        nxt = next((u for u in p.usage if u[0] > i['t']), None)
        in_turn = any(a <= i['t'] <= b for a, b, _ in p.turns)
        lag_child = None
        if c:
            ends = [b for a, b, _ in c.turns if b <= i['t'] + 1000]
            lag_child = (i['t'] - max(ends)) / 1000 if ends else None
        notices.append({'parent': p.id, 'child': cid, 'len': len(i['text']), 'stop': i['src'].get('stopReason'),
                        'react_s': (nxt[0] - i['t']) / 1000 if nxt else None, 'parent_in_turn': in_turn,
                        'target': i['target'], 'notice_lag_after_child_end_s': lag_child})
R['q5'] = {'notices': len(notices), 'len_chars': dist([n['len'] for n in notices]),
           'len_gt_4000': sum(1 for n in notices if n['len'] > 4000),
           'react_s': dist([n['react_s'] for n in notices]),
           'react_s_parent_idle': dist([n['react_s'] for n in notices if not n['parent_in_turn']]),
           'react_s_parent_busy': dist([n['react_s'] for n in notices if n['parent_in_turn']]),
           'parent_in_turn_at_notice': sum(1 for n in notices if n['parent_in_turn']),
           'notice_lag_after_child_end_s': dist([n['notice_lag_after_child_end_s'] for n in notices]),
           'stopReason': collections.Counter(n['stop'] for n in notices),
           'top_slow_react': sorted([n for n in notices if n['react_s'] is not None], key=lambda n: -n['react_s'])[:6]}

# ---------------------------------------------------------------- 6. long tail
def max_gap(c):
    ts = [(e.get('time'), e['type']) for e in c.evs if e.get('time')]
    best = (0, None, None)
    for (a, ta), (b, tb) in zip(ts, ts[1:]):
        if b - a > best[0]: best = (b - a, ta, tb)
    return round(best[0] / 1000, 1), best[1], best[2]


def repeats(c):
    k = collections.Counter((x['name'], x['args']) for x in c.tool_calls)
    (n, a), cnt = k.most_common(1)[0] if k else ((None, ''), 0)
    return cnt, n, (a or '')[:120]


def slowest_tools(c, k=3):
    return [(x['name'], round((x['t1'] - x['t0']) / 1000, 1), (x['args'] or '')[:100]) for x in
            sorted(c.tool_calls, key=lambda x: x['t0'] - x['t1'])[:k]]


tail = []
for c in sorted(children, key=lambda c: -c.active_ms)[:12]:
    r = child_row(c)
    first_prompt = next((i['text'] for i in c.inbox if i['kind'] in ('user', 'agent-message')), '')
    if not first_prompt:
        um = next((e for e in c.evs if e['type'] == 'user/message' and (e['data'].get('source') or {}).get('kind') == 'user'), None)
        if um: first_prompt = text_of(um['data'].get('content'))
    r.update({'max_gap': max_gap(c), 'most_repeated_call': repeats(c), 'slowest_tools': slowest_tools(c),
              'gen_share': round(c.gen_ms / max(1, c.active_ms), 2), 'tool_share': round(c.tool_ms / max(1, c.active_ms), 2),
              'task': (c.label or '') + ' | ' + first_prompt[:200].replace('\n', ' '),
              'p2c_msgs': sum(1 for m in p2c if m['child'] == c.id)})
    tail.append(r)
interrupts = [(s.id, c['args'], (c['res'] or '')[:100]) for s in sessions.values() for c in s.tool_calls if c['name'] == 'interrupt_agent']
R['q6'] = {'top': tail,
           'child_turn_end_reasons': sum((c.turn_end_reasons for c in children), collections.Counter()),
           'root_turn_end_reasons': sum((s.turn_end_reasons for s in roots), collections.Counter()),
           'interrupt_agent': interrupts,
           'children_with_compaction': sum(1 for c in children if c.compactions), 'children_with_prune': sum(1 for c in children if c.prunes),
           'children_with_retries': sum(1 for c in children if c.retries), 'child_retries_total': sum(c.retries for c in children),
           'children_with_repeat_reminder': sum(1 for c in children if c.repeat_rem),
           'children_peak_ctx_gt_200k': sum(1 for c in children if c.peak_ctx > 200000),
           'children_peak_ctx_gt_100k': sum(1 for c in children if c.peak_ctx > 100000),
           'job_kill_in_roots': sum(1 for s in roots for c in s.tool_calls if c['name'] == 'job_kill'),
           'children_never_started_turn': sum(1 for c in children if not c.turns)}

# ---------------------------------------------------------------- 7. steering
steer = []
for p in mroots:
    run_iv = [(a, b) for cid in p.children for a, b, _ in sessions[cid].turns]
    first_spawn = min([sessions[c].created for c in p.children])
    for i in p.inbox:
        if i['kind'] == 'user' and i['t'] >= first_spawn:
            active = any(a <= i['t'] <= b for a, b in run_iv)
            steer.append({'root': p.id, 'active': active, 'dt_since_first_spawn_s': (i['t'] - first_spawn) / 1000,
                          'target': i['target'], 'text': i['text'][:120]})
R['q7'] = {'user_msgs_after_first_spawn': len(steer), 'during_child_run': sum(1 for x in steer if x['active']),
           'during_child_run_next_step(steering mid-turn)': sum(1 for x in steer if x['active'] and x['target'] == 'next-step'),
           'roots_with_steer_during_run': len({x['root'] for x in steer if x['active']}),
           'dt_since_first_spawn_s(active)': dist([x['dt_since_first_spawn_s'] for x in steer if x['active']]),
           'samples': [x for x in steer if x['active']][:12],
           'abort_by_user_in_roots_with_children': sum(p.turn_end_reasons.get('aborted:user', 0) for p in mroots)}

# ---------------------------------------------------------------- 8. goals / schedules / workflow
goals = {}
for s in sessions.values():
    for tm, d in s.goal:
        g = d.get('goal') or {}
        gid = g.get('id')
        if not gid: continue
        G = goals.setdefault(gid, {'session': s.id, 'ops': [], 'max': g.get('maxGoalRounds'), 'rounds': 0, 'phase': None,
                                   't0': tm, 't1': tm, 'objective': (g.get('objective') or '')[:80], 'is_child': bool(s.parent)})
        G['ops'].append(d.get('operation')); G['rounds'] = max(G['rounds'], d.get('roundsStarted') or 0)
        G['phase'] = g.get('phase'); G['t1'] = tm; G['max'] = g.get('maxGoalRounds') or G['max']
for G in goals.values():
    s = sessions[G['session']]
    G['spawns_in_session'] = len(s.children)
    G['dur_min'] = round((G['t1'] - G['t0']) / 60000, 1)
R['q8'] = {'goals': len(goals), 'final_phase': collections.Counter(G['phase'] for G in goals.values()),
           'ops': collections.Counter(o for G in goals.values() for o in G['ops']),
           'rounds': dist([G['rounds'] for G in goals.values()]),
           'max_rounds': collections.Counter(G['max'] for G in goals.values()),
           'goal_round_messages': sum(1 for s in sessions.values() for i in s.inbox if i['kind'] == 'goal'),
           'goals_in_sessions_with_children': sum(1 for G in goals.values() if G['spawns_in_session']),
           'goals_in_child_sessions': sum(1 for G in goals.values() if G['is_child']),
           'list': sorted(goals.values(), key=lambda G: -G['rounds'])[:12],
           'schedule_calls': sum(1 for s in sessions.values() for c in s.tool_calls if c['name'].startswith('schedule_')),
           'workflow_calls': sum(1 for s in sessions.values() for c in s.tool_calls if c['name'] == 'workflow'),
           'ralph_calls': sum(1 for s in sessions.values() for c in s.tool_calls if c['name'] == 'ralph'),
           'team_task_calls': collections.Counter(c['name'] for s in sessions.values() for c in s.tool_calls if c['name'].startswith('team_task')),
           'team_mode_sessions': sum(1 for s in sessions.values() if any(e['type'] == 'team/mode' for e in s.evs))}

R['child_rows'] = sorted(rows, key=lambda r: -r['active_s'])
json.dump(R, sys.stdout, ensure_ascii=False, indent=1, default=lambda o: dict(o) if isinstance(o, collections.Counter) else str(o))
