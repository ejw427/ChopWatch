import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { paths, exists } from "./saladPaths.js";

const ALLOWED_PREF_KEYS = new Set([
  "active/gpu",
  "idle/gpu",
  "active/cpu",
  "idle/cpu",
  "mining/gpu",
  "mining/cpu",
  "elevated",
  "containers",
  "category/adultcontent",
  "sys/max_storage_gb",
  "category/mining",
  "compute/bandwidth",
]);

const ALLOWED_CONFIG_KEYS = new Set([
  "ElevatedWslMemoryMb",
  "AutoStartMinutes",
  "Onboarding/commonSettings",
  "Onboarding/antivirus",
]);

/** App UI/settings flags only — never session/auth tokens. */
const ALLOWED_APP_FLAGS = new Set([
  "SALAD_CHOPPING_INDEFINITELY_PAUSED",
  "SALAD_AUTO_STOP_ENABLED",
  "SALAD_AUTO_LAUNCH",
  "SALAD_OVERLAY_ENABLED",
  "SALAD_IS_MINING_WORKLOAD_ENABLED",
  "SALAD_ENABLED_CONTAINERS_WHEN_NO_SETUP_REQUIRED",
  "SALAD_SCHEDULED_CHOPPING_PREFERENCE_ENABLED",
  "SALAD_WIDGET_PINNED",
  "SALAD_RELEASE_CHANNEL",
  "SALAD_ACTIVITY_NOTIFICATION_ENABLED",
  "SALAD_ADULT_CONTENT_WORKLOAD_CONFIGURED",
]);

function readJsonFile(filePath) {
  if (!exists(filePath)) return null;
  try {
    const text = fs.readFileSync(filePath, "utf8").trim();
    if (!text) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function coerce(v) {
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true") return true;
    if (s === "false") return false;
  }
  return v;
}

function pick(obj, allowed) {
  if (!obj || typeof obj !== "object") return {};
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (allowed.has(k)) out[k] = coerce(v);
  }
  return out;
}

function appConfigPath() {
  const appData =
    process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  return path.join(appData, "Salad", "config.json");
}

export function readPreferences() {
  const appFlags = pick(readJsonFile(appConfigPath()), ALLOWED_APP_FLAGS);
  return {
    preferences: pick(readJsonFile(paths.preferences), ALLOWED_PREF_KEYS),
    config: pick(readJsonFile(paths.config), ALLOWED_CONFIG_KEYS),
    appFlags,
    choppingPaused: appFlags.SALAD_CHOPPING_INDEFINITELY_PAUSED === true,
  };
}
