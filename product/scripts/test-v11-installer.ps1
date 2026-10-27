param([Parameter(Mandatory)][string]$Installer, [string]$EvidenceName = 'candidate', [switch]$LeaveInstalled)
$ErrorActionPreference = 'Stop'
$timerProduct = Split-Path $PSScriptRoot -Parent
$timerBase = [IO.Path]::GetFullPath((Join-Path $timerProduct 'evidence/v1.1/installer-test'))
$timerInstall = [IO.Path]::GetFullPath((Join-Path $timerBase ('install-' + $EvidenceName)))
if ($EvidenceName -notmatch '^[a-zA-Z0-9-]+$' -or -not $timerInstall.StartsWith($timerBase + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid isolated test target' }
if (Test-Path -LiteralPath $timerInstall) { throw 'Use a new evidence name; previous evidence is preserved' }
$Installer = (Resolve-Path -LiteralPath $Installer).Path
$timerRegistry = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\TIMER-V11-TEST'
if (Test-Path -LiteralPath $timerRegistry) { throw 'An isolated test registration already exists; inspect before another test' }
New-Item -ItemType Directory -Path $timerBase -Force | Out-Null
$timerReport = [ordered]@{ installer=$Installer; installer_sha256=(Get-FileHash -LiteralPath $Installer).Hash.ToLowerInvariant(); target=$timerInstall; app_launched=$false; ui_activated=$false; assertions=@(); stages=@() }
function Get-NormalState {
    $files = @()
    foreach ($directory in @((Join-Path $timerProduct '.local-preview'), (Join-Path $env:LOCALAPPDATA 'local.pixelmix.workbench'))) {
        if (Test-Path -LiteralPath $directory) {
            foreach ($file in (Get-ChildItem -LiteralPath $directory -File -Filter '*.sqlite*')) {
                $files += [ordered]@{ path=$file.FullName; size=$file.Length; sha256=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
            }
        }
    }
    $key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\PIXEL MIX'
    $registration = if (Test-Path -LiteralPath $key) { Get-ItemProperty -LiteralPath $key | Select-Object DisplayName,DisplayVersion,InstallLocation,UninstallString } else { $null }
    [ordered]@{ files=$files; registration=$registration }
}
function Assert-Check([bool]$Condition,[string]$Name) {
    $timerReport.assertions += [ordered]@{ name=$Name; pass=$Condition }
    if (-not $Condition) { throw "Failed: $Name" }
}
function Get-PersistentState($State) {
    # SQLite SHM contains volatile reader slots/locks and can change on a
    # concurrent read-only connection. The database and WAL hold durable content.
    [ordered]@{ files=@($State.files | Where-Object { -not $_.path.EndsWith('-shm') }); registration=$State.registration }
}
function Run-Silent([string]$Exe,[string]$Arguments,[string]$Stage,[int]$Expected=0) {
    $watch = [Diagnostics.Stopwatch]::StartNew()
    $process = Start-Process -FilePath $Exe -ArgumentList $Arguments -WindowStyle Hidden -PassThru
    if (-not $process.WaitForExit(60000)) { throw "$Stage did not finish within60s; process remains for inspection" }
    $watch.Stop()
    $timerReport.stages += [ordered]@{ stage=$Stage; arguments=$Arguments; exit_code=$process.ExitCode; elapsed_ms=$watch.ElapsedMilliseconds }
    Assert-Check ($process.ExitCode -eq $Expected) "$Stage exit=$Expected"
}
$timerBefore = Get-NormalState
$timerBefore | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $timerBase "$EvidenceName-normal-before.json") -Encoding utf8
try {
    $timerArgs = '/S /ISOLATED=1 /D=' + $timerInstall
    Run-Silent $Installer $timerArgs 'install'
    $manifest = Get-Content -LiteralPath (Join-Path $timerInstall 'install-manifest.json') -Raw | ConvertFrom-Json
    $timerExe = Join-Path $timerInstall 'pixel-mix.exe'
    $timerHash = (Get-FileHash -LiteralPath $timerExe -Algorithm SHA256).Hash.ToLowerInvariant()
    Assert-Check ($manifest.version -eq '1.2.0' -and -not $manifest.preview_only) 'real Programmer Mixology 1.2.0 manifest'
    Assert-Check ($timerHash -eq $manifest.payload_sha256) 'installed EXE equals verified payload'
    Assert-Check ((Get-Item -LiteralPath $timerExe).VersionInfo.ProductVersion -eq '1.2.0') 'installed PE product version1.2.0'
    $timerReport.payload_sha256 = $timerHash
    $registry = Get-ItemProperty -LiteralPath $timerRegistry
    Assert-Check ($registry.InstallLocation -eq $timerInstall -and $registry.DisplayVersion -eq '1.2.0') 'isolated registration points to actual Programmer Mixology 1.2.0 installation'
    Assert-Check ($registry.QuietUninstallString -eq ('"' + $timerInstall + '\uninstall.exe" /S')) 'quoted quiet uninstall path'
    Assert-Check (Test-Path -LiteralPath (Join-Path $timerInstall 'notices/NSIS-COPYING.txt')) 'NSIS license retained'
    Assert-Check ((Get-Content -LiteralPath (Join-Path $timerInstall 'notices/SBOM.cdx.json') -Raw | ConvertFrom-Json).metadata.component.version -eq '1.2.0') 'installed SBOM version1.2.0'
    $userNote = Join-Path $timerInstall 'keep-user-note.txt'
    $unknownNotice = Join-Path $timerInstall 'notices/keep-user-note.txt'
    'Preserve this user-owned fixture.' | Set-Content -LiteralPath $userNote -Encoding utf8
    'Preserve this unknown notice fixture.' | Set-Content -LiteralPath $unknownNotice -Encoding utf8
    $markerHash = (Get-FileHash -LiteralPath $userNote).Hash
    $noticeHash = (Get-FileHash -LiteralPath $unknownNotice).Hash
    Set-ItemProperty -LiteralPath $timerRegistry -Name DisplayVersion -Value '2.0.0'
    try { Run-Silent $Installer $timerArgs 'downgrade-block' 22 }
    finally { Set-ItemProperty -LiteralPath $timerRegistry -Name DisplayVersion -Value '1.2.0' }
    $collision = Join-Path $timerInstall '.timer-update.exe'
    'Unowned pending update; never overwrite.' | Set-Content -LiteralPath $collision -Encoding utf8
    $collisionHash = (Get-FileHash -LiteralPath $collision).Hash
    try {
        Run-Silent $Installer $timerArgs 'pending-update-block' 24
        Assert-Check ((Get-FileHash -LiteralPath $collision).Hash -eq $collisionHash) 'pending update collision is preserved'
    } finally { Remove-Item -LiteralPath $collision }
    $lock = [IO.File]::Open($timerExe, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None)
    try {
        Run-Silent $Installer $timerArgs 'locked-install' 32
        Run-Silent (Join-Path $timerInstall 'uninstall.exe') ('/S _?=' + $timerInstall) 'locked-uninstall' 32
    } finally { $lock.Dispose() }
    Assert-Check ((Get-FileHash -LiteralPath $timerExe).Hash.ToLowerInvariant() -eq $timerHash) 'lock rejection leaves installed payload unchanged'
    Run-Silent $Installer $timerArgs 'reinstall'
    Assert-Check ((Get-FileHash -LiteralPath $timerExe).Hash.ToLowerInvariant() -eq $timerHash) 'reinstall payload hash unchanged'
    Assert-Check ((Get-FileHash -LiteralPath $userNote).Hash -eq $markerHash) 'reinstall preserves unknown user file'
    Assert-Check (-not (Test-Path -LiteralPath (Join-Path $timerInstall '.timer-previous.exe'))) 'successful reinstall removes only its temporary old EXE'
    # Normal NSIS uninstall copies itself to TEMP. The parent may finish before
    # its bounded child, so check actual postconditions rather than parent exit alone.
    Run-Silent (Join-Path $timerInstall 'uninstall.exe') '/S' 'uninstall'
    $timerRemovalWatch = [Diagnostics.Stopwatch]::StartNew()
    while ((Test-Path -LiteralPath $timerExe) -or (Test-Path -LiteralPath (Join-Path $timerInstall 'uninstall.exe'))) {
        if ($timerRemovalWatch.ElapsedMilliseconds -gt 10000) { break }
        Start-Sleep -Milliseconds 100
    }
    Assert-Check (-not (Test-Path -LiteralPath $timerExe)) 'uninstall removes application EXE'
    Assert-Check (-not (Test-Path -LiteralPath (Join-Path $timerInstall 'uninstall.exe'))) 'normal uninstall removes its own executable'
    Assert-Check (-not (Test-Path -LiteralPath $timerRegistry)) 'uninstall removes isolated registration'
    Assert-Check ((Get-FileHash -LiteralPath $userNote).Hash -eq $markerHash) 'uninstall preserves unknown user file'
    Assert-Check ((Get-FileHash -LiteralPath $unknownNotice).Hash -eq $noticeHash) 'uninstall preserves unknown file inside notices'
    if ($LeaveInstalled) {
        Run-Silent $Installer $timerArgs 'leave-installed-for-root'
        Assert-Check ((Get-FileHash -LiteralPath $timerExe).Hash.ToLowerInvariant() -eq $timerHash) 'final installation retained for independent root runtime checks'
        $timerReport.installed_for_root = $true
    }
    $timerAfter = Get-NormalState
    $timerAfter | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $timerBase "$EvidenceName-normal-after.json") -Encoding utf8
    $timerReport.shm_before = @($timerBefore.files | Where-Object { $_.path.EndsWith('-shm') })
    $timerReport.shm_after = @($timerAfter.files | Where-Object { $_.path.EndsWith('-shm') })
    Assert-Check ((Get-PersistentState $timerBefore | ConvertTo-Json -Depth 8 -Compress) -eq (Get-PersistentState $timerAfter | ConvertTo-Json -Depth 8 -Compress)) 'normal app database and WAL bytes plus default installation registration unchanged'
    $timerReport.success = $true
} catch {
    $timerReport.success = $false
    $timerReport.failure = $_.ToString()
    throw
} finally {
    $timerReport | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $timerBase "$EvidenceName-results.json") -Encoding utf8
}
$timerReport | ConvertTo-Json -Depth 8
