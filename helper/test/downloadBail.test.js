import { describe, expect, it } from "vitest";
import {
  evaluateDownloadBail,
  trackDownloadProgress,
  runDownloadBailStep,
  manualDownloadBail,
  PAUSE_HOLD_MS,
  SAME_INSTANCE_SETTLE_MS,
} from "../src/downloadBail.js";

const NOW = 1_700_000_000_000;

const defaultSettings = {
  downloadBailEnabled: true,
  downloadBailGraceMinutes: 10,
  downloadBailMaxMinutes: 30,
  downloadBailStallMinutes: 10,
  downloadBailMaxEtaMinutes: 45,
  downloadBailEtaPersistMinutes: 8,
  downloadBailCooldownMinutes: 25,
  windowsToastEnabled: true,
};

function blankState(extra = {}) {
  return {
    downloadBailLastAt: null,
    downloadBailLastShortId: null,
    downloadBailLastReason: null,
    downloadBailPendingResumeAt: null,
    downloadBailProgressShortId: null,
    downloadBailProgressValue: null,
    downloadBailProgressAt: null,
    downloadBailEtaOverSince: null,
    downloadBailEtaOverShortId: null,
    downloadBailLastEtaSec: null,
    downloadBailRetriesByShortId: {},
    downloadBailBlackoutUntil: {},
    ...extra,
  };
}

function makeDeps(initialState = {}, settings = {}) {
  let state = blankState(initialState);
  const writes = [];
  const flags = [];
  const toasts = [];
  return {
    deps: {
      readSettings: () => ({ ...defaultSettings, ...settings }),
      readRuntimeState: () => ({ ...state }),
      writeRuntimeState: (patch) => {
        state = { ...state, ...patch };
        writes.push(patch);
        return { ...state };
      },
      writeAppFlags: (patch) => {
        flags.push(patch);
        return { ok: true };
      },
      toastWindows: (title, body) => toasts.push({ title, body }),
      nowMs: NOW,
    },
    getState: () => state,
    writes,
    flags,
    toasts,
  };
}

describe("trackDownloadProgress", () => {
  it("starts tracking on downloading", () => {
    const patch = trackDownloadProgress(
      { phase: "downloading", shortId: "abc", progress: 0.1, pull: { etaSec: 3600 } },
      blankState(),
      NOW,
      defaultSettings,
    );
    expect(patch.downloadBailProgressShortId).toBe("abc");
    expect(patch.downloadBailProgressValue).toBe(0.1);
    expect(patch.downloadBailProgressAt).toBe(NOW);
  });

  it("starts ETA-over clock when over cap", () => {
    const patch = trackDownloadProgress(
      {
        phase: "downloading",
        shortId: "abc",
        progress: 0.2,
        pull: { etaSec: 50 * 60 },
      },
      blankState({
        downloadBailProgressShortId: "abc",
        downloadBailProgressValue: 0.2,
        downloadBailProgressAt: NOW - 60_000,
        downloadBailLastEtaSec: 55 * 60,
      }),
      NOW,
      defaultSettings,
    );
    expect(patch.downloadBailEtaOverSince).toBe(NOW);
    expect(patch.downloadBailEtaOverShortId).toBe("abc");
  });

  it("clears ETA-over clock when ETA improves", () => {
    const patch = trackDownloadProgress(
      {
        phase: "downloading",
        shortId: "abc",
        progress: 0.3,
        pull: { etaSec: 30 * 60 },
      },
      blankState({
        downloadBailProgressShortId: "abc",
        downloadBailProgressValue: 0.25,
        downloadBailProgressAt: NOW - 60_000,
        downloadBailLastEtaSec: 50 * 60,
        downloadBailEtaOverSince: NOW - 5 * 60_000,
        downloadBailEtaOverShortId: "abc",
      }),
      NOW,
      defaultSettings,
    );
    expect(patch.downloadBailEtaOverSince).toBeNull();
  });
});

describe("evaluateDownloadBail", () => {
  it("ignores paid / idle phases", () => {
    const r = evaluateDownloadBail(
      { phase: "running", shortId: "x", sessionAgeSec: 9999 },
      defaultSettings,
      blankState(),
      NOW,
    );
    expect(r.action).toBe("none");
    expect(r.status.status).toBe("idle");
  });

  it("bails stuck initializing on max age", () => {
    const r = evaluateDownloadBail(
      { phase: "initializing", shortId: "abc", sessionAgeSec: 31 * 60 },
      defaultSettings,
      blankState(),
      NOW,
    );
    expect(r.action).toBe("pause");
    expect(r.reason).toBe("max_age_30m");
  });

  it("waits through grace even with huge ETA", () => {
    const r = evaluateDownloadBail(
      {
        phase: "downloading",
        shortId: "abc",
        sessionAgeSec: 5 * 60,
        pull: { etaSec: 3 * 3600 },
      },
      defaultSettings,
      blankState({
        downloadBailEtaOverSince: NOW - 20 * 60_000,
        downloadBailEtaOverShortId: "abc",
      }),
      NOW,
    );
    expect(r.action).toBe("none");
    expect(r.status.reason).toBe("grace");
  });

  it("does not bail on a brief ETA spike", () => {
    const r = evaluateDownloadBail(
      {
        phase: "downloading",
        shortId: "abc",
        sessionAgeSec: 15 * 60,
        pull: { etaSec: 60 * 60 },
      },
      defaultSettings,
      blankState({
        downloadBailEtaOverSince: NOW - 2 * 60_000,
        downloadBailEtaOverShortId: "abc",
      }),
      NOW,
    );
    expect(r.action).toBe("none");
    expect(r.status.status).toBe("watching");
  });

  it("bails when ETA stays over cap for persist window", () => {
    const r = evaluateDownloadBail(
      {
        phase: "downloading",
        shortId: "abc",
        sessionAgeSec: 15 * 60,
        pull: { etaSec: 60 * 60 },
      },
      defaultSettings,
      blankState({
        downloadBailEtaOverSince: NOW - 9 * 60_000,
        downloadBailEtaOverShortId: "abc",
      }),
      NOW,
    );
    expect(r.action).toBe("pause");
    expect(r.reason).toBe("long_eta_45m");
  });

  it("bails on max age after grace", () => {
    const r = evaluateDownloadBail(
      { phase: "downloading", shortId: "abc", sessionAgeSec: 31 * 60 },
      defaultSettings,
      blankState(),
      NOW,
    );
    expect(r.action).toBe("pause");
    expect(r.reason).toBe("max_age_30m");
  });

  it("bails on stall", () => {
    const r = evaluateDownloadBail(
      { phase: "downloading", shortId: "abc", sessionAgeSec: 15 * 60, progress: 0.3 },
      defaultSettings,
      blankState({
        downloadBailProgressShortId: "abc",
        downloadBailProgressValue: 0.3,
        downloadBailProgressAt: NOW - 11 * 60_000,
      }),
      NOW,
    );
    expect(r.action).toBe("pause");
    expect(r.reason).toBe("stall_10m");
  });

  it("respects cooldown for a different instance", () => {
    const r = evaluateDownloadBail(
      { phase: "downloading", shortId: "new", sessionAgeSec: 40 * 60 },
      defaultSettings,
      blankState({
        downloadBailLastAt: NOW - 5 * 60_000,
        downloadBailLastShortId: "old",
      }),
      NOW,
    );
    expect(r.action).toBe("none");
    expect(r.status.status).toBe("cooldown");
  });

  it("accepts same instance after one re-roll instead of dumping again", () => {
    const r = evaluateDownloadBail(
      {
        phase: "downloading",
        shortId: "abc",
        sessionAgeSec: 40 * 60,
        pull: { etaSec: 2 * 3600 },
      },
      defaultSettings,
      blankState({
        downloadBailLastAt: NOW - SAME_INSTANCE_SETTLE_MS - 1_000,
        downloadBailLastShortId: "abc",
        downloadBailRetriesByShortId: { abc: 1 },
        downloadBailEtaOverSince: NOW - 20 * 60_000,
        downloadBailEtaOverShortId: "abc",
      }),
      NOW,
    );
    expect(r.action).toBe("none");
    expect(r.status.reason).toBe("accepted_after_reroll");
  });

  it("honors same-instance blackout", () => {
    const r = evaluateDownloadBail(
      { phase: "downloading", shortId: "abc", sessionAgeSec: 40 * 60 },
      defaultSettings,
      blankState({
        downloadBailBlackoutUntil: { abc: NOW + 60_000 },
      }),
      NOW,
    );
    expect(r.action).toBe("none");
    expect(r.status.reason).toBe("same_instance_blackout");
  });

  it("force manual ignores thresholds", () => {
    const r = evaluateDownloadBail(
      { phase: "downloading", shortId: "abc", sessionAgeSec: 30 },
      { ...defaultSettings, downloadBailEnabled: false },
      blankState(),
      NOW,
      { force: true },
    );
    expect(r.action).toBe("pause");
    expect(r.reason).toBe("manual");
  });
});

describe("runDownloadBailStep", () => {
  it("pauses Salad and blackouts after one skip", () => {
    const { deps, flags, getState } = makeDeps();
    const r = runDownloadBailStep(
      {
        phase: "downloading",
        shortId: "abc",
        sessionAgeSec: 35 * 60,
        progress: 0.1,
      },
      false,
      deps,
    );
    expect(r.acted).toBe(true);
    expect(r.action).toBe("pause");
    expect(flags[0]).toEqual({ SALAD_CHOPPING_INDEFINITELY_PAUSED: true });
    expect(getState().downloadBailRetriesByShortId.abc).toBe(1);
    expect(getState().downloadBailBlackoutUntil.abc).toBeGreaterThan(NOW);
  });

  it("resumes after pending hold", () => {
    const { deps, flags } = makeDeps({
      downloadBailPendingResumeAt: NOW - 1,
      downloadBailLastReason: "stall_10m",
      downloadBailLastAt: NOW - PAUSE_HOLD_MS - 1,
      downloadBailLastShortId: "abc",
    });
    const r = runDownloadBailStep(
      { phase: "paused", shortId: "abc" },
      true,
      deps,
    );
    expect(r.acted).toBe(true);
    expect(r.action).toBe("resume");
    expect(flags[0]).toEqual({ SALAD_CHOPPING_INDEFINITELY_PAUSED: false });
  });
});

describe("manualDownloadBail", () => {
  it("rejects when not unpaid", () => {
    const { deps } = makeDeps();
    const r = manualDownloadBail({ phase: "running" }, false, deps);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("not_unpaid");
  });

  it("forces bail while downloading", () => {
    const { deps, flags } = makeDeps({}, { downloadBailEnabled: false });
    const r = manualDownloadBail(
      { phase: "downloading", shortId: "z", sessionAgeSec: 10, progress: 0.01 },
      false,
      deps,
    );
    expect(r.ok).toBe(true);
    expect(flags[0].SALAD_CHOPPING_INDEFINITELY_PAUSED).toBe(true);
  });

  it("forces bail while initializing even if already paused", () => {
    const { deps, flags } = makeDeps({}, { downloadBailEnabled: false });
    const r = manualDownloadBail(
      { phase: "initializing", shortId: "z", sessionAgeSec: 10 },
      true,
      deps,
    );
    expect(r.ok).toBe(true);
    expect(flags[0].SALAD_CHOPPING_INDEFINITELY_PAUSED).toBe(true);
  });
});
