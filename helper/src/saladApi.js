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
      // Salad accepts the auth cookie value as the antiforgery header too.
      Cookie: `auth=${cookie}`,
      "X-XSRF-TOKEN": cookie,
      Accept: "application/json",
      Origin: "https://app.salad.com",
      Referer: "https://app.salad.com/",
      "User-Agent": "ChopWatch/0.5 (local read-only)",
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
 * Opt-in Salad web API. Requires auth cookie stored locally.
 * Never logs the cookie value.
 */
export async function fetchSaladAccount(force = false) {
  const settings = readSettings();
  const configured = authCookiePresent();

  if (!settings.saladApiEnabled) {
    return {
      enabled: false,
      configured,
      note: "Connect your Salad account in Settings to pull official balance/history.",
    };
  }

  if (!configured) {
    return {
      enabled: true,
      configured: false,
      note: "Salad API enabled but not connected yet — use Settings → Connect Salad account.",
    };
  }

  if (!force && cache && Date.now() - cacheAt < CACHE_MS) {
    return cache;
  }

  const cookie = getAuthCookie();
  try {
    const [balance, machines, history] = await Promise.all([
      saladFetch("/api/v1/profile/balance", cookie),
      saladFetch("/api/v2/machines", cookie),
      saladFetch("/api/v2/reports/30-day-earning-history", cookie),
    ]);

    const result = {
      enabled: true,
      configured: true,
      fetchedAt: new Date().toISOString(),
      balance: balance.ok ? balance.body : null,
      balanceStatus: balance.status,
      machines: machines.ok ? machines.body : null,
      machinesStatus: machines.status,
      history30d: history.ok ? history.body : null,
      history30dStatus: history.status,
      ok: balance.ok || history.ok,
      note:
        balance.status === 401 ||
        history.status === 401 ||
        balance.status === 403
          ? "Auth/XSRF rejected — reconnect Salad account in Settings."
          : "Official Salad API connected.",
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
