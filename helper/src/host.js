import { execFileSync } from "node:child_process";
import os from "node:os";

let cached = null;
let cachedAt = 0;

function psJson(command) {
  try {
    const raw = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-Command", command],
      { encoding: "utf8", windowsHide: true, timeout: 5000 },
    ).trim();
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function readHostSnapshot() {
  const now = Date.now();
  if (cached && now - cachedAt < 5000) return cached;

  const memTotalMb = Math.round(os.totalmem() / (1024 * 1024));
  const memFreeMb = Math.round(os.freemem() / (1024 * 1024));
  const memUsedMb = memTotalMb - memFreeMb;
  const memUsedPct = Math.round((memUsedMb / memTotalMb) * 1000) / 10;

  const data = psJson(`
    $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1;
    [pscustomobject]@{
      cpuName = $cpu.Name
      cpuLoadPct = [int]$cpu.LoadPercentage
    } | ConvertTo-Json -Compress
  `);

  cached = {
    cpuName: data?.cpuName ?? null,
    cpuLoadPct: Number.isFinite(data?.cpuLoadPct) ? data.cpuLoadPct : null,
    memTotalMb,
    memFreeMb,
    memUsedMb,
    memUsedPct,
  };
  cachedAt = now;
  return cached;
}
