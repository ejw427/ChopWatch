import { readRecentBowlText, parseTsAgeSec } from "./logTail.js";

export const WALLET_RE =
  /(?<ts>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+).*\bWallet:\s*Current\((?<current>[0-9.]+)\),\s*Predicted\((?<predicted>[0-9.]+)\)/;

export const HEARTBEAT_RE =
  /(?<ts>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+).*\bOrchestrationEvent:\s*Heartbeat\b/;

function newer(a, b) {
  if (!a) return b;
  if (!b) return a;
  return a >= b ? a : b;
}

/** Pure parser — used by tests and by readWalletAndHeartbeat. */
export function parseWalletAndHeartbeatText(text, nowMs = Date.now()) {
  let wallet = null;
  let heartbeatAt = null;

  for (const line of text.split(/\r?\n/)) {
    const w = line.match(WALLET_RE);
    if (w?.groups) {
      if (!wallet || w.groups.ts > wallet.at) {
        wallet = {
          at: w.groups.ts,
          current: Number(w.groups.current),
          predicted: Number(w.groups.predicted),
          source: "bowl-log",
          note: "Parsed from Bowl Wallet lines. Predicted is Salad's projection, not a guarantee.",
        };
      }
    }
    const h = line.match(HEARTBEAT_RE);
    if (h?.groups) heartbeatAt = newer(heartbeatAt, h.groups.ts);
  }

  if (wallet) {
    const t = Date.parse(String(wallet.at).replace(" ", "T"));
    wallet.ageSec = Number.isFinite(t)
      ? Math.max(0, (nowMs - t) / 1000)
      : null;
  }

  let heartbeat = null;
  if (heartbeatAt) {
    const t = Date.parse(String(heartbeatAt).replace(" ", "T"));
    heartbeat = {
      at: heartbeatAt,
      ageSec: Number.isFinite(t) ? Math.max(0, (nowMs - t) / 1000) : null,
    };
  }

  return { wallet, heartbeat };
}

export function readWalletAndHeartbeat() {
  // Read newest file first, but pick the newest timestamps explicitly.
  const { text } = readRecentBowlText(3, 900_000);
  return parseWalletAndHeartbeatText(text);
}
