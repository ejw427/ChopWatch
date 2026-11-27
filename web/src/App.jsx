import { useEffect, useRef, useState } from "react";
import { fetchSnapshot } from "./api.js";
import OverviewTab from "./tabs/OverviewTab.jsx";
import DetailsTab from "./tabs/DetailsTab.jsx";
import SettingsTab from "./tabs/SettingsTab.jsx";
import AboutTab from "./tabs/AboutTab.jsx";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "details", label: "Details" },
  { id: "settings", label: "Settings" },
  { id: "about", label: "About" },
];

function formatAge(sec) {
  if (sec == null || !Number.isFinite(sec)) return "—";
  if (sec < 60) return `${Math.round(sec)}s ago`;
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
  return `${(sec / 3600).toFixed(1)}h ago`;
}

export default function App() {
  const [snap, setSnap] = useState(null);
  const [error, setError] = useState(null);
  const [helperOk, setHelperOk] = useState(false);
  const [tab, setTab] = useState("overview");
  const seenAlertAt = useRef(null);

  useEffect(() => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer;

    async function tick() {
      try {
        const data = await fetchSnapshot();
        if (cancelled) return;
        setSnap(data);
        setError(null);
        setHelperOk(true);

        const alert = data.alert;
        if (
          alert?.at &&
          alert.at !== seenAlertAt.current &&
          data.settings?.browserAlertsHint !== false
        ) {
          seenAlertAt.current = alert.at;
          if (typeof Notification !== "undefined" && Notification.permission === "granted") {
            try {
              new Notification(alert.title, { body: alert.body });
            } catch {
              // ignore
            }
          }
        }
      } catch (err) {
        if (cancelled) return;
        setHelperOk(false);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) timer = setTimeout(tick, 3000);
      }
    }

    tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  return (
    <div className="app">
      <header className="top">
        <div className="brand brand-row">
          <img
            className="brand-mark"
            src="/chopwatch-mark.jpg"
            alt=""
            width={48}
            height={48}
          />
          <div>
            <h1>ChopWatch</h1>
            <p>Local Salad cockpit by Eric Welch — status, hours, alerts, optional official API.</p>
          </div>
        </div>
        <div className="meta">
          <span className="pill">
            <span className={`dot ${helperOk ? "ok" : "bad"}`} />
            helper {helperOk ? "live" : "offline"}
          </span>
          <span className="pill">
            <span className={`dot ${snap?.processes?.running ? "ok" : "bad"}`} />
            salad {snap?.processes?.running ? "up" : "down"}
          </span>
          <span className="pill">
            <span
              className={`dot ${
                snap?.heartbeat?.ageSec != null && snap.heartbeat.ageSec < 120
                  ? "ok"
                  : "warn"
              }`}
            />
            hb {formatAge(snap?.heartbeat?.ageSec)}
          </span>
          <span>{snap?.generatedAt ? new Date(snap.generatedAt).toLocaleTimeString() : "…"}</span>
        </div>
      </header>

      <nav className="tabs" aria-label="ChopWatch sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`tab ${tab === t.id ? "active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {error && (
        <div className="error">
          Cannot reach ChopWatch helper on 127.0.0.1:3781 ({error}). Run{" "}
          <span className="mono">npm start</span> from the project root.
        </div>
      )}

      {tab === "overview" && <OverviewTab snap={snap} />}
      {tab === "details" && <DetailsTab snap={snap} />}
      {tab === "settings" && <SettingsTab snap={snap} setSnap={setSnap} />}
      {tab === "about" && <AboutTab snap={snap} />}

      <p className="footer-note">
        ChopWatch is unofficial and unaffiliated with Salad Technologies. Created by
        Eric Welch.
      </p>
    </div>
  );
}
