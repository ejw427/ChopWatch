# Decrypt Chromium/Electron "auth" cookie for salad.com (v10 / legacy DPAPI).
# Prints JSON only: { ok, source, host, preview, value? }  (value only on success)
# Never writes secrets to disk itself.

param(
  [switch]$IncludeValue
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Security

Add-Type @"
using System;
using System.IO;
using Microsoft.Win32.SafeHandles;
using System.Runtime.InteropServices;
using System.ComponentModel;

public static class CwLockedCopy {
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  private static extern SafeFileHandle CreateFile(
    string lpFileName, uint dwDesiredAccess, uint dwShareMode,
    IntPtr lpSecurityAttributes, uint dwCreationDisposition,
    uint dwFlagsAndAttributes, IntPtr hTemplateFile);

  public static void Copy(string src, string dst) {
    // GENERIC_READ, FILE_SHARE_READ|WRITE|DELETE, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS
    var h = CreateFile(src, 0x80000000, 0x7, IntPtr.Zero, 3, 0x02000000, IntPtr.Zero);
    if (h.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
    using (h)
    using (var input = new FileStream(h, FileAccess.Read))
    using (var output = File.Create(dst)) {
      input.CopyTo(output);
    }
  }
}
"@

function Get-AesKeyFromLocalState([string]$localStatePath) {
  $json = Get-Content -Raw -LiteralPath $localStatePath | ConvertFrom-Json
  if (-not $json.os_crypt.encrypted_key) { return $null }
  $encKey = [Convert]::FromBase64String([string]$json.os_crypt.encrypted_key)
  # strip "DPAPI" prefix
  $blob = $encKey[5..($encKey.Length - 1)]
  return [System.Security.Cryptography.ProtectedData]::Unprotect(
    $blob, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
}

function Decrypt-CookieValue([byte[]]$enc, [byte[]]$aesKey) {
  if ($null -eq $enc -or $enc.Length -lt 4) { return $null }
  $prefix = [Text.Encoding]::ASCII.GetString($enc[0..2])
  if ($prefix -eq "v10" -or $prefix -eq "v11") {
    if ($null -eq $aesKey) { return $null }
    $nonce = $enc[3..14]
    $cipher = $enc[15..($enc.Length - 17)]
    $tag = $enc[($enc.Length - 16)..($enc.Length - 1)]
    $plain = New-Object byte[] $cipher.Length
    $aes = [System.Security.Cryptography.AesGcm]::new($aesKey)
    $aes.Decrypt($nonce, $cipher, $tag, $plain, $null)
    $text = [Text.Encoding]::UTF8.GetString($plain)
    # Cookie DB format 24+ may prefix 32-byte domain hash
    if ($text.Length -gt 32 -and $text.StartsWith([char]0) -eq $false) {
      # If looks like hash+value (binary prefix), try skipping 32 bytes when non-printable head
      $head = $plain[0..31]
      $printable = ($head | Where-Object { $_ -ge 32 -and $_ -le 126 }).Count
      if ($printable -lt 16 -and $plain.Length -gt 32) {
        $text = [Text.Encoding]::UTF8.GetString($plain[32..($plain.Length - 1)])
      }
    }
    return $text
  }
  # legacy per-value DPAPI
  try {
    $dec = [System.Security.Cryptography.ProtectedData]::Unprotect(
      $enc, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
    return [Text.Encoding]::UTF8.GetString($dec)
  } catch {
    return $null
  }
}

function Find-AuthInDb([string]$dbPath, [byte[]]$aesKey, [string]$source) {
  $sqlite = @(
    "$env:LOCALAPPDATA\Android\Sdk\platform-tools\sqlite3.exe",
    "$env:USERPROFILE\.local\bin\sqlite3.exe",
    "sqlite3"
  ) | Where-Object { $_ -eq "sqlite3" -or (Test-Path $_) } | Select-Object -First 1
  if (-not $sqlite) { return $null }

  # host_key, name, hex(encrypted_value), value
  $sql = @"
SELECT host_key, name, hex(encrypted_value), value
FROM cookies
WHERE name = 'auth'
  AND (host_key LIKE '%salad.com%' OR host_key LIKE '%salad.io%')
ORDER BY last_access_utc DESC
LIMIT 5;
"@
  $rows = & $sqlite $dbPath $sql 2>$null
  foreach ($row in $rows) {
    if (-not $row) { continue }
    $parts = $row -split "\|", 4
    if ($parts.Count -lt 4) { continue }
    $hostKey = $parts[0]
    $name = $parts[1]
    $hex = $parts[2]
    $plainCol = $parts[3]
    $value = $null
    if ($plainCol -and $plainCol.Length -gt 8) {
      $value = $plainCol
    } elseif ($hex -and $hex.Length -ge 8) {
      $bytes = for ($i = 0; $i -lt $hex.Length; $i += 2) { [Convert]::ToByte($hex.Substring($i, 2), 16) }
      $value = Decrypt-CookieValue ([byte[]]$bytes) $aesKey
    }
    if ($value -and $value.Length -gt 20) {
      return [pscustomobject]@{
        ok = $true
        source = $source
        host = $hostKey
        name = $name
        length = $value.Length
        preview = $value.Substring(0, [Math]::Min(10, $value.Length)) + "…"
        value = $value
      }
    }
  }
  return $null
}

function Try-Profile([string]$name, [string]$localState, [string]$cookies) {
  if (-not (Test-Path -LiteralPath $cookies)) {
    return [pscustomobject]@{ ok = $false; source = $name; error = "cookies missing" }
  }
  $tmp = Join-Path $env:TEMP ("cw-auth-" + [guid]::NewGuid().ToString() + ".db")
  try {
    try {
      [CwLockedCopy]::Copy($cookies, $tmp)
    } catch {
      # fallback share-read
      $in = [IO.File]::Open($cookies, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
      try {
        $out = [IO.File]::Create($tmp)
        try { $in.CopyTo($out) } finally { $out.Dispose() }
      } finally { $in.Dispose() }
    }
    $key = $null
    if (Test-Path -LiteralPath $localState) {
      try { $key = Get-AesKeyFromLocalState $localState } catch { $key = $null }
    }
    $hit = Find-AuthInDb $tmp $key $name
    if ($hit) { return $hit }
    return [pscustomobject]@{ ok = $false; source = $name; error = "auth cookie not found/decryptable" }
  } catch {
    return [pscustomobject]@{ ok = $false; source = $name; error = $_.Exception.Message }
  } finally {
    Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
  }
}

$candidates = @(
  @{
    name = "salad-electron"
    localState = Join-Path $env:APPDATA "Salad\Local State"
    cookies = Join-Path $env:APPDATA "Salad\Network\Cookies"
  },
  @{
    name = "chrome-default"
    localState = Join-Path $env:LOCALAPPDATA "Google\Chrome\User Data\Local State"
    cookies = Join-Path $env:LOCALAPPDATA "Google\Chrome\User Data\Default\Network\Cookies"
  },
  @{
    name = "edge-default"
    localState = Join-Path $env:LOCALAPPDATA "Microsoft\Edge\User Data\Local State"
    cookies = Join-Path $env:LOCALAPPDATA "Microsoft\Edge\User Data\Default\Network\Cookies"
  },
  @{
    name = "chrome-default-legacy-path"
    localState = Join-Path $env:LOCALAPPDATA "Google\Chrome\User Data\Local State"
    cookies = Join-Path $env:LOCALAPPDATA "Google\Chrome\User Data\Default\Cookies"
  },
  @{
    name = "edge-default-legacy-path"
    localState = Join-Path $env:LOCALAPPDATA "Microsoft\Edge\User Data\Local State"
    cookies = Join-Path $env:LOCALAPPDATA "Microsoft\Edge\User Data\Default\Cookies"
  }
)

$attempts = @()
foreach ($c in $candidates) {
  $r = Try-Profile $c.name $c.localState $c.cookies
  $attempts += $r
  if ($r.ok) {
    $out = [ordered]@{
      ok = $true
      source = $r.source
      host = $r.host
      length = $r.length
      preview = $r.preview
      attempts = @($attempts | ForEach-Object {
        [ordered]@{ source = $_.source; ok = [bool]$_.ok; error = $_.error }
      })
    }
    if ($IncludeValue) { $out.value = $r.value }
    $out | ConvertTo-Json -Compress -Depth 6
    exit 0
  }
}

[ordered]@{
  ok = $false
  error = "No salad auth cookie found in Salad/Chrome/Edge profiles"
  attempts = @($attempts | ForEach-Object {
    [ordered]@{ source = $_.source; ok = [bool]$_.ok; error = $_.error }
  })
} | ConvertTo-Json -Compress -Depth 6
exit 1
