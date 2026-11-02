// Pure shaper tests — snapshot-driven, no network. Validates: Requirements 10.2, 10.3
import { describe, expect, it } from "vitest";
import type { Calibration, PerformanceSummaryRow, TradeLedgerSummary } from "../api/types";
import { MIN_SAMPLE_TRADES, shapeEvaluationNet } from "./shapeEvaluationNet";

const row = (id: string, net: number, trades: number): PerformanceSummaryRow => ({
  strategyId: id,
  netExpectancyPips: net,
  netExpectancyR: 0,
  grossExpectancyPips: net,
  winRate: 0.5,
  avgWinPips: 1,
  avgLossPips: 1,
  profitFactor: null,
  maxDrawdownPips: 1,
  longestLosingStreak: 1,
  tradeCount: trades,
  timeInMarketDays: 1,
  ambiguousShare: 0,
  expiredShare: 0,
});
const noCal: Calibration = { bands: [], monotonic: null, wellCalibrated: null };
const ledger = (strategies: TradeLedgerSummary["strategies"]): TradeLedgerSummary => ({
  window: null,
  strategies,
});

describe("shapeEvaluationNet", () => {
  it("is empty for a v3 snapshot (empty slices)", () => {
    expect(shapeEvaluationNet({ tradeLedgerSummary: ledger([]), calibration: noCal })).toEqual({
      kind: "empty",
    });
  });

  it("flags a sample below the minimum as un-validated", () => {
    const r = shapeEvaluationNet({
      tradeLedgerSummary: ledger([{ role: "system", summary: row("s", 1, MIN_SAMPLE_TRADES - 1) }]),
      calibration: noCal,
    });
    expect(r.kind === "ready" && r.validated).toBe(false);
    expect(r.kind === "ready" && r.timeConsistency.measured).toBe(false);
    expect(r.kind === "ready" && r.beatsAllComparators).toBeNull();
  });

  it("compares the system with comparators and detects when it does not beat them", () => {
    const r = shapeEvaluationNet({
      tradeLedgerSummary: ledger([
        { role: "system", summary: row("s", 1, MIN_SAMPLE_TRADES) },
        { role: "comparator", summary: row("a", 0, 10) },
        { role: "comparator", summary: row("b", 3, 10) },
      ]),
      calibration: { bands: [], monotonic: true, wellCalibrated: false },
    });
    if (r.kind !== "ready") throw new Error("expected ready");
    expect(r.validated).toBe(true);
    expect(r.beatsAllComparators).toBe(false);
    expect(r.comparators.map((c) => c.systemMinusComparatorPips)).toEqual([1, -2]);
  });
});
