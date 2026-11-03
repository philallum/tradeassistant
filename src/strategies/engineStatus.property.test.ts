import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  createConfluenceEngine,
  type ConfluenceEngine,
  type ConfluenceStatus,
} from "./confluenceEngine.js";
import {
  STRATEGY_IDS,
  buildSignal,
  type SignalDirection,
  type StrategyId,
  type StrategySignal,
} from "./types.js";

// Feature: multi-strategy-confluence-engine, Property 18: Strong opposition forces Stay Flat
// Feature: multi-strategy-confluence-engine, Property 19: Non-conflict classification follows the thresholds
//
// These two properties pin down the Confluence_Engine classification rule
// (Requirements 9.1-9.5, 9.9, 9.10) and the opposing-ids invariant that the
// snapshot slice depends on (Requirements 11.3, 11.4). Both use shared test
// generators (Requirement 13.5) and deliberately place strengths AROUND the
// conflict threshold and scores AROUND the alignment threshold, rather than
// sampling uniformly, so the boundary behaviour (>= vs <, strict <) is actually
// exercised.
//
// Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5, 9.9, 9.10, 11.3, 11.4, 13.5

// ---------------------------------------------------------------------------
// Canonical ordering helper (independent of the engine's private copy).
// ---------------------------------------------------------------------------

const CANONICAL_INDEX: Readonly<Record<StrategyId, number>> = Object.freeze(
  STRATEGY_IDS.reduce<Record<StrategyId, number>>((acc, id, i) => {
    acc[id] = i;
    return acc;
  }, {} as Record<StrategyId, number>),
);

const SIGN: Readonly<Record<SignalDirection, number>> = {
  UP: 1,
  DOWN: -1,
  FLAT: 0,
};

const canonicalSort = (ids: readonly StrategyId[]): StrategyId[] =>
  [...ids].sort((a, b) => CANONICAL_INDEX[a] - CANONICAL_INDEX[b]);

/** Unwrap a createConfluenceEngine result, asserting ok. */
function mustEngine(partial?: {
  readonly weights?: Partial<Record<StrategyId, number>>;
  readonly conflictThreshold?: number;
  readonly alignmentThreshold?: number;
}): ConfluenceEngine {
  const result = createConfluenceEngine(partial);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("engine config unexpectedly rejected");
  return result.value;
}

/** Build a valid signal, asserting it is accepted. */
function mustSignal(
  id: StrategyId,
  direction: SignalDirection,
  strength: number,
): StrategySignal {
  const r = buildSignal(id, direction, strength, `r:${id}:${direction}`);
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error("signal unexpectedly rejected");
  return r.value;
}

// ---------------------------------------------------------------------------
// Threshold-hugging primitive generators.
//
// A strength NEAR a target threshold `t`: biased to land just below, exactly
// at, and just above `t`, plus the exact [0,1] endpoints. Clamped to [0,1].
// ---------------------------------------------------------------------------

const nearValue = (t: number): fc.Arbitrary<number> =>
  fc.oneof(
    // Tiny deltas around the threshold — the boundary is where >= vs < bites.
    fc
      .constantFrom(-1e-9, -1e-6, -1e-3, 0, 1e-9, 1e-6, 1e-3)
      .map((d) => Math.min(1, Math.max(0, t + d))),
    // Exactly the threshold.
    fc.constant(Math.min(1, Math.max(0, t))),
    // The domain endpoints, so "well below" / "well above" also appear.
    fc.constantFrom(0, 1),
    // A spread of other values so the full range is still covered.
    fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
  );

/** A threshold value in [0, 1], itself biased toward the defaults and edges. */
const arbThreshold: fc.Arbitrary<number> = fc.oneof(
  fc.constantFrom(0, 0.2, 0.4, 0.5, 0.6, 0.8, 1),
  fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
);

/** A positive weight, biased small so weighted means stay interesting. */
const arbPositiveWeight: fc.Arbitrary<number> = fc.oneof(
  fc.constantFrom(0.5, 1, 2, 3),
  fc.double({ min: 0.01, max: 10, noNaN: true, noDefaultInfinity: true }),
);

/** A non-negative weight that may be exactly 0 (zero-weight ids contribute nothing). */
const arbMaybeZeroWeight: fc.Arbitrary<number> = fc.oneof(
  fc.constant(0),
  arbPositiveWeight,
);

// ---------------------------------------------------------------------------
// Oracle: an independent restatement of the classification rule.
// ---------------------------------------------------------------------------

interface Scenario {
  readonly signals: StrategySignal[];
  readonly weights: Record<StrategyId, number>;
  readonly conflictThreshold: number;
  readonly alignmentThreshold: number;
}

const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v));

/** Expected score: clamp(Σ w·sgn·s / Σ w, -1, 1), -0 normalised; 0 if W === 0. */
function expectedScore(s: Scenario): number {
  const totalWeight = s.signals.reduce(
    (sum, sig) => sum + s.weights[sig.strategyId],
    0,
  );
  if (totalWeight === 0) return 0;
  const weightedSum = s.signals.reduce(
    (sum, sig) =>
      sum + s.weights[sig.strategyId] * SIGN[sig.direction] * sig.strength,
    0,
  );
  const score = clamp(weightedSum / totalWeight, -1, 1);
  return score === 0 ? 0 : score;
}

/** The strong opposing ids per criterion 1 (positive weight, strength >= conflict). */
function strongOpposing(s: Scenario): {
  up: StrategyId[];
  down: StrategyId[];
} {
  const up: StrategyId[] = [];
  const down: StrategyId[] = [];
  for (const sig of s.signals) {
    if (s.weights[sig.strategyId] <= 0) continue;
    if (sig.strength < s.conflictThreshold) continue;
    if (sig.direction === "UP") up.push(sig.strategyId);
    else if (sig.direction === "DOWN") down.push(sig.strategyId);
  }
  return { up, down };
}

/** Contributing signals: positive weight, non-FLAT direction (criteria 3-5, 10). */
function contributingCount(s: Scenario): number {
  return s.signals.filter(
    (sig) => s.weights[sig.strategyId] > 0 && sig.direction !== "FLAT",
  ).length;
}

interface Expected {
  readonly status: ConfluenceStatus;
  readonly opposing: StrategyId[];
}

function oracle(s: Scenario): Expected {
  const totalWeight = s.signals.reduce(
    (sum, sig) => sum + s.weights[sig.strategyId],
    0,
  );
  if (totalWeight === 0) {
    return { status: "INSUFFICIENT_DATA", opposing: [] };
  }

  const { up, down } = strongOpposing(s);
  if (up.length > 0 && down.length > 0) {
    return {
      status: "CONFLICT_FLAT",
      opposing: canonicalSort([...up, ...down]),
    };
  }

  const score = expectedScore(s);
  const contributors = contributingCount(s);
  let status: ConfluenceStatus;
  if (contributors >= 2) {
    if (score >= s.alignmentThreshold) status = "ALIGNED_UP";
    else if (score <= -s.alignmentThreshold) status = "ALIGNED_DOWN";
    else status = "NEUTRAL";
  } else {
    status = "NEUTRAL";
  }
  return { status, opposing: [] };
}

// ---------------------------------------------------------------------------
// Scenario generators.
// ---------------------------------------------------------------------------

/** Pick a distinct subset of strategy ids and a direction+strength for each. */
function arbSignalsNear(
  conflictThreshold: fc.Arbitrary<number>,
): fc.Arbitrary<{ signals: StrategySignal[]; conflictThreshold: number }> {
  return conflictThreshold.chain((ct) =>
    fc
      .subarray([...STRATEGY_IDS], {
        minLength: 0,
        maxLength: STRATEGY_IDS.length,
      })
      .chain((ids) =>
        (ids.length === 0
          ? fc.constant<StrategySignal[]>([])
          : fc.tuple(
              ...ids.map((id) =>
                fc
                  .record({
                    direction: fc.constantFrom<SignalDirection>(
                      "UP",
                      "DOWN",
                      "FLAT",
                    ),
                    strength: nearValue(ct),
                  })
                  .map(({ direction, strength }) =>
                    mustSignal(
                      id,
                      direction,
                      direction === "FLAT" ? 0 : strength,
                    ),
                  ),
              ),
            )
        ).map((signals) => ({ signals, conflictThreshold: ct })),
      ),
  );
}

/** A full weight map for the six ids, each possibly zero. */
const arbWeightMap: fc.Arbitrary<Record<StrategyId, number>> = fc
  .tuple(...STRATEGY_IDS.map(() => arbMaybeZeroWeight))
  .map((values) => {
    const w = {} as Record<StrategyId, number>;
    STRATEGY_IDS.forEach((id, i) => {
      w[id] = values[i]!;
    });
    return w;
  });

/** A complete scenario: signals near the conflict threshold, weights, thresholds. */
const arbScenario: fc.Arbitrary<Scenario> = fc
  .record({
    base: arbSignalsNear(arbThreshold),
    weights: arbWeightMap,
    alignmentThreshold: arbThreshold,
  })
  .map(({ base, weights, alignmentThreshold }) => ({
    signals: base.signals,
    weights,
    conflictThreshold: base.conflictThreshold,
    alignmentThreshold,
  }));

// ---------------------------------------------------------------------------
// A scenario generator biased to PRODUCE conflicts: guarantee at least one
// strong UP and one strong DOWN with positive weight, so Property 18's
// precondition is hit often (not just by luck).
// ---------------------------------------------------------------------------

const arbConflictScenario: fc.Arbitrary<Scenario> = arbThreshold.chain((ct) =>
  fc
    .record({
      // Two distinct ids to carry the opposing strong signals.
      pair: fc
        .subarray([...STRATEGY_IDS], { minLength: 2, maxLength: 2 })
        .filter((xs) => xs.length === 2),
      // Strengths at or above ct (so they are strong). Include exactly ct.
      upStrength: fc.oneof(
        fc.constant(ct),
        fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
      ),
      downStrength: fc.oneof(
        fc.constant(ct),
        fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
      ),
      alignmentThreshold: arbThreshold,
      extra: fc.array(
        fc.record({
          direction: fc.constantFrom<SignalDirection>("UP", "DOWN", "FLAT"),
          strength: nearValue(ct),
        }),
        { maxLength: 4 },
      ),
    })
    .map(({ pair, upStrength, downStrength, alignmentThreshold, extra }) => {
      const [upId, downId] = pair as [StrategyId, StrategyId];
      // Force the two carriers to be strong (>= ct) and positive weight.
      const upS = Math.max(ct, upStrength);
      const downS = Math.max(ct, downStrength);
      const weights = {} as Record<StrategyId, number>;
      for (const id of STRATEGY_IDS) weights[id] = 0;
      weights[upId] = 1;
      weights[downId] = 1;

      const signals: StrategySignal[] = [
        mustSignal(upId, "UP", upS),
        mustSignal(downId, "DOWN", downS),
      ];
      // Fill remaining ids with extra signals (weight stays 0 unless set here).
      const remaining = STRATEGY_IDS.filter(
        (id) => id !== upId && id !== downId,
      );
      extra.slice(0, remaining.length).forEach((e, i) => {
        const id = remaining[i]!;
        weights[id] = 1;
        signals.push(mustSignal(id, e.direction, e.direction === "FLAT" ? 0 : e.strength));
      });

      return {
        signals,
        weights,
        conflictThreshold: ct,
        alignmentThreshold,
      };
    }),
);

// ---------------------------------------------------------------------------
// Properties.
// ---------------------------------------------------------------------------

describe("Property 18: Strong opposition forces Stay Flat", () => {
  it("sets CONFLICT_FLAT with the unmodified score and the canonical union of strong opposing ids", () => {
    fc.assert(
      fc.property(
        fc.oneof(arbConflictScenario, arbScenario),
        (scenario) => {
          const { up, down } = strongOpposing(scenario);
          // Property 18 only speaks to the conflict case.
          fc.pre(up.length > 0 && down.length > 0);

          const engine = mustEngine({
            weights: scenario.weights,
            conflictThreshold: scenario.conflictThreshold,
            alignmentThreshold: scenario.alignmentThreshold,
          });
          const result = engine.aggregate(scenario.signals);
          expect(result.ok).toBe(true);
          if (!result.ok) return;

          // Status is CONFLICT_FLAT for ANY score, including beyond alignment (Req 9.9).
          expect(result.value.status).toBe("CONFLICT_FLAT");

          // Score is the computed weighted mean, unmodified by the conflict (Req 9.2).
          expect(result.value.score).toBeCloseTo(expectedScore(scenario), 12);

          // opposingStrategyIds is the canonical-order union of EXACTLY the strong
          // opposing ids, and is non-empty (Req 9.2, 11.3, 11.4).
          const expectedOpposing = canonicalSort([...up, ...down]);
          expect(result.value.opposingStrategyIds).toEqual(expectedOpposing);
          expect(result.value.opposingStrategyIds.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("holds even when the score clears the alignment threshold (Req 9.9)", () => {
    fc.assert(
      fc.property(
        fc.subarray([...STRATEGY_IDS], { minLength: 2, maxLength: 2 }),
        (pair) => {
          fc.pre(pair.length === 2);
          const [upId, downId] = pair as [StrategyId, StrategyId];
          // One very strong UP dominating a weaker (but still strong) DOWN so the
          // score lands well above the alignment threshold.
          const weights = {} as Record<StrategyId, number>;
          for (const id of STRATEGY_IDS) weights[id] = 0;
          weights[upId] = 5;
          weights[downId] = 1;
          const engine = mustEngine({
            weights,
            conflictThreshold: 0.6,
            alignmentThreshold: 0.4,
          });
          const signals = [
            mustSignal(upId, "UP", 1),
            mustSignal(downId, "DOWN", 0.6),
          ];
          const result = engine.aggregate(signals);
          expect(result.ok).toBe(true);
          if (!result.ok) return;
          // Score = (5·1 - 1·0.6)/6 = 0.7333 > 0.4, yet status is still conflict.
          expect(result.value.score).toBeGreaterThan(0.4);
          expect(result.value.status).toBe("CONFLICT_FLAT");
          expect(result.value.opposingStrategyIds).toEqual(
            canonicalSort([upId, downId]),
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("Property 19: Non-conflict classification follows the thresholds", () => {
  it("classifies by contributor count and the alignment threshold, with empty opposing ids", () => {
    fc.assert(
      fc.property(arbScenario, (scenario) => {
        const { up, down } = strongOpposing(scenario);
        // Property 19 only speaks to the non-conflict case.
        fc.pre(!(up.length > 0 && down.length > 0));

        const engine = mustEngine({
          weights: scenario.weights,
          conflictThreshold: scenario.conflictThreshold,
          alignmentThreshold: scenario.alignmentThreshold,
        });
        const result = engine.aggregate(scenario.signals);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const expected = oracle(scenario);
        expect(result.value.status).toBe(expected.status);

        // For every non-CONFLICT_FLAT result, opposing ids are empty (Req 11.3, 11.4).
        if (result.value.status !== "CONFLICT_FLAT") {
          expect(result.value.opposingStrategyIds).toEqual([]);
        }
      }),
      { numRuns: 400 },
    );
  });

  it("exactly one contributor is NEUTRAL regardless of strength (Req 9.10)", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...STRATEGY_IDS),
        fc.constantFrom<SignalDirection>("UP", "DOWN"),
        fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
        (id, direction, strength, alignmentThreshold) => {
          // Single positive-weight, non-FLAT signal; all other weights 0.
          const weights = {} as Record<StrategyId, number>;
          for (const other of STRATEGY_IDS) weights[other] = 0;
          weights[id] = 1;
          const engine = mustEngine({
            weights,
            alignmentThreshold,
          });
          const result = engine.aggregate([mustSignal(id, direction, strength)]);
          expect(result.ok).toBe(true);
          if (!result.ok) return;
          expect(result.value.status).toBe("NEUTRAL");
          expect(result.value.opposingStrategyIds).toEqual([]);
        },
      ),
      { numRuns: 150 },
    );
  });

  it("two aligned contributors cross ALIGNED/NEUTRAL exactly at the alignment threshold", () => {
    fc.assert(
      fc.property(
        fc.subarray([...STRATEGY_IDS], { minLength: 2, maxLength: 2 }),
        // Common strength near a chosen alignment threshold so score ~ ±strength.
        arbThreshold,
        nearValueForScore(),
        (pair, alignmentThreshold, strength) => {
          fc.pre(pair.length === 2);
          const [a, b] = pair as [StrategyId, StrategyId];
          const weights = {} as Record<StrategyId, number>;
          for (const id of STRATEGY_IDS) weights[id] = 0;
          weights[a] = 1;
          weights[b] = 1;
          const engine = mustEngine({
            weights,
            // High conflict threshold so two UP signals never count as a conflict.
            conflictThreshold: 1,
            alignmentThreshold,
          });
          // Both UP with equal strength -> score === strength exactly.
          const signals = [
            mustSignal(a, "UP", strength),
            mustSignal(b, "UP", strength),
          ];
          const result = engine.aggregate(signals);
          expect(result.ok).toBe(true);
          if (!result.ok) return;
          const score = result.value.score;
          // A score of exactly 0 is NEUTRAL regardless of threshold — it
          // expresses no directional lean, and classifying it ALIGNED_UP would
          // break UP/DOWN symmetry when alignmentThreshold is 0 (Req 9.5, 9.8).
          const expectedStatus: ConfluenceStatus =
            score !== 0 && score >= alignmentThreshold ? "ALIGNED_UP" : "NEUTRAL";
          expect(result.value.status).toBe(expectedStatus);
          expect(result.value.opposingStrategyIds).toEqual([]);
        },
      ),
      { numRuns: 200 },
    );
  });
});

/** A strength used to drive a two-contributor score across the alignment boundary. */
function nearValueForScore(): fc.Arbitrary<number> {
  return fc.oneof(
    fc.constantFrom(0, 0.2, 0.4, 0.5, 0.6, 1),
    fc
      .constantFrom(-1e-9, -1e-6, 0, 1e-9, 1e-6)
      .map((d) => Math.min(1, Math.max(0, 0.4 + d))),
    fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
  );
}
