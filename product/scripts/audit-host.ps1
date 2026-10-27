param([string]$Output = (Join-Path $PSScriptRoot '..\evidence\host-audit.json'))
$ErrorActionPreference = 'Stop'
$pixelOs = Get-CimInstance Win32_OperatingSystem
$pixelCpu = Get-CimInstance Win32_Processor
$pixelGpus = Get-CimInstance Win32_VideoController
$pixelReport = [ordered]@{
  captured_at = (Get-Date).ToString('o')
  evidence_scope = 'Local Windows CIM on the target host; no cloud hardware substituted'
  computer = $env:COMPUTERNAME
  os = $pixelOs.Caption
  version = $pixelOs.Version
  architecture = $pixelOs.OSArchitecture
  total_ram_gib = [math]::Round($pixelOs.TotalVisibleMemorySize / 1MB, 2)
  available_ram_gib = [math]::Round($pixelOs.FreePhysicalMemory / 1MB, 2)
  cpu = @($pixelCpu | Select-Object Name,NumberOfCores,NumberOfLogicalProcessors)
  gpu = @($pixelGpus | Select-Object Name,DriverVersion,PNPDeviceID)
  vram = 'Not measured reliably: Win32_VideoController.AdapterRAM is 32-bit and not used as VRAM evidence'
  free_disk = @(Get-PSDrive -PSProvider FileSystem | Select-Object Name,Free)
  webview2 = @(Get-ChildItem 'C:\Program Files (x86)\Microsoft\EdgeWebView\Application' -Directory -ErrorAction SilentlyContinue | ForEach-Object Name)
  android_sdk_present = (Test-Path "$env:LOCALAPPDATA\Android\Sdk")
  ios_toolchain = 'Unavailable on Windows; Mac/Xcode and provisioning required'
  permissions_changed = $false
  firewall_changed = $false
  model_downloaded = $false
}
$pixelReport | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $Output -Encoding utf8
$pixelReport | ConvertTo-Json -Depth 8
