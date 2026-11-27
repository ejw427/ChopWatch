import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseTsAgeSec, readTail } from "../src/logTail.js";

const tempFiles = [];

afterEach(() => {
  for (const f of tempFiles.splice(0)) {
    try {
      fs.unlinkSync(f);
    } catch {
      /* ignore */
    }
  }
});

describe("parseTsAgeSec", () => {
  it("returns null for missing/invalid", () => {
    expect(parseTsAgeSec(null)).toBeNull();
    expect(parseTsAgeSec("nope")).toBeNull();
  });

  it("returns non-negative age in seconds", () => {
    // Build a local wall-clock stamp matching Bowl's "YYYY-MM-DD HH:mm:ss.sss".
    const past = new Date(Date.now() - 5_000);
    const pad = (n, w = 2) => String(n).padStart(w, "0");
    const ts = [
      past.getFullYear(),
      pad(past.getMonth() + 1),
      pad(past.getDate()),
    ].join("-") +
      " " +
      [
        pad(past.getHours()),
        pad(past.getMinutes()),
        pad(past.getSeconds()) + "." + pad(past.getMilliseconds(), 3),
      ].join(":");
    const age = parseTsAgeSec(ts);
    expect(age).toBeGreaterThanOrEqual(3);
    expect(age).toBeLessThan(30);
  });
});

describe("readTail", () => {
  it("returns the end of a file", () => {
    const file = path.join(os.tmpdir(), `chopwatch-tail-${Date.now()}.txt`);
    tempFiles.push(file);
    fs.writeFileSync(file, "AAAA\nBBBB\nCCCC\nDDDD\n", "utf8");
    const text = readTail(file, 10);
    expect(text.length).toBeLessThanOrEqual(10);
    expect(text.endsWith("DDDD\n") || text.includes("DDDD")).toBe(true);
  });
});
