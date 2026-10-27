# 程序员调酒台 / Programmer Mixology — 1.2.0

`PUBLIC SOURCE  /  WINDOWS x64  /  2026-10-27`

## 已实现 / Implemented

- Tauri 2 + React/TypeScript + Rust + SQLite；固定七区像素界面、双语、新用户默认英文（保留已存语言选择）、默认 125% 字号与完整动态效果。
- 五味业务值为整数基点且合计 10000；显示整数合计 100。用户目标、配方预测、实饮评价分离。
- 300 杯来源库 + 96 杯小董笔记 DLC；DLC 默认启用，可整体隐藏或重新启用；原稿与编辑补全记录随源码提供。
- 自定义酒谱、收藏、制作队列、`.timermix` 快照、逐杯图标、字符酒杯、Windows 文件剪贴板与拖拽入口。
- 权威主机的账户、票据、订单事务与不可变快照；受控 llama.cpp 适配层与确定性规则候选。
- 新品牌、MIT、自有原稿公开授权说明、Fork/PR 贡献流程、中英图文文档和 Windows 安装器。

The application implements the seven-panel workbench, integer taste invariants, separated targets/predictions/reviews, catalog and notebook DLC, local custom recipes, immutable archives, queue interactions, host transactions and a constrained local-model adapter. Source publication includes the authorized original notebook and personal-recipe material, not the developer's databases or account state.

## 本轮验证 / Verified in this release

| 检查 / Check | 结果 / Result |
|---|---|
| Python reference suite | 44 passed |
| Public-export safeguards | 8 passed |
| Seed data validation | Passed: 70 seed recipes / 101 ingredients |
| Frontend | 271 tests / 34 files passed; TypeScript + Vite production build passed |
| Rust workspace | 151 tests passed |
| Windows build | Debug and optimized release EXEs built, version 1.2.0 |
| Native debug UI | 9/9 groups, 0 page errors; fresh English default and saved Chinese preference verified; Chinese/English screenshots captured |
| Native installer helpers | 20/20 passed |
| Actual installer lifecycle | 25/25 passed: isolated install, rejection guards, reinstall, uninstall |

Detailed commands, limits and artifact digests: [1.2.0 build report](https://github.com/UNKNOWNTIMER/programmer-mixology/blob/main/docs/releases/1.2.0-BUILD_REPORT.md).

## 尚未验证 / Not yet validated

- Real local-model quality/latency on a supplied model; no model weights or inference runtime are bundled.
- A complete LAN session between two separate physical devices; transaction tests are not a substitute.
- Native macOS/Android/iOS builds, signing/notarization, App Store distribution.
- Comprehensive nutrition optimization, real sensory calibration or clinical dietary guidance.
- Physical Explorer drag-and-drop across application windows and all mixed-DPI/multi-monitor combinations.
- This release's full interactive installer page sequence, installed-release GUI launch and clean Windows VM acceptance. The native UI proof uses the debug executable; the release payload was verified through actual installation and hash comparison.
- Windows executables are unsigned; WebView2 must already be installed. Vite reports an existing >500 KB main chunk warning.

The public repository is intended for forks and contributions. Presence of an adapter or a passing unit test does not mark all M0–M5 platform milestones complete.

README.md is the full English default entrypoint; README.zh-CN.md and architecture.zh-CN.svg provide the complete Chinese documentation and translated architecture diagram. The final Windows package was rebuilt after this language-default change and reran all installer checks.
