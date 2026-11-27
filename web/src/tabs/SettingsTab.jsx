import { useEffect, useState } from "react";
import {
  saveSettings,
  clearAuth,
  refreshSaladAccount,
  autofillAuth,
  fetchSettings,
  startSaladConnect,
  getSaladConnectStatus,
  cancelSaladConnect,
} from "../api.js";

export default function SettingsTab({ snap, setSnap }) {
  const [authInput, setAuthInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [connect, setConnect] = useState(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer;

    async function poll() {
      try {
        const status = await getSaladConnectStatus();
        if (cancelled) return;
        setConnect(status);
        if (status.status === "connected") {
          const settings = await fetchSettings();
          const account = await refreshSaladAccount().catch(() => null);
          if (!cancelled) {
            setSnap((s) =>
              s
                ? {
                    ...s,
                    settings,
                    saladAccount: account || s.saladAccount,
                  }
                : s,
            );
            setMsg(status.message || "Salad account connected.");
          }
        } else if (status.status === "waiting") {
          timer = setTimeout(poll, 1500);
          return;
        }
      } catch {
        // ignore
      }
      if (!cancelled && connect?.status === "waiting") {
        timer = setTimeout(poll, 2000);
      }
    }

    if (connect?.status === "waiting") poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [connect?.status, setSnap]);

  async function patchSettings(partial) {
    setBusy(true);
    setMsg("");
    try {
      const next = await saveSettings(partial);
      setSnap((s) => (s ? { ...s, settings: next } : s));
      setMsg("Saved.");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onConnect() {
    setBusy(true);
    setMsg("");
    try {
      const status = await startSaladConnect();
      setConnect(status);
      setMsg(status.message || "Sign in to Salad in the window that opened.");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onCancelConnect() {
    setBusy(true);
    try {
      const status = await cancelSaladConnect();
      setConnect(status);
      setMsg(status.message || "Cancelled.");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onSaveAuth(e) {
    e.preventDefault();
    if (!authInput.trim()) return;
    setBusy(true);
    setMsg("");
    try {
      const next = await saveSettings({
        saladApiEnabled: true,
        saladAuthCookie: authInput.trim(),
      });
      setAuthInput("");
      const account = await refreshSaladAccount();
      setSnap((s) => (s ? { ...s, settings: next, saladAccount: account } : s));
      setMsg(
        account?.ok
          ? "Official Salad API connected."
          : account?.note || "Cookie saved — check API status.",
      );
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onClearAuth() {
    setBusy(true);
    try {
      const next = await clearAuth();
      setSnap((s) =>
        s
          ? {
              ...s,
              settings: next,
              saladAccount: {
                enabled: next.saladApiEnabled,
                configured: false,
                note: "Auth cookie cleared.",
              },
            }
          : s,
      );
      setMsg("Auth cleared.");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onRefreshApi() {
    setBusy(true);
    setMsg("");
    try {
      const account = await refreshSaladAccount();
      setSnap((s) => (s ? { ...s, saladAccount: account } : s));
      setMsg(account?.ok ? "API refreshed." : account?.note || "Refresh finished.");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onAutoFill() {
    setBusy(true);
    setMsg("Trying locked system browsers (often fails while Chrome/Salad are open)…");
    try {
      const result = await autofillAuth();
      const settings = await fetchSettings();
      setSnap((s) =>
        s
          ? {
              ...s,
              settings,
              saladAccount: result.account || s.saladAccount,
            }
          : s,
      );
      setMsg(
        result.ok
          ? result.note || `Auto-filled from ${result.source}.`
          : `${result.error || "No cookie"} — use Connect Salad account instead.`,
      );
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const connected = Boolean(snap?.settings?.authCookieConfigured);
  const waiting = connect?.status === "waiting";

  return (
    <div className="grid">
      <section className="panel wide">
        <h2>Connect Salad account</h2>
        <p className="hint">
          You don’t need to know or paste a cookie. ChopWatch opens a private Edge/Chrome
          profile, you sign in once, and auth is captured locally (never shown in the UI).
          System Chrome/Salad cookie DBs stay locked while those apps run — that’s why
          scrape-auto-fill fails.
        </p>
        <div className="toggle-row">
          <button type="button" disabled={busy || !snap || waiting} onClick={onConnect}>
            {connected ? "Reconnect" : "Connect Salad account"}
          </button>
          {waiting && (
            <button type="button" className="ghost" disabled={busy} onClick={onCancelConnect}>
              Cancel
            </button>
          )}
          <button
            type="button"
            className="ghost"
            disabled={busy || !connected}
            onClick={onRefreshApi}
          >
            Refresh API
          </button>
          <button
            type="button"
            className="ghost"
            disabled={busy || !connected}
            onClick={onClearAuth}
          >
            Disconnect
          </button>
        </div>
        <div className="meta">
          <span className="pill">
            <span className={`dot ${connected ? "ok" : waiting ? "warn" : "bad"}`} />
            {waiting
              ? "waiting for login"
              : connected
                ? "connected"
                : "not connected"}
          </span>
          <span>API {snap?.settings?.saladApiEnabled ? "on" : "off"}</span>
          <span>balance HTTP {snap?.saladAccount?.balanceStatus ?? "—"}</span>
          {connect?.status && connect.status !== "idle" && (
            <span>connect {connect.status}</span>
          )}
        </div>
        {msg && <p className="hint">{msg}</p>}
        {connect?.message && connect.status === "waiting" && (
          <p className="hint">{connect.message}</p>
        )}
        {snap?.saladAccount?.note && (
          <p className="hint">{snap.saladAccount.note}</p>
        )}
      </section>

      <section className="panel wide">
        <h2>Alerts</h2>
        <div className="toggle-row">
          <label>
            <input
              type="checkbox"
              checked={Boolean(snap?.settings?.alertsEnabled)}
              disabled={busy || !snap}
              onChange={(e) => patchSettings({ alertsEnabled: e.target.checked })}
            />
            Phase alerts
          </label>
          <label>
            <input
              type="checkbox"
              checked={Boolean(snap?.settings?.windowsToastEnabled)}
              disabled={busy || !snap}
              onChange={(e) =>
                patchSettings({ windowsToastEnabled: e.target.checked })
              }
            />
            Windows toast
          </label>
          <label>
            <input
              type="checkbox"
              checked={snap?.settings?.browserAlertsHint !== false}
              disabled={busy || !snap}
              onChange={(e) =>
                patchSettings({ browserAlertsHint: e.target.checked })
              }
            />
            Browser notifications
          </label>
        </div>
      </section>

      <section className="panel wide">
        <h2>Advanced auth</h2>
        <p className="hint">
          Fallback only. Scraping your everyday Chrome/Salad cookie files usually fails
          with sharing violations while those apps are open.
        </p>
        <button
          type="button"
          className="ghost"
          onClick={() => setShowAdvanced((v) => !v)}
        >
          {showAdvanced ? "Hide advanced" : "Show advanced"}
        </button>
        {showAdvanced && (
          <>
            <div className="toggle-row" style={{ marginTop: 12 }}>
              <label>
                <input
                  type="checkbox"
                  checked={Boolean(snap?.settings?.saladApiEnabled)}
                  disabled={busy || !snap}
                  onChange={(e) =>
                    patchSettings({ saladApiEnabled: e.target.checked })
                  }
                />
                Enable Salad API
              </label>
              <button type="button" className="ghost" disabled={busy} onClick={onAutoFill}>
                Scrape system cookies
              </button>
            </div>
            <form className="auth-form" onSubmit={onSaveAuth}>
              <label className="auth-label" htmlFor="auth">
                Manual auth cookie (optional)
              </label>
              <div className="auth-row">
                <input
                  id="auth"
                  type="password"
                  autoComplete="off"
                  placeholder="Paste only if Connect isn’t an option"
                  value={authInput}
                  onChange={(e) => setAuthInput(e.target.value)}
                />
                <button type="submit" disabled={busy || !authInput.trim()}>
                  Save
                </button>
              </div>
            </form>
          </>
        )}
      </section>

      <section className="panel">
        <h2>App chopping flags</h2>
        <p className="hint">Auto-read from Salad config (no secrets).</p>
        <ul className="pref-list">
          {Object.entries(snap?.appFlags || {}).map(([k, v]) => (
            <li key={k}>
              <span>{k.replace(/^SALAD_/, "")}</span>
              <span className="mono">{String(v)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <h2>Chopping preferences</h2>
        <p className="hint">Auto-read from ProgramData preferences.</p>
        <ul className="pref-list">
          {Object.entries(snap?.preferences || {}).map(([k, v]) => (
            <li key={k}>
              <span>{k}</span>
              <span className="mono">{String(v)}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
