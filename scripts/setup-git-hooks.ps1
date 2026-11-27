# Point this repo at tracked hooks in .githooks/ (version bump pre-commit, etc.).

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot

Push-Location $repoRoot
try {
    $hooksPath = Join-Path $repoRoot '.githooks'
    if (-not (Test-Path $hooksPath)) {
        Write-Error "Missing hooks directory: $hooksPath"
    }

    git config core.hooksPath .githooks
    Write-Host "Git hooks enabled (core.hooksPath=.githooks)."
}
finally {
    Pop-Location
}
