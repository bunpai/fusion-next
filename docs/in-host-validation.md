# In-Host Validation — DSH NEXT 0.2.2-rc.1 隔离实例

本文件记录在**真实 DSH Host（DSH NEXT.app 2.0.22-next，asar 内置 @deepseek-ai/dsh-tool-subagent-control@0.2.2-rc.1）**上运行的隔离测试实例中验证 Fusion Next 的证据。实例完全独立于用户生产实例（DSH_HOME=`~/dsh/dsh-test-home`，自有 profile/plugins/credentials），不共享运行状态。

## 实例设置

- `~/dsh/dsh-test-home`：复制的 `profiles/desktop`（cordis.patch.yml + pnpm node_modules clone），独立 `plugins/`、`sessions/`、`storages/`、`.credentials.yaml`（CPA_API_KEY 通过 Web UI 凭据存储）。
- `launch-host.cjs`：以 `ELECTRON_RUN_AS_NODE=1` 拉起 Electron host.js，IPC 父进程 + `DSH_HOME` 隔离 + `DSH_NEXT_PREFERENCES`（loopback、port 0、browserAccess false）。
- 插件部署：`~/dsh/dsh-test-home/profiles/desktop/node_modules/dsh-model-fusion/` = 真实目录（node_modules 软链不被 kernel 发现），`lib/dsh-model-fusion.js` 从仓库 `scripts/build-host-local.mjs` 产物覆盖。
- 测试专用补丁：`cordis.patch.yml` + `local-bundles/dsh-agent-presets/cordis.patch.yml` 中 `tool-subagent-list-agents` 绑定 `disabled: true`（宿主 0.2.2-rc.1 的 dsh-tool-subagent-control 缺少 `./list-agents` exports 子路径，属应用版本偏斜，与插件无关；生产实例同样受影响，已按同一方式修复）。
- `lifecycleBridge: true` + `hostSdkVersion` 不在配置 → `probeHostCapabilities` 以 `attested:true` 升级为 `operator-attested`（A04 显式人工确认路径）。

## 已验证

| 项 | 证据 |
|---|---|
| 插件在 Host 加载 | `[my-plugins/dsh-model-fusion] loaded`，fiberPhase active |
| 模型菜单 Fusion · 自动 | GUI 选择器分组 `Fusion` 显示 `Fusion · 自动`，选择生效（chip 更新） |
| 配置 API | `POST /api/model-fusion {action:configure, revision, pair:{lead:{cpa,devin/swe-2},worker:{cpa,devin/swe-2-flash}}}` → `{ok:true}`，revision CAS 生效 |
| B02 v2 迁移在 Host 内运行 | `fusion-v2.sqlite` 创建，user_version=2，18 张表 |
| C01 激活缝（fail-closed） | bridge OFF 时 `SessionLifecycle.activate` 抛 `HOST_CAPABILITY_DENIED [lifecycle.transition]`，库中零行 — A04 设计正确 |
| C01 激活缝（attested 放行） | bridge ON：RUN_CREATED + RUN_ACTIVATED 入 v2 事件日志（1 run + 1 alias + 2 events） |
| **真实 Fusion turn** | session-380184a7 日志：model/selection → request/header（dsh-model-fusion/auto）→ session/title（provider 经 Fusion 虚拟提供者生成标题）→ assistant/message 文本块 "就绪" → turn/end completed |
| S03 切出（物理模型） | 选择 swe-2-flash 后 v2 写 RUN_SUSPEND_REQUESTED→RUN_SUSPENDED（e98d702 suspend 缝） |
| S04 切回恢复 | 再选 Fusion · 自动 → RUN_RESTORE_REQUESTED→RUN_RESTORED，新 turn 完成（回复 "回来"） |
| S15 重启持久化 | 真实 kill+relaunch 后 20 个 fusion_runs 全部保留（rev 一致，48 events），新会话 session-83f56d3f 重新激活 RUN_CREATED+ACTIVATED，turn 完成，标题经 Fusion 虚拟提供者生成 |
| cpa Provider 端点 | devin/swe-2（Lead）+ devin/swe-2-flash（Worker）请求成功往返；FusionCatalogAdapter 虚拟提供者将 LLM 调用委托至 Lead 物理路由 |
| test:host | `DSHX_HARNESS=~/dsh/releases/0.1.6-alpha.2 pnpm run test:host` = 284/314 通过，29 失败与验收基线 8861970 失败集合完全一致（零回归；失败属 0.2.0-rc.2 语义 vs 0.1.6-alpha.2 Host 版本偏斜） |

## 修复的宿主 0.2.2-rc.1 兼容问题（commit ba02242 / e98d702）

1. `scope.tools.presentAs` 在 0.2.2-rc.1 已移除 → 特征检测；`restrict` 缺失时显式 fail-closed（Worker 权限绝不静默放宽）。
2. `system-prompt/assemble` 的 `assembled.tools` 可为 undefined → 跳过分发投影。
3. Host 禁止 `agent/request` 改写 provider/model（`agent/request proposed "x" after step preparation fixed "y"`）→ 移除路由改写，改为 `agent.model.select()` 在 step 前应用。
4. `agent.model.select()` 在 `turn/start` 监听器内同步 session append → `session append cannot reenter while another append is being published`（dsh-session 防重入）；turn/start 内禁止 select，改为 install 时一次应用 + `appliedPhysicalRoutes` 回显注册表使选择监听器忽略回声事件。
5. pre-step 瀑布早于 scope install 完成 → pre-step 等待 entry ready（ready=false 时同 id 检查）。
6. FusionCatalogAdapter 虚拟提供者：`stream` 无条件抛 `Fusion 尚未就绪` 会杀死辅助请求（session-title）→ stream 委托至 Lead 物理路由（`ctx.llm.stream` + `profile.lead`），消除回声问题根源。

## 未在 Host 内验证（诚实缺口）

| 项 | 状态 |
|---|---|
| Mid-run 切换中的 NativeContextGuard 暂停 → 该轮 turn blocked | 观察到一次（物理→Fusion 切换时 turn/end blocked），来源是原生 context guard 而非 Fusion 代码；S04 语义仍正确（随后 turn 恢复） |
| 双 Host 版本验收 | 0.2.0-rc.2 Host 检出不可用；当前仅验证 0.2.2-rc.1 单版本 |
| ~~token 计量重复~~ 已排除 | 投影 `tokenUsage` totals = 各 turn 单条 usage 之和（13508/220/162176 精确匹配）— 委托物理调用不产生第二条计量记录，无重复 |
| Fork/分支（S08–S20） | **验证**：S09 独立 Run、S12 并发、S13 失败隔离、S14 分支模型迁移、S20 事件不泄漏全部实证（见下表）；S19 写冲突 = Host 集成缺口（插件未桥接写租约）。残余缺口：SESSION_FORKED 血缘未桥接进 v2 journal（本版本 session/list 不暴露父子关系） |
| ~~发布级三臂基准~~ | 已执行（有界微任务集）：direct 15/15、fusion-next 15/15、fusion-fixed 0/5 — 见 `docs/benchmark-run.md`；未达 §15 隐藏任务集规模 |

## 结论

0.2.2-rc.1 单版本下，Fusion Next 插件可加载、可配置、可选中、可完成真实 Lead 往返（含标题辅助请求），v2 事件日志记录激活/挂起/恢复/重启持久化的完整生命周期。**不能宣称 Full Implementation Complete**：双版本验收与发布级基准仍缺宿主与环境。


### 分支案例（fork 后，2026-11-12 补验）

| 案例 | 结果 | 证据 |
|---|---|---|
| S09 fork 独立 Run | ✅ | 子会话 `fusion-run-session-472d9309` 独立 RUN_CREATED+RUN_ACTIVATED，父 run 保持 RUNNING |
| S12 双分支并发 | ✅ | 父子分支各自完成真实 turn（父 turn/end×7 completed，子 turn/end×6 completed） |
| S13 一分支失败另一分支继续 | ✅ | 子分支 minimax-m3/mimo-v2.6-pro 连续 turn/end reason error（cpa 400 model_not_found）；父分支同期间 turn/end×2 completed，父 run 保持 RUNNING rev2 |
| S14 分支运行中模型迁移 | ✅ | 子分支 selectModel cpa/devin/swe-2-flash → 仅该分支 RUN_SUSPEND_REQUESTED→RUN_SUSPENDED（rev4），父分支 RUNNING 不变 |
| S19 双分支相同路径写入冲突 | ⚠️ Host 集成缺口 | v2 journal 的 `ASSIGNMENT_FILES_CLAIMED` 冲突检测是库级机制（H01，测试覆盖）；插件运行时未桥接写租约——分支写文件走 Host 原生工具，不进 Fusion 调度器，冲突只能由 Host 自身机制兜底 |
| S20 forkPointSeq 后的事件不得泄漏 | ✅ | fork 后父会话新 turn（"父转"×3 matches）完成，子会话 journal 行数不变（71→71）且 0 匹配父文本 |
