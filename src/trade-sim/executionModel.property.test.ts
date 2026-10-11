import { describe, expect, it } from "vitest";
import fc from "fast-check";

import type { Candle } from "../guard/types.js";
import { PAIRS, type Pair } from "../ingestion/types.js";
import {
  DEFAULT_EXECUTION_MODEL,
  applyCosts,
  resolveEntry,
  totalCostPips,
} from "./executionModel.js";
import type { TradeOutcome } from "./types.js";

// Feature: trader-edge-validation, Property 2: Execution_Model entry + cost invariants
//
//   (R2.3) `resolveEntry` never returns a date ≤ the decision date, and never the
//          forecast's own close — it picks the earliest candle STRICTLY after it.
//   (R2.2) `applyCosts` reduces gross by exactly the pair's total friction and
//          retains the gross; a winning trade's net is ≤ its gross.
//
// Validates: Requirements 2.2, 2.3, 2.5

function candle(pair: Pair, date: string, open: number): Candle {
  return { asset: pair, date, open, high: open + 0.01, low: open - 0.01, close: open };
}

describe("trader-edge-validation Property 2: Execution_Model", () => {
  it("resolveEntry returns the earliest candle STRICTLY after the decision date, never on/before it", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<Pair>(...PAIRS),
        fc.double({ min: 0.5, max: 150, noNaN: true }),
        (pair, base) => {
          const decisionDate = "2024-03-04";
          // Candles on and around the decision date; the one ON it must be skipped.
          const candles: Candle[] = [
            candle(pair, "2024-03-01", base),
            candle(pair, "2024-03-04", base + 0.5), // the forecast's own date — must NOT be chosen
            candle(pair, "2024-03-05", base + 1.0), // the correct entry
            candle(pair, "2024-03-06", base + 1.5),
          ];
          const entry = resolveEntry(pair, decisionDate, candles);
          expect(entry).not.toBeNull();
          expect(entry!.entryDate > decisionDate).toBe(true);
          expect(entry!.entryDate).toBe("2024-03-05");
          expect(entry!.entryPrice).toBe(base + 1.0);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("resolveEntry returns null when no candle exists strictly after the decision date", () => {
    const pair: Pair = "EURUSD";
    const candles = [candle(pair, "2024-03-01", 1.1), candle(pair, "2024-03-04", 1.1)];
    expect(resolveEntry(pair, "2024-03-04", candles)).toBeNull();
  });

  it("applyCosts reduces gross by exactly total friction, retains gross, and net ≤ gross for a win", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<Pair>(...PAIRS),
        fc.double({ min: 0.1, max: 500, noNaN: true }),
        (pair, grossPips) => {
          const outcome: TradeOutcome = {
            kind: "target_first",
            resolvedOnDate: "2024-03-05",
            grossPips,
            ambiguousCandleDate: null,
          };
          const { netPips, grossPips: retained } = applyCosts(outcome, DEFAULT_EXECUTION_MODEL, pair);
          const cost = totalCostPips(DEFAULT_EXECUTION_MODEL, pair);
          expect(retained).toBe(grossPips); // gross retained (R4.5)
          expect(netPips).toBeCloseTo(grossPips - cost, 10); // exact friction (R2.2)
          expect(netPips).toBeLessThanOrEqual(grossPips); // a trader always pays
        },
      ),
      { numRuns: 200 },
    );
  });
});
