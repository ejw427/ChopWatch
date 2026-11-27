const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  ipcMain,
} = require("electron");
const { spawn } = require("node:child_process");
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");

const REPO_ROOT = path.resolve(__dirname, "..");
const HELPER_HOST = process.env.CHOPWATCH_HOST || "127.0.0.1";
const HELPER_PORT = Number(process.env.CHOPWATCH_PORT || 3781);
const HELPER_HEALTH = `http://${HELPER_HOST}:${HELPER_PORT}/health`;

let mainWindow = null;
let tray = null;
let helperChild = null;
let quitting = false;
let actionBusy = false;
let productVersion = "0.0.0";

function isPackagedApp() {
  return app.isPackaged;
}

function helperRoot() {
  if (isPackagedApp()) {
    return path.join(process.resourcesPath, "helper");
  }
  return path.join(REPO_ROOT, "helper");
}

function uiDir() {
  if (!isPackagedApp()) return null;
  const dir = path.join(process.resourcesPath, "ui");
  return fs.existsSync(dir) ? dir : null;
}

function dataDir() {
  if (isPackagedApp()) {
    return path.join(app.getPath("userData"), "data");
  }
  return path.join(REPO_ROOT, "helper", "data");
}

function readProductVersion() {
  const candidates = [
    path.join(REPO_ROOT, "package.json"),
    path.join(helperRoot(), "package.json"),
    path.join(__dirname, "package.json"),
  ];
  if (isPackagedApp()) {
    candidates.unshift(path.join(process.resourcesPath, "package.json"));
  }
  for (const candidate of candidates) {
    try {
      const pkg = JSON.parse(fs.readFileSync(candidate, "utf8"));
      const version = String(pkg.version || "").trim();
      if (version) return version;
    } catch {
      // try next
    }
  }
  return "0.0.0";
}

function uiUrl() {
  if (isPackagedApp()) {
    return `http://${HELPER_HOST}:${HELPER_PORT}/`;
  }
  return process.env.CHOPWATCH_UI_URL || "http://127.0.0.1:5177";
}

function loadTrayIcon() {
  const iconPath = path.join(__dirname, "assets", "icon.png");
  if (fs.existsSync(iconPath)) {
    const img = nativeImage.createFromPath(iconPath);
    if (!img.isEmpty()) return img;
  }
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

function runCommand(command, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: opts.cwd || REPO_ROOT,
      env: { ...process.env, ...(opts.env || {}) },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: opts.shell ?? process.platform === "win32",
    });
    let out = "";
    child.stdout?.on("data", (buf) => {
      out += buf.toString();
      process.stdout.write(`[build] ${buf}`);
    });
    child.stderr?.on("data", (buf) => {
      out += buf.toString();
      process.stderr.write(`[build] ${buf}`);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`${command} ${args.join(" ")} failed (${code})`));
    });
  });
}

function startHelper() {
  if (helperChild) return;
  const root = helperRoot();
  const helperEntry = path.join(root, "src", "index.js");
  const packaged = isPackagedApp();
  const env = {
    ...process.env,
    CHOPWATCH_HOST: HELPER_HOST,
    CHOPWATCH_PORT: String(HELPER_PORT),
    CHOPWATCH_DATA_DIR: dataDir(),
    CHOPWATCH_VERSION: productVersion,
  };
  const packagedUi = uiDir();
  if (packagedUi) {
    env.CHOPWATCH_UI_DIR = packagedUi;
  }

  if (packaged) {
    env.ELECTRON_RUN_AS_NODE = "1";
    helperChild = spawn(process.execPath, [helperEntry], {
      cwd: root,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
    });
  } else {
    helperChild = spawn("node", [helperEntry], {
      cwd: root,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
    });
  }

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

async function restartHelper() {
  stopHelper();
  await new Promise((r) => setTimeout(r, 400));
  startHelper();
  await waitForHealth(HELPER_HEALTH, { timeoutMs: 20000 });
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
    width: 1280,
    height: 900,
    minWidth: 720,
    minHeight: 520,
    show: false,
    title: "ChopWatch",
    backgroundColor: "#0f1419",
    autoHideMenuBar: true,
    icon: loadTrayIcon(),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
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

  mainWindow.loadURL(uiUrl()).catch((err) => {
    console.error("Failed to load UI:", err);
  });
}

function createTray() {
  const icon = loadTrayIcon();
  tray = new Tray(icon);
  tray.setToolTip("ChopWatch");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Show ChopWatch", click: () => showWindow() },
      { label: "Hide", click: () => hideWindow() },
      { type: "separator" },
      {
        label: "Restart helper",
        click: async () => {
          try {
            await restartHelper();
          } catch (err) {
            console.error(err);
          }
        },
      },
      {
        label: "Reload UI",
        click: () => mainWindow?.reload(),
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

function registerIpc() {
  ipcMain.handle("app:quit", async () => {
    quitting = true;
    app.quit();
    return { ok: true };
  });

  ipcMain.handle("app:reload", async () => {
    if (mainWindow) mainWindow.reload();
    return { ok: true };
  });

  ipcMain.handle("app:restart-helper", async () => {
    if (actionBusy) return { ok: false, error: "busy" };
    actionBusy = true;
    try {
      await restartHelper();
      return { ok: true, message: "Helper restarted." };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    } finally {
      actionBusy = false;
    }
  });

  ipcMain.handle("app:rebuild-restart", async () => {
    if (isPackagedApp()) {
      return {
        ok: false,
        error: "Rebuild is only available in development.",
      };
    }
    if (actionBusy) return { ok: false, error: "busy" };
    actionBusy = true;
    try {
      stopHelper();
      await runCommand("npm", ["run", "build", "--prefix", "web"]);
      startHelper();
      await waitForHealth(HELPER_HEALTH, { timeoutMs: 30000 });
      if (mainWindow) {
        await mainWindow.loadURL(uiUrl());
      }
      return { ok: true, message: "Rebuilt web + restarted helper." };
    } catch (err) {
      try {
        startHelper();
      } catch {
        // ignore
      }
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    } finally {
      actionBusy = false;
    }
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  registerIpc();

  app.on("second-instance", () => {
    showWindow();
  });

  app.whenReady().then(async () => {
    productVersion = readProductVersion();
    createTray();
    startHelper();
    try {
      await waitForHealth(HELPER_HEALTH);
      if (!isPackagedApp()) {
        await waitForUi(uiUrl());
      } else {
        await waitForUi(uiUrl(), { timeoutMs: 30000 });
      }
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
    // Keep running in the tray; Quit from the tray / Stop button calls app.quit().
  });

  app.on("activate", () => {
    showWindow();
  });
}
