// Pure shaper tests — snapshot-driven, no network. Validates: Requirements 10.1, 10.3, 1.7
import { describe, expect, it } from "vitest";
import type { AnalogueOutcomeRow, TradeLedgerSummary } from "../api/types";
import type { CardVM } from "./shapeDashboard";
import { shapeSetupTrades } from "./shapeSetupTrades";

const card: CardVM = {
  pair: "EURUSD",
  strategyId: "s1",
  direction: "UP",
  horizon: 2,
  earnedConfidence: 0.6,
  stopLossPips: 30,
  takeProfitPips: 45,
};

function analogue(direction: AnalogueOutcomeRow["direction"], matured = true): AnalogueOutcomeRow {
  return {
    asset: "EURUSD",
    decision_date: "2026-01-01",
    horizon: 2,
    direction,
    mfe_pips: 1,
    mae_pips: 1,
    matured,
  };
}

const ledger: TradeLedgerSummary = {
  window: { from: "2026-01-01", to: "2026-06-01" },
  strategies: [
    {
      role: "system",
      summary: {
        strategyId: "s1",
        netExpectancyPips: 3.2,
        netExpectancyR: 0.1,
        grossExpectancyPips: 4,
        winRate: 0.5,
        avgWinPips: 10,
        avgLossPips: 8,
        profitFactor: 1.2,
        maxDrawdownPips: 20,
        longestLosingStreak: 3,
        tradeCount: 40,
        timeInMarketDays: 80,
        ambiguousShare: 0,
        expiredShare: 0,
      },
    },
  ],
};

const base = {
  cards: [card],
  decisionDate: "2026-02-01",
  analogueOutcomes: [analogue("UP"), analogue("UP"), analogue("DOWN"), analogue("UP", false)],
  tradeLedgerSummary: { window: null, strategies: [] } as TradeLedgerSummary,
  provenance: [],
  validationStatus: [],
};

describe("shapeSetupTrades", () => {
  it("is un-validated by default (v3 / empty slices) and labels FORECAST vs TRADE", () => {
    const [vm] = shapeSetupTrades(base);
    expect(vm?.forecast.label).toBe("FORECAST");
    expect(vm?.trade.label).toBe("TRADE");
    expect(vm?.trade.stopLossPips).toEqual({ value: 30, validated: false });
    expect(vm?.trade.takeProfitPips.validated).toBe(false);
    expect(vm?.trade.netExpectancyPips).toEqual({ value: null, validated: false });
    expect(vm?.anyUnvalidated).toBe(true);
  });

  it("tallies only matured analogues for count and agreement", () => {
    const [vm] = shapeSetupTrades(base);
    expect(vm?.forecast.analogueCount).toBe(3);
    expect(vm?.forecast.historicalAgreement).toBeCloseTo(2 / 3);
  });

  it("stays un-validated when status is validated but no ledger exists (R1.7)", () => {
    const [vm] = shapeSetupTrades({
      ...base,
      validationStatus: [{ decision_date: "2026-02-01", pair: "EURUSD", status: "validated" }],
    });
    expect(vm?.trade.stopLossPips.validated).toBe(false);
    expect(vm?.forecast.confidence.validated).toBe(true);
  });

  it("is fully validated only with validated status and a measured ledger", () => {
    const [vm] = shapeSetupTrades({
      ...base,
      tradeLedgerSummary: ledger,
      validationStatus: [{ decision_date: "2026-02-01", pair: "EURUSD", status: "validated" }],
      provenance: [
        {
          decision_date: "2026-02-01",
          pair: "EURUSD",
          lastCandleTimestamp: "2026-02-01T21:00:00Z",
          computedAt: "2026-02-02T01:00:00Z",
          earliestEntryRef: "2026-02-02",
          horizonStart: "2026-02-02",
          horizonEnd: "2026-02-04",
          dataComplete: true,
          staleReason: null,
        },
      ],
    });
    expect(vm?.anyUnvalidated).toBe(false);
    expect(vm?.trade.netExpectancyPips).toEqual({ value: 3.2, validated: true });
    expect(vm?.trade.entryAssumption).toBe("2026-02-02");
    expect(vm?.trade.horizonExpiry).toBe("2026-02-04");
  });

  it("yields null agreement with no analogues", () => {
    const [vm] = shapeSetupTrades({ ...base, analogueOutcomes: [] });
    expect(vm?.forecast.historicalAgreement).toBeNull();
  });
});
