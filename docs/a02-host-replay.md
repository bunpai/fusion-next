# A02：事件序列复现协议（模拟证据，不是 Host 验收）

## 证据状态

- **模拟 replay：PASS（运行测试后填写准确测试结果）**。`tests/fixtures/a02/*.json` 全部是**手工编制的规范性合成事件** (`provenance: synthetic-model`)，`tests/fixtures/a02/replay.ts` 是纯测试态状态机；绝不是来自运行的 DSH Host / GUI、网络调用、真实存储或日志。
- **真实 Host GUI：BLOCKED / 待检**。本环境无 `DSHX_HARNESS`，未执行以下四种 UI 验收；不能将模拟通过写成 Host 集成通过。
- 当前代码 `src/host/native-selection.ts` 存在 `agent.session.header.parentSession` 的早退检查，fork 能否独立激活并没有被这些模拟 fixture 证明；而非 Fusion 切换在该实现中调用 `coordinator.clear(agent)`，不能由模拟测试推断已实现安全 suspend/resume。
- A02 的 JSON 事件名称是**测试侧抽象语义**，并非声称 Host 正式 event type；真正 Host `session/event` 的原生 `model/selection`、`agent/status`、`agent/request` 与实际持久化记录需要独立采集。

## 可重复重放

```sh
pnpm exec vitest run tests/a02-replay.spec.ts --configLoader runner
pnpm exec vitest run --configLoader runner
pnpm run typecheck
```

每个 JSON 的 `events` 为严格的给定输入顺序，`expected.timeline` 为逐事件期待顺序，`expected.sessions` 为最终投影；测试逐项 `toEqual`，并验证 `violations=[]`。故意变异的用例覆盖路由错误、fork 未显式选择、切换时尚有请求未结算，以及两分支交叠执行和分别结算。JSON 不含墙钟时间、随机 ID、外部请求，因此重复执行确定性一致。

| 场景 | Fixture | 关键检查点 |
| --- | --- | --- |
| 原生菜单 Fusion 进入/退出 | `tests/fixtures/a02/menu-enter-exit.json` | open→activate→select Fusion→request→settle→select ordinary→ordinary request；切出前已 drain |
| 历史 session 激活 | `tests/fixtures/a02/history-activation.json` | open(history, persisted Fusion selection)→activate→首请求→settle |
| fork 后激活 | `tests/fixtures/a02/fork-activation.json` | parent selected→fork→**child 明确 select**→activate→request；不得默认继承活跃权限 |
| 两分支并发 | `tests/fixtures/a02/parallel-branches.json` | fork A/B→分别 select/activate→request A→request B→settle B→settle A；请求互不结算 |

## 真 Host GUI 录制步骤及期望证据（目前均 BLOCKED）

1. **准备**：在实际 Host 的测试 profile 中启用 Fusion，明确配置可授权的 Lead/Worker；使用新建测试 session 与独立的历史 session；记录 Host 版本、插件 commit、配置能力、采样时区和时间戳，禁止记录密钥、消息私密正文或令牌。若无安全的可用上游授权，不应发实际生成请求。
2. **录制**：每场景录屏或连续截图（显示 session/branch ID 与菜单选择）；收集 Host event log 中的原始 session ID、parentSession、`model/selection`、agent lifecycle、request start/end、plugin binding 状态及模型 route；各事件分配有序序号和关联 ID，跨分支用 happens-before 而不是任意墙钟排序。敏感信息脱敏。
3. **菜单切入/切出**：普通模型 session → 模型菜单选择 `Fusion · 自动` → 等待首请求进入物理 Lead route → 请求 settle → 菜单切回普通模型 → 下一请求走普通 route。应能证明退出前 drain，无 Fusion scope 遗留，普通 route 不经 Fusion 代理；异常切换另行记录可见错误，不应掩盖。
4. **历史 session**：重启 Host / 重新打开已有选择 Fusion 的旧 session（包括无 binding 的历史记录）→ 激活 → 请求。需证明首次 prompt/tool assembly 前只建立一个对应 Run/binding、历史选择未被物理 Lead header 覆盖，重复激活无重复创建。
5. **fork**：从选中 Fusion 的 parent fork child，先检查 child 未自动取得 parent 活跃执行权限；在 child 显式选择并激活 Fusion → 请求。记录 parent/child 各自 ID、parent lineage、binding/Run/generation、请求路由及恢复信息。若 GUI 不能对 child 选择/激活，判 **FAIL / 待修复**，不要拿模拟通过抵消。
6. **并发**：从同一 parent 派生 A/B，独立激活；让 A/B 请求时间窗口交叠，先结束 B 再结束 A；记录两组 request/correlation ID、agent lifecycle、worker ownership、effect IDs、路由、持久状态；须证明 B 的完成/停用不清空 A 的 task、权限或 inflight 记录。
7. **对照与验收**：将已脱敏原始事件导出为单独的 `recorded` 证据（必须标注 Host 版本、采样 provenance、录制时间及完整性）；用映射器将真实事件转换为本协议抽象事件后对比顺序和状态，附录屏路径、日志哈希、实际断言与任何失败。**未采集的条目维持 BLOCKED**；不得将 fixture JSON 改写为假装 Host 已采样。

## 已知边界

本 A02 交付仅验证合成事件协议的确定性及必要不变量，无法验证真实 Host 接口时序、异步竞态、真实模型成本/效果、fork scope 的实现或可用 GUI。后续 C01/C02/C03/D03 需要基于真实日志补足集成断言。
