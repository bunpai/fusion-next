# Fusion Next · DSH 插件

[English](README.en.md) · [安装](INSTALL.zh.md) · [Install (English)](INSTALL.md)

Fusion Next 给每个会话配一对**规划（Lead）/ 执行（Sidekick）**两个真实模型：一个强的前沿模型负责理解需求、看代码、写任务说明、审查结果；一个便宜得多的模型负责实际改代码、跑命令、跑测试。

目标只有一个：**用前沿模型的效果，付打折的价钱。**

它不是模型菜单里的"假模型"——在会话自带的模型选择器旁边会出现第二个选择器**「执行」**：选一个执行模型就开启了这个会话的 Fusion 编队，选「关闭」就退出。每个会话各配各的。

本项目是 [dsh-model-fusion](https://github.com/aa2246740/dsh-model-fusion) 的独立重写版，身份、协议和 UI 都已分离。思路受 Cognition 在 Devin 里推出的 Fusion 启发，与 Cognition 无关。

## 安装

```sh
dsh plugin add https://github.com/bunpai/fusion-next/releases/download/v0.1.1/fusion-next-0.1.1.tgz
```

或从源码：`github:bunpai/fusion-next`。要求 `dsh >= 0.2.0-rc.2`（已在 DSH NEXT 0.2.2-rc.1 实测）。

装好后在任意会话的输入框模型选择器旁选「执行 → 某模型」即可。

## 工作方式

1. **委派**：Lead 通过 `fusion_next_delegate` 把任务说明（brief + 验收命令）交给 Sidekick，Sidekick 以独立子 agent 会话开工，有自己的模型路由和工具面。
2. **验收**：Lead 跑你定义/它定义的验收命令（编译、测试、检查输出），不是"看着像就行"。
3. **评审**：Lead 用 `fusion_next_review_result` 接受或返工；返工会带着具体意见回到 Sidekick。
4. **边界**：任务在写时 Lead 持有读权限；Sidekick 在工作区写、跑命令。文件归属与越权由插件的 generation/authority 账本约束，不靠口头约定。

标准（standard）、创造（cordis）、PTC 三种 agent 预设下均已验证端到端可用；Lead 与 Sidekick 可以来自不同 provider。

## 界面

- **执行选择器**：输入框模型选择器旁，选模型即开启、选关闭即退出
- **token 徽章**：选择器旁显示执行模型本会话消耗与缓存命中率，点开看每模型明细（输入/缓存读/输出/调用次数）
- **会话页签「Fusion Next」**：当前会话的组合、任务阶段、请求与用量
- **侧栏「Fusion Next」面板**：所有在编会话一览（运行中 / 历史与统计 / 缓存保活）
- **设置 → Fusion Next**：默认组合与缓存保活策略

## 实测（22 题 × 2 seed × 5 执行器）

隔离实例（DSH NEXT 0.2.2-rc.1，PTC 预设，Lead 固定 devin/swe-2）上跑了 22 题（12 通用 + 10 真实 QT C++ 机台仓库题）× 每执行器 × 2 seed，Fusion 臂成功率 95–100%，单模型臂 81–100%；Lead+Sidekick 全程 token 成本按公开 API 价折算约为 swe-2 单臂的 1/8。完整数据：[benchmark/baselines/executor-benchmark-20261114.report.md](benchmark/baselines/executor-benchmark-20261114.report.md)。

## 数据存在哪里

- **Fusion Next 自己的记录**：任务、检查、用量、设置都在 `$DSH_HOME/plugins/fusion-next/state.sqlite`（`DSH_HOME` 默认 `~/.dsh`）。
- **会话本身**：由 DSH 保存，插件不上传任何数据。
- 删掉该文件即可清空；设置会重置。

## 开发

```sh
corepack pnpm@9.15.9 install --frozen-lockfile
node scripts/link-host.mjs /path/to/deepseek-harness      # 开发时链接 DSH 源码
DSHX_HARNESS=/path/to/deepseek-harness pnpm build
pnpm test          # 86 文件 / 638 测试
```

插件只使用 DSH 公开插件接口，不修改 DSH 源码。适配新版 DSH 的做法见 [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md)。

## 许可

Apache-2.0
