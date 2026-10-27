# Process-local environment only. Discovers installed tools; never installs or elevates.
$ErrorActionPreference = 'Stop'
$pixelProduct = Split-Path $PSScriptRoot -Parent
$pixelLocalCargo = Join-Path $pixelProduct '.tools\cargo'
$pixelLocalRustup = Join-Path $pixelProduct '.tools\rustup'
if ((Test-Path -LiteralPath (Join-Path $pixelLocalCargo 'bin\rustup.exe')) -and
    (Test-Path -LiteralPath (Join-Path $pixelLocalRustup 'toolchains'))) {
    $env:CARGO_HOME = $pixelLocalCargo
    $env:RUSTUP_HOME = $pixelLocalRustup
    $env:Path = "$pixelLocalCargo\bin;$env:Path"
} elseif (Test-Path -LiteralPath (Join-Path $env:USERPROFILE '.cargo\bin')) {
    $env:Path = (Join-Path $env:USERPROFILE '.cargo\bin') + ';' + $env:Path
}
# Optional local assistant runtime; contributors can use their normal Node installation.
$pixelRuntime = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    $pixelNode = Join-Path $pixelRuntime 'node\bin'
    if (Test-Path -LiteralPath (Join-Path $pixelNode 'node.exe')) { $env:Path = "$pixelNode;$env:Path" }
}
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    $pixelFallback = Join-Path $pixelRuntime 'bin\fallback'
    if (Test-Path -LiteralPath $pixelFallback) { $env:Path = "$pixelFallback;$env:Path" }
}
$pixelVswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (-not (Test-Path -LiteralPath $pixelVswhere)) { throw 'Install Visual Studio C++ Build Tools (including MSVC and Windows SDK) first.' }
$pixelVsRoot = & $pixelVswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $pixelVsRoot) { throw 'No Visual Studio installation with x64 C++ tools was found.' }
$pixelVcRoot = Join-Path $pixelVsRoot 'VC\Tools\MSVC'
$pixelVc = (Get-ChildItem -LiteralPath $pixelVcRoot -Directory | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'bin\Hostx64\x64\cl.exe') } | Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1).FullName
if (-not $pixelVc) { throw 'No usable MSVC compiler was found.' }
$pixelSdk = (Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows Kits\Installed Roots' -ErrorAction Stop).KitsRoot10.TrimEnd('\')
$pixelSdkVersion = (Get-ChildItem -LiteralPath (Join-Path $pixelSdk 'Include') -Directory | Where-Object { (Test-Path -LiteralPath (Join-Path $_.FullName 'um\Windows.h')) -and (Test-Path -LiteralPath (Join-Path $pixelSdk ('Lib\' + $_.Name + '\ucrt\x64\ucrt.lib'))) } | Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1).Name
if (-not $pixelSdkVersion) { throw 'No complete Windows 10/11 SDK was found.' }
$env:Path = "$pixelVc\bin\Hostx64\x64;$pixelSdk\bin\$pixelSdkVersion\x64;$env:Path"
$env:INCLUDE = "$pixelVc\include;$pixelSdk\Include\$pixelSdkVersion\ucrt;$pixelSdk\Include\$pixelSdkVersion\shared;$pixelSdk\Include\$pixelSdkVersion\um;$pixelSdk\Include\$pixelSdkVersion\winrt"
$env:LIB = "$pixelVc\lib\x64;$pixelSdk\Lib\$pixelSdkVersion\ucrt\x64;$pixelSdk\Lib\$pixelSdkVersion\um\x64"
$env:VCToolsInstallDir = "$pixelVc\"
$env:VCINSTALLDIR = (Join-Path $pixelVsRoot 'VC') + '\'
$env:WindowsSdkDir = "$pixelSdk\"
$env:WindowsSDKVersion = "$pixelSdkVersion\"
$env:VSCMD_ARG_TGT_ARCH = 'x64'
$env:CC = "$pixelVc\bin\Hostx64\x64\cl.exe"
$env:CXX = $env:CC
$env:PYTHONUTF8 = '1'
