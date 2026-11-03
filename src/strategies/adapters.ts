// Existing-producer adapters — bridge the two already-built signal producers
// (the custom pattern matcher's Earned_Confidence and the display-only
// External_Reference_Signal) into the shared `StrategySignal` contract
// (Requirement 7; Design "5. Adapters: src/strategies/adapters.ts").
//
// AI/Deterministic + scoring-path boundary: these adapters are called ONLY from
// the per-run matrix builder, which sits OUTSIDE the firing / confidence /
// Kill_Gate path. This module therefore imports NOTHING from `confidence/` or
// `kill-gate/` — it takes only the TYPES of `PairEvaluation` and
// `ExternalReferenceSignal` (via `import type`, erased at compile time) so that
// Earned_Confidence and the Kill_Gate verdict can never, by construction,
// depend on an adapter (Requirement 7.10). Every signal it emits is built
// through `buildSignal` and validated, and an LLM-tagged reference is refused
// before it can become a signal (Requirement 7.8).

import { buildSignal, type StrategySignal } from "./types.js";
import { clamp01 } from "./indicators.js";
import { isLlmTagged } from "../llm/types.js";
import type { PairEvaluation } from "../dashboard/dashboard.js";
import type { ExternalReferenceSignal } from "../external-signal/types.js";

/**
 * The result of running an adapter. Either a validated {@link StrategySignal}
 * (`kind: "signal"`), or an `unavailable` outcome carrying a non-empty,
 * human-readable reason the producer could not be adapted (Requirement 7.8).
 */
export type AdapterOutcome =
  | { readonly kind: "signal"; readonly signal: StrategySignal }
  | { readonly kind: "unavailable"; readonly reason: string };

/**
 * The provider-defined full-scale value for a third-party score. A `|score|` at
 * or above `fullScaleAbs` maps to strength `1.0`; smaller magnitudes scale down
 * linearly (Requirement 7.4).
 */
export interface ThirdPartyScoreScale {
  /** `|score|` at or above this value maps to strength `1.0`. Default `1.0`. */
  readonly fullScaleAbs: number;
}

/**
 * The default third-party score scale. `1.0` matches the FCS provider's "1%
 * daily change is a full-strength read" convention (Design "5. Adapters").
 */
export const DEFAULT_THIRD_PARTY_SCALE: ThirdPartyScoreScale = { fullScaleAbs: 1.0 };

/** The default strength for an UP/DOWN third-party read with no score (Requirement 7.6). */
const NO_SCORE_STRENGTH = 0.5 as const;

/**
 * Adapt the custom pattern matcher's deterministic {@link PairEvaluation} into a
 * `custom_pattern` {@link StrategySignal}.
 *
 * `UP` or `DOWN` maps to `strength = earnedConfidence` (already in `[0, 1]`);
 * `FLAT` maps to strength `0` whatever the confidence (Requirements 7.1, 7.2).
 * `buildSignal` forces the FLAT strength to `0` regardless, so a non-zero
 * confidence on a FLAT evaluation is ignored, not an error.
 *
 * The input `evaluation` is read-only and is never mutated or written back
 * (Requirement 7.9): only its `direction` and `earnedConfidence` are read.
 */
export function adaptCustomPattern(
  evaluation: Pick<PairEvaluation, "direction" | "earnedConfidence">,
): AdapterOutcome {
  const { direction, earnedConfidence } = evaluation;
  const rationale = `pattern matcher: ${direction}, earned confidence ${earnedConfidence.toFixed(3)}`;

  const built = buildSignal("custom_pattern", direction, earnedConfidence, rationale);
  if (!built.ok) {
    return { kind: "unavailable", reason: `custom_pattern: ${built.error.message}` };
  }
  return { kind: "signal", signal: built.value };
}

/** The three recommendation directions a valid third-party reference may carry. */
const REFERENCE_DIRECTION_MAP = {
  BUY: "UP",
  SELL: "DOWN",
  HOLD: "FLAT",
} as const;

/**
 * Adapt a third-party {@link ExternalReferenceSignal} into a `third_party`
 * {@link StrategySignal}, or report it `unavailable`.
 *
 * Mapping and normalisation (Requirements 7.3 to 7.6):
 *   - `BUY` -> UP, `SELL` -> DOWN, `HOLD` -> FLAT.
 *   - UP/DOWN with a finite score: `strength = clamp01(|score| / fullScaleAbs)`,
 *     a linear, deterministic normalisation.
 *   - UP/DOWN with no score: strength `0.5`.
 *   - FLAT: strength `0` always.
 *
 * Returns an `unavailable` outcome with a non-empty reason when the reference is
 * `null`/`undefined`, is LLM-tagged, has a direction that is not one of
 * `BUY`/`SELL`/`HOLD`, or carries a `NaN`/infinite score (Requirements 7.7, 7.8).
 * The reference is accepted as `unknown` and validated structurally here.
 */
export function adaptThirdParty(
  reference: unknown,
  scale: ThirdPartyScoreScale = DEFAULT_THIRD_PARTY_SCALE,
): AdapterOutcome {
  // Null / undefined reference — no read was available for the Pair.
  if (reference === null || reference === undefined) {
    return { kind: "unavailable", reason: "third_party: no reference available" };
  }

  // LLM-tagged value — refused before anything else, so a tagged value can never
  // become a third_party signal (Requirements 7.8, 13.8).
  if (isLlmTagged(reference)) {
    return {
      kind: "unavailable",
      reason: "third_party: reference carries an LLM provenance brand",
    };
  }

  if (typeof reference !== "object") {
    return { kind: "unavailable", reason: "third_party: reference is not an object" };
  }

  const candidate = reference as Partial<ExternalReferenceSignal>;
  const { direction } = candidate;

  // Unknown direction — not one of BUY / SELL / HOLD (Requirement 7.7).
  if (
    direction !== "BUY" &&
    direction !== "SELL" &&
    direction !== "HOLD"
  ) {
    return {
      kind: "unavailable",
      reason: `third_party: unknown direction ${String(direction)}`,
    };
  }

  const signalDirection = REFERENCE_DIRECTION_MAP[direction];
  const { score } = candidate;
  const hasScore = score !== undefined;

  // A present-but-non-finite score is rejected; an absent score is allowed and
  // falls back to the default strength for UP/DOWN (Requirements 7.6, 7.7).
  if (hasScore && (typeof score !== "number" || !Number.isFinite(score))) {
    return {
      kind: "unavailable",
      reason: `third_party: non-finite score ${String(score)}`,
    };
  }

  let strength: number;
  if (signalDirection === "FLAT") {
    // FLAT is always strength 0; buildSignal enforces this regardless (7.5).
    strength = 0;
  } else if (score !== undefined) {
    strength = clamp01(Math.abs(score) / scale.fullScaleAbs);
  } else {
    strength = NO_SCORE_STRENGTH;
  }

  const scoreText = score !== undefined ? `score ${score.toFixed(3)}` : "no score";
  const rationale = `third party: ${direction} -> ${signalDirection}, ${scoreText}, strength ${strength.toFixed(3)}`;

  const built = buildSignal("third_party", signalDirection, strength, rationale);
  if (!built.ok) {
    return { kind: "unavailable", reason: `third_party: ${built.error.message}` };
  }
  return { kind: "signal", signal: built.value };
}
