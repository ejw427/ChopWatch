import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  parseStates,
  inferFinding,
  buildSessions,
} from "../src/bowlLog.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sample = readFileSync(
  path.join(__dirname, "fixtures", "bowl-sample.log.txt"),
  "utf8",
);

describe("parseStates", () => {
  it("parses pulling / starting / running / stopping / stopped", () => {
    const events = parseStates(sample);
    expect(events.map((e) => e.state)).toEqual([
      "Pulling",
      "Starting",
      "Running",
      "Stopping",
      "Stopped",
      "Pulling",
    ]);
    expect(events[0].progress).toBeCloseTo(0.35);
    expect(events[0].phase).toBe("downloading");
    expect(events[2].phase).toBe("running");
    expect(events[0].shortId).toBe("abc123");
  });

  it("ignores lines without lifecycle markers", () => {
    expect(parseStates("noise\nWallet: Current(1), Predicted(2)\n")).toEqual([]);
  });
});

describe("inferFinding", () => {
  it("reports offline when Salad is not running", () => {
    const r = inferFinding(false, null, null, false);
    expect(r.phase).toBe("offline");
  });

  it("reports paused when chopping is paused", () => {
    const r = inferFinding(true, null, null, true);
    expect(r.phase).toBe("paused");
  });

  it("reports finding when there is no recent event", () => {
    const r = inferFinding(true, null, Infinity, false);
    expect(r.phase).toBe("finding");
  });

  it("reports finding after a stopped job ages out", () => {
    const r = inferFinding(
      true,
      { state: "Stopped", shortId: "abc" },
      30,
      false,
    );
    expect(r.phase).toBe("finding");
  });

  it("returns null when a fresh running state should stick", () => {
    const r = inferFinding(
      true,
      { state: "Running", shortId: "abc" },
      10,
      false,
    );
    expect(r).toBeNull();
  });

  it("keeps running sticky after a long quiet period", () => {
    const r = inferFinding(
      true,
      { state: "Running", shortId: "abc" },
      1800,
      false,
    );
    expect(r).toBeNull();
  });

  it("ages out stale pulling so a missed Running is not stuck forever", () => {
    const r = inferFinding(
      true,
      { state: "Pulling", shortId: "abc" },
      700,
      false,
    );
    expect(r.phase).toBe("finding");
  });
});

describe("buildSessions", () => {
  it("groups events by shortId and marks running/pulling", () => {
    const sessions = buildSessions(parseStates(sample));
    expect(sessions.length).toBe(2);
    // newest first
    expect(sessions[0].shortId).toBe("def456");
    expect(sessions[1].shortId).toBe("abc123");
    expect(sessions[1].sawRunning).toBe(true);
    expect(sessions[1].sawPulling).toBe(true);
    expect(sessions[1].endedAt).toBeTruthy();
    expect(sessions[1].peakProgress).toBeCloseTo(0.35);
    expect(sessions[1].runningAt).toBeTruthy();
    expect(sessions[1].startedAt).toBeTruthy();
  });
});
