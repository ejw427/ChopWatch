import { describe, expect, it } from "vitest";
import {
  dayKey,
  parseTs,
  integrateHours,
  msToHours,
  GAP_CAP_MS,
} from "../src/chopHours.js";

function ev(at, state, active) {
  return { at, ms: parseTs(at), state, active };
}

describe("dayKey / parseTs / msToHours", () => {
  it("extracts YYYY-MM-DD from bowl timestamps", () => {
    expect(dayKey("2025-11-26 10:00:00.000")).toBe("2025-11-26");
  });

  it("parses bowl timestamps", () => {
    expect(parseTs("2025-11-26 10:00:00.000")).toBe(
      Date.parse("2025-11-26T10:00:00.000"),
    );
    expect(parseTs("not-a-date")).toBeNull();
  });

  it("rounds hours to two decimals", () => {
    expect(msToHours(3_600_000)).toBe(1);
    expect(msToHours(1_800_000)).toBe(0.5);
  });
});

describe("integrateHours", () => {
  const t0 = "2025-11-26 10:00:00.000";
  const t1 = "2025-11-26 10:10:00.000";
  const t2 = "2025-11-26 12:00:00.000"; // 110m gap from t1 — should cap

  it("counts active spans between samples", () => {
    const events = [
      ev(t0, "Running", true),
      ev(t1, "Stopped", false),
    ];
    const since = parseTs(t0) - 1000;
    const { totalMs, byDay } = integrateHours(events, since, {
      nowMs: parseTs(t1),
    });
    expect(totalMs).toBe(10 * 60 * 1000);
    expect(byDay.get("2025-11-26")).toBe(10 * 60 * 1000);
  });

  it("caps gaps at 15 minutes", () => {
    const events = [
      ev(t0, "Running", true),
      ev(t2, "Stopped", false),
    ];
    const { totalMs } = integrateHours(events, 0, { nowMs: parseTs(t2) });
    expect(totalMs).toBe(GAP_CAP_MS);
  });

  it("skips inactive current samples", () => {
    const events = [
      ev(t0, "Stopped", false),
      ev(t1, "Running", true),
    ];
    const { totalMs } = integrateHours(events, 0, { nowMs: parseTs(t1) });
    expect(totalMs).toBe(0);
  });

  it("extends a still-active last event to now (capped)", () => {
    const events = [ev(t0, "Running", true)];
    const nowMs = parseTs(t0) + 60 * 60 * 1000; // 1h later
    const { totalMs } = integrateHours(events, 0, { nowMs });
    expect(totalMs).toBe(GAP_CAP_MS);
  });
});
