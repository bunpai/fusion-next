# A03 — DSH SDK 能力审计

**审计对象：** 本仓库安装的 `@deepseek-ai/*` **0.2.1-rc.5**（`package.json` peer range `>=0.2.0-rc.2 <0.2.2`，由 `pnpm-lock.yaml` 锁定）的公开类型面，即 `node_modules/@deepseek-ai/*/lib/types/*.d.ts`。
**方法：** 逐个读取类型声明并对照 `src/` 现有调用；本机没有兼容的 Host 源码检出、无法运行 Host 测试或构建（见 `benchmark/baselines/a01-baseline-receipt.md` §5），因此下表结论来自**已发布类型面**，运行时语义仍需 A02 的 Host 复现来确认。
**判定口径：** `可用` = 现有 API 足以支撑计划所需语义；`需要扩展` = API 存在但缺少 Fusion 必需的事务/路由/代际语义，需在插件侧补齐或在 A04 提出 Host 扩展；`不可用` = SDK 中没有对应原语。

## 结论表

| # | 能力 | 判定 | 主要依据（安装的 0.2.1-rc.5） |
|---|---|---|---|
| 1 | **selection**（模型选择） | **可用 + 需要扩展** | `installModelSelection()` / `ModelSelectionRef`（`dsh-agent/lib/types/model-selection.d.ts:25,49`）；Host API `selectModel()`（`dsh-api-session-controller/lib/types/index.d.ts:107`） |
| 2 | **session fork** | **可用 + 需要扩展** | `ctx.sessions.fork(source, boundary?, childSessionId?)`（`dsh-session/lib/types/index.d.ts:513`）、`buildForkSeed()`（`.../fork.d.ts:17`）、`SessionForkError`（`index.d.ts:367`）、Host API `fork()`（`dsh-api-session-controller/lib/types/index.d.ts:164`） |
| 3 | **agent/create** | **可用** | `ctx.agents.create/resume`（`dsh-agent/lib/types/index.d.ts:278,286`）、`AgentFactory.createAgent()`（`:172`）、`CreateAgentOptions.meta/seed/parentAgent`（`:48-84`） |
| 4 | **compaction** | **可用 + 需要扩展** | `ctx.compaction.compactIfNeeded/compactNow/compactRegion`（`dsh-compaction/lib/types/index.d.ts:116,137,157`）、`CompactionCheckpointSource`（`index.d.ts:18-23`） |
| 5 | **effects**（工具副作用幂等/结算） | **不可用（SDK 无此原语）** | 只有 `JobRegistry`（`dsh-jobs/lib/types/index.d.ts:59,71,128,137`）与工具调用恢复码 `TOOL_NOT_STARTED` / `TOOL_OUTCOME_UNKNOWN`（`dsh-session/lib/types/repair.d.ts:9,11,42`） |
| 6 | **审批** | **可用 + 需要扩展** | `ApprovalService.request()`（`dsh-user-approval/lib/types/index.d.ts:135`）、`setApprovalPolicy()`（`:63`）、`setPolicy()`（`:116`）、策略 `'ask' \| 'never'`（`:56`） |

## 1. selection（模型选择）

**可用的原语。** 每个 Agent 自带一份可变选择 `ModelSelectionRef { current, assembled }`，由 `installModelSelection(agentCtx, ref)` 绑定到该 Agent 的 prompt 装配与请求路由（`model-selection.d.ts:25-49`）。注释明确了两个关键语义，正好对上计划要求：

- **快照语义**：prompt 装配时先快照 `assembled`，再把 provider/model/effort 应用到请求配置；并发切换只会影响后续 step，不会把一次请求劈成两个模型（`:32-41`）。这就是 D02「route capability + 延迟回调 fencing」想要的基础，但**主体是插件持有的 ref，不是 Host 的会话级开关**。
- **可追溯**：provider/model 变化会在下一条被接纳的请求前追加一条 durable 的 user-role 通知；失败会在下一条请求重发（`:40-44`）。据此可以做 "模型已切换" 的可见证据，但不是结构化事件。

**当前用法。** `src/host/native-selection.ts` 注册了一个 catalog-only 的 `LlmAdapter`（`provider = dsh-model-fusion`，`model = auto`），把菜单里的「Fusion · 自动」暴露成普通模型项；真正的物理路由在 `src/host/native-model-control.ts` 里按角色改写。也就是说 selection 在插件侧的落点已经是 **adapter + 角色路由**，而不是 Host 的会话绑定。

**缺口（→ A04 / C02 / D02）。**
- 没有 "会话级选择变更事务"：无法在切换前向 Host 申请 PREPARE、切换失败回滚，也没有 `selection/will-change` 之类的可拦截钩子；计划 D03 的 Transition Manager 必须完全在插件内实现，并把 `selectModel` 的调用包在自己的状态机里。
- 没有 "把已存在 Agent 重绑到另一个 provider/model" 的 API；只能改 `ModelSelectionRef.current`（对下一次 step 生效）或新建 generation（见 3）。因此 C02 的 suspend/resume 必须建立在这两种手段的组合上。
- `selectModel` 是 Host API（供 GUI 调用），插件要感知"用户在菜单里点了别的模型"，仍要靠 `FusionCatalogAdapter` 的请求路径或 session 事件推断，缺少显式回调。

## 2. session fork

**可用的原语。**
- `SessionStore.fork(source, boundary?, childSessionId?)`（`index.d.ts:513`）：从**活跃**源会话的某个包含式 seq 前缀fork 出新的 live 子会话；边界省略即取最后一条事件；开放尾会被 `buildForkSeed()` 用合成 tool-result 与 step/turn 结束事件收口（`fork.d.ts:17`）。`inheritedEventCount` 只统计真正拷贝的源事件，不含合成收口事件。
- **血缘是持久元数据**：`SessionHeader` 的 `parentSession` / `isSeeded` / `inheritedEventCount`（`types.d.ts:110,140`）随存储头一起写入；`Session.inheritedEventCount` 在实例上可读（`index.d.ts:152`）。
- **错误是分类的**：`SESSION_NOT_FOUND | SESSION_NOT_LIVE | SESSION_ALREADY_EXISTS | INVALID_BOUNDARY`（`index.d.ts:364-368`）。这点直接决定 C01 的"历史会话激活"必须区分"冷会话"与"活跃会话"。
- Host 侧另有 `fork()`（`dsh-api-session-controller/lib/types/index.d.ts:164`），语义是"把一个可冷读的精确前缀 fork 成新会话，边界省略取最后一个完整 turn"，并会发 `session/fork-unavailable`（`types.d.ts:228`）——这就是 GUI「创建分支」走的路径。

**缺口（→ C01 / C03）。**
- fork **总是产生新的 sessionId**，且要求源会话是 store 里的 live 实例；因此 Fusion 的 binding（当前按原生 sessionId 索引）在新分支上是**天然缺失**的。C03 必须用 `header.parentSession` 做血缘映射，而不是"拷贝 binding"。
- 没有"查询某会话的所有子分支 / 祖先链深度"的 API；只能从 header 逐级读 `parentSession`，或用存储层扫描。
- fork 时不携带插件的 scope/权限（`dsh-scope`、`dsh-sandbox-policy` 都不在 seed 里），这与计划"分支不继承活跃权限"的要求一致，但也意味着 C03 必须显式重建只读上下文。

## 3. agent/create

**可用的原语。**
- `AgentRegistry.create(options)`（`index.d.ts:278`）与 `resume(options)`（`:286`），底层由实现 `AgentFactory` 的 `dsh-agent-loop` 提供（`createAgent()` 在 `:172`，`resume()` 在 `:184`）。
- `CreateAgentOptions`（`:48-84`）支持：唯一 `sessionId`、`parentAgent` 运行时归属、`meta.parentSession/isSeeded/origin:'subagent'/delegationDepth`、`seed` 历史（fork 回放）、`agentOptions`（含模型）、`signal`、以及 `setup` 组合时机的 scoped 上下文。
- 生命周期是**事务化**的：创建在 await 前完成 setup，插入与公告有回滚覆盖；handle 的 dispose 会 drain、反注册、移除 session、回卷 scope（`:150-170`）。这正是 B01/C 需要的 "Agent Generation" 载体——**一个 generation 就是一个 AgentHandle**。

**缺口。** 没有 generation/代际概念本身（不生成 `generationId`，也不阻止旧引用继续 append），D02 的 fencing 必须由插件自持；`create` 也**不能**接管已存在 session（reuse），只能用 `resume` 打开持久会话——所以"同一聊天里换模型"只能二选一：改 current selection，或 resume 出一个新 AgentHandle。

## 4. compaction

**可用的原语。**
- `compactIfNeeded(agent, trigger, signal)`（`:116`，自动，`trigger = 'pressure' | 'context-overflow'`）、`compactNow(agent, signal, sourceCommandId?)`（`:137`，显式空闲压缩，要求 `runMaintenance` 独占且有 durable `compaction/start` 锁）、`compactRegion(start, end, agent, signal?)`（`:157`，按 surface 位置强制压一个平衡区间）。
- 结果与来源可识别：`CompactionResult`、`CompactionCheckpointSource` / `compactCheckpointSource`（`index.d.ts:20-23`），替换用的 user message 带 `CompactionId`，消费方可独立关联。
- 失败可恢复：`compaction/summary-error` 是 waterfall 事件（`:86`），监听者可以同步改写被选中的输入后让提供方重算重定价。

**缺口（→ F01 / F02）。** checkpoint **不携带模型亲和信息**，也没有"把这个 checkpoint 交给另一个模型/Agent"的 API；计划 F02 的 "checkpoint 路由 + cache 净收益" 必须由插件记录（例如把模型与 digest 写进自己的 run 元数据），不能指望 Host 给。

## 5. effects（副作用幂等与结算）

**结论：不可用 —— SDK 没有 effect ledger 原语。** 现有可用部件只有两类：

- **Job 生命周期**：`JobRegistry.start/list/get/read/readAt/kill/wait/remove`（`dsh-jobs/lib/types/index.d.ts:59-137`），以及"start 前预检一律不留痕、返回后注册不可失败"的原子性承诺（`:63-71`）。这给的是**进程内**作业语义，不是跨崩溃的幂等账本。
- **工具调用恢复码**：`TOOL_NOT_STARTED`（请求未到 call start）与 `TOOL_OUTCOME_UNKNOWN`（call 已记录但结果未落盘）(`dsh-session/lib/types/repair.d.ts:9,11`)，以及 `ToolCallRecovery`（`:42`）用于在 turn 关闭前补保守的错误结果。

**缺口（→ D01）。** 没有工具幂等分类、没有"已提交副作用"的持久账本、没有 drain/未知效果阻断。计划 D01 的 effect ledger 必须完全自建，并只能复用上面的恢复码作为 **原因标签**（例如把 `TOOL_OUTCOME_UNKNOWN` 映射为 UNKNOWN 效果）。

## 6. 审批

**可用的原语。** `ctx.approval.request(req)`（`index.d.ts:135`）返回封闭结果，`'allowed-once'` 是唯一授权值；`ApprovalPolicy = 'ask' | 'never'`（`:56`），可 `setApprovalPolicy(session, policy)`（`:63`，写 durable override）或 `setPolicy(agent, policy)`（`:116`，排队到下一个 model step）。每次 ask/outcome 都成对写入请求方 session 的日志，未落盘则整体 reject。

**硬约束（已验证的注释语义）。** `request()` **要求当前有打开的 turn**："The request requires an open turn because the audit pair must be enclosed by the durable log's commit/replay boundary; an idle ask rejects before appending anything."（`:118-132`）

**缺口（→ E01 / D03）。** 审批只按 session 策略、只针对**工具调用**；没有针对"Takeover 写租约"这类非工具动作的授权对象，也没有可撤销的一次性租约。E01 的 Takeover 授权必须自建（并复用同一审计风格），且不能在空闲时借道 `approval.request` 阻塞式索权。

## 对后续 Epic 的直接影响

1. **B01/C 的"Generation"不是 SDK 概念**：SDK 给的是 AgentHandle（可 dispose、可 resume）与可变 selection；generation、fencing、alias 需要插件层实现，且必须把 `SessionHeader.parentSession` 当作唯一血缘事实来源。
2. **fork 分支上没有 binding**：任何"分支激活 Fusion"的实现都必须走 lineage 推导 + 显式 resume，而不是复制原生绑定（也符合计划 §17.1 的禁令）。
3. **审批不能当"万能确认"用**：空闲态索权会直接 reject；Fusion 的 suspend/resume、Takeover 需要自己的授权与审计路径。
4. **effect ledger 与 checkpoint 路由是纯自研项**：D01/F02 在 SDK 中没有任何可借用的持久原语，必须进入 B/D/F 的实现范围。
5. **typecheck 现在才真正检查这些契约**：`tsconfig.json` 曾开启 `preserveSymlinks`，导致 `@deepseek-ai/dsh-*` 的类型在 `skipLibCheck` 下静默退化为 `any`（见提交 `9e2df6e`）。本审计的结论是在**恢复真实类型解析之后**读取的 d.ts，因此可直接作为 B 系列的类型依据。
