// End-to-End Daily-Run Pipeline — task 11.1.
//
// Wires the deterministic compute modules into the SINGLE daily-run path, in
// the design's data-flow order:
//
//   ingestion (candles) → encoder (pattern vector) → retrieval (ANN + filters)
//     → resolver (matured forward outcomes, read via the AnalogueStore)
//     → confidence (Earned_Confidence, Direction_Class, Horizon)
//     → kill-gate / feature-registry (gate-passing gate, injected)
//     → news filter (deterministic suppression, injected)
//     → risk boundaries (empirical SL/TP)
//     → dashboard (`dailyRun`, via the caller)
//
// The output is the `PairEvaluation[]` the dashboard's `dailyRun` consumes, one
// entry per pair, produced in the canonical PAIRS order so the whole path is
// deterministic (Requirement 3.1): identical stored inputs + config yield an
// identical result, and therefore a scheduled unattended run reproduces an
// equivalent local run (Requirement 16.7).
//
// This module ORCHESTRATES only — every stage is the existing module's public
// function, and storage is reached only through the existing PORTs. No stage is
// re-implemented, and no LLM type reaches the firing decision (Requirement 2.1).

import { PAIRS, type Pair } from "../ingestion/types.js";
import type { TradingDate } from "../guard/types.js";
import { encodePatternVector } from "../encoder/patternEncoder.js";
import { retrieve } from "../retrieval/retrieve.js";
import type { AnalogueRecord, DirectionClass } from "../retrieval/types.js";
import {
  earnedConfidence,
  rawResolutionRate,
  selectHorizon,
  type Confidence,
  type Horizon,
} from "../confidence/index.js";
import { derive as deriveRiskBoundaries } from "../risk-boundaries/empiricalRiskBoundaries.js";
import type { ExcursionProfile } from "../dashboard/types.js";
import type { PairEvaluation } from "../dashboard/dashboard.js";
import {
  DEFAULT_PIPELINE_CONFIG,
  type CardNarrative,
  type PipelineConfig,
  type PipelineDeps,
} from "./types.js";

/** Default gate-passing resolver: nothing has a recorded PASS verdict yet. */
export const resolveGatePassingDefault = (): boolean => false;

/** Default news resolver: trading is permitted for every pair (no calendar wired). */
export const resolveNewsPermitDefault = () => ({ suppressed: false, reason: "no calendar feed wired" });

/** Default narrative resolver: no outward-only display text (LLM-free). */
export const resolveNarrativeEmptyDefault = (): CardNarrative => ({
  rationale: "",
  analogueLabels: [],
});

/**
 * Pick the neighborhood's dominant Direction_Class at a horizon — the
 * deterministic directional read of the matched analogues. This is NOT a new
 * signal source: it is the same UP/DOWN/FLAT tally the confidence module's
 * `rawResolutionRate` already scores (the resolution rate is the fraction of
 * analogues agreeing with this dominant direction). Returning it here keeps the
 * displayed Direction_Class definitionally consistent with Earned_Confidence.
 *
 * Ties (equal UP and DOWN counts, or no directional analogues) resolve to FLAT:
 * the neighborhood expresses no directional view, so the pair does not fire.
 */
export function dominantDirection(
  neighborhood: readonly AnalogueRecord[],
  horizon: Horizon,
): DirectionClass {
  let up = 0;
  let down = 0;
  for (const a of neighborhood) {
    if (a.horizon !== horizon) continue;
    if (a.direction === "UP") up++;
    else if (a.direction === "DOWN") down++;
  }
  if (up === 0 && down === 0) return "FLAT";
  if (up === down) return "FLAT";
  return up > down ? "UP" : "DOWN";
}

/**
 * Mean favorable (MFE) / adverse (MAE) excursion of the neighborhood at a
 * horizon, in pips — the excursion profile shown on a firing card
 * (Requirement 16.3). Empty neighborhoods yield a zero profile.
 */
export function excursionProfileAt(
  neighborhood: readonly AnalogueRecord[],
  horizon: Horizon,
): ExcursionProfile {
  let favorable = 0;
  let adverse = 0;
  let n = 0;
  for (const a of neighborhood) {
    if (a.horizon !== horizon) continue;
    favorable += a.mfePips;
    adverse += a.maePips;
    n++;
  }
  if (n === 0) return { favorablePips: 0, adversePips: 0 };
  return { favorablePips: favorable / n, adversePips: adverse / n };
}

/**
 * Evaluate ONE pair end-to-end for a Decision_Date, producing the deterministic
 * {@link PairEvaluation} the dashboard consumes.
 *
 * Steps (all through the existing module APIs, all Look-Ahead-Guard-safe):
 *   1. Read the trailing candle window strictly before `decisionDate`
 *      (CandleStore); encode the query Pattern_Vector (encoder).
 *   2. Retrieve the Analogue_Neighborhood (retrieval: weekly-trend pre-filter,
 *      self-exclusion, pre-date, matured-only, epsilon cutoff).
 *   3. Compute ATR_14 (confidence), select the Horizon, compute
 *      Earned_Confidence, and read the neighborhood's dominant Direction_Class.
 *   4. Derive the empirical Stop_Loss / Take_Profit (risk boundaries; `null`
 *      below the 30-analogue floor).
 *   5. Resolve gate-passing and the news suppression decision (injected).
 *
 * The forward-outcome resolver (`resolve`) is not called here: it populates the
 * `AnalogueStore` offline (during ingestion/backfill), and retrieval reads those
 * matured rows. That keeps the daily path free of look-ahead risk — only matured
 * outcomes strictly before the Decision_Date can ever enter the neighborhood.
 */
export async function evaluatePair(
  pair: Pair,
  decisionDate: TradingDate,
  deps: PipelineDeps,
  config: PipelineConfig,
): Promise<PairEvaluation> {
  const gatePassingResolver = deps.gatePassing ?? resolveGatePassingDefault;
  const newsResolver = deps.news ?? resolveNewsPermitDefault;
  const narrativeResolver = deps.narrative ?? resolveNarrativeEmptyDefault;

  // Step 1: trailing candle window strictly BEFORE the Decision_Date. Reading
  // with `endDate` one day before keeps the encoder / ATR window look-ahead safe
  // even before the encoder's own guard runs.
  const priorDate = previousCalendarDate(decisionDate);
  const allPrior = await deps.candleStore.getCandles(pair, undefined, priorDate);
  const window = allPrior.slice(Math.max(0, allPrior.length - config.windowSize));

  // News + gate + narrative resolve regardless of whether a window exists, so a
  // pair with no history is still represented (non-firing) in the view.
  const [gatePassing, newsDecision, narrative] = await Promise.all([
    Promise.resolve(gatePassingResolver(pair, decisionDate)),
    Promise.resolve(newsResolver(pair, decisionDate)),
    Promise.resolve(narrativeResolver(pair, decisionDate)),
  ]);

  const nonFiring = (
    direction: DirectionClass,
    horizon: Horizon,
    confidence: Confidence,
    profile: ExcursionProfile,
    stopLossPips: number | null,
    takeProfitPips: number | null,
  ): PairEvaluation => ({
    pair,
    gatePassing,
    earnedConfidence: confidence,
    direction,
    horizon,
    excursionProfile: profile,
    stopLossPips,
    takeProfitPips,
    newsSuppressed: newsDecision.suppressed,
    rationale: narrative.rationale,
    analogueLabels: narrative.analogueLabels,
  });

  // Not enough history to encode a shape → represent as a non-firing FLAT pair.
  if (window.length === 0) {
    return nonFiring("FLAT", 1, 0.5 as Confidence, { favorablePips: 0, adversePips: 0 }, null, null);
  }

  // Step 1 (cont.): encode the query Pattern_Vector (encoder enforces the guard).
  const query = encodePatternVector(window, decisionDate);

  // Step 2: retrieve the Analogue_Neighborhood.
  const neighborhood = await retrieve(
    query,
    pair,
    decisionDate,
    decisionDate,
    deps.vectorStore,
    deps.analogueStore,
    config.retrieval,
  );

  // Step 3: confidence + horizon + direction (deterministic core). The stored
  // analogues were already Direction_Class-classified with the ATR_14-scaled
  // FLAT band during resolution, so the selector reads their resolution rate
  // and dominant direction directly rather than re-classifying a live move.
  const horizon = selectHorizon(neighborhood);
  const confidence = earnedConfidence(neighborhood, horizon);
  const direction = dominantDirection(neighborhood, horizon);
  const profile = excursionProfileAt(neighborhood, horizon);

  // Step 4: empirical Stop_Loss / Take_Profit (null below the 30-analogue floor).
  const boundaries = deriveRiskBoundaries(neighborhood, horizon, config.riskBoundaries);
  const stopLossPips = boundaries?.stopLossPips ?? null;
  const takeProfitPips = boundaries?.takeProfitPips ?? null;

  return nonFiring(direction, horizon, confidence, profile, stopLossPips, takeProfitPips);
}

/**
 * Run the end-to-end daily-run pipeline for a Decision_Date across ALL five
 * pairs, returning the `PairEvaluation[]` the dashboard's `dailyRun` consumes
 * (Requirement 16.1). Pairs are evaluated in the canonical PAIRS order so the
 * result — and therefore the dashboard view — is deterministic (Requirement 3.1).
 *
 * This is the concrete implementation behind the scheduled runner's
 * `PairEvaluationLoader` seam (see {@link makePipelineLoader}); the dashboard /
 * currency-concentration / persistence stages run on the returned evaluations.
 */
export async function runDailyPipeline(
  decisionDate: TradingDate,
  deps: PipelineDeps,
): Promise<readonly PairEvaluation[]> {
  const config = deps.config ?? DEFAULT_PIPELINE_CONFIG;
  const evaluations: PairEvaluation[] = [];
  // Sequential over the five pairs keeps ordering deterministic and store access
  // predictable; the per-pair work is small.
  for (const pair of PAIRS) {
    evaluations.push(await evaluatePair(pair, decisionDate, deps, config));
  }
  return evaluations;
}

/** rawResolutionRate is re-exported for callers that want the raw score alongside. */
export { rawResolutionRate };

/**
 * The previous calendar date (YYYY-MM-DD) — used to bound the trailing candle
 * window strictly before the Decision_Date. This is a calendar step, not a
 * trading-day step: the CandleStore only holds trading days, so stepping back
 * one calendar day and filtering `date <= priorDate` reliably excludes the
 * Decision_Date itself while retaining every prior trading day.
 */
function previousCalendarDate(date: TradingDate): TradingDate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
