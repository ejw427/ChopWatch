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
  it("parses pulling / install / starting / running / stopping / stopped", () => {
    const events = parseStates(sample);
    expect(events.map((e) => e.state)).toEqual([
      "Pulling",
      "InstallStarting",
      "Starting",
      "Running",
      "Stopping",
      "Stopped",
      "Pulling",
    ]);
    expect(events[0].progress).toBeCloseTo(0.35);
    expect(events[0].phase).toBe("downloading");
    expect(events[1].phase).toBe("initializing");
    expect(events[3].phase).toBe("running");
    expect(events[0].shortId).toBe("abc12345");
    expect(events[0].at).toContain("-07:00");
    expect(events[5].stopReason).toBe("Exited, Stopped");
  });

  it("keeps fractional elapsed and empty Starting brackets", () => {
    const events = parseStates(sample);
    expect(events[2].state).toBe("Starting");
    expect(events[2].elapsed).toMatch(/00:01:00/);
    expect(events[0].elapsed).toMatch(/00:00:01/);
  });

  it("ignores nested Duration metadata and non-lifecycle lines", () => {
    const noise = `
2026-11-26 10:00:00.000 -07:00 [INF] Prev[Pulling]: WLStatusEvent -> WLInstanceStatePulling(WLInstanceStateDuration { StartedAt = 11/27/2026 3:13:24 AM +00:00, StoppedAt =  }) - Progress(1)
2026-11-26 10:00:00.000 -07:00 [INF] Wallet: Current(1), Predicted(2)
2026-11-26 10:00:00.000 -07:00 [INF] Node Compatibility Workload Result WLInstanceStateStopped(abc12345 - 00:00:01), Stopped with Reason(Exited, Stopped)
`;
    expect(parseStates(noise)).toEqual([]);
  });

  it("parses Starting with ProcessWLStatusEvent bracket and UTC stamps", () => {
    const text = `
2026-11-27 03:13:24.908 +00:00 [INF] SendStateChange(SourceId { Id = aaa-bbb-ccc, Name = Starting - WLInstanceStateStarting[abc12345][ProcessWLStatusEvent] - 00:01:00.0007409] })
`.trim();
    const events = parseStates(text);
    expect(events).toHaveLength(1);
    expect(events[0].state).toBe("Starting");
    expect(events[0].phase).toBe("initializing");
    expect(events[0].shortId).toBe("abc12345");
    expect(events[0].at).toContain("+00:00");
    expect(events[0].elapsed).toMatch(/00:01:00/);
  });

  it("parses Stopped without a stop reason and sparse Progress-only Pulling", () => {
    const text = `
2026-11-26 11:00:00.000 -07:00 [INF] SendStateChange(SourceId { Id = ddd-eee-fff, Name = Pulling - WLInstanceStatePulling(def456aa - 00:00:00), Progress(0) })
2026-11-26 11:05:00.000 -07:00 [INF] GetMetrics(SourceId { Id = ddd-eee-fff, Name = Stopped - WLInstanceStateStopped(def456aa - 00:05:00.0011055) })
`.trim();
    const events = parseStates(text);
    expect(events.map((e) => e.state)).toEqual(["Pulling", "Stopped"]);
    expect(events[0].progress).toBe(0);
    expect(events[0].phase).toBe("downloading");
    expect(events[1].stopReason).toBeNull();
    expect(events[1].phase).toBe("stopped");
  });

  it("parses Running that arrives without a prior Pulling event", () => {
    const text = `
2026-11-26 10:02:00.000 -07:00 [INF] GetMetrics(SourceId { Id = aaa-bbb-ccc, Name = Running - WLInstanceStateRunning[abc12345] - 00:02:00.0016893] })
`.trim();
    const events = parseStates(text);
    expect(events).toHaveLength(1);
    expect(events[0].state).toBe("Running");
    expect(events[0].phase).toBe("running");
    expect(events[0].progress).toBeNull();
  });
});

describe("parsePullProgress", () => {
  it("parses size, speed, ETA without image digests", () => {
    const pulls = parsePullProgress(sample);
    expect(pulls.length).toBeGreaterThanOrEqual(1);
    expect(pulls[0].shortId).toBe("abc12345");
    expect(pulls[0].bytesDone).toBe(3_500_000_000);
    expect(pulls[0].bytesTotal).toBe(10_000_000_000);
    expect(pulls[0].bytesPerSec).toBe(2_500_000);
    expect(pulls[0].etaSec).toBe(2600);
    expect(pulls[0].attempt).toBe(1);
    expect(pulls[0].attemptMax).toBe(3);
    expect(pulls[0].registryHost).toBe("registry-na-02");
    expect(pulls[0].at).toContain("-07:00");
    expect(JSON.stringify(pulls[0])).not.toMatch(/sha256/i);
    expect(JSON.stringify(pulls[0])).not.toMatch(/deadbeef/i);
  });

  it("tolerates pull lines missing attempt/speed/eta", () => {
    const pulls = parsePullProgress(sample);
    const sparse = pulls.find((p) => p.shortId === "def456aa");
    expect(sparse).toBeTruthy();
    expect(sparse.progress).toBeCloseTo(0.1);
    expect(sparse.bytesDone).toBe(1_000_000_000);
    expect(sparse.attempt).toBeNull();
    expect(sparse.bytesPerSec).toBeNull();
    expect(sparse.etaSec).toBeNull();
  });

  it("picks latest pull for a shortId", () => {
    const text = `${sample}
2025-11-26 10:00:30.000 -07:00 [INF] Pull progress event: SpinnerPullProgressEvent(registry-eu-02.salad.com/sce/x@sha256:2222222222222222222222222222222222222222222222222222222222222222)[abc12345-ac2f-4f4c-bd82-e8f52ab0f6a0] - 0.40 4000000000/10000000000B attempt 1/3 @ 3000000B/s eta 2000s
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

  it("ages out stale InstallStarting / Starting the same way", () => {
    expect(
      inferFinding(true, { state: "InstallStarting", shortId: "abc" }, 700, false)
        .phase,
    ).toBe("finding");
    expect(
      inferFinding(true, { state: "Starting", shortId: "abc" }, 700, false).phase,
    ).toBe("finding");
  });

  it("keeps a fresh Stopped job sticky before the finding handoff", () => {
    const r = inferFinding(
      true,
      { state: "Stopped", shortId: "abc" },
      10,
      false,
    );
    expect(r).toBeNull();
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

  it("does not invent Running when a pull never reaches Running", () => {
    const text = `
2026-11-26 11:00:00.000 -07:00 [INF] SendStateChange(SourceId { Id = ddd-eee-fff, Name = Pulling - WLInstanceStatePulling(def456aa - 00:00:00), Progress(0.10) })
2026-11-26 11:05:00.000 -07:00 [INF] GetMetrics(SourceId { Id = ddd-eee-fff, Name = Stopped - WLInstanceStateStopped(def456aa - 00:05:00.0011055), Stopped with Reason(ExitRequested) })
`.trim();
    const sessions = buildSessions(parseStates(text));
    expect(sessions).toHaveLength(1);
    expect(sessions[0].sawPulling).toBe(true);
    expect(sessions[0].sawRunning).toBe(false);
    expect(sessions[0].runningAt).toBeNull();
    expect(sessions[0].endedAt).toBeTruthy();
    expect(sessions[0].lastState).toBe("Stopped");
  });

  it("marks Running without inventing a prior Pulling", () => {
    const text = `
2026-11-26 10:02:00.000 -07:00 [INF] GetMetrics(SourceId { Id = aaa-bbb-ccc, Name = Running - WLInstanceStateRunning[abc12345] - 00:02:00.0016893] })
`.trim();
    const sessions = buildSessions(parseStates(text));
    expect(sessions).toHaveLength(1);
    expect(sessions[0].sawRunning).toBe(true);
    expect(sessions[0].sawPulling).toBe(false);
    expect(sessions[0].runningAt).toBe("2026-11-26 10:02:00.000 -07:00");
  });
});
