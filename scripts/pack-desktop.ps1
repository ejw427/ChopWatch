# Build a Windows installer / portable exe for ChopWatch (electron-builder).
# Usage:
#   pwsh -File scripts/pack-desktop.ps1
#   pwsh -File scripts/pack-desktop.ps1 -DirOnly   # unpacked dir only (faster smoke test)

param(
    [switch]$DirOnly
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

function Get-PackageVersion([string]$JsonPath) {
    $json = Get-Content $JsonPath -Raw | ConvertFrom-Json
    return [string]$json.version
}

function Set-PackageVersion([string]$JsonPath, [string]$Version) {
    if (-not (Test-Path $JsonPath)) { return }
    $raw = Get-Content $JsonPath -Raw
    $updated = [regex]::Replace(
        $raw,
        '("version"\s*:\s*")[^"]+(")',
        { param($m) $m.Groups[1].Value + $Version + $m.Groups[2].Value },
        1
    )
    [System.IO.File]::WriteAllText($JsonPath, $updated)
}

$rootPackage = Join-Path $repoRoot 'package.json'
$desktopPackage = Join-Path $repoRoot 'desktop\package.json'
$version = Get-PackageVersion $rootPackage
if ([string]::IsNullOrWhiteSpace($version)) {
    Write-Error 'Root package.json is missing a version.'
}
Set-PackageVersion $desktopPackage $version
Write-Host "Packaging ChopWatch $version"

Write-Host 'Building web UI...'
npm run build --prefix web
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$stageHelper = Join-Path $repoRoot 'build\helper-pack'
Write-Host "Staging production helper at $stageHelper ..."
if (Test-Path $stageHelper) {
    Remove-Item -Recurse -Force $stageHelper
}
New-Item -ItemType Directory -Force -Path $stageHelper | Out-Null
Copy-Item (Join-Path $repoRoot 'helper\package.json') $stageHelper
Copy-Item (Join-Path $repoRoot 'helper\package-lock.json') $stageHelper
Copy-Item (Join-Path $repoRoot 'helper\src') (Join-Path $stageHelper 'src') -Recurse
Copy-Item (Join-Path $repoRoot 'helper\scripts') (Join-Path $stageHelper 'scripts') -Recurse

Push-Location $stageHelper
try {
    npm ci --omit=dev
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
finally {
    Pop-Location
}

Write-Host 'Ensuring desktop tooling...'
npm install --prefix desktop
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$builderScript = if ($DirOnly) { 'pack' } else { 'dist' }
Write-Host "Running electron-builder ($builderScript)..."
npm run $builderScript --prefix desktop
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$releaseDir = Join-Path $repoRoot 'release'
Write-Host ''
Write-Host "Done. Artifacts under: $releaseDir"
if (Test-Path $releaseDir) {
    Get-ChildItem $releaseDir -File |
        Sort-Object Name |
        ForEach-Object { Write-Host ("  - {0} ({1:N1} MB)" -f $_.Name, ($_.Length / 1MB)) }
}
