# Public entrypoint; the existing installer implementation is retained for upgrades.
param(
    [string]$Payload,
    [string]$Output,
    [switch]$PreviewOnly
)
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'build-v11-installer.ps1') @PSBoundParameters
if ($LASTEXITCODE) { exit $LASTEXITCODE }
