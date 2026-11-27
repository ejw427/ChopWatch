import { describe, expect, it } from "vitest";
import { parseWalletAndHeartbeatText } from "../src/wallet.js";

const sample = `
2025-11-26 09:00:00.000 Wallet: Current(1.00), Predicted(2.00)
2025-11-26 10:05:00.000 Wallet: Current(12.34), Predicted(15.67)
2025-11-26 10:05:30.000 OrchestrationEvent: Heartbeat
2025-11-26 09:50:00.000 OrchestrationEvent: Heartbeat
`.trim();

describe("parseWalletAndHeartbeatText", () => {
  it("keeps the newest wallet line", () => {
    const now = Date.parse("2025-11-26T10:06:00.000");
    const { wallet, heartbeat } = parseWalletAndHeartbeatText(sample, now);
    expect(wallet.current).toBeCloseTo(12.34);
    expect(wallet.predicted).toBeCloseTo(15.67);
    expect(wallet.at).toBe("2025-11-26 10:05:00.000");
    expect(wallet.ageSec).toBe(60);
    expect(heartbeat.at).toBe("2025-11-26 10:05:30.000");
    expect(heartbeat.ageSec).toBe(30);
  });

  it("returns nulls for empty text", () => {
    const { wallet, heartbeat } = parseWalletAndHeartbeatText("");
    expect(wallet).toBeNull();
    expect(heartbeat).toBeNull();
  });
});
