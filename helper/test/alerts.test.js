import { describe, expect, it } from "vitest";
import { evaluatePhaseAlert, readLastAlertEvent } from "../src/alerts.js";

function makeDeps(initialState = {}, settings = {}) {
  let state = {
    lastPhase: null,
    lastPhaseTitle: null,
    lastAlertAt: null,
    lastAlertKey: null,
    lastAlertEvent: null,
    startupAlertDone: false,
    ...initialState,
  };
  const writes = [];
  const toasts = [];
  return {
    deps: {
      readSettings: () => ({
        alertsEnabled: true,
        windowsToastEnabled: true,
        ...settings,
      }),
      readRuntimeState: () => ({ ...state }),
      writeRuntimeState: (patch) => {
        state = { ...state, ...patch };
        writes.push(patch);
      },
      toastWindows: (title, body) => toasts.push({ title, body }),
      nowMs: 1_700_000_000_000,
      skipOsToast: false,
    },
    getState: () => state,
    writes,
    toasts,
  };
}

describe("evaluatePhaseAlert", () => {
  it("fires a startup alert for Running on first sighting", () => {
    const { deps, toasts, getState } = makeDeps();
    const r = evaluatePhaseAlert(
      { phase: "running", title: "Running Job", detail: "ok" },
      deps,
    );
    expect(r.fired).toBe(true);
    expect(r.event.from).toBeNull();
    expect(r.event.to).toBe("running");
    expect(toasts).toHaveLength(1);
    expect(getState().startupAlertDone).toBe(true);
  });

  it("does not fire startup for finding", () => {
    const { deps, toasts } = makeDeps();
    const r = evaluatePhaseAlert(
      { phase: "finding", title: "Finding Job" },
      deps,
    );
    expect(r.fired).toBe(false);
    expect(toasts).toHaveLength(0);
  });

  it("fires on phase change and toasts", () => {
    const { deps, toasts, getState } = makeDeps({
      lastPhase: "finding",
      startupAlertDone: true,
    });
    const r = evaluatePhaseAlert(
      { phase: "running", title: "Running Job", detail: "go" },
      deps,
    );
    expect(r.fired).toBe(true);
    expect(r.event.from).toBe("finding");
    expect(r.event.to).toBe("running");
    expect(toasts[0].title).toContain("Running Job");
    expect(getState().lastAlertEvent.to).toBe("running");
  });

  it("respects alertsEnabled=false", () => {
    const { deps, toasts } = makeDeps(
      { lastPhase: "finding", startupAlertDone: true },
      { alertsEnabled: false },
    );
    const r = evaluatePhaseAlert(
      { phase: "running", title: "Running Job" },
      deps,
    );
    expect(r.fired).toBe(false);
    expect(toasts).toHaveLength(0);
  });

  it("skips OS toast when desktop owns balloons", () => {
    const { deps, toasts } = makeDeps({
      lastPhase: "finding",
      startupAlertDone: true,
    });
    deps.skipOsToast = true;
    const r = evaluatePhaseAlert(
      { phase: "running", title: "Running Job" },
      deps,
    );
    expect(r.fired).toBe(true);
    expect(toasts).toHaveLength(0);
  });

  it("debounces identical transitions within 20s", () => {
    const { deps } = makeDeps({
      lastPhase: "finding",
      startupAlertDone: true,
      lastAlertKey: "finding->running",
      lastAlertAt: 1_700_000_000_000 - 5_000,
    });
    const r = evaluatePhaseAlert(
      { phase: "running", title: "Running Job" },
      deps,
    );
    expect(r.fired).toBe(false);
  });

  it("ignores unknown phases", () => {
    const { deps } = makeDeps({ lastPhase: "running", startupAlertDone: true });
    const r = evaluatePhaseAlert({ phase: "mystery" }, deps);
    expect(r.fired).toBe(false);
  });

  it("readLastAlertEvent returns stored event", () => {
    const event = { at: "t", to: "running", title: "x", body: "y" };
    const { deps, getState } = makeDeps({ lastAlertEvent: event });
    expect(readLastAlertEvent({ readRuntimeState: deps.readRuntimeState })).toEqual(
      event,
    );
    expect(getState().lastAlertEvent).toEqual(event);
  });
});
