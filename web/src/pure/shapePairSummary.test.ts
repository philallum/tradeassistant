import { describe, expect, it } from "vitest";

import type { FiringSetupRow, PairEvaluationRow, TrackRecord } from "../api/types";
import { EMPTY_TRACK_RECORD } from "../api/snapshot";
import { shapePairSummary } from "./shapePairSummary";
import { shapeSystemRecord } from "./shapeSystemRecord";

const DATE = "2024-03-15";
const evalRow = (over: Partial<PairEvaluationRow> = {}): PairEvaluationRow => ({
  decision_date: DATE,
  pair: "EURUSD",
  direction: "UP",
  horizon: 1,
  earned_confidence: 0.571,
  fired: true,
  choppiness: 0.4,
  expected_range: { bucket: "MEDIUM", horizon: 1, low_pips: 60.2, high_pips: 95.4, sample_size: 44 },
  ...over,
});
const firing = (over: Partial<FiringSetupRow> = {}): FiringSetupRow => ({
  decision_date: DATE,
  pair: "EURUSD",
  strategy_id: "system",
  direction: "UP",
  horizon: 1,
  earned_confidence: 0.571,
  stop_loss_pips: 30,
  take_profit_pips: 45,
  surfaced: true,
  suppression_reason: null,
  ...over,
});

describe("shapePairSummary", () => {
  it("states the pattern call and never exposes stop-loss, take-profit or expectancy", () => {
    const vm = shapePairSummary("EURUSD", [evalRow()], [firing()], DATE, EMPTY_TRACK_RECORD);
    expect(vm.pattern).toMatchObject({ fired: true, direction: "UP", horizon: 1 });
    expect(vm.pattern.text).toBe("Pattern engine fired: Up, 57% confidence, 1 day horizon.");
    expect(JSON.stringify(vm)).not.toMatch(/stop|take.?profit|expectancy|30|45/i);
  });

  it("a pair that did not fire says so", () => {
    const vm = shapePairSummary("EURUSD", [evalRow({ fired: false })], [], DATE, EMPTY_TRACK_RECORD);
    expect(vm.pattern).toMatchObject({ fired: false, direction: null });
    expect(vm.pattern.text).toBe("Pattern engine did not fire for this pair.");
  });

  it("an unsurfaced firing row is not a fired pattern", () => {
    const vm = shapePairSummary("EURUSD", [evalRow()], [firing({ surfaced: false })], DATE, EMPTY_TRACK_RECORD);
    expect(vm.pattern.fired).toBe(false);
  });

  it("describes the candle size as a bucket plus a pips range, with its track record", () => {
    const track: TrackRecord = {
      lookbackDays: 60,
      strategies: [],
      rangeForecast: [{ pair: "EURUSD", forecasts: 18, correct: 11 }],
    };
    const { candleSize } = shapePairSummary("EURUSD", [evalRow()], [], DATE, track);
    expect(candleSize).toMatchObject({
      available: true,
      headline: "Medium candle",
      rangeText: "About 60.2\u201395.4 pips over 1 day.",
      recordText: "Forecast right 11 of 18 recent days.",
      smallSample: false,
    });
  });

  it("says plainly when the pair was not forecast, and never invents a size", () => {
    const row = evalRow();
    const { expected_range: _drop, ...noRange } = row;
    void _drop;
    const { candleSize } = shapePairSummary("EURUSD", [noRange], [], DATE, EMPTY_TRACK_RECORD);
    expect(candleSize).toMatchObject({ available: false, headline: "Not forecast" });
    expect(candleSize.recordText).toBe("Forecast record not measured.");
    expect(candleSize.smallSample).toBe(true);
  });

  it("only reads the selected pair and date", () => {
    const vm = shapePairSummary(
      "EURUSD",
      [evalRow({ pair: "GBPUSD" }), evalRow({ decision_date: "2024-03-14" })],
      [],
      DATE,
      EMPTY_TRACK_RECORD,
    );
    expect(vm.candleSize.available).toBe(false);
  });
});

describe("shapeSystemRecord", () => {
  const report = {
    config_id: "c",
    split_test_start: "2020-01-01",
    split_test_end: "2024-01-01",
    sample_size: 30000,
    predictions_count: 28470,
    model_accuracy: 0.4996,
    baseline_accuracy: 0.4871,
    delta_vs_baseline: 0.0125,
  };

  it("states right-vs-naive over n forecasts and warns when the lead is small", () => {
    const vm = shapeSystemRecord(report);
    expect(vm.text).toBe("System record: 50.0% right vs 48.7% naive over 28,470 forecasts.");
    expect(vm.caution).toMatch(/roughly level/);
  });

  it("does not warn about a lead of 3 points or more", () => {
    expect(shapeSystemRecord({ ...report, model_accuracy: 0.56 }).caution).toBeNull();
  });

  it("says 'not measured yet' with no report", () => {
    expect(shapeSystemRecord(null)).toEqual({
      available: false,
      text: "System record: not measured yet.",
      caution: null,
    });
  });
});
