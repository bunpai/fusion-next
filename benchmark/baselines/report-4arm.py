#!/usr/bin/env python3
"""4-arm fusion-next benchmark report: token / latency / quality per planner-executor pair."""
import json, statistics, sys
from collections import defaultdict

rows = []
for l in open('/tmp/fusion-bench/results-4arm-2026-11-18.jsonl'):
    try: rows.append(json.loads(l))
    except: pass
# dedupe by key (keep last row — rescore/fixed spec writes later rows)
by_key = {}
for r in rows: by_key[r['key']] = r
rows = list(by_key.values())

TASKS = {t['id']: t for t in json.load(open('/tmp/fusion-bench/tasks.json'))['tasks']}
tier = lambda tid: 'easy' if tid in ('T1','T2','T3') else ('mid' if tid.startswith('T') else 'hard')

def p50(xs): return statistics.median(xs) if xs else 0
def mean(xs): return statistics.mean(xs) if xs else 0

# re-verify T5 with corrected spec already baked into rows' verify field (rescore done by aggregate --rescore)
arm_rows = defaultdict(list)
for r in rows: arm_rows[r['arm']].append(r)

print('# Fusion Next 4-arm benchmark (2026-11-18)\n')
print('| arm | n | pass% | p50 | mean leadIn | mean leadOut | mean workerOut | mean totalIn | mean totalOut |')
print('|---|---|---|---|---|---|---|---|---|')
for a in sorted(arm_rows):
    rs = arm_rows[a]
    ok = sum(1 for r in rs if r.get('success'))
    lat = [r.get('latencyMs',0) for r in rs]
    print(f"| {a} | {len(rs)} | {ok/len(rs)*100:.0f}% ({ok}/{len(rs)}) | {p50(lat)/1000:.0f}s | {mean([r.get('leadIn',0) for r in rs]):.0f} | {mean([r.get('leadOut',0) for r in rs]):.0f} | {mean([r.get('workerOut',0) for r in rs]):.0f} | {mean([r.get('totalIn',0) for r in rs]):.0f} | {mean([r.get('totalOut',0) for r in rs]):.0f} |")

print('\n## by tier\n')
print('| arm | tier | n | pass% | p50 | mean totalIn | mean totalOut | mean workerOut |')
print('|---|---|---|---|---|---|---|---|')
for a in sorted(arm_rows):
    for t_ in ('easy','mid','hard'):
        rs = [r for r in arm_rows[a] if tier(r['task']) == t_]
        if not rs: continue
        ok = sum(1 for r in rs if r.get('success'))
        lat = [r.get('latencyMs',0) for r in rs]
        print(f"| {a} | {t_} | {len(rs)} | {ok/len(rs)*100:.0f}% | {p50(lat)/1000:.0f}s | {mean([r.get('totalIn',0) for r in rs]):.0f} | {mean([r.get('totalOut',0) for r in rs]):.0f} | {mean([r.get('workerOut',0) for r in rs]):.0f} |")

print('\n## failures\n')
for r in rows:
    if not r.get('success') or r.get('status') != 'completed':
        print(f"- {r['key']}: {r.get('status')} {str(r.get('verify',{}).get('why',''))[:120]}")

print(f"\nrows={len(rows)}")
