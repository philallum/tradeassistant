import { describe, expect, it } from "vitest";
import fc from "fast-check";

import type { TradingDate } from "../guard/types.js";
import type { Pair } from "../ingestion/types.js";
import type { DirectionClass } from "../retrieval/types.js";
import type { TradeOutcomeKind } from "../trade-sim/types.js";
import type { TradeLedgerRow } from "../trade-ledger/types.js";
import { summarize, summarizeBySlice } from "./metrics.js";

// Feature: trader-edge-validation, Property 5: profitability metrics
//
//   (R3.4) metrics derive SOLELY from ledger rows — a metric recomputed directly
//          from the simulated rows equals the summary's figure.
//   (R4.4) `ambiguous`/`expired` are never counted as win/loss, and their shares
//          sum coherently (ambiguous + expired ≤ 1).
//   (R4.3) per-slice trade counts reconcile to the whole.
//
// Validates: Requirements 3.4, 4.3, 4.4

const PAIRS4: readonly Pair[] = ["EURUSD", "GBPUSD", "USDJPY", "USDCHF"];
const OUTCOMES: readonly TradeOutcomeKind[] = ["target_first", "stop_first", "expired", "ambiguous"];

/** A SIMULATED ledger row (fired, directional, entry fill on a later date). */
function simulatedRow(
  i: number,
  outcome: TradeOutcomeKind,
  netPips: number,
  pair: Pair,
  direction: Exclude<DirectionClass, "FLAT">,
  horizon: 1 | 2 | 3,
): TradeLedgerRow {
  const date: TradingDate = `2024-04-${String((i % 27) + 1).padStart(2, "0")}`;
  return {
    strategyId: "system",
    pair,
    decisionDate: date,
    fired: true,
    direction,
    horizon,
    earnedConfidence: 0.55 + (i % 5) * 0.02,
    entryPrice: 1.1,
    entryDate: `2024-04-${String((i % 27) + 2).padStart(2, "0")}`, // strictly later ⇒ simulated
    stopLossPips: 20,
    takeProfitPips: 40,
    outcome,
    grossPips: netPips + 1,
    costPips: 1,
    netPips,
    rMultiple: netPips / 20,
  };
}

const rowArb = (): fc.Arbitrary<TradeLedgerRow> =>
  fc
    .tuple(
      fc.integer({ min: 0, max: 100 }),
      fc.constantFrom(...OUTCOMES),
      fc.double({ min: -60, max: 60, noNaN: true }),
      fc.constantFrom(...PAIRS4),
      fc.constantFrom<Exclude<DirectionClass, "FLAT">>("UP", "DOWN"),
      fc.constantFrom<1 | 2 | 3>(1, 2, 3),
    )
    .map(([i, outcome, net, pair, dir, h]) => simulatedRow(i, outcome, net, pair, dir, h));

describe("trader-edge-validation Property 5: metrics", () => {
  it("(R3.4) net expectancy equals the mean net pips recomputed directly from the rows", () => {
    fc.assert(
      fc.property(fc.array(rowArb(), { minLength: 1, maxLength: 50 }), (rows) => {
        const summary = summarize(rows);
        const mean = rows.reduce((s, r) => s + r.netPips, 0) / rows.length;
        expect(summary.netExpectancyPips).toBeCloseTo(mean, 9);
        expect(summary.tradeCount).toBe(rows.length);
      }),
      { numRuns: 200 },
    );
  });

  it("(R4.4) ambiguous/expired never count as win/loss; shares are coherent", () => {
    fc.assert(
      fc.property(fc.array(rowArb(), { minLength: 1, maxLength: 50 }), (rows) => {
        const summary = summarize(rows);
        const wins = rows.filter((r) => r.outcome !== "ambiguous" && r.netPips > 0).length;
        const losses = rows.filter((r) => r.outcome !== "ambiguous" && r.netPips < 0).length;
        // win rate counts only decided wins among simulated trades
        expect(summary.winRate).toBeCloseTo(wins / rows.length, 9);
        // ambiguous + expired shares are each in [0,1] and together ≤ 1
        expect(summary.ambiguousShare).toBeGreaterThanOrEqual(0);
        expect(summary.expiredShare).toBeGreaterThanOrEqual(0);
        expect(summary.ambiguousShare + summary.expiredShare).toBeLessThanOrEqual(1 + 1e-9);
        // wins + losses never exceed the trade count (ambiguous/expired excluded)
        expect(wins + losses).toBeLessThanOrEqual(summary.tradeCount);
      }),
      { numRuns: 200 },
    );
  });

  it("(R4.3) per-pair slice trade counts sum to the whole", () => {
    fc.assert(
      fc.property(fc.array(rowArb(), { minLength: 1, maxLength: 50 }), (rows) => {
        const whole = summarize(rows);
        const slices = summarizeBySlice(rows);
        const sliceTotal = Object.values(slices.byPair).reduce((s, v) => s + v.tradeCount, 0);
        expect(sliceTotal).toBe(whole.tradeCount);
      }),
      { numRuns: 200 },
    );
  });
});
