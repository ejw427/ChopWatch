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

export function readRecentBowlText(fileCount = 2, maxBytes = 750_000) {
  const files = listBowlLogFiles().slice(0, fileCount);
  const chunks = files.map((f) => ({
    file: f,
    text: readTail(f.full, maxBytes),
  }));
  return { files, chunks, text: chunks.map((c) => c.text).join("\n") };
}

export function parseTsAgeSec(ts) {
  if (!ts) return null;
  const t = Date.parse(String(ts).replace(" ", "T"));
  if (!Number.isFinite(t)) return null;
  return Math.max(0, (Date.now() - t) / 1000);
}
