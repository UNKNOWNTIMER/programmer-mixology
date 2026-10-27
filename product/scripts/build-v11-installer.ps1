param(
    [string]$Payload,
    [string]$Output,
    [switch]$PreviewOnly
)
$ErrorActionPreference = 'Stop'
$timerProduct = Split-Path $PSScriptRoot -Parent
. (Join-Path $PSScriptRoot 'enter-build-env.ps1')
$timerSource = Join-Path $timerProduct 'packaging/v1.1'
$timerBuild = Join-Path $timerProduct 'target/installer-v12'
New-Item -ItemType Directory -Path $timerBuild -Force | Out-Null
if (-not $Payload) { $Payload = Join-Path $timerProduct 'target/release/pixel-mix.exe' }
$Payload = (Resolve-Path -LiteralPath $Payload).Path
$timerOriginalPayload = $Payload
$timerStagedPayload = Join-Path $timerBuild 'payload-v12.exe'
$timerSourceHash = (Get-FileHash -LiteralPath $timerOriginalPayload -Algorithm SHA256).Hash
Copy-Item -LiteralPath $timerOriginalPayload -Destination $timerStagedPayload -Force
if ((Get-FileHash -LiteralPath $timerStagedPayload -Algorithm SHA256).Hash -ne $timerSourceHash) { throw 'Payload changed while staging; finish the application build before packaging.' }
$Payload = $timerStagedPayload
$timerVersion = (Get-Item -LiteralPath $Payload).VersionInfo.ProductVersion
if (-not $PreviewOnly -and $timerVersion -ne '1.2.0') { throw "Expected a real Programmer Mixology 1.2.0 release payload; found ProductVersion=$timerVersion" }
if (-not $Output) {
    $Output = if ($PreviewOnly) { Join-Path $timerBuild 'Programmer-Mixology-1.2.0-INSTALLER-UI-PREVIEW.exe' } else { Join-Path $timerProduct 'packaging/installer/Programmer_Mixology_Setup_1.2.0_x64.exe' }
}
$Output = [IO.Path]::GetFullPath($Output)
New-Item -ItemType Directory -Path (Split-Path $Output -Parent) -Force | Out-Null
$timerNsis = if ($env:NSIS_EXE) { $env:NSIS_EXE } else { Join-Path $env:LOCALAPPDATA 'tauri/NSIS/makensis.exe' }
if (-not (Test-Path -LiteralPath $timerNsis)) { throw 'Existing NSIS is required; no toolchain download is performed.' }

# NSIS itself is x86 Unicode even though its application payload is x64.
$timerVc = $env:VCToolsInstallDir.TrimEnd('\')
$timerSdk = $env:WindowsSdkDir.TrimEnd('\')
$timerSdkVersion = $env:WindowsSDKVersion.TrimEnd('\')
$timerSavedLib = $env:LIB
try {
    $env:LIB = "$timerVc\lib\x86;$timerSdk\Lib\$timerSdkVersion\ucrt\x86;$timerSdk\Lib\$timerSdkVersion\um\x86"
    & "$timerVc\bin\Hostx64\x86\cl.exe" /nologo /std:c++17 /W4 /WX /O2 /MT /LD /EHsc /utf-8 /guard:cf /GS /sdl /DUNICODE /D_UNICODE (Join-Path $timerSource 'skin.cpp') "/Fo$timerBuild\TimerInstallerSkin.obj" "/Fe$timerBuild\TimerInstallerSkin.dll" /link "/DEF:$timerSource\skin.def" /DYNAMICBASE /NXCOMPAT /GUARD:CF /Brepro /INCREMENTAL:NO user32.lib gdi32.lib comctl32.lib uxtheme.lib bcrypt.lib dwrite.lib ole32.lib uuid.lib
    if ($LASTEXITCODE -ne 0) { throw 'Native installer skin compilation failed' }
    & "$timerVc\bin\Hostx64\x86\cl.exe" /nologo /std:c++17 /W4 /WX /O2 /MT /EHsc /utf-8 /DUNICODE /D_UNICODE (Join-Path $timerProduct 'tests/installer-helper-tests.cpp') "/Fo$timerBuild\helper-test.obj" "/Fe$timerBuild\installer-helper-tests.exe" /link /MANIFEST:EMBED "/MANIFESTUAC:level='asInvoker' uiAccess='false'" user32.lib gdi32.lib comctl32.lib uxtheme.lib bcrypt.lib dwrite.lib ole32.lib uuid.lib
    if ($LASTEXITCODE -ne 0) { throw 'Native installer helper checks compilation failed' }
} finally { $env:LIB = $timerSavedLib }

function Escape-Nsis([string]$Value) { return $Value.Replace('$', '$$').Replace('"', '$\"') }
$timerDigest = (Get-FileHash -LiteralPath $Payload -Algorithm SHA256).Hash.ToLowerInvariant()
$timerIcon = Join-Path $timerProduct 'apps/client/src-tauri/icons/icon.ico'
$timerFont = Join-Path $timerProduct 'apps/client/public/fonts/fusion-pixel-12px-monospaced-zh_hans.otf.woff2'
& (Join-Path $timerBuild 'installer-helper-tests.exe') $Payload $timerDigest $timerFont (Join-Path $timerBuild ('helper-sandbox-' + [Guid]::NewGuid().ToString('N')))
if ($LASTEXITCODE -ne 0) { throw 'Native installer helper checks failed' }
$timerDefinitions = @(
    '!define PAYLOAD "' + (Escape-Nsis $Payload) + '"'
    '!define PAYLOAD_SHA256 "' + $timerDigest + '"'
    '!define OUTPUT "' + (Escape-Nsis $Output) + '"'
    '!define APP_ICON "' + (Escape-Nsis $timerIcon) + '"'
    '!define PIXEL_FONT "' + (Escape-Nsis $timerFont) + '"'
    '!define SKIN_DLL "' + (Escape-Nsis (Join-Path $timerBuild 'TimerInstallerSkin.dll')) + '"'
)
if ($PreviewOnly) { $timerDefinitions += '!define PREVIEW_ONLY' }
$timerResources = @()
$timerResources += [PSCustomObject]@{ Source = (Join-Path (Split-Path $timerProduct -Parent) 'LICENSE'); Relative = 'notices\LICENSE' }
$timerResources += [PSCustomObject]@{ Source = (Join-Path (Split-Path $timerNsis -Parent) 'COPYING'); Relative = 'notices\NSIS-COPYING.txt' }
foreach ($timerNotice in @('THIRD_PARTY_NOTICES.md','DEPENDENCY_LICENSES.md','SBOM.cdx.json')) {
    $timerResources += [PSCustomObject]@{ Source = (Join-Path $timerProduct $timerNotice); Relative = "notices\$timerNotice" }
}
foreach ($timerLicense in (Get-ChildItem -LiteralPath (Join-Path $timerProduct 'third_party_licenses') -Recurse -File)) {
    $timerRelative = [IO.Path]::GetRelativePath((Join-Path $timerProduct 'third_party_licenses'), $timerLicense.FullName)
    $timerResources += [PSCustomObject]@{ Source = $timerLicense.FullName; Relative = "notices\licenses\$timerRelative" }
}
foreach ($timerLicense in (Get-ChildItem -LiteralPath (Join-Path $timerProduct 'packaging/fonts') -Recurse -File | Where-Object Extension -eq '.txt')) {
    $timerRelative = [IO.Path]::GetRelativePath((Join-Path $timerProduct 'packaging/fonts'), $timerLicense.FullName)
    $timerResources += [PSCustomObject]@{ Source = $timerLicense.FullName; Relative = "notices\fonts\$timerRelative" }
}
$timerInstallLines = @()
$timerRemoveLines = @()
$timerDirectories = [Collections.Generic.HashSet[string]]::new()
$timerSize = (Get-Item -LiteralPath $Payload).Length
foreach ($timerResource in $timerResources) {
    $timerSubdir = Split-Path $timerResource.Relative -Parent
    $timerInstallLines += 'SetOutPath "$INSTDIR\' + (Escape-Nsis $timerSubdir) + '"'
    $timerInstallLines += 'File /oname=' + (Escape-Nsis (Split-Path $timerResource.Relative -Leaf)) + ' "' + (Escape-Nsis $timerResource.Source) + '"'
    $timerRemoveLines += 'Delete "$INSTDIR\' + (Escape-Nsis $timerResource.Relative) + '"'
    while ($timerSubdir) { [void]$timerDirectories.Add($timerSubdir); $timerSubdir = Split-Path $timerSubdir -Parent }
    $timerSize += (Get-Item -LiteralPath $timerResource.Source).Length
}
foreach ($timerDir in ($timerDirectories | Sort-Object Length -Descending)) { $timerRemoveLines += 'RMDir "$INSTDIR\' + (Escape-Nsis $timerDir) + '"' }
$timerDefinitions += '!define ESTIMATED_KIB ' + [Math]::Ceiling($timerSize / 1024)
$timerDefinitions | Set-Content -LiteralPath (Join-Path $timerBuild 'payload.nsh') -Encoding utf8
$timerInstallLines | Set-Content -LiteralPath (Join-Path $timerBuild 'install-resources.nsh') -Encoding utf8
$timerRemoveLines | Set-Content -LiteralPath (Join-Path $timerBuild 'uninstall-resources.nsh') -Encoding utf8
$timerManifest = [ordered]@{
    application='程序员调酒台'; english_name='Programmer Mixology'; version='1.2.0'; architecture='x64'; payload_sha256=$timerDigest
    payload_product_version=$timerVersion; installer='NSIS + native pixel chrome'; scope='currentUser'
    preview_only=[bool]$PreviewOnly; data_preserved='%LOCALAPPDATA%/local.pixelmix.workbench'
    resources=@($timerResources.Relative)
}
$timerManifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $timerBuild 'install-manifest.json') -Encoding utf8
& $timerNsis /V3 /INPUTCHARSET UTF8 "/DBUILD_DIR=$timerBuild" (Join-Path $timerSource 'installer.nsi')
if ($LASTEXITCODE -ne 0) { throw 'NSIS installer compilation failed' }
[ordered]@{ path=$Output; bytes=(Get-Item -LiteralPath $Output).Length; sha256=(Get-FileHash -LiteralPath $Output -Algorithm SHA256).Hash.ToLowerInvariant(); payload=$timerOriginalPayload; payload_sha256=$timerDigest; version=$timerVersion; preview_only=[bool]$PreviewOnly } | ConvertTo-Json
