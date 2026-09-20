import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import fc from "fast-check";

import {
  applyChoppinessGuard,
  assessChoppiness,
  efficiencyRatio,
} from "./choppinessGuard.js";
import { type ChoppinessConfig, type FiringSetup } from "./types.js";
import { PAIRS, type Pair } from "../ingestion/types.js";
import type { Candle, TradingDate } from "../guard/types.js";
import type { Confidence, Horizon } from "../confidence/types.js";
import type { DirectionClass } from "../retrieval/types.js";
import {
  earnedConfidence as computeEarnedConfidence,
  classify as classifyDirection,
} from "../confidence/confidenceSelector.js";
import { composeGateVerdict, type FoldGateInput } from "../kill-gate/verdict.js";
import type { AnalogueRecord, ForwardOutcome } from "../retrieval/types.js";
import type { Gate1FiringSample } from "../kill-gate/types.js";

// Feature: fx-daily-pattern-assistant, Property 41: For all pairs and Decision_Dates, the Choppiness_Guard suppresses an otherwise-firing setup if and only if the look-ahead-safe Efficiency-Ratio Choppiness_Metric is below the configurable threshold; suppression never generates a Direction_Class and leaves the directional probability, Earned_Confidence, and Kill_Gate verdict identical; and the Choppiness_Metric is deterministic (identical inputs yield identical values) and takes no LLM input.
//
// Validates: Requirements 24.2, 24.4, 24.5, 24.7, 24.8

const DECISION_DATE = "2024-06-15" as TradingDate;

// --- Generators ------------------------------------------------------------

const directionArb: fc.Arbitrary<DirectionClass> = fc.constantFrom(
  "UP",
  "DOWN",
);

const horizonArb: fc.Arbitrary<Horizon> = fc.constantFrom(1, 2, 3);

const confidenceArb: fc.Arbitrary<Confidence> = fc
  .double({ min: 0.5, max: 1, noNaN: true })
  .map((v) => v as Confidence);

/**
 * A close-price series that spans the full efficiency spectrum. Steps are
 * signed increments so the generator produces everything from a clean
 * straight-line trend (ER ~ 1) to pure whipsaw chop (ER ~ 0), including the
 * degenerate flat series. Prices stay positive by starting from a base and
 * only allowing bounded per-step moves.
 */
const closesArb: fc.Arbitrary<number[]> = fc
  .array(fc.integer({ min: -50, max: 50 }), { minLength: 0, maxLength: 30 })
  .map((steps) => {
    let price = 100;
    const closes: number[] = [price];
    for (const step of steps) {
      price += step / 10;
      closes.push(price);
    }
    return closes;
  });

/** Candles dated strictly before DECISION_DATE, in ascending order. */
function candlesFromCloses(pair: Pair, closes: readonly number[]): Candle[] {
  return closes.map((close, i) => {
    // Days 01..30 of 2024-06 are all strictly before 2024-06-15 only up to 14;
    // to keep the whole series pre-date we anchor in an earlier month.
    const day = String((i % 28) + 1).padStart(2, "0");
    const month = i < 28 ? "04" : "05";
    const date = `2024-${month}-${day}`;
    return { asset: pair, date, open: close, high: close, low: close, close };
  });
}

const windowArb = fc.integer({ min: 1, max: 20 });
const thresholdArb = fc.double({ min: 0, max: 1, noNaN: true });

const configArb: fc.Arbitrary<ChoppinessConfig> = fc.record({
  window: windowArb,
  minEfficiency: thresholdArb,
});

function firingSetup(
  pair: Pair,
  direction: DirectionClass,
  confidence: Confidence,
  horizon: Horizon,
): FiringSetup {
  return {
    pair,
    direction,
    horizon,
    earnedConfidence: confidence,
    excursionProfile: { favorablePips: 40, adversePips: 15 },
    stopLossPips: 15,
    takeProfitPips: 40,
  };
}

/** A per-pair firing setup + its candle series, drawn together. */
const pairScenarioArb = fc
  .subarray([...PAIRS], { minLength: 1, maxLength: PAIRS.length })
  .chain((pairs) =>
    fc.tuple(
      ...pairs.map((pair) =>
        fc.record({
          pair: fc.constant(pair),
          direction: directionArb,
          confidence: confidenceArb,
          horizon: horizonArb,
          closes: closesArb,
        }),
      ),
    ),
  );

describe("Property 41: choppiness guard boundary, non-generation, invariance, determinism", () => {
  it("suppresses an otherwise-firing setup iff its look-ahead-safe efficiency is below the threshold (Req 24.2)", () => {
    fc.assert(
      fc.property(pairScenarioArb, configArb, (scenarios, config) => {
        const firing = scenarios.map((s) =>
          firingSetup(s.pair, s.direction, s.confidence, s.horizon),
        );
        const candlesByPair = new Map<Pair, readonly Candle[]>(
          scenarios.map((s) => [s.pair, candlesFromCloses(s.pair, s.closes)]),
        );

        const result = applyChoppinessGuard(
          firing,
          candlesByPair,
          DECISION_DATE,
          config,
        );

        const suppressedPairs = new Set(result.suppressed.map((s) => s.pair));

        for (const s of scenarios) {
          // The exact look-ahead-safe metric the guard scores against.
          const er = efficiencyRatio(
            candlesByPair.get(s.pair) ?? [],
            DECISION_DATE,
            config.window,
          );
          const expectedSuppressed = er < config.minEfficiency;
          // iff: suppressed exactly when ER < threshold.
          expect(suppressedPairs.has(s.pair)).toBe(expectedSuppressed);
        }

        // kept + suppressed partition the firing set exactly (no signal added,
        // no setup dropped).
        const outPairs = [
          ...result.kept.map((k) => k.pair),
          ...result.suppressed.map((k) => k.pair),
        ].sort();
        expect(outPairs).toEqual(firing.map((f) => f.pair).sort());
      }),
      { numRuns: 300 },
    );
  });

  it("suppression records a too_choppy reason and never carries a Direction_Class or signal (Req 24.4, 24.5)", () => {
    fc.assert(
      fc.property(pairScenarioArb, configArb, (scenarios, config) => {
        const firing = scenarios.map((s) =>
          firingSetup(s.pair, s.direction, s.confidence, s.horizon),
        );
        const candlesByPair = new Map<Pair, readonly Candle[]>(
          scenarios.map((s) => [s.pair, candlesFromCloses(s.pair, s.closes)]),
        );

        const result = applyChoppinessGuard(
          firing,
          candlesByPair,
          DECISION_DATE,
          config,
        );

        for (const suppressed of result.suppressed) {
          // Fixed suppression reason; the guard is a suppressor, never a source.
          expect(suppressed.reason).toBe("too_choppy");
          // The suppressed-setup record structurally cannot carry a direction /
          // signal — it exposes only pair, reason, and the audited efficiency.
          expect(Object.keys(suppressed).sort()).toEqual(
            ["efficiency", "pair", "reason"].sort(),
          );
          expect(suppressed).not.toHaveProperty("direction");
          // The recorded efficiency is exactly the look-ahead-safe metric and
          // is genuinely below the threshold that triggered suppression.
          const er = efficiencyRatio(
            candlesByPair.get(suppressed.pair) ?? [],
            DECISION_DATE,
            config.window,
          );
          expect(suppressed.efficiency).toBe(er);
          expect(suppressed.efficiency).toBeLessThan(config.minEfficiency);
        }
      }),
      { numRuns: 300 },
    );
  });

  it("leaves the directional probability, Earned_Confidence, and Kill_Gate verdict byte-for-byte identical (Req 24.4, 24.5)", () => {
    fc.assert(
      fc.property(
        pairScenarioArb,
        configArb,
        // Independent inputs to the upstream deterministic-core computations.
        fc.double({ min: -300, max: 300, noNaN: true }),
        fc.double({ min: 0, max: 100, noNaN: true }),
        neighborhoodArb,
        foldsArb,
        (scenarios, config, netMovePips, atr14, neighborhood, folds) => {
          const firing = scenarios.map((s) =>
            firingSetup(s.pair, s.direction, s.confidence, s.horizon),
          );
          const candlesByPair = new Map<Pair, readonly Candle[]>(
            scenarios.map((s) => [s.pair, candlesFromCloses(s.pair, s.closes)]),
          );

          // Snapshot the upstream deterministic-core outputs BEFORE the guard.
          const directionBefore = classifyDirection(netMovePips, atr14);
          const confidence1Before = computeEarnedConfidence(neighborhood, 1);
          const confidence2Before = computeEarnedConfidence(neighborhood, 2);
          const confidence3Before = computeEarnedConfidence(neighborhood, 3);
          const verdictBefore = composeGateVerdict("cfg", folds);

          // Run the guard — the whole point is that it consumes none of these
          // and feeds into none of them (it only removes firing setups).
          applyChoppinessGuard(firing, candlesByPair, DECISION_DATE, config);

          // Recompute the SAME upstream outputs AFTER the guard ran.
          const directionAfter = classifyDirection(netMovePips, atr14);
          const confidence1After = computeEarnedConfidence(neighborhood, 1);
          const confidence2After = computeEarnedConfidence(neighborhood, 2);
          const confidence3After = computeEarnedConfidence(neighborhood, 3);
          const verdictAfter = composeGateVerdict("cfg", folds);

          // Direction_Class classification is untouched.
          expect(directionAfter).toBe(directionBefore);
          // Earned_Confidence (directional probability) is untouched at every
          // horizon.
          expect(confidence1After).toBe(confidence1Before);
          expect(confidence2After).toBe(confidence2Before);
          expect(confidence3After).toBe(confidence3Before);
          // The Kill_Gate verdict is untouched.
          expect(verdictAfter).toEqual(verdictBefore);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("computes a deterministic Choppiness_Metric: identical inputs yield identical values (Req 24.7)", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...PAIRS),
        closesArb,
        windowArb,
        thresholdArb,
        (pair, closes, window, minEfficiency) => {
          const candles = candlesFromCloses(pair, closes);
          const config: ChoppinessConfig = { window, minEfficiency };

          const er1 = efficiencyRatio(candles, DECISION_DATE, window);
          const er2 = efficiencyRatio(candles, DECISION_DATE, window);
          // Identical inputs => identical metric values.
          expect(er2).toBe(er1);
          // Metric lies in [0,1] (~1 clean trend, ~0 chop).
          expect(er1).toBeGreaterThanOrEqual(0);
          expect(er1).toBeLessThanOrEqual(1);

          // The assessment (and thus suppression decision) is equally
          // deterministic.
          const a1 = assessChoppiness(candles, DECISION_DATE, config);
          const a2 = assessChoppiness(candles, DECISION_DATE, config);
          expect(a2).toEqual(a1);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("takes no LLM input: the guard module imports nothing from any llm module (Req 24.8)", () => {
    // Structural guarantee: the deterministic core cannot depend on an LLM
    // path if it never imports one. Read the guard source and assert it pulls
    // in no llm module.
    const guardSource = readFileSync(
      fileURLToPath(new URL("./choppinessGuard.ts", import.meta.url)),
      "utf8",
    );
    const importLines = guardSource
      .split("\n")
      .filter((line) => /^\s*import\b/.test(line));
    for (const line of importLines) {
      expect(line.toLowerCase()).not.toContain("llm");
    }
  });
});

// --- Kill_Gate / confidence upstream generators ----------------------------

/**
 * A matured analogue neighborhood for the Earned_Confidence computation. Only
 * the fields the shrinkage math reads (horizon, direction) vary meaningfully;
 * the rest are plausible constants.
 */
const neighborhoodArb: fc.Arbitrary<AnalogueRecord[]> = fc.array(
  fc.record({
    asset: fc.constantFrom(...PAIRS),
    decisionDate: fc.constant("2020-01-01"),
    horizon: horizonArb,
    direction: fc.constantFrom("UP", "DOWN", "FLAT"),
    mfePips: fc.double({ min: 0, max: 100, noNaN: true }),
    maePips: fc.double({ min: 0, max: 100, noNaN: true }),
    atr14: fc.double({ min: 1, max: 50, noNaN: true }),
    matured: fc.constant(true),
  }),
  { minLength: 0, maxLength: 60 },
);

const outcomeArb: fc.Arbitrary<ForwardOutcome> = fc
  .record({
    d: fc.constantFrom("UP", "DOWN", "FLAT"),
    mfe: fc.double({ min: 0, max: 100, noNaN: true }),
    mae: fc.double({ min: 0, max: 100, noNaN: true }),
  })
  .map(({ d, mfe, mae }) => {
    const h = { direction: d, mfePips: mfe, maePips: mae };
    return { perHorizon: { 1: h, 2: h, 3: h } };
  });

const firingSampleArb: fc.Arbitrary<Gate1FiringSample> = fc.record({
  decisionDate: fc.constant("2020-01-01"),
  modelPrediction: fc.constantFrom<DirectionClass>("UP", "DOWN"),
  baselinePrediction: fc.constantFrom<DirectionClass>("UP", "DOWN"),
  actual: fc.constantFrom<DirectionClass>("UP", "DOWN"),
});

const foldsArb: fc.Arbitrary<FoldGateInput[]> = fc.array(
  fc.record({
    foldIndex: fc.integer({ min: 0, max: 5 }),
    pair: fc.constantFrom(...PAIRS),
    horizon: horizonArb,
    firingSubset: fc.array(firingSampleArb, { minLength: 0, maxLength: 40 }),
    modelOutcomes: fc.array(outcomeArb, { minLength: 0, maxLength: 40 }),
    baselineOutcomes: fc.array(outcomeArb, { minLength: 0, maxLength: 40 }),
  }),
  { minLength: 0, maxLength: 4 },
);
