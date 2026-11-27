/** Format MiB (nvidia-smi) as consumer-friendly GB. */
export function formatGiBFromMiB(mib, digits = 1) {
  if (mib == null || !Number.isFinite(Number(mib))) return "—";
  const gib = Number(mib) / 1024;
  if (gib >= 100) return `${Math.round(gib)} GB`;
  if (gib >= 10) return `${gib.toFixed(1)} GB`;
  return `${gib.toFixed(Math.max(digits, 2))} GB`;
}

/** Format host MB as GB. */
export function formatGiBFromMb(mb, digits = 1) {
  if (mb == null || !Number.isFinite(Number(mb))) return "—";
  return formatGiBFromMiB(mb, digits);
}

export function formatMemPairFromMiB(used, total) {
  if (used == null || total == null) return "—";
  return `${formatGiBFromMiB(used)} / ${formatGiBFromMiB(total)}`;
}

export function formatMemPairFromMb(used, total) {
  if (used == null || total == null) return "—";
  return `${formatGiBFromMb(used)} / ${formatGiBFromMb(total)}`;
}

export function formatWatts(w) {
  if (w == null || !Number.isFinite(Number(w))) return "—";
  const n = Number(w);
  return Number.isInteger(n) ? `${n} W` : `${n.toFixed(0)} W`;
}

export function formatTempC(t) {
  if (t == null || !Number.isFinite(Number(t))) return "—";
  return `${Math.round(Number(t))}°C`;
}

export function formatProcMemory(mb) {
  if (mb == null || !Number.isFinite(Number(mb))) return "—";
  const n = Number(mb);
  if (n < 1024) return `${Math.round(n)} MB`;
  return formatGiBFromMb(n);
}

/** Parse Bowl / ISO timestamps into a Date, or null. */
export function parseStamp(ts) {
  if (!ts) return null;
  const d = new Date(String(ts).replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Human clock time: "Nov 26, 10:02:00 AM". */
export function formatStamp(ts) {
  const d = parseStamp(ts);
  if (!d) return ts ? String(ts) : "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Day label for earnings history: "Wed, Nov 25" (or with local time if not a day key). */
export function formatDayStamp(ts) {
  const d = parseStamp(ts);
  if (!d) return ts ? String(ts).slice(0, 40) : "—";
  const raw = String(ts).trim();
  // Salad day keys are often UTC midnight / bare dates — keep the calendar day.
  const dayKey =
    /^\d{4}-\d{2}-\d{2}$/.test(raw) ||
    /T00:00:00(\.\d+)?Z$/i.test(raw);
  if (dayKey) {
    return d.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  }
  const hasTime =
    d.getHours() !== 0 || d.getMinutes() !== 0 || d.getSeconds() !== 0;
  if (!hasTime) {
    return d.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  }
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Raw byte count → "1.8 GB", "420 MB". */
export function formatBytes(bytes, digits = 1) {
  if (bytes == null || !Number.isFinite(Number(bytes)) || Number(bytes) < 0) {
    return "—";
  }
  const n = Number(bytes);
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) {
    const mb = n / 1024 ** 2;
    return mb >= 100 ? `${Math.round(mb)} MB` : `${mb.toFixed(digits)} MB`;
  }
  const gb = n / 1024 ** 3;
  if (gb >= 100) return `${Math.round(gb)} GB`;
  if (gb >= 10) return `${gb.toFixed(1)} GB`;
  return `${gb.toFixed(Math.max(digits, 2))} GB`;
}

/** Bytes/sec → "2.4 MB/s". */
export function formatBytesPerSec(bps) {
  if (bps == null || !Number.isFinite(Number(bps)) || Number(bps) < 0) {
    return "—";
  }
  return `${formatBytes(bps)}/s`;
}

/** Done/total byte pair. */
export function formatBytePair(done, total) {
  if (done == null && total == null) return "—";
  if (total == null) return formatBytes(done);
  return `${formatBytes(done)} / ${formatBytes(total)}`;
}

/** Duration from seconds: "10m 5s", "2h 3m". */
export function formatDuration(sec) {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return "—";
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) {
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return `${m}m ${s}s`;
  }
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return `${h}h ${m}m`;
}

/** Bowl elapsed strings like "00:10:05" or "00:10:05.123" → "10m 5s". */
export function formatElapsed(elapsed) {
  if (elapsed == null || elapsed === "") return "—";
  const parts = String(elapsed).trim().split(":");
  if (parts.length < 2 || parts.length > 3) return String(elapsed);
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isFinite(n))) return String(elapsed);
  let sec = 0;
  if (nums.length === 3) sec = nums[0] * 3600 + nums[1] * 60 + nums[2];
  else sec = nums[0] * 60 + nums[1];
  return formatDuration(sec);
}

/** Span between two stamps, or from start until now when end is missing. */
export function formatSpan(startedAt, endedAt) {
  const start = parseStamp(startedAt);
  if (!start) return null;
  const end = endedAt ? parseStamp(endedAt) : new Date();
  if (!end) return null;
  return formatDuration((end.getTime() - start.getTime()) / 1000);
}
