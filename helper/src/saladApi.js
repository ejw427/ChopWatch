import {
  readSettings,
  getAuthCookie,
  authCookiePresent,
} from "./store.js";

const BASE = "https://app-api.salad.com";

let cache = null;
let cacheAt = 0;
const CACHE_MS = 60_000;

async function saladFetch(path, cookie) {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      Cookie: `auth=${cookie}`,
      Accept: "application/json",
      "User-Agent": "ChopWatch/0.3 (local read-only)",
    },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text.slice(0, 200) };
  }
  return { ok: res.ok, status: res.status, body };
}

/**
 * Opt-in Salad web API. Requires auth cookie stored locally by the user.
 * Never logs the cookie value.
 */
export async function fetchSaladAccount(force = false) {
  const settings = readSettings();
  const configured = authCookiePresent();

  if (!settings.saladApiEnabled) {
    return {
      enabled: false,
      configured,
      note: "Enable Salad API in ChopWatch settings and paste your auth cookie to pull official balance/history.",
    };
  }

  if (!configured) {
    return {
      enabled: true,
      configured: false,
      note: "Salad API enabled but no auth cookie saved yet.",
    };
  }

  if (!force && cache && Date.now() - cacheAt < CACHE_MS) {
    return cache;
  }

  const cookie = getAuthCookie();
  try {
    const [balance, rate, history] = await Promise.all([
      saladFetch("/api/v1/profile/balance", cookie),
      saladFetch("/api/v2/bonuses/earning-rate", cookie),
      saladFetch("/api/v2/reports/30-day-earning-history", cookie),
    ]);

    const result = {
      enabled: true,
      configured: true,
      fetchedAt: new Date().toISOString(),
      balance: balance.ok ? balance.body : null,
      balanceStatus: balance.status,
      earningRate: rate.ok ? rate.body : null,
      earningRateStatus: rate.status,
      history30d: history.ok ? history.body : null,
      history30dStatus: history.status,
      ok: balance.ok || history.ok,
      note:
        balance.status === 401 || history.status === 401
          ? "Auth rejected — paste a fresh auth cookie from salad.com (Application → Cookies → auth)."
          : "Official Salad API (opt-in). Cookie stays on this PC in helper/data/secrets.json.",
    };

    cache = result;
    cacheAt = Date.now();
    return result;
  } catch (err) {
    return {
      enabled: true,
      configured: true,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      note: "Salad API request failed.",
    };
  }
}

export function invalidateSaladApiCache() {
  cache = null;
  cacheAt = 0;
}
