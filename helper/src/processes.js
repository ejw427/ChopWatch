import { execFileSync } from "node:child_process";

const WATCHED = [
  { key: "salad", match: /^Salad$/i, label: "Salad" },
  { key: "bowl", match: /^Salad\.Bowl\.Service$/i, label: "Bowl Service" },
  { key: "bootstrapper", match: /^Salad\.Bootstrapper$/i, label: "Bootstrapper" },
];

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

export function listSaladProcesses() {
  let raw = "";
  try {
    raw = execFileSync(
      "tasklist",
      ["/FO", "CSV", "/NH", "/FI", "IMAGENAME eq Salad*"],
      { encoding: "utf8", windowsHide: true },
    );
  } catch {
    return {
      running: false,
      processes: WATCHED.map((w) => ({
        key: w.key,
        label: w.label,
        running: false,
        count: 0,
        pids: [],
        memoryMb: 0,
      })),
    };
  }

  const rows = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map(parseCsvLine)
    .filter((cols) => cols.length >= 5)
    .map((cols) => {
      const image = String(cols[0] || "").replace(/\.exe$/i, "");
      return [image, ...cols.slice(1)];
    });

  const groups = WATCHED.map((w) => {
    const hits = rows.filter((cols) => w.match.test(cols[0]));
    const pids = hits.map((cols) => Number(cols[1])).filter((n) => Number.isFinite(n));
    const memoryMb = hits.reduce((sum, cols) => {
      const mem = String(cols[4] || "").replace(/[^\d]/g, "");
      const kb = Number(mem) || 0;
      return sum + kb / 1024;
    }, 0);
    return {
      key: w.key,
      label: w.label,
      running: hits.length > 0,
      count: hits.length,
      pids,
      memoryMb: Math.round(memoryMb * 10) / 10,
    };
  });

  return {
    running: groups.some((g) => g.running),
    processes: groups,
  };
}
