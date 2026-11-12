# 三臂基准 — 隔离 Host 内真实 Provider 执行

**环境**：隔离测试实例（`DSH_HOME=~/dsh/dsh-test-home`，DSH NEXT 2.0.22-next / 0.2.2-rc.1 内核），cpa Provider（ai.8823823.xyz/v1），凭据经实例 `.credentials.yaml` 注入。
**驱动**：页内 `fetch api/session/create|selectModel|prompt`（api/* 不接受 curl，需 piggyback 页面认证）；指标从 session journal（zstd）重算。
**产物**：`benchmark/baselines/three-arm-in-host-scaled-20261112.json`（144 条逐轮记录），早轮微任务版 `three-arm-in-host-20261112.json`。

## 规模化执行（24 任务 × 3 种子，2026-11-12）

任务集：24 个确定性微型任务（6 算术 / 6 字符串 / 6 代码 / 6 多步推理），每臂每种子独立会话。

| 臂 | 模型 | 完成率 | 正确率 | P50 延迟 | P95 延迟 | 平均输入 tok | 平均输出 tok | 平均缓存读 |
|---|---|---|---|---|---|---|---|---|
| direct | cpa/devin/swe-2 | 72/72 = 100% | 100% | 5056ms | 7578ms | 1831 | 68 | 31461 |
| fusion-next | lead swe-2 + worker swe-2-flash | 72/72 = 100% | 100% | 5066ms | 10100ms | 1485 | 51 | 34928 |
| fusion-fixed | 装机版 dsh-model-fusion@0.2.11 | 0/5 = 0% | — | — | — | — | — | — |

- **fusion-fixed 基线**：全部 turn 即死 `scope.tools.presentAs is not a function`（0.2.2-rc.1 宿主移除了该 API；正是本会话 ba02242 修复的兼容缺陷）。这是真实版本偏斜基线，不是测试 bug。
- **P50 持平**（5056 vs 5066ms，Fusion 虚拟提供者委托路径无显著开销）；**P95 偏高**（10100 vs 7578ms），长尾来自 fusion-next 臂个别 12.6s 轮次（首轮冷启动 + 委托链路额外一步）。
- **fusion-next 输入 token 更低**（1485 vs 1831）：Fusion 上下文注入与直发路径的系统提示词结构不同；输出亦更短。
- **正确性按期望子串判分**：24 个答案确定性任务全部命中。

## 早轮微任务执行（5 任务 × 3 种子，仅作基线对比）

| 臂 | 成功率 | P50 |
|---|---|---|
| direct | 15/15 | 4005ms |
| fusion-next | 15/15 | 3300ms |
| fusion-fixed | 0/5 | 5ms 即死 |

## 诚实边界（对照 §15 发表门槛）

- 这 **不是** §15 隐藏任务集：24 个公开微任务 vs 发表要求的隐藏验证集；成功率 ≥ 强 Direct 在该任务集上已实测成立，成本 −30% 与恢复率 ≥99% 需要用计费数据与恢复场景另行测算（本集无成本维度，无恢复故障注入）。
- 单版本验证（0.2.2-rc.1）；0.2.0-rc.2 双版本验收按用户决定放弃。
- fusion-fixed 臂仅 5 轮（确认即死后即停，不再烧配额）。
