import { execFileSync } from "node:child_process";

let cached = null;
let cachedAt = 0;

function num(v) {
  if (v == null) return null;
  const n = Number(String(v).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function readGpuSnapshot() {
  const now = Date.now();
  if (cached && now - cachedAt < 2000) return cached;
  try {
    const raw = execFileSync(
      "nvidia-smi",
      [
        "--query-gpu=name,utilization.gpu,utilization.memory,memory.used,memory.total,temperature.gpu,power.draw,power.limit",
        "--format=csv,noheader,nounits",
      ],
      { encoding: "utf8", windowsHide: true, timeout: 4000 },
    );
    const gpus = raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split(",").map((p) => p.trim());
        return {
          name: parts[0] || "GPU",
          utilGpuPct: num(parts[1]),
          utilMemPct: num(parts[2]),
          memUsedMiB: num(parts[3]),
          memTotalMiB: num(parts[4]),
          tempC: num(parts[5]),
          powerW: num(parts[6]),
          powerLimitW: num(parts[7]),
        };
      });
    cached = { available: gpus.length > 0, gpus, source: "nvidia-smi" };
    cachedAt = now;
    return cached;
  } catch {
    cached = {
      available: false,
      gpus: [],
      source: "nvidia-smi",
      note: "nvidia-smi not available",
    };
    cachedAt = now;
    return cached;
  }
}
