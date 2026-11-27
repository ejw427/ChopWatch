import { readRecentBowlText, parseTsAgeSec } from "./logTail.js";

// Predicted can be negative (Salad uses -1 when unknown / idle).
export const WALLET_RE =
  /(?<ts>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+(?:\s+[+-]\d{2}:\d{2})?).*\bWallet:\s*Current\((?<current>-?[0-9.]+)\),\s*Predicted\((?<predicted>-?[0-9.]+)\)/;

export const HEARTBEAT_RE =
  /(?<ts>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+(?:\s+[+-]\d{2}:\d{2})?).*\bOrchestrationEvent:\s*Heartbeat\b/;

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
          note: "Parsed from Bowl Wallet lines. Predicted is Salad's projection, not a guarantee. Negative Predicted usually means unknown/idle.",
        };
      }
    }
    const h = line.match(HEARTBEAT_RE);
    if (h?.groups) heartbeatAt = newer(heartbeatAt, h.groups.ts);
  }

  if (wallet) {
    wallet.ageSec = parseTsAgeSec(wallet.at, nowMs);
  }

  let heartbeat = null;
  if (heartbeatAt) {
    heartbeat = {
      at: heartbeatAt,
      ageSec: parseTsAgeSec(heartbeatAt, nowMs),
    };
  }

  return { wallet, heartbeat };
}

export function readWalletAndHeartbeat() {
  // Read newest file first, but pick the newest timestamps explicitly.
  const { text } = readRecentBowlText(3, 900_000);
  return parseWalletAndHeartbeatText(text);
}
