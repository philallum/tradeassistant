// Tests for the v7 recorded signal-scorecard slice: aggregation of dated
// `signal_predictions` rows into per (pair, strategyId) tallies, and the
// fail-safe slice builder.

import { describe, expect, it } from "vitest";
import {
  InMemorySignalPredictionStore,
  aggregateSignalScorecard,
  type SignalPredictionRow,
  type SignalPredictionStore,
} from "../dashboard/signalScorecard.js";
import { EMPTY_SIGNAL_SCORECARD } from "./snapshot.js";
import { buildSignalScorecardSlice } from "./signalScorecardSlice.js";

function row(over: Partial<SignalPredictionRow>): SignalPredictionRow {
  return {
    decisionDate: "2026-11-04",
    pair: "EURUSD",
    strategyId: "trend",
    predictedDirection: "UP",
    realizedDirection: null,
    correct: null,
    ...over,
  };
}

describe("aggregateSignalScorecard", () => {
  it("tallies matured calls/correct, flat abstentions, and pending separately", () => {
    const rows: SignalPredictionRow[] = [
      // trend: one right UP, one wrong DOWN, one FLAT abstention, one still pending
      row({ decisionDate: "2026-11-01", predictedDirection: "UP", realizedDirection: "UP", correct: true }),
      row({ decisionDate: "2026-11-02", predictedDirection: "DOWN", realizedDirection: "UP", correct: false }),
      row({ decisionDate: "2026-11-03", predictedDirection: "FLAT", realizedDirection: "UP", correct: null }),
      row({ decisionDate: "2026-11-04", predictedDirection: "UP", realizedDirection: null, correct: null }),
      // third_party on another pair: one right call
      row({ pair: "USDJPY", strategyId: "third_party", decisionDate: "2026-11-01", realizedDirection: "UP", correct: true }),
    ];

    const agg = aggregateSignalScorecard(rows);
    expect(agg.totalRecorded).toBe(5);

    const trend = agg.tallies.find((t) => t.pair === "EURUSD" && t.strategyId === "trend");
    expect(trend).toEqual({ pair: "EURUSD", strategyId: "trend", calls: 2, correct: 1, flat: 1, pending: 1 });

    const third = agg.tallies.find((t) => t.pair === "USDJPY" && t.strategyId === "third_party");
    expect(third).toEqual({ pair: "USDJPY", strategyId: "third_party", calls: 1, correct: 1, flat: 0, pending: 0 });
  });

  it("returns an empty aggregate for no rows", () => {
    expect(aggregateSignalScorecard([])).toEqual({ totalRecorded: 0, tallies: [] });
  });
});

describe("buildSignalScorecardSlice", () => {
  it("maps the store's rows to the wire slice", async () => {
    const store = new InMemorySignalPredictionStore([
      row({ decisionDate: "2026-11-01", realizedDirection: "UP", correct: true }),
      row({ decisionDate: "2026-11-04", realizedDirection: null, correct: null }),
    ]);
    const slice = await buildSignalScorecardSlice({ store });
    expect(slice.totalRecorded).toBe(2);
    expect(slice.rows).toEqual([
      { pair: "EURUSD", strategyId: "trend", calls: 1, correct: 1, flat: 0, pending: 1 },
    ]);
  });

  it("degrades to the empty slice when the store throws", async () => {
    const throwingStore: SignalPredictionStore = {
      upsert: () => Promise.resolve(),
      getByDecisionDate: () => Promise.resolve([]),
      getOpen: () => Promise.resolve([]),
      getAll: () => Promise.reject(new Error("boom")),
    };
    const warnings: string[] = [];
    const slice = await buildSignalScorecardSlice({
      store: throwingStore,
      warn: (s) => warnings.push(s),
    });
    expect(slice).toEqual(EMPTY_SIGNAL_SCORECARD);
    expect(warnings).toContain("signal_scorecard");
  });
});
