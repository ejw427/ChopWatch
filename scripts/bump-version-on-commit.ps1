# Bumps ChopWatch semver PATCH on each commit (0.5.0 -> 0.5.1 -> 0.5.2).
# Major and minor stay put unless edited by hand.
# Syncs root package.json / package-lock.json and helper + web package.json versions.
# Invoked from .githooks/pre-commit.

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$packageJsonPath = Join-Path $repoRoot 'package.json'
$packageLockPath = Join-Path $repoRoot 'package-lock.json'
$helperPackagePath = Join-Path $repoRoot 'helper\package.json'
$webPackagePath = Join-Path $repoRoot 'web\package.json'
$desktopPackagePath = Join-Path $repoRoot 'desktop\package.json'

$versionFiles = @(
    'package.json',
    'package-lock.json',
    'helper/package.json',
    'web/package.json',
    'desktop/package.json'
)

function Get-PackageVersion([string]$JsonPath) {
    if (-not (Test-Path $JsonPath)) { return $null }
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

function Test-ShouldSkipBump {
    $skipMarkers = @('MERGE_HEAD', 'REBASE_HEAD', 'CHERRY_PICK_HEAD')
    foreach ($marker in $skipMarkers) {
        if (Test-Path (Join-Path $repoRoot ".git\$marker")) { return $true }
    }

    Push-Location $repoRoot
    try {
        $stagedChanges = @(git diff --cached HEAD --name-only 2>$null)
        if ($stagedChanges.Count -eq 0) { return $true }
        $nonVersionChanges = @($stagedChanges | Where-Object { $_ -notin $versionFiles })
        return $nonVersionChanges.Count -eq 0
    }
    finally { Pop-Location }
}

if (Test-ShouldSkipBump) { exit 0 }

if (-not (Test-Path $packageJsonPath)) {
    Write-Error "package.json not found at '$packageJsonPath'."
}

$beforeVersion = Get-PackageVersion $packageJsonPath
if ([string]::IsNullOrWhiteSpace($beforeVersion)) {
    Write-Error 'package.json is missing a version field.'
}

Push-Location $repoRoot
try {
    $npmCommand = Get-Command npm -ErrorAction SilentlyContinue
    if ($npmCommand) {
        npm version patch --no-git-tag-version --silent | Out-Null
    }
    else {
        if ($beforeVersion -notmatch '^(\d+)\.(\d+)\.(\d+)$') {
            Write-Error "Unsupported version format '$beforeVersion'."
        }
        $major = [int]$Matches[1]
        $minor = [int]$Matches[2]
        $patch = [int]$Matches[3] + 1
        $newVersion = "$major.$minor.$patch"
        Set-PackageVersion $packageJsonPath $newVersion
        if (Test-Path $packageLockPath) {
            $lockContent = Get-Content $packageLockPath -Raw
            $lockContent = $lockContent -replace ('"version":\s*"' + [regex]::Escape($beforeVersion) + '"'), ('"version": "' + $newVersion + '"')
            [System.IO.File]::WriteAllText($packageLockPath, $lockContent)
        }
    }
}
finally { Pop-Location }

$afterVersion = Get-PackageVersion $packageJsonPath
if ($afterVersion -eq $beforeVersion) {
    Write-Error "Version bump failed; still at '$beforeVersion'."
}

# Keep workspace packages on the same product version.
Set-PackageVersion $helperPackagePath $afterVersion
Set-PackageVersion $webPackagePath $afterVersion
Set-PackageVersion $desktopPackagePath $afterVersion

Push-Location $repoRoot
try {
    $existingVersionFiles = @(
        $versionFiles | Where-Object { Test-Path (Join-Path $repoRoot $_) }
    )
    if ($existingVersionFiles.Count -gt 0) {
        git add -- @existingVersionFiles | Out-Null
    }
    Write-Host "Bumped app version: $beforeVersion -> $afterVersion (patch; 0.5.x line)"
}
finally { Pop-Location }
