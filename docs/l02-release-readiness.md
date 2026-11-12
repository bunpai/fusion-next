# L02 发布就绪清单（Release Readiness）

状态基线：commit 前全量 `pnpm run typecheck` 0 错误；`pnpm exec vitest run --configLoader runner` 80 文件 / 609 用例全部通过（本地 workspace-write 环境）。本文件区分**已验证（本地可复现）**与**未验证（需要真实 Host / 真实 Provider，当前环境无法执行）**两类，遵循计划 §15「不发布未经验证的成功」。

## 1. 已验证项（本地可复现）

### 1.1 故障注入矩阵（tests/l02-release.spec.ts）
- Transition 生命周期每阶段崩溃注入：`crashAfter: 'checkpoint' | 'prepare'` 两档 → 进程死亡语义（异常先于 rollback 抛出）→ `RecoveryCoordinator.plan` 判定 `nextAction: 'resume'` → `resumeTransition` 幂等重放已完成前缀，最终 `phase: 'COMMITTED'`，无重复步骤。
- 崩溃于 COMMIT 之前（EffectLedger `beforeCommit` 注入）：事务整体回滚 —— `fx-2` 不存在于状态、预算 `spent=0 / reserved=5000` 无泄漏；同 eventId 重试幂等（INTENT 复现）。
- 对应计划 §14 案例：T10/T11/T12/T13（各阶段崩溃）、T16（SQLite/CAS 失败由 B03 CAS 冲突测试覆盖）。

### 1.2 性能冒烟与已知瓶颈（benchmark/baselines/logs/l02-perf.log）
- 实测（本机，workspace-write 沙箱）：纯 reducer 5000 事件 = 5.3s；RunManager 追加 400 事件 = 5.7s（14.3ms/追加）。
- **已知瓶颈（如实记录）**：replay 成本随日志长度呈平方级增长 —— 实测曲线 1k=136ms、5k=5.6s、10k=24.6s、15k=57s（探测脚本数据，未入库存档仅此处记录）。根因：每个事件 reduce 后对整个（随日志增长的）状态做 deepFreeze 与 appliedEvents 字典拷贝。
- 评估：会话日志长度受 F02 压缩检查点与 L0–L3 预算约束，实际会话规模（数百～低千事件）下成本可接受（1k 事件回放 136ms）；**5000+ 事件的超长会话将显著变慢**。改进方向（记录，未实施）：replayLifecycle 批处理快速路径（批内可变折叠、仅在末尾 deepFreeze）。此项不影响发布判定，但必须在 K03 审计与 L01 双版本验收时纳入性能注记。

### 1.3 安全静态审计（tests/l02-release.spec.ts）
- 全 `src/**/*.ts` 禁止 `eval(`、`new Function(`（动态代码执行为零）。
- `child_process`/`execSync(`/`spawnSync(` 仅允许既有遗留适配器 `src/host/native-checks.ts`、`src/host/workspace.ts`（原仓库即用其执行宿主 CLI）；新增代码零进程派生。
- 全部领域逻辑为纯 reducer + 显式能力门（A04），无隐式网络/文件副作用；外部副作用一律经 D01 效果账本（intent→receipt→reconcile，未知结果→NEEDS_REPAIR）。

### 1.4 兼容与恢复（A02/L01/H03，本地）
- v1→v2 迁移保留 legacy tasks/artifacts/documents，可凭备份回滚（B02，9 测试）；legacy 模型/设置/绑定 fail-closed（L01，5 测试）。
- 崩溃后重启恢复：转换日志重放（H03）、效果账本恢复（D01）、事件外发游标续读（B03）。

## 2. 未验证项（真实 Host / 真实 Provider，当前环境缺失）

以下均为计划 §15 发布准入要求，当前机器**无法验证**，全部标注 NOT_VERIFIED，交付说明中不得宣称完成：

| 项 | 计划依据 | 缺失条件 |
|---|---|---|
| `build` 门禁 | scripts/build.mjs | DSHX_HARNESS 检出缺 `tools/dshx/src/client-build.js`，且要求 Host 0.2.0-rc.2（实有 0.1.6-alpha.2） |
| 双 Host 版本验收（rc.2/rc.5） | §15 | 需真实 Desktop Host 两版本运行 |
| 三臂基准（强 Direct / 既有 Fusion / Fusion Next）与多 seed | §15 | 需真实 Provider 与预算受控执行 |
| 隐藏验证任务集、成功率/成本/恢复率指标 | §15 | 同上 |
| Provider 故障注入（429/超时/取消）真实链路 | §15 | 需真实 Provider |
| DSH Web GUI 操作回归（S01–S20 全部场景） | §14 | 已在单版本 Host GUI 验证 S01/S02/S03/S04/S06/S15（见 §2.0）；S05–S20 部分子集与 fork/分支 GUI 流未覆盖 |
| E0–E3 证据在真实工件上的采样验证 | §9 | 需真实任务执行 |

### 2.0 真实 DSH NEXT Host 单版本验证（docs/in-host-validation.md）

在隔离的 `~/dsh/dsh-test-home` DSH_HOME 上运行 DSH NEXT 2.0.22-next（0.2.2-rc.1 内核）验证：

- 插件加载、Fusion · 自动模型菜单、configure API（revision CAS）、v2 迁移、激活缝（fail-closed 与 operator-attested 两态）、真实 Fusion turn（回复 + 标题经虚拟提供者）、S03/S04 切出挂起+切回恢复 v2 事件、真实重启后 20 个 run 持久化与新会话激活 — **全部在 Host 内实证**。
- 单元层记录过的宿主兼容修复（presentAs 特征检测、restrict fail-closed、agent/request 路由改写禁令、turn/start 防重入 select、虚拟提供者 stream 委托）——见 docs/in-host-validation.md §“兼容问题”。

### 2.1 test:host 门禁已跑通（版本偏斜如实记录）

用户提供检索授权后发现本机固定检出 `~/dsh/releases/0.1.6-alpha.2`（即 `~/dsh/current`，git 12a1f7c）。以 `DSHX_HARNESS=$HOME/dsh/releases/0.1.6-alpha.2` 执行 `pnpm run test:host`：

- 结果：7 文件 / 314 用例，**284 通过 / 29 失败 / 1 跳过**（约 51s）。
- 对照实验：在验收基线 `8861970` 上建临时 worktree（软链同一外部 node_modules）复跑，失败集合与 HEAD **完全一致**（diff 为空，29 项逐一相同）——即这 29 项失败为本仓原生测试与该 Host 检出之间的**既有差距，非本会话回归**；本会话从未改动 `src/host/coordinator.ts`、`native-tests/*`（git log 8861970..HEAD 为空）。
- 失败模式样例：`Agent preset binding requires a scoped context`（FusionCoordinator 装配语义差异）、frozen compactor 路由、delegation preflight——均为 0.2.0-rc.2 语义（见 RELEASE-0.2.0-rc.2.md）在 0.1.6-alpha.2 Host 上的不匹配。
- 结论：**test:host = 已验证执行，零回归；29 项既有失败属宿主版本偏斜**，待 0.2.0-rc.2 Host 检出后复验。

### 2.2 compat 门禁已跑通（新增验证，2026-11-11）

`DSHX_COMPACT_SAVIOUR` 目标插件源码已在 npm 上定位并取得：**`dsh-compact-saviour@0.2.9`**（含 `src/controller.ts` 的 `class Controller` 与 `src/routes.ts` 的 `CompactionRouteRegistry`；dsh-model-fusion 各版本均无此符号，属不同插件）。解包至 `~/dsh/插件/compat-fixtures/dsh-compact-saviour`（仓库外，package.json sha256 `8af6ab42…`），随后：

- 命令：`DSHX_HARNESS=$HOME/dsh/releases/0.1.6-alpha.2 DSHX_COMPACT_SAVIOUR=~/dsh/插件/compat-fixtures/dsh-compact-saviour pnpm exec vitest run --config vitest.compat.config.mts`
- 结果：`compat-tests/session-routing.spec.ts` **10/10 通过**（1.15s）——会话路由兼容语义（模型选择投影 + saviour Controller/CompactionRouteRegistry 对接）在真实插件源码 + 固定 Host 检出下验证通过。
- 收据：`benchmark/baselines/logs/compat-run-20261111.log`（commit `4860c6d`）。

## 3. 发布判定

**不能**依据计划 §18 宣告 "Full Implementation Complete"：代码与本地测试齐备（§13 A01–L02 全部史诗均有实现与测试），但 §15 双版本 Host 验收与真实基准未执行。对外交付措辞：**实现完成、Host 级验证待环境**。
