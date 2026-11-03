// Unit tests for the v4 / v5 schema gate in `parseSnapshot` (multi-strategy-confluence-engine
// Requirements 11.11, 11.12, 13.9).
//
// The confluence slice is the sole STRICTLY-parsed slice and it is gated on the DECLARED
// `schemaVersion`:
//   - a pre-v5 document (v4, or no `schemaVersion` at all → treated as 0 < 5) is parsed
//     leniently and DEFAULTS the absent confluence slice to `EMPTY_CONFLUENCE`,
//   - a document that DECLARES v5+ MUST carry a well-formed confluence slice; a missing or
//     defective slice throws the one fixed, non-secret `SnapshotError` and yields NO partial
//     snapshot.
//
// These cover both sides of that gate: the lenient pre-v5 default and the strict v5 throw.

import { describe, expect, it } from "vitest";

import { EMPTY_CONFLUENCE, parseSnapshot, SnapshotError } from "./snapshot";
import type { Confluence } from "./types";

/** The fixed, non-secret message every declared-v5 confluence defect surfaces as. */
const CONFLUENCE_ERROR_MESSAGE = "The dashboard snapshot has an invalid confluence slice.";

/**
 * A well-formed confluence slice carrying one Pair with all six cells in `STRATEGY_IDS`
 * order, a `CONFLICT_FLAT` status with a non-empty `opposingStrategyIds`, and a mix of
 * available / unavailable cells. Exercises the full strict-parse happy path.
 */
const VALID_CONFLUENCE: Confluence = {
  validationLabel: "unvalidated",
  weights: { trend: 1, breakout: 1, range: 1, reversal: 1, custom_pattern: 1, third_party: 0 },
  conflictThreshold: 0.6,
  alignmentThreshold: 0.4,
  pairs: [
    {
      pair: "EURUSD",
      score: -0.1,
      status: "CONFLICT_FLAT",
      opposingStrategyIds: ["trend", "reversal"],
      cells: [
        { strategyId: "trend", available: true, direction: "UP", strength: 0.7, rationale: "uptrend" },
        { strategyId: "breakout", available: true, direction: "FLAT", strength: 0.1, rationale: "range-bound" },
        { strategyId: "range", available: false, reason: "insufficient candles" },
        { strategyId: "reversal", available: true, direction: "DOWN", strength: 0.6, rationale: "exhaustion" },
        { strategyId: "custom_pattern", available: false, reason: "no pattern matched" },
        { strategyId: "third_party", available: false, reason: "provider unavailable" },
      ],
    },
  ],
};

/** A minimal declared-v5 body with a well-formed confluence slice. */
function v5Body(confluence: unknown): Record<string, unknown> {
  return { schemaVersion: 5, decisionDate: "2024-03-15", generatedAt: "t", confluence };
}

describe("parseSnapshot — v4 / v5 confluence schema gate (R11.11, R11.12, R13.9)", () => {
  it("defaults the confluence slice to EMPTY_CONFLUENCE for a v4 document with no slice", () => {
    const v4 = { schemaVersion: 4, decisionDate: "2024-03-15", generatedAt: "t" };

    const parsed = parseSnapshot(v4);

    expect(parsed.confluence).toEqual(EMPTY_CONFLUENCE);
  });

  it("parses a valid v5 document and carries the confluence slice through verbatim", () => {
    const parsed = parseSnapshot(v5Body(VALID_CONFLUENCE));

    expect(parsed.schemaVersion).toBe(5);
    expect(parsed.confluence).toEqual(VALID_CONFLUENCE);
  });

  it("defaults the confluence slice when the document declares no schemaVersion (treated as 0 < 5)", () => {
    const noVersion = { decisionDate: "2024-03-15", generatedAt: "t" };

    const parsed = parseSnapshot(noVersion);

    expect(parsed.confluence).toEqual(EMPTY_CONFLUENCE);
  });

  it("throws SnapshotError when a declared-v5 document is MISSING the confluence slice", () => {
    const missing = { schemaVersion: 5, decisionDate: "2024-03-15", generatedAt: "t" };

    expect(() => parseSnapshot(missing)).toThrow(SnapshotError);
    expect(() => parseSnapshot(missing)).toThrow(CONFLUENCE_ERROR_MESSAGE);
  });

  it("throws SnapshotError when a declared-v5 confluence slice is DEFECTIVE (non-finite weight)", () => {
    const defective: Confluence = {
      ...VALID_CONFLUENCE,
      weights: { ...VALID_CONFLUENCE.weights, trend: Number.POSITIVE_INFINITY },
    };

    expect(() => parseSnapshot(v5Body(defective))).toThrow(SnapshotError);
    expect(() => parseSnapshot(v5Body(defective))).toThrow(CONFLUENCE_ERROR_MESSAGE);
  });
});
