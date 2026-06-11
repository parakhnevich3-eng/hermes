$ErrorActionPreference = 'Stop'

$RootDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$WatchdogScript = Join-Path $RootDir 'scripts\hermes-watchdog.mjs'
$Existing = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
  Where-Object {
    $_.CommandLine -like '*hermes-watchdog.mjs*' -and
    $_.CommandLine -like "*$RootDir*"
  }

if ($Existing) {
  exit 0
}

$Node = (Get-Command node.exe -ErrorAction Stop).Source
Start-Process `
  -FilePath $Node `
  -ArgumentList @($WatchdogScript) `
  -WorkingDirectory $RootDir `
  -WindowStyle Hidden
