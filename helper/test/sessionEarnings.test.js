import { describe, expect, it } from "vitest";
import {
  updateSessionEarnings,
  applySessionEarnings,
} from "../src/sessionEarnings.js";

const NOW = 1_700_000_000_000;
const RUN_AT = "2025-11-27 10:00:00.000 +00:00";

function blankState(extra = {}) {
  return {
    sessionEarningsStartBalance: null,
    sessionEarningsRunningSinceAt: null,
    sessionEarningsShortId: null,
    ...extra,
  };
}

function runningWork(extra = {}) {
  return {
    phase: "running",
    shortId: "abc12345",
    runningSinceAt: RUN_AT,
    ...extra,
  };
}

describe("updateSessionEarnings", () => {
  it("captures baseline when entering running with a finite wallet.current", () => {
    const { patch, view } = updateSessionEarnings(
      runningWork(),
      { current: 12.5 },
      blankState(),
      NOW,
    );
    expect(patch).toEqual({
      sessionEarningsStartBalance: 12.5,
      sessionEarningsRunningSinceAt: RUN_AT,
      sessionEarningsShortId: "abc12345",
    });
    expect(view).toEqual({
      sessionEarned: 0,
      sessionStartBalance: 12.5,
      sessionRunningSinceAt: RUN_AT,
    });
  });

  it("computes delta while the same running session continues", () => {
    const state = blankState({
      sessionEarningsStartBalance: 12.5,
      sessionEarningsRunningSinceAt: RUN_AT,
      sessionEarningsShortId: "abc12345",
    });
    const { patch, view } = updateSessionEarnings(
      runningWork(),
      { current: 13.75 },
      state,
      NOW,
    );
    expect(patch).toEqual({});
    expect(view.sessionEarned).toBeCloseTo(1.25);
    expect(view.sessionStartBalance).toBe(12.5);
    expect(view.sessionRunningSinceAt).toBe(RUN_AT);
  });

  it("returns null sessionEarned until baseline and finite current exist", () => {
    const { patch, view } = updateSessionEarnings(
      runningWork(),
      { current: null },
      blankState(),
      NOW,
    );
    expect(patch).toEqual({});
    expect(view.sessionEarned).toBeNull();
    expect(view.sessionStartBalance).toBeNull();
  });

  it("keeps baseline but nulls earned when current is briefly missing", () => {
    const state = blankState({
      sessionEarningsStartBalance: 10,
      sessionEarningsRunningSinceAt: RUN_AT,
      sessionEarningsShortId: "abc12345",
    });
    const { patch, view } = updateSessionEarnings(
      runningWork(),
      null,
      state,
      NOW,
    );
    expect(patch).toEqual({});
    expect(view.sessionEarned).toBeNull();
    expect(view.sessionStartBalance).toBe(10);
  });

  it("resets baseline when shortId changes to a new running instance", () => {
    const state = blankState({
      sessionEarningsStartBalance: 10,
      sessionEarningsRunningSinceAt: RUN_AT,
      sessionEarningsShortId: "oldid001",
    });
    const { patch, view } = updateSessionEarnings(
      runningWork({ shortId: "newid002" }),
      { current: 11 },
      state,
      NOW,
    );
    expect(patch.sessionEarningsStartBalance).toBe(11);
    expect(patch.sessionEarningsShortId).toBe("newid002");
    expect(view.sessionEarned).toBe(0);
    expect(view.sessionStartBalance).toBe(11);
  });

  it("resets baseline when runningSinceAt changes", () => {
    const state = blankState({
      sessionEarningsStartBalance: 10,
      sessionEarningsRunningSinceAt: RUN_AT,
      sessionEarningsShortId: "abc12345",
    });
    const nextAt = "2025-11-27 12:00:00.000 +00:00";
    const { patch, view } = updateSessionEarnings(
      runningWork({ runningSinceAt: nextAt }),
      { current: 10.5 },
      state,
      NOW,
    );
    expect(patch.sessionEarningsRunningSinceAt).toBe(nextAt);
    expect(patch.sessionEarningsStartBalance).toBe(10.5);
    expect(view.sessionEarned).toBe(0);
  });

  it("clears baseline when phase leaves running", () => {
    const state = blankState({
      sessionEarningsStartBalance: 10,
      sessionEarningsRunningSinceAt: RUN_AT,
      sessionEarningsShortId: "abc12345",
    });
    for (const phase of ["stopped", "finding", "paused", "offline", "downloading"]) {
      const { patch, view } = updateSessionEarnings(
        { phase, shortId: "abc12345", runningSinceAt: RUN_AT },
        { current: 11 },
        state,
        NOW,
      );
      expect(patch).toEqual({
        sessionEarningsStartBalance: null,
        sessionEarningsRunningSinceAt: null,
        sessionEarningsShortId: null,
      });
      expect(view).toEqual({
        sessionEarned: null,
        sessionStartBalance: null,
        sessionRunningSinceAt: null,
      });
    }
  });

  it("emits empty patch when already cleared and not running", () => {
    const { patch, view } = updateSessionEarnings(
      { phase: "finding", shortId: null, runningSinceAt: null },
      { current: 5 },
      blankState(),
      NOW,
    );
    expect(patch).toEqual({});
    expect(view.sessionEarned).toBeNull();
  });

  it("allows a small negative delta from wallet noise", () => {
    const state = blankState({
      sessionEarningsStartBalance: 10,
      sessionEarningsRunningSinceAt: RUN_AT,
      sessionEarningsShortId: "abc12345",
    });
    const { view } = updateSessionEarnings(
      runningWork(),
      { current: 9.99 },
      state,
      NOW,
    );
    expect(view.sessionEarned).toBeCloseTo(-0.01);
  });

  it("clears stale baseline when identity changes but current is not yet available", () => {
    const state = blankState({
      sessionEarningsStartBalance: 10,
      sessionEarningsRunningSinceAt: RUN_AT,
      sessionEarningsShortId: "oldid001",
    });
    const { patch, view } = updateSessionEarnings(
      runningWork({ shortId: "newid002" }),
      { current: undefined },
      state,
      NOW,
    );
    expect(patch).toEqual({
      sessionEarningsStartBalance: null,
      sessionEarningsRunningSinceAt: null,
      sessionEarningsShortId: null,
    });
    expect(view.sessionEarned).toBeNull();
  });
});

describe("applySessionEarnings", () => {
  it("persists baseline via writeRuntimeState", () => {
    let state = blankState();
    const writes = [];
    const view = applySessionEarnings(
      runningWork(),
      { current: 7.25 },
      {
        readRuntimeState: () => ({ ...state }),
        writeRuntimeState: (patch) => {
          state = { ...state, ...patch };
          writes.push(patch);
          return { ...state };
        },
        nowMs: NOW,
      },
    );
    expect(writes).toHaveLength(1);
    expect(state.sessionEarningsStartBalance).toBe(7.25);
    expect(view.sessionEarned).toBe(0);

    const view2 = applySessionEarnings(
      runningWork(),
      { current: 8 },
      {
        readRuntimeState: () => ({ ...state }),
        writeRuntimeState: (patch) => {
          state = { ...state, ...patch };
          writes.push(patch);
          return { ...state };
        },
        nowMs: NOW,
      },
    );
    expect(writes).toHaveLength(1);
    expect(view2.sessionEarned).toBeCloseTo(0.75);
  });
});
