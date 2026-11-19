# Install Fusion Next

[中文](INSTALL.zh.md) · Product pages: [README.md](README.md) (中文), [README.en.md](README.en.md)

Requires **DeepSeek Harness ≥ 0.2.0-rc.2** (verified on DSH NEXT 0.2.2-rc.1).

## DSH Studio desktop app (recommended)

Click **Plugins** in the left sidebar → **Add plugin**, and enter in "Package name or address":

```text
github:bunpai/fusion-next
```

The release ships the built `lib/`; no clone or build is needed. Then quit and reopen DSH Studio (plugins take effect at the next start).

## Web CLI

```sh
dsh plugin --profile web add github:bunpai/fusion-next
```

## From source

```text
github:bunpai/fusion-next
```

## Uninstall

Plugins → installed list → Fusion Next → remove. Its records in `$DSH_HOME/plugins/fusion-next/` can be deleted after quitting DSH.
