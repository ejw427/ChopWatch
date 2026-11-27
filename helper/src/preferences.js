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

function readRawJson(filePath) {
  if (!exists(filePath)) return {};
  try {
    const text = fs.readFileSync(filePath, "utf8").trim();
    if (!text) return {};
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeRawJson(filePath, obj) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(obj, null, 2)}\n`, "utf8");
}

/** Boolean Salad app flags only (allowlisted). */
export function writeAppFlags(patch = {}) {
  const file = appConfigPath();
  const current = readRawJson(file);
  const applied = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!ALLOWED_APP_FLAGS.has(key)) continue;
    if (typeof value !== "boolean" && typeof value !== "string") continue;
    if (typeof value === "string" && !ALLOWED_APP_FLAGS.has(key)) continue;
    // Keep string release channel; booleans for the rest.
    if (key === "SALAD_RELEASE_CHANNEL") {
      if (typeof value !== "string") continue;
      current[key] = value;
      applied[key] = value;
      continue;
    }
    if (typeof value !== "boolean") continue;
    current[key] = value;
    applied[key] = value;
  }
  if (Object.keys(applied).length === 0) {
    return { ok: false, error: "no_allowed_flags", ...readPreferences() };
  }
  writeRawJson(file, current);
  return { ok: true, applied, ...readPreferences() };
}

const GPU_CPU_LEVELS = new Set(["Low", "Medium", "High", "Off"]);

/** Allowlisted Salad preferences.txt keys. */
export function writePreferences(patch = {}) {
  const file = paths.preferences;
  const current = readRawJson(file);
  const applied = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!ALLOWED_PREF_KEYS.has(key)) continue;
    if (key === "active/gpu" || key === "idle/gpu" || key === "active/cpu" || key === "idle/cpu") {
      if (!GPU_CPU_LEVELS.has(String(value))) continue;
      current[key] = String(value);
      applied[key] = String(value);
      continue;
    }
    if (key === "sys/max_storage_gb") {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 10 || n > 4000) continue;
      current[key] = String(Math.round(n));
      applied[key] = current[key];
      continue;
    }
    // boolean-ish prefs are stored as "True"/"False" strings in Salad's file
    if (typeof value === "boolean") {
      current[key] = value ? "True" : "False";
      applied[key] = current[key];
      continue;
    }
    if (value === "True" || value === "False" || value === "true" || value === "false") {
      const on = String(value).toLowerCase() === "true";
      current[key] = on ? "True" : "False";
      applied[key] = current[key];
    }
  }
  if (Object.keys(applied).length === 0) {
    return { ok: false, error: "no_allowed_preferences", ...readPreferences() };
  }
  writeRawJson(file, current);
  return { ok: true, applied, ...readPreferences() };
}

export { ALLOWED_APP_FLAGS, ALLOWED_PREF_KEYS, GPU_CPU_LEVELS };
