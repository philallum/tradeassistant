// Walk-Forward Fold Construction & Persistence (Task 6.2).
//
// Requirements 11.2, 11.4, 19.1, 19.2; Design Component 7.
//
// `walkForwardFolds()` is a pure, deterministic function (Requirement 3.2):
// given a pair and its chronological trading-day history, it produces
// sequential, non-overlapping, chronologically ordered train/test folds where
// every train window strictly precedes its test window. The out-of-sample set
// is the union of the test folds. Persistence freezes the boundaries and
// rejects any later attempt to change recorded fold dates.

import { compareTradingDates } from "../guard/tradingDate.js";
import type { TradingDate } from "../guard/types.js";
import type { Pair } from "../ingestion/types.js";
import {
  DEFAULT_WALK_FORWARD_CONFIG,
  type PersistFoldsReport,
  type WalkForwardConfig,
  type WalkForwardFold,
  type WalkForwardFoldStore,
} from "./types.js";

/**
 * Construct sequential, non-overlapping, chronologically ordered walk-forward
 * folds over `history`.
 *
 * Folds are indexed over the sorted, de-duplicated trading-day history rather
 * than over calendar time, which makes the construction deterministic and
 * immune to weekends/holidays: fold `i` trains on `trainDays` consecutive
 * history days and tests on the immediately following `testDays` days, then the
 * window rolls forward by `testDays`. Because the test windows advance by
 * exactly their own length, they are contiguous and non-overlapping, and their
 * union is a suffix of the history (the out-of-sample set). Every train window
 * strictly precedes its test window (`trainEnd < testStart`).
 *
 * A fold is emitted only when a full `trainDays + testDays` span of history is
 * available for it (default ~3-year train / ~1-year test). If the history is
 * too short for even one full fold, an empty array is returned.
 *
 * Pure and deterministic: identical inputs always produce identical folds.
 * Boundaries are marked `frozen: true` so downstream persistence treats them as
 * fixed (Requirements 19.1, 19.2).
 */
export function walkForwardFolds(
  _pair: Pair,
  history: readonly TradingDate[],
  config: WalkForwardConfig = DEFAULT_WALK_FORWARD_CONFIG,
): WalkForwardFold[] {
  const { trainDays, testDays } = config;
  if (trainDays <= 0 || testDays <= 0) {
    throw new Error(
      `walkForwardFolds requires positive train/test window sizes, got ` +
        `trainDays=${trainDays}, testDays=${testDays}`,
    );
  }

  // Sort chronologically and de-duplicate so fold indexing is well-defined and
  // deterministic regardless of the caller's ordering.
  const sorted = [...history].sort(compareTradingDates);
  const days: TradingDate[] = [];
  for (const d of sorted) {
    if (days[days.length - 1] !== d) {
      days.push(d);
    }
  }

  const foldSpan = trainDays + testDays;
  const folds: WalkForwardFold[] = [];
  let foldIndex = 0;

  for (
    let start = 0;
    start + foldSpan <= days.length;
    start += testDays, foldIndex += 1
  ) {
    const trainStartIdx = start;
    const trainEndIdx = start + trainDays - 1;
    const testStartIdx = start + trainDays;
    const testEndIdx = start + foldSpan - 1;

    folds.push({
      foldIndex,
      // Non-null: every index above is < days.length by the loop guard.
      trainStart: days[trainStartIdx] as TradingDate,
      trainEnd: days[trainEndIdx] as TradingDate,
      testStart: days[testStartIdx] as TradingDate,
      testEnd: days[testEndIdx] as TradingDate,
      frozen: true,
    });
  }

  return folds;
}

/**
 * Persist constructed folds for an asset with frozen boundaries and enforce
 * change-rejection: identical re-writes are idempotent no-ops, while any write
 * that changes the recorded dates of an already-persisted fold is rejected and
 * the original is retained (Requirements 11.4, 19.2).
 *
 * The immutability decision lives in the store (mirroring `data_splits`); this
 * function normalizes `frozen` to `true` before delegating.
 */
export function persistWalkForwardFolds(
  store: WalkForwardFoldStore,
  asset: Pair,
  folds: readonly WalkForwardFold[],
): Promise<PersistFoldsReport> {
  const frozen = folds.map((f) => ({ ...f, frozen: true }));
  return store.persistFolds(asset, frozen);
}

/**
 * The out-of-sample evaluation set is the union of the test windows across all
 * folds (Requirement 11.2). Because folds are non-overlapping and contiguous,
 * this is returned as an ordered, de-duplicated list of [testStart, testEnd]
 * boundaries; callers intersect it against the full history to enumerate dates.
 */
export function outOfSampleTestRanges(
  folds: readonly WalkForwardFold[],
): { readonly start: TradingDate; readonly end: TradingDate }[] {
  return folds
    .slice()
    .sort((a, b) => a.foldIndex - b.foldIndex)
    .map((f) => ({ start: f.testStart, end: f.testEnd }));
}
