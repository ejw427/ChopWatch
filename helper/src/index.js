import express from "express";
import cors from "cors";
import { buildSnapshot } from "./snapshot.js";
import { readChopHours } from "./chopHours.js";
import { fetchSaladAccount, invalidateSaladApiCache } from "./saladApi.js";
import { evaluatePhaseAlert } from "./alerts.js";
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

const app = express();
app.use(express.json({ limit: "32kb" }));
app.use(
  cors({
    origin: ["http://127.0.0.1:5177", "http://localhost:5177"],
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
  ]) {
    if (typeof body[key] === "boolean") patch[key] = body[key];
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
    ],
  });
});

app.listen(PORT, HOST, async () => {
  console.log(`ChopWatch helper listening on http://${HOST}:${PORT}`);
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
setInterval(() => {
  try {
    const procs = listSaladProcesses();
    const prefs = readPreferences();
    const work = readWorkloadStatus(procs.running, prefs.choppingPaused);
    evaluatePhaseAlert(work.current);
  } catch (err) {
    console.error("phase watcher error:", err instanceof Error ? err.message : err);
  }
}, 5000);
