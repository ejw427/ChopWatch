# Stop ChopWatch desktop/helper/vite processes and free ports.
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot

Write-Host "Stopping ChopWatch processes..."

Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
  $_.CommandLine -and (
    $_.CommandLine -like "*ChopWatch*desktop*" -or
    $_.CommandLine -like "*ChopWatch*helper*src*index.js*" -or
    $_.CommandLine -like "*ChopWatch*web*vite*" -or
    ($_.Name -eq "electron.exe" -and $_.CommandLine -like "*ChopWatch*")
  )
} | ForEach-Object {
  Write-Host "  kill $($_.ProcessId) $($_.Name)"
  Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
}

Get-Process electron -ErrorAction SilentlyContinue | Where-Object {
  try {
    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)" -ErrorAction Stop
    $p.CommandLine -like "*ChopWatch*"
  } catch { $false }
} | Stop-Process -Force -ErrorAction SilentlyContinue

foreach ($port in @(5177, 3781)) {
  $owners = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique)
  foreach ($ownerId in $owners) {
    if ($ownerId -and $ownerId -ne 0) {
      Write-Host "  free port $port (PID $ownerId)"
      Stop-Process -Id $ownerId -Force -ErrorAction SilentlyContinue
    }
  }
}

Start-Sleep -Seconds 1
Write-Host "ChopWatch stopped. ($root)"
