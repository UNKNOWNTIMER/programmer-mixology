# Programmer Mixology / 程序员调酒台 1.2.0

> LOCAL FIRST / TASTE → RULES → AI → VALIDATION

Read the illustrated [English homepage](../README.md) or [中文首页](../README.zh-CN.md).
See [Architecture](../docs/ARCHITECTURE.md#english) for the nutrition and sensory research direction, and the [User guide](../docs/USAGE.md#english) for interaction details.

This directory contains the production Tauri 2 + React/TypeScript + Rust + SQLite implementation. The root Python reference implementation validates specifications; it is not a second production network backend.

**New profiles default to English**, 125% text, and full motion. Change to 中文 in Settings → General → Language. Valid existing language preferences are preserved; upgrading does not force a saved Chinese profile to English.

The 96-drink Xiaodong notebook DLC is bundled with the 300-entry base catalog and enabled by default. The original notebook and separately identified editorial completions are included in the authorized public source.

- [Xiaodong's original Word notebook](data/dlc/xiaodong/source.docx)
- [Zhenglin Soup original description](data/personal/zhenglin-soup/source.txt)
- [Zhenglin Soup structured recipe source](data/personal/zhenglin-soup/recipe.json)

The recipe JSON is source data, not a .timermix archive. Actual personal databases, accounts, credentials, and orders are excluded from public distribution.

## Build

Use Node.js 24, pnpm 11.25.0, Rust stable, Visual Studio C++ Build Tools, Windows SDK, and WebView2. The build helper discovers tools only for the current terminal; it does not install tools or elevate privileges.

~~~powershell
# From repository root
. ./product/scripts/enter-build-env.ps1
pnpm --dir product/apps/client install --frozen-lockfile
pnpm --dir product/apps/client test
pnpm --dir product/apps/client build
cargo test --workspace --locked --manifest-path product/Cargo.toml
cargo build --release --locked --manifest-path product/Cargo.toml -p pixel-mix
python product/scripts/generate-sbom.py
./product/scripts/build-windows-installer.ps1
~~~

The installer build also requires NSIS, discovered through the NSIS_EXE environment variable or the per-user Tauri NSIS cache.

The output is packaging/installer/Programmer_Mixology_Setup_1.2.0_x64.exe: a real unsigned Windows x64 installer with native pixel chrome, current-user installation, and no system title bar. It requires an existing WebView2 runtime.

Compatibility identifiers local.pixelmix.workbench, pixel-mix.exe, and .timermix remain unchanged. Renaming does not migrate or erase user databases.

## Evidence and licenses

See [BUILD_REPORT](BUILD_REPORT.md) and [STATUS](STATUS.md) for the actual validation scope. Original code and authorized project resources use [MIT](../LICENSE); upstream licenses and source attribution are documented in [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES.md).

Real-model inference, complete two-physical-device LAN acceptance, signing, and native mobile packages remain outside the verified scope.

## 中文

本目录包含生产应用；根目录 Python 参考实现用于验证规格，不作为另一套网络后端运行。完整图文介绍见 [中文首页](../README.zh-CN.md)，操作说明见 [USAGE](../docs/USAGE.md)，研究架构见 [ARCHITECTURE](../docs/ARCHITECTURE.md)。

**新用户默认英文**、125%字号和完整动态效果。在“Settings → General → Language”可切换中文；已经保存的有效语言偏好会保留，升级不会强制修改原有中文设置。

内置300杯基础酒谱与96杯小董笔记DLC，DLC默认启用。授权原稿与独立记录的建议补全随源码公开：上方链接可直接获取小董原始DOCX、政霖汤原文和结构化配方；recipe.json属于源数据，不是可直接改后缀导入的.timermix存档。个人数据库、账户、凭据与订单不公开。

构建要求与命令见上方英文部分。构建助手仅为当前终端发现工具，不安装工具、不提权；定制安装器额外需要NSIS。安装器为当前用户模式、未签名、无系统标题栏，需已有WebView2。内部兼容标识与存档格式不变，不会因改名而迁移或清空旧数据。

本轮实际验证见BUILD_REPORT与STATUS；真实模型、双物理设备LAN、签名与移动原生包仍未完成验收。原创／授权资源采用MIT，第三方材料许可独立。
