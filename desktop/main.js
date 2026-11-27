const { app, BrowserWindow, Tray, Menu, nativeImage } = require("electron");
const { spawn } = require("node:child_process");
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");

const REPO_ROOT = path.resolve(__dirname, "..");
const HELPER_HOST = process.env.CHOPWATCH_HOST || "127.0.0.1";
const HELPER_PORT = Number(process.env.CHOPWATCH_PORT || 3781);
const UI_URL = process.env.CHOPWATCH_UI_URL || "http://127.0.0.1:5177";
const HELPER_HEALTH = `http://${HELPER_HOST}:${HELPER_PORT}/health`;

let mainWindow = null;
let tray = null;
let helperChild = null;
let quitting = false;

function loadTrayIcon() {
  const iconPath = path.join(__dirname, "assets", "icon.png");
  if (fs.existsSync(iconPath)) {
    const img = nativeImage.createFromPath(iconPath);
    if (!img.isEmpty()) return img;
  }
  // 16x16 teal square fallback if asset missing
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAHklEQVQ4T2NkYGD4z0ABYBzVMKoBVAOoGDA0NQAAZD4BAfkH+9sAAAAASUVORK5CYII=",
    "base64",
  );
  return nativeImage.createFromBuffer(png);
}

function waitForHealth(url, { timeoutMs = 30000, intervalMs = 250 } = {}) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve();
          return;
        }
        retry();
      });
      req.on("error", retry);
      req.setTimeout(2000, () => {
        req.destroy();
        retry();
      });
    };
    const retry = () => {
      if (Date.now() - started > timeoutMs) {
        reject(new Error(`Helper health check timed out: ${url}`));
        return;
      }
      setTimeout(tryOnce, intervalMs);
    };
    tryOnce();
  });
}

function waitForUi(url, { timeoutMs = 60000, intervalMs = 300 } = {}) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 500) {
          resolve();
          return;
        }
        retry();
      });
      req.on("error", retry);
      req.setTimeout(2000, () => {
        req.destroy();
        retry();
      });
    };
    const retry = () => {
      if (Date.now() - started > timeoutMs) {
        reject(new Error(`UI not ready: ${url}`));
        return;
      }
      setTimeout(tryOnce, intervalMs);
    };
    tryOnce();
  });
}

function startHelper() {
  if (helperChild) return;
  const helperEntry = path.join(REPO_ROOT, "helper", "src", "index.js");
  helperChild = spawn("node", [helperEntry], {
    cwd: path.join(REPO_ROOT, "helper"),
    env: {
      ...process.env,
      CHOPWATCH_HOST: HELPER_HOST,
      CHOPWATCH_PORT: String(HELPER_PORT),
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    shell: false,
  });

  helperChild.stdout?.on("data", (buf) => {
    process.stdout.write(`[helper] ${buf}`);
  });
  helperChild.stderr?.on("data", (buf) => {
    process.stderr.write(`[helper] ${buf}`);
  });
  helperChild.on("exit", (code, signal) => {
    helperChild = null;
    if (!quitting) {
      console.error(`Helper exited unexpectedly (code=${code}, signal=${signal})`);
    }
  });
}

function stopHelper() {
  if (!helperChild) return;
  const child = helperChild;
  helperChild = null;
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
    } else {
      child.kill("SIGTERM");
    }
  } catch {
    // ignore
  }
}

function showWindow() {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function hideWindow() {
  if (mainWindow && mainWindow.isVisible()) mainWindow.hide();
}

function createWindow() {
  if (mainWindow) return;

  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 720,
    minHeight: 520,
    show: false,
    title: "ChopWatch",
    backgroundColor: "#0f1419",
    autoHideMenuBar: true,
    icon: loadTrayIcon(),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  mainWindow.once("ready-to-show", () => {
    if (!quitting) mainWindow.show();
  });

  mainWindow.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    mainWindow.hide();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.loadURL(UI_URL).catch((err) => {
    console.error("Failed to load UI:", err);
  });
}

function createTray() {
  const icon = loadTrayIcon();
  tray = new Tray(icon);
  tray.setToolTip("ChopWatch");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "Show ChopWatch",
        click: () => showWindow(),
      },
      {
        label: "Hide",
        click: () => hideWindow(),
      },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on("click", () => {
    if (!mainWindow || !mainWindow.isVisible()) showWindow();
    else hideWindow();
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    showWindow();
  });

  app.whenReady().then(async () => {
    createTray();
    startHelper();
    try {
      await waitForHealth(HELPER_HEALTH);
      await waitForUi(UI_URL);
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
    }
    createWindow();
  });

  app.on("before-quit", () => {
    quitting = true;
    stopHelper();
  });

  app.on("window-all-closed", () => {
    // Keep running in the tray; Quit from the tray menu calls app.quit().
  });

  app.on("activate", () => {
    showWindow();
  });
}
