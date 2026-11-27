# Restart only the ChopWatch helper on :3781.
$ErrorActionPreference = "Stop"
$helperDir = Join-Path (Split-Path -Parent $PSScriptRoot) "helper"

Write-Host "Restarting ChopWatch helper..."

$owners = @(Get-NetTCPConnection -LocalPort 3781 -State Listen -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique)
foreach ($ownerId in $owners) {
  if ($ownerId -and $ownerId -ne 0) {
    Write-Host "  stop PID $ownerId"
    Stop-Process -Id $ownerId -Force -ErrorAction SilentlyContinue
  }
}

Start-Sleep -Seconds 1
Start-Process -FilePath "node" -ArgumentList "src/index.js" -WorkingDirectory $helperDir -WindowStyle Hidden
Start-Sleep -Seconds 2

try {
  $health = Invoke-WebRequest -Uri "http://127.0.0.1:3781/health" -UseBasicParsing -TimeoutSec 5
  Write-Host "Helper live: $($health.Content)"
} catch {
  Write-Host "Helper started but health check failed: $($_.Exception.Message)"
  exit 1
}
