# 程序员调酒台 V1.2 Windows 安装器

本目录提供真实 NSIS 安装器源码与原生像素皮肤，不依赖网页壳或远程下载。实际交付文件由 `product/scripts/build-v11-installer.ps1` 生成；本目录不把界面预览构建视为成品。

此目录名 `v1.1` 与兼容构建入口 `build-v11-installer.ps1` 保留历史结构；当前输出版本为 1.2.0，公开入口为 `build-windows-installer.ps1`。

## 构建

先构建版本为 `1.2.0` 的真实 x64 Tauri release EXE，再运行：

```powershell
./product/scripts/build-windows-installer.ps1
```

默认读取 `product/target/release/pixel-mix.exe`，输出 `product/packaging/installer/Programmer_Mixology_Setup_1.2.0_x64.exe`。可以通过 `-Payload <完整路径>` 与 `-Output <完整路径>` 指定文件。构建器核对 PE 产品版本必须为 `1.2.0`，在源码生成的安装清单中记录实际 EXE 的 SHA-256；安装时使用 Windows BCrypt 重新验证解包和复制后的 EXE。运行20项真正的本机辅助代码测试（含隐藏窗口布局回归），任何失败中止构建。

依赖现有 MSVC、Windows SDK 与 `%LOCALAPPDATA%/tauri/NSIS/makensis.exe`（本机3.11），不会下载工具链、模型或运行库，不修改系统 PATH。皮肤为 x86 DLL，安装器主体为 NSIS x86 Unicode，内含的应用为 x64。

`-PreviewOnly` 生成明确命名的 `Programmer-Mixology-1.2.0-INSTALLER-UI-PREVIEW.exe`，用于布局开发；安装节直接以99退出，不能安装，也不允许作为交付产物。预览可包含已有 EXE，但不会把它标成实际已交付 V1.2。

## 安装行为

- 当前用户安装，无管理员权限；默认 `%LOCALAPPDATA%/Programs/PIXEL MIX`，与原0.1安装器目录一致，可在欢迎页更改。
- 沿用64位视图中的 `HKCU/Software/Microsoft/Windows/CurrentVersion/Uninstall/PIXEL MIX`，显示名称更新为 程序员调酒台，版本1.2.0。针对相同登记路径拒绝覆盖更高版本。
- 只要求机器已有 Microsoft Edge WebView2 Runtime；缺失则明确退出，不自动下载、不改防火墙。
- 深黑、蓝灰、暗红配色；去除系统标题栏／原生状态栏，保留右上关闭与背景拖动。文字来自项目已授权的 Fusion Pixel WOFF2，使用 Windows DirectWrite 解包并仅在安装进程私有加载，不安装系统字体。
- 原生80ms像素杯高光和小方块动画，安装进度读取 NSIS 的真实进度控件。装饰动画不表示安装成功，也不替代真实百分比。完成页只在安装节成功后出现。
- 文件校验后才替换应用；已有应用正在运行／文件锁定则拒绝，不强行结束进程。替换 EXE 采用同目录临时文件和旧文件备份，写入资源失败时尝试恢复旧 EXE；磁盘或文件系统故障不能保证整个安装目录原子回滚，失败会明确退出。
- 默认创建桌面与开始菜单的 程序员调酒台 快捷方式，图标取本次应用 ICO。卸载只删除仍然指向此次安装目标的快捷方式。
- 卸载只删除构建时列出的已知资源文件及空目录，保留未知文件与 `%LOCALAPPDATA%/local.pixelmix.workbench` 中酒谱、队列、设置和主机数据。卸载前核对所属标记并检查程序是否关闭。
- 未签名；不申请或购买证书。安装与卸载验证必须记录实际结果，不以构建通过代替。

## 隔离验证

```powershell
$installer = (Resolve-Path product/packaging/installer/Programmer_Mixology_Setup_1.2.0_x64.exe).Path
$target = 'C:\实际工作区\product\evidence\install-test\v11'
Start-Process -FilePath $installer -ArgumentList ('/S /ISOLATED=1 /D=' + $target) -WindowStyle Hidden -Wait -PassThru
```

NSIS 的 `/D=` 必须是最后一个参数，目录值不要额外加引号。`/ISOLATED=1` 使用独立卸载键 `TIMER-V11-TEST`，不写桌面／开始菜单快捷方式，但其余安装文件与校验流程相同；不能同时运行两个使用同一隔离键的安装器。卸载程序读取安装目录的隔离标记，不需要重复传该参数。

真实安装器 GUI 可用 `product/tests/installer-window-native.py --pid <PID> --output <json>` 做目标PID限定的只读 Win32 检查，生成两帧截图并验证无系统标题栏／厚边框／状态栏，以及实际计时帧像素变化。`--close` 仅用于关闭该已知测试窗口。GUI验收需检查截图、安装完成页与卸载提示；单纯像素变化不能证明整个视觉符合预期。

复用完整静默验收（必须使用新的证据名，保留之前的结果）：

```powershell
./product/scripts/test-v11-installer.ps1 -Installer product/packaging/installer/Programmer_Mixology_Setup_1.2.0_x64.exe -EvidenceName final
```

脚本执行隔离安装、正确哈希／版本、缺陷保护（降级、未所属更新文件、占用拒绝）、同版本重装、标准卸载自复制与删除本体，检查未知文件和正常用户库的数据库／WAL字节及登记不变。SQLite SHM含易变的读者锁／读标记，完整前后值保留用于诊断，不以其变化冒称存储内容变化。不会运行被安装的应用。测试结束保留作用域内的未知文件证据，不递归删除目录。`-LeaveInstalled` 在验收后另行重装，为主任务留存真实安装版入口。

退出码：0成功；20非x64；21缺少WebView2；22新版本阻止降级；23EXE校验失败；24残留更新文件阻止写入；25文件写入／替换失败；26快捷方式或安装登记失败（应用已写入，须修复）；31卸载所属标记不匹配；32应用占用或目标路径拒绝；33卸载删除失败；99仅界面预览。

技术依据：[NSIS脚本回调与安装行为](https://nsis.sourceforge.io/Docs/Chapter4.html)、[NSIS原生自定义页](https://nsis.sourceforge.io/Docs/nsDialogs/Readme.html)、[Microsoft DirectWrite WOFF2解包](https://learn.microsoft.com/en-us/windows/win32/api/dwrite_3/nf-dwrite_3-idwritefactory5-unpackfontfile)。
