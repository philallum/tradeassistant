// Schema v6: the optional `expected_range` on pair evaluations and the `trackRecord` slice.
// Both are display-only and parsed LENIENTLY: a missing or malformed slice degrades to its
// empty value (never throws, never fabricates), unlike the strictly-parsed confluence slice.
import { describe, expect, it } from "vitest";

import { EMPTY_TRACK_RECORD, SNAPSHOT_SCHEMA_VERSION, parseSnapshot, parseTrackRecord } from "./snapshot";

const GOOD = {
  lookbackDays: 60,
  strategies: [
    { pair: "EURUSD", strategyId: "trend", calls: 31, correct: 12 },
    { pair: "EURUSD", strategyId: "custom_pattern", calls: 8, correct: 5 },
  ],
  rangeForecast: [{ pair: "EURUSD", forecasts: 18, correct: 11 }],
};

describe("parseTrackRecord", () => {
  it("the current schema version is v8 (the trackRecord slice landed at v6 and still parses)", () => {
    expect(SNAPSHOT_SCHEMA_VERSION).toBe(9);
  });

  it("passes a well-formed slice through", () => {
    expect(parseTrackRecord(GOOD)).toEqual(GOOD);
  });

  it("defaults an absent or non-object slice to the empty record", () => {
    for (const v of [undefined, null, 7, "x", []]) {
      expect(parseTrackRecord(v)).toEqual(EMPTY_TRACK_RECORD);
    }
  });

  it("drops defective rows instead of fabricating or throwing", () => {
    const parsed = parseTrackRecord({
      lookbackDays: 60,
      strategies: [
        { pair: "EURUSD", strategyId: "trend", calls: 10, correct: 11 }, // correct > calls
        { pair: "EURUSD", strategyId: "nonsense", calls: 10, correct: 5 }, // unknown strategy
        { pair: "EURUSD", strategyId: "range", calls: -1, correct: 0 }, // negative
        { pair: "EURUSD", strategyId: "range", calls: 1.5, correct: 0 }, // non-integer
        { pair: "EURUSD", strategyId: "breakout", calls: 10, correct: 5 }, // good
      ],
      rangeForecast: [
        { pair: "EURUSD", forecasts: 3, correct: 4 },
        { pair: 5, forecasts: 3, correct: 1 },
        { pair: "GBPUSD", forecasts: 3, correct: 1 },
      ],
    });
    expect(parsed.strategies).toEqual([{ pair: "EURUSD", strategyId: "breakout", calls: 10, correct: 5 }]);
    expect(parsed.rangeForecast).toEqual([{ pair: "GBPUSD", forecasts: 3, correct: 1 }]);
  });

  it("treats a bad lookbackDays as 0", () => {
    expect(parseTrackRecord({ ...GOOD, lookbackDays: "60" }).lookbackDays).toBe(0);
  });
});

describe("parseSnapshot — v6 slices", () => {
  it("defaults trackRecord for an older snapshot and carries it for a v6 one", () => {
    expect(parseSnapshot({ schemaVersion: 4, decisionDate: "d", generatedAt: "t" }).trackRecord).toEqual(
      EMPTY_TRACK_RECORD,
    );
    const v6 = parseSnapshot({
      schemaVersion: 6,
      decisionDate: "d",
      generatedAt: "t",
      confluence: {
        validationLabel: "unvalidated",
        weights: { trend: 1, breakout: 1, range: 1, reversal: 1, custom_pattern: 1, third_party: 0 },
        conflictThreshold: 0.5,
        alignmentThreshold: 0.4,
        pairs: [],
      },
      trackRecord: GOOD,
    });
    expect(v6.trackRecord).toEqual(GOOD);
  });

  it("a malformed trackRecord on a v6 snapshot never fails the whole snapshot", () => {
    const parsed = parseSnapshot({
      schemaVersion: 6,
      decisionDate: "d",
      generatedAt: "t",
      confluence: {
        validationLabel: "unvalidated",
        weights: { trend: 1, breakout: 1, range: 1, reversal: 1, custom_pattern: 1, third_party: 0 },
        conflictThreshold: 0.5,
        alignmentThreshold: 0.4,
        pairs: [],
      },
      trackRecord: "garbage",
    });
    expect(parsed.trackRecord).toEqual(EMPTY_TRACK_RECORD);
  });

  it("passes through an expected_range on a pair-evaluation row", () => {
    const row = {
      decision_date: "d",
      pair: "EURUSD",
      direction: "UP",
      horizon: 1,
      earned_confidence: 0.6,
      fired: true,
      choppiness: 0.4,
      expected_range: { bucket: "LARGE", horizon: 1, low_pips: 70, high_pips: 110, sample_size: 44 },
    };
    const parsed = parseSnapshot({ schemaVersion: 4, decisionDate: "d", generatedAt: "t", pairEvaluations: [row] });
    expect(parsed.pairEvaluations[0]?.expected_range?.bucket).toBe("LARGE");
  });
});
