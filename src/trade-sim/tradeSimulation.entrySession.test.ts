import { describe, expect, it } from "vitest";

import type { Candle } from "../guard/types.js";
import { resolveEntry } from "./executionModel.js";
import { simulateTrade } from "./tradeSimulation.js";

// Regression: the entry session's own path must be simulated. A trader filled at the open of
// session E sees E's high/low; the earlier filter (strictly after the entry date) skipped E and
// replayed the NEXT session instead, so a target hit during the entry session was missed.
const candles: Candle[] = [
  { asset: "EURUSD", date: "2024-03-04", open: 1.1, high: 1.101, low: 1.099, close: 1.1 }, // decision date
  { asset: "EURUSD", date: "2024-03-05", open: 1.1, high: 1.112, low: 1.1, close: 1.111 }, // entry session: +110 pips high
  { asset: "EURUSD", date: "2024-03-06", open: 1.111, high: 1.112, low: 1.109, close: 1.1105 },
];

describe("simulateTrade entry session", () => {
  it("resolves a target touched during the entry session", () => {
    const entry = resolveEntry("EURUSD", "2024-03-04", candles)!;
    expect(entry.entryDate).toBe("2024-03-05");
    const out = simulateTrade(
      { pair: "EURUSD", decisionDate: "2024-03-04", direction: "UP", horizon: 1, entryPrice: entry.entryPrice, entryDate: entry.entryDate, stopLossPips: 50, takeProfitPips: 60 },
      candles,
    );
    expect(out).toMatchObject({ kind: "target_first", resolvedOnDate: "2024-03-05", grossPips: 60 });
  });

  it("an expired horizon-1 trade is open-to-close of the entry session, not the next one", () => {
    const entry = resolveEntry("EURUSD", "2024-03-04", candles)!;
    const out = simulateTrade(
      { pair: "EURUSD", decisionDate: "2024-03-04", direction: "UP", horizon: 1, entryPrice: entry.entryPrice, entryDate: entry.entryDate, stopLossPips: 500, takeProfitPips: 500 },
      candles,
    );
    expect(out.kind).toBe("expired");
    expect(out.resolvedOnDate).toBe("2024-03-05");
    expect(out.grossPips).toBe(110); // 1.1000 -> 1.1110
  });

  it("never reads a candle before the entry date", () => {
    const out = simulateTrade(
      { pair: "EURUSD", decisionDate: "2024-03-04", direction: "DOWN", horizon: 1, entryPrice: 1.1, entryDate: "2024-03-05", stopLossPips: 5, takeProfitPips: 5 },
      [{ asset: "EURUSD", date: "2024-03-04", open: 1.1, high: 1.2, low: 1.0, close: 1.1 }, ...candles.slice(2)],
    );
    expect(out.resolvedOnDate === null || out.resolvedOnDate >= "2024-03-05").toBe(true);
  });
});
