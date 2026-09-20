import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { Horizon } from "../confidence/types.js";
import type { Pair } from "../ingestion/types.js";
import { PAIRS } from "../ingestion/types.js";
import type { DirectionClass, ForwardOutcome } from "../retrieval/types.js";
import { GATE1_SAMPLE_SIZE_FLOOR, type Gate1FiringSample } from "../kill-gate/types.js";
import type { FoldGateInput } from "../kill-gate/verdict.js";
import { LivingDocs, InMemoryDocStore } from "../living-docs/livingDocs.js";
import { FeatureRegistry } from "./featureRegistry.js";
import {
  CANDIDATE_FEATURES,
  InMemoryFeatureRegistryStore,
  type FeatureComputer,
  type FeatureId,
  type ModelConfig,
} from "./types.js";

// Feature: fx-daily-pattern-assistant, Property 25: For all candidate features, a feature is in the included set only if a PASS verdict exists for it; a feature without a PASS verdict is never included.
//
// Validates: Requirements 12.2, 13.2
//
// Build-order discipline: a candidate feature becomes `included` SOLELY through
// a passing Kill_Gate verdict (Requirement 12.2). The registry has no other
// path to inclusion. This property drives every candidate through the registry
// with an arbitrary PASS/CUT outcome and asserts the invariant from both sides:
//
//   1. Soundness — every id returned by `included()` was recorded with a PASS
//      verdict. A feature whose verdict was CUT is NEVER in the included set.
//   2. Completeness (modulo the ceiling) — a candidate that earned a PASS and
//      was admitted under the ≤12 ceiling IS included; because there are only
//      seven candidates the ceiling is never binding here, so every PASS is
//      admitted.
//
// The verdict is driven through a stub FeatureComputer that fabricates one
// qualifying walk-forward fold per config. Whether that fold passes both gates
// (=> PASS verdict) or fails Gate 1 (=> CUT verdict) is dictated by a
// per-feature outcome map supplied by fast-check.

/**
 * Build a matched firing subset of `size` Decision_Dates whose model-minus-
 * baseline directional accuracy either clears the +3pp Gate 1 margin
 * (`gate1Pass`) or misses it entirely (delta 0).
 */
function buildFiringSubset(size: number, gate1Pass: boolean): Gate1FiringSample[] {
  const out: Gate1FiringSample[] = [];
  for (let i = 0; i < size; i += 1) {
    const decisionDate = `2020-02-${String((i % 28) + 1).padStart(2, "0")}`;
    if (gate1Pass) {
      // model correct, baseline wrong ⇒ delta 1.0 (>= 0.03).
      out.push({
        decisionDate,
        modelPrediction: "UP",
        baselinePrediction: "DOWN",
        actual: "UP",
      });
    } else {
      // model and baseline both wrong ⇒ delta 0 (< 0.03).
      out.push({
        decisionDate,
        modelPrediction: "DOWN",
        baselinePrediction: "DOWN",
        actual: "UP",
      });
    }
  }
  return out;
}

/** A forward outcome carrying the given MFE/MAE on every horizon. */
function outcomeWith(mfePips: number, maePips: number): ForwardOutcome {
  const h = { direction: "FLAT" as DirectionClass, mfePips, maePips };
  return { perHorizon: { 1: h, 2: h, 3: h } };
}

/**
 * A stub {@link FeatureComputer} that fabricates exactly one qualifying fold
 * per config. The config's newest-toggled candidate determines the outcome via
 * `outcomes`: a PASS config passes both gates; a CUT config fails Gate 1.
 *
 * The registry always toggles a single candidate onto an empty base, so the
 * config's sole feature identifies which candidate is under test.
 */
class StubFeatureComputer implements FeatureComputer {
  constructor(
    private readonly outcomes: Readonly<Record<FeatureId, boolean>>,
    private readonly pair: Pair,
    private readonly horizon: Horizon,
  ) {}

  gateInputsFor(config: ModelConfig): readonly FoldGateInput[] {
    // The candidate under test is the last feature toggled on. Since the base
    // is empty, it is simply the single feature present.
    const candidate = config.features[config.features.length - 1];
    const pass = candidate !== undefined ? this.outcomes[candidate] : false;

    const firingSubset = buildFiringSubset(GATE1_SAMPLE_SIZE_FLOOR, pass);
    // Gate 2 margin is model minus baseline risk-adjusted; a big favorable
    // model excursion clears it. It only matters when Gate 1 passes.
    const model = pass ? outcomeWith(50, 5) : outcomeWith(5, 50);
    const baseline = pass ? outcomeWith(5, 50) : outcomeWith(50, 5);

    return [
      {
        foldIndex: 0,
        pair: this.pair,
        horizon: this.horizon,
        firingSubset,
        modelOutcomes: firingSubset.map(() => model),
        baselineOutcomes: firingSubset.map(() => baseline),
      },
    ];
  }
}

/** An outcome map assigning each candidate feature a PASS (true) / CUT (false). */
const outcomeMapArb: fc.Arbitrary<Record<FeatureId, boolean>> = fc.record(
  Object.fromEntries(CANDIDATE_FEATURES.map((id) => [id, fc.boolean()])) as {
    [K in FeatureId]: fc.Arbitrary<boolean>;
  },
);

function makeRegistry(
  outcomes: Record<FeatureId, boolean>,
  pair: Pair,
  horizon: Horizon,
): FeatureRegistry {
  const docs = new LivingDocs(new InMemoryDocStore());
  return new FeatureRegistry({
    computer: new StubFeatureComputer(outcomes, pair, horizon),
    store: new InMemoryFeatureRegistryStore(),
    docs,
  });
}

function baseConfig(pair: Pair, horizon: Horizon): ModelConfig {
  return { configId: "base-p25", features: [], pair, horizon };
}

describe("Property 25: inclusion requires a passing verdict", () => {
  it("included() only ever contains features whose verdict was PASS; a feature without a PASS is never included", async () => {
    await fc.assert(
      fc.asyncProperty(
        outcomeMapArb,
        fc.constantFrom(...PAIRS),
        fc.constantFrom<Horizon>(1, 2, 3),
        // Evaluate candidates in an arbitrary order to show inclusion does not
        // depend on evaluation sequence.
        fc.shuffledSubarray([...CANDIDATE_FEATURES], {
          minLength: CANDIDATE_FEATURES.length,
          maxLength: CANDIDATE_FEATURES.length,
        }),
        async (outcomes, pair, horizon, order) => {
          const registry = makeRegistry(outcomes, pair, horizon);
          const base = baseConfig(pair, horizon);

          const passedVerdict = new Set<FeatureId>();
          for (const candidate of order) {
            const evaluation = await registry.evaluateAndRecord(candidate, base);
            // Record the ACTUAL verdict the gate produced for this candidate.
            if (evaluation.verdict.verdict === "PASS") {
              passedVerdict.add(candidate);
            }
            // The evaluation's own verdict must agree with the driven outcome.
            expect(evaluation.verdict.verdict).toBe(outcomes[candidate] ? "PASS" : "CUT");
          }

          const included = await registry.included();

          // Soundness: every included feature has a PASS verdict on record.
          for (const id of included) {
            expect(passedVerdict.has(id)).toBe(true);
          }

          // No feature that failed to earn a PASS is ever included.
          for (const id of CANDIDATE_FEATURES) {
            if (!passedVerdict.has(id)) {
              expect(included).not.toContain(id);
            }
          }

          // Completeness (ceiling not binding for 7 candidates): every PASS is
          // included, so the included set equals exactly the PASS set.
          expect(new Set(included)).toEqual(passedVerdict);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("a candidate whose verdict is CUT is never admitted, regardless of how many others pass", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...CANDIDATE_FEATURES),
        fc.constantFrom(...PAIRS),
        fc.constantFrom<Horizon>(1, 2, 3),
        async (cutFeature, pair, horizon) => {
          // Everyone passes except the singled-out feature.
          const outcomes = Object.fromEntries(
            CANDIDATE_FEATURES.map((id) => [id, id !== cutFeature]),
          ) as Record<FeatureId, boolean>;

          const registry = makeRegistry(outcomes, pair, horizon);
          const base = baseConfig(pair, horizon);

          for (const candidate of CANDIDATE_FEATURES) {
            await registry.evaluateAndRecord(candidate, base);
          }

          const included = await registry.included();
          // The CUT feature is absent; every PASS feature is present.
          expect(included).not.toContain(cutFeature);
          for (const id of CANDIDATE_FEATURES) {
            if (id !== cutFeature) expect(included).toContain(id);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("with no evaluations recorded, the included set is empty (no PASS => nothing included)", async () => {
    const outcomes = Object.fromEntries(
      CANDIDATE_FEATURES.map((id) => [id, true]),
    ) as Record<FeatureId, boolean>;
    const registry = makeRegistry(outcomes, "EURUSD", 1);
    expect(await registry.included()).toEqual([]);
  });
});
