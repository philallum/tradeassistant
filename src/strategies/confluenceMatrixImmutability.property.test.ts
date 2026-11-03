import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { createConfluenceEngine } from "./confluenceEngine.js";
import { createTrendStrategy } from "./trend.js";
import { createBreakoutStrategy } from "./breakout.js";
import { createRangeStrategy } from "./range.js";
import { createReversalStrategy } from "./reversal.js";
import {
  buildConfluenceMatrix,
  type PairConfluenceInput,
  type StrategyBundle,
} from "./confluenceMatrix.js";
import { PAIRS, type Pair } from "../ingestion/types.js";
import type { Candle, TradingDate } from "../guard/types.js";
import type { ExternalReferenceSignal } from "../external-signal/types.js";
import type { Confidence } from "../confidence/types.js";
import {
  arbCandleSeries,
  arbDecisionDateAfter,
  arbSignalDirection,
} from "./testing/arbitraries.js";

// Property 25: Confluence evaluation does not change firing inputs.
// buildConfluenceMatrix is a pure, deterministic function that never writes to
// the caller's inputs, candles, evaluations, or third-party references
// (Requirements 10.5, 7.10). Backend fast-check 4.10.0; numRuns >= 100.

const NUM_RUNS = 200;

/**
 * Recursively freeze a value and every nested object/array it reaches, so any
 * attempted write by `buildConfluenceMatrix` would throw in strict mode. Cycles
 * are impossible in the generated plain data, so a simple recursive walk is
 * safe.
 */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

/**
 * An arbitrary deterministic pattern evaluation (the `custom_pattern` input).
 * `earnedConfidence` is the branded `Confidence` number the adapter reads; the
 * brand is a compile-time-only tag, so a `[0, 1]` number is the real value.
 */
const arbEvaluation: fc.Arbitrary<
  PairConfluenceInput["evaluation"]
> = fc.option(
  fc
    .record({
      direction: arbSignalDirection,
      confidence: fc.double({
        min: 0,
        max: 1,
        noNaN: true,
        noDefaultInfinity: true,
      }),
    })
    .map(({ direction, confidence }) => ({
      direction,
      earnedConfidence: confidence as Confidence,
    })),
  { nil: undefined },
);

/**
 * An arbitrary third-party reference for a Pair, including valid references and
 * occasional structurally-invalid ones (so the adapter's `unavailable` path is
 * exercised too). `null`/`undefined` model a missing reference.
 */
function arbThirdParty(
  pair: Pair,
  decisionDate: TradingDate,
): fc.Arbitrary<PairConfluenceInput["thirdParty"]> {
  const validReference: fc.Arbitrary<ExternalReferenceSignal> = fc.record({
    pair: fc.constant(pair),
    decisionDate: fc.constant(decisionDate),
    direction: fc.constantFrom("BUY", "SELL", "HOLD"),
    score: fc.double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true }),
    provider: fc.string({ minLength: 1, maxLength: 20 }),
    fetchedAt: fc.constant("2020-01-01T00:00:00.000Z"),
  });
  return fc.oneof(
    validReference,
    fc.constant(null),
    fc.constant(undefined),
    // A structurally-invalid reference: an unknown direction the adapter rejects.
    fc.record({
      pair: fc.constant(pair),
      decisionDate: fc.constant(decisionDate),
      direction: fc.constant("SIDEWAYS" as unknown as "BUY"),
      provider: fc.string({ minLength: 1, maxLength: 20 }),
      fetchedAt: fc.constant("2020-01-01T00:00:00.000Z"),
    }) as fc.Arbitrary<ExternalReferenceSignal>,
  );
}

/**
 * One arbitrary {@link PairConfluenceInput}: a candle series (possibly empty so
 * the zero-candle path is covered), an optional evaluation, and an optional
 * third-party reference, all dated before a shared Decision_Date.
 */
function arbPairInput(
  pair: Pair,
): fc.Arbitrary<{ decisionDate: TradingDate; input: PairConfluenceInput }> {
  return arbCandleSeries({ min: 0, max: 40 }).chain((candles) =>
    arbDecisionDateAfter(candles).chain((decisionDate) =>
      fc
        .tuple(arbEvaluation, arbThirdParty(pair, decisionDate))
        .map(([evaluation, thirdParty]) => ({
          decisionDate,
          input: {
            pair,
            candles: candles.map((c) => ({ ...c })) as readonly Candle[],
            evaluation,
            thirdParty,
          } satisfies PairConfluenceInput,
        })),
    ),
  );
}

/**
 * A full set of per-Pair inputs sharing a single Decision_Date (the latest of
 * the per-Pair decision dates), over an arbitrary subset of the five Pairs.
 */
const arbInputs: fc.Arbitrary<{
  decisionDate: TradingDate;
  inputs: PairConfluenceInput[];
}> = fc
  .subarray([...PAIRS], { minLength: 0, maxLength: PAIRS.length })
  .chain((pairs) =>
    pairs.length === 0
      ? fc.constant<{ decisionDate: TradingDate; inputs: PairConfluenceInput[] }>({
          decisionDate: "2020-01-02",
          inputs: [],
        })
      : fc.tuple(...pairs.map((p) => arbPairInput(p))).map((perPair) => {
          // Share the single latest Decision_Date across all Pairs so every
          // candle in every Pair is strictly in the past (Requirement 10.7).
          const decisionDate = perPair
            .map((x) => x.decisionDate)
            .reduce((a, b) => (a >= b ? a : b));
          return {
            decisionDate,
            inputs: perPair.map((x) => x.input),
          };
        }),
  );

describe("Confluence matrix input immutability", () => {
  // Feature: multi-strategy-confluence-engine, Property 25: Confluence evaluation does not change firing inputs
  //
  // For any set of per-Pair inputs (arbitrary candles, evaluations, and
  // third-party references), deep-freezing every input and then running
  // `buildConfluenceMatrix` never throws — proving it writes to none of them —
  // and a deep clone of the inputs taken before the call is deep-equal to the
  // inputs after the call. The firing-path values the matrix merely reads are
  // left byte-for-byte unchanged.
  //
  // Validates: Requirements 10.5, 7.10
  it("Property 25: evaluation never mutates inputs, candles, evaluations, or references", () => {
    fc.assert(
      fc.property(arbInputs, ({ decisionDate, inputs }) => {
        // Real producers and engine, default configuration.
        const trend = createTrendStrategy();
        const breakout = createBreakoutStrategy();
        const range = createRangeStrategy();
        const reversal = createReversalStrategy();
        const engineResult = createConfluenceEngine();

        expect(trend.ok).toBe(true);
        expect(breakout.ok).toBe(true);
        expect(range.ok).toBe(true);
        expect(reversal.ok).toBe(true);
        expect(engineResult.ok).toBe(true);
        if (
          !trend.ok ||
          !breakout.ok ||
          !range.ok ||
          !reversal.ok ||
          !engineResult.ok
        ) {
          return;
        }

        const strategies: StrategyBundle = {
          trend: trend.value,
          breakout: breakout.value,
          range: range.value,
          reversal: reversal.value,
        };

        // Snapshot the inputs by deep clone BEFORE freezing / calling.
        const snapshot = structuredClone(inputs);

        // Deep-freeze the inputs array, each input, its candle array and every
        // candle object, the evaluation, and the third-party reference. Any
        // write by buildConfluenceMatrix would now throw in strict mode.
        deepFreeze(inputs);

        // Must not throw: proves it never writes to the frozen inputs (10.5).
        expect(() =>
          buildConfluenceMatrix({
            decisionDate,
            inputs,
            strategies,
            engine: engineResult.value,
          }),
        ).not.toThrow();

        // Values unchanged: a deep clone of the inputs taken AFTER the call
        // deep-equals the deep clone taken BEFORE it (10.5, 7.10). Both sides
        // go through the same clone so the comparison tests values only, not an
        // incidental prototype difference of the generated records.
        expect(structuredClone(inputs)).toStrictEqual(snapshot);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
