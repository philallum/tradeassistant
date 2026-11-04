// Daily Commentary generator — an OUTWARD-ONLY, display-only producer on the AI
// / Deterministic boundary (Requirement 15; Design Component 9 role
// `signal_rationale`).
//
// Unlike `generateSignalRationale` (which describes ONE firing setup), this
// generates a SHORT whole-day note across all five pairs — produced EVERY
// trading day, including days on which nothing fired. Its purpose is twofold:
//   1. a plain-language summary of the day's deterministic picture (how many
//      pairs cleared the Confidence_Threshold, and when none did, why — which
//      pairs were FLAT, which fell short, how choppy conditions were), and
//   2. a LIVENESS SIGNAL for the LLM path: because the note is only produced
//      when the real model answers, its presence tells the operator the AI
//      layer actually ran that day (a silent day no longer looks identical to a
//      broken/absent run).
//
// BOUNDARY (hard constraint — Requirements 15.2, 15.4, 2.x): the note is built
// ONLY from the deterministic per-pair numbers (direction, Earned_Confidence vs
// the threshold, choppiness) and routes through the single
// `LlmInterface.invoke("signal_rationale", …)` gateway, so its output is
// `LlmTagged<string>` — provenance-branded, structurally non-assignable to any
// `Deterministic<T>` scoring parameter, and blocked by the `ScoringInputGuard`
// if ever handed to a scoring path. Numbers flow IN; text flows OUT; nothing
// flows back. No new sanctioned role is introduced (the role allow-list is
// unchanged); this reuses `signal_rationale`.

import type { LlmInterface } from "../llm/llmInterface.js";
import type { SignalRationaleInput } from "../llm/types.js";
import type { LlmTagged } from "../llm/types.js";
import type { Confidence } from "../confidence/types.js";
import type { DirectionClass } from "../retrieval/types.js";

/**
 * The DETERMINISTIC per-pair facts the daily note is derived FROM. Every field
 * is a plain numeric / enumerated value copied from the run's `PairEvaluation`s
 * (direction, Earned_Confidence, choppiness) plus the derived `fired` flag — no
 * LLM-derived value crosses into the note. Numeric → text, one way.
 */
export interface DailyCommentaryPair {
  readonly pair: string;
  readonly direction: DirectionClass;
  readonly earnedConfidence: Confidence;
  readonly choppiness: number;
  readonly fired: boolean;
}

/**
 * The deterministic payload for a whole-day note: the Decision_Date, the firing
 * Confidence_Threshold the day was judged against, and every evaluated pair's
 * facts. Pure data; no LLM type.
 */
export interface DailyCommentaryInput {
  readonly decisionDate: string;
  readonly confidenceThreshold: number;
  readonly pairs: readonly DailyCommentaryPair[];
}

/** The display-only daily note the Setups panel shows: `LlmTagged<string>`. */
export type DailyCommentaryText = LlmTagged<string>;

/**
 * Project the deterministic daily facts into the flat, plain-data payload the
 * `signal_rationale` role consumes. NUMERIC-ONLY: it copies the per-pair
 * enumerated/numeric fields and the threshold, and adds a small, explicit
 * instruction describing the display intent so the model writes a concise
 * operator-facing note. Nothing LLM-derived is read here.
 *
 * `SignalRationaleInput` is an open structural map (`{ [key: string]: unknown }`),
 * so this richer whole-day payload is a valid input to the SAME sanctioned role
 * without widening the role vocabulary.
 */
export function toDailyCommentaryInput(input: DailyCommentaryInput): SignalRationaleInput {
  const firedCount = input.pairs.filter((p) => p.fired).length;
  return {
    task: "daily_commentary",
    intent:
      "Write a short (2–3 sentence) plain-language note summarising the day's FX pattern " +
      "scan for a single operator. State whether any setups cleared the confidence " +
      "threshold and, if not, briefly why (which pairs were flat, which fell short, how " +
      "choppy conditions were). If setups fired, name EVERY pair marked fired=true, not " +
      "just one. The system works on daily candles, so refer to timing in trading days, " +
      "never minutes or hours. Do not give trading advice or invent numbers; describe " +
      "only the figures provided.",
    decisionDate: input.decisionDate,
    confidenceThreshold: input.confidenceThreshold,
    firedCount,
    evaluatedCount: input.pairs.length,
    pairs: input.pairs.map((p) => ({
      pair: p.pair,
      direction: p.direction,
      earnedConfidence: p.earnedConfidence,
      choppiness: p.choppiness,
      fired: p.fired,
    })),
  };
}

/**
 * Generate the display-only daily commentary for a Decision_Date (every trading
 * day, fired or not).
 *
 * Routes through the single LLM gateway with the sanctioned `signal_rationale`
 * role, so the result is `LlmTagged<string>` — a provenance-branded, DISPLAY-ONLY
 * value that cannot re-enter the deterministic signal (Requirements 15.2, 15.4).
 * The caller is responsible for fail-safety (skip when no LLM is configured; a
 * thrown provider error degrades to "no note"), consistent with the other
 * display-only producers.
 *
 * @param llm   The single LLM gateway (Requirement 2.4).
 * @param input The deterministic whole-day facts to describe.
 * @returns The display-only, provenance-tagged daily note text.
 */
export async function generateDailyCommentary(
  llm: LlmInterface,
  input: DailyCommentaryInput,
): Promise<DailyCommentaryText> {
  return llm.invoke("signal_rationale", toDailyCommentaryInput(input));
}
