# 1.2.0 — Build & verification / 构建与验证

`PROGRAMMER MIXOLOGY  /  WINDOWS x64  /  2026-10-27`

本报告只记录本次实际执行结果。旧版本验收不计作新版本通过；公开报告不含个人路径、数据库、令牌或运行日志。
This report records this release's actual checks. Historical results are not presented as fresh acceptance. Machine-local logs and user databases are excluded from the public source tree.

## Commands and results / 命令与结果

Commands run from the repository root on Windows x64 after loading `product/scripts/enter-build-env.ps1`. Toolchain: Node 24.19.0, pnpm 11.25.0, Rust/Cargo 1.98.1, MSVC 14.44, Windows SDK 10.0.26100.0, NSIS 3.11.

| Command / check | Actual result |
|---|---|
| `python -m unittest discover -s tests -v` before export tests were added | 44 passed |
| `python -m unittest discover -s tests -p test_public_export.py -v` | 8 passed |
| `python scripts/validate_seed.py` | Passed, 70 seed recipes: 60 IBA reference revisions + 10 supplied notes; 101 ingredient types |
| `pnpm --config.verify-deps-before-run=false --dir product/apps/client test` | 269 passed in 34 files |
| Same pnpm options, `build` | TypeScript and Vite production build passed |
| `cargo +stable test --offline --workspace --locked --manifest-path product/Cargo.toml` | 150 passed: application 66, catalog 13, domain 7, inference 17, LAN host 41, recipe engine 6 |
| `cargo +stable build --offline --locked --manifest-path product/Cargo.toml -p pixel-mix` | Real Windows debug build passed |
| Same Cargo build with `--release` | Real optimized Windows build passed |
| `python product/scripts/generate-sbom.py` | 663 resolved components recorded, including development and other-platform dependencies |
| `node product/tests/e2e/public-release-smoke.cjs` | Real Tauri debug window, WebView2, Rust and isolated SQLite: 7/7 groups, 0 JavaScript page errors |
| `product/scripts/build-windows-installer.ps1` | Real NSIS executable produced; native helper checks 20/20 |
| `product/scripts/test-v11-installer.ps1 -Installer <new-installer> -EvidenceName public-release-1-2-0` | 25/25 checks passed; normal user database/WAL and registration state preserved |

## What the native checks exercised / 原生检查范围

中文与英文 UI、原生标题、V1.2.0 About、396 杯目录、96 杯 DLC 默认启用、125% 像素字体、675×960 七区完整布局、五味显示合计 100 与业务基点合计 10000、Logo 约 0.4 秒及模块入场、实际关闭按钮正常退出。只写独立测试数据库，未加载个人工作库。

The installer tests performed actual isolated installation, payload SHA verification, version and license/SBOM checks, downgrade rejection, pending-file protection, occupied-file rejection, same-version reinstall and uninstall. Unknown files were preserved. These tests did not activate the installer GUI or launch the installed release application. Native UI screenshots are from the freshly built debug executable.

## Failures retained and corrected / 保留的失败与修正

- Existing local pnpm metadata triggered `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` before running the script. No dependencies were deleted or reinstalled; verification used the process-local `verify-deps-before-run=false` option. A clean checkout still installs using the frozen lockfile normally.
- The first native screenshot test selected a wrapper button instead of its nested `<canvas>` when asserting artwork dimensions. The selector was corrected, the first process closed normally, and a second complete run passed. Both local reports remain available in the private evidence directory.
- Existing warnings remain: Vite main chunk exceeds 500 KB; Rust artwork metadata contains an unused `recipe_id` field; MSVC reports generated import-library messages. No new performance benchmark is claimed.

## Artifacts / 产物

| File | Bytes | SHA-256 |
|---|---:|---|
| `Programmer_Mixology_Setup_1.2.0_x64.exe` | 8,015,949 | `742e4bce70645a5ad6c42cc1b898c3a77b5e148139d7f272dda0a592d46c44c2` |
| Installed `pixel-mix.exe` payload | See release manifest | `eb3dc77e273b4cf43f8f4099d19b82d31646ef1b9a03c5d22dc550013d0de78c` |

The Windows installer includes the 396-drink catalog, enabled Xiaodong DLC, MIT text and upstream notices. Source documents and optional personal-recipe examples are published in the repository. No model weights, account state, orders or personal SQLite databases are bundled. The installer uses current-user installation and existing WebView2; it is unsigned.

## Publication scope / 公开范围

The public repository begins with a clean source snapshot. The original local Git history and machine evidence are retained locally. Strong credential patterns and required static source/resource references are checked during export; this is a bounded audit, not a guarantee that all possible security issues have been found. Original authorized notebook/DOCX and recipe bytes are preserved; two extraction metadata files replace only their old machine-specific source location with a repository-relative path.

GitHub Actions is configured for Windows source checks on pushes and pull requests. Its live run status is shown on the repository; local results above do not assert a cloud run passed before it did.

## Independent public source snapshot / 独立公开源码验证

The exported source tree was separately installed and tested: frozen pnpm install succeeded, all 269 frontend tests passed, TypeScript/Vite built successfully, all 52 Python tests passed (44 reference + 8 export), and all 150 Rust tests passed. The main documentation and release reports had 50 valid local links; four screenshots are actual 675×960 native captures.

The first offline dependency installation lacked cached metadata, so the normal frozen-lockfile install fetched the required locked packages. An initial parallel Rust check correctly refused to build before frontend `dist` existed; the complete workspace suite was rerun after the frontend build and passed. These failed attempts are retained locally.

Git attributes preserve source-pack and supplied-original bytes instead of normalizing their line endings. Staged Git blobs for the seed, both immutable catalog packs, DLC, original DOCX, personal source and artwork metadata were compared byte-for-byte with the tested files. Local Git history, runtime records and credentials are not included in the new public history.

Cloud Windows CI initially found a reference-test fixture read that depended on the system ANSI encoding. It now uses explicit UTF-8; the source fixture and application behavior are unchanged. The initial failed workflow remains in GitHub Actions history.


On the shared GitHub Windows runner, the exhaustive 96-drink × 3-size pixel-geometry test took 10.353 s and exceeded Vitest's default 5 s timeout. Only this test now has a 30 s allowance; all samples and per-pixel assertions remain intact. Its four-test file was rerun locally and passed.

