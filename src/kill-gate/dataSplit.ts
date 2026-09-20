// Chronological Data_Split definition (Task 6.7, Requirement 11.2).
//
// The Data_Split is the chronological, non-shuffled partition of history into a
// train/dev set (earliest ~70%) and a held-out out-of-sample test set (most
// recent ~30%), with fixed split dates and every train date strictly preceding
// every test date (glossary Data_Split; Requirement 11.2).
//
// Under the Walk_Forward_Window scheme the walk-forward folds are the PRIMARY
// evaluation partition (see `walkForward.ts`). This function RETAINS the
// original single-partition chronological split definition for reference and
// backward compatibility. It is pure and deterministic (Requirement 3.2).

import { compareTradingDates } from "../guard/tradingDate.js";
import type { TradingDate } from "../guard/types.js";

/** The fraction of history assigned to the train/dev partition (earliest). */
export const TRAIN_FRACTION = 0.7;

/**
 * The chronological partition of a trading-day history into an earliest
 * train/dev set (~70%) and a most-recent out-of-sample test set (~30%).
 *
 * `trainDates` and `testDates` are chronologically sorted, disjoint, and their
 * concatenation is the sorted de-duplicated history (no shuffling). Every train
 * date strictly precedes every test date, so `trainEnd < testStart` whenever
 * both partitions are non-empty.
 */
export interface DataSplit {
  /** Last (latest) date in the train/dev partition; `null` if train is empty. */
  readonly trainEnd: TradingDate | null;
  /** First (earliest) date in the test partition; `null` if test is empty. */
  readonly testStart: TradingDate | null;
  /** Earliest ~70% of history, chronologically ordered. */
  readonly trainDates: readonly TradingDate[];
  /** Most-recent ~30% of history, chronologically ordered. */
  readonly testDates: readonly TradingDate[];
}

/**
 * Compute the chronological Data_Split of `history`.
 *
 * The history is first sorted chronologically and de-duplicated so the split is
 * well-defined and independent of the caller's ordering (no shuffling). The
 * earliest `floor(0.7 * n)` days form the train/dev partition and the remaining
 * most-recent days form the out-of-sample test partition. Because the split is
 * a prefix/suffix cut of a chronologically sorted list, every train date is
 * strictly earlier than every test date.
 *
 * Pure and deterministic: identical inputs always produce identical splits.
 */
export function chronologicalSplit(
  history: readonly TradingDate[],
): DataSplit {
  // Sort chronologically and de-duplicate for a deterministic prefix/suffix cut.
  const sorted = [...history].sort(compareTradingDates);
  const days: TradingDate[] = [];
  for (const d of sorted) {
    if (days[days.length - 1] !== d) {
      days.push(d);
    }
  }

  const trainCount = Math.floor(days.length * TRAIN_FRACTION);
  const trainDates = days.slice(0, trainCount);
  const testDates = days.slice(trainCount);

  return {
    trainEnd: trainDates.length > 0 ? (trainDates[trainDates.length - 1] as TradingDate) : null,
    testStart: testDates.length > 0 ? (testDates[0] as TradingDate) : null,
    trainDates,
    testDates,
  };
}
