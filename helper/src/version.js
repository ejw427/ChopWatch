import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootPackagePath = path.resolve(__dirname, "..", "..", "package.json");

let cached = null;

/** Product version from root package.json (single source of truth). */
export function getProductVersion() {
  if (cached) return cached;
  try {
    const pkg = JSON.parse(fs.readFileSync(rootPackagePath, "utf8"));
    cached = String(pkg.version || "0.0.0");
  } catch {
    cached = "0.0.0";
  }
  return cached;
}

/** Test helper — clear the in-memory cache. */
export function clearProductVersionCache() {
  cached = null;
}
