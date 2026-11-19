# fusion-next Plan-once 改造方案（V3.1）

> 状态：草案 v1（2026-11-19）。目标：把"逐轮 judge 路由"改造成"计划一次 → 执行模型全跑 → 卡壳升级"的 plan-once 架构，达到接近规划模型的质量、显著低于规划模型的 token 开销。
> 前提事实：dispatch-v3 / audit-v3 / runtime-v3 已建成（阻塞 settle、AuditBundle、同 worker 自修复 ≤2 轮），prompts/model-lead.md 已是 v0.3 单工具协议 —— 本方案是**补全与收口**，不是推翻重做。
> 修订 v1.1（同日）：吸收外部双评审（A：五处必改；B：两处微调）——预算拆分/归一化收窄/runner 允许集/三方归因/quiescence 门/穿透矩阵/PTC run_code 保留/LAR 判序/M1 纪律，条目内标（外部双评审 #n）。

---

## 0. 一句话目标与总验收

**目标形态**：实质任务 = lead 计划一次（goal + invariants + verify_commands）→ 全部执行走 `fusion_dispatch`（持久 worker 子会话）→ 失败 bundle = 定向升级（预算内）→ 绿 bundle = 直接结案；读类闲聊保留 worker 转发；小任务走 lead 直答旁路。

**总验收（沿用现有三轮基准口径，fusion 臂改跑 pair 模式）**：

| 基准臂 | 指标 | 现状 | 门槛 |
|---|---|---|---|
| 多轮代码拆解（10 轮） | lead fresh | 150.5K（solo 171.9K，仅 -12%） | **≤ 70K（-60% 起）** |
| | 墙钟 | 567s（solo 832s） | ≤ 567s，争取 ≤ solo |
| | 产出/质量 | 10/10 md | 10/10 且盲评 ≥ solo（评分 judge 盲评） |
| 多轮 QA（读重） | lead fresh | +23% vs solo | **≤ solo（负转正）** |
| 单任务（小） | fresh / 时间 | +5~17% / 10× | Δ ≤ +5% / 时间 ≤ 1.5× solo |
| 通用 | 升级失控 | planner 旧病 10-20 轮重试 | re-dispatch 硬门 ≤3，同指纹拒绝 |
| 通用 | worker 蔓延 | r5 时代 ~80 调用/任务 | 步数/时长 watchdog 记录并可断路 |
| 通用 | lead 节约 | 报告必列 LAR = Lead Avoidance Ratio（1 - C_lead_actual / C_lead_solo，外部双评审 A 采纳为展示指标） | 展示层不进判序；判序恒定：质量 > Cost per Success > 墙钟 > LAR |

**结构判断的依据**（基准已证）：judge 逐轮路由省不动的三个原因 —— ① COMPLEX 定义把一切写入轮判给 lead（fusion-next.ts 判定词 = "anything that writes, executes, fixes, builds"），保守是定义性的；② 同会话内两模型交替服务互相打断 prompt cache（QA 臂 +23% 的签名）；③ 小任务摊不平机器固定开销（+5~17%、10×）。plan-once 把路由粒度从"每轮"改为"每任务"并钉死单一执行者，三项税同时消失；lead 每轮上下文增量从 O(15-20K) 塌缩成 O(一个 bundle ≈ 1.5-3K)。

---

## 1. 架构决定：双模式分工

现状两套入口并存，分工定型为：

- **Pair 模式（/fusion-next 选定绑定 → coordinator + prompts/model-lead.md）= plan-once 正主**。所有实质任务在这里跑：lead 全程在场，唯一执行出口 `fusion_dispatch`。coordinator.ts:267 已注册 `fusion_dispatch`；coordinator.ts:191 已在选绑定时 createRuntime（runtime-v3）。
- **模型菜单 Fusion（FUSION_NEXT_PROVIDER catalog 路由）= 轻量聊天通道**。judge 只服务读类闲聊转发（SIMPLE→worker）；写入轮不再尝试逐轮路由（消除交替抖动）。多轮实质任务出现时给一句升级建议（M3）。
- B 臂实验（judge 激进化）作为 **worker-only 上限探针**保留在模型菜单通道，作为 C2 取舍依据，不进默认行为。

---

## 2. 里程碑

### M0 — 盘点与埋点（0.5 天，先行）

不改行为，只补可观测性，否则后面每个里程碑都说不清"为什么"。

1. **接线盘点**（产出 inventory 表，回答 4 个悬空问题）：
   a. 模型菜单模式下 `fusion_dispatch` 是否可达（catalog 模式是否装 coordinator）？
   b. transport 是否暴露子会话步数/用量（0.2.0-rc.2 / 0.2.1-rc.2 seam 已有条件分支），watchdog 用哪个信号？
   c. 模型菜单模式SIMPLE→worker 的**在会话内直接写文件目前无人审计**（转发请求共用 session 工具集，无 AuditBundle）——确认此洞存在（B 臂与 C2 的前提）。
   d. 基准 harness 的逐模型 fresh/cached 归因口径确认（现有 usage/ledger 文档够不够）。
2. **埋点**（为验收服务的最小集）：
   - runtime-v3 `DispatchRecord` 增列：`workerSteps?`、`bundleBytes`、`wallMs`、`failureSignature?`（首条失败 verify 的 command+exitCode 指纹）。
   - dispatch-v3 在 begin/finish 各记时间戳。
   - 基准脚本增加 fusion 臂"升级次数 / dispatch 次数 / 平均 bundle 字节"输出。
3. 冒烟：跑一轮现有三臂之一确认口径能出数。
4. **基线纪律**（并入自外部计划 §1.1）：本地跑 pnpm typecheck / test / test:host / build（Node ≥22.14、pnpm 9.15.9）全过并留档测试数量与结果——外部计划称该 commit 记录 137 项测试通过，**以本地实测为准**，commit message 不代替验证；记录公开 API、settings 键、SQLite 结构现状作回归基线。
5. **inventory 六栏格式**（并入自外部计划 §1.2）：Active / Dormant / Removed / Replaced / Missing / Compatibility，每项附调用方、被调用方、对应测试文件。

**验收**：inventory 表（六栏）+ 基线命令输出留档 + 埋点 diff 合入；基准报告新增列可用。

### M1 — B 臂：judge 激进探针（0.5-1 天）

- 改动最小：fusion-next.ts:214-235 `judgeWithPlanner` prompt 增加"workspace 内写入/执行且预计 ≤ N 文件也可 SIMPLE"激进变体，**挂实验开关**（settings 文档 `routing.aggressiveWrite`，默认 false，可回退）。
- 跑基准 + 盲评（纪律并入自外部双评审 A 微调二）：固定任务集/模型/工具/token 预算，执行顺序随机化，盲评者不知组别（防时序与缓存伪影）；样本优先复用 four-arm 22×2 语料而非临时三轮；拆两问——**B1 = worker-only 质量上限**、**B2 = 加审计+升级门后的质量恢复力**（C2 的前置读数）。质量塌（md 轮间不一致/漏要求/编结构）→ 证明计划轮与审计门赚回成本，C2 缓做；质量稳 + fresh 大降（预计 60-90K）→ C2（worker-primary + 绊线）加急。**≤70K 是门槛不是优化目标，判序恒定见 §0**。
- **读数纪律**：这臂是"无门版"上限测量，不是生产形态候选；它暴露的任何质量坑都要归因到"缺哪道门"。

**验收**：B 臂三任务数据表（fresh/时间/盲评分/失控案例）入 benchmark/baselines/。

### M2 — C1 硬化：plan-once 正主路径（3-5 天，核心里程碑；并入外部实施计划项后）

Pair 模式已经是 plan-once 的骨架；M2 补五个硬门 + 提示词协议收口。**所有硬门挂 settings 开关（默认开）可一键回退**（M1 routing.aggressiveWrite 先例）；从外部实施计划（V4 draft）并入的项以"（并入自外部计划 §x）"标注，其余维持读码事实锚定。

**M2.1 升级预算与失败指纹（runtime-v3.ts + dispatch-v3.ts）** —— 防"planner 循环重试"旧病从新门进来：
- `DispatchRecord` 增 `instructionHash`；`beginDispatch` 计算落盘。**归一化管线**（防"换皮重发"——只改语气词/空白/标点后绕过）：NFKC → 空白折叠（折叠连续空白，不去词间空格）→ 小写 → **仅剥句读类标点**（CJK ，。！？；、与 ASCII 句读等价物），**保留 - _ / . : 等路径与代码语义字符**（外部双评审 A 微调一收窄：a-b.ts ≠ ab.ts 不得撞指纹）→ sha256；**比对范围 = 同 taskId 的上一条 failed dispatch**，不跨任务不跨 worker。语义级相似度刻意不做硬门，只做 advisory（理由见换皮预警条）。
- `runDispatch` begin 处两条硬规则（host 侧，lead 无绕过）：
  1. **同指纹拒绝**：上一条 dispatch failed 且本次 `instructionHash` 相同 → 不启动 worker，直接返回 failed bundle，note = "escalation rejected: identical instruction after failure — refine the instruction or surface the conflict to the user"。
  2. **预算断路**：本任务累计 failed dispatch ≥ 3 → 返回 failed bundle，note = "escalation budget exhausted — present the conflict to the user"，强制 lead 出循环向用户摊牌。
- **疑似换皮预警（advisory，刻意不硬拒）**：hash 不同、但与最近一条 failed 指令的归一化字符 2-gram Jaccard ≥ 0.8 → 照常执行，bundle/record 标记 `resendSuspect:true`，note 注明 "instruction resembles the previous failed one — name the new information or change strategy"。不硬拒的理由：窄修正是合法路径，误杀（卡住正当推进）的代价高于放行（最坏多浪费一次 dispatch）的代价，且换皮损失上限被预算断路封死在 3 次以内——硬门只留给确定性判据（归一化 hash），judgement 交给 advisory，与 audit-v3 哲学同构。
- 例外通道：`reset_worker` + 指令含实质新信息（hash 不同）不受 1 限制；预算 3 次计数在 worker reset 后**不重置**（防软重启刷预算）。
- **供应商 429/超时（预算拆分：执行失败 vs 基础设施失败，外部双评审 A-2）**：429/5xx/网络超时**不烧 rework 3 次预算**（性质不同：执行失败=worker 修错/verify 裁红；基础设施失败=供应商不可用），但计独立 `infraAttempts`（≥2 次摊牌换绑，note 配退避建议）并受总尝试封顶 `executionFailures + infraAttempts ≤ 6`（防 429 循环烧穿）；note = provider unavailable，**不自动换绑**（绑定是用户决定）。**超时不即重发**：超时≠worker 未执行，恢复前先 settle 查 child 状态，防同一任务双执行。

**M2.2 verify 超时可配（audit-v3.ts + dispatch-v3.ts）**：
- `DispatchArgs` 增 `verify_timeout_ms?: number`（默认 120_000，clamp 120_000–3_600_000，对齐旧 native-checks MAX_CHECK_SECONDS=3600）。
- `runVerification(root, commands, timeoutMs)` 透传；audit-v3.ts VERIFY_TIMEOUT_MS 改为默认参数。修复现状缺陷：全量 pytest >120s 的任务会被误判失败、触发无谓修复轮。
- **命令安全分级（并入外部计划 §1.3-D；定位修正自外部双评审 A-4：黑名单只当绊线，不当安全边界）**：`python -c` / `node -e` 内联代码确实绕过字符串黑名单。verify_commands 保持字符串接口，host 侧 token 化逐段校验：按 && ; | 切段，每段首 token 必须命中 runner 允许集（pytest/py.test/vitest/jest/mocha/tap/go/cargo/make/tsc/tox/npm/pnpm/yarn 及项目 package.json scripts 引用；常量写死，M0 盘点补全清单）；**拒内联解释器代码段**（-c/-e/exec 一类）与文件重定向段；确定性危险模式（rm -rf / sudo / curl|sh / 管道进解释器）直接拒 + 审计行。DispatchRecord 审计行记 tokenized {executable, args, cwd, exit, durationMs}（吸收结构化审计字段，不改命令接口）。范围声明：此门只管 verify_commands（host 执行面，与 M2.5 同一 guard 拦截器），worker 会话内 shell 不做细化沙箱——全结构化 VerifyCommand 接口与 agent-shell default-deny 不采纳（协议换面成本 > 收益，风险行入 §4）。

**M2.3 worker 步数/时长 watchdog（dispatch-v3.ts，依赖 M0-b）**：
- `DispatchArgs` 增 `max_wall_ms`（默认 600_000）与 `max_steps`（默认取 M0 盘点结果，建议 60）。
- 超限：`transport.interruptAndContinue`→ settle 收残局 → 返回 `workerStatus:'stalled'` bundle（升级而非静默杀，worker 会话保留，lead 可定向再派）。r5 教训（~80 调用/任务、8.3h）的机械断路器。
- **stalled bundle 必须走完整审计管线**（半成品工作区对 lead 可行动的前提是看得到脏在哪）：中断后照常 candidate snapshot → `auditWorkspace`（changedFiles + unifiedDiff + 静态审计——删测试行/字面量缺失照常采集）→ `runVerification` 照跑（"当前断在哪"正是 stalled bundle 最有价值的诊断；单条 120s/≤6 条上限不动）。**不进 repair 循环**——预算刚耗尽，续跑只会接着烧步数；修复决策交回 lead。
- stalled 追加字段：`stall:{reason:'steps'|'wall', budgetUsed:{steps, wallMs}}`；`lastActivity`（child 最后一条工具调用名 + 参数头，确切字段名待 M0-b 确认 child 暴露面）；note 固定含 "Workspace may be half-edited — the diff shows the dirty state; verify results show the current breakage"。delta 指令完全依赖这些信息——这是 stalled 路径存在的意义。
- **quiescence 门（外部双评审 A-5）**：中断后 `settle` 只有 transport 状态确认 stopped 才进 snapshot→audit；running/unknown（后台 job 残写、子进程未收殓）→ `workerStatus:'quarantined'`：不审计、不进修复，record 标 quarantined，留待下一次 collect 或用户处置——防两写者踩脏工作区后把脏状态当事实记进 bundle。状态机：RUNNING → LIMIT_REACHED → INTERRUPTING → QUIESCENCE_CHECK → STOPPED→完整审计 | UNKNOWN→QUARANTINE。
- **归属竞态顺手修**：dispatch-v3.ts:142 的 base 快照采在 transport.start/continue（:129-135）**之后**，worker 极早期写入可能逃出 diff 归因——把 snapshotWorkspace 移到下发指令之前（一行重排）。
- **任务级 diff 归因（并入外部计划 §1.3-C + 外部双评审三方归因）**：现状 `collectDiff` 的 `git diff HEAD` 两病——①混入用户 dispatch 前未提交修改（用户与 worker 同文件时行级混合，逐文件 git diff 救不了）；②untracked 新文件输出为空（外部双评审 B 微调二）。修法分级：changedPaths 仍走快照 digest 对比（workspace.ts:114 `changedPaths` 现成）；dispatch begin 记**用户预改集 U** = live digest ≠ HEAD 版 digest 的文件（一次 `git diff --name-only`），并**拷贝 U 文件内容**（单文件 size 上限，如 512KB）作真三方基线——前提是快照本体只存 digest（workspace.ts:13-22），不拷内容就无法还原两方分别改了什么；bundle 逐文件生成 unifiedDiff——W∖U：per-file git diff（用户没碰过的文件，HEAD 之后唯一改动者就是 worker）；U∩W：B 副本 vs candidate 内容三方对差分（同文件重叠也精确到 worker 净增量）；added（C 有 B 无）：读现内容格式化 /dev/null→b/path diff；binary、exec 位变化（快照 entry.executable 有）、删除、重命名（快照呈现为删+增）、软链 → note 行标注；**仍不可靠者标 ambiguous 交 lead 裁决**。非 git 工作区维持现 undefined 路径。验收用例见 M2 验收清单（T14）。

**M2.4 提示词协议收口（prompts/model-lead.md → v0.4）**，在 v0.3 基础上增协议条款（保持现有单工具描述不动）：
- **计划优先**：任务首个实质轮，先在回复中输出短计划（目标 / 不变量 / 验收标准 / verify_commands），再发首个 dispatch。计划 = 结果规格，**禁止代码级处方**（不得写具体函数签名/API 串，除非用户逐字要求 —— scim2 教训：brief 写死 model_dump_json，worker 3 轮不敢纠错）；"以运行时与测试为准纠偏"写进协议。
- **delta 指令**：后续轮只把"变化的部分"写进 instruction，worker 是持久会话，不重述上下文。
- **修正性升级**：failed bundle 后的 instruction = 单一问题 + 具体定位（引用 bundle 的 failureTail/警告行），禁止整 brief 重写；收到 M2.1 的两条 note 时必须摊牌给用户或改写指令。接管（Takeover，外部计划 §5.3）在 plan-once 里的形态 = 编排深度升级——拆更细 subtask / 换任务分解 / 建议用户换 worker 绑定 / 向用户摊牌，**不是 lead 绕过 M2.5 边界亲自写文件**：r4 实测 lead 侧执行占 85% 成本，lead 写入正是本方案要消灭的泄漏。
- **绿 bundle 结案**：不再复读文件，引用 verify 结果直接回用户（v0.3 已有，强调成硬规则）。
- **微改处置改写**（v0.3 的 "Small corrective edits you can make directly" 随 M2.5 写边界失效）：pair 模式下一切写走 dispatch——持久 worker 上一条两行 instruction 的成本 ≈ 一次 `transport.continue`，不需要直答车道；小到不值一次 dispatch 的任务由 M3 任务门挡在 pair 模式之外。M6 小任务臂数据若证明痛，再评估受门控的 `fusion_micro_edit`（host 记账 leadChangedPaths 保归因），本期不建。
- prompts/model-worker.md 对应补一条："若 instruction 的实现建议在运行时/测试面前不成立，以测试为准修正并在报告里注明偏差"（对抗 scim2 型过度处方）。
- **Pushback 通道**（并入自外部计划 §5.4，prompt + 透传版，**不建校验器**）：model-worker.md 汇报模板增 Objections 节——instruction 不可实现 / 自相矛盾 / 会破坏既有接口 / 与工作区现实冲突时，停在该点，带证据（文件:行、测试名）提出异议与替代建议，而非盲目完成；AuditBundle advisory 透传（workerSummary 已载全文，无需新字段，注释标明 lead 必读）；v0.4 增条款：**收到 objection 先裁决异议**（改 brief / 补上下文 / 建议换 worker 绑定 / 摊牌给用户），禁止原样重发——scim2-1451 的死法正是 brief 预订错误返回类型、worker 盲从烧完 3 轮。

**M2.5 Pair 模式 Lead 写权限边界（复核后新增；落地先于 M2 一切验收基准）**

现状核实（读码三处，本轮）：
- coordinator.ts:163 `#readOnlyTools`：`if (role !== 'worker') return undefined` —— lead **从不投影，拿全量原生工具表**（undefined = native composition 原样）；连 worker 也只有 explore lane 被 fence（EXPLORE_LANE_TOOLS @ coordinator.ts:47 = ['read','grep','glob','tgrep','read_image']）。
- coordinator.ts:100 `canExecute: () => undefined` —— **执行层零 deny 守卫**。
- 全仓 grep 已无 NativeRoleSandbox / sandbox/mode 翻转 —— 旧"lead 只读"约束机关**连同 PTC 死锁根因已不在代码里**。
→ 结论：**今天 pair 模式的 lead 完全裸奔**，唯一约束是 v0.3 提示词自觉。两个后果：① lead 自写 = 穿 pair 外套的 solo，M2 的 fresh/时间基准语义被污染——本项必须先于基准落地；② M4 原文"删 NativeRoleSandbox"已过时，改为补新边界。

设计（沿用现成机制，不造新轮子）：
- 新常量 `LEAD_LANE_TOOLS`（镜像 EXPLORE_LANE_TOOLS 先例）：读/分析类 + `subagent` + `fusion_dispatch` + 收尾呈现类 + **`run_code`（PTC 依赖保留，外部双评审 B 微调一：安全判据落在内层原语，不拒外层通道，PTC 零死锁）**；**不含 write/edit/move/delete/bash 及一切写/执行原语**。
- 投影面：`#readOnlyTools` 增 lead 分支返回 LEAD_LANE_TOOLS（native-scopes.ts:192 的 projectRoleTools 对任何具体白名单生效；注意 0.2.2-rc.1 上 assembled.tools 可能为 undefined，投影面可能不可用——所以必须有下一条）。
- **执行层兜底（fail-closed 硬门）**：`canExecute` 对 role==='lead' 且调用工具不在 LEAD_LANE_TOOLS 时返回 deny 理由（native-scopes.ts:126-131 的 deny-only guard 先注册先生效，不依赖 SDK 版本）。
- **间接通道封堵（穿透矩阵，外部双评审 A-1）**：① run_code 内层调用走同一 tool registry，guard 按内层原语拒写（外层 run_code 不拒）；② MCP/其他注册写工具 default-deny——不在 LEAD_LANE_TOOLS 一律拒；③ subagent 渗透**已有关侧现成围栏**：coordinator.ts:325-373 `#interceptExplore`（tools/execute prepend :125）拦截 lead 的 subagent 调用、先写 child: 行 lane:'explore'（:345-346 注释明示 agent/created 装配依赖）再 spawn，agent/created 即装只读 scope（#readOnlyTools → EXPLORE_LANE_TOOLS 五件只读），并重路由到 worker 模型（:373）——**pair 模式下该链路成立即无 subagent 写洞**；②③的验收冒烟含 run_code 内层 subagent 调用同被拦截的确认，前提 = coordinator 装配（开放问题 1 关联）。④ 基调 default-deny：白名单投影 + guard 兜底，不做黑名单遮挡。投影管"看得见"，guard 管"做得到"，缺一不可。
- PTC 零交互：本边界全部发生在装配件期与执行期，不产生 mid-dispatch sandbox/mode 事件——旧死锁类结构性消除。
- 归因红利：lead 无写 ⇒ 不存在"lead 在 dispatch 间隙手改文件、混进下一条 bundle 的 diff 记到 worker 头上"的假阳/假阴，audit-v3 的 changedFiles 从此可信任为 worker 产出。"手痒"风险（复核点 3）由能力边界消除，而非提示词自律。

**M2.6 并发互斥与幂等**（并入自外部计划 §1.3-B）
- 窗口窄但真实：dispatch-v3 阻塞 settle 使并发面小，但 runtime-v3 `updateRuntime` 的 CAS 重试是**写**并发兜底、不是**执行**互斥——`dispatchInFlight` 是状态查询（读-判-写有窗口），transport 异常路径 / 启动恢复 / 未来非阻塞化都会踩到双 dispatch 竞争同一 child。
- 修法（全在 host，无新依赖）：coordinator 内存 task 级 in-flight 集合，beginDispatch 前查——冲突直接返回 running-bundle（a dispatch for this task is already in flight）；finish / throw / steered 全路径出集合。
- 幂等：`dispatchId` 唯一键入 DispatchRecord，重复 collect 返回已有 record；协调器启动时把孤儿 running record（无匹配 child 会话）标 interrupted。

**验收**（全绿才进 M4）：
- 三臂基准以 **pair 模式 fusion 臂**重跑，达 0 节门槛（代码拆解 lead fresh ≤70K、QA 转负、小任务达标）；
- M2.5 生效冒烟（外部双评审 A-1 升格为穿透矩阵）：lead 无法直写（write/edit/bash 直接拒，deny 理由引导走 fusion_dispatch）/ 无法经 run_code 内层写 / 无法经 MCP 写 / 无法经 subagent 间接写（#interceptExplore 围栏 + 只读 scope 链路冒烟）/ worker 授权范围可写、读工具不受影响；
- 盲评质量 ≥ solo（用 executor-benchmark 的评分 judge）；
- 升级预算/同指纹拒绝的单元用例（模拟 failed×4、同 hash 重发各断言 bundle note）；
- 换皮预警与 watchdog 用例：Jaccard≥0.8 标记 resendSuspect；模拟超步数 → stalled bundle 含完整审计管线（changedFiles/diff/verify/stall 字段）；
- PTC 预设冒烟：run_code 内 dispatch 不再触发旧 sandbox 翻转死锁（v3 路径不碰 NativeRoleSandbox，需确认 coordinator 残余不拦）；
- steered 路径冒烟：等待中用户插话 → steered bundle → 无 instruction 再收集 → 恢复。
- 并发互斥用例：in-flight 期间第二条 dispatch 直接返回 running-bundle，不产生第二个 child（T09/T11 精神）；
- 429 用例：注入 429 → failed bundle note 含 provider unavailable，**infraAttempts 计数（rework 预算不动）**、不自动换绑；infraAttempts 达上限 → 摊牌换绑 note；
- 未提交修改隔离用例（T14）：用户带未提交修改进 pair 模式，首次 bundle.diff 不含其先前改动；
- pushback 冒烟：构造自相矛盾的 acceptance 指令 → worker 汇报含 Objections → lead 裁决异议而非原样重发（断言不重发同 hash）。

### M3 — 模型菜单通道收口（1 天，可与 M2 并行）

把 judge 逐轮路由降级为"只管读类闲聊"：
- fusion-next.ts:236-260 `llm/stream` hook 的 verdict 缓存（`routeVerdicts`，键 sessionId+text）保持，但 **WRITE_INTENT 命中一律 lead，不再 judge**（分类正则 classifyUserText:190-196 已具备）；judge 仅对 READ_INTENT/短文本细判。
- 任务级 stickiness：检测到"同任务连续 ≥2 个写入轮"时，注入一行升级建议 notice（"本任务实质且多轮，建议 /fusion-next 选定 pair 以获得 plan-once 路由"）——先做建议不做自动切换绑定，观察使用率后再决定自动化。
- `routing.aggressiveWrite` 开关随 M1 落地。

**验收**：QA 臂在模型菜单通道重跑 fresh ≤ solo（读类转发不打断 lead 前缀即达标）；写轮 0 次转发到 worker（除非 aggressiveWrite 开）。

### M4 — 残余清理与目录归属（1 天，M2 验收后；范围经 e74e1c4 复核大幅缩水）

**复核修正（关键，2026-11-19）**：本节原列的"旧仪式机关"大半已被 HEAD = e74e1c4（feat(v3): single-call fusion_dispatch pipeline, drop v2 journal and gates，158 files，+4210/−32150）删净：11 个 fusion_next_* legacy 工具的服务端注册（coordinator.ts 现仅 376 行，全文件 grep 零命中）、#requirements 逐字门、allowedPaths 冻结、turn 劫持（WORKFLOW_INCOMPLETE/NO_PROGRESS）、READ_STREAK 硬幅、NativeWorkflow、NativeRoleSandbox、v2-shadow 九模块全家（router/delegation/optimizer/scheduling/worktree/evidence-gate/write-lease/recovery/compaction 连同对应测试）。**旧清单作废；真正残存物只有四件**：

1. client/FusionTool.tsx:8-10 fusionControlTools 仍列全套 legacy 工具名（服务端已不注册）→ 收成 ['fusion_dispatch']；:16 tracksActivity 判定同步收窄；
2. READ_STREAK_SOFT_CAP=8 软警告残留（coordinator.ts:48 / :316 streak === READ_STREAK_SOFT_CAP）→ 删（读循环信号面已由 bundle/audit 与 M2.3 watchdog 承载；删前确认无提示词依赖）；
3. 存活目录归属判定：src/task/{reducer,state,store,sqlite-store,status-index}、src/review/{dispatch,protocol,ticket}（旧 review-ticket ceremony 残部）、src/context/guard.ts、src/approval/logical.ts —— e74e1c4 没删这些，且其符号全部经 src/index.ts 公开导出（:4-8 task、:23 context/guard、:24 approval/logical、:25-37 review 全条、:39 host/workspace.snapshotWorkspace）——**物理删除 = 破坏下游包 API**（合并兼容性约束：下游二次开发不破坏）。注意 child:* 文档 store seam 是 dispatch-v3 的 live 依赖（dispatch-v3.ts:5 即引自该层）。**M0 出逐目录 import 归属表；处置判式：内部 live 者归入 runtime-v3 账下；内部 dead 但公开导出者 @deprecated（外部双评审 A 微调三：**三档区分——正式 API / 实验性 / 意外导出**，注 Replaced-by 与 Planned removal: next major + 一句迁移说明），不物理删；仅既无内部 import 又非导出者才删**（M4 执行）；
4. prompts 卫生：lead.md / worker.md（中文 agent-scope 旧协议）现被谁引用 → dead 引用删文件，live（bindings persona 路径）则对齐 v0.4。

**保留**：session-pair/bindings、usage/ledger（成本归因基础，北极星指标的服务端）、native-scopes 工具投影（cache 稳定与 M2.5 都靠它）、native-activity、client UI、compact.md 冷却说明。

**验收**：import 归属表入 M0 inventory；三臂复跑无回归；fusionControlTools 与服务端注册一一对应；lead 系统提示 bytes 前后对比。

### M5 — C2 绊线（1-2 天，条件启动）

**启动条件**：M1 B 臂质量稳（worker-only 不塌）或 M2 后仍有"读类闲聊轮产生写文件但无审计"的真实流量需要门。
- 在模型菜单通道给 worker 转发轮挂 host 侧审计：轮开始快照（store 现成）→ 轮结束 `auditWorkspace`（audit-v3 复用）→ 绊线条件 `deletedTestLines>0` 或用户消息字面量缺失 → 以 AuditBundle 形状注入升级 notice 唤醒 lead 处置（修正 dispatch 或直答接管）。
- 这是"执行模型全跑 + 规划模型只被绊醒"的完全体；M5 之前它不存在，故 C2 不承诺时间。

### M6 — 收口：基准复测、文档、发布

- **报告必列北极星指标（本轮采纳）：Cost per Success =（lead+worker 全成本，含修复与返工）/成功交付任务数**；辅以 Rework Rate、Delegation ROI（dispatch vs lead 自做的成本差）、Evidence Pass Rate（交付 bundle 无 Critical 警告占比）、Lead Token Ratio、Merge Conflict Rate（挂在 §7 并行门槛下）、**Lead Avoidance Ratio = 1 - C_lead_actual / C_lead_solo**。判序（外部双评审 A 采纳，与 §0 一致）：**成功交付质量 > Cost per Success > 端到端墙钟 > Lead 节约率**——LAR 升而 CPuS 变差的形态判负，禁孤立优化 LAR。M0 埋点就是这些口径的服务端。
- 三臂 + B 臂终表入 benchmark/baselines/（命名沿用 日期-主题 约定）；
- README/INSTALL 改口径：实质任务 → pair 模式；闲聊问答 → 模型菜单 Fusion；
- RELEASE notes：能力变化（逐轮 judge → plan-once）、迁移注意（旧 fusion_next_* 工具消失）、M4 删除清单；
- 决策记录：C1 默认 / C2 启停 / aggressiveWrite 去留，以 M6 数据定。

---

## 3. 提示词协议 v0.4 增量草案（M2.4 落地物）

```markdown
## Plan-once protocol (v0.4 additions)

You hold no workspace-write capability: every file change reaches the workspace
through fusion_dispatch. Own judgement, not edits.

### Planning turn (first substantive turn of a task)
Before the first dispatch, state a compact plan in your reply: GOAL / INVARIANTS
(what must not change, including "existing tests must keep passing as-written") /
ACCEPTANCE (observable criteria) / VERIFY (commands you pass as verify_commands).
Prescribe OUTCOMES, not implementations. Never write concrete function signatures,
API calls, or code snippets in an instruction unless the user quoted them verbatim.
The worker owns code reality; if your assumption is wrong at runtime, the worker
corrects toward the tests and reports the deviation.

### Follow-up rounds
The worker is a persistent session. Send DELTA instructions only — what changed
this round. Do not restate context, files, or history.

### Corrective escalation (after a failed bundle)
Pinpoint ONE issue per re-dispatch, citing the bundle's failureTail / warning lines.
Never rewrite the whole brief. If the same failure returns:
- "escalation rejected: identical instruction after failure" → your instruction
  had no new information; change it or ask the user. Every corrective re-dispatch
  must name the NEW element: a changed hypothesis, a relocated target, or an
  altered strategy — cosmetic rewording is flagged (resendSuspect) and wastes
  budget.
- "escalation budget exhausted" → STOP dispatching. Present the conflict to the
  user: what was tried (attempts, failing checks, worker summary) and what you
  recommend.

### Failure classification (adjudicate before re-dispatching)
Classify every failed bundle first; never answer every class with the same one-more-try instruction:
- provider unavailable (429/timeout) → wait, or ask the user about switching binding;
- stale context (long worker session, drifted assumptions) → reset_worker with a rewritten delta brief, not the same one;
- capability ceiling (recurring conceptual misses) → recommend a different worker binding to the user;
- wrong decomposition (the brief itself) → replan the delta and own it;
- acceptance contradicts reality (worker Objection) → adjudicate the objection before touching code.

### Close-out (green bundle)
Answer the user directly from the bundle: files changed, verify results, open
items. Do not re-read files the diff already covers.
```

---

## 4. 风险登记

| 风险 | 教训来源 | 对冲 |
|---|---|---|
| worker 天花板（浅而通顺的产出过机械门） | r3：glm-flash solo 8/9 反超 fusion 6/9 | 每臂盲评强制；B/C 臂质量分与 fresh 并列为发布门槛 |
| bundle 12K diff 截断掩盖长文档问题 | audit-v3 DIFF_CAP/UNTRACKED_CAP | 依赖盲评抽查；必要时 docs 类任务 UNTRACKED_BYTES 提到 16K（不动默认） |
| 升级循环复发/换皮绕过 | executor-benchmark：planner 10-20 轮重试、fn 成本 6-15× | M2.1 双硬门（同指纹拒绝 + 预算断路）+ 归一化管线 + resendSuspect 预警，host 级不可绕过 |
| worker 蔓延 | r5：~80 调用/任务、8.3h 墙钟 | M2.3 watchdog 断路 + DispatchRecord 步数埋点入基准报告 |
| 残余旧名误导（UI 列表仍列 11 个已死工具名） | e74e1c4 已删服务端注册，client 列表未跟 | M4 client 清理 + "fusionControlTools ↔ 注册一一对应"校验 |
| PTC 死锁复发 | executor-benchmark-20261114 | v3 不碰 sandbox/mode；M2 验收含 PTC 冒烟 |
| 过度处方 | scim2-1451：brief 写死返回类型，3 轮 rework 不纠偏 | v0.4 协议 + worker 侧"以测试为准纠偏"条款 |
| 压缩联动破坏 | 旧机曾用 read_state 做压缩后门控 | M4 保留判定交 M0 盘点，删除前跑 compaction 冒烟 |
| Pair 模式 lead 裸奔自写（复核发现，现状即如此） | 投影/guard/沙盒三层皆无；solo 穿 pair 外套污染基准 | M2.5 先行，且先于 M2 验收基准落地 |
| 间接写绕过（run_code 内层写 / MCP 写工具 / subagent 子代理面） | 外部双评审指出：投影与黑名单只盖直呼面 | M2.5 穿透矩阵 + default-deny + #interceptExplore 围栏冒烟；subagent 链路现成但前提是 coordinator 装配 |
| V4 过度工程（五层全上、公式路由、并行） | 外部提案复核：预算在预支 M6 才会有的数据 | §7 数据门槛 + §5 明确不做；北极星 = Cost per Success |

## 5. 明确不做的事（防走回头路）

- 不再回到 75s 拆轮等待（dispatch-v3 阻塞 settle 是对的）；
- 不再恢复 requirements 逐字门与 allowedPaths 冻结（已被 advisory 审计替代）；
- 不做"每轮 judge 重新判复杂度"的生产路径（只保留读类转发 + B 臂实验旗标）；
- 不做 mid-session 自动切换绑定（M3 只做建议，观察后再议）；
- 不承诺 C2 时间表（等 B 臂与流量证据）；
- 不做加权评分式模型选择公式（Score = wQ·Q + … 的权重在 n≈44 的基准样本上不可拟合，且会给"便宜但常返工"的模型高分）；采用约束式筛选：能力过滤 → 预算/上下文过滤 → 剩余中选期望交付成本最低者（见 §7）；
- 不建 host 侧 TaskContract 校验器（v0.4 协议的 GOAL/INVARIANTS/ACCEPTANCE/VERIFY 已承载契约信息；旧 review ceremony 的死因就是校验器二选一：要么贵、要么橡皮图章）；
- 不做并行执行 / DAG / Worktree / Merge Coordinator，直至 §7 并行数据门槛被实测满足（默认并行度 0，读类 subagent 探索除外）。
- 不建 v4_* 平行 SQLite 表（executions/usage/evidence 表族）：usage/ledger + runtime-v3 DispatchRecord 已 live 且公开导出，埋点直接扩展字段；平行表 = 数据层 split-brain（v2 之死的新皮肤），关系化抽取等真实查询需求出现再议；
- 不建 models.config.yml 独立模型注册表：bindings + DSH settings 是单一事实源，第二配置面必然漂移；能力/价格画像等 M6 语料成型后挂 bindings 文档；
- 不做 OpenAI-compatible facade / Standalone Runtime / 核心去 DSH 化重构（外部计划 §9 标了 P0，撤级）：与减 lead 用量目标函数零相关，SSE 分片与多轮 tool-call 兼容是整块新接口面；挂 §7 外部化门槛（M6 达标 + 真实外部消费者）。

## 6. 开放问题 → M0 必答

1. 模型菜单模式下 fusion_dispatch 可达性（决定 M3 建议文案与 B 臂对齐组设置）。
2. transport 子会话步数信号源（决定 watchdog max_steps 实现）。
3. SIMPLE 转发轮的写文件审计洞确认（决定 C2 绊线优先级）。
4. read_state 与 compaction 联动归属（服务端 read_state 已疑无注册、仅 client 列表存名；决定 M4 client 清理幅度与压缩门控归属）。
5. #interceptExplore 对 run_code 内层 subagent 调用是否同样拦截（决定穿透矩阵 ③ 的覆盖面陈述与冒烟写法）。
6. transport settle 对后台 job（run_in_background）子进程的收殓状态暴露（决定 quarantined 判据能否确定性实现）。

---

## 7. V4 方向映照（对外部 Devin-style Adaptive Orchestration 提案的裁决）

提案的北极星（以成功交付成本为目标）采纳为 M6 必列指标；五模块（Dynamic Router / Adaptive Brief / Value-of-Delegation / Execution Engine / Evidence Gate）采纳为**职责词汇表与 post-M6 演进方向，不采纳为当下工程**——每层薄版本已在 M 系里，每个升级有数据门槛：

| V4 层 | 现有薄版本（M 系已覆盖/已排） | 升级门槛（未达不建） |
|---|---|---|
| Dynamic Router | bindings 模型选择 + M3 读类转发 + M0 埋点 | 模型×任务类型成功率 ≥20 样本/格（M6 语料长出来）；统计纪律 = Beta-Binomial 置信区间而非均值、新模型小流量灰度、样本薄时保守回退历史最佳；决策程序 = 约束式筛选（能力 → 预算/上下文 → 期望成本最低），禁加权评分公式 |
| Adaptive Brief | v0.4 计划轮协议（GOAL/INVARIANTS/ACCEPTANCE/VERIFY + 禁代码级处方 + delta 指令） | 契约校验器不建（旧 ceremony 死因：校验器要么贵要么橡皮图章）；allowedPaths 冻结语义永不复活 |
| Value-of-Delegation | M2.1 升级预算/同指纹断路 + M1 B 臂读数（委派经济学直接测量） | E[C] = C_exec + P_fail × C_rework 可估时（与 Router 成功率表同源数据）；此前只用粗规则（M3 任务门 + M2.1 预算） |
| Execution Engine | Lead = M2.5 无写边界；Worker = 持久 worker；Explorer = EXPLORE_LANE_TOOLS + subagent；Direct = pair 外闲聊车道（M3） | 并行层：任一基准任务类实测"墙钟由串行主导 + 子任务真独立"才开，默认并行度 0——基准瓶颈实测是 worker 调用数（~80/任务）与模型延迟（swe-2 43-50s vs glm 78-134s），并行会放大最贵项而非消掉它 |
| Evidence Gate | audit-v3 全管线 + M2.3 stalled 完整审计；severity 即分级：Critical = verify 失败/删测试行（已硬门），Warning = 改既有测试文件/字面量缺失（刻意 advisory，click-3239 教训：冻结挡了该改的测试），Info = 记录 | L2 独立 Judge = M5 C2 绊线（确定性风险信号触发：任务类启发 + 失败史 + Critical bundle，不常驻）；L3 = 用户本人，交付报告即其触点 |
| 外部化（OpenAI facade / Standalone Runtime） | 无；transport + catalog adapter seam 即解耦面，不重构目录树 | M6 指标达标 **且** 出现真实外部消费者（双门槛，缺一不开） |

"哪些 v2 模块值得接回主链"已答：**一个都不接**。e74e1c4 删除的九模块不是"被绕过"，是 v2 journal/gates 的本体，死于三项已归档的工程病（split-brain 双写、PTC 死锁、ceremony 翻车，见 benchmark/baselines 与 §4 风险表）；V4 若需要同能力，按上表薄版本重造薄版本，不从尸体上接生。

---
*附：本方案对上方压缩块的依赖 —— fusion-next.ts:214-260 路由与 judge、dispatch-v3.ts 全流程、audit-v3.ts 常量与接口、runtime-v3.ts 形状、coordinator.ts:191/267 接线、model-lead.md v0.3 现况，均已按本会话读码事实落锚。*
*附2（e74e1c4 事实基线，2026-11-19 复核）：HEAD = e74e1c4 "feat(v3): single-call fusion_dispatch pipeline, drop v2 journal and gates"，158 files，+4210/−32150。现规模：fusion-next.ts 545 行、coordinator.ts 376 行、dispatch-v3 203 行、audit-v3 178 行、runtime-v3 102 行；服务端无 fusion_next_* legacy 注册；v2 九模块（router/delegation/optimizer/scheduling/worktree/evidence-gate/write-lease/recovery/compaction）已物理删除，全仓无人 import。*
