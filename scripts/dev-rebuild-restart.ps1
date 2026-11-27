# Stop stack, rebuild web, then start the desktop app in this terminal.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

Write-Host "Rebuild + restart ChopWatch..."
& "$PSScriptRoot\dev-stop.ps1"

Set-Location $root
Write-Host "Building web..."
npm run build --prefix web
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Starting npm run app..."
npm run app
exit $LASTEXITCODE
