import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { DirectionClass, ForwardOutcome } from "../retrieval/types.js";
import type { FoldGateInput } from "../kill-gate/verdict.js";
import { GATE1_SAMPLE_SIZE_FLOOR, type Gate1FiringSample } from "../kill-gate/types.js";
import type { LivingDocs } from "../living-docs/livingDocs.js";
import { FeatureRegistry } from "./featureRegistry.js";
import {
  CANDIDATE_FEATURES,
  FEATURE_CEILING,
  InMemoryFeatureRegistryStore,
  type FeatureComputer,
  type FeatureId,
  type FeatureRegistryRow,
  type ModelConfig,
} from "./types.js";

// Feature: fx-daily-pattern-assistant, Property 26: For all sequences of feature inclusions, the count of included features never exceeds 12.
//
// Validates: Requirement 13.4
//
// The Feature Registry admits candidates one-at-a-time through the Kill_Gate
// and retains passers as `included`, subject to a HARD ceiling of ≤12
// (FEATURE_CEILING). This property asserts the ceiling invariant holds across
// arbitrary sequences of inclusion attempts and arbitrary PASS/CUT verdicts:
// no matter how the sequence unfolds, `included().length` is always ≤ 12.
//
// Two complementary paths are exercised:
//   1. The orchestration path — driving evaluateAndRecord() over arbitrary
//      candidate/verdict sequences and asserting the invariant after every step.
//   2. The defensive-cap path — reading `included()` from a store seeded with
//      an arbitrary number of `included` rows, asserting it never returns more
//      than the ceiling even if the store somehow held more.

/** A no-op LivingDocs double: the registry only calls appendCut/appendVerdict. */
const noopDocs = {
  appendCut(): Promise<void> {
    return Promise.resolve();
  },
  appendVerdict(): Promise<void> {
    return Promise.resolve();
  },
} as unknown as LivingDocs;

const UP: DirectionClass = "UP";
const DOWN: DirectionClass = "DOWN";

/** A firing Decision_Date sample where model and baseline predictions match the plan. */
function firingSample(i: number, modelCorrect: boolean, baselineCorrect: boolean): Gate1FiringSample {
  const actual = UP;
  return {
    decisionDate: `2020-01-${String((i % 28) + 1).padStart(2, "0")}`,
    modelPrediction: modelCorrect ? actual : DOWN,
    baselinePrediction: baselineCorrect ? actual : DOWN,
    actual,
  };
}

/** A forward outcome with a fixed favorable/adverse excursion across all horizons. */
function outcome(mfePips: number, maePips: number): ForwardOutcome {
  const h = { direction: UP, mfePips, maePips };
  return { perHorizon: { 1: h, 2: h, 3: h } };
}

/**
 * A single qualifying fold engineered to yield a PASS or a CUT verdict through
 * the REAL composeGateVerdict path.
 *
 *   - PASS: model beats baseline by a wide margin on both gates over a subset
 *     comfortably above the ≥30-sample floor.
 *   - CUT: model is strictly worse than baseline on Gate 1, so the fold fails.
 */
function foldFor(pass: boolean): FoldGateInput {
  const size = GATE1_SAMPLE_SIZE_FLOOR + 20; // clears the floor
  const firingSubset: Gate1FiringSample[] = [];
  const modelOutcomes: ForwardOutcome[] = [];
  const baselineOutcomes: ForwardOutcome[] = [];

  for (let i = 0; i < size; i += 1) {
    if (pass) {
      // Model correct on all dates; baseline correct on none => deltaPp = 1.0.
      firingSubset.push(firingSample(i, true, false));
      // Model strong favorable excursion; baseline strong adverse => Gate 2 margin > 0.
      modelOutcomes.push(outcome(50, 5));
      baselineOutcomes.push(outcome(5, 50));
    } else {
      // Model correct on none; baseline correct on all => deltaPp = -1.0 (fails Gate 1).
      firingSubset.push(firingSample(i, false, true));
      modelOutcomes.push(outcome(5, 50));
      baselineOutcomes.push(outcome(50, 5));
    }
  }

  return {
    foldIndex: 0,
    pair: "EURUSD",
    horizon: 1,
    firingSubset,
    modelOutcomes,
    baselineOutcomes,
  };
}

const PASS_FOLDS: readonly FoldGateInput[] = [foldFor(true)];
const CUT_FOLDS: readonly FoldGateInput[] = [foldFor(false)];

/**
 * A FeatureComputer whose verdict is decided by a caller-controlled predicate
 * over the toggled config's feature set. It maps the LAST feature toggled ON to
 * a PASS/CUT decision supplied via `shouldPass`, letting the property drive an
 * arbitrary verdict for each inclusion attempt.
 */
class ScriptedComputer implements FeatureComputer {
  #shouldPass: (features: readonly FeatureId[]) => boolean;

  constructor(shouldPass: (features: readonly FeatureId[]) => boolean) {
    this.#shouldPass = shouldPass;
  }

  gateInputsFor(config: ModelConfig): readonly FoldGateInput[] {
    return this.#shouldPass(config.features) ? PASS_FOLDS : CUT_FOLDS;
  }
}

const candidateArb: fc.Arbitrary<FeatureId> = fc.constantFrom(...CANDIDATE_FEATURES);

/** An arbitrary evaluation step: a candidate to toggle and whether it should PASS. */
const stepArb = fc.record({
  candidate: candidateArb,
  pass: fc.boolean(),
});

const baseConfig: ModelConfig = {
  configId: "base",
  features: [],
  pair: "EURUSD",
  horizon: 1,
};

describe("Property 26: the included-feature count never exceeds the ceiling of 12", () => {
  it("holds after every step of an arbitrary sequence of inclusion attempts and verdicts", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(stepArb, { minLength: 0, maxLength: 40 }),
        async (steps) => {
          const store = new InMemoryFeatureRegistryStore();
          // The verdict for a config is driven by the most-recently toggled
          // candidate's scripted decision.
          const passSet = new Map<FeatureId, boolean>();
          const registry = new FeatureRegistry({
            computer: new ScriptedComputer((features) => {
              // The candidate under test is the last feature in the toggled set
              // (withFeature normalizes to canonical order, so read the map by id).
              return features.every((f) => passSet.get(f) ?? true);
            }),
            store,
            docs: noopDocs,
          });

          for (const step of steps) {
            passSet.set(step.candidate, step.pass);
            await registry.evaluateAndRecord(step.candidate, baseConfig);

            // The invariant: included never exceeds the ceiling, at every step.
            const included = await registry.included();
            expect(included.length).toBeLessThanOrEqual(FEATURE_CEILING);
          }

          // And once more at the end of the whole sequence.
          const finalIncluded = await registry.included();
          expect(finalIncluded.length).toBeLessThanOrEqual(FEATURE_CEILING);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("defensively caps included() even when the store holds more than the ceiling of included rows", async () => {
    await fc.assert(
      fc.asyncProperty(
        // An arbitrary subset of candidates flagged `included` in the store.
        fc.array(fc.constantFrom(...CANDIDATE_FEATURES), { minLength: 0, maxLength: 30 }),
        async (includedIds) => {
          const rows: FeatureRegistryRow[] = CANDIDATE_FEATURES.map((featureId) => ({
            featureId,
            status: includedIds.includes(featureId) ? "included" : "cut",
            verdictId: null,
          }));
          const store = new InMemoryFeatureRegistryStore(rows);
          const registry = new FeatureRegistry({
            computer: new ScriptedComputer(() => true),
            store,
            docs: noopDocs,
          });

          const included = await registry.included();
          expect(included.length).toBeLessThanOrEqual(FEATURE_CEILING);
        },
      ),
      { numRuns: 200 },
    );
  });
});
