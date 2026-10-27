param([switch]$SkipTests)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'enter-build-env.ps1')
$pixelRoot = Split-Path $PSScriptRoot -Parent
Push-Location $pixelRoot
try {
    $env:RUSTUP_TOOLCHAIN = 'stable'
    pnpm --dir apps/client install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { throw 'Frozen dependency installation failed' }
    if (-not $SkipTests) {
        cargo +stable test --locked --workspace --exclude pixel-mix --no-fail-fast
        if ($LASTEXITCODE -ne 0) { throw 'Rust tests failed' }
        pnpm --dir apps/client test
        if ($LASTEXITCODE -ne 0) { throw 'Frontend tests failed' }
    }
    pnpm --dir apps/client tauri build --bundles nsis --ci --no-sign -- --locked
    if ($LASTEXITCODE -ne 0) { throw 'Tauri Windows build failed' }
    $pixelBundles = @(Get-ChildItem -LiteralPath (Join-Path $pixelRoot 'target/release/bundle/nsis') -Filter '*setup.exe')
    if ($pixelBundles.Count -ne 1) { throw 'Expected exactly one NSIS installer' }
    $pixelDelivery = Join-Path $pixelRoot 'packaging/installer'
    New-Item -ItemType Directory -Path $pixelDelivery -Force | Out-Null
    $pixelInstaller = Join-Path $pixelDelivery 'PIXEL_MIX_0.1.0_x64-setup.exe'
    Copy-Item -LiteralPath $pixelBundles[0].FullName -Destination $pixelInstaller
    cargo +stable build --release --locked -p pixelmix-lan-host --example recover_host
    if ($LASTEXITCODE -ne 0) { throw 'Recovery helper build failed' }
    Copy-Item -LiteralPath (Join-Path $pixelRoot 'target/release/examples/recover_host.exe') -Destination (Join-Path $pixelDelivery 'PIXEL_MIX_HostRecovery_0.1.0_x64.exe')
    Get-ChildItem -LiteralPath $pixelDelivery -Filter '*.exe' | Sort-Object Name | ForEach-Object {
        $pixelDigest = Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256
        "$($pixelDigest.Hash.ToLowerInvariant())  $($_.Name)"
    } | Set-Content -LiteralPath (Join-Path $pixelDelivery 'SHA256SUMS.txt') -Encoding ascii
    Copy-Item -LiteralPath (Join-Path $pixelDelivery 'SHA256SUMS.txt') -Destination (Join-Path $pixelRoot 'packaging/SHA256SUMS.txt')
    Get-Item -LiteralPath $pixelInstaller | Select-Object FullName, Length
    Get-FileHash -LiteralPath $pixelInstaller -Algorithm SHA256
} finally { Pop-Location }
