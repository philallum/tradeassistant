// Feature: multi-strategy-confluence-engine, Property 26: Snapshot slice
// invariants and serialization round trip.
//
// Validates: Requirements 11.2, 11.3, 11.4, 11.5, 11.6, 11.9, 11.10, 13.9.
//
// For any Confluence_Matrix, `toSnapshotConfluence` (src/scheduled-run/
// confluenceSlice.ts) must produce a wire slice that:
//   - carries the literal `validationLabel: "unvalidated"` (Requirement 11.6);
//   - copies the exact weights / conflict / alignment thresholds the engine used
//     (Requirement 11.5);
//   - has either zero or exactly five Pair entries, the five in `PAIRS` order
//     (Requirements 11.2, 11.9);
//   - gives each Pair exactly six cells in `STRATEGY_IDS` canonical order, each
//     cell either an available signal (direction + strength in [0,1] +
//     non-empty rationale) or an `unavailable` cell with a non-empty reason
//     (Requirement 11.2);
//   - has a score within [-1, 1] (Requirement 11.9);
//   - has a NON-empty `opposingStrategyIds` ONLY when the status is
//     `CONFLICT_FLAT` (Requirements 11.3, 11.4);
//   - admits NO provenance / LLM field (Requirement 11.10).
//
// It must also be a serialization fixed point: serialise → `JSON.parse` →
// serialise again yields an identical document, and the parsed value is deeply
// equal to the original slice (required by 13.9). The slice is serialised
// through the same `JSON.stringify(_, null, 2)` the production `serializeSnapshot`
// uses, carried inside the full `dashboard.json` envelope so the round trip
// reflects exactly how the slice ships.

import { describe, it, expect } from "vitest";
import fc from "fast-check";

import {
  buildConfluenceMatrix,
  createConfluenceEngine,
  createTrendStrategy,
  createBreakoutStrategy,
  createRangeStrategy,
  createReversalStrategy,
  STRATEGY_IDS,
  type ConfluenceEngine,
  type PairConfluenceInput,
  type StrategyBundle,
} from "../strategies/index.js";
import { PAIRS, type Pair } from "../ingestion/types.js";
import type { TradingDate } from "../guard/types.js";
import type { DirectionClass } from "../retrieval/types.js";
import type { Confidence } from "../confidence/types.js";
import {
  arbCandleSeries,
  arbWeights,
  arbThresholds,
} from "../strategies/testing/arbitraries.js";
import {
  REFERENCE_DIRECTIONS,
  type ExternalReferenceSignal,
} from "../external-signal/types.js";
import {
  buildDashboardSnapshot,
  serializeSnapshot,
  type SnapshotConfluenceSlice,
} from "./snapshot.js";
import { toSnapshotConfluence } from "./confluenceSlice.js";

// ---------------------------------------------------------------------------
// Real strategy bundle + engine helpers (shared across runs; the strategies are
// stateless pure evaluators). Reusing them keeps generation cheap.
// ---------------------------------------------------------------------------

/** Build the real four-strategy bundle with default configs. */
function buildRealBundle(): StrategyBundle {
  const trend = createTrendStrategy();
  const breakout = createBreakoutStrategy();
  const range = createRangeStrategy();
  const reversal = createReversalStrategy();
  if (!trend.ok || !breakout.ok || !range.ok || !reversal.ok) {
    throw new Error("default strategy factories must succeed");
  }
  return {
    trend: trend.value,
    breakout: breakout.value,
    range: range.value,
    reversal: reversal.value,
  };
}

const REAL_BUNDLE: StrategyBundle = buildRealBundle();

const DECISION_DATE = "2021-06-15" as TradingDate;

const directionArb: fc.Arbitrary<DirectionClass> = fc.constantFrom(
  "UP",
  "DOWN",
  "FLAT",
);
const confidenceArb: fc.Arbitrary<Confidence> = fc
  .double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true })
  .map((v) => v as Confidence);

/**
 * An External_Reference_Signal for a Pair, or null/undefined (no reference). The
 * `fetchedAt` timestamp is fixed so generation stays deterministic.
 */
function arbReference(
  pair: Pair,
): fc.Arbitrary<ExternalReferenceSignal | null | undefined> {
  const present: fc.Arbitrary<ExternalReferenceSignal> = fc
    .record({
      direction: fc.constantFrom(...REFERENCE_DIRECTIONS),
      // `null` ⇒ omit the optional `score` entirely (exactOptionalPropertyTypes
      // forbids an explicit `undefined` on an optional key).
      score: fc.option(
        fc.double({ min: -1, max: 1, noNaN: true, noDefaultInfinity: true }),
        { nil: null },
      ),
      provider: fc.constantFrom("providerA", "providerB"),
    })
    .map(({ direction, score, provider }) => ({
      pair,
      decisionDate: DECISION_DATE,
      direction,
      provider,
      fetchedAt: "2021-06-15T00:00:00.000Z",
      ...(score !== null ? { score } : {}),
    }));
  return fc.oneof(
    present,
    present,
    present,
    fc.constant(null),
    fc.constant(undefined),
  );
}

/**
 * One Pair's matrix input: a candle series (sometimes empty, to exercise the
 * `INSUFFICIENT_DATA` / zero-candle path), an optional deterministic evaluation
 * (the `custom_pattern` cell source), and an optional third-party reference.
 */
function arbPairInput(pair: Pair): fc.Arbitrary<PairConfluenceInput> {
  return fc.record({
    pair: fc.constant(pair),
    // Mostly non-trivial series so strategies can emit real signals; a slice of
    // empty series forces the zero-candle INSUFFICIENT_DATA Pair path.
    candles: fc.oneof(
      arbCandleSeries({ min: 1, max: 40 }),
      arbCandleSeries({ min: 1, max: 40 }),
      arbCandleSeries({ min: 1, max: 40 }),
      arbCandleSeries({ min: 1, max: 40 }),
      fc.constant([]),
    ),
    evaluation: fc.option(
      fc.record({
        direction: directionArb,
        earnedConfidence: confidenceArb,
      }),
      { nil: undefined },
    ),
    thirdParty: arbReference(pair),
  });
}

/**
 * A set of Pair inputs: a (possibly empty) subset of the five Pairs, each with a
 * generated input. A missing Pair exercises the matrix's "absent input ⇒
 * INSUFFICIENT_DATA" branch while the slice still carries all five Pairs.
 */
const arbInputs: fc.Arbitrary<PairConfluenceInput[]> = fc
  .subarray([...PAIRS], { minLength: 0, maxLength: PAIRS.length })
  .chain((pairs) =>
    pairs.length === 0
      ? fc.constant<PairConfluenceInput[]>([])
      : fc.tuple(...pairs.map((pair) => arbPairInput(pair))),
  );

/**
 * An engine with generated weights and thresholds, so the slice must faithfully
 * echo whatever config the engine actually used (Requirement 11.5). Low
 * conflict thresholds plus the generated weights make the `CONFLICT_FLAT` path
 * reachable, exercising the non-empty `opposingStrategyIds` invariant.
 */
const arbEngine: fc.Arbitrary<ConfluenceEngine> = fc
  .record({ weights: arbWeights, thresholds: arbThresholds })
  .map(({ weights, thresholds }) => {
    const result = createConfluenceEngine({
      weights,
      conflictThreshold: thresholds.conflictThreshold,
      alignmentThreshold: thresholds.alignmentThreshold,
    });
    if (!result.ok) {
      // The generators are constrained to the valid domain, so this is
      // unreachable; throw loudly if an arbitrary ever drifts out of range.
      throw new Error(
        `arbEngine produced an invalid config: ${result.error.message}`,
      );
    }
    return result.value;
  });

// ---------------------------------------------------------------------------
// Invariant assertions
// ---------------------------------------------------------------------------

const VALID_STATUSES = new Set([
  "ALIGNED_UP",
  "ALIGNED_DOWN",
  "NEUTRAL",
  "CONFLICT_FLAT",
  "INSUFFICIENT_DATA",
]);
const STRATEGY_ID_SET = new Set<string>(STRATEGY_IDS);

/** Assert every Property-26 slice invariant on a produced slice. */
function assertSliceInvariants(slice: SnapshotConfluenceSlice): void {
  // Requirement 11.6: the label is the literal "unvalidated".
  expect(slice.validationLabel).toBe("unvalidated");

  // Requirement 11.5: weights for every Strategy_Id, plus both thresholds.
  for (const id of STRATEGY_IDS) {
    expect(typeof slice.weights[id]).toBe("number");
    expect(Number.isFinite(slice.weights[id])).toBe(true);
  }
  expect(Number.isFinite(slice.conflictThreshold)).toBe(true);
  expect(Number.isFinite(slice.alignmentThreshold)).toBe(true);

  // Requirements 11.2, 11.9: zero or exactly five Pairs, in PAIRS order.
  expect(slice.pairs.length === 0 || slice.pairs.length === PAIRS.length).toBe(
    true,
  );
  if (slice.pairs.length === PAIRS.length) {
    expect(slice.pairs.map((p) => p.pair)).toEqual([...PAIRS]);
  }

  for (const pair of slice.pairs) {
    // Requirement 11.9: score bounded in [-1, 1].
    expect(Number.isFinite(pair.score)).toBe(true);
    expect(pair.score).toBeGreaterThanOrEqual(-1);
    expect(pair.score).toBeLessThanOrEqual(1);

    expect(VALID_STATUSES.has(pair.status)).toBe(true);

    // Requirement 11.2: exactly six cells in STRATEGY_IDS canonical order.
    expect(pair.cells).toHaveLength(STRATEGY_IDS.length);
    expect(pair.cells.map((c) => c.strategyId)).toEqual([...STRATEGY_IDS]);

    for (const cell of pair.cells) {
      if (cell.available) {
        expect(["UP", "DOWN", "FLAT"]).toContain(cell.direction);
        expect(Number.isFinite(cell.strength)).toBe(true);
        expect(cell.strength).toBeGreaterThanOrEqual(0);
        expect(cell.strength).toBeLessThanOrEqual(1);
        // FLAT must carry strength exactly 0.
        if (cell.direction === "FLAT") {
          expect(cell.strength).toBe(0);
        }
        // Requirement 11.2: available cells carry a non-empty rationale.
        expect(cell.rationale.trim().length).toBeGreaterThan(0);
      } else {
        // Requirement 11.2: unavailable cells carry a non-empty reason.
        expect(typeof cell.reason).toBe("string");
        expect(cell.reason.trim().length).toBeGreaterThan(0);
      }
    }

    // Requirements 11.3, 11.4: opposing ids are non-empty ONLY for CONFLICT_FLAT,
    // and every opposing id is a canonical Strategy_Id.
    for (const id of pair.opposingStrategyIds) {
      expect(STRATEGY_ID_SET.has(id)).toBe(true);
    }
    if (pair.status === "CONFLICT_FLAT") {
      expect(pair.opposingStrategyIds.length).toBeGreaterThan(0);
    } else {
      expect(pair.opposingStrategyIds).toHaveLength(0);
    }
  }

  // Requirement 11.10: the slice admits no provenance / LLM field. Assert the
  // top-level keys are exactly the five wire keys and nothing LLM-like leaked.
  expect(Object.keys(slice).sort()).toEqual(
    [
      "alignmentThreshold",
      "conflictThreshold",
      "pairs",
      "validationLabel",
      "weights",
    ].sort(),
  );
  const forbidden = ["provenance", "llm", "llmTagged", "rationaleSource"];
  for (const pair of slice.pairs) {
    for (const cell of pair.cells) {
      for (const key of forbidden) {
        expect(key in (cell as Record<string, unknown>)).toBe(false);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Property 26
// ---------------------------------------------------------------------------

describe("Property 26: snapshot confluence slice invariants and round trip", () => {
  it("toSnapshotConfluence satisfies every slice invariant for a real matrix", () => {
    fc.assert(
      fc.property(arbInputs, arbEngine, (inputs, engine) => {
        const matrix = buildConfluenceMatrix({
          decisionDate: DECISION_DATE,
          inputs,
          strategies: REAL_BUNDLE,
          engine,
        });
        const slice = toSnapshotConfluence(matrix);

        assertSliceInvariants(slice);

        // Requirement 11.5: the slice echoes the EXACT engine config used.
        expect(slice.conflictThreshold).toBe(engine.config.conflictThreshold);
        expect(slice.alignmentThreshold).toBe(engine.config.alignmentThreshold);
        for (const id of STRATEGY_IDS) {
          expect(slice.weights[id]).toBe(engine.config.weights[id]);
        }

        // A matrix always carries all five Pairs, so the slice must too.
        expect(slice.pairs).toHaveLength(PAIRS.length);
      }),
      { numRuns: 200 },
    );
  });

  it("serialising the slice (within dashboard.json) is a fixed point and parse is deeply equal", () => {
    fc.assert(
      fc.property(arbInputs, arbEngine, (inputs, engine) => {
        const matrix = buildConfluenceMatrix({
          decisionDate: DECISION_DATE,
          inputs,
          strategies: REAL_BUNDLE,
          engine,
        });
        const slice = toSnapshotConfluence(matrix);

        // Round trip the slice on its own: stringify → parse → stringify.
        const once = JSON.stringify(slice, null, 2);
        const parsed = JSON.parse(once) as SnapshotConfluenceSlice;
        const twice = JSON.stringify(parsed, null, 2);

        // serialise is a fixed point.
        expect(twice).toBe(once);
        // parse yields a value deeply equal to the original slice.
        expect(parsed).toEqual(slice);

        // And via the production serializeSnapshot path (carried inside the full
        // dashboard.json envelope), the confluence slice survives the round trip
        // byte-for-byte and deeply equal to the original.
        const snapshot = buildDashboardSnapshot(
          { decisionDate: DECISION_DATE, cards: [] },
          undefined,
          {},
          new Date("2021-06-15T12:00:00.000Z"),
          [],
          {},
          slice,
        );
        const snapOnce = serializeSnapshot(snapshot);
        const snapParsed = JSON.parse(snapOnce) as { confluence: unknown };
        const snapTwice = serializeSnapshot(
          snapParsed as unknown as typeof snapshot,
        );
        expect(snapTwice).toBe(snapOnce);
        expect(snapParsed.confluence).toEqual(slice);
      }),
      { numRuns: 200 },
    );
  });
});
