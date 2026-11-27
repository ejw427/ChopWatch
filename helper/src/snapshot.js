import { listSaladProcesses } from "./processes.js";
import { readPreferences } from "./preferences.js";
import { readWorkloadStatus } from "./bowlLog.js";
import { readDiskSnapshot } from "./disk.js";
import { readGpuSnapshot } from "./gpu.js";
import { readHostSnapshot } from "./host.js";
import { readWalletAndHeartbeat } from "./wallet.js";
import { readChopHours } from "./chopHours.js";
import { evaluatePhaseAlert } from "./alerts.js";
import { fetchSaladAccount } from "./saladApi.js";
import { readSettings, authCookiePresent } from "./store.js";
import { paths, exists } from "./saladPaths.js";
import { getProductVersion } from "./version.js";

export async function buildSnapshot() {
  const procs = listSaladProcesses();
  const prefs = readPreferences();
  const work = readWorkloadStatus(procs.running, prefs.choppingPaused);
  const disk = readDiskSnapshot();
  const gpu = readGpuSnapshot();
  const host = readHostSnapshot();
  const { wallet, heartbeat } = readWalletAndHeartbeat();
  const chopHours = readChopHours();
  const alert = evaluatePhaseAlert(work.current);
  const settings = readSettings();
  const saladAccount = await fetchSaladAccount(false);

  return {
    generatedAt: new Date().toISOString(),
    product: {
      name: "ChopWatch",
      version: getProductVersion(),
      mode: "read-only",
      disclaimer:
        "Shows Salad lifecycle and host status only. Customer workload identity and contents are intentionally hidden.",
    },
    salad: {
      installPresent: exists(paths.installRoot),
      programDataPresent: exists(paths.programDataRoot),
      bowlLogsPresent: exists(paths.bowlLogs),
      choppingPaused: prefs.choppingPaused,
    },
    processes: procs,
    work: work.current,
    timeline: work.timeline,
    sessions: work.sessions,
    logFiles: work.logFiles,
    workNote: work.note,
    wallet,
    heartbeat,
    gpu,
    host,
    chopHours,
    preferences: prefs.preferences,
    config: prefs.config,
    appFlags: prefs.appFlags,
    disk,
    alert: alert.event,
    settings: {
      ...settings,
      authCookieConfigured: authCookiePresent(),
    },
    saladAccount,
  };
}
