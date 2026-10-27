# Programmer Mixology · Windows installer

`V1.2.0` · `NATIVE / NSIS` · [简体中文](README.zh-CN.md)

This directory contains the real NSIS installer and its native pixel skin. The installer uses English. New app profiles also start in English; users can choose Chinese in Settings, and valid saved language choices are preserved.

The historical `v1.1` directory and `build-v11-installer.ps1` implementation remain for build compatibility. The public build entry point is `build-windows-installer.ps1`; the current output version is **1.2.0**. An installer preview is not a deliverable.

## Build

Build the actual x64 Tauri release executable at version `1.2.0`, then run from the repository root:

```powershell
./product/scripts/build-windows-installer.ps1
```

The default payload is `product/target/release/pixel-mix.exe`; the output is `product/packaging/installer/Programmer_Mixology_Setup_1.2.0_x64.exe`. Use `-Payload <absolute-path>` and `-Output <absolute-path>` to override them. The builder verifies the PE product version, records the real payload SHA-256, and runs 20 native helper checks, including hidden-window layout regression checks. Any failure stops the build. Installation verifies both the extracted and copied executable with Windows BCrypt.

The build requires existing MSVC, Windows SDK and `%LOCALAPPDATA%/tauri/NSIS/makensis.exe`. It does not download toolchains, models or runtimes, or change system PATH. The skin is an x86 DLL, NSIS is x86 Unicode, and the application payload is x64.

`-PreviewOnly` produces `Programmer-Mixology-1.2.0-INSTALLER-UI-PREVIEW.exe`. Its install section exits with code 99 and cannot install the app. It must not be published as a working installer.

## Behavior

- Installs for the current user without administrator rights. The default `%LOCALAPPDATA%/Programs/PIXEL MIX` directory is retained for compatibility and can be changed on the welcome page.
- Keeps the 64-bit `HKCU/Software/Microsoft/Windows/CurrentVersion/Uninstall/PIXEL MIX` key, with display name **Programmer Mixology** and version **1.2.0**. Refuses to downgrade a newer registered version at the same path.
- Requires an existing Microsoft Edge WebView2 Runtime. If missing, installation exits with a clear message. It does not download a runtime or change the firewall.
- Uses dark blue-gray and muted red pixel styling, without a system title bar or native status bar. The close button and background dragging remain available. The licensed Fusion Pixel WOFF2 is unpacked through DirectWrite and loaded privately for this process; no system font is installed.
- Animates the cup highlight and small pixels every 80 ms. Progress comes from the real NSIS progress control; decoration is not a success indication. The completion page appears only after the install section succeeds.
- Verifies files before replacing the app. If the app is running or its files are locked, installation refuses the update without terminating it. Replacement uses a temporary file and backup beside the executable and attempts recovery if resource writing fails. Filesystem or disk failures cannot guarantee atomic rollback of the whole directory; failures return an error.
- Creates **Programmer Mixology** desktop and Start menu shortcuts using the app ICO. Upgrade and uninstall only remove known shortcuts that still point to this installation, including legacy Chinese names.
- Uninstall removes only listed resources and empty directories. Unknown files and recipes, queues, settings and host data under `%LOCALAPPDATA%/local.pixelmix.workbench` are preserved. Ownership and running-app checks precede removal.
- The installer is unsigned. Record actual install and uninstall results separately from compilation results.

## Isolated verification

```powershell
$installer = (Resolve-Path product/packaging/installer/Programmer_Mixology_Setup_1.2.0_x64.exe).Path
$target = Join-Path (Get-Location).Path 'product/evidence/install-test/manual'
Start-Process -FilePath $installer -ArgumentList ('/S /ISOLATED=1 /D=' + $target) -WindowStyle Hidden -Wait -PassThru
```

NSIS requires `/D=` to be the last argument, without extra quotation marks around its value. `/ISOLATED=1` uses the separate `TIMER-V11-TEST` uninstall key and skips desktop and Start menu shortcuts. File installation and verification are otherwise identical. Do not run two tests sharing that key concurrently. The uninstaller reads the isolated marker; the switch need not be repeated.

`product/tests/installer-window-native.py --pid <PID> --output <json>` performs read-only Win32 checks on the specified test process, captures two frames, and checks for removal of the system title bar, thick border and status bar, plus actual timed pixel changes. `--close` closes only that known test window. Inspect the screenshots, completion page and uninstall prompt; pixel changes alone do not establish visual quality.

Run the full silent acceptance with a new evidence name so previous results remain available:

```powershell
./product/scripts/test-v11-installer.ps1 -Installer product/packaging/installer/Programmer_Mixology_Setup_1.2.0_x64.exe -EvidenceName english-default
```

The test covers isolated installation, payload hash and version, downgrade prevention, unowned update-file collisions, busy-app refusal, same-version reinstall and normal self-copying uninstall. It verifies unknown-file preservation and unchanged normal-user database/WAL bytes and registration. SQLite SHM contains mutable reader locks; its before/after values are retained for diagnosis and are not treated as logical database-content changes. The installed app is not launched. Unknown-file evidence is retained, without recursive directory removal. `-LeaveInstalled` performs another installation after acceptance to leave a real entry point for the caller.

| Exit | Meaning |
| --- | --- |
| 0 | Success |
| 20 | Unsupported non-x64 system |
| 21 | WebView2 missing |
| 22 | Newer version prevents downgrade |
| 23 | Executable verification failed |
| 24 | Existing update files prevent writing |
| 25 | File write or replacement failed |
| 26 | Shortcut or registration failed; installed app requires repair |
| 31 | Uninstall ownership marker mismatch |
| 32 | App busy or target path refused |
| 33 | Uninstall removal failed |
| 99 | UI preview only |

Implementation references: [NSIS callbacks and installation behavior](https://nsis.sourceforge.io/Docs/Chapter4.html), [NSIS native custom pages](https://nsis.sourceforge.io/Docs/nsDialogs/Readme.html), and [Microsoft DirectWrite WOFF2 unpacking](https://learn.microsoft.com/en-us/windows/win32/api/dwrite_3/nf-dwrite_3-idwritefactory5-unpackfontfile).
