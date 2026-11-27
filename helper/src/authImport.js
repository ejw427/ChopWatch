import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  writeSecrets,
  writeSettings,
  authCookiePresent,
  getAuthCookie,
} from "./store.js";
import { invalidateSaladApiCache, fetchSaladAccount } from "./saladApi.js";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.join(__dirname, "..", "scripts", "Import-SaladAuth.ps1");

function runImportScript(includeValue) {
  const args = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    scriptPath,
  ];
  if (includeValue) args.push("-IncludeValue");
  return execFileAsync("powershell.exe", args, {
    windowsHide: true,
    timeout: 45000,
    maxBuffer: 2 * 1024 * 1024,
  });
}

function parseScriptJson(stdout) {
  const text = String(stdout || "").trim();
  if (!text) throw new Error("Import script returned empty output");
  // Script may emit warnings before JSON — take last JSON object
  const start = text.lastIndexOf("{");
  if (start < 0) throw new Error("Import script returned no JSON");
  return JSON.parse(text.slice(start));
}

/**
 * Probe local Salad/Chrome/Edge cookie stores for salad.com auth cookie.
 * When apply=true, saves into secrets and enables Salad API.
 */
export async function importSaladAuth({ apply = true } = {}) {
  let raw;
  try {
    raw = await runImportScript(true);
  } catch (err) {
    // PowerShell exits 1 when not found — still may have JSON on stdout
    if (err.stdout) {
      raw = err;
    } else {
      return {
        ok: false,
        applied: false,
        error: err instanceof Error ? err.message : String(err),
        stderr: err.stderr ? String(err.stderr).slice(0, 400) : undefined,
      };
    }
  }

  let result;
  try {
    result = parseScriptJson(raw.stdout);
  } catch (err) {
    return {
      ok: false,
      applied: false,
      error: err instanceof Error ? err.message : String(err),
      stdoutPreview: String(raw.stdout || "").slice(0, 300),
    };
  }

  if (!result.ok || !result.value) {
    return {
      ok: false,
      applied: false,
      error: result.error || "auth cookie not found",
      attempts: result.attempts || [],
      alreadyConfigured: authCookiePresent(),
    };
  }

  const value = String(result.value).trim();
  const sameAsExisting = authCookiePresent() && getAuthCookie() === value;

  if (apply) {
    writeSecrets({ saladAuthCookie: value });
    writeSettings({ saladApiEnabled: true });
    invalidateSaladApiCache();
  }

  // Never echo full cookie back to API clients — preview only
  const { value: _omit, ...safe } = result;
  let account = null;
  if (apply) {
    try {
      account = await fetchSaladAccount(true);
    } catch {
      account = null;
    }
  }

  return {
    ok: true,
    applied: Boolean(apply),
    unchanged: sameAsExisting,
    source: result.source,
    host: result.host,
    length: result.length,
    preview: result.preview,
    attempts: result.attempts || [],
    authCookieConfigured: true,
    saladApiEnabled: true,
    account,
    note: sameAsExisting
      ? `Already using auth from ${result.source}.`
      : `Auto-filled auth from ${result.source} and enabled Salad API.`,
  };
}

/** Quiet startup import — only if no cookie saved yet. */
export async function autoFillAuthOnStartup() {
  if (authCookiePresent()) {
    return { skipped: true, reason: "already configured" };
  }
  try {
    return await importSaladAuth({ apply: true });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
