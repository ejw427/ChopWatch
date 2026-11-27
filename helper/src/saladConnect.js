import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import {
  writeSecrets,
  writeSettings,
  authCookiePresent,
} from "./store.js";
import { invalidateSaladApiCache, fetchSaladAccount } from "./saladApi.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const profileDir = path.join(__dirname, "..", "data", "salad-browser-profile");

let connectJob = {
  status: "idle",
  startedAt: null,
  finishedAt: null,
  message: null,
  browser: null,
  source: null,
  debug: null,
  account: null,
};

function browserCandidates() {
  const pf = process.env.ProgramFiles || process.env.PROGRAMFILES || "C:\\Program Files";
  const pf86 =
    process.env["ProgramFiles(x86)"] ||
    process.env.PROGRAMFILES_X86 ||
    "C:\\Program Files (x86)";
  return [
    { name: "edge", path: path.join(pf86, "Microsoft", "Edge", "Application", "msedge.exe") },
    { name: "edge", path: path.join(pf, "Microsoft", "Edge", "Application", "msedge.exe") },
    { name: "chrome", path: path.join(pf, "Google", "Chrome", "Application", "chrome.exe") },
    { name: "chrome", path: path.join(pf86, "Google", "Chrome", "Application", "chrome.exe") },
  ];
}

function findBrowser() {
  for (const b of browserCandidates()) {
    if (fs.existsSync(b.path)) return b;
  }
  return null;
}

function clearProfileLocks(dir) {
  if (!fs.existsSync(dir)) return;
  for (const name of [
    "SingletonLock",
    "SingletonCookie",
    "SingletonSocket",
    "lockfile",
  ]) {
    try {
      fs.rmSync(path.join(dir, name), { force: true });
    } catch {
      // ignore
    }
  }
}

function publicStatus() {
  const browser = findBrowser();
  return {
    status: connectJob.status,
    startedAt: connectJob.startedAt,
    finishedAt: connectJob.finishedAt,
    message: connectJob.message,
    source: connectJob.source,
    authCookieConfigured: authCookiePresent(),
    profileDir,
    browserPath: browser?.path || null,
    browserName: browser?.name || null,
    debug: connectJob.debug,
  };
}

async function extractAuthFromPage(page) {
  const urls = [
    "https://salad.com",
    "https://www.salad.com",
    "https://app.salad.com",
    "https://app-api.salad.com",
  ];
  for (const url of urls) {
    try {
      const cookies = await page.cookies(url);
      const auth = cookies.find(
        (c) => c.name === "auth" && c.value && String(c.value).length > 20,
      );
      if (auth) return auth.value;
    } catch {
      // continue
    }
  }
  return null;
}

async function extractAuthFromBrowser(browser) {
  try {
    const pages = await browser.pages();
    for (const page of pages) {
      const value = await extractAuthFromPage(page);
      if (value) return value;
    }
  } catch {
    // continue to CDP
  }

  try {
    const pages = await browser.pages();
    const page = pages[0] || (await browser.newPage());
    const client = await page.createCDPSession();
    const { cookies } = await client.send("Network.getAllCookies");
    const auth = cookies.find(
      (c) =>
        c.name === "auth" &&
        /salad\.(com|io)/i.test(String(c.domain || "")) &&
        c.value &&
        String(c.value).length > 20,
    );
    if (auth) return auth.value;

    // Some Salad sessions use different cookie names
    const alt = cookies.find(
      (c) =>
        /salad\.(com|io)/i.test(String(c.domain || "")) &&
        /^(auth|sAccessToken|access_token|token)$/i.test(c.name) &&
        c.value &&
        String(c.value).length > 20,
    );
    if (alt) return alt.value;
  } catch (err) {
    connectJob.debug = `cookie sweep: ${err instanceof Error ? err.message : String(err)}`;
  }
  return null;
}

async function persistAuth(value) {
  writeSecrets({ saladAuthCookie: value });
  writeSettings({ saladApiEnabled: true });
  invalidateSaladApiCache();
  let account = null;
  try {
    account = await fetchSaladAccount(true);
  } catch {
    account = null;
  }
  return account;
}

async function runConnectLoop(browser) {
  const page = (await browser.pages())[0] || (await browser.newPage());

  // Login-first URL; app.salad.com may bounce without a session.
  const targets = [
    "https://salad.com/login",
    "https://app.salad.com/",
  ];
  for (const url of targets) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
      break;
    } catch (err) {
      connectJob.debug = `goto ${url}: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline && connectJob.status === "waiting") {
    if (!browser.connected) {
      connectJob.status = "failed";
      connectJob.finishedAt = new Date().toISOString();
      connectJob.message =
        "Browser disconnected before login finished. Try Connect again (Edge is preferred).";
      connectJob.browser = null;
      return;
    }

    const value = await extractAuthFromBrowser(browser);
    if (value) {
      const account = await persistAuth(value);
      connectJob.status = "connected";
      connectJob.finishedAt = new Date().toISOString();
      connectJob.source = "chopwatch-browser-profile";
      connectJob.account = account;
      connectJob.message = account?.ok
        ? "Salad account connected. Official API is live."
        : "Signed in and auth saved. If balance still fails, click Refresh API.";
      try {
        await browser.close();
      } catch {
        // ignore
      }
      connectJob.browser = null;
      return;
    }

    connectJob.message =
      "Waiting for Salad sign-in… finish login in the opened window (auth is captured automatically).";
    await new Promise((r) => setTimeout(r, 1500));
  }

  if (connectJob.status === "waiting") {
    connectJob.status = "failed";
    connectJob.finishedAt = new Date().toISOString();
    connectJob.message =
      "Timed out waiting for login. Click Connect again and complete sign-in in the window.";
    try {
      await browser.close();
    } catch {
      // ignore
    }
    connectJob.browser = null;
  }
}

export function getConnectStatus() {
  return publicStatus();
}

export async function startSaladConnect() {
  if (connectJob.status === "waiting" && connectJob.browser?.connected) {
    return {
      ...publicStatus(),
      note: "Connect window already open — sign in there.",
    };
  }

  const browserInfo = findBrowser();
  if (!browserInfo) {
    connectJob.status = "failed";
    connectJob.message = "No Edge/Chrome executable found.";
    connectJob.finishedAt = new Date().toISOString();
    return publicStatus();
  }

  fs.mkdirSync(profileDir, { recursive: true });
  clearProfileLocks(profileDir);

  if (connectJob.browser) {
    try {
      await connectJob.browser.close();
    } catch {
      // ignore
    }
  }

  connectJob = {
    status: "waiting",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    message: `Opening ${browserInfo.name} for Salad login…`,
    browser: null,
    source: null,
    debug: null,
    account: null,
  };

  try {
    const browser = await puppeteer.launch({
      executablePath: browserInfo.path,
      headless: false,
      defaultViewport: null,
      userDataDir: profileDir,
      ignoreDefaultArgs: ["--enable-automation"],
      args: [
        "--new-window",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-features=Translate,InfiniteSessionRestore",
        "--disable-session-crashed-bubble",
      ],
    });

    connectJob.browser = browser;
    connectJob.message =
      "Browser opened. Sign in to Salad there — ChopWatch captures auth automatically (never shown).";

    // Only treat disconnect as cancel if we are still waiting AND loop hasn't marked failure.
    browser.on("disconnected", () => {
      if (connectJob.status === "waiting") {
        connectJob.status = "cancelled";
        connectJob.finishedAt = new Date().toISOString();
        connectJob.message =
          "Login window closed before auth was captured. Click Connect to try again.";
        connectJob.browser = null;
      }
    });

    runConnectLoop(browser).catch((err) => {
      connectJob.status = "failed";
      connectJob.finishedAt = new Date().toISOString();
      connectJob.message = err instanceof Error ? err.message : String(err);
      connectJob.browser = null;
    });
  } catch (err) {
    connectJob.status = "failed";
    connectJob.finishedAt = new Date().toISOString();
    connectJob.message = err instanceof Error ? err.message : String(err);
    connectJob.debug = connectJob.message;
  }

  return publicStatus();
}

export async function cancelSaladConnect() {
  if (connectJob.browser) {
    try {
      await connectJob.browser.close();
    } catch {
      // ignore
    }
  }
  connectJob.status = "cancelled";
  connectJob.finishedAt = new Date().toISOString();
  connectJob.message = "Connect cancelled.";
  connectJob.browser = null;
  return publicStatus();
}
