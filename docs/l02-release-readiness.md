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
| 三臂基准（强 Direct / 既有 Fusion / Fusion Next）与多 seed | §15 | **部分验证** — 2026-11-12 隔离实例内真实执行：direct 3×5=100%、fusion-next 3×5=100%、fusion-fixed 0/5（presentAs 兼容缺陷，真实基线）；任务集未达隐藏任务集规模。见 `docs/benchmark-run.md` + `benchmark/baselines/three-arm-in-host-20261112.json` |
| 隐藏验证任务集、成功率/成本/恢复率指标 | §15 | 同上 |
| Provider 故障注入（429/超时/取消）真实链路 | §15 | 需真实 Provider |
| DSH Web GUI 操作回归（S01–S20 全部场景） | §14 | 已在单版本 Host GUI 验证 S01/S02/S03/S04/S05/S06/S07/S08/S09/S10/S11/S12/S13/S14/S15/S16/S17/S20（见 §2.0/§2.0.1）；S18/S19 单元层覆盖 |
| E0–E3 证据在真实工件上的采样验证 | §9 | 需真实任务执行 |

### 2.0 真实 DSH NEXT Host 单版本验证（docs/in-host-validation.md）

在隔离的 `~/dsh/dsh-test-home` DSH_HOME 上运行 DSH NEXT 2.0.22-next（0.2.2-rc.1 内核）验证：

- 插件加载、Fusion · 自动模型菜单、configure API（revision CAS）、v2 迁移、激活缝（fail-closed 与 operator-attested 两态）、真实 Fusion turn（回复 + 标题经虚拟提供者）、S03/S04 切出挂起+切回恢复 v2 事件、真实重启后 20 个 run 持久化与新会话激活 — **全部在 Host 内实证**。
- **Worker 委派全链路（2026-11-12 实证）**：Lead `fusion_next_delegate` → work-order 派生 → 独立 Worker 会话（cpa/devin-swe-2-flash）→ 嵌套 native 检查（修复后的 batch API）→ Worker `fusion_next_submit_result` → Lead `fusion_next_review_result` accept → task COMPLETED，交付文件真实落盘且单测通过。
- 单元层记录过的宿主兼容修复（presentAs 特征检测、restrict fail-closed、agent/request 路由改写禁令、turn/start 防重入 select、虚拟提供者 stream 委托、tools.execute batch API 兼容 + #nestedChecks parent 匹配放宽）——见 docs/in-host-validation.md §“兼容问题”。

### 2.0.1 双选择器 UX 与场景矩阵 GUI 验证（2026-11-12，commit d706b0e 起）

- **UX**：'Fusion · 自动' 伪模型从目录移除（listModels→[]，legacy resolveModel 保留）；规划 = 宿主正常模型菜单（物理路由绑定会话）；执行 = 输入框 `执行` combobox（off→普通会话，on→首条消息自动激活 Fusion run）。`pair:<sessionId>` CAS 持久化；`sessionRoutes` 在冻结 binding profile 上覆盖路由。
- **场景矩阵实测（含 §14 S 案例映射）**：
  - S01/S02 新会话+中途激活：RUN_CREATED+RUN_ACTIVATED（多会话实测）。
  - **S05** 历史普通聊天激活：34 轮历史会话 `7af2f560` 设执行器 → RUN_CREATED+ACTIVATED + 回合完成。
  - **S06** 历史 Fusion 重开：旧会话 `1298ac54` 直接发消息 → turn completed（virtual fusion 3.4s → 物理 swe-2）。
  - **S07** 历史 Fusion 切出再切回：执行器 off→on → SUSPEND_REQUESTED→SUSPENDED→RESTORE_REQUESTED→RESTORED rev6 RUNNING。
  - **S08/S09/S12** 分支：运行中 Fusion 会话 `在新对话中分支` → 分支初始为普通会话（无 pair/run）→ 设执行器 → 独立 RUN_CREATED+ACTIVATED；父/分支 run 并存 RUNNING。
  - **S10/S11** 分支继承与独立规划：fork 点继承父规划（pair.lead=gpt-6-luna(max)）；分支切到 swe-2 → syncSessionPairLead 更新分支 pair.lead 而父不变；LLM 实走 `cpa devin/swe-2`。
  - **S13** 一分支挂起另一分支继续：分支 SUSPENDED rev8 同时父 RUNNING 并完成回合。
  - **S14** 分支运行中模型迁移：S11 的 lead 切换发生在分支 RUNNING 期间（`syncSessionPairLead` 只更新 pair 文档，run 不重建不挂起）。
  - **S15** 历史切换同时 Host 重启：重启后 reconciliation 追加 `recovery/needed` → RECOVERING → `/fusion-next recover <note>` + `/fusion-next resume` 恢复（实测多轮）。
  - **S16** fork 发生在插件未初始化时：分支初始无 pair（普通会话），插件状态不需要。
  - **S17** 快速反复切换：执行器 off/on 3 连切（0.4s 间隔）→ 仅一组 SUSPEND 事件（幂等），下一轮 RESTORE_REQUESTED+RESTORED 干净恢复 rev6。
  - **S18** 缺失 legacy binding：单元覆盖 NEEDS_REPAIR fail-closed（不伪造 run）。
  - **S19** 双分支同路径写冲突：`e7c730e` FUSION_NEXT_FILE_CONFLICT 实现+单元测试（未做真实双 worker 撞文件 E2E）。
  - **S20** forkPointSeq 后事件不泄漏：v2 journal 按 run 隔离，分支 run 事件全部自有（构造保证+实测）。
- **T18** drain 期间新消息、`T07` 429 fallback、`Q04/Q05` 越权写、`Q09` 预算硬限、`Q16` UI/DB 一致、`E0-E3` 证据级别：分别由单测/门禁覆盖或在各场景间接实证（GUI 状态与 fusion_events 始终一致）。

### 2.1 test:host 门禁已跑通（版本偏斜如实记录）

用户提供检索授权后发现本机固定检出 `~/dsh/releases/0.1.6-alpha.2`（即 `~/dsh/current`，git 12a1f7c）。以 `DSHX_HARNESS=$HOME/dsh/releases/0.1.6-alpha.2` 执行 `pnpm run test:host`：

- 结果：7 文件 / 314 用例，**284 通过 / 29 失败 / 1 跳过**（约 51s）。
- 对照实验：在验收基线 `8861970` 上建临时 worktree（软链同一外部 node_modules）复跑，失败集合与 HEAD **完全一致**（diff 为空，29 项逐一相同）——即这 29 项失败为本仓原生测试与该 Host 检出之间的**既有差距，非本会话回归**；本会话从未改动 `src/host/coordinator.ts`、`native-tests/*`（git log 8861970..HEAD 为空）。
- 失败模式样例：`Agent preset binding requires a scoped context`（FusionCoordinator 装配语义差异）、frozen compactor 路由、delegation preflight——均为 0.2.0-rc.2 语义（见 RELEASE-0.2.0-rc.2.md）在 0.1.6-alpha.2 Host 上的不匹配。
- 结论：**test:host = 已验证执行，零回归；29 项既有失败属宿主版本偏斜**，待 0.2.0-rc.2 Host 检出后复验。

### 2.2 compat 门禁已跑通（新增验证，2026-11-11）

`DSHX_COMPACT_SAVIOUR` 目标插件源码已在 npm 上定位并取得：**`dsh-compact-saviour@0.2.9`**（含 `src/controller.ts` 的 `class Controller` 与 `src/routes.ts` 的 `CompactionRouteRegistry`；fusion-next 各版本均无此符号，属不同插件）。解包至 `~/dsh/插件/compat-fixtures/dsh-compact-saviour`（仓库外，package.json sha256 `8af6ab42…`），随后：

- 命令：`DSHX_HARNESS=$HOME/dsh/releases/0.1.6-alpha.2 DSHX_COMPACT_SAVIOUR=~/dsh/插件/compat-fixtures/dsh-compact-saviour pnpm exec vitest run --config vitest.compat.config.mts`
- 结果：`compat-tests/session-routing.spec.ts` **10/10 通过**（1.15s）——会话路由兼容语义（模型选择投影 + saviour Controller/CompactionRouteRegistry 对接）在真实插件源码 + 固定 Host 检出下验证通过。
- 收据：`benchmark/baselines/logs/compat-run-20261111.log`（commit `4860c6d`）。

### 1.5 缺口项收口（2026-11-12，6 项）

1. **Worker 证据可发现性**（`6de666e`）：`fusion_next_list_evidence` 工具 + settlement notice 指引强化（Worker 不再复述归档原文，Lead 可枚举全部 task artifacts）。
2. **V2Shadow 旧轨 → v2 日志镜像**（`54c147e`）：legacy task 事件投影为 v2 journal 事件（generation/assignment/brief/arbitration）。
3. **S19 跨分支文件写拒绝**（`e7c730e`）：写工具经 `fileConflicts` 门禁对照 v2 journal 的 ASSIGNMENT_FILES_CLAIMED。
4. **工单 → v2 效果台账**（`19ba593`）：work-order/prepared → EFFECT_INTENT，claimed → DISPATCHED，submitted → RECEIPT，outcome-unknown → UNRESOLVED（恢复可见性）。
5. **Token 结构开销**：如实记录——fusion-role prompt + ~12 tool defs 为结构性开销，`assembleContextFor` 无 purpose 字段无法在接缝处按用途裁剪；量测显示 fusion 输入 token 低于 direct（1485 vs 1831 均值，缓存吸收）。不消除，作已知残差。
6. **有界并行 explore 通道**（`bf3cd73`）：主工单在飞时允许第二个 `fusion-next-parallel-*` 只读 explore 子会话（own order/accepted/exploration 槽位 + 独立提交槽，主工单不互撞）。

## 3. 发布判定

**不能**依据计划 §18 宣告 "Full Implementation Complete"：代码与本地测试齐备（§13 A01–L02 全部史诗均有实现与测试），单版本（0.2.2-rc.1）Host 内已实测关键链路。剩余未验证：§15 双版本 Host 验收（用户决定放弃该兼容项，仅当前版本验证）、§15 隐藏任务集规模基准。对外交付措辞：**实现完成、单版本 Host 验证通过、规模化基准待续**。Token 计量重复已由投影数据证伪（2026-11-12）。
