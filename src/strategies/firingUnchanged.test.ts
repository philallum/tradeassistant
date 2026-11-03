// Firing / Earned_Confidence unchanged under confluence (Requirements 7.10,
// 10.5, 13.7; task 15.5).
//
// The confluence feature is strictly additive: it is a separate read-only
// consumer of already-produced data and must never alter the live firing
// decision, the Earned_Confidence selector, or the Kill_Gate verdict. This test
// proves that empirically by running the REAL deterministic-core selectors —
// `earnedConfidence` (src/confidence) and the Kill_Gate verdict composition
// `composeGateVerdict` (src/kill-gate) — across the full matrix of confluence
// conditions and asserting the results are byte-for-byte identical:
//
//     third-party reference present / absent   ×   confluence matrix run / not-run
//
// Both selectors are pure functions of in-memory inputs, so if the confluence
// path had any hidden coupling to them (a shared mutable store, a smuggled
// import, mutation of the shared inputs), one of the four cells would diverge.
// It does not: the confluence matrix takes only read-only copies of the
// evaluations/candles/references and returns a brand-new structure.
//
// `composeGateVerdict` is the Kill_Gate verdict and is cheaply callable in
// isolation (it is a pure function of the per-fold gate inputs with no I/O), so
// it is exercised here directly alongside `earnedConfidence`.

import { describe, expect, it } from "vitest";
import { earnedConfidence } from "../confidence/confidenceSelector.js";
import type { Confidence, Horizon } from "../confidence/types.js";
import { composeGateVerdict, type FoldGateInput } from "../kill-gate/verdict.js";
import type { Gate1FiringSample, GateVerdict } from "../kill-gate/types.js";
import type { TradingDate } from "../guard/types.js";
import type { AnalogueRecord, DirectionClass, ForwardOutcome } from "../retrieval/types.js";
import type { Candle } from "../guard/types.js";
import type { Pair } from "../ingestion/types.js";
import type { ExternalReferenceSignal } from "../external-signal/types.js";
import type { PairEvaluation } from "../dashboard/dashboard.js";
import {
  buildConfluenceMatrix,
  createBreakoutStrategy,
  createConfluenceEngine,
  createRangeStrategy,
  createReversalStrategy,
  createTrendStrategy,
  type PairConfluenceInput,
  type StrategyBundle,
} from "./index.js";

// --- Shared deterministic-core fixtures (never mutated) ----------------------

const DECISION_DATE: TradingDate = "2025-02-03";

/**
 * Build `count` analogue records at `horizon`, the first `resolvedUp` resolving
 * UP and the rest FLAT, so the raw resolution rate is a known fraction. Dates
 * are all strictly before the Decision_Date.
 */
function neighborhood(horizon: 1 | 2 | 3, count: number, resolvedUp: number): AnalogueRecord[] {
  const out: AnalogueRecord[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      asset: "EURUSD",
      decisionDate: `2024-${String((i % 12) + 1).padStart(2, "0")}-15`,
      horizon,
      direction: i < resolvedUp ? "UP" : "FLAT",
      mfePips: 10,
      maePips: 5,
      atr14: 0.008,
      matured: true,
    });
  }
  return out;
}

/** A shared neighborhood with a mix of horizons, sized well above the floor. */
function buildSharedNeighborhood(): readonly AnalogueRecord[] {
  return [
    ...neighborhood(1, 40, 30), // C_raw = 0.75 at horizon 1
    ...neighborhood(2, 50, 20), // C_raw = 0.40 at horizon 2
    ...neighborhood(3, 35, 35), // C_raw = 1.00 at horizon 3
  ];
}

/** Compute Earned_Confidence at every horizon for the shared neighborhood. */
function earnedConfidenceByHorizon(
  nb: readonly AnalogueRecord[],
): Record<Horizon, number> {
  return {
    1: earnedConfidence(nb, 1),
    2: earnedConfidence(nb, 2),
    3: earnedConfidence(nb, 3),
  };
}

// --- Kill_Gate verdict fixtures ----------------------------------------------

/** A forward outcome whose selected horizon resolves in `direction`. */
function outcome(direction: DirectionClass, mfePips: number, maePips: number): ForwardOutcome {
  const h = { direction, mfePips, maePips };
  return { perHorizon: { 1: h, 2: h, 3: h } };
}

/**
 * Build a single walk-forward fold with a matched firing subset above the
 * 30-sample floor. The model is correct more often than the baseline so the
 * verdict is a deterministic PASS; the exact value does not matter, only that
 * it is identical across every confluence condition.
 */
function buildFolds(): readonly FoldGateInput[] {
  const n = 40;
  const firingSubset: Gate1FiringSample[] = Array.from({ length: n }, (_, i) => ({
    decisionDate: `2024-06-${String((i % 28) + 1).padStart(2, "0")}`,
    // Model is right on the first 36, baseline right on the first 20.
    modelPrediction: i < 36 ? "UP" : "DOWN",
    baselinePrediction: i < 20 ? "UP" : "DOWN",
    actual: "UP",
    confidence: 0.6,
  }));
  const modelOutcomes = Array.from({ length: n }, () => outcome("UP", 30, 5));
  const baselineOutcomes = Array.from({ length: n }, () => outcome("UP", 20, 8));
  return [
    {
      foldIndex: 0,
      pair: "EURUSD",
      horizon: 1,
      firingSubset,
      modelOutcomes,
      baselineOutcomes,
    },
  ];
}

// --- Confluence matrix inputs ------------------------------------------------

/** Build an ascending-date OHLC candle series with a mild upward drift. */
function buildCandles(pair: Pair, count: number): Candle[] {
  const candles: Candle[] = [];
  let base = 1.1;
  for (let i = 0; i < count; i++) {
    base += 0.001;
    const open = base;
    const close = base + 0.0005;
    const high = close + 0.0008;
    const low = open - 0.0008;
    candles.push({
      asset: pair,
      // Dates strictly before the Decision_Date, ascending weekday-ish order.
      date: `2024-${String((i % 11) + 1).padStart(2, "0")}-${String((i % 27) + 1).padStart(2, "0")}`,
      open,
      high,
      low,
      close,
    });
  }
  return candles;
}

/** The pattern-matcher evaluation a Pair feeds into the custom_pattern cell. */
function evaluation(direction: DirectionClass, earned: number): Pick<PairEvaluation, "direction" | "earnedConfidence"> {
  return { direction, earnedConfidence: earned as Confidence };
}

/** A display-only third-party reference for a Pair. */
function reference(pair: Pair): ExternalReferenceSignal {
  return {
    pair,
    decisionDate: DECISION_DATE,
    direction: "BUY",
    score: 0.6,
    provider: "test-provider",
    fetchedAt: "2025-02-03T00:00:00.000Z",
  };
}

/** The four created classical strategies, failing loudly on a config error. */
function buildStrategies(): StrategyBundle {
  const trend = createTrendStrategy();
  const breakout = createBreakoutStrategy();
  const range = createRangeStrategy();
  const reversal = createReversalStrategy();
  for (const r of [trend, breakout, range, reversal]) {
    if (!r.ok) throw new Error(`strategy factory failed: ${r.error.message}`);
  }
  if (!trend.ok || !breakout.ok || !range.ok || !reversal.ok) {
    throw new Error("unreachable");
  }
  return {
    trend: trend.value,
    breakout: breakout.value,
    range: range.value,
    reversal: reversal.value,
  };
}

/**
 * Build the confluence matrix inputs for every Pair. When `withThirdParty` is
 * true each Pair carries a third-party reference; otherwise the reference slot
 * is null — the exact difference task 15.5 asks us to vary.
 */
function buildMatrixInputs(
  candlesByPair: ReadonlyMap<Pair, readonly Candle[]>,
  withThirdParty: boolean,
): PairConfluenceInput[] {
  const inputs: PairConfluenceInput[] = [];
  for (const [pair, candles] of candlesByPair) {
    inputs.push({
      pair,
      candles,
      evaluation: evaluation("UP", 0.62),
      thirdParty: withThirdParty ? reference(pair) : null,
    });
  }
  return inputs;
}

/** Run the confluence matrix once for the given inputs (result discarded). */
function runMatrix(inputs: readonly PairConfluenceInput[]): void {
  const engineResult = createConfluenceEngine();
  if (!engineResult.ok) {
    throw new Error(`engine config error: ${engineResult.error.message}`);
  }
  buildConfluenceMatrix({
    decisionDate: DECISION_DATE,
    inputs,
    strategies: buildStrategies(),
    engine: engineResult.value,
  });
}

// --- The invariant: firing selectors are unchanged ---------------------------

describe("firing decision and Earned_Confidence are unchanged by confluence (Req 7.10, 10.5, 13.7)", () => {
  // The single source of truth the firing path reads. Built once; the four
  // conditions each call the REAL selectors against the same inputs.
  const neighborhoodInputs = buildSharedNeighborhood();
  const folds = buildFolds();

  /**
   * Compute the firing-path outputs (Earned_Confidence per horizon + the real
   * Kill_Gate verdict) under one confluence condition. The `runConfluence`
   * flag decides whether `buildConfluenceMatrix` is run on the same decision
   * date first; `withThirdParty` decides whether a third-party reference is
   * present in the confluence inputs. Neither should touch the firing path.
   */
  function firingOutputs(runConfluence: boolean, withThirdParty: boolean): {
    confidence: Record<Horizon, number>;
    verdict: GateVerdict;
  } {
    if (runConfluence) {
      const candlesByPair = new Map<Pair, readonly Candle[]>([
        ["EURUSD", buildCandles("EURUSD", 80)],
        ["GBPUSD", buildCandles("GBPUSD", 80)],
        ["USDJPY", buildCandles("USDJPY", 80)],
        ["USDCHF", buildCandles("USDCHF", 80)],
        ["USDCAD", buildCandles("USDCAD", 80)],
      ]);
      runMatrix(buildMatrixInputs(candlesByPair, withThirdParty));
    }
    return {
      confidence: earnedConfidenceByHorizon(neighborhoodInputs),
      verdict: composeGateVerdict("config-under-test", folds),
    };
  }

  // The four combinations task 15.5 enumerates.
  const baseline = firingOutputs(false, false);

  it("Earned_Confidence is identical across all four third-party × matrix combinations", () => {
    const combinations: Array<{ runConfluence: boolean; withThirdParty: boolean }> = [
      { runConfluence: false, withThirdParty: false },
      { runConfluence: false, withThirdParty: true },
      { runConfluence: true, withThirdParty: false },
      { runConfluence: true, withThirdParty: true },
    ];
    for (const combo of combinations) {
      const { confidence } = firingOutputs(combo.runConfluence, combo.withThirdParty);
      expect(confidence).toStrictEqual(baseline.confidence);
    }
  });

  it("the Kill_Gate verdict is identical across all four third-party × matrix combinations", () => {
    const combinations: Array<{ runConfluence: boolean; withThirdParty: boolean }> = [
      { runConfluence: false, withThirdParty: false },
      { runConfluence: false, withThirdParty: true },
      { runConfluence: true, withThirdParty: false },
      { runConfluence: true, withThirdParty: true },
    ];
    for (const combo of combinations) {
      const { verdict } = firingOutputs(combo.runConfluence, combo.withThirdParty);
      expect(verdict).toStrictEqual(baseline.verdict);
    }
  });

  it("running confluence with a third-party reference present does not change the firing outputs vs. the clean baseline", () => {
    // The most adversarial cell: confluence run AND a third-party reference
    // present. If any coupling existed, this is where it would surface.
    const withEverything = firingOutputs(true, true);
    expect(withEverything.confidence).toStrictEqual(baseline.confidence);
    expect(withEverything.verdict).toStrictEqual(baseline.verdict);
  });

  it("the shared Earned_Confidence and verdict are themselves meaningful (non-degenerate) so the equality is not vacuous", () => {
    // Guard against a vacuous pass: the baseline must carry real signal.
    expect(baseline.confidence[1]).toBeGreaterThan(0.5); // C_raw 0.75 at horizon 1
    expect(baseline.confidence[2]).toBeLessThan(0.5); // C_raw 0.40 at horizon 2
    expect(baseline.verdict.verdict).toBe("PASS");
    expect(baseline.verdict.sampleSize).toBeGreaterThanOrEqual(30);
  });
});
