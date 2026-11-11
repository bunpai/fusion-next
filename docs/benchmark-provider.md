# Benchmark Provider 与三臂协议（实现状态）

用户决策（2026-11-11）：Provider 端点复用 DSH 的 LLM 配置（profile `cpa` provider），不引入额外通道；本机未运行独立 CPA 服务（8317 已停），密钥由 DSH 宿主环境注入（`CPA_API_KEY`，bench 代码只从环境读取、绝不内联/猜测）。

## 已实现（本地可验证）

- **`src/benchmark/llm.ts`** — 镜像 DSH profile `cpa` 块（`~/.dsh/profiles/desktop/cordis.patch.yml` 的 22 个模型，含 deepseek-v4.1-flash 400k/256k 等），`DshLlmClient` 走 openai-responses（POST `{baseURL}/responses`），密钥仅从 `config.apiKeyEnv` 环境变量解析，缺失即抛 `CPA_KEY_UNAVAILABLE`（fail-closed）；reasoning effort 按模型表映射，未声明即拒绝；429/超时以 `BENCHMARK_HTTP_<status>` 抛出供故障分类。测试注入 fetch，零网络。commit `6f8a79a`。
- **`src/benchmark/arms.ts`** — 三臂聚合器（strong-direct / fusion-fixed / fusion-next），成功率/取消率/UNVERIFIED 率、P50/P95 延迟、均值成本；执行器抛错→FAILED+notes。commit `be67ad4`。测试 3/3。
- 用量→预算：`BudgetService.estimate` 接受 usage（input/output/cacheRead），未定价路由返回 `{priced:false}`——与 G02「未知价格不视为免费」一致。

## 机制验证（非基准结果，禁止引用为指标）

- 2026-11-11 经 harness subagent（即 DSH 自身 LLM 链路）完成一次 mechanics smoke（固定算术任务，结构化单行回复）——仅证明「任务→代理→结构化结果」链路可用；**无成本/延迟指标，不计入任何臂**。

## 发布级基准的前置条件（NOT_VERIFIED）

1. fusion-fixed / fusion-next 两臂必须在真实 Host 内运行（插件被 Host 装载、预算经 G02 BudgetService 强制）——需 Host 环境。
2. 发布级数字须满足 §15：多 seed、固定预算、同 commit/工作区/工具、失败与取消如实入账、双 Host 版本（rc.2/rc.5）。
3. 模型单价表 `priceVersion` 目前只有 `benchmark-local-estimate`（本机估算价）；真实计费单价须由操作者提供后更新，未提供前成本列只能以「估算」口径呈现。
