# fusion-next 0.3.1 — plan-once

Plan-once architecture: the Lead plans once (GOAL / INVARIANTS / ACCEPTANCE / VERIFY),
delegates every workspace change through `fusion_dispatch`, reviews the AuditBundle,
and closes out — replacing the per-turn judge ceremony of 0.3.0.

## Capability changes

- **Lead write boundary (M2.5)** — `canExecute` now hard-denies write/execute tools on
  the lead lane. The lead keeps reads, web, subagent, run_code, fusion_dispatch, and
  control-plane tools; every file change reaches the workspace through the executor.
  Denials surface a bilingual hint pointing at fusion_dispatch.
- **Escalation gates (M2.1/M2.6)** — per-task rework budget: 3 execution failures →
  "escalation budget exhausted"; identical re-dispatched instructions after failure are
  rejected outright; near-identical (Jaccard ≥ 0.8) resends flag `resendSuspect` in the
  bundle. Infra errors (429/timeout/5xx) have their own 2-attempt budget, max 6 total
  attempts, and do not consume the rework budget. An in-flight mutex makes
  fusion_dispatch idempotent per task.
- **Verify hardening (M2.2)** — `verify_commands` accept test-runner allowlist only
  (pytest/vitest/jest/go/cargo/make/npm/pnpm/node/tsx/python…); redirection, inline
  interpreters (`-c`/`-e`/`--eval`/`eval`/`exec`), and dangerous commands are
  rejected (exitCode 126). `verify_timeout_ms` clamps to [120s, 3600s]. New: invalid
  verify commands are rejected by a **preflight gate before the worker runs** — a
  planner-side mistake no longer consumes the 3-failure rework budget. `verify_commands`
  may be omitted entirely for prose/documentation deliverables.
- **Watchdog + quiescence (M2.3)** — `max_wall_ms` (default 600000) and `max_steps`
  (default ~60) bound every dispatch. On breach the worker is interrupted once; if the
  workspace settles, a FULL audit produces a `stalled` bundle (diff + verify +
  lastActivity); if it keeps churning, the worker is `quarantined` (no audit). Three-way
  diff attribution: files dirty in your workspace before the dispatch are diffed against
  your own baseline and relabeled "(user-dirty baseline)", so worker deltas stay visible.
- **Prompts v0.4 (M2.4)** — plan-once protocol for both roles: lead plans once and sends
  delta instructions; worker corrects toward tests and reports deviations + Objections.
- **Catalog channel (M3)** — write-intent turns now go straight to the planner model
  (no per-turn judge call); ≥2 consecutive write turns inject a one-time upgrade notice
  suggesting the /fusion-next binding. The judge still routes read-class and short text.
- **Aggressive judge probe (M1)** — `settings:routing { "aggressiveWrite": true }`
  lets the judge count small writes as SIMPLE (worker). Off by default.
- **Catalog-channel tripwire (M5 C2)** — the model-menu channel forwards whole
  read-class turns to the executor with the session's unrestricted tools, which
  left worker writes un-audited (the confirmed 0.3.0 hole). Now the first
  worker-routed request of a turn latches a workspace snapshot, and when the
  agent goes idle a deterministic audit runs: `deletedTestLines > 0` or missing
  user-prompt literals stashes an AuditBundle-shaped escalation notice; the next
  turn force-routes to the planner with that notice attached. Clean writes stay
  on the worker tax-free. `settings:routing { "tripwire": false }` opts out.

## Fixes since 0.3.0

- **Resume-scope hole** — a pair binding persisted across headless processes but the
  lane scope (guard + fusion_dispatch) was per-process, so resumed sessions ran with
  no write boundary. `ensureLeadScope` now reinstalls the scope on assembly/request
  whenever the binding is selected but the scope is missing.
- **Inline-interpreter bypass** — `node -e`/`deno eval` slipped past the verify
  validator because the runner check short-circuited before the inline check.
- **Lead-lane penetration matrix + verify-command contract** are now unit-tested
  (`lead-lane.spec.ts`, `verify-command.spec.ts`).
- **Session-wide budget brick (f33 bench)** — three stalled dispatches used to
  exhaust the rework budget for the *whole session*: every later dispatch was
  rejected while the Lead was hard-denied writes, bricking multi-turn sessions.
  The budget is now scoped to a **user-turn epoch** (count of user messages —
  durable across process restarts): a new question resets it, only trailing
  consecutive `failed` dispatches count, `stalled`/`quarantined` are watchdog
  outcomes handled by the repair path, and `rejected` records are transparent.
  Regression-tested in `budget-epoch.spec.ts`.

## Migration notes

- The v0.2 `fusion_next_*` tool family is gone; the UI registers views for
  `fusion_dispatch` only. Old sessions mentioning those tools will find them unbound.
- review/* and approval/logical keep compiling but are marked `@deprecated`
  (accidental exports of the removed ceremony; replaced by the AuditBundle pipeline,
  planned removal next major). Downstream consumers should migrate off them.
- The lead-side soft reminder hooks (read streak, direct-write nudge) were removed —
  redundant now that the boundary is a hard deny.

## Metrics

New per-dispatch fields in `runtime:<taskId>` docs: `workerSteps`, `bundleBytes`,
`wallMs`, `failureSignature`, `stall`, `resendSuspect`, `epoch`, plus
`RuntimeV3.infraAttempts` and `RuntimeV3.turnEpoch` (the user-turn epoch the
counters belong to). benchmark/rebench/fusion-metrics.mjs extracts them from
state.sqlite for the benchmark suite.
