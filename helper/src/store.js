import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveDataDir() {
  const fromEnv = String(process.env.CHOPWATCH_DATA_DIR || "").trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(__dirname, "..", "data");
}

const dataDir = resolveDataDir();
const settingsPath = path.join(dataDir, "settings.json");
const secretsPath = path.join(dataDir, "secrets.json");
const statePath = path.join(dataDir, "runtime-state.json");

export function getDataDir() {
  return dataDir;
}

function ensureDir() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return structuredClone(fallback);
    return { ...fallback, ...JSON.parse(fs.readFileSync(file, "utf8")) };
  } catch {
    return structuredClone(fallback);
  }
}

function writeJson(file, obj) {
  ensureDir();
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), "utf8");
}

const DEFAULT_SETTINGS = {
  alertsEnabled: true,
  windowsToastEnabled: true,
  browserAlertsHint: true,
  saladApiEnabled: false,
  autoFillAuth: true,
  downloadBailEnabled: true,
  downloadBailGraceMinutes: 10,
  downloadBailMaxMinutes: 30,
  downloadBailStallMinutes: 10,
  downloadBailMaxEtaMinutes: 45,
  downloadBailEtaPersistMinutes: 8,
  downloadBailCooldownMinutes: 25,
};

const DEFAULT_SECRETS = {
  saladAuthCookie: "",
};

const DEFAULT_STATE = {
  lastPhase: null,
  lastPhaseTitle: null,
  lastAlertAt: null,
  lastAlertKey: null,
  gpuUtilSamples: [],
  gpuUtilSampleAt: null,
  downloadBailLastAt: null,
  downloadBailLastShortId: null,
  downloadBailLastReason: null,
  downloadBailPendingResumeAt: null,
  downloadBailProgressShortId: null,
  downloadBailProgressValue: null,
  downloadBailProgressAt: null,
  downloadBailEtaOverSince: null,
  downloadBailEtaOverShortId: null,
  downloadBailLastEtaSec: null,
  downloadBailRetriesByShortId: {},
  downloadBailBlackoutUntil: {},
};

export function readSettings() {
  return readJson(settingsPath, DEFAULT_SETTINGS);
}

export function writeSettings(patch) {
  const next = { ...readSettings(), ...patch };
  writeJson(settingsPath, next);
  return next;
}

export function readSecrets() {
  return readJson(secretsPath, DEFAULT_SECRETS);
}

export function writeSecrets(patch) {
  const next = { ...readSecrets(), ...patch };
  writeJson(secretsPath, next);
  return {
    hasAuthCookie: Boolean(next.saladAuthCookie && String(next.saladAuthCookie).trim()),
  };
}

export function clearAuthCookie() {
  return writeSecrets({ saladAuthCookie: "" });
}

export function authCookiePresent() {
  const s = readSecrets();
  return Boolean(s.saladAuthCookie && String(s.saladAuthCookie).trim());
}

export function getAuthCookie() {
  return String(readSecrets().saladAuthCookie || "").trim();
}

export function readRuntimeState() {
  return readJson(statePath, DEFAULT_STATE);
}

export function writeRuntimeState(patch) {
  const next = { ...readRuntimeState(), ...patch };
  writeJson(statePath, next);
  return next;
}
