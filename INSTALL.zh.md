# 安装 Fusion Next

[English](INSTALL.md) · 产品页：[README.md](README.md)（中文）、[README.en.md](README.en.md)

要求 **DeepSeek Harness ≥ 0.2.0-rc.2**（已在 DSH NEXT 0.2.2-rc.1 实测）。

## DSH Studio 桌面应用（推荐）

在左侧栏点 **插件** → **添加插件**，在「包名或地址」里输入：

```text
github:bunpai/fusion-next
```

发布包已含构建产物 `lib/`，无需克隆或编译。装完退出并重新打开 DSH Studio（插件在下次启动时生效）。

## Web CLI

```sh
dsh plugin --profile web add github:bunpai/fusion-next
```

## 源码安装

```text
github:bunpai/fusion-next
```

## 卸载

插件 → 已安装列表 → Fusion Next → 移除。记录文件在 `$DSH_HOME/plugins/fusion-next/`，退出 DSH 后可删除。
