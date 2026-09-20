import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { PAIRS, type Pair } from "../ingestion/types.js";
import type { Horizon } from "../confidence/types.js";
import type { DirectionClass, ForwardOutcome } from "../retrieval/types.js";
import type { FoldGateInput } from "../kill-gate/verdict.js";
import type { GateVerdict, Gate1FiringSample } from "../kill-gate/types.js";
import {
  FeatureRegistry,
  withFeature,
  type FeatureRegistryDeps,
} from "./featureRegistry.js";
import {
  CANDIDATE_FEATURES,
  InMemoryFeatureRegistryStore,
  type FeatureId,
  type FeatureComputer,
  type ModelConfig,
} from "./types.js";
import type { LivingDocs } from "../living-docs/livingDocs.js";

// Feature: fx-daily-pattern-assistant, Property 1: For all features toggled independently with otherwise-unchanged config, the prior verdict is reproduced.
//
// Validates: Requirements 3.1, 13.7
//
// Requirement 3.1 (determinism): given the same inputs, the pipeline reproduces
// the same outputs. Requirement 13.7: toggling a feature on an
// otherwise-unchanged configuration reproduces the prior verdict.
//
// `FeatureRegistry.evaluateOneAtATime(candidate, baseConfig)` is a pure function
// of the toggled `ModelConfig`: it derives `withFeature(baseConfig, candidate)`,
// asks the injected `FeatureComputer` for that config's per-fold gate inputs,
// and composes the verdict via `composeGateVerdict`. To exercise this property
// without the real (unimplemented) feature computations, we inject a
// DETERMINISTIC `FeatureComputer` stub that is a pure function of the config —
// identical configs (same `configId` + toggled `features` set + `pair` +
// `horizon`) always produce identical gate inputs, and therefore identical
// verdicts. This isolates the registry's reproducibility guarantee.

const DIRECTIONS: readonly DirectionClass[] = ["UP", "DOWN", "FLAT"] as const;

/** A small deterministic string hash (FNV-1a) — no randomness, no I/O. */
function hashString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    // 32-bit FNV prime multiply via shifts, kept in the unsigned range.
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Map a non-negative integer onto a DirectionClass, deterministically. */
function directionFromSeed(seed: number): DirectionClass {
  return DIRECTIONS[seed % DIRECTIONS.length] as DirectionClass;
}

/**
 * A deterministic `FeatureComputer` stub keyed ENTIRELY on the config. It
 * derives every fold's matched firing subset and model/baseline excursions from
 * a hash of the config's identity (`configId` + normalized `features` set +
 * `pair` + `horizon`). Because `withFeature` normalizes the feature list to the
 * canonical candidate order, two configs with the same toggled feature SET hash
 * identically and thus yield identical gate inputs — the invariant the property
 * relies on. There is no hidden state, clock, or randomness.
 */
class DeterministicFeatureComputer implements FeatureComputer {
  gateInputsFor(config: ModelConfig): readonly FoldGateInput[] {
    // A stable key for the config's identity. `features` is already normalized
    // to canonical order by `withFeature`, but we sort defensively so the key
    // is invariant to any incidental ordering differences.
    const featureKey = [...config.features].sort().join(",");
    const configKey = `${config.configId}|${featureKey}|${config.pair}|${config.horizon}`;
    const base = hashString(configKey);

    // Derive a deterministic number of folds (2..4) and populate each with a
    // matched firing subset sized around the ≥30-sample floor so verdicts vary
    // across configs (some PASS, some CUT, some SKIP) — this makes the
    // reproducibility assertions meaningful rather than trivially constant.
    const foldCount = 2 + (base % 3);
    const folds: FoldGateInput[] = [];

    for (let foldIndex = 0; foldIndex < foldCount; foldIndex += 1) {
      const foldSeed = hashString(`${configKey}#${foldIndex}`);
      // Subset size in [20, 55] so some folds fall below the 30-floor (skipped)
      // and some qualify — exercising both branches deterministically.
      const subsetSize = 20 + (foldSeed % 36);

      const firingSubset: Gate1FiringSample[] = [];
      const modelOutcomes: ForwardOutcome[] = [];
      const baselineOutcomes: ForwardOutcome[] = [];

      for (let i = 0; i < subsetSize; i += 1) {
        const rowSeed = hashString(`${configKey}#${foldIndex}#${i}`);
        const modelPrediction = directionFromSeed(rowSeed);
        const baselinePrediction = directionFromSeed(rowSeed >>> 3);
        const actual = directionFromSeed(rowSeed >>> 6);

        // Deterministic ISO date string derived from the row seed.
        const day = 1 + (rowSeed % 28);
        const month = 1 + ((rowSeed >>> 5) % 12);
        const decisionDate = `2020-${String(month).padStart(2, "0")}-${String(
          day,
        ).padStart(2, "0")}`;

        firingSubset.push({
          decisionDate,
          modelPrediction,
          baselinePrediction,
          actual,
        });

        modelOutcomes.push(excursionFromSeed(rowSeed, modelPrediction));
        baselineOutcomes.push(
          excursionFromSeed(rowSeed >>> 9, baselinePrediction),
        );
      }

      folds.push({
        foldIndex,
        pair: config.pair,
        horizon: config.horizon,
        firingSubset,
        modelOutcomes,
        baselineOutcomes,
      });
    }

    return folds;
  }
}

/** Build a deterministic ForwardOutcome from a seed (bounded pip excursions). */
function excursionFromSeed(
  seed: number,
  direction: DirectionClass,
): ForwardOutcome {
  const mfe = (seed % 100) + 1; // 1..100 pips
  const mae = ((seed >>> 7) % 100) + 1; // 1..100 pips
  const h = { direction, mfePips: mfe, maePips: mae };
  return { perHorizon: { 1: h, 2: h, 3: h } };
}

const pairArb: fc.Arbitrary<Pair> = fc.constantFrom(...PAIRS);
const horizonArb: fc.Arbitrary<Horizon> = fc.constantFrom(1, 2, 3);
const featureIdArb: fc.Arbitrary<FeatureId> = fc.constantFrom(
  ...CANDIDATE_FEATURES,
);

/** A subset of the candidate features to seed the base config's toggles. */
const featureSubsetArb: fc.Arbitrary<readonly FeatureId[]> = fc
  .subarray([...CANDIDATE_FEATURES])
  .map((xs) => xs);

const baseConfigArb: fc.Arbitrary<ModelConfig> = fc.record({
  configId: fc
    .string({ minLength: 1, maxLength: 16 })
    .map((s) => `cfg-${s.replace(/\|/g, "_")}`),
  features: featureSubsetArb,
  pair: pairArb,
  horizon: horizonArb,
});

/**
 * Deep structural equality on GateVerdict. We compare the JSON projection since
 * a GateVerdict is a plain, fully-serializable data structure (no functions,
 * no undefined-valued keys, finite numbers throughout the composition).
 */
function verdictsEqual(a: GateVerdict, b: GateVerdict): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function makeRegistry(): FeatureRegistry {
  // `evaluateOneAtATime` is a PURE function of the config: it never reads the
  // store nor writes to docs (those effects live only in `evaluateAndRecord`,
  // which this property does not exercise). So a real in-memory store and a
  // no-op docs stub suffice — the docs path is never taken here.
  const docs = {
    appendVerdict: () => Promise.resolve(),
    appendCut: () => Promise.resolve(),
  } as unknown as LivingDocs;

  const deps: FeatureRegistryDeps = {
    computer: new DeterministicFeatureComputer(),
    store: new InMemoryFeatureRegistryStore(),
    docs,
  };
  return new FeatureRegistry(deps);
}

describe("Property 1: reproducible verdict on independent feature toggle", () => {
  // Part (1) — Determinism (Requirement 3.1): evaluating the SAME candidate on
  // the SAME base config twice yields byte-identical GateVerdict outputs. The
  // deterministic FeatureComputer stub keyed on config guarantees identical gate
  // inputs, and composeGateVerdict is pure, so the verdicts must match exactly.
  it("reproduces an identical verdict when the same candidate is evaluated twice on the same base config", () => {
    fc.assert(
      fc.property(
        baseConfigArb,
        featureIdArb,
        (baseConfig, candidate) => {
          const registry = makeRegistry();

          const first = registry.evaluateOneAtATime(candidate, baseConfig);
          const second = registry.evaluateOneAtATime(candidate, baseConfig);

          expect(verdictsEqual(first, second)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  // Part (2) — Toggle reproducibility (Requirement 13.7): toggling a feature on
  // an OTHERWISE-UNCHANGED config reproduces the prior verdict. When the toggled
  // candidate is ALREADY present in the base config's feature set, the derived
  // toggled config is identical (withFeature is idempotent + order-normalized),
  // so re-evaluating reproduces the prior verdict exactly.
  it("reproduces the prior verdict when toggling a feature that is already present (otherwise-unchanged config)", () => {
    fc.assert(
      fc.property(
        baseConfigArb,
        featureIdArb,
        (baseConfig, candidate) => {
          const registry = makeRegistry();

          // Establish the prior verdict by first toggling the candidate ON,
          // producing a config where the candidate is now present.
          const priorConfig = withFeature(baseConfig, candidate);
          const priorVerdict = registry.evaluateOneAtATime(
            candidate,
            baseConfig,
          );

          // Re-toggle the SAME candidate on the (now otherwise-unchanged) config
          // that already contains it. The toggle is a no-op on the feature set,
          // so the verdict must be reproduced identically (Req 13.7).
          const reproduced = registry.evaluateOneAtATime(
            candidate,
            priorConfig,
          );

          expect(verdictsEqual(reproduced, priorVerdict)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  // Part (3) — Independent toggles commute on the config identity: because a
  // ModelConfig is fully described by its configId + toggled feature SET +
  // pair + horizon (order-independent), toggling two features in either order
  // on the same base yields the same config and therefore the same verdict.
  // This is the "toggled independently with otherwise-unchanged config"
  // guarantee at the heart of Property 1 (Req 13.7).
  it("yields the same verdict regardless of the order two independent features are toggled", () => {
    fc.assert(
      fc.property(
        baseConfigArb,
        featureIdArb,
        featureIdArb,
        (baseConfig, a, b) => {
          const registry = makeRegistry();

          // Toggle a then b.
          const abConfig = withFeature(withFeature(baseConfig, a), b);
          // Toggle b then a.
          const baConfig = withFeature(withFeature(baseConfig, b), a);

          // The registry evaluates the final toggled config; evaluating the
          // last-toggled candidate on each path reflects the same feature set.
          const abVerdict = registry.evaluateOneAtATime(b, withFeature(baseConfig, a));
          const baVerdict = registry.evaluateOneAtATime(a, withFeature(baseConfig, b));

          // The two derived configs are structurally identical (same feature
          // set, same everything else), so their verdicts must match.
          expect(abConfig.features).toEqual(baConfig.features);
          expect(verdictsEqual(abVerdict, baVerdict)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });
});
