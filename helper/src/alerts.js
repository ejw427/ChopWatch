import { execFile } from "node:child_process";
import {
  readSettings,
  readRuntimeState,
  writeRuntimeState,
} from "./store.js";

const ALERTABLE = new Set([
  "running",
  "downloading",
  "initializing",
  "finding",
  "paused",
  "offline",
  "stopped",
]);

/** Phases worth announcing on first sighting (AFK cold start). */
const STARTUP_ALERTABLE = new Set([
  "running",
  "downloading",
  "initializing",
  "paused",
  "offline",
]);

function toastWindows(title, body) {
  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$n = New-Object System.Windows.Forms.NotifyIcon
$n.Icon = [System.Drawing.SystemIcons]::Information
$n.Visible = $true
$n.BalloonTipTitle = ${JSON.stringify(title)}
$n.BalloonTipText = ${JSON.stringify(body)}
$n.BalloonTipIcon = 'Info'
$n.ShowBalloonTip(6000)
Start-Sleep -Milliseconds 6500
$n.Dispose()
`;
  execFile(
    "powershell.exe",
    ["-NoProfile", "-WindowStyle", "Hidden", "-Command", script],
    { windowsHide: true },
    () => {},
  );
}

function desktopOwnsToast() {
  return String(process.env.CHOPWATCH_DESKTOP || "").trim() === "1";
}

/**
 * Compare current work phase to last seen; fire Windows toast on change.
 * Returns an alert event for the UI / Electron tray to mirror.
 * Call from the 5s watcher only — snapshot should readLastAlertEvent().
 * @param {object} work
 * @param {object} [deps] injectable for unit tests
 */
export function evaluatePhaseAlert(work, deps = {}) {
  const getSettings = deps.readSettings || readSettings;
  const getState = deps.readRuntimeState || readRuntimeState;
  const setState = deps.writeRuntimeState || writeRuntimeState;
  const toast = deps.toastWindows || toastWindows;
  const now = deps.nowMs ?? Date.now();
  const skipOsToast =
    deps.skipOsToast === true ||
    (deps.skipOsToast == null && desktopOwnsToast());

  const settings = getSettings();
  const state = getState();
  const phase = work?.phase || null;
  const title = work?.title || "ChopWatch";
  const detail = work?.detail || "";

  if (!phase || !ALERTABLE.has(phase)) {
    return { fired: false, event: state.lastAlertEvent || null, settings };
  }

  const prev = state.lastPhase || null;
  const changed = Boolean(prev && prev !== phase);
  const startup =
    !prev && STARTUP_ALERTABLE.has(phase) && !state.startupAlertDone;

  setState({
    lastPhase: phase,
    lastPhaseTitle: title,
    ...(startup ? { startupAlertDone: true } : {}),
    ...(!prev && !startup ? { startupAlertDone: true } : {}),
  });

  if ((!changed && !startup) || !settings.alertsEnabled) {
    return { fired: false, event: state.lastAlertEvent || null, settings };
  }

  const key = startup ? `startup->${phase}` : `${prev}->${phase}`;
  // Debounce identical transitions within 20s
  if (state.lastAlertKey === key && now - (state.lastAlertAt || 0) < 20_000) {
    return { fired: false, event: state.lastAlertEvent || null, settings };
  }

  const event = {
    at: new Date(now).toISOString(),
    from: prev,
    to: phase,
    title: `ChopWatch · ${title}`,
    body: startup
      ? detail || `Watching · currently ${phase}`
      : detail || `Phase changed: ${prev} → ${phase}`,
  };

  setState({
    lastAlertAt: now,
    lastAlertKey: key,
    lastAlertEvent: event,
    startupAlertDone: true,
  });

  if (settings.windowsToastEnabled && !skipOsToast) {
    toast(event.title, event.body);
  }

  return { fired: true, event, settings };
}

/** Read-only: last alert for snapshot / Electron (no side effects). */
export function readLastAlertEvent(deps = {}) {
  const getState = deps.readRuntimeState || readRuntimeState;
  return getState().lastAlertEvent || null;
}

export { ALERTABLE, STARTUP_ALERTABLE };
