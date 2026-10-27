$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'shell-resource-path.ps1')
$pixelRoot = (Resolve-Path -LiteralPath (Split-Path $PSScriptRoot -Parent)).Path
$pixelDesktop = [Environment]::GetFolderPath('Desktop')
$pixelShortcutPath = [IO.Path]::GetFullPath((Join-Path $pixelDesktop '程序员调酒台（开发版）.lnk'))
if ([IO.Path]::GetDirectoryName($pixelShortcutPath) -ne [IO.Path]::GetFullPath($pixelDesktop)) { throw 'Unexpected desktop destination' }
$pixelLauncher = Join-Path $pixelRoot 'scripts\start-preview.ps1'
$pixelIconSource = Join-Path $pixelRoot 'apps\client\src-tauri\icons\icon.ico'
if (!(Test-Path -LiteralPath $pixelIconSource -PathType Leaf)) { throw 'TIMER icon resource is missing' }
# A content-addressed location makes Explorer request the new high-DPI icon
# without deleting the user's global icon cache or restarting the desktop.
$pixelIconHash = (Get-FileHash -LiteralPath $pixelIconSource -Algorithm SHA256).Hash.ToLowerInvariant()
$pixelIconFolder = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'local.pixelmix.workbench\file-icons'
$pixelIcon = Join-Path $pixelIconFolder ('TIMER-' + $pixelIconHash + '.ico')
New-Item -ItemType Directory -Path $pixelIconFolder -Force | Out-Null
if (Test-Path -LiteralPath $pixelIcon) {
    if ((Get-FileHash -LiteralPath $pixelIcon -Algorithm SHA256).Hash.ToLowerInvariant() -ne $pixelIconHash) { throw 'Existing icon content does not match; preserved without overwrite' }
} else { Copy-Item -LiteralPath $pixelIconSource -Destination $pixelIcon }
$pixelIcon = Get-PixelMixShellResourcePath -LiteralPath $pixelIcon
$pixelShell = New-Object -ComObject WScript.Shell
$pixelShortcut = $pixelShell.CreateShortcut($pixelShortcutPath)
$pixelPowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$pixelArguments = '-NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $pixelLauncher + '"'
if ((Test-Path -LiteralPath $pixelShortcutPath) -and $pixelShortcut.Arguments -and $pixelShortcut.Arguments -ne $pixelArguments) { throw 'A different shortcut already uses this name; it has not been overwritten' }
$pixelShortcut.TargetPath = $pixelPowerShell
$pixelShortcut.Arguments = $pixelArguments
$pixelShortcut.WorkingDirectory = $pixelRoot
$pixelShortcut.IconLocation = $pixelIcon + ',0'
$pixelShortcut.Description = '程序员调酒台 · Programmer Mixology · 开发版'
$pixelShortcut.WindowStyle = 7
$pixelShortcut.Save()
$pixelCheck = $pixelShell.CreateShortcut($pixelShortcutPath)
if ($pixelCheck.TargetPath -ne $pixelPowerShell -or $pixelCheck.Arguments -ne $pixelArguments -or $pixelCheck.IconLocation -ne ($pixelIcon + ',0') -or !(Test-Path -LiteralPath $pixelShortcutPath)) { throw 'Shortcut verification failed' }
[PSCustomObject]@{ Path = $pixelShortcutPath; Target = $pixelCheck.TargetPath; Arguments = $pixelCheck.Arguments; Icon = $pixelCheck.IconLocation }
