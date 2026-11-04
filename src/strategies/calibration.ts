// Confluence threshold calibration — pure measurement helpers.
//
// The Confluence_Engine's two thresholds (conflict, alignment) were chosen by
// judgement. This module MEASURES them: given replayed per-day strategy signals
// and the direction the market actually took the next session, it reports
//   (a) the strength distribution of each strategy's directional calls,
//   (b) how often each Confluence_Status occurs at a candidate threshold pair, and
//   (c) how often an ALIGNED status was right.
// It is read-only analysis: it never changes the engine, firing, or any stored
// data, and it is deterministic (no clock, I/O or randomness).
//
// Scope note: the pattern matcher (`custom_pattern`) needs the vector/analogue
// stores and cannot be replayed from candles alone, so the four classical
// strategies are measured directly and the pattern's reachable strength band is
// derived analytically from the shrinkage formula (see `patternStrength`).

import { FIXED_PRIOR_WEIGHT, NEUTRAL_PRIOR } from "../confidence/types.js";
import { createConfluenceEngine, type ConfluenceStatus } from "./confluenceEngine.js";
import { percentile } from "../risk-boundaries/empiricalRiskBoundaries.js";
import { buildSignal, type StrategyId, type StrategySignal } from "./types.js";

type Direction = "UP" | "DOWN" | "FLAT";

/** One replayed day: the available signals and the realized next-session direction. */
export interface CalibrationSample {
  readonly pair: string;
  readonly date: string;
  readonly signals: readonly StrategySignal[];
  readonly realized: Direction;
}

export interface StrengthSummary {
  readonly strategyId: StrategyId;
  /** Directional (UP/DOWN) calls observed. */
  readonly n: number;
  readonly p25: number;
  readonly p50: number;
  readonly p75: number;
  readonly p90: number;
  readonly max: number;
}

/** Strength distribution of the directional calls of each strategy present. */
export function strengthDistribution(
  samples: readonly CalibrationSample[],
): StrengthSummary[] {
  const byId = new Map<StrategyId, number[]>();
  for (const s of samples) {
    for (const sig of s.signals) {
      if (sig.direction === "FLAT") continue;
      const list = byId.get(sig.strategyId) ?? [];
      list.push(sig.strength);
      byId.set(sig.strategyId, list);
    }
  }
  return [...byId.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([strategyId, v]) => ({
      strategyId,
      n: v.length,
      p25: percentile(v, 25),
      p50: percentile(v, 50),
      p75: percentile(v, 75),
      p90: percentile(v, 90),
      max: Math.max(...v),
    }));
}

export interface ThresholdPair {
  readonly conflictThreshold: number;
  readonly alignmentThreshold: number;
}

export interface StatusReport extends ThresholdPair {
  readonly days: number;
  readonly counts: Readonly<Record<ConfluenceStatus, number>>;
  /** Share of days with a CONFLICT_FLAT status. */
  readonly conflictRate: number;
  /** Aligned calls (UP or DOWN) and how many matched the realized direction. */
  readonly alignedCalls: number;
  readonly alignedCorrect: number;
  /** Realized UP/DOWN base rate on aligned days is the reference for "right". */
  readonly alignedHitRate: number | null;
}

const ZERO_COUNTS = (): Record<ConfluenceStatus, number> => ({
  ALIGNED_UP: 0,
  ALIGNED_DOWN: 0,
  NEUTRAL: 0,
  CONFLICT_FLAT: 0,
  INSUFFICIENT_DATA: 0,
});

/** Evaluate every sample through the real engine at one threshold pair. */
export function statusReport(
  samples: readonly CalibrationSample[],
  thresholds: ThresholdPair,
  weights?: Partial<Record<StrategyId, number>>,
): StatusReport {
  const engine = createConfluenceEngine({
    conflictThreshold: thresholds.conflictThreshold,
    alignmentThreshold: thresholds.alignmentThreshold,
    ...(weights !== undefined ? { weights } : {}),
  });
  if (!engine.ok) throw new Error(`invalid thresholds: ${engine.error.message}`);
  const counts = ZERO_COUNTS();
  let alignedCalls = 0;
  let alignedCorrect = 0;
  for (const s of samples) {
    const result = engine.value.aggregate(s.signals);
    if (!result.ok) {
      counts.INSUFFICIENT_DATA += 1;
      continue;
    }
    counts[result.value.status] += 1;
    if (result.value.status === "ALIGNED_UP" || result.value.status === "ALIGNED_DOWN") {
      alignedCalls += 1;
      const predicted: Direction = result.value.status === "ALIGNED_UP" ? "UP" : "DOWN";
      if (predicted === s.realized) alignedCorrect += 1;
    }
  }
  const days = samples.length;
  return {
    ...thresholds,
    days,
    counts,
    conflictRate: days === 0 ? 0 : counts.CONFLICT_FLAT / days,
    alignedCalls,
    alignedCorrect,
    alignedHitRate: alignedCalls === 0 ? null : alignedCorrect / alignedCalls,
  };
}

/** Sweep a grid of threshold pairs. */
export function sweep(
  samples: readonly CalibrationSample[],
  conflicts: readonly number[],
  alignments: readonly number[],
  weights?: Partial<Record<StrategyId, number>>,
): StatusReport[] {
  const out: StatusReport[] = [];
  for (const c of conflicts) {
    for (const a of alignments) {
      out.push(statusReport(samples, { conflictThreshold: c, alignmentThreshold: a }, weights));
    }
  }
  return out;
}

/**
 * The pattern matcher's signal strength for a neighbourhood of `n` analogues
 * whose dominant direction holds a raw share `rawRate` of them: the fixed-prior
 * shrinkage `(n/(n+k))*raw + (k/(n+k))*0.5` (see `src/confidence/`). This is the
 * value `adaptCustomPattern` uses as the signal strength.
 */
export function patternStrength(n: number, rawRate: number): number {
  return (n / (n + FIXED_PRIOR_WEIGHT)) * rawRate + (FIXED_PRIOR_WEIGHT / (n + FIXED_PRIOR_WEIGHT)) * NEUTRAL_PRIOR;
}

/** Build a validated signal for a fixture; throws on an invalid one (test helper). */
export function signalOf(
  strategyId: StrategyId,
  direction: Direction,
  strength: number,
): StrategySignal {
  const built = buildSignal(strategyId, direction, strength, `${strategyId} ${direction}`);
  if (!built.ok) throw new Error(`invalid signal: ${built.error.message}`);
  return built.value;
}
