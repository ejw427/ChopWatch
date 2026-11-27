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
