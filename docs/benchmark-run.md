# 三臂基准 — In-Host 执行（2026-11-12）

范围：隔离 DSH NEXT 2.0.22-next（0.2.2-rc.1）测试实例 `~/dsh/dsh-test-home`，真实 cpa Provider 往返。原始聚合：`benchmark/baselines/three-arm-in-host-20261112.json`（由 session 日志重算，可审计）。

## 设置

- 任务集：5 个确定性短任务（乘法/加法/倒序/求和/len），每臂每 seed 一轮，3 seeds。
- 臂定义：
  - `direct`：物理模型 cpa/devin/swe-2（白名单中最强）。
  - `fusion-next`：本仓库 bundle，Lead=cpa/devin/swe-2，Worker=cpa/devin/swe-2-flash（lifecycleBridge operator-attested）。
  - `fusion-fixed`：原版 dsh-model-fusion@0.2.11 bundle（生产装机版）。
- 指标来源：`session.v4.jsonl.zstd` 日志的 turn/start→turn/end 时间戳、assistant/message 文本、stream chunk usage、replayState 物理路由。
- 驱动：in-page `api/session/create|selectModel|prompt` RPC（与 GUI 同一通道）。

## 结果

| 臂 | runs×turns | 成功率 | P50 延迟 | P95 延迟 | mean out tok | mean in tok | 物理路由 |
|---|---|---|---|---|---|---|---|
| direct | 3×15 | **15/15 = 100%** | 4005ms | 11700ms | 55 | 5362 | cpa/devin/swe-2 |
| fusion-next | 3×15 | **15/15 = 100%** | 3300ms | 7682ms | 44 | 8590 | cpa/devin/swe-2（经虚拟提供者委派 Lead） |
| fusion-fixed | 1×5 | **0/5 = 0%** | 5ms（全部即时失败） | 6ms | — | — | 无（未达 LLM 调用） |

`fusion-fixed` 全部 5 个 turn 以 `scope.tools.presentAs is not a function` 立即失败 —— 正是本次会话修复的 0.2.2-rc.1 兼容缺陷；这是真实且可复现的基线结果，不是测量噪声。

## 读数

- 本 Host 版本上，Fusion Next 成功率与强 Direct 持平（100% vs 100%，满足 §15 "success ≥ strong baseline" 的定性方向），P50 延迟不劣化（3300ms ≤ 1.5×4005ms）。
- fusion-next mean in-tokens 高于 direct（8.6K vs 5.4K）：Fusion 会话注入了 Fusion 工具/上下文（约 +3.2K tok/turn），成本项如实记录。
- 旧插件在本 Host 版本完全不可用 → “既有 Fusion”臂无法贡献性能基线，仅提供 0% 兼容基线。

## 局限（诚实声明）

- 任务集为 5 个微任务 ×3 seeds，非 §15 的“隐藏验证任务集”；规模不足以支撑 −30% 成本/99% 恢复率结论，仅证明机制端到端成立。
- fusion-fixed 仅 1 seed（失败模式确定性，多 seed 无信息量）。
- direct/fusion-next 使用同一物理 Lead 模型，路由差异未体现（白名单模型有限）。
- token 计量无重复（2026-11-12 证据修正此前推测）：session 投影 `tokenUsage` totals 精确等于每 turn 单条 usage 之和（uncachedInput 13508 / output 220 / cacheRead 162176）— 委派的物理调用不产生第二条计量记录。
