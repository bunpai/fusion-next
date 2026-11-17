import json, statistics as st
rows={}
for l in open("/tmp/fusion-bench/results-glm53-2026-11-17.jsonl"):
    r=json.loads(l)
    if r.get("ws2") and r["status"] not in ("error","DRIVER-ERR"):
        rows[r["key"]]=r
data=list(rows.values())
print(f"final keys: {len(data)}")
tiers = {"easy (T1-3)": ["T1","T2","T3"], "mid (T4-12)": ["T4","T5","T6","T7","T8","T9","T10","T11","T12"], "hard (R1-10)": ["R1","R2","R3","R4","R5","R6","R7","R8","R9","R10"]}
for tier, ids in tiers.items():
    print(f"\n=== {tier} ===")
    print(f'{"task":>4} | {"seed":>4} | solo ok lat in/out | fn ok lat leadIn/leadOut wIn/wOut')
    for tid in ids:
        for s in (1,2):
            so=rows.get(f"solo-swe2|{tid}|s{s}"); fn=rows.get(f"fn-glm53|{tid}|s{s}")
            def fmt(r):
                if not r: return "—"
                ok="✓" if r.get("success") else "✗"
                return f'{ok} {r["latencyMs"]//1000:>4}s {r["leadIn"]}/{r["leadOut"]}'
            def fmtf(r):
                if not r: return "—"
                ok="✓" if r.get("success") else "✗"
                return f'{ok} {r["latencyMs"]//1000:>4}s L{r["leadIn"]}/{r["leadOut"]} W{r["workerIn"]}/{r["workerOut"]}'
            print(f'{tid:>4} | s{s}   | {fmt(so):>22} | {fmtf(fn)}')
# summary stats
for arm in ("solo-swe2","fn-glm53"):
    sub=[r for r in data if r["arm"]==arm]
    ok=[r for r in sub if r.get("success")]
    lat=[r["latencyMs"]/1000 for r in sub]
    lin=[r["leadIn"] for r in sub]; lout=[r["leadOut"] for r in sub]
    win=[r["workerIn"] for r in sub]; wout=[r["workerOut"] for r in sub]
    print(f'\n{arm}: pass {len(ok)}/{len(sub)} ({len(ok)/len(sub)*100:.0f}%) | lat p50 {st.median(lat):.0f}s | lead in/out mean {st.mean(lin):.0f}/{st.mean(lout):.0f} | worker in/out {st.mean(win):.0f}/{st.mean(wout):.0f}')
# per-tier means for token savings
print("\n=== tier summary (mean leadIn / leadOut / workerOut / latency / pass%) ===")
for tier, ids in tiers.items():
    for arm in ("solo-swe2","fn-glm53"):
        sub=[r for r in data if r["arm"]==arm and r["task"] in ids]
        if not sub: continue
        ok=sum(1 for r in sub if r.get("success"))
        print(f'{tier:>14} {arm:>10}: pass {ok}/{len(sub)} lat {st.mean(r["latencyMs"] for r in sub)/1000:.0f}s L_in {st.mean(r["leadIn"] for r in sub):.0f} L_out {st.mean(r["leadOut"] for r in sub):.0f} W_out {st.mean(r["workerOut"] for r in sub):.0f} tot_in {st.mean(r["totalIn"] for r in sub):.0f}')
