import { describe, expect, it } from "vitest";
import type { FiringSetupRow } from "../dashboard/persistFiringSetups.js";
import type { Pair } from "../ingestion/types.js";
import type { DirectionClass } from "../retrieval/types.js";
import { aggregateExposure } from "./aggregateExposure.js";

function row(pair: Pair, direction: DirectionClass, conf = 0.6): FiringSetupRow {
  return {
    decisionDate: "2024-01-02",
    pair,
    direction,
    horizon: 1,
    earnedConfidence: conf,
    stopLossPips: 20,
    takeProfitPips: 40,
    surfaced: true,
    suppressionReason: null,
  };
}

describe("aggregateExposure", () => {
  it("flags three long-USD firings as concentrated with net USD = -3", () => {
    const s = aggregateExposure([
      row("EURUSD", "UP", 0.6),
      row("GBPUSD", "UP", 0.8),
      row("USDJPY", "DOWN", 0.7),
    ]);
    expect(s.concentrated).toBe(true);
    expect(s.perCurrency.find((c) => c.currency === "USD")?.net).toBe(-3);
    expect(s.strongestPair).toBe("GBPUSD");
  });

  it("does not flag independent pairs", () => {
    const s = aggregateExposure([row("EURUSD", "UP"), row("USDJPY", "UP")]);
    expect(s.concentrated).toBe(false);
    expect(s.perCurrency.find((c) => c.currency === "USD")?.net).toBe(0);
  });

  it("handles empty and single firings", () => {
    expect(aggregateExposure([])).toEqual({
      perCurrency: [],
      concentrated: false,
      strongestPair: null,
    });
    expect(aggregateExposure([row("EURUSD", "UP")]).concentrated).toBe(false);
  });
});
