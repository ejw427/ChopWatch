import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const programData = process.env.PROGRAMDATA || "C:\\ProgramData";
const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");

export const paths = {
  programDataRoot: path.join(programData, "Salad"),
  preferences: path.join(programData, "Salad", "preferences.txt"),
  config: path.join(programData, "Salad", "config.txt"),
  bowlLogs: path.join(programData, "Salad", "logs"),
  workloads: path.join(programData, "Salad", "workloads"),
  workloadDefinitions: path.join(programData, "Salad", "workload-definitions"),
  wsl: path.join(programData, "Salad", "wsl"),
  appLogs: path.join(appData, "Salad", "logs"),
  appMainLog: path.join(appData, "Salad", "logs", "main.log"),
  installRoot: "C:\\Program Files\\Salad",
};

/** Never open these — credentials / host secrets. */
export const blockedFiles = new Set([
  "token.txt",
  "kernel-truth-sent.txt",
]);

export function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}
