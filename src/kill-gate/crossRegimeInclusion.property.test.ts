import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { DirectionClass, ForwardOutcome } from "../retrieval/types.js";
import type { Horizon } from "../confidence/types.js";
import type { Pair } from "../ingestion/types.js";
import { PAIRS } from "../ingestion/types.js";
import { composeGateVerdict, type FoldGateInput } from "./verdict.js";
import { GATE1_SAMPLE_SIZE_FLOOR, type Gate1FiringSample } from "./types.js";

// Feature: fx-daily-pattern-assistant, Property 37: For all candidate configurations, a feature/config is admitted only if it passes both Gate_1 and Gate_2 on every qualifying walk-forward fold; folds below the >=30-sample floor are skipped and recorded, and a single failing qualifying fold blocks inclusion.
//
// Validates: Requirements 11.13, 19.3, 19.5
//
// This is the mandated "cross-regime inclusion test". A config is evaluated
// across MULTIPLE sequential walk-forward folds (each fold is a distinct market
// regime). Inclusion (aggregate verdict PASS) requires that BOTH Gate 1 and
// Gate 2 pass on EVERY qualifying fold — a fold whose matched firing subset
// meets the >=30-sample floor (Requirement 11.13, 19.3). Folds below the floor
// are SKIPPED, still recorded in `foldVerdicts`, and excluded from the pass/fail
// (Requirement 19.5). A single failing qualifying fold blocks inclusion => CUT.
//
// The headline case: a feature that passes on RECENT data but fails on an
// EARLIER-regime fold must NOT be included. The composition (verdict.ts) sorts
// folds by `foldIndex`, so fold 0 is the earlier regime and higher indices are
// more recent; a failure on fold 0 blocks inclusion regardless of a later pass.

/**
 * Build a firing subset of `size` matched Decision_Dates whose model-minus-
 * baseline directional accuracy either clears the +3pp Gate 1 margin
 * (`gate1Pass`) or clearly misses it (delta 0). Mirrors the builder in
 * verdictComposition.property.test.ts.
 */
function buildFiringSubset(
  size: number,
  gate1Pass: boolean,
): Gate1FiringSample[] {
  const out: Gate1FiringSample[] = [];
  for (let i = 0; i < size; i += 1) {
    const decisionDate = `2020-01-${String((i % 28) + 1).padStart(2, "0")}`;
    if (gate1Pass) {
      // model correct (UP == UP), baseline wrong (DOWN != UP) ⇒ delta 1.0.
      out.push({
        decisionDate,
        modelPrediction: "UP",
        baselinePrediction: "DOWN",
        actual: "UP",
      });
    } else {
      // model and baseline both wrong and identical ⇒ delta 0 < 0.03.
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

/** A forward outcome carrying a chosen MFE/MAE on every horizon. */
function outcomeWith(mfePips: number, maePips: number): ForwardOutcome {
  const h = { direction: "FLAT" as DirectionClass, mfePips, maePips };
  return { perHorizon: { 1: h, 2: h, 3: h } };
}

/**
 * Build a single walk-forward fold with independently controllable
 * (gate1Pass, gate2Pass) and firing-subset `size`. When `size >= 30` the fold
 * qualifies; below that it is skipped. Mirrors the `buildFold` helper in
 * verdictComposition.property.test.ts.
 *
 * Gate 2's margin is `modelRiskAdj - baselineRiskAdj`; giving the model a much
 * larger favorable excursion than the baseline makes margin > 0 (pass), and the
 * reverse makes margin < 0 (fail). Excursions dominate the <=2 pip friction so
 * the sign is unambiguous.
 */
function buildFold(
  foldIndex: number,
  pair: Pair,
  horizon: Horizon,
  size: number,
  gate1Pass: boolean,
  gate2Pass: boolean,
): FoldGateInput {
  const firingSubset = buildFiringSubset(size, gate1Pass);

  const model = gate2Pass ? outcomeWith(50, 5) : outcomeWith(5, 50);
  const baseline = gate2Pass ? outcomeWith(5, 50) : outcomeWith(50, 5);

  const modelOutcomes = firingSubset.map(() => model);
  const baselineOutcomes = firingSubset.map(() => baseline);

  return {
    foldIndex,
    pair,
    horizon,
    firingSubset,
    modelOutcomes,
    baselineOutcomes,
  };
}

/** A qualifying firing-subset size (>= the 30-sample floor). */
const qualifyingSizeArb: fc.Arbitrary<number> = fc.integer({
  min: GATE1_SAMPLE_SIZE_FLOOR,
  max: GATE1_SAMPLE_SIZE_FLOOR + 20,
});

/** A below-floor firing-subset size (skipped fold). */
const skippedSizeArb: fc.Arbitrary<number> = fc.integer({
  min: 0,
  max: GATE1_SAMPLE_SIZE_FLOOR - 1,
});

describe("Property 37: cross-regime inclusion — PASS iff every qualifying fold passes both gates", () => {
  it("aggregate verdict is PASS iff >=1 qualifying fold AND every qualifying fold passes BOTH gates; any single qualifying failure => CUT", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...PAIRS),
        fc.constantFrom<Horizon>(1, 2, 3),
        // 2-4 qualifying folds, each with its own (gate1Pass, gate2Pass, size).
        fc.array(
          fc.record({
            size: qualifyingSizeArb,
            gate1Pass: fc.boolean(),
            gate2Pass: fc.boolean(),
          }),
          { minLength: 2, maxLength: 4 },
        ),
        (pair, horizon, foldSpecs) => {
          const folds = foldSpecs.map((spec, i) =>
            buildFold(i, pair, horizon, spec.size, spec.gate1Pass, spec.gate2Pass),
          );
          const verdict = composeGateVerdict("cfg-p37", folds);

          // Every fold here is qualifying (size >= floor); none skipped.
          expect(verdict.metrics.qualifyingFolds).toBe(folds.length);
          expect(verdict.metrics.skippedFolds).toBe(0);

          // A fold passes iff Gate 1 passes AND (Gate 2 then also passes).
          // Gate 2 is only evaluated after Gate 1 passes, so a fold's true
          // pass state is `gate1Pass && gate2Pass`.
          const everyFoldPasses = foldSpecs.every(
            (s) => s.gate1Pass && s.gate2Pass,
          );
          const expected = everyFoldPasses ? "PASS" : "CUT";
          expect(verdict.verdict).toBe(expected);

          // Each recorded per-fold verdict agrees with its own gate results.
          for (let i = 0; i < foldSpecs.length; i += 1) {
            const spec = foldSpecs[i];
            const fv = verdict.foldVerdicts.find((f) => f.foldIndex === i);
            expect(fv).toBeDefined();
            expect(fv?.skipped).toBe(false);
            const foldPasses = spec !== undefined && spec.gate1Pass && spec.gate2Pass;
            expect(fv?.verdict).toBe(foldPasses ? "PASS" : "CUT");
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("mandated cross-regime case: passes on the recent fold but fails on the earlier-regime fold => CUT (not included)", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...PAIRS),
        fc.constantFrom<Horizon>(1, 2, 3),
        qualifyingSizeArb,
        qualifyingSizeArb,
        // Which gate the earlier-regime fold fails on (both cases must block).
        fc.boolean(),
        (pair, horizon, earlierSize, recentSize, earlierFailsGate1) => {
          // fold 0 = earlier regime (fails a gate); fold 1 = recent (passes both).
          const earlier = earlierFailsGate1
            ? buildFold(0, pair, horizon, earlierSize, false, true) // fails Gate 1
            : buildFold(0, pair, horizon, earlierSize, true, false); // passes G1, fails G2
          const recent = buildFold(1, pair, horizon, recentSize, true, true);

          const verdict = composeGateVerdict("cfg-p37-cross", [earlier, recent]);

          // Both folds qualify; the recent fold genuinely passes both gates.
          expect(verdict.metrics.qualifyingFolds).toBe(2);
          const recentFv = verdict.foldVerdicts.find((f) => f.foldIndex === 1);
          expect(recentFv?.verdict).toBe("PASS");

          // The earlier-regime fold fails, so inclusion is blocked despite the
          // recent pass: the config must be CUT (not included).
          const earlierFv = verdict.foldVerdicts.find((f) => f.foldIndex === 0);
          expect(earlierFv?.verdict).toBe("CUT");
          expect(verdict.verdict).toBe("CUT");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("explicit earlier-regime failure blocks inclusion even though the recent fold passes both gates", () => {
    // Fold 0 (earlier regime) fails Gate 1; fold 1 (recent) passes both.
    const earlier = buildFold(0, "EURUSD", 1, GATE1_SAMPLE_SIZE_FLOOR, false, true);
    const recent = buildFold(1, "EURUSD", 1, GATE1_SAMPLE_SIZE_FLOOR, true, true);
    const verdict = composeGateVerdict("cfg-p37-explicit", [earlier, recent]);

    expect(verdict.foldVerdicts.find((f) => f.foldIndex === 1)?.verdict).toBe("PASS");
    expect(verdict.foldVerdicts.find((f) => f.foldIndex === 0)?.verdict).toBe("CUT");
    expect(verdict.verdict).toBe("CUT");
  });

  it("skipped folds are recorded and excluded: a config passing all its qualifying folds is still PASS even with skipped folds present", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...PAIRS),
        fc.constantFrom<Horizon>(1, 2, 3),
        qualifyingSizeArb,
        skippedSizeArb,
        (pair, horizon, qualSize, skipSize) => {
          // fold 0 skipped (below floor); fold 1 qualifying and passing both.
          const skippedFold = buildFold(0, pair, horizon, skipSize, true, true);
          const qualFold = buildFold(1, pair, horizon, qualSize, true, true);

          const verdict = composeGateVerdict("cfg-p37-skip", [
            skippedFold,
            qualFold,
          ]);

          const skippedFv = verdict.foldVerdicts.find((f) => f.foldIndex === 0);
          const qualFv = verdict.foldVerdicts.find((f) => f.foldIndex === 1);

          // The below-floor fold is recorded and marked skipped, excluded from
          // pass/fail (Req 19.5).
          expect(skippedFv).toBeDefined();
          expect(skippedFv?.skipped).toBe(true);
          expect(qualFv?.skipped).toBe(false);

          expect(verdict.metrics.qualifyingFolds).toBe(1);
          expect(verdict.metrics.skippedFolds).toBe(1);
          expect(verdict.metrics.totalFolds).toBe(2);

          // The single qualifying fold passes both gates ⇒ PASS despite a skip.
          expect(verdict.verdict).toBe("PASS");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("a config with ONLY skipped folds (no qualifying fold) is CUT — nothing was proven out-of-sample", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...PAIRS),
        fc.constantFrom<Horizon>(1, 2, 3),
        fc.array(skippedSizeArb, { minLength: 1, maxLength: 3 }),
        (pair, horizon, sizes) => {
          const folds = sizes.map((size, i) =>
            // Gate settings are irrelevant: below-floor folds never qualify.
            buildFold(i, pair, horizon, size, true, true),
          );
          const verdict = composeGateVerdict("cfg-p37-allskip", folds);

          expect(verdict.metrics.qualifyingFolds).toBe(0);
          expect(verdict.metrics.skippedFolds).toBe(folds.length);
          for (const fv of verdict.foldVerdicts) {
            expect(fv.skipped).toBe(true);
          }
          expect(verdict.verdict).toBe("CUT");
        },
      ),
      { numRuns: 100 },
    );
  });
});
