# 程序员调酒台 / Programmer Mixology 1.2.0

> `LOCAL FIRST  /  TASTE → RULES → AI → VALIDATION`

完整中英图文介绍见 [中文首页](../README.md) / [English](../README.en.md)。
架构与营养学探索方向见 [ARCHITECTURE](../docs/ARCHITECTURE.md)，操作说明见 [USAGE](../docs/USAGE.md)。

This directory contains the production Tauri 2 + React/TypeScript + Rust + SQLite implementation.
本目录是生产项目；根目录的 Python 参考实现用于规格验证，不作为网络后端运行。

内置 300 杯基础酒谱与 96 杯小董笔记 DLC。DLC 默认启用，源文档与编辑补全记录随源码公开。
The 96-drink Xiaodong notebook DLC is bundled with the 300-entry base catalog and enabled by default.

## Build / 构建

需要 Node.js 24、pnpm 11、Rust stable、Visual Studio C++ Build Tools、Windows SDK 与 WebView2。
构建助手仅为当前终端发现工具，不安装工具、不提权。

```powershell
# From repository root / 在仓库根目录
. ./product/scripts/enter-build-env.ps1
pnpm --dir product/apps/client install --frozen-lockfile
pnpm --dir product/apps/client test
pnpm --dir product/apps/client build
cargo test --workspace --locked --manifest-path product/Cargo.toml
cargo build --release --locked --manifest-path product/Cargo.toml -p pixel-mix
python product/scripts/generate-sbom.py
./product/scripts/build-windows-installer.ps1
```

安装器构建额外需要 NSIS；脚本从 `$env:NSIS_EXE` 或当前用户 Tauri NSIS 缓存查找工具。
The installer build also requires NSIS, discovered through `NSIS_EXE` or the per-user Tauri NSIS cache.

新包为 `packaging/installer/Programmer_Mixology_Setup_1.2.0_x64.exe`，当前用户安装、无系统标题栏、未签名，要求已有 WebView2。
This is a real unsigned Windows x64 installer with native pixel chrome, not a source ZIP.

兼容标识 `local.pixelmix.workbench`、`pixel-mix.exe` 和 `.timermix` 保留；改名不迁移或清空旧数据库。
Compatibility identifiers and archive formats remain unchanged. Renaming does not erase user data.

## Evidence and licenses / 验证与许可

本轮验证见 [BUILD_REPORT](BUILD_REPORT.md) 与 [STATUS](STATUS.md)。
Code and project-original resources: [MIT](../LICENSE). Upstream licenses and source attributions: [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES.md).
真实模型推理、两台物理设备的 LAN 验收、签名及移动原生安装包仍不在本轮已验证范围。
Real-model inference, two-device LAN acceptance, signing and native mobile packages remain unverified.
