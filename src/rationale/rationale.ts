// Signal Rationale & Pattern Description generators — the OUTWARD-ONLY display
// producers (Requirement 15; Design Component 9 roles `signal_rationale` /
// `pattern_description`, and "The AI / Deterministic Boundary").
//
// Two generators, both on the OUTWARD edge of the AI / Deterministic boundary:
//
//   generateSignalRationale(numericInputs) → LlmTagged<string>
//     Plain-language rationale DERIVED FROM the deterministic numeric signal
//     (pattern, trend context, Structural_Liquidity_SR distance, selected
//     Horizon, Earned_Confidence). The numbers flow IN; the text flows OUT and
//     is provenance-tagged so it can never flow back into the numeric signal.
//     (Requirements 15.1, 15.2)
//
//   generatePatternDescription(analogues) → LlmTagged<readonly string[]>
//     Qualitative labels describing the matched historical analogues, for
//     display only. (Requirement 15.3)
//
// Both route through the single `LlmInterface.invoke()` gateway (Requirement
// 2.4), so their outputs are already wrapped in `LlmTagged<…>`. That branded,
// display-only typing is exactly what excludes rationale/labels from the
// directional probability and Kill_Gate verdict computations (Requirement 15.4):
// a scoring parameter typed `Deterministic<T>` rejects an `LlmTagged<…>` at
// compile time, and the `ScoringInputGuard` rejects it at runtime.
//
// These functions are pure with respect to the numeric signal: they READ the
// numbers and produce display text; they never mutate or return anything that
// the deterministic core consumes. There is deliberately NO code path here that
// feeds a generated value into `earnedConfidence`, `classify`, `selectHorizon`,
// or the gate verdict.

import type { LlmInterface } from "../llm/llmInterface.js";
import type { PatternDescriptionInput, SignalRationaleInput } from "../llm/types.js";
import type {
  AnalogueLabels,
  AnalogueSummary,
  SignalNumericInputs,
  SignalRationaleText,
} from "./types.js";

/**
 * Project the deterministic numeric signal into the flat, plain-data payload the
 * `signal_rationale` role consumes (Requirement 15.1). This is a lossless,
 * NUMERIC-ONLY projection: it copies the enumerated/numeric fields of
 * {@link SignalNumericInputs} and adds nothing derived from an LLM. Keeping the
 * projection explicit documents that only the numbers cross into the role.
 */
function toRationaleInput(numericInputs: SignalNumericInputs): SignalRationaleInput {
  return {
    pattern: numericInputs.pattern,
    trendContext: numericInputs.trendContext,
    structuralLiquidityDistancePips: numericInputs.structuralLiquidityDistancePips,
    selectedHorizon: numericInputs.selectedHorizon,
    direction: numericInputs.direction,
    earnedConfidence: numericInputs.earnedConfidence,
  };
}

/**
 * Project the matched analogue summaries into the plain-data payload the
 * `pattern_description` role consumes (Requirement 15.3). NUMERIC-ONLY: each
 * analogue contributes its date, direction, horizon, and excursions — never an
 * LLM-derived value.
 */
function toPatternDescriptionInput(
  analogues: readonly AnalogueSummary[],
): PatternDescriptionInput {
  return {
    analogues: analogues.map((a) => ({
      decisionDate: a.decisionDate,
      direction: a.direction,
      horizon: a.horizon,
      mfePips: a.mfePips,
      maePips: a.maePips,
    })),
  };
}

/**
 * Generate the plain-language signal rationale for a firing setup
 * (Requirements 15.1, 15.2).
 *
 * The rationale is DERIVED FROM the deterministic numeric signal — pattern,
 * trend context, Structural_Liquidity_SR distance, selected Horizon, and
 * Earned_Confidence (Requirement 15.1). The numeric inputs flow one way, IN.
 *
 * The result is `LlmTagged<string>` ({@link SignalRationaleText}) — a
 * provenance-branded, DISPLAY-ONLY value. It is structurally impossible for this
 * value to alter the numeric signal (Requirement 15.2): the LLM brand makes it
 * non-assignable to any scoring / verdict parameter (which are typed
 * `Deterministic<T>`), and the runtime `ScoringInputGuard` blocks it if it is
 * ever handed to a scoring path. This function has no return path INTO the
 * deterministic core.
 *
 * @param llm         The single LLM gateway (Requirement 2.4).
 * @param numericInputs The deterministic numeric signal to describe.
 * @returns The display-only, provenance-tagged rationale text.
 */
export async function generateSignalRationale(
  llm: LlmInterface,
  numericInputs: SignalNumericInputs,
): Promise<SignalRationaleText> {
  return llm.invoke("signal_rationale", toRationaleInput(numericInputs));
}

/**
 * Generate qualitative labels describing the matched historical analogues, for
 * display only (Requirement 15.3).
 *
 * The result is `LlmTagged<readonly string[]>` ({@link AnalogueLabels}) — a
 * provenance-branded, DISPLAY-ONLY value excluded from the directional
 * probability and Kill_Gate verdict computations by construction
 * (Requirement 15.4). As with the rationale, there is no code path returning
 * these labels into the deterministic core.
 *
 * @param llm       The single LLM gateway (Requirement 2.4).
 * @param analogues The matched analogue summaries to label.
 * @returns The display-only, provenance-tagged qualitative labels.
 */
export async function generatePatternDescription(
  llm: LlmInterface,
  analogues: readonly AnalogueSummary[],
): Promise<AnalogueLabels> {
  return llm.invoke("pattern_description", toPatternDescriptionInput(analogues));
}
