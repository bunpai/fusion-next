# Fusion Next · a DSH plugin

[中文](README.md) · [Install](INSTALL.md) · [安装说明](INSTALL.zh.md)

Fusion Next pairs every session with a **planner (Lead)** and an **executor (Sidekick)** — two real models of your choice. A strong frontier model understands the task, reads the code, writes the brief and reviews the result; a much cheaper model does the actual editing, command running and test fixing.

One goal: **frontier-model outcomes at a discounted price.**

It is not a fake entry in the model menu — a second selector **"Executor"** appears next to the session's native model picker. Picking an executor enables the Fusion pair for that session; picking "off" exits it. Every session carries its own pair.

This project is an independent rewrite of [dsh-model-fusion](https://github.com/aa2246740/dsh-model-fusion), with a separate identity, protocol and UI. Inspired by Cognition's Fusion in Devin; not affiliated with Cognition.

## Install

```sh
dsh plugin add github:bunpai/fusion-next
```

or grab the latest tarball from the releases page. Requires `dsh >= 0.2.0-rc.2` (verified on DSH NEXT 0.2.2-rc.1).

After installing, pick **Executor → any model** next to the model selector in any session.

## How it works (v0.3.x · plan-once)

1. **Plan once** — the Lead reads the requirement and produces one plan: goal, invariants, acceptance criteria, verify commands. From then on it only schedules and gives final review.
2. **One dispatch** — the Lead calls `fusion_dispatch` (the single fusion tool) with an execution instruction plus optional `verify_commands`. The Worker is a persistent sub-agent session running the executor model with the full write tool surface.
3. **Unattended pipeline** — inside one dispatch the plugin runs, without interruption: worker executes → workspace snapshot audit → verify commands → automatic rework (≤2 rounds). The Lead gets back one AuditBundle: changed files, unified diff, static audits (mutated test files / deleted test lines / missing required files), per-command results, repair rounds.
4. **Budgeted escalation** — execution failures consume a 3-strike rework budget per task; identical resends are rejected outright; infra errors (429/timeouts) have a separate retry budget. A stuck worker is bounded by the watchdog (wall/step limit → interrupt → quiescence check → full audit into a stalled bundle; still churning → quarantined).
5. **Hard boundary** — in pair mode the Lead's tool surface is read-only + control-plane: writes must go through dispatch; the deny is enforced, not suggested. In model-menu mode, turns forwarded wholesale to the executor are audited after the fact by a tripwire — deleted test lines or missing required files force the next turn back to the planner.

Verified end-to-end under the `standard`, `cordis` (creation) and `ptc` agent presets; Lead and Worker may come from different providers.

## UI

- **Executor selector** — beside the model picker; choosing a model enables, choosing "off" exits
- **Token badge** — executor-side spend and cache-hit rate for the session; click for per-model detail (in / cache-read / out / calls)
- **"Fusion Next" session tab** — this session's pair, task stage, requests and usage
- **"Fusion Next" sidebar panel** — every paired session at a glance (running / history & stats / cache keepalive)
- **Settings → Fusion Next** — default pair and cache-keepalive policy

## Benchmark (22 tasks × 2 seeds × 5 executors)

On an isolated instance (DSH NEXT 0.2.2-rc.1, PTC preset, Lead fixed to devin/swe-2): 22 tasks (12 generic + 10 against a real QT C++ machine codebase) × each executor × 2 seeds. Fusion arms: 95–100% success; solo arms: 81–100%; combined Lead+Sidekick token cost ≈ 1/8 of a solo swe-2 arm at public API prices. Full data: [benchmark/baselines/report.md](benchmark/baselines/report.md).

## Where data lives

- **Fusion Next's own records**: tasks, checks, usage and settings live in `$DSH_HOME/plugins/fusion-next/state.sqlite` (`DSH_HOME` defaults to `~/.dsh`).
- **Sessions**: owned by DSH; the plugin uploads nothing.
- Delete the file to clear everything; settings reset.

## Development

```sh
corepack pnpm@9.15.9 install --frozen-lockfile
node scripts/link-host.mjs /path/to/deepseek-harness      # link a DSH checkout for development
DSHX_HARNESS=/path/to/deepseek-harness pnpm build
pnpm test          # 30 files / 154 tests
node scripts/build-local.mjs   # local build without a harness checkout
```

The plugin uses only DSH's public plugin APIs and never patches DSH source. How new DSH versions are adopted: [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md).

## License

Apache-2.0
