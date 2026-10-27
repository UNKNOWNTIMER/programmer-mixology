# Launch the real workspace binary with independent, persistent developer data.
# No build/download/install, elevated privileges, firewall change, or debugging endpoint.
$ErrorActionPreference = 'Stop'
$pixelRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$pixelExecutable = Join-Path $pixelRoot 'target\debug\pixel-mix.exe'
if (-not (Test-Path -LiteralPath $pixelExecutable -PathType Leaf)) {
    throw 'Developer binary is missing. Build the client and run cargo build -p pixel-mix first.'
}
$pixelRunning = Get-Process -Name pixel-mix -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $pixelExecutable }
if ($pixelRunning) { Write-Output 'The workspace preview is already running.'; exit 0 }
$pixelData = Join-Path $pixelRoot '.local-preview'
New-Item -ItemType Directory -Path $pixelData -Force | Out-Null
$env:PIXEL_MIX_TEST_DATA_DIR = $pixelData
$env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $pixelData 'WebView2'
Remove-Item Env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS -ErrorAction SilentlyContinue
$pixelPreviewProcess = Start-Process -FilePath $pixelExecutable -WorkingDirectory $pixelRoot -WindowStyle Hidden -PassThru
Write-Output "Developer preview PID: $($pixelPreviewProcess.Id). Data: $pixelData"
