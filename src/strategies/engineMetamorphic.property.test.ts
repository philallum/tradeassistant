import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  createConfluenceEngine,
  type ConfluenceResult,
  type ConfluenceEngine,
} from "./confluenceEngine.js";
import { buildSignal } from "./types.js";
import type { SignalDirection, StrategySignal } from "./types.js";
import { arbSignalSet, arbWeights, arbThresholds } from "./testing/arbitraries.js";

// Metamorphic properties for the Confluence_Engine. Both use EXACT equality
// (not tolerance): the design guarantees the engine sorts into canonical order
// before summing and classifying, so permuting the inputs must reproduce the
// SAME bytes, and the sign flip must negate the score exactly.
//
// Validates: Requirements 8.8, 8.9, 9.8, 13.5

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

/**
 * Build a configured engine from arbitrary weights and thresholds. The
 * generators only produce finite, in-range values, so the factory always
 * succeeds; we assert that so a generator regression surfaces loudly.
 */
function makeEngine(
  weights: Readonly<Record<string, number>>,
  thresholds: { conflictThreshold: number; alignmentThreshold: number },
): ConfluenceEngine {
  const created = createConfluenceEngine({
    weights,
    conflictThreshold: thresholds.conflictThreshold,
    alignmentThreshold: thresholds.alignmentThreshold,
  });
  if (!created.ok) {
    throw new Error(
      `engine factory unexpectedly rejected a valid config: ${created.error.message}`,
    );
  }
  return created.value;
}

/** Aggregate and assert the call succeeded, returning the ConfluenceResult. */
function aggregateOk(
  engine: ConfluenceEngine,
  signals: readonly StrategySignal[],
): ConfluenceResult {
  const result = engine.aggregate(signals);
  if (!result.ok) {
    throw new Error(`aggregate unexpectedly rejected: ${result.error.message}`);
  }
  return result.value;
}

/**
 * A signal set paired with a permutation of itself. Generating both together
 * keeps a single `fc.property` for the order-independence check (no nested
 * `fc.assert`). The permutation is a full-length shuffle of the same members.
 */
const arbSignalSetWithPermutation: fc.Arbitrary<{
  signals: StrategySignal[];
  permuted: StrategySignal[];
}> = arbSignalSet.chain((signals) =>
  fc
    .shuffledSubarray(signals, {
      minLength: signals.length,
      maxLength: signals.length,
    })
    .map((permuted) => ({ signals, permuted: [...permuted] })),
);

/** Normalise a possible `-0` to `+0`, matching the engine's score handling. */
const normalizeZero = (value: number): number => (value === 0 ? 0 : value);

/** The UP<->DOWN flip, leaving FLAT untouched. */
function flipDirection(direction: SignalDirection): SignalDirection {
  if (direction === "UP") return "DOWN";
  if (direction === "DOWN") return "UP";
  return "FLAT";
}

/**
 * Rebuild every signal with its direction flipped and the SAME strength and
 * rationale. buildSignal keeps FLAT at strength 0 and leaves UP/DOWN strength
 * unchanged, so the only change is the sign of each directional contribution.
 */
function flipSignals(signals: readonly StrategySignal[]): StrategySignal[] {
  return signals.map((signal) => {
    const built = buildSignal(
      signal.strategyId,
      flipDirection(signal.direction),
      signal.strength,
      signal.rationale,
    );
    if (!built.ok) {
      throw new Error(
        `flipSignals produced an invalid signal: ${built.error.message}`,
      );
    }
    return built.value;
  });
}

// ---------------------------------------------------------------------------
// Property 17: Aggregation is order independent.
// ---------------------------------------------------------------------------

describe("Property 17: Aggregation is order independent", () => {
  // Feature: multi-strategy-confluence-engine, Property 17: Aggregation is order independent
  it("yields an identical ConfluenceResult for any permutation of the same signal set", () => {
    fc.assert(
      fc.property(
        arbSignalSetWithPermutation,
        arbWeights,
        arbThresholds,
        ({ signals, permuted }, weights, thresholds) => {
          const engine = makeEngine(weights, thresholds);

          const baseline = aggregateOk(engine, signals);
          const permutedResult = aggregateOk(engine, permuted);

          // EXACT deep equality on every field of the result: score, status,
          // the canonical-order opposingStrategyIds, and the canonical-order
          // signals array (Requirements 8.8, 9.8).
          expect(permutedResult).toStrictEqual(baseline);
          expect(permutedResult.score).toBe(baseline.score);
          expect(permutedResult.status).toBe(baseline.status);
          expect(permutedResult.opposingStrategyIds).toStrictEqual(
            baseline.opposingStrategyIds,
          );
          expect(permutedResult.signals).toStrictEqual(baseline.signals);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 20: UP/DOWN symmetry.
// ---------------------------------------------------------------------------

describe("Property 20: UP/DOWN symmetry", () => {
  // Feature: multi-strategy-confluence-engine, Property 20: UP/DOWN symmetry
  it("negates the score and swaps ALIGNED_UP<->ALIGNED_DOWN when every UP<->DOWN is flipped", () => {
    fc.assert(
      fc.property(
        arbSignalSet,
        arbWeights,
        arbThresholds,
        (signals, weights, thresholds) => {
          const engine = makeEngine(weights, thresholds);

          const original = aggregateOk(engine, signals);
          const flipped = aggregateOk(engine, flipSignals(signals));

          if (original.status === "INSUFFICIENT_DATA") {
            // A zero-total-weight set stays INSUFFICIENT_DATA after flipping:
            // flipping directions cannot create positive weight (Req 8.3).
            expect(flipped.status).toBe("INSUFFICIENT_DATA");
            expect(flipped.score).toBe(0);
            expect(flipped.opposingStrategyIds).toStrictEqual([]);
            return;
          }

          // Score negates EXACTLY. Both engine results normalise -0 to +0, so
          // negating the original (and normalising) gives the flipped score.
          expect(flipped.score).toBe(normalizeZero(-original.score));

          // Status mapping: ALIGNED_UP<->ALIGNED_DOWN, others unchanged.
          switch (original.status) {
            case "ALIGNED_UP":
              expect(flipped.status).toBe("ALIGNED_DOWN");
              break;
            case "ALIGNED_DOWN":
              expect(flipped.status).toBe("ALIGNED_UP");
              break;
            case "CONFLICT_FLAT":
              expect(flipped.status).toBe("CONFLICT_FLAT");
              // The opposing set is identical: flipping only swaps which ids
              // were the strong-UP vs strong-DOWN members, and the union is in
              // canonical order either way (Requirement 9.9).
              expect(flipped.opposingStrategyIds).toStrictEqual(
                original.opposingStrategyIds,
              );
              break;
            case "NEUTRAL":
              expect(flipped.status).toBe("NEUTRAL");
              break;
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("keeps a set that produces INSUFFICIENT_DATA at INSUFFICIENT_DATA after flipping", () => {
    // Force the zero-total-weight condition directly: all weights 0 makes every
    // non-empty set INSUFFICIENT_DATA, and flipping must preserve that (Req 8.3).
    const zeroWeights = {
      trend: 0,
      breakout: 0,
      range: 0,
      reversal: 0,
      custom_pattern: 0,
      third_party: 0,
    } as const;

    fc.assert(
      fc.property(arbSignalSet, arbThresholds, (signals, thresholds) => {
        const engine = makeEngine(zeroWeights, thresholds);

        const original = aggregateOk(engine, signals);
        const flipped = aggregateOk(engine, flipSignals(signals));

        expect(original.status).toBe("INSUFFICIENT_DATA");
        expect(flipped.status).toBe("INSUFFICIENT_DATA");
        expect(flipped.score).toBe(0);
      }),
      { numRuns: 100 },
    );
  });
});
