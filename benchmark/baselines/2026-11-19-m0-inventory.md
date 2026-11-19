# M0 盘点基线 — 2026-11-19 (HEAD e74e1c4 + M0 埋点 diff)

## 基线命令留档

| 命令 | 结果 |
|---|---|
| pnpm typecheck (tsc --noEmit) | 0 errors |
| vitest | 27 files / 137 tests 全过 |
| node scripts/build-local.mjs | lib/fusion-next.js + lib/client.js 产出成功 |
| 环境 | Node ≥22.14, pnpm 9.15.9 |

SQLite 结构（documents 表，checksum=sha256(json) 强制）；settings 键：settings:profile（lead/worker route + reasoningEffort）、cache-setting、session-pair:worker；公开 API：src/index.ts 导出 task/review/context-guard/approval-logical/host 全条（M4 归属判定的兼容性约束）。

## 开放问题 6 答（§6）

1. **模型菜单 fusion_dispatch 可达性**：可达 — catalog 模式 selection 变化 → native-selection selectBeforeAssembly → coordinator.select → binding+runtime 装配，dispatch 工具注册在 lead scope。
2. **步数信号**：无显式 API；watchdog 信号 = child.session.snapshotEvents() 计 assistant/message 数（workerStepCount 已实现于 dispatch-v3）。transport.interruptAndContinue 可作 watchdog 断路原语。
3. **SIMPLE 转发写审计洞**：确认存在 — llm/stream 转发轮共用 session 工具集、worker 模型直写文件、零 AuditBundle。C2 前提成立。
4. **read_state**：服务端注册已删（tool-table.ts:20 仅注释 + FusionTool.tsx 客户端列表存名）→ M4 客户端清理确认。
5. **run_code 内层 subagent**：#interceptExplore 挂 tools/execute waterfall 且判 exec.name==='subagent' — PTC 内层 tools.subagent 走同一 registry/pipeline → 同被拦截（机制确认，M2.5 穿透矩阵冒烟再验）。
6. **settle 后台 job 收殓**：native-worker.ts 无 job 引用；worker 的 run_in_background 任务在 settle 后可能仍在跑 → quiescence 判据只能是启发式，quarantined 路径（M2.3）必须保留以兜 unknown 态。

## 模块归属（六栏：Active / Dormant / Removed / Replaced / Missing / Compatibility）

| 模块 | 状态 | 调用方 | 被调用 | 测试 | 处置 |
|---|---|---|---|---|---|
| host/dispatch-v3.ts | Active | coordinator.ts, fusion-next.ts(dispatchInFlight) | runtime-v3, audit-v3, native-worker, workspace | tests 覆盖 runDispatch | 保留 |
| host/audit-v3.ts | Active | dispatch-v3 | host bash seam, workspace | audit 单测 | 保留 |
| host/runtime-v3.ts | Active | dispatch-v3, coordinator, fusion-next | store CAS | runtime 单测 | 保留 |
| host/coordinator.ts | Active | fusion-next.ts | 全部 host seam | coordinator 单测 | 保留 |
| host/native-worker.ts | Active | dispatch-v3 | subagents.startActivation/settle seam | transport 单测 | 保留 |
| host/native-scopes.ts | Active | coordinator | registerScope/waterfall | scopes 单测 | 保留（M2.5 挂点） |
| host/native-selection.ts | Active | fusion-next.ts | coordinator, bindings | selection 单测 | 保留 |
| host/native-activity.ts | Active | coordinator, dispatch-v3 | store | 单测 | 保留 |
| host/native-auxiliary/-usage/-effects/-keepalive | Active | coordinator/fusion-next | store, llm | 单测 | 保留 |
| host/workspace.ts | Active | dispatch-v3, audit-v3 | fs digest | 单测 | 保留 |
| host/tool-table.ts | Active (注释残) | coordinator | — | — | 保留（注释更新 M4） |
| host/bindings.ts, settings.ts, http.ts, cache-policy.ts, cache-defaults.ts, session-pair.ts, history.ts, model-output.ts, shell.ts, subagent-seam.ts, prompts/ | Active | fusion-next.ts | — | 单测 | 保留 |
| task/{reducer,state,store,sqlite-store,status-index}.ts | Active (导出 API) | index.ts 公开导出; dispatch-v3 用 store seam (child: 文档) | — | task 单测 | Compatibility — 不删, @deprecated 判定 M4 |
| review/{dispatch,protocol,ticket}.ts | Dormant-exported | 仅 index.ts 导出 | — | review 单测 | Compatibility — 内部 dead 但公开, M4 @deprecated 不物理删 |
| context/guard.ts, approval/logical.ts | Dormant-exported | 仅 index.ts 导出 | — | 单测 | 同上 |
| 11x fusion_next_* legacy 工具 | Removed | 服务端零注册; 仅 FusionTool.tsx:9 客户端列表存名 | — | 已删 | M4 客户端清理 |
| prompts/lead.md, worker.md | Dormant? | bindings persona 路径 OR dead | — | — | M0-4 遗留: M4 判定引用面 |
| v2 九模块 + NativeWorkflow/RoleSandbox/budget | Removed | — | — | — | 不复活 |

## 埋点 diff（已合入本地，待提交）

DispatchRecord += {workerSteps?, bundleBytes?, wallMs?, failureSignature?}; dispatch-v3 记 t0/stepBase + finish 注入; audit-v3 VERIFY_TIMEOUT clamp [120000,3600000] + DispatchArgs.verify_timeout_ms。
