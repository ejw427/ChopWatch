import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  parseStates,
  parsePullProgress,
  latestPullForShortId,
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
    expect(events[0].shortId).toBe("abc12345");
  });

  it("ignores lines without lifecycle markers", () => {
    expect(parseStates("noise\nWallet: Current(1), Predicted(2)\n")).toEqual([]);
  });
});

describe("parsePullProgress", () => {
  it("parses size, speed, ETA without image digests", () => {
    const pulls = parsePullProgress(sample);
    expect(pulls).toHaveLength(1);
    expect(pulls[0].shortId).toBe("abc12345");
    expect(pulls[0].bytesDone).toBe(3_500_000_000);
    expect(pulls[0].bytesTotal).toBe(10_000_000_000);
    expect(pulls[0].bytesPerSec).toBe(2_500_000);
    expect(pulls[0].etaSec).toBe(2600);
    expect(pulls[0].attempt).toBe(1);
    expect(pulls[0].attemptMax).toBe(3);
    expect(pulls[0].registryHost).toBe("registry-na-02");
    expect(JSON.stringify(pulls[0])).not.toMatch(/sha256/i);
    expect(JSON.stringify(pulls[0])).not.toMatch(/deadbeef/i);
  });

  it("picks latest pull for a shortId", () => {
    const text = `${sample}
2025-11-26 10:00:30.000 [INF] Pull progress event: SpinnerPullProgressEvent(registry-eu-02.salad.com/sce/x@sha256:2222222222222222222222222222222222222222222222222222222222222222)[abc12345-ac2f-4f4c-bd82-e8f52ab0f6a0] - 0.40 4000000000/10000000000B attempt 1/3 @ 3000000B/s eta 2000s
`;
    const pulls = parsePullProgress(text);
    const latest = latestPullForShortId(pulls, "abc12345");
    expect(latest.progress).toBeCloseTo(0.4);
    expect(latest.etaSec).toBe(2000);
    expect(latest.registryHost).toBe("registry-eu-02");
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
    expect(sessions[1].shortId).toBe("abc12345");
    expect(sessions[1].sawRunning).toBe(true);
    expect(sessions[1].sawPulling).toBe(true);
    expect(sessions[1].endedAt).toBeTruthy();
    expect(sessions[1].peakProgress).toBeCloseTo(0.35);
    expect(sessions[1].runningAt).toBeTruthy();
    expect(sessions[1].startedAt).toBeTruthy();
  });
});
