# DSH SDK capability audit (plan row A03)

Scope: the capabilities the Fusion-Next plan needs from the DSH Host SDK, one row per capability, with a
verdict and the file:line evidence actually read. Supersedes `docs/A03-SDK-CAPABILITY.md` (removed here;
see history) with a broader row set and a stricter evidence rule.

Verdict vocabulary: `available` / `available-with-caveats` / `needs-host-extension` / `unavailable`.

## Evidence sources and their limits

**(a) This plugin's own host-API usage** — `src/**` (cited inline). This is the most authoritative evidence
on this machine: it is code that actually runs against the Host today.

**(b) Installed SDK surface.** Two different installs exist and they do **not** agree:

- Packaged Desktop app: `/Applications/DSH Desktop.app/Contents/Resources/app/node_modules/@deepseek-ai/`
  — 313 `@deepseek-ai/*` packages, all at **0.2.1-rc.2** (`dsh-session`, `dsh-agent`, `dsh-compaction`,
  `dsh-user-approval`, `dsh-jobs`, `dsh-client-ui-tool` all report 0.2.1-rc.2). **It ships JavaScript only**:
  `dsh-session/lib/types/` contains `fork.js`, `index.js`, `repair.js`, … and **no `.d.ts`** — production
  bundles are stripped of declarations.
- Repo devDependencies (`pnpm-lock.yaml`): **0.2.1-rc.5**, which *do* ship `.d.ts`. Type-level evidence below
  therefore cites `node_modules/@deepseek-ai/*/lib/types/*.d.ts` at 0.2.1-rc.5, i.e. the contract this repo
  compiles against; `package.json` peer range is `>=0.2.0-rc.2 <0.2.2`, so both installs are in range.

*Caveat recorded from this stage:* on 2026-11-10 the repo's `node_modules` was relocated to
`../fusion-next-node_modules` and replaced by a symlink. Under that layout `ToolCallViewProps` (from
`@deepseek-ai/dsh-client-ui-tool/client`) evaluates to `any` (probe: assigning it to a literal type produces
no error), which is why `pnpm run typecheck` currently reports 2 implicit-any errors in `src/client/`. That is
a resolution/layout effect, not a code defect, and it is why this audit leans on (a) and (c).

**(c) Deployment contract** — `dshx.yml`, `cordis.patch.yml`, `profiles/fusion-auto.example.json`, `README.md`.

## Capability table

| # | Capability | Verdict | Evidence |
|---|---|---|---|
| 1 | Model selection change events / interception | `available-with-caveats` | Plugin observes selection as session events (`src/host/native-selection.ts:78`) and agent status (`:85`), and intercepts the request path (`:94` `ctx.on('agent/request', …)`). SDK models selection as a **plugin-owned mutable ref**, not a Host event: `ModelSelectionRef {current, assembled}` + `installModelSelection()` (`node_modules/@deepseek-ai/dsh-agent/lib/types/model-selection.d.ts:25,49`). Host API has a `selectModel()` command (`@deepseek-ai/dsh-api-session-controller/lib/types/index.d.ts:107`) but no "selection will change" hook. |
| 2 | Session create / open / fork events or APIs | `available-with-caveats` | `ctx.on('session/created')` (`src/benchmark/native-run.ts:116`); `ctx.sessions.list()` + `header.parentSession` for lineage (`src/host/native-activity.ts:103,148`). SDK: `SessionStore.fork(source, boundary?, childSessionId?)` (`dsh-session/lib/types/index.d.ts:513`), `buildForkSeed()` (`.../fork.d.ts:17`), classified `SessionForkError` (`index.d.ts:364-368`). Caveat: fork needs a **live** source and always mints a new id, so a fork branch arrives without a Fusion binding; there is no `session/forked` event to subscribe to. |
| 3 | Session history read | `available-with-caveats` | In-process replay: `session/event` (`src/host/native-activity.ts:95`), `ctx.sessions.get()` for seq anchoring (`:117`), plus the plugin's own durable projections (`src/host/history.ts:27,58` backfill/read). SDK: `Session.snapshotEvents()` (`dsh-session/lib/types/index.d.ts:224`) and `deriveMessages()` (`:347`). Caveat: history outside the live store is only reachable through the Host's cold-read paths (fork/resume), not a generic archive API. |
| 4 | Agent/session create + message injection | `available` | `ctx.agents.create({ sessionId, … })` used by the benchmark harness (`src/benchmark/native-run.ts:108`); SDK `AgentRegistry.create/resume` (`dsh-agent/lib/types/index.d.ts:278,286`) and `AgentFactory.createAgent()` (`:172`) with `CreateAgentOptions.meta/seed/parentAgent` (`:48-84`). Message injection: user messages are built with `createUserMessage` (`src/host/native-model-control.ts:6`) and the plugin reads the queued turn from `agent.inbox.nextTurn[0]` (`src/host/coordinator.ts:679`). |
| 5 | Compaction control | `available-with-caveats` | Plugin installs a routing hook: `ctx.inject(['compactionRoutes'], …)` (`src/host/compaction-routing.ts:27`) and only reacts when `request.purpose === 'compaction'` (`src/host/native-compaction.ts:12`). SDK: `ctx.compaction.compactIfNeeded/compactNow/compactRegion` (`dsh-compaction/lib/types/index.d.ts:116,137,157`), `CompactionCheckpointSource` (`:18-23`). Caveat: the Host owns the compaction transaction; the plugin can pick the route/model but cannot drive or undo the transaction, and checkpoints carry no model affinity. |
| 6 | Tool-call effect observation & approval flow | `available-with-caveats` | Effect observation: `ctx.on('tools/execute')` (`src/host/native-effects.ts:51`), `tools/pre-execute` (`src/host/native-approvals.ts:53`), `tools/result` (`:92`), and `approval/request` (`:70`). SDK approval: `ApprovalService.request()` returning only `'allowed-once'` (`dsh-user-approval/lib/types/index.d.ts:135`), policies `'ask' | 'never'` (`:56`), `setApprovalPolicy` (`:63`) / `setPolicy` (`:116`); it **requires an open turn** (`:118-132`) and covers tool calls only. `JobRegistry` gives in-process job lifecycle (`dsh-jobs/lib/types/index.d.ts:59,71,128,137`); recovery codes `TOOL_NOT_STARTED` / `TOOL_OUTCOME_UNKNOWN` (`dsh-session/lib/types/repair.d.ts:9,11`). Caveat: no idempotency ledger — D01 must be built in-plugin. |
| 7 | Scope install / detach | `available` | `install(agent, binding, role)` and `detach(agent)` in the plugin's own scope manager (`src/host/native-scopes.ts:58,194`), installed per binding and re-entered on agent switch (`:64`). |
| 8 | Worker/model routing control | `available-with-caveats` | Route resolution is plugin-held per binding/role: `route(binding, role)` (`src/host/native-model-control.ts:120`), driven by `session/event` watchers in the coordinator (`src/host/coordinator.ts:551,558,567`). Caveat: no Host-side generation/fencing — a stale callback can still land, so D02's fencing must be plugin-side. |
| 9 | Keepalive | `available` | `NativeCacheKeepalive` (`src/host/native-keepalive.ts:88`) with `stopSession()` (`:141`), driven by `llm/stream` (`:207,229,238`), `session/event` (`:275`), `agent/status` (`:283`). |
| 10 | node:sqlite persistence | `available-with-caveats` | `import { DatabaseSync } from 'node:sqlite'` (`src/task/sqlite-store.ts:4`), opened at `:23`; schema in `contracts/storage.sql`. Caveat: Node-version dependent (needs ≥22.5; scripts run on the Desktop runtime's Node 24.18.1 here) and the plugin owns all migration/WAL policy itself. |
| 11 | Client UI (web entry) registration | `available` | `apply(ctx)` registers slot contributions: `ctx.slots.inject('tool.call.toolview', …)` (`src/client/index.ts:18`) → `ctx.slots.register(..., FusionTool)` (`:19`), settings section and `conversation.input.dock` (`:22-30`); declared as a client plugin in `dshx.yml:1-4` (`kind: client`, `profile: web`) and `package.json` `dsh.client`. |

Count by verdict: **available 4** (#4, #7, #9, #11) · **available-with-caveats 7** (#1, #2, #3, #5, #6, #8, #10) · **needs-host-extension 0** · **unavailable 0**. The zeroes are deliberate: every capability the plan needs has *some* host surface; what is missing is transactional/fenced semantics, which is exactly what A04 must decide whether to extend the Host for or carry in-plugin.

## Plan §1 declared-unknowns — what this machine can and cannot settle

| Unknown | Status here | Why |
|---|---|---|
| Does a Host fork clone model/selection state into the child? | **Unverifiable** | `fork()` documentation states a seed + header are copied, and `header.parentSession`/`isSeeded` are durable (`dsh-session/lib/types/index.d.ts:513`, `types.d.ts:110,140`), but the app bundle ships no source or declarations (JS only) and no `DSHX_HARNESS` checkout exists, so the runtime event sequence of a fork cannot be observed. `src/host/bindings.ts` keys bindings by session id (`:43-52`), so whatever the Host does, the plugin currently sees a new id with no binding. |
| Are Agent instances reused across fork / model switch? | **Unverifiable at runtime; constrained by API** | The SDK only exposes `create`/`resume` (`dsh-agent/lib/types/index.d.ts:278,286`); there is no "rebind live agent to another model" call, so a switch is either a selection mutation (`model-selection.d.ts:25`) or a new AgentHandle. |
| Interruption/creation ordering (what wins when the user interrupts while a fork or switch is in flight)? | **Unverifiable** | Requires A02's replayable Host fixture; the type surface shows only ordered awaits (`AgentFactory.createAgent` doc at `dsh-agent/lib/types/index.d.ts:150-170`), not turn-level ordering guarantees. |

Settling these three requires a `DSHX_HARNESS` source checkout (the same prerequisite that blocks
`pnpm run test:host` and `pnpm run build`, see `benchmark/baselines/a01-baseline-receipt.md` §5). Until then
A02 must not claim runtime behaviour from this document.
