import { describe, expect, it } from "vitest";
import { evaluatePhaseAlert } from "../src/alerts.js";

function makeDeps(initialState = {}, settings = {}) {
  let state = {
    lastPhase: null,
    lastPhaseTitle: null,
    lastAlertAt: null,
    lastAlertKey: null,
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
    },
    getState: () => state,
    writes,
    toasts,
  };
}

describe("evaluatePhaseAlert", () => {
  it("does not fire on first phase sighting", () => {
    const { deps, toasts } = makeDeps();
    const r = evaluatePhaseAlert(
      { phase: "running", title: "Running Job", detail: "ok" },
      deps,
    );
    expect(r.fired).toBe(false);
    expect(toasts).toHaveLength(0);
  });

  it("fires on phase change and toasts", () => {
    const { deps, toasts } = makeDeps({ lastPhase: "finding" });
    const r = evaluatePhaseAlert(
      { phase: "running", title: "Running Job", detail: "go" },
      deps,
    );
    expect(r.fired).toBe(true);
    expect(r.event.from).toBe("finding");
    expect(r.event.to).toBe("running");
    expect(toasts[0].title).toContain("Running Job");
  });

  it("respects alertsEnabled=false", () => {
    const { deps, toasts } = makeDeps(
      { lastPhase: "finding" },
      { alertsEnabled: false },
    );
    const r = evaluatePhaseAlert(
      { phase: "running", title: "Running Job" },
      deps,
    );
    expect(r.fired).toBe(false);
    expect(toasts).toHaveLength(0);
  });

  it("debounces identical transitions within 20s", () => {
    const { deps } = makeDeps({
      lastPhase: "finding",
      lastAlertKey: "finding->running",
      lastAlertAt: 1_700_000_000_000 - 5_000,
    });
    // First call updates lastPhase to running without firing (debounce).
    // Need lastPhase still "finding" for changed=true — simulate by keeping finding.
    const r = evaluatePhaseAlert(
      { phase: "running", title: "Running Job" },
      deps,
    );
    expect(r.fired).toBe(false);
  });

  it("ignores unknown phases", () => {
    const { deps } = makeDeps({ lastPhase: "running" });
    const r = evaluatePhaseAlert({ phase: "mystery" }, deps);
    expect(r.fired).toBe(false);
  });
});
