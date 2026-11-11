# DSH SDK capability audit (plan row A03)

Scope: the capabilities the Fusion-Next plan needs from the DSH Host SDK, one row per capability, with a
verdict and the file:line evidence actually read. Supersedes `docs/A03-SDK-CAPABILITY.md` (removed here;
see history) with a broader row set and a stricter evidence rule.

Verdict vocabulary: `available` / `available-with-caveats` / `needs-host-extension` / `unavailable`.

## Evidence sources and their limits

**(a) This plugin's own Host-API integration** — `src/**` (cited inline). These are concrete
integration implementations, **not proof that the packaged Host runs them or guarantees their behaviour**.
A source call site establishes what the plugin attempts, not a successful Host integration test.

**(b) Installed SDK surface.** Two different installs exist and they do **not** agree:

- Packaged Desktop app: `/Applications/DSH Desktop.app/Contents/Resources/app/node_modules/@deepseek-ai/`
  — **313 package directories**, of which **300** declare `0.2.1-rc.2` and **13** declare other versions:
  `cordis` (4.0.5), `cordis-plugin-group` (1.0.5), `cordis-plugin-include` (1.0.10),
  `cordis-plugin-loader` (1.0.6), `cordis-plugin-timer` (1.1.7), `cosmokit` (1.8.6),
  `libreoffice-kit` and its two platform packages (0.1.5), `node-addon-system` and its two
  platform packages (0.1.2), and `schemastery` (3.18.5). The sampled Desktop
  `dsh-session/lib/types/` contains compiled `.js` but no `.d.ts`; **this is a statement about
  that inspected package, not every Desktop package**. Compiled JS is available for static review,
  but no packaged-Host runtime fixture was executed here.
- Repo `package.json:77-100` and lockfile pin relevant DSH SDK dependencies to **0.2.1-rc.5**;
  installed `node_modules/@deepseek-ai/*/lib/types/*.d.ts` is rc.5 **type-level evidence**, not a
  runtime guarantee for Desktop rc.2. The declared peer range `>=0.2.0-rc.2 <0.2.2`
  (`package.json`, `peerDependencies`) admits both prerelease versions syntactically; **a semver
  range does not establish behavioural compatibility between rc.2 and rc.5**.

*Historical environment note:* in this worktree `node_modules` is a symlink to the absolute path
`/Users/baozipai/Documents/dsh/fusion-next-node_modules` (`benchmark/baselines/a01-baseline-receipt.md:256-262`).
Before A01 commit `a686569`, typecheck exited **2** with two `TS7006` diagnostics in
`src/client/FusionTool.tsx:51` and `src/client/index.ts:27`; the cause was unresolved transitive
SDK declarations across that external symlink. A01 added explicit declaration paths in `tsconfig.json`;
its **current** `pnpm run typecheck` exited **0** (`benchmark/baselines/a01-baseline-receipt.md:258-266`).
Do not present the earlier failure as the current gate state.

**(c) Deployment contract** — `dshx.yml`, `cordis.patch.yml`, `profiles/fusion-auto.example.json`, `README.md`.

## Capability table

| # | Capability | Verdict | Evidence |
|---|---|---|---|
| 1 | Model selection change events / interception | `available-with-caveats` | Plugin observes selection as session events (`src/host/native-selection.ts:78`) and agent status (`:85`), and intercepts the request path (`:94` `ctx.on('agent/request', …)`). SDK models selection as a **plugin-owned mutable ref**, not a Host event: `ModelSelectionRef {current, assembled}` + `installModelSelection()` (`node_modules/@deepseek-ai/dsh-agent/lib/types/model-selection.d.ts:25,49`). The inspected rc.5 session-controller types expose `selectModel()` (`node_modules/@deepseek-ai/dsh-api-session-controller/lib/types/index.d.ts:107`); these excerpts alone do not establish a dedicated pre-change Host hook or its absence. |
| 2 | Session create / open / fork events or APIs | `available-with-caveats` | `ctx.on('session/created')` (`src/benchmark/native-run.ts:116`); `ctx.sessions.list()` + `header.parentSession` for lineage (`src/host/native-activity.ts:103,148`). SDK: `SessionStore.fork(source, boundary?, childSessionId?)` (`dsh-session/lib/types/index.d.ts:513`), `buildForkSeed()` (`.../fork.d.ts:17`), classified `SessionForkError` (`index.d.ts:364-368`). Caveat: the documented fork requires a **live** source, accepts an **explicit** `childSessionId` or otherwise uses the store's id policy (`dsh-session/lib/types/index.d.ts:498-513`); it does not promise inheriting the source id. Fusion bindings are keyed by exact session id (`src/host/bindings.ts:43-59`), so a different child id does not automatically match the source binding. No dedicated `session/forked` event was found in the inspected plugin hooks; that is not proof the Host offers none. |
| 3 | Session history read | `available-with-caveats` | In-process replay: `session/event` (`src/host/native-activity.ts:95`), `ctx.sessions.get()` for seq anchoring (`:117`), plus the plugin's own durable projections (`src/host/history.ts:27,58` backfill/read). SDK: `Session.snapshotEvents()` (`dsh-session/lib/types/index.d.ts:224`) and `deriveMessages()` (`:347`). Caveat: the cited plugin paths demonstrate live-session observation and its own durable projection; they do not establish all Host cold-read/archive entry points. |
| 4 | Agent/session create + message injection | `available` | `ctx.agents.create({ sessionId, … })` used by the benchmark harness (`src/benchmark/native-run.ts:108`); SDK `AgentRegistry.create/resume` (`dsh-agent/lib/types/index.d.ts:278,286`) and `AgentFactory.createAgent()` (`:172`) with `CreateAgentOptions.meta/seed/parentAgent` (`:48-84`). Message injection is **implemented, not merely read**: after constructing a user message (`src/host/native-model-control.ts:235-240`), the plugin calls `agent.send(message, 'next-turn', true)` and checks for an `agent/inbox/spliced` acknowledgement (`src/host/native-model-control.ts:251-259`). Another path reads `agent.inbox.nextTurn[0]` (`src/host/coordinator.ts:679`); neither source path alone proves a packaged-Host delivery guarantee. |
| 5 | Compaction control | `available-with-caveats` | Plugin installs a routing hook: `ctx.inject(['compactionRoutes'], …)` (`src/host/compaction-routing.ts:27`) and only reacts when `request.purpose === 'compaction'` (`src/host/native-compaction.ts:12`). SDK: `ctx.compaction.compactIfNeeded/compactNow/compactRegion` (`dsh-compaction/lib/types/index.d.ts:116,137,157`), `CompactionCheckpointSource` (`:18-23`). Caveat: `compactNow()` and `compactRegion()` **exist as explicit SDK APIs**, with busy/span/transaction constraints (`dsh-compaction/lib/types/index.d.ts:118-157`); do not describe compaction as impossible to initiate through the SDK. This plugin's inspected implementation registers route selection (`src/host/compaction-routing.ts:27-42`) and modifies eligible `llm/stream` requests (`src/host/native-compaction.ts:10-33`), **not** an owned compaction transaction. Host transaction/commit ownership does not imply plugin control over transaction lifecycle or rollback; checkpoint model affinity is not established by these sources. |
| 6 | Tool-call effect observation & approval flow | `available-with-caveats` | Effect observation: `ctx.on('tools/execute')` (`src/host/native-effects.ts:51`), `tools/pre-execute` (`src/host/native-approvals.ts:53`), `tools/result` (`:92`), and `approval/request` (`:70`). SDK approval: `ApprovalService.request()` returning only `'allowed-once'` (`dsh-user-approval/lib/types/index.d.ts:135`), policies `'ask' | 'never'` (`:56`), `setApprovalPolicy` (`:63`) / `setPolicy` (`:116`); it **requires an open turn** (`:118-132`) and covers tool calls only. `JobRegistry` gives in-process job lifecycle (`dsh-jobs/lib/types/index.d.ts:59,71,128,137`); recovery codes `TOOL_NOT_STARTED` / `TOOL_OUTCOME_UNKNOWN` (`dsh-session/lib/types/repair.d.ts:9,11`). Caveat: no idempotency ledger — D01 must be built in-plugin. |
| 7 | Scope install / detach | `available` | `install(agent, binding, role)` and `detach(agent)` in the plugin's own scope manager (`src/host/native-scopes.ts:58,194`), installed per binding and re-entered on agent switch (`:64`). |
| 8 | Worker/model routing control | `available-with-caveats` | Route resolution is plugin-held per binding/role: `route(binding, role)` (`src/host/native-model-control.ts:120`), driven by `session/event` watchers in the coordinator (`src/host/coordinator.ts:551,558,567`). Caveat: no Host-side generation/fencing — a stale callback can still land, so D02's fencing must be plugin-side. |
| 9 | Keepalive | `available` | `NativeCacheKeepalive` (`src/host/native-keepalive.ts:88`) with `stopSession()` (`:141`), driven by `llm/stream` (`:207,229,238`), `session/event` (`:275`), `agent/status` (`:283`). |
| 10 | node:sqlite persistence | `available-with-caveats` | `import { DatabaseSync } from 'node:sqlite'` (`src/task/sqlite-store.ts:4`), opened at `:23`; schema in `contracts/storage.sql`. Caveat: Node-version dependent (the plugin's recorded npm scripts use Node 24.18.1: `benchmark/baselines/a01-baseline-receipt.md:29-35`). **WAL is already configured** by `PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL` (`src/task/sqlite-store.ts:38`), together with version checks and version-1 schema creation (`src/task/sqlite-store.ts:25-38`). Remaining concern is **schema migration and backward/forward compatibility**, including explicit rejection of unknown or nonempty unversioned stores (`src/task/sqlite-store.ts:26-30`), not missing WAL policy. |
| 11 | Client UI (web entry) registration | `available` | `apply(ctx)` registers slot contributions: `ctx.slots.inject('tool.call.toolview', …)` (`src/client/index.ts:18`) → `ctx.slots.register(..., FusionTool)` (`:19`), settings section and `conversation.input.dock` (`:22-30`); declared as a client plugin in `dshx.yml:1-4` (`kind: client`, `profile: web`) and `package.json` `dsh.client`. |

Count by verdict: **available 4** (#4, #7, #9, #11) · **available-with-caveats 7** (#1, #2, #3, #5, #6, #8, #10) · **needs-host-extension 0** · **unavailable 0**. These are **source/type-surface classifications**, not an rc.2 Host-runtime compatibility certification: existing plugin integration points, and even rc.5 declarations, do not prove that the packaged Host guarantees them. Transactional/fenced semantics still need A04's explicit Host-versus-plugin ownership decision.

## Plan §1 declared-unknowns — what this machine can and cannot settle

| Unknown | Status here | Why |
|---|---|---|
| Does a Host fork clone model/selection state into the child? | **Unverifiable** | The rc.5 `SessionStore.fork(source, boundary?, childSessionId?)` declaration documents copied prefix events and an optional explicit child id (`dsh-session/lib/types/index.d.ts:498-513`); `header.parentSession`/`isSeeded` appear in `dsh-session/lib/types/types.d.ts:110,140`. This does **not** specify whether model-selection state follows the fork. Desktop `dsh-session` compiled JS could be statically inspected, but neither an rc.2 runtime fixture nor a compatible `DSHX_HARNESS` checkout was used (`benchmark/baselines/a01-baseline-receipt.md:148-172`). Fusion binding lookup is session-id keyed (`src/host/bindings.ts:43-59`); a different child id has no **automatic** source-binding lookup in that code, regardless of how the child id was chosen. |
| Are Agent instances reused across fork / model switch? | **Unverifiable at runtime; constrained by API** | The inspected rc.5 `AgentRegistry` exposes `create`/`resume` (`dsh-agent/lib/types/index.d.ts:278,286`), and `ModelSelectionRef` is mutable (`dsh-agent/lib/types/model-selection.d.ts:25`). These signatures do not establish actual rc.2 Host agent reuse, replacement, or model-switch timing; no exhaustive Host API absence claim follows from these excerpts. |
| Interruption/creation ordering (what wins when the user interrupts while a fork or switch is in flight)? | **Unverifiable** | Requires A02's replayable Host fixture; the type surface shows only ordered awaits (`AgentFactory.createAgent` doc at `dsh-agent/lib/types/index.d.ts:150-170`), not turn-level ordering guarantees. |

Settling these three requires runtime evidence against the targeted Host (for example, A02's
replayable Host fixture). A compatible `DSHX_HARNESS` source checkout is a prerequisite for this repo's
`pnpm run test:host` and `pnpm run build` (`benchmark/baselines/a01-baseline-receipt.md:148-172`);
compiled Desktop JS can still be statically reviewed without it. **Neither Host command was run for
this document correction**. Do not infer unobserved Host behaviour or rc.2/rc.5 compatibility from this audit.
