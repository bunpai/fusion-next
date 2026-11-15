# Fusion Next · a DSH plugin

[中文](README.md) · [Install](INSTALL.md) · [安装说明](INSTALL.zh.md)

Fusion Next pairs every session with a **planner (Lead)** and an **executor (Sidekick)** — two real models of your choice. A strong frontier model understands the task, reads the code, writes the brief and reviews the result; a much cheaper model does the actual editing, command running and test fixing.

One goal: **frontier-model outcomes at a discounted price.**

It is not a fake entry in the model menu — a second selector **"Executor"** appears next to the session's native model picker. Picking an executor enables the Fusion pair for that session; picking "off" exits it. Every session carries its own pair.

This project is an independent rewrite of [dsh-model-fusion](https://github.com/aa2246740/dsh-model-fusion), with a separate identity, protocol and UI. Inspired by Cognition's Fusion in Devin; not affiliated with Cognition.

## Install

```sh
dsh plugin add https://github.com/bunpai/fusion-next/releases/download/v0.1.1/fusion-next-0.1.1.tgz
```

or from source: `github:bunpai/fusion-next`. Requires `dsh >= 0.2.0-rc.2` (verified on DSH NEXT 0.2.2-rc.1).

After installing, pick **Executor → any model** next to the model selector in any session.

## How it works

1. **Delegate** — the Lead hands a work order (brief + acceptance commands) to the Sidekick via `fusion_next_delegate`. The Sidekick runs as an independent sub-agent session with its own model route and tool surface.
2. **Verify** — acceptance commands you or the Lead define (compile, tests, output checks) actually run; "looks right" is not acceptance.
3. **Review** — the Lead accepts or sends the work back with concrete notes via `fusion_next_review_result`; reworks loop back to the Sidekick.
4. **Boundaries** — while a task executes the Lead holds read access; the Sidekick writes inside the workspace. File ownership and overreach are constrained by the plugin's generation/authority ledger, not by politeness.

Verified end-to-end under the `standard`, `cordis` (creation) and `ptc` agent presets; Lead and Sidekick may come from different providers.

## UI

- **Executor selector** — beside the model picker; choosing a model enables, choosing "off" exits
- **Token badge** — executor-side spend and cache-hit rate for the session; click for per-model detail (in / cache-read / out / calls)
- **"Fusion Next" session tab** — this session's pair, task stage, requests and usage
- **"Fusion Next" sidebar panel** — every paired session at a glance (running / history & stats / cache keepalive)
- **Settings → Fusion Next** — default pair and cache-keepalive policy

## Benchmark (22 tasks × 2 seeds × 5 executors)

On an isolated instance (DSH NEXT 0.2.2-rc.1, PTC preset, Lead fixed to devin/swe-2): 22 tasks (12 generic + 10 against a real QT C++ machine codebase) × each executor × 2 seeds. Fusion arms: 95–100% success; solo arms: 81–100%; combined Lead+Sidekick token cost ≈ 1/8 of a solo swe-2 arm at public API prices. Full data: [benchmark/baselines/executor-benchmark-20261114.report.md](benchmark/baselines/executor-benchmark-20261114.report.md).

## Where data lives

- **Fusion Next's own records**: tasks, checks, usage and settings live in `$DSH_HOME/plugins/fusion-next/state.sqlite` (`DSH_HOME` defaults to `~/.dsh`).
- **Sessions**: owned by DSH; the plugin uploads nothing.
- Delete the file to clear everything; settings reset.

## Development

```sh
corepack pnpm@9.15.9 install --frozen-lockfile
node scripts/link-host.mjs /path/to/deepseek-harness      # link a DSH checkout for development
DSHX_HARNESS=/path/to/deepseek-harness pnpm build
pnpm test          # 86 files / 638 tests
```

The plugin uses only DSH's public plugin APIs and never patches DSH source. How new DSH versions are adopted: [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md).

## License

Apache-2.0
