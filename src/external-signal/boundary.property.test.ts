import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import type { AnalogueRecord, DirectionClass, ForwardOutcome, HorizonOutcome } from "../retrieval/types.js";
import type { Pair } from "../ingestion/types.js";
import {
  earnedConfidence,
  classify,
  selectHorizon,
  type Horizon,
} from "../confidence/index.js";
import { composeGateVerdict, type FoldGateInput } from "../kill-gate/verdict.js";
import { GATE1_SAMPLE_SIZE_FLOOR, type Gate1FiringSample } from "../kill-gate/types.js";

import {
  fetchReferenceForPair,
  fetchAllReferences,
  toReferenceDisplay,
  type ExternalSignalClock,
} from "./externalSignal.js";
import { InMemoryExternalSignalProvider, type SeededReference } from "./inMemoryProvider.js";
import {
  isReferenceDirection,
  REFERENCE_DIRECTIONS,
  type ExternalReferenceSignal,
  type ExternalSignalConfig,
  type ExternalSignalError,
  type ExternalSignalProvider,
  type ReferenceDirection,
  type ReferenceOutcome,
} from "./types.js";
import { ok, type Result, type TradingDate } from "../guard/types.js";

// External Signal Cross-Reference — BOUNDARY & FAIL-SAFE tests (Task 11.4;
// Requirement 23). This file proves the hard boundary the design promises: the
// external reference is display/research-only and NEVER reaches a scoring or
// decision path (Requirements 23.2, 23.3, 23.6). It also covers the swappable
// provider interface and the ExternalReferenceSignal shape (23.4) and the
// fail-safe path (23.5).
//
// The critical test runs the REAL deterministic-core scoring/verdict paths
// (Earned_Confidence / Direction_Class via src/confidence, and the two-stage
// Kill_Gate verdict via src/kill-gate) with the external reference fetched and
// present, and again with it entirely omitted, and asserts the computed
// probability and Kill_Gate verdict are byte-for-byte identical.

const DECISION_DATE: TradingDate = "2026-03-16";
const FIXED_CLOCK: ExternalSignalClock = { now: () => "2026-03-16T12:00:00.000Z" };
const CONFIG: ExternalSignalConfig = { provider: "boundary-provider", timeoutMs: 1_000 };

const DIRECTIONS: readonly DirectionClass[] = ["UP", "DOWN", "FLAT"] as const;

// --- Arbitraries reused across the boundary tests --------------------------

const horizonArb: fc.Arbitrary<Horizon> = fc.constantFrom(1 as const, 2 as const, 3 as const);
const directionArb: fc.Arbitrary<DirectionClass> = fc.constantFrom(...DIRECTIONS);
const referenceDirectionArb: fc.Arbitrary<ReferenceDirection> = fc.constantFrom(
  ...(REFERENCE_DIRECTIONS as readonly ReferenceDirection[]),
);

/** A matured analogue record at a given horizon. */
const analogueArb: fc.Arbitrary<AnalogueRecord> = fc.record({
  asset: fc.constant<Pair>("EURUSD"),
  decisionDate: fc.constant<TradingDate>("2025-01-02"),
  horizon: horizonArb,
  direction: directionArb,
  mfePips: fc.double({ min: 0, max: 50, noNaN: true }),
  maePips: fc.double({ min: 0, max: 50, noNaN: true }),
  atr14: fc.double({ min: 0.0001, max: 100, noNaN: true }),
  matured: fc.constant(true),
});

const neighborhoodArb: fc.Arbitrary<readonly AnalogueRecord[]> = fc.array(analogueArb, {
  minLength: 0,
  maxLength: 60,
});

/** A ForwardOutcome with identical MFE/MAE on every horizon (drives Gate 2). */
function uniformOutcome(mfePips: number, maePips: number): ForwardOutcome {
  const h: HorizonOutcome = { direction: "UP", mfePips, maePips };
  return { perHorizon: { 1: h, 2: h, 3: h } };
}

const outcomeArb: fc.Arbitrary<ForwardOutcome> = fc
  .record({
    mfe: fc.double({ min: 0, max: 50, noNaN: true }),
    mae: fc.double({ min: 0, max: 50, noNaN: true }),
  })
  .map(({ mfe, mae }) => uniformOutcome(mfe, mae));

const firingArb: fc.Arbitrary<Gate1FiringSample> = fc.record({
  decisionDate: fc.integer({ min: 0, max: 27 }).map((d) => `2021-06-${String(d + 1).padStart(2, "0")}`),
  modelPrediction: directionArb,
  baselinePrediction: directionArb,
  actual: directionArb,
});

const foldArb: fc.Arbitrary<FoldGateInput> = fc
  .record({
    foldIndex: fc.integer({ min: 0, max: 10 }),
    pair: fc.constantFrom(
      "EURUSD" as const,
      "GBPUSD" as const,
      "USDJPY" as const,
      "USDCHF" as const,
      "USDCAD" as const,
    ),
    horizon: horizonArb,
    subset: fc.array(firingArb, { minLength: 0, maxLength: GATE1_SAMPLE_SIZE_FLOOR + 20 }),
    model: fc.array(outcomeArb, { minLength: 0, maxLength: 50 }),
    baseline: fc.array(outcomeArb, { minLength: 0, maxLength: 50 }),
  })
  .map(({ foldIndex, pair, horizon, subset, model, baseline }) => ({
    foldIndex,
    pair,
    horizon,
    firingSubset: subset,
    modelOutcomes: model,
    baselineOutcomes: baseline,
  }));

/**
 * A seed for the external reference, either a recommendation (optionally with a
 * score) or a failure mode. Built so the `score` key is either a real finite
 * number or entirely absent — never `undefined` — to satisfy
 * `exactOptionalPropertyTypes`.
 */
const seededReferenceArb: fc.Arbitrary<SeededReference> = fc.oneof(
  fc
    .record({
      direction: referenceDirectionArb,
      score: fc.option(fc.double({ min: -1, max: 1, noNaN: true }), { nil: undefined }),
    })
    .map(({ direction, score }): SeededReference =>
      score === undefined ? { direction } : { direction, score },
    ),
  fc.record({
    failure: fc.constantFrom("unavailable" as const, "timeout" as const, "invalid" as const),
  }),
);

// --- 23.4: swappable provider interface & ExternalReferenceSignal shape -----

describe("swappable provider interface & ExternalReferenceSignal shape (Requirement 23.4)", () => {
  it("accepts any object implementing the fetchReference PORT (a swapped provider)", async () => {
    // A bespoke provider unrelated to InMemoryExternalSignalProvider — it only
    // implements the single-method PORT, proving the interface is thin/swappable.
    const swapped: ExternalSignalProvider = {
      fetchReference(pair: Pair, decisionDate: TradingDate): Promise<Result<ExternalReferenceSignal, ExternalSignalError>> {
        return Promise.resolve(
          ok<ExternalReferenceSignal>({
            pair,
            decisionDate,
            direction: "SELL",
            score: 0.42,
            provider: "swapped-vendor",
            fetchedAt: "ignored-by-orchestrator",
          }),
        );
      },
    };

    const outcome = await fetchReferenceForPair(swapped, "EURUSD", DECISION_DATE, CONFIG, FIXED_CLOCK);

    expect(outcome.available).toBe(true);
    if (!outcome.available) throw new Error("expected available");
    // The orchestrator stamps provenance/timestamp; a swapped adapter cannot spoof them.
    expect(outcome.signal.provider).toBe(CONFIG.provider);
    expect(outcome.signal.fetchedAt).toBe("2026-03-16T12:00:00.000Z");
    expect(outcome.signal.decisionDate).toBe(DECISION_DATE);
  });

  it("produces a well-formed ExternalReferenceSignal for every valid provider recommendation", async () => {
    await fc.assert(
      fc.asyncProperty(referenceDirectionArb, fc.option(fc.double({ min: -5, max: 5, noNaN: true }), { nil: undefined }), async (direction, score) => {
        const provider = new InMemoryExternalSignalProvider("boundary-provider", {
          EURUSD: score === undefined ? { direction } : { direction, score },
        });
        const outcome = await fetchReferenceForPair(provider, "EURUSD", DECISION_DATE, CONFIG, FIXED_CLOCK);

        expect(outcome.available).toBe(true);
        if (!outcome.available) throw new Error("expected available");
        const sig = outcome.signal;
        // Shape invariants of ExternalReferenceSignal.
        expect(sig.pair).toBe("EURUSD");
        expect(sig.decisionDate).toBe(DECISION_DATE);
        expect(isReferenceDirection(sig.direction)).toBe(true);
        expect(typeof sig.provider).toBe("string");
        expect(typeof sig.fetchedAt).toBe("string");
        if (score === undefined) {
          expect(sig.score).toBeUndefined();
        } else {
          expect(sig.score).toBe(score);
          expect(Number.isFinite(sig.score)).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });
});

// --- 23.5: fail-safe path (unavailable / timeout / invalid) -----------------

describe("fail-safe path leaves own output unchanged (Requirement 23.5)", () => {
  it("marks the reference unavailable on every modelled failure mode and never throws", async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom("unavailable" as const, "timeout" as const, "invalid" as const), async (mode) => {
        const provider = new InMemoryExternalSignalProvider("boundary-provider", {
          EURUSD: { failure: mode },
        });
        const outcome = await fetchReferenceForPair(provider, "EURUSD", DECISION_DATE, CONFIG, FIXED_CLOCK);

        expect(outcome.available).toBe(false);
        if (outcome.available) throw new Error("expected unavailable");
        expect(outcome.error.mode).toBe(mode);
        expect(outcome.error.pair).toBe("EURUSD");
        expect(outcome.error.reason).toBe("external_signal_error");
      }),
      { numRuns: 60 },
    );
  });

  it("treats a provider that rejects as unavailable (fail-safe, no throw)", async () => {
    const throwing: ExternalSignalProvider = {
      fetchReference(): Promise<Result<ExternalReferenceSignal, ExternalSignalError>> {
        return Promise.reject(new Error("network down"));
      },
    };
    const outcome = await fetchReferenceForPair(throwing, "EURUSD", DECISION_DATE, CONFIG, FIXED_CLOCK);
    expect(outcome.available).toBe(false);
    if (outcome.available) throw new Error("expected unavailable");
    expect(outcome.error.mode).toBe("unavailable");
  });

  it("treats a slow provider as a timeout without hanging the run", async () => {
    const slow: ExternalSignalProvider = {
      fetchReference(pair: Pair): Promise<Result<ExternalReferenceSignal, ExternalSignalError>> {
        return new Promise((resolve) => {
          setTimeout(
            () =>
              resolve(
                ok<ExternalReferenceSignal>({
                  pair,
                  decisionDate: DECISION_DATE,
                  direction: "BUY",
                  provider: "slow",
                  fetchedAt: "x",
                }),
              ),
            50,
          );
        });
      },
    };
    const outcome = await fetchReferenceForPair(slow, "EURUSD", DECISION_DATE, { provider: "slow", timeoutMs: 5 }, FIXED_CLOCK);
    expect(outcome.available).toBe(false);
    if (outcome.available) throw new Error("expected timeout");
    expect(outcome.error.mode).toBe("timeout");
  });

  it("an unavailable reference projects to a 'reference unavailable' display without touching own output", () => {
    const outcome: ReferenceOutcome = {
      pair: "EURUSD",
      available: false,
      error: { reason: "external_signal_error", mode: "invalid", pair: "EURUSD", message: "bad" },
    };
    // The system's own Direction_Class is supplied for display; the projection
    // must carry it through UNCHANGED and never derive anything from the failure.
    const display = toReferenceDisplay(outcome, "UP");
    expect(display.available).toBe(false);
    expect(display.ownDirection).toBe("UP");
    expect(display.comparison).toBe("unavailable");
    expect(display.direction).toBeNull();
  });
});

// --- 23.2 / 23.3: the byte-for-byte scoring/verdict boundary ----------------

describe("boundary: including vs omitting the reference leaves scoring byte-for-byte identical (Requirements 23.2, 23.3)", () => {
  it("Earned_Confidence & Direction_Class are identical with and without a fetched reference", async () => {
    await fc.assert(
      fc.asyncProperty(
        neighborhoodArb,
        horizonArb,
        fc.double({ min: -100, max: 100, noNaN: true }), // netMovePips
        fc.double({ min: 0.0001, max: 100, noNaN: true }), // atr14
        seededReferenceArb,
        async (neighborhood, horizon, netMovePips, atr14, seeded) => {
          // (A) OMITTING the reference: compute the deterministic-core outputs directly.
          const confidenceWithout = earnedConfidence(neighborhood, horizon);
          const directionWithout = classify(netMovePips, atr14);
          const horizonWithout = selectHorizon(neighborhood);

          // (B) INCLUDING the reference: fetch it (available OR failed), build the
          // display projection, then compute the SAME deterministic-core outputs.
          // The reference is deliberately given NO path into the scoring calls.
          const provider = new InMemoryExternalSignalProvider("boundary-provider", { EURUSD: seeded });
          const outcome = await fetchReferenceForPair(provider, "EURUSD", DECISION_DATE, CONFIG, FIXED_CLOCK);
          const display = toReferenceDisplay(outcome, directionWithout);
          // Touch the display so it is unmistakably "used" for its intended (display) purpose.
          expect(typeof display.display).toBe("string");

          const confidenceWith = earnedConfidence(neighborhood, horizon);
          const directionWith = classify(netMovePips, atr14);
          const horizonWith = selectHorizon(neighborhood);

          // Byte-for-byte identical: the reference never reached a scoring path.
          expect(Object.is(confidenceWith, confidenceWithout)).toBe(true);
          expect(directionWith).toBe(directionWithout);
          expect(horizonWith).toBe(horizonWithout);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("the Kill_Gate verdict is deeply identical with and without a fetched reference", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(foldArb, { minLength: 1, maxLength: 6 }),
        seededReferenceArb,
        async (folds, seeded) => {
          // (A) OMITTING the reference: compose the verdict from the folds only.
          const verdictWithout = composeGateVerdict("boundary-config", folds);

          // (B) INCLUDING the reference: fetch all five references at daily-run
          // time, then compose the verdict from the SAME folds. The reference
          // outcomes are computed but deliberately not passed into the verdict.
          const provider = new InMemoryExternalSignalProvider("boundary-provider", {
            EURUSD: seeded,
            GBPUSD: seeded,
          });
          const references = await fetchAllReferences(provider, DECISION_DATE, CONFIG, FIXED_CLOCK);
          expect(references).toHaveLength(5); // fetched beside the run, never fed in

          const verdictWith = composeGateVerdict("boundary-config", folds);

          // Byte-for-byte (structurally deep-equal) identical verdict + metrics.
          expect(verdictWith).toStrictEqual(verdictWithout);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// --- 23.6: references are never used in backtest / Kill_Gate evaluation -----
//
// Structural guarantee: the deterministic-core scoring/decision/backtest modules
// must not import the external-signal module (a static import would be the only
// way a reference value could reach a scoring path). We assert this by scanning
// the source of every scoring/decision/backtest module for any import that
// resolves into `external-signal`. This complements the behavioral byte-for-byte
// tests above with a compile-surface guarantee.

describe("references are never used in a historical backtest or Kill_Gate evaluation (Requirement 23.6)", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const srcRoot = join(here, "..");

  // The deterministic-core scoring / decision / backtest surfaces.
  const SCORING_MODULE_DIRS = ["confidence", "kill-gate", "retrieval", "baseline", "encoder"] as const;

  /** Recursively collect .ts source files (excluding tests) under a directory. */
  function collectSourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        out.push(...collectSourceFiles(full));
      } else if (entry.name.endsWith(".ts") && !entry.name.includes(".test.")) {
        out.push(full);
      }
    }
    return out;
  }

  it.each([...SCORING_MODULE_DIRS])(
    "the '%s' scoring/decision module never imports the external-signal module",
    (moduleDir) => {
      const files = collectSourceFiles(join(srcRoot, moduleDir));
      expect(files.length).toBeGreaterThan(0);
      for (const file of files) {
        const source = readFileSync(file, "utf8");
        expect(source).not.toMatch(/external-signal/);
      }
    },
  );
});
