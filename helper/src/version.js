import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let cached = null;

function readVersionFromPackage(packagePath) {
  try {
    const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
    const version = String(pkg.version || "").trim();
    return version || null;
  } catch {
    return null;
  }
}

/** Product version: env override, then root / helper package.json. */
export function getProductVersion() {
  if (cached) return cached;
  const fromEnv = String(process.env.CHOPWATCH_VERSION || "").trim();
  if (fromEnv) {
    cached = fromEnv;
    return cached;
  }
  const candidates = [
    path.resolve(__dirname, "..", "..", "package.json"),
    path.resolve(__dirname, "..", "package.json"),
  ];
  for (const candidate of candidates) {
    const version = readVersionFromPackage(candidate);
    if (version) {
      cached = version;
      return cached;
    }
  }
  cached = "0.0.0";
  return cached;
}

/** Test helper — clear the in-memory cache. */
export function clearProductVersionCache() {
  cached = null;
}
