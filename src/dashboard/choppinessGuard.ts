// Choppiness Volatility Silence Guard — Design Component 18 (Requirement 24).
//
// A DETERMINISTIC-CORE dashboard-level suppression step. Like the Currency
// Concentration Guard (Component 16) and the News Filter (Component 10), it ONLY
// ever suppresses: it keeps the system silent on a Pair when recent price action
// is too choppy — directionless, whipsaw movement that tends to stop trades out.
// Suppression is a HARD VETO (the pair stays silent), never a confidence
// de-weight. It takes NO LLM input and is fully deterministic (Requirement 24.8).
//
// Metric (Requirement 24.1): the Kaufman Efficiency Ratio over a fixed trailing
// window `w`,
//
//     ER = |Close_T − Close_{T−w}| / Σ_{i} |Close_i − Close_{i−1}|
//
// yielding a value in [0,1] where ~1 is a clean, efficient trend and ~0 is pure
// chop. This is DISTINCT from raw volatility magnitude (ATR_14 / FLAT_Dead_Band,
// Component 5): a pair can have wide ATR yet near-zero efficiency (loud but
// directionless), and it is exactly that regime this guard silences.
//
// Look-ahead safety (Requirements 24.1, 24.7): the metric is computed ONLY from
// candles dated strictly before the Decision_Date, via the shared Look-Ahead
// Guard (Component 1). No future information can leak into the suppression
// decision, and identical inputs yield identical values.
//
// Boundary discipline (Requirements 24.4, 24.5): the guard NEVER generates a
// Direction_Class or signal, and it is NOT an input to the directional
// probability, Earned_Confidence, Direction_Class classification, retrieval, or
// the Kill_Gate verdict. It only removes otherwise-firing setups; those upstream
// computations are left byte-for-byte identical.

import { assertPastOnly } from "../guard/lookAheadGuard.js";
import type { Candle, TradingDate } from "../guard/types.js";
import type { Pair } from "../ingestion/types.js";
import {
  DEFAULT_CHOPPINESS_CONFIG,
  type ChoppinessConfig,
  type ChoppinessSuppressedSetup,
  type FiringSetup,
} from "./types.js";

/**
 * The outcome of assessing a single pair's choppiness on a Decision_Date.
 * `suppressed` is true iff the look-ahead-safe Efficiency Ratio is strictly
 * below the configured minimum (`ER < threshold`). `efficiency` is the metric
 * itself, always returned for auditing (Requirement 24.2).
 */
export interface ChoppinessAssessment {
  readonly suppressed: boolean;
  readonly reason?: "too_choppy";
  readonly efficiency: number;
}

/**
 * Compute the Kaufman Efficiency Ratio over the most recent `window` steps of a
 * chronologically-ascending close series.
 *
 *     ER = |Close_T − Close_{T−w}| / Σ |Close_i − Close_{i−1}|
 *
 * The numerator is the NET move across the window; the denominator is the TOTAL
 * path length (sum of absolute per-step moves). A straight-line move gives
 * ER = 1; a path that returns to where it started gives ER = 0.
 *
 * Degenerate cases resolve to a defined, non-error value (consistent with the
 * degenerate-window handling elsewhere in the deterministic core, e.g. ATR_14):
 *   - fewer than 2 closes ⇒ 0 (no measurable movement, treated as fully choppy);
 *   - a flat series (total path length 0) ⇒ 0 (no movement to be efficient).
 *
 * Pure and deterministic: identical inputs yield identical outputs
 * (Requirements 24.7, 3.1).
 *
 * @param closes A chronologically-ascending series of close prices.
 * @param window The trailing window `w` in steps (number of price changes
 *               considered). Values <= 0 disable the metric (returns 0).
 */
export function efficiencyRatioFromCloses(
  closes: readonly number[],
  window: number,
): number {
  const w = Math.trunc(window);
  if (w <= 0 || closes.length < 2) return 0;

  // Take the most recent `w + 1` closes so there are exactly `w` per-step moves
  // in the window (or fewer, if the series is shorter than the window).
  const series = closes.slice(-(w + 1));
  if (series.length < 2) return 0;

  const first = series[0] as number;
  const last = series[series.length - 1] as number;
  const netMove = Math.abs(last - first);

  let pathLength = 0;
  for (let i = 1; i < series.length; i += 1) {
    pathLength += Math.abs((series[i] as number) - (series[i - 1] as number));
  }

  if (pathLength === 0) return 0;
  return netMove / pathLength;
}

/**
 * Compute the look-ahead-safe Efficiency-Ratio Choppiness_Metric for a pair over
 * a trailing window (Requirements 24.1, 24.7).
 *
 * The candles are first passed through the shared Look-Ahead Guard: any candle
 * dated on or after the Decision_Date is a look-ahead violation and is dropped
 * from the computation (fail-loud discipline is preserved by the guard, which
 * surfaces the violation; here the guard's rejection means those candles never
 * contribute to the metric). Only candles strictly before the Decision_Date are
 * used, so no future information can leak into the suppression decision.
 *
 * @param candles      Daily candles for the pair (any order; sorted internally).
 * @param decisionDate The Decision_Date; only pre-date candles are used.
 * @param window       The trailing window `w` in trading days.
 * @returns The Efficiency Ratio in [0,1] (~1 clean trend, ~0 chop).
 */
export function efficiencyRatio(
  candles: readonly Candle[],
  decisionDate: TradingDate,
  window: number,
): number {
  // Look-ahead guard: keep only candles strictly before the Decision_Date.
  const guarded = assertPastOnly(candles, decisionDate);
  const pastCandles = guarded.ok
    ? guarded.value
    : candles.filter((c) => c.date < decisionDate);

  const closes = [...pastCandles]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((c) => c.close);

  return efficiencyRatioFromCloses(closes, window);
}

/**
 * Assess whether a pair should be suppressed for being too choppy on a
 * Decision_Date (Requirements 24.1, 24.2, 24.7).
 *
 * Suppression fires iff the look-ahead-safe Efficiency Ratio is STRICTLY below
 * the configured minimum-efficiency threshold (`ER < threshold`). The metric is
 * returned regardless so callers can persist it for auditing.
 */
export function assessChoppiness(
  candles: readonly Candle[],
  decisionDate: TradingDate,
  config: ChoppinessConfig = DEFAULT_CHOPPINESS_CONFIG,
): ChoppinessAssessment {
  const efficiency = efficiencyRatio(candles, decisionDate, config.window);
  if (efficiency < config.minEfficiency) {
    return { suppressed: true, reason: "too_choppy", efficiency };
  }
  return { suppressed: false, efficiency };
}

/**
 * The result of applying the Choppiness Guard to a set of firing setups: the
 * retained setups and the ones suppressed for being too choppy (Requirement
 * 24.2). It composes with the other suppressors — the caller runs it against the
 * setups that survived the Currency Concentration Guard.
 */
export interface ChoppinessResult {
  readonly kept: readonly FiringSetup[];
  readonly suppressed: readonly ChoppinessSuppressedSetup[];
}

/**
 * Apply the Choppiness Volatility Silence Guard to a set of same-day firing
 * setups (Requirements 24.2, 24.3, 24.4).
 *
 * For each firing setup, the guard computes the look-ahead-safe Efficiency Ratio
 * from that pair's candles (looked up via `candlesByPair`) and HARD-VETOES the
 * setup when the ratio is below the threshold, recording a `too_choppy` reason
 * and the offending efficiency. A pair with no candle history available is left
 * untouched (the guard cannot assess it, so it does not silence it). The guard
 * is applied to all five pairs by virtue of being run over every firing setup
 * (Requirement 24.3).
 *
 * A pure, deterministic function (Requirements 24.7, 24.8): identical inputs
 * return identical `kept` / `suppressed` sets. It never generates a signal and
 * never touches the directional probability, Earned_Confidence, Direction_Class,
 * retrieval, or the Kill_Gate verdict (Requirements 24.4, 24.5).
 *
 * @param firing         The setups that survived the prior suppression steps.
 * @param candlesByPair  Per-pair daily candles used to compute the metric. A
 *                       missing entry means the pair cannot be assessed and is
 *                       kept unchanged.
 * @param decisionDate   The Decision_Date; only pre-date candles are used.
 * @param config         Optional Choppiness Guard config (window + threshold).
 */
export function applyChoppinessGuard(
  firing: readonly FiringSetup[],
  candlesByPair: ReadonlyMap<Pair, readonly Candle[]>,
  decisionDate: TradingDate,
  config: ChoppinessConfig = DEFAULT_CHOPPINESS_CONFIG,
): ChoppinessResult {
  const kept: FiringSetup[] = [];
  const suppressed: ChoppinessSuppressedSetup[] = [];

  for (const setup of firing) {
    const candles = candlesByPair.get(setup.pair);
    if (!candles) {
      // No history to assess ⇒ the guard has no basis to silence this pair.
      kept.push(setup);
      continue;
    }
    const assessment = assessChoppiness(candles, decisionDate, config);
    if (assessment.suppressed) {
      suppressed.push({
        pair: setup.pair,
        reason: "too_choppy",
        efficiency: assessment.efficiency,
      });
    } else {
      kept.push(setup);
    }
  }

  return { kept, suppressed };
}

/**
 * The Choppiness Volatility Silence Guard as a Component 18 interface object
 * bound to a per-pair candle lookup and a configuration (Requirement 24). The
 * `efficiencyRatio` / `assess` methods mirror the design's interface shape.
 */
export interface ChoppinessGuard {
  /** Efficiency Ratio over a trailing window, look-ahead-safe (Req 24.1, 24.7). */
  efficiencyRatio(pair: Pair, decisionDate: TradingDate, window: number): number;
  /** Suppress the pair when efficiency is below the threshold (Req 24.2, 24.4). */
  assess(pair: Pair, decisionDate: TradingDate): ChoppinessAssessment;
}

/**
 * Construct a {@link ChoppinessGuard} bound to a per-pair candle lookup and a
 * configuration (Requirement 24.6). A thin, deterministic wrapper over the pure
 * functions above.
 */
export function createChoppinessGuard(
  candlesByPair: ReadonlyMap<Pair, readonly Candle[]>,
  config: ChoppinessConfig = DEFAULT_CHOPPINESS_CONFIG,
): ChoppinessGuard {
  return {
    efficiencyRatio(pair, decisionDate, window) {
      return efficiencyRatio(candlesByPair.get(pair) ?? [], decisionDate, window);
    },
    assess(pair, decisionDate) {
      return assessChoppiness(candlesByPair.get(pair) ?? [], decisionDate, config);
    },
  };
}
