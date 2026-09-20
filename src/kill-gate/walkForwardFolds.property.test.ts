import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { PAIRS } from "../ingestion/types.js";
import type { Pair } from "../ingestion/types.js";
import type { TradingDate } from "../guard/types.js";
import { addTradingDays, compareTradingDates } from "../guard/tradingDate.js";
import { outOfSampleTestRanges, walkForwardFolds } from "./walkForward.js";

// Feature: fx-daily-pattern-assistant, Property 36: For all histories, the Walk_Forward_Window folds are sequential, non-overlapping, chronologically ordered with every train window preceding its test window, and the out-of-sample set equals the union of the test folds.
//
// Validates: Requirements 11.2, 19.1.
//
// walkForwardFolds() indexes fold windows over the sorted, de-duplicated
// trading-day history: fold i trains on `trainDays` consecutive history days
// and tests on the immediately-following `testDays` days, then the window rolls
// forward by exactly `testDays`. That construction guarantees the test windows
// are contiguous and non-overlapping and their union is a suffix of the fully
// covered history. We assert each of those structural invariants below, plus
// the short-history edge case where no full trainDays+testDays span exists.

/**
 * Generate a chronological trading-day history of `length` distinct dates from
 * a random base, spaced by a positive stride of trading days (ascending).
 */
const historyArb: fc.Arbitrary<TradingDate[]> = fc
  .record({
    length: fc.integer({ min: 1, max: 60 }),
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

/**
 * Small train/test windows so multiple folds form out of the short generated
 * histories above. Kept >= 1 (the function throws on non-positive windows).
 */
const configArb = fc.record({
  trainDays: fc.integer({ min: 1, max: 8 }),
  testDays: fc.integer({ min: 1, max: 6 }),
});

const pairArb: fc.Arbitrary<Pair> = fc.constantFrom(...PAIRS);

/** Sort + de-duplicate a history the same way walkForwardFolds() does. */
function sortedUnique(history: readonly TradingDate[]): TradingDate[] {
  const sorted = [...history].sort(compareTradingDates);
  const out: TradingDate[] = [];
  for (const d of sorted) {
    if (out[out.length - 1] !== d) {
      out.push(d);
    }
  }
  return out;
}

describe("Property 36: walk-forward fold construction", () => {
  it("produces sequential, non-overlapping, chronologically ordered folds whose test union is the out-of-sample suffix", () => {
    fc.assert(
      fc.property(
        pairArb,
        historyArb,
        configArb,
        (pair, history, config) => {
          const { trainDays, testDays } = config;
          const days = sortedUnique(history);
          const foldSpan = trainDays + testDays;

          const folds = walkForwardFolds(pair, history, config);

          // Edge case: too short for even one full train+test span => no folds.
          if (days.length < foldSpan) {
            expect(folds).toEqual([]);
            return;
          }

          expect(folds.length).toBeGreaterThan(0);

          const dayIndex = new Map<TradingDate, number>();
          days.forEach((d, i) => dayIndex.set(d, i));

          let prevTestEndIdx = -1;
          folds.forEach((fold, i) => {
            // foldIndex sequential from 0.
            expect(fold.foldIndex).toBe(i);
            expect(fold.frozen).toBe(true);

            const tsIdx = dayIndex.get(fold.trainStart);
            const teIdx = dayIndex.get(fold.trainEnd);
            const vsIdx = dayIndex.get(fold.testStart);
            const veIdx = dayIndex.get(fold.testEnd);

            // Every boundary is drawn from the actual history.
            expect(tsIdx).toBeDefined();
            expect(teIdx).toBeDefined();
            expect(vsIdx).toBeDefined();
            expect(veIdx).toBeDefined();

            const trainStartIdx = tsIdx as number;
            const trainEndIdx = teIdx as number;
            const testStartIdx = vsIdx as number;
            const testEndIdx = veIdx as number;

            // trainStart <= trainEnd < testStart <= testEnd: train window
            // strictly precedes the test window (Requirement 19.1).
            expect(trainStartIdx).toBeLessThanOrEqual(trainEndIdx);
            expect(trainEndIdx).toBeLessThan(testStartIdx);
            expect(testStartIdx).toBeLessThanOrEqual(testEndIdx);
            expect(
              compareTradingDates(fold.trainEnd, fold.testStart),
            ).toBeLessThan(0);

            // Window sizes match the config exactly.
            expect(trainEndIdx - trainStartIdx + 1).toBe(trainDays);
            expect(testEndIdx - testStartIdx + 1).toBe(testDays);

            // Roll-forward-by-testDays => fold i+1 testStart is the trading day
            // immediately after fold i testEnd (contiguous, non-overlapping).
            if (i > 0) {
              expect(testStartIdx).toBe(prevTestEndIdx + 1);
            }
            prevTestEndIdx = testEndIdx;
          });

          // Chronological ordering across folds: each field is strictly
          // increasing from one fold to the next.
          for (let i = 1; i < folds.length; i += 1) {
            const a = folds[i - 1] as (typeof folds)[number];
            const b = folds[i] as (typeof folds)[number];
            expect(compareTradingDates(a.trainStart, b.trainStart)).toBeLessThan(
              0,
            );
            expect(compareTradingDates(a.trainEnd, b.trainEnd)).toBeLessThan(0);
            expect(compareTradingDates(a.testStart, b.testStart)).toBeLessThan(
              0,
            );
            expect(compareTradingDates(a.testEnd, b.testEnd)).toBeLessThan(0);
          }

          // Out-of-sample set = union of the test folds. Build the actual union
          // of dates by expanding every [testStart, testEnd] range against the
          // sorted-unique history, and compare it to the expected suffix.
          const ranges = outOfSampleTestRanges(folds);
          const oosDays: TradingDate[] = [];
          for (const { start, end } of ranges) {
            const s = dayIndex.get(start) as number;
            const e = dayIndex.get(end) as number;
            for (let k = s; k <= e; k += 1) {
              oosDays.push(days[k] as TradingDate);
            }
          }

          // The union is a contiguous suffix of the covered history: it starts
          // at the first fold's testStart and ends at the last fold's testEnd
          // with no gaps or overlaps (each day appears exactly once).
          const last = folds[folds.length - 1] as (typeof folds)[number];
          const firstTestStartIdx = dayIndex.get(
            (folds[0] as (typeof folds)[number]).testStart,
          ) as number;
          const lastTestEndIdx = dayIndex.get(last.testEnd) as number;
          const expected = days.slice(firstTestStartIdx, lastTestEndIdx + 1);
          expect(oosDays).toEqual(expected);

          // No duplicates in the union (non-overlapping).
          expect(new Set(oosDays).size).toBe(oosDays.length);

          // The out-of-sample set is a subset of the history dates.
          const historySet = new Set(days);
          for (const d of oosDays) {
            expect(historySet.has(d)).toBe(true);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("returns [] when history is shorter than one full train+test span", () => {
    fc.assert(
      fc.property(
        pairArb,
        historyArb,
        configArb,
        (pair, history, config) => {
          const days = sortedUnique(history);
          const foldSpan = config.trainDays + config.testDays;
          fc.pre(days.length < foldSpan);
          expect(walkForwardFolds(pair, history, config)).toEqual([]);
        },
      ),
      { numRuns: 100 },
    );
  });
});
