# Trust the ChopWatch SignPath self-signed *test* certificate on this PC.
# Public .cer only — private key stays in SignPath.
# Usage: pwsh -File scripts/trust-test-cert.ps1

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$cerPath = Join-Path $repoRoot 'certs\chopwatch-test-signing.cer'
if (-not (Test-Path $cerPath)) {
    throw "Missing $cerPath"
}

$cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 $cerPath
$thumb = $cert.Thumbprint
Write-Host "Trusting $($cert.Subject)"
Write-Host "Thumbprint $thumb"

function Test-InStore([string]$storePath) {
    return [bool](Get-ChildItem $storePath -ErrorAction SilentlyContinue | Where-Object { $_.Thumbprint -eq $thumb })
}

if (-not (Test-InStore 'Cert:\CurrentUser\Root')) {
    certutil -user -addstore Root $cerPath | Out-Host
} else {
    Write-Host 'Already in CurrentUser\Root'
}

if (-not (Test-InStore 'Cert:\CurrentUser\TrustedPublisher')) {
    Import-Certificate -FilePath $cerPath -CertStoreLocation Cert:\CurrentUser\TrustedPublisher | Out-Null
    Write-Host 'Added to CurrentUser\TrustedPublisher'
} else {
    Write-Host 'Already in CurrentUser\TrustedPublisher'
}

Write-Host 'Done. This only helps test-signed builds on this account; it does not fix SmartScreen for other PCs.'
