import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { createConfluenceEngine } from "./confluenceEngine.js";
import { type StrategySignal } from "./types.js";
import {
  arbSignalSet,
  arbWeights,
  type ConfluenceWeights,
} from "./testing/arbitraries.js";

// Tests for the Confluence_Engine score and zero-weight behaviour
// (Design "6. Confluence engine"). Backend fast-check 4.10.0; numRuns >= 100.

const NUM_RUNS = 200;

/** The sign each Signal_Direction contributes (UP=+1, DOWN=-1, FLAT=0). */
const SIGN: Readonly<Record<StrategySignal["direction"], number>> = {
  UP: 1,
  DOWN: -1,
  FLAT: 0,
};

/** Clamp `value` into the inclusive `[min, max]` interval. */
const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/**
 * Independent oracle: the clamped weighted mean of signed strengths divided by
 * the total positive weight W. Computed from scratch, not via the engine.
 */
function expectedScore(
  signals: readonly StrategySignal[],
  weights: ConfluenceWeights,
): { W: number; score: number } {
  let weightedSum = 0;
  let W = 0;
  for (const signal of signals) {
    const w = weights[signal.strategyId];
    W += w;
    weightedSum += w * SIGN[signal.direction] * signal.strength;
  }
  const score = W === 0 ? 0 : clamp(weightedSum / W, -1, 1);
  return { W, score };
}

describe("Confluence engine score and zero-weight properties", () => {
  // Feature: multi-strategy-confluence-engine, Property 15: Confluence score is the bounded weighted mean
  //
  // For any valid signal set and any non-negative weights, when the total
  // positive weight W > 0 the engine's score equals the independently computed
  // clamped weighted mean of signed strengths (UP=+1, DOWN=-1, FLAT=0) divided
  // by W, to within a tiny tolerance; and the score is always within [-1, 1]
  // with -0 normalised to +0.
  //
  // Validates: Requirements 8.1, 8.2, 8.3, 8.5, 13.5
  it("Property 15: score is the bounded weighted mean, clamped to [-1, 1]", () => {
    fc.assert(
      fc.property(arbSignalSet, arbWeights, (signals, weights) => {
        const engineResult = createConfluenceEngine({ weights });
        expect(engineResult.ok).toBe(true);
        if (!engineResult.ok) return;

        const result = engineResult.value.aggregate(signals);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const { score } = result.value;
        const oracle = expectedScore(signals, weights);

        // Score is always within [-1, 1].
        expect(score).toBeGreaterThanOrEqual(-1);
        expect(score).toBeLessThanOrEqual(1);

        // -0 is normalised to +0.
        expect(Object.is(score, -0)).toBe(false);

        if (oracle.W > 0) {
          // The score matches the independently computed clamped weighted mean.
          expect(score).toBeCloseTo(oracle.score, 9);
          expect(Math.abs(score - oracle.score)).toBeLessThanOrEqual(1e-9);
        } else {
          // Zero total weight collapses to score 0 (see Property 16).
          expect(score).toBe(0);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: multi-strategy-confluence-engine, Property 16: Zero total weight means insufficient data
  //
  // For any signal set where every signal's weight is 0 (or the list is empty),
  // the engine returns score 0, status INSUFFICIENT_DATA, and an empty
  // opposingStrategyIds list.
  //
  // Validates: Requirements 8.1, 8.2, 8.3, 8.5, 13.5
  it("Property 16: all-zero weights yield INSUFFICIENT_DATA with score 0", () => {
    fc.assert(
      fc.property(arbSignalSet, (signals) => {
        // Every weight forced to 0 so the total positive weight W is 0.
        const zeroWeights = {
          trend: 0,
          breakout: 0,
          range: 0,
          reversal: 0,
          custom_pattern: 0,
          third_party: 0,
        } as ConfluenceWeights;

        const engineResult = createConfluenceEngine({ weights: zeroWeights });
        expect(engineResult.ok).toBe(true);
        if (!engineResult.ok) return;

        const result = engineResult.value.aggregate(signals);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.value.score).toBe(0);
        expect(Object.is(result.value.score, -0)).toBe(false);
        expect(result.value.status).toBe("INSUFFICIENT_DATA");
        expect(result.value.opposingStrategyIds).toEqual([]);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
