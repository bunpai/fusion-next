# Fusion Next · DSH 插件

[English](README.en.md) · [安装](INSTALL.zh.md) · [Install (English)](INSTALL.md)

Fusion Next 给每个会话配一对**规划（Lead）/ 执行（Sidekick）**两个真实模型：一个强的前沿模型负责理解需求、看代码、写任务说明、审查结果；一个便宜得多的模型负责实际改代码、跑命令、跑测试。

目标只有一个：**用前沿模型的效果，付打折的价钱。**

它不是模型菜单里的"假模型"——在会话自带的模型选择器旁边会出现第二个选择器**「执行」**：选一个执行模型就开启了这个会话的 Fusion 编队，选「关闭」就退出。每个会话各配各的。

本项目是 [dsh-model-fusion](https://github.com/aa2246740/dsh-model-fusion) 的独立重写版，身份、协议和 UI 都已分离。思路受 Cognition 在 Devin 里推出的 Fusion 启发，与 Cognition 无关。

## 安装

```sh
dsh plugin add github:bunpai/fusion-next
```

或下载 release 页面最新 tarball。要求 `dsh >= 0.2.0-rc.2`（已在 DSH NEXT 0.2.2-rc.1 实测）。

装好后在任意会话的输入框模型选择器旁选「执行 → 某模型」即可。

## 工作方式（v0.3.x · plan-once）

1. **规划一次**：Lead 先把需求看清，产出一份计划——目标、不可变量、验收方式、验证命令，然后全程只做调度与终审。
2. **一次委派**：Lead 调用 `fusion_dispatch`（唯一的融合工具），把一段执行说明和可选的 `verify_commands` 交给 Worker。Worker 是持续存在的子 agent 会话，跑执行模型、持有完整写工具。
3. **无人值守流水线**：一次 dispatch 内部不间断完成「Worker 干活 → 工作区快照审计 → 跑验证命令 → 失败自动返工（≤2 轮）」，Lead 拿回一个 AuditBundle：改动文件清单、unified diff、静态审计（动测试文件/删测试行/缺失要求文件）、逐条验证结果、返工轮数。
4. **预算化升级**：执行失败消耗每任务 3 次的返工预算，相同指令重发直接拒绝；429/超时等基建错误另有独立重试预算。Worker 卡死由看门狗兜底（wall/steps 超限 → 打断 → 静默确认 → 全量审计出 stalled bundle；仍在搅则 quarantined）。
5. **硬边界**：编队模式下 Lead 的工具面只有只读 + 控制面——写文件必须走 dispatch，deny 是强制的不是劝说的。模型菜单模式下转发给执行模型的整轮由 tripwire 事后审计，命中删除测试行/缺失要求文件时下一轮强制回 Lead。

标准（standard）、创造（cordis）、PTC 三种 agent 预设下均已验证端到端可用；Lead 与 Worker 可以来自不同 provider。

## 界面

- **执行选择器**：输入框模型选择器旁，选模型即开启、选关闭即退出
- **token 徽章**：选择器旁显示执行模型本会话消耗与缓存命中率，点开看每模型明细（输入/缓存读/输出/调用次数）
- **会话页签「Fusion Next」**：当前会话的组合、任务阶段、请求与用量
- **侧栏「Fusion Next」面板**：所有在编会话一览（运行中 / 历史与统计 / 缓存保活）
- **设置 → Fusion Next**：默认组合与缓存保活策略

## 实测（22 题 × 2 seed × 5 执行器）

隔离实例（DSH NEXT 0.2.2-rc.1，PTC 预设，Lead 固定 devin/swe-2）上跑了 22 题（12 通用 + 10 真实 QT C++ 机台仓库题）× 每执行器 × 2 seed，Fusion 臂成功率 95–100%，单模型臂 81–100%；Lead+Sidekick 全程 token 成本按公开 API 价折算约为 swe-2 单臂的 1/8。完整数据：[benchmark/baselines/report.md](benchmark/baselines/report.md)。

## 数据存在哪里

- **Fusion Next 自己的记录**：任务、检查、用量、设置都在 `$DSH_HOME/plugins/fusion-next/state.sqlite`（`DSH_HOME` 默认 `~/.dsh`）。
- **会话本身**：由 DSH 保存，插件不上传任何数据。
- 删掉该文件即可清空；设置会重置。

## 开发

```sh
corepack pnpm@9.15.9 install --frozen-lockfile
node scripts/link-host.mjs /path/to/deepseek-harness      # 开发时链接 DSH 源码
DSHX_HARNESS=/path/to/deepseek-harness pnpm build
pnpm test          # 30 文件 / 154 测试
node scripts/build-local.mjs   # 无 harness 源码时的本地构建
```

插件只使用 DSH 公开插件接口，不修改 DSH 源码。适配新版 DSH 的做法见 [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md)。

## 许可

Apache-2.0
