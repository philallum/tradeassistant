// Schema v7: the `signalScorecard` slice — the RECORDED per-signal direction ledger. Parsed
// LENIENTLY: a missing or malformed slice degrades to the empty record (never throws, never
// fabricates), and defective rows are dropped.
import { describe, expect, it } from "vitest";

import { EMPTY_SIGNAL_SCORECARD, SNAPSHOT_SCHEMA_VERSION, parseSignalScorecard, parseSnapshot } from "./snapshot";

const GOOD = {
  totalRecorded: 3,
  rows: [
    { pair: "EURUSD", strategyId: "trend", calls: 2, correct: 1, flat: 0, pending: 1 },
    { pair: "USDJPY", strategyId: "third_party", calls: 1, correct: 1, flat: 0, pending: 0 },
  ],
};

describe("parseSignalScorecard", () => {
  it("the current schema version is v7", () => {
    expect(SNAPSHOT_SCHEMA_VERSION).toBe(7);
  });

  it("passes a well-formed slice through", () => {
    expect(parseSignalScorecard(GOOD)).toEqual(GOOD);
  });

  it("defaults an absent or non-object slice to the empty record", () => {
    for (const v of [undefined, null, 7, "x", []]) {
      expect(parseSignalScorecard(v)).toEqual(EMPTY_SIGNAL_SCORECARD);
    }
  });

  it("drops defective rows instead of fabricating or throwing", () => {
    const parsed = parseSignalScorecard({
      totalRecorded: 2,
      rows: [
        { pair: "EURUSD", strategyId: "trend", calls: 2, correct: 1, flat: 0, pending: 0 }, // good
        { pair: "EURUSD", strategyId: "trend", calls: 1, correct: 2, flat: 0, pending: 0 }, // correct > calls
        { pair: "EURUSD", strategyId: "nope", calls: 1, correct: 0, flat: 0, pending: 0 }, // bad strategy id
      ],
    });
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.totalRecorded).toBe(2);
  });
});

describe("parseSnapshot — v7 slice", () => {
  it("defaults signalScorecard for an older snapshot and carries it for a v7 one", () => {
    expect(
      parseSnapshot({ schemaVersion: 4, decisionDate: "d", generatedAt: "t" }).signalScorecard,
    ).toEqual(EMPTY_SIGNAL_SCORECARD);

    const v7 = parseSnapshot({
      schemaVersion: 7,
      decisionDate: "d",
      generatedAt: "t",
      confluence: {
        validationLabel: "unvalidated",
        weights: { trend: 1, breakout: 1, range: 1, reversal: 1, custom_pattern: 1, third_party: 0 },
        conflictThreshold: 0.5,
        alignmentThreshold: 0.4,
        pairs: [],
      },
      signalScorecard: GOOD,
    });
    expect(v7.signalScorecard).toEqual(GOOD);
  });

  it("a malformed signalScorecard on a v7 snapshot never fails the whole snapshot", () => {
    const parsed = parseSnapshot({
      schemaVersion: 7,
      decisionDate: "d",
      generatedAt: "t",
      confluence: {
        validationLabel: "unvalidated",
        weights: { trend: 1, breakout: 1, range: 1, reversal: 1, custom_pattern: 1, third_party: 0 },
        conflictThreshold: 0.5,
        alignmentThreshold: 0.4,
        pairs: [],
      },
      signalScorecard: "garbage",
    });
    expect(parsed.signalScorecard).toEqual(EMPTY_SIGNAL_SCORECARD);
  });
});
