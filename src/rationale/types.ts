// Signal Rationale & Pattern Description Types — the OUTWARD-ONLY display layer
// (Requirement 15; Design Component 9 roles `signal_rationale` /
// `pattern_description`, and "The AI / Deterministic Boundary").
//
// This module owns the vocabulary for the two AI roles whose output flows
// OUTWARD ONLY, to the dashboard card, and can NEVER alter the numeric signal
// (Requirements 15.2, 15.4; Design: "Rationale text and analogue labels flow
// outward only … derived from the numeric signal and cannot alter it").
//
// The structural guarantee is the whole point of this file:
//   - The INPUT to rationale generation is a typed struct of the DETERMINISTIC
//     numeric signal (pattern / trend context, Structural_Liquidity_SR
//     distance, selected Horizon, Earned_Confidence) — the rationale READS the
//     numbers (Requirement 15.1). The numbers never read the rationale.
//   - The OUTPUT is `LlmTagged<…>` (the provenance-branded marker from the LLM
//     vocabulary). Because scoring / verdict parameters are typed
//     `Deterministic<T>` (which collapses any `LlmTagged<…>` to `never`), the
//     compiler refuses to feed a generated rationale or label back into
//     `earnedConfidence` or the Kill_Gate verdict, and the runtime
//     `ScoringInputGuard` blocks it too (Requirements 15.2, 15.4, 2.6).
//
// No new probability/verdict code path is introduced here; these are purely
// display-only producers on the outward edge of the boundary.

import type { Confidence, Horizon } from "../confidence/types.js";
import type { DirectionClass } from "../retrieval/types.js";
import type { LlmTagged } from "../llm/types.js";

/**
 * The DETERMINISTIC numeric signal inputs a rationale is derived FROM
 * (Requirement 15.1). Every field is a plain numeric / enumerated value taken
 * from the deterministic core (retrieval + `confidenceSelector`), never an
 * LLM-derived type — so this struct is safe to hand to the `signal_rationale`
 * role, and the flow is strictly numeric → text.
 *
 * The fields mirror exactly the five inputs Requirement 15.1 enumerates:
 *   - `pattern`               — the query pattern shape context (opaque label
 *                               / id of the matched pattern, for display).
 *   - `trendContext`          — the Weekly_Trend_Sign regime (UP / DOWN).
 *   - `structuralLiquidityDistancePips` — distance to the nearest structural
 *                               S/R level (Requirement 13.6), in pips.
 *   - `selectedHorizon`       — the Horizon chosen by `selectHorizon()`.
 *   - `earnedConfidence`      — the shrunk Earned_Confidence in [0,1].
 *
 * `direction` is included because it is a deterministic classification result
 * that the rationale describes; like the rest it is numeric/enumerated data,
 * not LLM output.
 */
export interface SignalNumericInputs {
  /** Opaque display label / id of the matched pattern shape. */
  readonly pattern: string;
  /** The macro-regime trend context: the query's Weekly_Trend_Sign. */
  readonly trendContext: "UP" | "DOWN";
  /** Distance to the nearest Structural_Liquidity_SR level, in pips (Req 13.6). */
  readonly structuralLiquidityDistancePips: number;
  /** The selected forward Horizon (1 | 2 | 3 trading days). */
  readonly selectedHorizon: Horizon;
  /** The deterministic Direction_Class the setup resolved to. */
  readonly direction: DirectionClass;
  /** The shrunk Earned_Confidence in [0,1]. */
  readonly earnedConfidence: Confidence;
}

/**
 * A minimal, DISPLAY-ONLY summary of a matched historical analogue, handed to
 * the `pattern_description` role so it can produce qualitative labels
 * (Requirement 15.3). Deliberately a small numeric/enumerated shape — no LLM
 * type — so the flow into label generation is numeric → labels.
 */
export interface AnalogueSummary {
  /** The analogue's own trading date (ISO-8601 YYYY-MM-DD). */
  readonly decisionDate: string;
  /** The analogue's resolved terminal Direction_Class. */
  readonly direction: DirectionClass;
  /** The Horizon this outcome was resolved at. */
  readonly horizon: Horizon;
  /** Maximum favorable excursion in pips. */
  readonly mfePips: number;
  /** Maximum adverse excursion in pips. */
  readonly maePips: number;
}

/**
 * The rationale text a firing card shows, as produced by the `signal_rationale`
 * role (Requirement 15.1). It is `LlmTagged<string>` — a provenance-branded,
 * DISPLAY-ONLY value. The brand is what makes it structurally impossible to
 * feed back into the numeric signal: a scoring parameter typed
 * `Deterministic<T>` rejects it at compile time, and the `ScoringInputGuard`
 * rejects it at runtime (Requirements 15.2, 15.4).
 */
export type SignalRationaleText = LlmTagged<string>;

/**
 * The qualitative analogue labels a firing card shows, as produced by the
 * `pattern_description` role (Requirement 15.3). Like {@link SignalRationaleText}
 * it is `LlmTagged<…>` and therefore DISPLAY-ONLY: excluded from the directional
 * probability and Kill_Gate verdict computations by construction
 * (Requirement 15.4).
 */
export type AnalogueLabels = LlmTagged<readonly string[]>;
