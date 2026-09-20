import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { chronologicalSplit } from "./dataSplit.js";
import { addTradingDays, compareTradingDates } from "../guard/tradingDate.js";
import type { TradingDate } from "../guard/types.js";

// Feature: fx-daily-pattern-assistant, Property 16: For all histories, the Data_Split assigns the earliest 70% (±2pp) to train/dev and the most recent 30% (±2pp) to the Out_Of_Sample_Test with no shuffling, and every train date precedes every test date.
//
// Validates: Requirement 11.2.

// Minimum history length so the ±2pp tolerance is meaningful: with fewer days,
// a single date shifts the realized fraction by more than 2 percentage points
// and the floor() rounding dominates. 100 distinct days keeps 1 day = 1pp.
const MIN_HISTORY = 100;
const MAX_HISTORY = 1200;

/**
 * Generate a chronological trading-day history of `length` distinct dates
 * starting from a random base date, spaced by a random positive stride of
 * trading days. Dates are produced in ascending order; the split function is
 * responsible for its own sorting, so this exercises already-sorted input.
 */
const historyArb: fc.Arbitrary<TradingDate[]> = fc
  .record({
    length: fc.integer({ min: MIN_HISTORY, max: MAX_HISTORY }),
    baseYear: fc.integer({ min: 2000, max: 2015 }),
    baseMonth: fc.integer({ min: 1, max: 12 }),
    baseDay: fc.integer({ min: 1, max: 28 }),
    stride: fc.integer({ min: 1, max: 3 }),
  })
  .map(({ length, baseYear, baseMonth, baseDay, stride }) => {
    const base = `${baseYear}-${baseMonth.toString().padStart(2, "0")}-${baseDay
      .toString()
      .padStart(2, "0")}`;
    const dates: TradingDate[] = [];
    let cursor = addTradingDays(base, 0); // snap to a trading day
    dates.push(cursor);
    for (let i = 1; i < length; i += 1) {
      cursor = addTradingDays(cursor, stride);
      dates.push(cursor);
    }
    return dates;
  });

/** Shuffle a copy of `dates` so we can prove the split is order-independent. */
function shuffled(dates: readonly TradingDate[], seed: number): TradingDate[] {
  const arr = [...dates];
  let s = seed >>> 0;
  for (let i = arr.length - 1; i > 0; i -= 1) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const j = s % (i + 1);
    const tmp = arr[i] as TradingDate;
    arr[i] = arr[j] as TradingDate;
    arr[j] = tmp;
  }
  return arr;
}

describe("Property 16: chronological 70/30 (±2pp) Data_Split", () => {
  it("assigns earliest ~70% to train and most-recent ~30% to test, ordered, train < test", () => {
    fc.assert(
      fc.property(historyArb, fc.integer(), (history, shuffleSeed) => {
        const split = chronologicalSplit(shuffled(history, shuffleSeed));
        const n = history.length;

        // No shuffling: partitions are chronologically sorted.
        for (let i = 1; i < split.trainDates.length; i += 1) {
          expect(
            compareTradingDates(
              split.trainDates[i - 1] as TradingDate,
              split.trainDates[i] as TradingDate,
            ),
          ).toBeLessThan(0);
        }
        for (let i = 1; i < split.testDates.length; i += 1) {
          expect(
            compareTradingDates(
              split.testDates[i - 1] as TradingDate,
              split.testDates[i] as TradingDate,
            ),
          ).toBeLessThan(0);
        }

        // The union covers every distinct date exactly once (no loss/dup).
        expect(split.trainDates.length + split.testDates.length).toBe(n);

        // 70/30 (±2 percentage points) partition.
        const trainFraction = split.trainDates.length / n;
        const testFraction = split.testDates.length / n;
        expect(trainFraction).toBeGreaterThanOrEqual(0.7 - 0.02);
        expect(trainFraction).toBeLessThanOrEqual(0.7 + 0.02);
        expect(testFraction).toBeGreaterThanOrEqual(0.3 - 0.02);
        expect(testFraction).toBeLessThanOrEqual(0.3 + 0.02);

        // Both partitions non-empty for a history of this size.
        expect(split.trainDates.length).toBeGreaterThan(0);
        expect(split.testDates.length).toBeGreaterThan(0);
        expect(split.trainEnd).not.toBeNull();
        expect(split.testStart).not.toBeNull();

        // Every train date strictly precedes every test date: enough to compare
        // the boundary (train max < test min), since both are sorted.
        expect(
          compareTradingDates(
            split.trainEnd as TradingDate,
            split.testStart as TradingDate,
          ),
        ).toBeLessThan(0);
      }),
      { numRuns: 200 },
    );
  });
});
