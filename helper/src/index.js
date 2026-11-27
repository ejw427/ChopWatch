import express from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import { buildSnapshot } from "./snapshot.js";
import { readChopHours } from "./chopHours.js";
import { fetchSaladAccount, invalidateSaladApiCache } from "./saladApi.js";
import { evaluatePhaseAlert } from "./alerts.js";
import {
  runDownloadBailStep,
  manualDownloadBail,
} from "./downloadBail.js";
import { listSaladProcesses } from "./processes.js";
import {
  readPreferences,
  writeAppFlags,
  writePreferences,
} from "./preferences.js";
import { readWorkloadStatus } from "./bowlLog.js";
import { importSaladAuth, autoFillAuthOnStartup } from "./authImport.js";
import {
  startSaladConnect,
  getConnectStatus,
  cancelSaladConnect,
} from "./saladConnect.js";
import {
  readSettings,
  writeSettings,
  writeSecrets,
  clearAuthCookie,
  authCookiePresent,
} from "./store.js";
import { getProductVersion } from "./version.js";

const PORT = Number(process.env.CHOPWATCH_PORT || 3781);
const HOST = process.env.CHOPWATCH_HOST || "127.0.0.1";
const uiDir = (() => {
  const raw = String(process.env.CHOPWATCH_UI_DIR || "").trim();
  if (!raw) return null;
  const resolved = path.resolve(raw);
  return fs.existsSync(resolved) ? resolved : null;
})();

const app = express();
app.use(express.json({ limit: "32kb" }));
app.use(
  cors({
    origin: [
      "http://127.0.0.1:5177",
      "http://localhost:5177",
      `http://${HOST}:${PORT}`,
      `http://127.0.0.1:${PORT}`,
      `http://localhost:${PORT}`,
    ],
  }),
);

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "chopwatch-helper",
    version: getProductVersion(),
  });
});

app.get("/api/snapshot", async (_req, res) => {
  try {
    res.json(await buildSnapshot());
  } catch (err) {
    res.status(500).json({
      error: "snapshot_failed",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

app.get("/api/chop-hours", (_req, res) => {
  try {
    res.json(readChopHours());
  } catch (err) {
    res.status(500).json({
      error: "chop_hours_failed",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

app.get("/api/settings", (_req, res) => {
  res.json({
    ...readSettings(),
    authCookieConfigured: authCookiePresent(),
  });
});

app.post("/api/settings", (req, res) => {
  const body = req.body || {};
  const patch = {};
  for (const key of [
    "alertsEnabled",
    "windowsToastEnabled",
    "browserAlertsHint",
    "saladApiEnabled",
    "autoFillAuth",
    "downloadBailEnabled",
  ]) {
    if (typeof body[key] === "boolean") patch[key] = body[key];
  }
  for (const key of [
    "downloadBailGraceMinutes",
    "downloadBailMaxMinutes",
    "downloadBailStallMinutes",
    "downloadBailMaxEtaMinutes",
    "downloadBailEtaPersistMinutes",
    "downloadBailCooldownMinutes",
  ]) {
    if (body[key] == null) continue;
    const n = Number(body[key]);
    if (!Number.isFinite(n)) continue;
    let clamped;
    if (key === "downloadBailGraceMinutes") {
      clamped = Math.min(60, Math.max(3, Math.round(n)));
    } else if (key === "downloadBailMaxMinutes") {
      clamped = Math.min(180, Math.max(10, Math.round(n)));
    } else if (key === "downloadBailStallMinutes") {
      clamped = Math.min(60, Math.max(3, Math.round(n)));
    } else if (key === "downloadBailMaxEtaMinutes") {
      clamped = Math.min(240, Math.max(10, Math.round(n)));
    } else if (key === "downloadBailEtaPersistMinutes") {
      clamped = Math.min(60, Math.max(3, Math.round(n)));
    } else {
      clamped = Math.min(120, Math.max(10, Math.round(n)));
    }
    patch[key] = clamped;
  }
  const settings = writeSettings(patch);
  if (Object.prototype.hasOwnProperty.call(body, "saladAuthCookie")) {
    const raw = String(body.saladAuthCookie || "").trim();
    if (raw) {
      writeSecrets({ saladAuthCookie: raw });
      invalidateSaladApiCache();
    }
  }
  res.json({
    ...settings,
    authCookieConfigured: authCookiePresent(),
  });
});

app.delete("/api/settings/auth", (_req, res) => {
  clearAuthCookie();
  invalidateSaladApiCache();
  res.json({
    ...readSettings(),
    authCookieConfigured: false,
  });
});

app.post("/api/settings/auth/autofill", async (_req, res) => {
  try {
    const result = await importSaladAuth({ apply: true });
    res.status(result.ok ? 200 : 404).json(result);
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

app.get("/api/settings/auth/connect", (_req, res) => {
  res.json(getConnectStatus());
});

app.post("/api/settings/auth/connect", async (_req, res) => {
  try {
    res.json(await startSaladConnect());
  } catch (err) {
    res.status(500).json({
      status: "failed",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

app.delete("/api/settings/auth/connect", async (_req, res) => {
  try {
    res.json(await cancelSaladConnect());
  } catch (err) {
    res.status(500).json({
      status: "failed",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

app.get("/api/salad-account", async (req, res) => {
  try {
    const force = req.query.refresh === "1";
    res.json(await fetchSaladAccount(force));
  } catch (err) {
    res.status(500).json({
      error: "salad_api_failed",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

app.get("/api/salad/controls", (_req, res) => {
  res.json(readPreferences());
});

app.post("/api/download-bail", (req, res) => {
  try {
    const procs = listSaladProcesses();
    const prefs = readPreferences();
    const work = readWorkloadStatus(procs.running, prefs.choppingPaused);
    const force = req.body?.force === true;
    const result = manualDownloadBail(work.current, prefs.choppingPaused, {
      forcePhaseCheck: !force,
    });
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

app.post("/api/salad/flags", (req, res) => {
  try {
    const result = writeAppFlags(req.body || {});
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

app.post("/api/salad/preferences", (req, res) => {
  try {
    const result = writePreferences(req.body || {});
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

app.get("/", (_req, res) => {
  res.json({
    name: "ChopWatch helper",
    endpoints: [
      "/health",
      "/api/snapshot",
      "/api/chop-hours",
      "/api/settings",
      "/api/settings/auth/connect",
      "/api/settings/auth/autofill",
      "/api/salad-account",
      "/api/salad/controls",
      "/api/salad/flags",
      "/api/salad/preferences",
      "/api/download-bail",
    ],
  });
});

if (uiDir) {
  app.use(express.static(uiDir, { index: "index.html" }));
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (req.path === "/health" || req.path.startsWith("/api")) return next();
    res.sendFile(path.join(uiDir, "index.html"), (err) => {
      if (err) next(err);
    });
  });
}

app.listen(PORT, HOST, async () => {
  console.log(`ChopWatch helper listening on http://${HOST}:${PORT}`);
  if (uiDir) {
    console.log(`Serving packaged UI from ${uiDir}`);
  }
  // Optional legacy scrape of system browser cookies (usually locked while Chrome/Salad run).
  // Preferred path is Connect Salad account (ChopWatch-owned browser profile).
  const settings = readSettings();
  if (settings.autoFillAuth !== false && !authCookiePresent()) {
    try {
      const result = await autoFillAuthOnStartup();
      if (result?.ok) {
        console.log(
          `Auto-filled Salad auth from ${result.source} (len=${result.length})`,
        );
      } else if (!result?.skipped) {
        console.log(
          "No system auth cookie available (DBs often locked). Use Settings → Connect Salad account.",
        );
      }
    } catch {
      console.log(
        "Auth scrape skipped. Use Settings → Connect Salad account.",
      );
    }
  }
});

// Background phase watcher so Windows toasts fire even if the UI tab is closed.
// Also runs slow-download bail (pause→resume re-roll) when enabled.
setInterval(() => {
  try {
    const procs = listSaladProcesses();
    const prefs = readPreferences();
    const work = readWorkloadStatus(procs.running, prefs.choppingPaused);
    evaluatePhaseAlert(work.current);
    runDownloadBailStep(work.current, prefs.choppingPaused);
  } catch (err) {
    console.error("phase watcher error:", err instanceof Error ? err.message : err);
  }
}, 5000);
