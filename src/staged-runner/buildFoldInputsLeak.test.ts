// REGRESSION GUARD — look-ahead leak in buildFoldInputs is FIXED
// (simplify-to-cloud-minimal, task 8.1 research-integrity).
//
// This file previously CHARACTERIZED a look-ahead leak: `buildFoldInputs`
// (src/staged-runner/stagedRunner.ts) set each fold's `modelPrediction` to
// `outcome.direction` — the SAME matured forward-outcome direction it is then
// scored against in Gate 1 — making the model's directional accuracy a
// tautological 1.0, and it built the model & baseline ForwardOutcomes from the
// SAME `outcome.mfePips`/`outcome.maePips` (so model/baseline excursions were
// byte-identical).
//
// The fix sources the model's directional prediction HONESTLY from the Analogue_
// Neighborhood retrieved AS OF the Decision_Date (exactly as the live daily
// pipeline does), never from that date's matured outcome. This file now PINS the
// fixed behaviour so the leak cannot silently return:
//
//   - with a constructed-disagreement fixture (stored weeklyTrendSign="UP",
//     matured outcome direction="DOWN", and a retrieval neighborhood that points
//     UP — NOT unanimously to the realized "DOWN"), the model prediction is NOT
//     forced equal to `actual`; it tracks the neighborhood (UP), so it DIFFERS
//     from the realized outcome;
//   - the model and baseline ForwardOutcome excursions are NOT byte-identical by
//     construction (the model's excursions come from its retrieved neighborhood,
//     the baseline's from the realized outcome);
//   - the model's Earned_Confidence is populated on the firing sample so the
//     Evaluation_Report's strengthBreakdown can bucket it.
//
// Validates: Requirement 9.1 (research-integrity layer intact — the look-ahead
// guard actually covers the evaluation fold-construction path).

import { describe, expect, it } from "vitest";
import type { Candle, TradingDate } from "../guard/types.js";
import type { AnalogueRecord } from "../retrieval/types.js";
import { addTradingDays } from "../guard/tradingDate.js";
import {
  DEFAULT_WALK_FORWARD_CONFIG,
  GATE1_SAMPLE_SIZE_FLOOR,
} from "../kill-gate/types.js";
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

describe("buildFoldInputs — look-ahead leak regression guard (task 8.1)", () => {
  it("sources the model prediction from the retrieval neighborhood, NOT the matured outcome", async () => {
    const deps = makeTestDeps();

    // One full default fold needs trainDays + testDays trading days of history.
    const { trainDays, testDays } = DEFAULT_WALK_FORWARD_CONFIG;
    const history = tradingDays("2015-01-01", trainDays + testDays);

    // Seed candles for the whole history so walkForwardFolds forms exactly one
    // fold with a populated test window.
    await deps.candleStore.upsertCandles(history.map(candleOn));

    const trainWindow = history.slice(0, trainDays);
    const testWindow = history.slice(trainDays);
    expect(testWindow.length).toBe(testDays);

    // All stored vectors share ONE embedding + weeklyTrendSign="UP" so the
    // retrieval query (a firing date's own vector) matches every seeded vector
    // at cosine distance 0 (within the default epsilon). The weeklyTrendSign
    // "UP" also drives the baseline prediction to UP.
    const upVector = makeStoredVector("UP");

    // PRIOR UP ANALOGUES: seed matured UP outcomes across the ENTIRE train
    // window (756 dates). These are the neighborhood the model retrieves for any
    // test-window Decision_Date. Because every stored vector is at distance 0,
    // retrieval orders by date ascending and takes the earliest `k` (default
    // 200) — all of which are these EARLY train-window UP analogues, so the
    // model's dominant direction is UP regardless of the later DOWN firing dates.
    for (const date of trainWindow) {
      await deps.vectorStore.upsertVector(PAIR, date, upVector);
      const upAnalogue: AnalogueRecord = {
        asset: PAIR,
        decisionDate: date,
        horizon: 1,
        direction: "UP",
        mfePips: 30,
        maePips: 12,
        atr14: 15,
        matured: true,
      };
      await deps.analogueStore.upsertOutcome(upAnalogue);
    }

    // CONSTRUCTED DISAGREEMENT: the first `GATE1_SAMPLE_SIZE_FLOOR + 5`
    // test-window dates each get a stored vector (weeklyTrendSign="UP" → baseline
    // predicts UP) and a MATURED analogue outcome whose direction is "DOWN" — the
    // OPPOSITE of what the UP neighborhood points to. An honest model therefore
    // predicts UP and DISAGREES with the realized "DOWN"; a leaking model would
    // echo "DOWN".
    const firingDates = testWindow.slice(0, GATE1_SAMPLE_SIZE_FLOOR + 5);
    for (const date of firingDates) {
      await deps.vectorStore.upsertVector(PAIR, date, upVector);
      const realized: AnalogueRecord = {
        asset: PAIR,
        decisionDate: date,
        horizon: 1,
        direction: "DOWN", // the realized outcome being scored against
        mfePips: 42, // deliberately DIFFERENT from the UP analogues' 30/12
        maePips: 7,
        atr14: 15,
        matured: true,
      };
      await deps.analogueStore.upsertOutcome(realized);
    }

    const { foldInputs } = await buildFoldInputs(deps);

    // Exactly one populated fold for the pair.
    const populated = foldInputs.filter((f) => f.firingSubset.length > 0);
    expect(populated.length).toBe(1);
    const fold = populated[0]!;
    expect(fold.firingSubset.length).toBe(firingDates.length);

    // FIX SIGNATURE 1: the model prediction is sourced from the neighborhood
    // (UP), so it is NOT forced equal to the realized "DOWN" outcome. The leak
    // (modelPrediction === actual on every date) is gone.
    for (const sample of fold.firingSubset) {
      expect(sample.actual).toBe("DOWN");
      expect(sample.baselinePrediction).toBe("UP");
      // The honest model follows the UP neighborhood and DIFFERS from `actual`.
      expect(sample.modelPrediction).toBe("UP");
      expect(sample.modelPrediction).not.toBe(sample.actual);
      // The Earned_Confidence is populated so strengthBreakdown can bucket it.
      expect(sample.confidence).toBeTypeOf("number");
      expect(sample.confidence).toBeGreaterThanOrEqual(0);
      expect(sample.confidence).toBeLessThanOrEqual(1);
    }

    // FIX SIGNATURE 2: model and baseline ForwardOutcome excursions are NOT
    // byte-identical. The model's come from its retrieved UP neighborhood
    // (mean 30/12), the baseline's from the realized outcome (42/7).
    for (let i = 0; i < fold.modelOutcomes.length; i += 1) {
      const m = fold.modelOutcomes[i]!.perHorizon[1];
      const b = fold.baselineOutcomes[i]!.perHorizon[1];
      const identical = m.mfePips === b.mfePips && m.maePips === b.maePips;
      expect(identical).toBe(false);
    }
  });
});
