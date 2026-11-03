// Feature: multi-strategy-confluence-engine, Property 1: Strategy signals are always valid
//
// For every candle series and Decision_Date, whenever one of the four classical
// strategies (trend, breakout, range, reversal) returns an `ok` result, that
// StrategySignal is a VALID signal per the shared contract: `strength` is a
// finite number in [0, 1] (Requirement 1.4); `strength` is exactly 0 when the
// direction is FLAT, while UP/DOWN with strength 0 is still permitted
// (Requirements 1.5, 1.9); and `rationale` is 1..500 characters with at least
// one non-whitespace character (Requirement 1.6). Strategy-specific framing of
// the same contract: the Breakout and Range strategies must likewise only ever
// emit valid signals (Requirements 2.6, 3.6).
//
// This checks the whole producer surface against a single authority — the
// canonical `validateStrategySignal` guard — rather than re-deriving each
// strategy's decision. If any strategy ever emitted a signal the contract would
// reject (an out-of-range strength, a FLAT with non-zero strength, an empty
// rationale, ...), validation would fail here. The shared `arbCandleSeries`
// generator (Requirement 13.2) produces finite, ascending-date series across
// all five FX pairs, and `arbDecisionDateAfter` keeps the whole series strictly
// past-only so each strategy returns an `ok` signal to validate.
//
// Validates: Requirements 1.4, 1.5, 1.6, 2.6, 3.6, 13.2

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  createTrendStrategy,
  createBreakoutStrategy,
  createRangeStrategy,
  createReversalStrategy,
  validateStrategySignal,
} from "./index.js";
import type { Strategy } from "./index.js";
import {
  arbCandleSeries,
  arbDecisionDateAfter,
} from "./testing/arbitraries.js";

/**
 * The four classical strategies under test, each built from its default config.
 * The factories only fail for an invalid config, so the defaults always build;
 * if one ever did not, the test fails loudly rather than silently skipping.
 */
const STRATEGIES: ReadonlyArray<{
  readonly name: string;
  readonly strategy: Strategy<unknown>;
}> = (
  [
    ["trend", createTrendStrategy()],
    ["breakout", createBreakoutStrategy()],
    ["range", createRangeStrategy()],
    ["reversal", createReversalStrategy()],
  ] as const
).map(([name, built]) => {
  if (!built.ok) {
    throw new Error(`${name} strategy failed to build from its default config`);
  }
  return { name, strategy: built.value };
});

describe("Property 1: Strategy signals are always valid", () => {
  for (const { name, strategy } of STRATEGIES) {
    it(`${name}: every ok signal passes validateStrategySignal`, () => {
      fc.assert(
        fc.property(
          arbCandleSeries({ min: 0, max: 120 }).chain((candles) =>
            arbDecisionDateAfter(candles).map((decisionDate) => ({
              candles,
              decisionDate,
            })),
          ),
          ({ candles, decisionDate }) => {
            const result = strategy.evaluate(candles, decisionDate);

            // Only `ok` results carry a signal to validate. A hard error (e.g.
            // the empty-array `insufficient_data` case) has no signal and is
            // out of scope for this property.
            if (!result.ok) return;

            const signal = result.value;

            // The contract's single authority must accept the emitted signal,
            // returning an equal, re-validated value.
            const validated = validateStrategySignal(signal);
            expect(validated.ok).toBe(true);
            if (!validated.ok) return;
            expect(validated.value).toEqual(signal);

            // Spell out the individual invariants so a failure points at the
            // exact rule that broke, not just "validation failed".
            // Req 1.4: finite strength in [0, 1].
            expect(Number.isFinite(signal.strength)).toBe(true);
            expect(signal.strength).toBeGreaterThanOrEqual(0);
            expect(signal.strength).toBeLessThanOrEqual(1);

            // Req 1.5: FLAT has strength exactly 0; UP/DOWN may be 0 (Req 1.9).
            if (signal.direction === "FLAT") {
              expect(signal.strength).toBe(0);
            }

            // Req 1.6: rationale is 1..500 chars with a non-whitespace char.
            expect(signal.rationale.length).toBeGreaterThanOrEqual(1);
            expect(signal.rationale.length).toBeLessThanOrEqual(500);
            expect(signal.rationale.trim().length).toBeGreaterThan(0);
          },
        ),
        { numRuns: 200 },
      );
    });
  }
});
