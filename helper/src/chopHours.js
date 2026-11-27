import fs from "node:fs";
import { listBowlLogFiles, readTail } from "./logTail.js";

const STATE_ANY =
  /(?<ts>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+).*WLInstanceState(?<state>Pulling|InstallStarting|Starting|Running|Stopping|Stopped)/g;

const ACTIVE = new Set(["Pulling", "InstallStarting", "Starting", "Running"]);

export function dayKey(ts) {
  // Bowl logs are local wall time without timezone — treat as local calendar day.
  return String(ts).slice(0, 10);
}

export function parseTs(ts) {
  const t = Date.parse(String(ts).replace(" ", "T"));
  return Number.isFinite(t) ? t : null;
}

export const ACTIVE_STATES = ACTIVE;
export const GAP_CAP_MS = 15 * 60 * 1000;

function collectEvents(maxFiles = 20, maxBytesPerFile = 2_000_000) {
  const files = listBowlLogFiles().slice(0, maxFiles);
  const events = [];
  for (const f of files) {
    let text = "";
    try {
      // Prefer full file if small; else tail.
      if (f.size <= maxBytesPerFile) {
        text = fs.readFileSync(f.full, "utf8");
      } else {
        text = readTail(f.full, maxBytesPerFile);
      }
    } catch {
      continue;
    }
    for (const m of text.matchAll(STATE_ANY)) {
      if (!m.groups) continue;
      const ms = parseTs(m.groups.ts);
      if (ms == null) continue;
      events.push({
        at: m.groups.ts,
        ms,
        state: m.groups.state,
        active: ACTIVE.has(m.groups.state),
      });
    }
  }
  events.sort((a, b) => a.ms - b.ms);
  // Dedupe identical timestamp+state
  const out = [];
  let prev = "";
  for (const e of events) {
    const k = `${e.at}|${e.state}`;
    if (k === prev) continue;
    prev = k;
    out.push(e);
  }
  return { events: out, filesScanned: files.length };
}

/**
 * Integrate active-state time between consecutive state samples.
 * Caps each gap at 15 minutes to avoid counting huge idle holes when logs rotate.
 * @param {Array<{at:string,ms:number,state:string,active:boolean}>} events
 * @param {number} sinceMs
 * @param {{ nowMs?: number }} [opts]
 */
export function integrateHours(events, sinceMs, opts = {}) {
  const byDay = new Map();
  let totalMs = 0;
  const nowMs = opts.nowMs ?? Date.now();

  for (let i = 0; i < events.length - 1; i++) {
    const cur = events[i];
    const next = events[i + 1];
    if (!cur.active) continue;
    if (next.ms < sinceMs && cur.ms < sinceMs) continue;
    const start = Math.max(cur.ms, sinceMs);
    const end = next.ms;
    if (end <= start) continue;
    const gap = Math.min(end - start, GAP_CAP_MS);
    totalMs += gap;
    const day = dayKey(cur.at);
    byDay.set(day, (byDay.get(day) || 0) + gap);
  }

  // If currently active and last event is recent, extend to now (cap 15m)
  const last = events[events.length - 1];
  if (last?.active) {
    const start = Math.max(last.ms, sinceMs);
    const end = nowMs;
    if (end > start) {
      const gap = Math.min(end - start, GAP_CAP_MS);
      totalMs += gap;
      const day = dayKey(last.at);
      byDay.set(day, (byDay.get(day) || 0) + gap);
    }
  }

  return { totalMs, byDay };
}

export function msToHours(ms) {
  return Math.round((ms / 3_600_000) * 100) / 100;
}

let hoursCache = null;
let hoursCacheAt = 0;

export function readChopHours() {
  const now = Date.now();
  if (hoursCache && now - hoursCacheAt < 30_000) return hoursCache;

  const { events, filesScanned } = collectEvents();
  const dayMs = 86_400_000;

  const last24 = integrateHours(events, now - dayMs);
  const last7 = integrateHours(events, now - 7 * dayMs);
  const last30 = integrateHours(events, now - 30 * dayMs);

  // Build 14-day bar series (oldest → newest)
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now - i * dayMs);
    const key = d.toISOString().slice(0, 10);
    // Match local day keys from logs (YYYY-MM-DD local). Prefer local:
    const localKey = [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, "0"),
      String(d.getDate()).padStart(2, "0"),
    ].join("-");
    const ms = last30.byDay.get(localKey) || last30.byDay.get(key) || 0;
    days.push({
      day: localKey,
      hours: msToHours(ms),
      minutes: Math.round(ms / 60_000),
    });
  }

  hoursCache = {
    source: "bowl-logs",
    note: "Estimated from WLInstanceState samples (Pulling/Starting/Running). Gaps capped at 15m. Not Salad's official Chopping clock.",
    filesScanned,
    eventCount: events.length,
    last24hHours: msToHours(last24.totalMs),
    last7dHours: msToHours(last7.totalMs),
    last30dHours: msToHours(last30.totalMs),
    starChefProgressPct: Math.min(
      100,
      Math.round((last7.totalMs / (3000 * 60_000)) * 1000) / 10,
    ),
    starChefTargetHours: 50,
    days,
  };
  hoursCacheAt = now;
  return hoursCache;
}
