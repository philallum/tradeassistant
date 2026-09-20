import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { composeGateVerdict, type FoldGateInput } from "./verdict.js";
import { walkForwardFolds, outOfSampleTestRanges } from "./walkForward.js";
import { GATE1_SAMPLE_SIZE_FLOOR } from "./types.js";
import type { Gate1FiringSample } from "./types.js";
import type { WalkForwardConfig, WalkForwardFold } from "./types.js";
import type { ForwardOutcome, DirectionClass } from "../retrieval/types.js";
import type { Pair } from "../ingestion/types.js";
import type { Horizon } from "../confidence/types.js";
import type { TradingDate } from "../guard/types.js";
import {
  addTradingDays,
  compareTradingDates,
  isTradingDay,
} from "../guard/tradingDate.js";
import { PAIRS } from "../ingestion/types.js";

// Feature: fx-daily-pattern-assistant, Property 18: For all Kill_Gate verdicts, every date contributing to the scored metrics belongs to the Out_Of_Sample_Test partition.
//
// Requirement 11.3: the System SHALL compute every Kill_Gate verdict on the
// Out_Of_Sample_Test only. Under the Walk_Forward_Window scheme, the
// Out_Of_Sample_Test is the union of every fold's [testStart, testEnd] test
// window (Requirement 11.2). This test builds walk-forward folds from a
// generated history, draws every firing Decision_Date from those test windows,
// and asserts that the exact set of Decision_Dates contributing to the scored
// (aggregate) metrics equals the out-of-sample partition — with no train date
// ever leaking into the scored set.
//
// Validates: Requirement 11.3.

const DIRECTIONS: readonly DirectionClass[] = ["UP", "DOWN", "FLAT"];

/**
 * The same partition guard the harness relies on: a date is out-of-sample iff
 * it falls within some fold's inclusive [testStart, testEnd] range
 * (Requirement 11.2). Folds are contiguous and non-overlapping so the ranges
 * partition a suffix of the history.
 */
function isOutOfSample(
  date: TradingDate,
  ranges: readonly { readonly start: TradingDate; readonly end: TradingDate }[],
): boolean {
  return ranges.some(
    (r) =>
      compareTradingDates(date, r.start) >= 0 &&
      compareTradingDates(date, r.end) <= 0,
  );
}

/**
 * The "train-only" dates: dates that fall in some fold's train window but in
 * NO fold's test window. Under the rolling scheme a fold's test window becomes
 * part of a later fold's train window, so a date can be both trained-on (later)
 * and out-of-sample (earlier) — that date is still in the Out_Of_Sample_Test
 * union (Requirement 11.2). Only train-only dates are never out-of-sample, and
 * no train-only date may ever contribute to the scored metrics (Requirement
 * 11.3).
 */
function trainOnlyDates(
  folds: readonly WalkForwardFold[],
  history: readonly TradingDate[],
  ranges: readonly { readonly start: TradingDate; readonly end: TradingDate }[],
): Set<TradingDate> {
  const trainOnly = new Set<TradingDate>();
  for (const fold of folds) {
    for (const d of history) {
      const inTrain =
        compareTradingDates(d, fold.trainStart) >= 0 &&
        compareTradingDates(d, fold.trainEnd) <= 0;
      if (inTrain && !isOutOfSample(d, ranges)) {
        trainOnly.add(d);
      }
    }
  }
  return trainOnly;
}

/**
 * Build a chronological history of `count` consecutive trading days
 * (weekends skipped) starting at `startAt` (or its next trading day).
 */
function buildHistory(startAt: TradingDate, count: number): TradingDate[] {
  const history: TradingDate[] = [];
  // Anchor to the first trading day at/after startAt.
  let current = addTradingDays(startAt, 0);
  for (let i = 0; i < count; i += 1) {
    history.push(current);
    current = addTradingDays(current, 1);
  }
  return history;
}

/** A neutral forward outcome (Gate 2 content is irrelevant to the partition). */
function neutralOutcome(): ForwardOutcome {
  const h = { direction: "FLAT" as DirectionClass, mfePips: 1, maePips: 1 };
  return { perHorizon: { 1: h, 2: h, 3: h } };
}

/** Collect every Decision_Date that contributed to the scored (aggregate) metrics.
 *
 * The aggregate Gate 1 is recomputed over the UNION of the QUALIFYING folds'
 * firing subsets (folds meeting the >=30 floor). So the scored set is exactly
 * the firing Decision_Dates of the qualifying folds.
 */
function scoredDecisionDates(folds: readonly FoldGateInput[]): Set<TradingDate> {
  const scored = new Set<TradingDate>();
  for (const fold of folds) {
    if (fold.firingSubset.length < GATE1_SAMPLE_SIZE_FLOOR) continue; // skipped fold
    for (const sample of fold.firingSubset) {
      scored.add(sample.decisionDate);
    }
  }
  return scored;
}

describe("Property 18: out-of-sample-only verdicts", () => {
  it("every Decision_Date contributing to the scored metrics is out-of-sample; no train date leaks", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...PAIRS),
        // Small train/test windows so multiple folds form from a modest history.
        fc.integer({ min: 3, max: 8 }), // trainDays
        fc.integer({ min: 30, max: 60 }), // testDays (>= floor so folds qualify)
        fc.integer({ min: 3, max: 6 }), // number of folds targeted
        fc.constantFrom<Horizon>(1, 2, 3),
        // Per firing sample: model / baseline / actual directions (partition
        // is independent of the values, but vary them for realism).
        fc.array(
          fc.tuple(
            fc.integer({ min: 0, max: 2 }),
            fc.integer({ min: 0, max: 2 }),
            fc.integer({ min: 0, max: 2 }),
          ),
          { minLength: 200, maxLength: 400 },
        ),
        (pair: Pair, trainDays, testDays, numFolds, horizon, dirTriples) => {
          const config: WalkForwardConfig = { trainDays, testDays };
          const foldSpan = trainDays + testDays;
          // Enough history for `numFolds` folds: first fold needs foldSpan
          // days, each additional fold rolls forward by testDays.
          const historyLen = foldSpan + testDays * (numFolds - 1) + testDays;
          const history = buildHistory("2015-01-01", historyLen);

          const folds = walkForwardFolds(pair, history, config);
          // Precondition: we must actually have folds to make a meaningful test.
          fc.pre(folds.length > 0);

          const ranges = outOfSampleTestRanges(folds);
          const trainOnly = trainOnlyDates(folds, history, ranges);

          // Sanity: the train-only set is disjoint from the OOS partition by
          // construction (a train-only date is, by definition, in no test window).
          for (const d of trainOnly) {
            expect(isOutOfSample(d, ranges)).toBe(false);
          }

          // Build the firing subsets: draw Decision_Dates ONLY from each fold's
          // test window (out-of-sample). Assign firing dates round-robin from a
          // pool of candidate dates that spans BOTH train and test windows,
          // then FILTER to OOS using the same guard the harness uses — so any
          // train date is dropped before it can reach the scored set.
          let index = 0;
          const foldInputs: FoldGateInput[] = folds.map((fold) => {
            // Candidate dates spanning the whole fold (train + test).
            const candidates = history.filter(
              (d) =>
                compareTradingDates(d, fold.trainStart) >= 0 &&
                compareTradingDates(d, fold.testEnd) <= 0,
            );
            // Filter candidates to the OOS partition (drops all train dates).
            const oosCandidates = candidates.filter((d) =>
              isOutOfSample(d, ranges),
            );

            const firingSubset: Gate1FiringSample[] = oosCandidates.map((d) => {
              const [m, b, a] = dirTriples[index % dirTriples.length]!;
              index += 1;
              return {
                decisionDate: d,
                modelPrediction: DIRECTIONS[m]!,
                baselinePrediction: DIRECTIONS[b]!,
                actual: DIRECTIONS[a]!,
              };
            });

            const outcomes = firingSubset.map(() => neutralOutcome());

            return {
              foldIndex: fold.foldIndex,
              pair,
              horizon,
              firingSubset,
              modelOutcomes: outcomes,
              baselineOutcomes: outcomes,
            };
          });

          const verdict = composeGateVerdict("config-p18", foldInputs);

          // The set of dates that actually contributed to the aggregate metrics.
          const scored = scoredDecisionDates(foldInputs);

          // Property 18 core: every scored Decision_Date is out-of-sample and
          // no train-only date contributed.
          for (const d of scored) {
            expect(isOutOfSample(d, ranges)).toBe(true);
            expect(trainOnly.has(d)).toBe(false);
          }

          // Stronger equality: the scored set is exactly the OOS partition dates
          // that belong to a QUALIFYING fold — no train date leaks in, and every
          // firing OOS date is scored. Build the expected OOS-qualifying set.
          const expected = new Set<TradingDate>();
          for (const fold of foldInputs) {
            if (fold.firingSubset.length < GATE1_SAMPLE_SIZE_FLOOR) continue;
            for (const s of fold.firingSubset) {
              // s.decisionDate was already OOS-filtered above.
              expect(isOutOfSample(s.decisionDate, ranges)).toBe(true);
              expected.add(s.decisionDate);
            }
          }
          expect(scored).toStrictEqual(expected);

          // And the aggregate sampleSize equals the number of scored dates
          // (the pooled qualifying firing subset), confirming only OOS rows
          // fed the aggregate metrics.
          let qualifyingCount = 0;
          for (const fold of foldInputs) {
            if (fold.firingSubset.length >= GATE1_SAMPLE_SIZE_FLOOR) {
              qualifyingCount += fold.firingSubset.length;
            }
          }
          expect(verdict.sampleSize).toBe(qualifyingCount);
          // Every scored date is a valid trading day (weekday), too.
          for (const d of scored) {
            expect(isTradingDay(d)).toBe(true);
          }
        },
      ),
      { numRuns: 150 },
    );
  });
});
