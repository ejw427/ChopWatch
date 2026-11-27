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

/**
 * Compare current work phase to last seen; fire Windows toast on change.
 * Returns an alert event for the UI to mirror via Notification API.
 * @param {object} work
 * @param {object} [deps] injectable for unit tests
 */
export function evaluatePhaseAlert(work, deps = {}) {
  const getSettings = deps.readSettings || readSettings;
  const getState = deps.readRuntimeState || readRuntimeState;
  const setState = deps.writeRuntimeState || writeRuntimeState;
  const toast = deps.toastWindows || toastWindows;
  const now = deps.nowMs ?? Date.now();

  const settings = getSettings();
  const state = getState();
  const phase = work?.phase || null;
  const title = work?.title || "ChopWatch";
  const detail = work?.detail || "";

  if (!phase || !ALERTABLE.has(phase)) {
    return { fired: false, event: null, settings };
  }

  const changed = state.lastPhase && state.lastPhase !== phase;
  setState({
    lastPhase: phase,
    lastPhaseTitle: title,
  });

  if (!changed || !settings.alertsEnabled) {
    return { fired: false, event: null, settings };
  }

  const key = `${state.lastPhase}->${phase}`;
  // Debounce identical transitions within 20s
  if (state.lastAlertKey === key && now - (state.lastAlertAt || 0) < 20_000) {
    return { fired: false, event: null, settings };
  }

  const event = {
    at: new Date(now).toISOString(),
    from: state.lastPhase,
    to: phase,
    title: `ChopWatch · ${title}`,
    body: detail || `Phase changed: ${state.lastPhase} → ${phase}`,
  };

  setState({
    lastAlertAt: now,
    lastAlertKey: key,
  });

  if (settings.windowsToastEnabled) {
    toast(event.title, event.body);
  }

  return { fired: true, event, settings };
}

export { ALERTABLE };
