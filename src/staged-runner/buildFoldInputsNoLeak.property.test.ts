// Property guard — buildFoldInputs sources the model prediction HONESTLY, so
// there is NO construction path that makes it a copy of the per-date realized
// outcome (simplify-to-cloud-minimal, task 8.1 research-integrity).
//
// The former leak set `modelPrediction = outcome.direction`, which forced a
// tautological directional accuracy of 1.0: whatever the realized outcome was,
// the "model" echoed it. This property drives the REAL `buildFoldInputs` (not
// hand-built fold inputs) over randomized realized-outcome directions while
// pinning the retrieved Analogue_Neighborhood to a known dominant direction
// (UP), and asserts:
//
//   1. every firing sample's `modelPrediction` equals the NEIGHBORHOOD's
//      dominant direction (UP) — a value derived without seeing the scored
//      outcome — and is INDEPENDENT of the per-date realized `actual`. A model
//      that cannot see the outcome cannot echo it, so the tautological
//      "modelPrediction === actual on every date" signature cannot arise;
//   2. whenever at least one realized outcome is NOT UP, the model does NOT
//      agree with `actual` on every date (directional accuracy is not forced to
//      1.0);
//   3. every firing sample carries a populated Earned_Confidence so the
//      Evaluation_Report's strengthBreakdown can bucket it.
//
// Validates: Requirement 9.1 (research-integrity layer intact — the evaluation
// fold-construction path is look-ahead safe).

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import type { Candle, TradingDate } from "../guard/types.js";
import type { AnalogueRecord, DirectionClass } from "../retrieval/types.js";
import { addTradingDays } from "../guard/tradingDate.js";
import { DEFAULT_WALK_FORWARD_CONFIG } from "../kill-gate/types.js";
import { buildFoldInputs } from "./stagedRunner.js";
import { makeStoredVector, makeTestDeps } from "./testHelpers.js";

const PAIR = "EURUSD" as const;

/** A chronological run of `count` trading days (weekends skipped) from `start`. */
function tradingDays(start: TradingDate, count: number): TradingDate[] {
  const days: TradingDate[] = [];
  let current = addTradingDays(start, 0);
  for (let i = 0; i < count; i += 1) {
    days.push(current);
    current = addTradingDays(current, 1);
  }
  return days;
}

/** A trivially-valid candle on `date` for the pair. */
function candleOn(date: TradingDate): Candle {
  return {
    asset: PAIR,
    date,
    open: 1.1,
    high: 1.11,
    low: 1.09,
    close: 1.105,
    source: "test",
  };
}

const { trainDays, testDays } = DEFAULT_WALK_FORWARD_CONFIG;
// The default k=200 nearest. Seeding at least this many EARLY (train-window) UP
// analogues — all at cosine distance 0 to the query — guarantees the retrieved
// top-k is entirely UP, since the later DOWN firing dates sort after them.
const UP_ANALOGUE_BLOCK = 210;

describe("buildFoldInputs — model prediction is honest, never a copy of the outcome (task 8.1)", () => {
  it(
    "model prediction tracks the retrieved neighborhood (UP), independent of the randomized realized outcome",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          // A randomized sequence of realized outcome directions for the firing
          // dates — at least one must be non-UP so an honest model (predicting
          // UP from the neighborhood) genuinely disagrees somewhere.
          fc
            .array(fc.constantFrom<DirectionClass>("UP", "DOWN", "FLAT"), {
              minLength: 32,
              maxLength: 45,
            })
            .filter((dirs) => dirs.some((d) => d !== "UP")),
          async (realizedDirections) => {
            const deps = makeTestDeps();

            const history = tradingDays("2015-01-01", trainDays + testDays);
            await deps.candleStore.upsertCandles(history.map(candleOn));

            const trainWindow = history.slice(0, trainDays);
            const testWindow = history.slice(trainDays);

            // One shared embedding (distance 0 for every pair) + weeklyTrendSign
            // "UP" (so the baseline predicts UP and the query matches on the
            // metadata pre-filter).
            const upVector = makeStoredVector("UP");

            // Seed the EARLY UP-analogue block: matured UP outcomes on the first
            // UP_ANALOGUE_BLOCK train-window dates. These dominate the retrieved
            // top-k for every later Decision_Date, so the model's dominant
            // direction is UP.
            for (const date of trainWindow.slice(0, UP_ANALOGUE_BLOCK)) {
              await deps.vectorStore.upsertVector(PAIR, date, upVector);
              const analogue: AnalogueRecord = {
                asset: PAIR,
                decisionDate: date,
                horizon: 1,
                direction: "UP",
                mfePips: 30,
                maePips: 12,
                atr14: 15,
                matured: true,
              };
              await deps.analogueStore.upsertOutcome(analogue);
            }

            // Seed the firing dates with the RANDOMIZED realized outcomes. Each
            // gets a stored vector so retrieval has a query and the baseline a
            // weekly-trend sign.
            const firingDates = testWindow.slice(0, realizedDirections.length);
            for (let i = 0; i < firingDates.length; i += 1) {
              const date = firingDates[i]!;
              await deps.vectorStore.upsertVector(PAIR, date, upVector);
              const realized: AnalogueRecord = {
                asset: PAIR,
                decisionDate: date,
                horizon: 1,
                direction: realizedDirections[i]!,
                mfePips: 42,
                maePips: 7,
                atr14: 15,
                matured: true,
              };
              await deps.analogueStore.upsertOutcome(realized);
            }

            const { foldInputs } = await buildFoldInputs(deps);
            const populated = foldInputs.filter((f) => f.firingSubset.length > 0);
            expect(populated.length).toBe(1);
            const fold = populated[0]!;

            // The honest model fires on EVERY firing date (the neighborhood is
            // unanimously UP, well above the directional floor), so the firing
            // subset covers all firing dates.
            expect(fold.firingSubset.length).toBe(firingDates.length);

            let modelMatchesActualEverywhere = true;
            for (const sample of fold.firingSubset) {
              // (1) The model prediction is the neighborhood's dominant
              // direction (UP) — NOT a copy of the realized outcome.
              expect(sample.modelPrediction).toBe("UP");
              // (3) Earned_Confidence populated for strengthBreakdown bucketing.
              expect(sample.confidence).toBeTypeOf("number");
              if (sample.modelPrediction !== sample.actual) {
                modelMatchesActualEverywhere = false;
              }
            }

            // (2) Because at least one realized outcome is non-UP, the model
            // does NOT agree with `actual` on every date — the tautological 1.0
            // accuracy signature is impossible.
            expect(modelMatchesActualEverywhere).toBe(false);
          },
        ),
        { numRuns: 20 },
      );
    },
  );
});
