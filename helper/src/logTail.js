import fs from "node:fs";
import path from "node:path";
import { paths, exists } from "./saladPaths.js";

export function listBowlLogFiles() {
  if (!exists(paths.bowlLogs)) return [];
  return fs
    .readdirSync(paths.bowlLogs, { withFileTypes: true })
    .filter((d) => d.isFile() && /^log-\d/.test(d.name) && d.name.endsWith(".txt"))
    .map((d) => {
      const full = path.join(paths.bowlLogs, d.name);
      const st = fs.statSync(full);
      return { name: d.name, full, mtimeMs: st.mtimeMs, size: st.size };
    })
    .filter((f) => f.size > 0)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

export function readTail(filePath, maxBytes = 750_000) {
  const st = fs.statSync(filePath);
  const start = Math.max(0, st.size - maxBytes);
  const len = st.size - start;
  if (len <= 0) return "";
  const fd = fs.openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, start);
    return buf.toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Read recent Bowl log text. Newest file is preferred in full when under
 * `fullFileMaxBytes` because busy logs bury WLInstanceState under HTTP spam
 * that can exceed a small tail window.
 */
export function readRecentBowlText(
  fileCount = 2,
  maxBytes = 750_000,
  { fullFileMaxBytes = 12_000_000 } = {},
) {
  const files = listBowlLogFiles().slice(0, fileCount);
  const chunks = files.map((f, i) => {
    const budget =
      i === 0 ? Math.max(maxBytes, fullFileMaxBytes) : maxBytes;
    let text = "";
    try {
      if (f.size <= budget) {
        text = fs.readFileSync(f.full, "utf8");
      } else {
        text = readTail(f.full, budget);
      }
    } catch {
      text = "";
    }
    return { file: f, text };
  });
  return { files, chunks, text: chunks.map((c) => c.text).join("\n") };
}

/**
 * Normalize Bowl / wallet timestamps for Date.parse.
 * Accepts: "2026-11-26 18:03:42.908", "2026-11-26 18:03:42.908 -07:00", ISO.
 */
export function toParsableTs(ts) {
  if (ts == null) return null;
  const raw = String(ts).trim();
  if (!raw) return null;
  const m = raw.match(
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)\s*([Zz]|[+-]\d{2}:?\d{2})?$/,
  );
  if (!m) return raw.includes("T") ? raw : raw.replace(" ", "T");
  let offset = m[3] || "";
  if (offset && offset.toUpperCase() !== "Z" && !offset.includes(":")) {
    offset = offset.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  }
  if (offset && offset.toUpperCase() === "Z") offset = "Z";
  return `${m[1]}T${m[2]}${offset}`;
}

export function parseTsAgeSec(ts, nowMs = Date.now()) {
  if (!ts) return null;
  const t = Date.parse(toParsableTs(ts));
  if (!Number.isFinite(t)) return null;
  return Math.max(0, (nowMs - t) / 1000);
}
