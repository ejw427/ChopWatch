import { execFileSync } from "node:child_process";
import { readRuntimeState, writeRuntimeState } from "./store.js";

const SAMPLE_LIMIT = 30;
const SAMPLE_MIN_MS = 2500;

let cached = null;
let cachedAt = 0;

function num(v) {
  if (v == null) return null;
  const n = Number(String(v).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function recordUtilSample(utilGpuPct) {
  if (utilGpuPct == null || !Number.isFinite(utilGpuPct)) {
    const state = readRuntimeState();
    return Array.isArray(state.gpuUtilSamples) ? state.gpuUtilSamples : [];
  }
  const state = readRuntimeState();
  const now = Date.now();
  const prevAt = Number(state.gpuUtilSampleAt) || 0;
  let samples = Array.isArray(state.gpuUtilSamples)
    ? state.gpuUtilSamples.filter((n) => Number.isFinite(n))
    : [];

  if (now - prevAt >= SAMPLE_MIN_MS || samples.length === 0) {
    samples = [...samples, Math.max(0, Math.min(100, utilGpuPct))].slice(
      -SAMPLE_LIMIT,
    );
    writeRuntimeState({
      gpuUtilSamples: samples,
      gpuUtilSampleAt: now,
    });
  }
  return samples;
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
        const memUsedMiB = num(parts[3]);
        const memTotalMiB = num(parts[4]);
        // utilization.memory = % of time the memory controller was busy
        // (bandwidth activity), NOT how full VRAM is. VRAM fill is used/total.
        const memControllerBusyPct = num(parts[2]);
        const memUsedPct =
          memUsedMiB != null && memTotalMiB != null && memTotalMiB > 0
            ? Math.round((memUsedMiB / memTotalMiB) * 1000) / 10
            : null;
        const powerW = num(parts[6]);
        const powerLimitW = num(parts[7]);
        const powerPct =
          powerW != null && powerLimitW != null && powerLimitW > 0
            ? Math.round((powerW / powerLimitW) * 1000) / 10
            : null;
        return {
          name: parts[0] || "GPU",
          utilGpuPct: num(parts[1]),
          utilMemPct: memUsedPct,
          memControllerBusyPct,
          memUsedMiB,
          memTotalMiB,
          tempC: num(parts[5]),
          powerW,
          powerLimitW,
          powerPct,
        };
      });
    const primary = gpus[0];
    const utilHistory = recordUtilSample(primary?.utilGpuPct ?? null);
    cached = {
      available: gpus.length > 0,
      gpus,
      utilHistory,
      source: "nvidia-smi",
    };
    cachedAt = now;
    return cached;
  } catch {
    const state = readRuntimeState();
    cached = {
      available: false,
      gpus: [],
      utilHistory: Array.isArray(state.gpuUtilSamples)
        ? state.gpuUtilSamples
        : [],
      source: "nvidia-smi",
      note: "nvidia-smi not available",
    };
    cachedAt = now;
    return cached;
  }
}
