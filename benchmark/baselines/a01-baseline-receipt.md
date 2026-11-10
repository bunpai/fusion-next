# A01 Baseline Receipt — dsh-model-fusion @ 8f97428

Plan: `DSH-Fusion-Next-Full-Implementation-Plan.md` §13 row **A01** ("锁定基线提交、构建/单测/Host 测试、记录环境及版本"), plus §16 ("基线测试必须先锁定具体 Node/Host 版本，并将完整输出与退出码保存为测试收据").

**结论 (one line):** 基线提交已锁定、依赖已按 lockfile 安装；单测全绿（47 files / 393 tests）；**typecheck 在基线提交上不通过**（13 个 TS 错误，均为测试文件隐式 any）；`test:host` 与 `build` 因本机缺少兼容的 DSH Host 源码检出而无法执行（真实报错已留原始日志）。原始输出一律保留，未做任何修复或美化。

- Run date: **2026-11-10** (Asia/Shanghai, CST/UTC+8); UTC timestamps are embedded in each raw log header.
- Repo: `/Users/baozipai/Documents/dsh/fusion-next-source-review` (= `dsh-model-fusion`, remote `github.com/aa2246740/dsh-model-fusion`).
- HEAD at start **and** at end of every command: `8f97428754cd950a2aa8abf31e36d1409264cb9e`
  (`8f97428 fix(turns): keep mixed commands open and complete explanation-only questions`, committed 2026-11-03 18:37:33 +0800).
- Working tree before the run: `git status --porcelain` **empty**. After the run the only untracked path is `benchmark/baselines/` (this receipt + logs); `node_modules/` is gitignored.
- Package under test: `dsh-model-fusion` version **0.2.11**, `packageManager: pnpm@9.15.9`.

## 1. Environment (pinned)

| Item | Value |
|---|---|
| OS | macOS 26.5.1 (build 25F80), arm64 (Apple Silicon) |
| Shell Node (login shell, `node -v`) | **v22.21.1** (nvm, `~/.nvm/versions/node/v22.21.1`) |
| Node actually running the npm scripts | **v24.18.1** — see note below |
| pnpm used | **9.15.9** (matches `packageManager`), via the DSH Desktop bundled pnpm (`pnpm -v` → 9.15.9) |
| typescript (installed, lockfile-pinned) | **5.9.3** |
| vitest (installed, lockfile-pinned) | **4.1.11** |
| @types/node | **22.20.4** |
| DSH Host source checkout (`DSHX_HARNESS`) | **unset / none available** — see §5 |

Notes on the toolchain (verified, not assumed):

- `pnpm` on PATH resolves to the DSH Desktop runtime shim
  (`~/Library/Application Support/DSH Desktop/runtime-commands/generations/<gen>/bin/pnpm`), which execs the
  bundled `pnpm 9.15.9`. `pnpm -v` → `9.15.9`, i.e. exactly the version pinned by `package.json#packageManager`.
- That shim runs scripts through Electron-as-node, so **`pnpm run <script>` executes under Node v24.18.1**
  while `node -v` in a plain shell is v22.21.1. Verified with `pnpm exec node -v` → `v24.18.1`
  (`pnpm exec which node` → `.../DSH Desktop/runtime-commands/generations/<gen>/private/node-bin/node`).
  The `Node.js v24.18.1` line in `build.log` is this runtime, not a stray Node.
  `engines.node` is `>=22.14.0`, so both versions satisfy the declared floor.
- `corepack pnpm@9.15.9 install --frozen-lockfile` **could not be used**: corepack tried to download the
  pinned pnpm into `~/.cache/node/corepack/...` and the sandbox denied the write:
  `Error: EPERM: operation not permitted, mkdir '/Users/baozipai/.cache/node/corepack/v1/corepack-...'`
  (`code: 'EPERM', syscall: 'mkdir'`). The fallback was the bundled pnpm 9.15.9 above — same
  major/minor/patch as `packageManager`, so the install is still a locked, pinned install, not an ad-hoc one.
- Registry reachability: `https://registry.npmjs.org/vitest` → HTTP 200 direct (3.3 s), 200 via
  `http://127.0.0.1:7897` (4.9 s). No proxy env was needed for the install; no proxy was set for any command.

## 2. Install

| Field | Value |
|---|---|
| Command | `pnpm install --frozen-lockfile` |
| pnpm | 9.15.9 (DSH Desktop bundled) |
| Exit code | **0** |
| Result | `Lockfile is up to date, resolution step is skipped` → `Packages: +174` → `Done in 2.3s using pnpm v9.15.9` |
| Lockfile changed? | **No** — `pnpm-lock.yaml` untouched (`git status --porcelain` shows only `benchmark/baselines/`). |

`pnpm-lock.yaml` was **not** edited; `--frozen-lockfile` succeeded on the unmodified lockfile.

## 3. Command results

| # | Command (exact) | Exit | Result | Raw log |
|---|---|---|---|---|
| 1 | `pnpm run typecheck` | **2** | FAIL — 13 TS errors, all implicit `any` in 5 test files | `benchmark/baselines/logs/typecheck.log` |
| 2 | `pnpm run test` | **0** | PASS — `Test Files 47 passed (47)` / `Tests 393 passed (393)`, 0 failed, 0 skipped | `benchmark/baselines/logs/unit-test.log` |
| 3 | `pnpm run test:host` | **1** | BLOCKED — startup error, `DSHX_HARNESS` not set | `benchmark/baselines/logs/host-test.log` |
| 4 | `pnpm run build` | **1** | BLOCKED — `Set DSHX_HARNESS ...`, no Host checkout | `benchmark/baselines/logs/build.log` |

Commands 3 and 4 are recorded as **not executed (blocked by missing prerequisite)**, never as passed.

## 4. Per-command detail

### 4.1 `pnpm run typecheck` — exit 2 (FAIL)

Actual script: `tsc -p tsconfig.json --noEmit` (tsconfig: `strict: true`, `skipLibCheck: true`, `preserveSymlinks: true`, `noEmit`, includes `src`, `tests`, `contracts/fusion.ts`).

13 errors, by file:

| File | Errors |
|---|---|
| `tests/direct-turn.spec.ts` | 6 |
| `tests/exploration.spec.ts` | 4 |
| `tests/link-host.spec.ts` | 1 |
| `tests/native-promoted-job.spec.ts` | 1 |
| `tests/native-usage-lifecycle.spec.ts` | 1 |

Verbatim last line of the run: ` ELIFECYCLE  Command failed with exit code 2.`

Representative raw lines (full set in `logs/typecheck.log`):

```
tests/direct-turn.spec.ts(6,41): error TS7006: Parameter 'text' implicitly has an 'any' type.
tests/direct-turn.spec.ts(130,65): error TS7031: Binding element 'prompt' implicitly has an 'any' type.
tests/exploration.spec.ts(34,50): error TS7006: Parameter 'source' implicitly has an 'any' type.
tests/link-host.spec.ts(40,97): error TS7006: Parameter 'version' implicitly has an 'any' type.
tests/native-promoted-job.spec.ts(49,77): error TS7006: Parameter 'shell' implicitly has an 'any' type.
tests/native-usage-lifecycle.spec.ts(26,110): error TS7006: Parameter 'mode' implicitly has an 'any' type.
```

Characterisation (observation only, **nothing was fixed or skipped** in this stage):

- All 13 are `TS7006`/`TS7031` implicit-`any` on callback parameters of test helpers — mostly the
  `it.each([...])('...', param => ...)` pattern (e.g. `tests/direct-turn.spec.ts:5-7`) whose parameter
  inference collapses to `any` under `strict`, plus mock/`vi.fn` style callbacks.
- Every error is in `tests/**`; `src/**` and `contracts/fusion.ts` produced no diagnostics.
- This is reproducible from the locked toolchain (`typescript@5.9.3`, `vitest@4.1.11`,
  `@types/node@22.20.4` are the versions pinned by `pnpm-lock.yaml`), so the failure is a property of the
  baseline commit plus its lockfile, not of an un-pinned install.
- CI does not gate this: `.github/workflows/publish.yml` runs only `pnpm install --frozen-lockfile`,
  `pnpm run build`, `pnpm test` — there is no `typecheck` step. That is consistent with the breakage
  having landed unnoticed on the baseline commit.

### 4.2 `pnpm run test` — exit 0 (PASS)

Vitest summary lines, verbatim:

```
 Test Files  47 passed (47)
      Tests  393 passed (393)
   Start at  21:59:51
   Duration  2.05s (transform 2.15s, setup 0ms, import 3.65s, tests 4.41s, environment 3ms)
```

Counts: **passed 393, failed 0, skipped 0, todo 0** across **47 test files**. The failing-file list for the
unit suite is therefore empty — no baseline unit failure to preserve.

### 4.3 `pnpm run test:host` — exit 1 (BLOCKED, prerequisite missing)

Actual script: `vitest run --config vitest.host.config.mts`. Real output:

```
failed to load config from /Users/baozipai/Documents/dsh/fusion-next-source-review/vitest.host.config.mts

 Startup Error
Error: Native Host tests require DSHX_HARNESS pointing at the pinned checkout
```

then `ELIFECYCLE  Command failed with exit code 1.` `DSHX_HARNESS` was `<unset>`.

### 4.4 `pnpm run build` — exit 1 (BLOCKED, prerequisite missing)

Actual script: `node scripts/build.mjs`. Real output:

```
Error: Set DSHX_HARNESS to the explicit checkout used for this build
    at file:///Users/baozipai/Documents/dsh/fusion-next-source-review/scripts/build.mjs:9:18
Node.js v24.18.1
 ELIFECYCLE  Command failed with exit code 1.
```

## 5. Host checkout limitation (verified on this machine)

Both `vitest.host.config.mts` and `scripts/build.mjs` hard-require `DSHX_HARNESS` pointing at a **source**
checkout of the DSH Host:

- `vitest.host.config.mts:8` — `if (!host) throw new Error('Native Host tests require DSHX_HARNESS pointing at the pinned checkout')`, then reads `resolve(host, 'tsconfig.base.json')`, imports `vitest.shared.ts`, aliases `packages/core/agent-loop/tests/mock-adapter.ts` and `packages/subagent/subagent/tests/test-session-query.ts`.
- `scripts/build.mjs:9-16` — requires `resolve(host, 'tsconfig.base.json')`, `resolve(host, 'tools/dshx/src/client-build.js')` (hard `existsSync` check → `Missing dshx client build adapter`), `resolve(host, 'package.json')` resolvable `tsdown`, and `packages/core/agent/package.json` whose version must be `0.2.0-rc.2`, any `0.2.1-rc.*`, or any `0.2.x`.

Verification actually performed on 2026-11-10 (read-only):

| Candidate path | `tsconfig.base.json` | `packages/core/agent/package.json` | `tools/dshx/src/client-build.js` | Verdict |
|---|---|---|---|---|
| `/Users/baozipai/dsh/current` (= `/Users/baozipai/dsh/releases/0.1.6-alpha.2`, `@deepseek-ai/dsh-root` **0.1.6-alpha.2**) | yes | yes | **no** | **incompatible on two counts**: missing dshx adapter and Host version 0.1.6-alpha.2 is outside the supported `0.2.0-rc.2 / 0.2.1-rc.* / 0.2.x` range |
| `/Users/baozipai/WorkBuddy/2026-08-14-08-35-05/deepseek-harness` | yes | yes | **no** | incompatible: missing dshx adapter |

`find /Users/baozipai -maxdepth 6 -name client-build.js -not -path "*/node_modules/*"` → **no matches**.
The only other DSH on the machine is the packaged Desktop app (`/Applications/DSH Desktop.app/.../Resources/app`,
build output with `node_modules`, not a source checkout). `DSHX_HARNESS` is unset and no value is baked into
`.npmrc`, `dshx.yml` or the environment.

**Limitation, stated plainly:** no compatible DSH Host source checkout exists on this machine, so
`pnpm run test:host` and `pnpm run build` cannot be executed here. As instructed, no fake checkout was
created and no `DSHX_HARNESS` was pointed at an incompatible tree; the genuine startup errors are the
receipt. Baseline Host/build verification remains **unverified** and must be re-run on a machine with a
DSH 0.2.1-rc.* source checkout.

## 6. Raw logs

All under `benchmark/baselines/logs/`; each file starts with a `#` header recording the exact command,
`node -v`, `pnpm -v`, `cwd` and the UTC start time, and ends with `EXIT_CODE=<n>`:

| File | Contents |
|---|---|
| `logs/install.log` | `pnpm install --frozen-lockfile`, exit 0 |
| `logs/typecheck.log` | `pnpm run typecheck`, exit 2, all 13 TS errors |
| `logs/unit-test.log` | `pnpm run test`, exit 0, full per-file vitest listing + summary |
| `logs/host-test.log` | `pnpm run test:host`, exit 1, startup error + stack |
| `logs/build.log` | `pnpm run build`, exit 1, error + stack |

## 7. Reproduction

```bash
cd /Users/baozipai/Documents/dsh/fusion-next-source-review
git rev-parse HEAD                       # 8f97428754cd950a2aa8abf31e36d1409264cb9e
git status --porcelain                   # empty before the run
pnpm install --frozen-lockfile           # exit 0
pnpm run typecheck                       # exit 2  (baseline failure, see 4.1)
pnpm run test                            # exit 0  (47 files / 393 tests)
pnpm run test:host                       # exit 1  (blocked: DSHX_HARNESS)
pnpm run build                           # exit 1  (blocked: DSHX_HARNESS)
```

## 8. Gate status for A01

| A01 acceptance item | Status | Evidence |
|---|---|---|
| Baseline commit locked (`8f97428`, tree clean) | **met** | §1, `git status --porcelain` empty |
| Dependencies installed from the frozen lockfile, versions recorded | **met** | §2, `logs/install.log` |
| Unit tests run, full output + exit code kept, original failures preserved | **met — green** (393/393) | §4.2, `logs/unit-test.log` |
| Host tests run | **not met — blocked**, prerequisite checkout absent | §4.3/§5, `logs/host-test.log` |
| Build run | **not met — blocked**, prerequisite checkout absent | §4.4/§5, `logs/build.log` |
| Environment and versions recorded | **met** | §1 |
| Baseline typecheck green (`a01-typecheck`) | **not met — fails at baseline** (exit 2, 13 errors in 5 test files) | §4.1, `logs/typecheck.log` |

Open items for the Lead (out of scope for A01, not fixed here):

1. `pnpm run typecheck` is red on `8f97428` (13 implicit-`any` diagnostics in `tests/direct-turn.spec.ts`, `tests/exploration.spec.ts`, `tests/link-host.spec.ts`, `tests/native-promoted-job.spec.ts`, `tests/native-usage-lifecycle.spec.ts`). Either the gate is repaired in a later stage or the A01 acceptance baseline is amended — this receipt records the failure as found.
2. Host tests and build need a DSH `0.2.1-rc.*` source checkout; they are unverified on this machine.

## 9. Stage-2 addendum — typecheck repair (2026-11-10, after the baseline commit)

Everything above is the **baseline as found at `8f97428`** and stays true as history: at that commit
`pnpm run typecheck` exits 2. The gate was then repaired in a separate commit, `9e2df6e`
(`fix(types): restore real SDK typing in the A01 typecheck gate`).

**Root cause (verified, not guessed).** `tsconfig.json` set `"preserveSymlinks": true`. Under pnpm's
symlinked store that stops TypeScript from following the transitive `.d.ts` imports inside `vitest` and
`@deepseek-ai/dsh-*`; with `"skipLibCheck": true` the failed resolution inside those library declarations is
swallowed, every imported symbol degrades to `any`, and the only visible symptom is implicit-`any` in the
`.each(...)` callbacks. Evidence:

- `pnpm exec tsc -p tsconfig.json --noEmit --preserveSymlinks false` (a CLI override, no file changes)
  returned **exactly one** error: `src/host/coordinator.ts(669,43): error TS2345: Argument of type
  'number | undefined' is not assignable to parameter of type 'SessionLogOffset | undefined'` — and **zero**
  errors in `tests/**`.
- Dropping the flag in `tsconfig.json` alone made all 13 test errors disappear **without editing any test
  file**, which is only possible if the tests had been untyped (`any`) rather than wrongly typed.
- Implication worth recording: until this repair, the typecheck gate was effectively blind to the whole
  DSH SDK contract (every `@deepseek-ai/dsh-*` type was `any`).

**Changes, all confined to that commit:**

| File | Change | Why |
|---|---|---|
| `tsconfig.json` | removed `"preserveSymlinks": true` | let typecheck resolve the real dependency types |
| `tsconfig.build.json` | added `"preserveSymlinks": true` | keep the declaration-emit path exactly as the shipped 0.2.11 build had it |
| `src/host/native-task-context.ts` | `begin(..., firstSeq: number = agent.session.seq)` | the only genuine error the restored types surfaced: callers and the stored `Origin.firstSeq` use a plain number, and the branded `SessionLogOffset` is assignable to `number`; runtime behaviour is unchanged |

**Verification after the repair:**

| Command | Exit | Result |
|---|---|---|
| `pnpm run typecheck` | **0** | no diagnostics (previously 2) |
| `pnpm run test` | **0** | `Test Files 47 passed (47)` / `Tests 393 passed (393)` — unchanged |

`pnpm run test:host` and `pnpm run build` remain **blocked** exactly as in §4.3/§4.4/§5 (no compatible
`DSHX_HARNESS` checkout on this machine); nothing in this repair changes them.
