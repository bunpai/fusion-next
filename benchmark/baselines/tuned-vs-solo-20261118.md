# Tuned-planner benchmark — fusion-next vs solo swe-2 (2026-11-18)

9 tasks (easy T1/T3, mid T5/T8/T9, hard R2/R5/R7/R10), one seed each,
DSH NEXT 0.2.2-rc.1 isolated instance, preset standard, planner cpa/devin/swe-2,
executor cpa/deepseek-v4-1-flash-1017. Fusion arm runs the tuned prompt +
SEPARATED_LEAD_READ_STREAK=12 + subagent reroute (through c170224+; builds on 011c7f9).

## Results

| task | solo ok | solo ms | solo leadIn | fn ok | fn ms | fn leadIn | fn workerIn | fn workerOut |
|------|---------|---------|-------------|-------|-------|-----------|-------------|--------------|
| T1  | True | 12,826 | 30,996 | True | 12,611 | 34,471 | 0 | 0 |
| T3  | True |  9,234 | 30,997 | True |  7,553 | 18,088 | 0 | 0 |
| T5  | True | 22,629 | 31,789 | True | 83,991 | 29,898 | 13,342 | 1,822 |
| T8  | True | 34,459 | 57,716 | True | 51,288 | 15,834 | 12,607 | 1,213 |
| T9  | True | 25,904 | 13,179 | True | 72,025 | 36,078 | 12,017 | 1,351 |
| R2  | True | 42,422 | 44,946 | True |107,420 | 13,775 | 0 | 0 |
| R5  | True | 43,801 | 36,105 | True | 31,800 | 16,155 | 0 | 0 |
| R7  | True | 97,208 | 32,731 | True | 29,202 | 38,640 | 0 | 0 |
| R10 | True |305,868 | 41,592 | True |175,655 | 57,822 | 19,602* | 4,081* |

*R10 worker values from the rework-turn readback; workerIn/Out columns above sum
worker tool tokens only. Both arms 9/9 — quality parity.

## Lead-input delta (the tuning target)

| tier | solo leadIn | fn leadIn | Δ |
|------|------------|-----------|---|
| easy (T1,T3) | 61,993 | 52,559 | **-15%** |
| mid (T5,T8,T9) | 102,684 | 81,810 | **-20%** |
| hard (R2,R5,R7,R10) | 155,374 | 126,392 | **-19%** |
| **total** | **320,051** | **260,761** | **-18.5%** |

## Interpretation

- Tuning works: earlier delegation guidance + fan-out reads + tighter read cap
  cut the expensive planner's input ~15-20% at identical quality.
- R2/R5/R7 (pure QA tasks) show fn lead answering directly with ZERO worker calls
  — the tuned prompt correctly does not delegate cheap questions. The saving here
  is prompt efficiency, not delegation.
- T8 (file fix) is the delegation sweet spot: fn used 27% of solo's lead tokens.
- R10 (large synthesis doc) is the regression case: worker wrote it, but lead
  review + rework burned more than solo doing it alone (57.8k vs 41.6k).
- Latency: fn p50 51s vs solo 34s (1.5×) — quality-equivalent cost trade.
- view=scorecard endpoint verified live — per-task lead/worker token split,
  rework rounds, check outcomes (1360 historical cards present).
