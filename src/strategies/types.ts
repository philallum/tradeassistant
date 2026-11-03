// Strategy Signal Contract — the one shared vocabulary every signal producer
// speaks (Requirement 1; Design "1. Signal contract: src/strategies/types.ts").
//
// This is the deterministic AI/non-AI boundary for the confluence feature:
//   - `StrategySignal` is a plain, four-field, LLM-free record. Its field
//     unions make illegal `strategyId`/`direction` values a compile error
//     (Requirements 1.2, 1.3), and the type deliberately carries no
//     LLM-tagged member (Requirement 1.7).
//   - `validateStrategySignal` is the single runtime guard. Every producer and
//     the engine run their inputs through it, so a producer bug (a bad
//     strength, an empty rationale, or — worst — an LLM-tagged value) is caught
//     before it can reach the Confluence_Engine or the dashboard
//     (Requirements 1.4, 1.6, 1.8).
//   - `buildSignal` is the only constructor strategies use. It forces strength
//     to exactly 0 for FLAT (Requirement 1.5) while leaving UP/DOWN with a
//     strength of 0 untouched (Requirement 1.9), then validates the rest.
//
// Pure, deterministic, and dependency-light: this module imports only the
// shared `Result`/`Candle`/`TradingDate` primitives from `src/guard` and the
// `isLlmTagged`/`LlmTagged` provenance detector from `src/llm/types.js`. It
// imports no model client — nothing in `src/strategies` ever does.

import { type Result, ok, err } from "../guard/types.js";
import type { Candle, TradingDate, LookAheadViolation } from "../guard/types.js";
import { isLlmTagged } from "../llm/types.js";

/**
 * The six — and only six — Strategy_Ids (Requirement 1.2). The literal-union
 * type derived from this tuple makes any other value a compile-time error.
 */
export const STRATEGY_IDS = [
  "trend",
  "breakout",
  "range",
  "reversal",
  "custom_pattern",
  "third_party",
] as const;

/** A Strategy_Id: one of the six {@link STRATEGY_IDS} (Requirement 1.2). */
export type StrategyId = (typeof STRATEGY_IDS)[number];

/**
 * The three — and only three — Signal_Directions (Requirement 1.3). The
 * literal-union type makes any other value a compile-time error.
 */
export const SIGNAL_DIRECTIONS = ["UP", "DOWN", "FLAT"] as const;

/** A Signal_Direction: `UP`, `DOWN`, or `FLAT` (Requirement 1.3). */
export type SignalDirection = (typeof SIGNAL_DIRECTIONS)[number];

/** The inclusive upper bound on a {@link StrategySignal} rationale (Requirement 1.6). */
export const RATIONALE_MAX_LENGTH = 500 as const;

/**
 * The standardized output of one signal producer — exactly four fields and no
 * LLM-tagged member (Requirements 1.1, 1.7).
 *
 * Invariants, enforced by {@link validateStrategySignal} / {@link buildSignal}:
 *   - `strength` is a finite number in `[0, 1]` (Requirement 1.4) and exactly
 *     `0` when `direction` is `FLAT` (Requirement 1.5).
 *   - `rationale` is 1 to 500 characters with at least one non-whitespace
 *     character (Requirement 1.6).
 */
export interface StrategySignal {
  readonly strategyId: StrategyId;
  readonly direction: SignalDirection;
  /** Finite, within `[0, 1]`; exactly `0` when `direction` is `FLAT`. */
  readonly strength: number;
  /** 1 to 500 characters, with at least one non-whitespace character. */
  readonly rationale: string;
}

/**
 * The field a rejected value violated. `shape` means the value was not a plain
 * object with exactly the four {@link StrategySignal} keys; `llm_tagged` means
 * the value carried an LLM provenance brand and was refused before any other
 * check (Requirements 1.7, 1.8).
 */
export interface SignalViolation {
  readonly reason: "invalid_signal";
  readonly field:
    | "strategyId"
    | "direction"
    | "strength"
    | "rationale"
    | "shape"
    | "llm_tagged";
  readonly message: string;
}

/** Runtime type guard for {@link StrategyId} (Requirement 1.2). */
export function isStrategyId(v: unknown): v is StrategyId {
  return (STRATEGY_IDS as readonly unknown[]).includes(v);
}

/** Runtime type guard for {@link SignalDirection} (Requirement 1.3). */
export function isSignalDirection(v: unknown): v is SignalDirection {
  return (SIGNAL_DIRECTIONS as readonly unknown[]).includes(v);
}

/** The exact set of own keys a {@link StrategySignal} must have. */
const SIGNAL_KEYS = ["strategyId", "direction", "strength", "rationale"] as const;

const violation = (
  field: SignalViolation["field"],
  message: string,
): Result<never, SignalViolation> =>
  err({ reason: "invalid_signal", field, message });

/**
 * The single runtime guard for any value claiming to be a {@link StrategySignal}.
 *
 * Checks run in a fixed order, and the FIRST failure is returned with the
 * offending field named (Requirement 1.8):
 *   1. `llm_tagged` — the value carries an LLM provenance brand (Requirement 1.7).
 *   2. `shape` — not a plain object with exactly the four signal keys.
 *   3. `strategyId` — not one of {@link STRATEGY_IDS} (Requirement 1.2).
 *   4. `direction` — not one of {@link SIGNAL_DIRECTIONS} (Requirement 1.3).
 *   5. `strength` — not a finite number in `[0, 1]`, or not exactly `0` when the
 *      direction is `FLAT` (Requirements 1.4, 1.5).
 *   6. `rationale` — not a string of length 1 to 500 with a non-whitespace
 *      character (Requirement 1.6).
 */
export function validateStrategySignal(
  v: unknown,
): Result<StrategySignal, SignalViolation> {
  // 1. LLM brand — refused before anything else, so a tagged value can never be
  //    a StrategySignal input (Requirements 1.7, 1.8).
  if (isLlmTagged(v)) {
    return violation(
      "llm_tagged",
      "value carries an LLM provenance brand and cannot be a StrategySignal",
    );
  }

  // 2. Shape: a plain object with exactly the four own keys.
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    return violation("shape", "signal must be a non-array object");
  }
  const keys = Object.keys(v);
  if (
    keys.length !== SIGNAL_KEYS.length ||
    !SIGNAL_KEYS.every((k) => Object.prototype.hasOwnProperty.call(v, k))
  ) {
    return violation(
      "shape",
      `signal must have exactly the keys ${SIGNAL_KEYS.join(", ")}`,
    );
  }

  const candidate = v as Record<(typeof SIGNAL_KEYS)[number], unknown>;

  // 3. strategyId membership.
  if (!isStrategyId(candidate.strategyId)) {
    return violation(
      "strategyId",
      `strategyId must be one of ${STRATEGY_IDS.join(", ")}`,
    );
  }

  // 4. direction membership.
  if (!isSignalDirection(candidate.direction)) {
    return violation(
      "direction",
      `direction must be one of ${SIGNAL_DIRECTIONS.join(", ")}`,
    );
  }

  // 5. strength: finite number within [0, 1], and exactly 0 when FLAT.
  const { strength, direction } = candidate;
  if (typeof strength !== "number" || !Number.isFinite(strength)) {
    return violation("strength", "strength must be a finite number");
  }
  if (strength < 0 || strength > 1) {
    return violation("strength", "strength must be within [0, 1]");
  }
  if (direction === "FLAT" && strength !== 0) {
    return violation("strength", "strength must be exactly 0 when direction is FLAT");
  }

  // 6. rationale: string of length 1..500 with a non-whitespace character.
  const { rationale } = candidate;
  if (typeof rationale !== "string") {
    return violation("rationale", "rationale must be a string");
  }
  if (rationale.length < 1 || rationale.length > RATIONALE_MAX_LENGTH) {
    return violation(
      "rationale",
      `rationale must be 1 to ${RATIONALE_MAX_LENGTH} characters`,
    );
  }
  if (rationale.trim().length === 0) {
    return violation(
      "rationale",
      "rationale must contain at least one non-whitespace character",
    );
  }

  return ok({
    strategyId: candidate.strategyId,
    direction,
    strength,
    rationale,
  });
}

/**
 * The only constructor strategies use to produce a {@link StrategySignal}.
 *
 * A `FLAT` direction forces `strength` to exactly `0` regardless of the value
 * passed (Requirement 1.5). An `UP`/`DOWN` signal with a `strength` of `0` is
 * kept unchanged — it is a valid signal and is never re-classified as `FLAT`
 * (Requirement 1.9). The resulting record is then validated, so a bad
 * `strength` or `rationale` is rejected with the offending field named
 * (Requirement 1.8).
 */
export function buildSignal(
  strategyId: StrategyId,
  direction: SignalDirection,
  strength: number,
  rationale: string,
): Result<StrategySignal, SignalViolation> {
  const normalizedStrength = direction === "FLAT" ? 0 : strength;
  return validateStrategySignal({
    strategyId,
    direction,
    strength: normalizedStrength,
    rationale,
  });
}

/**
 * Every failure mode a strategy's `evaluate` can return. Reused across all four
 * strategies so look-ahead, emptiness, finiteness, and defensive signal-build
 * failures behave identically (Design "1. Signal contract").
 *
 *   - {@link LookAheadViolation} — a candle dated at or after the Decision_Date
 *     reached the strategy (Requirements 6.1, 6.2).
 *   - `insufficient_data` — an empty candle array (Requirement 6.8).
 *   - `invalid_candle` — a non-finite OHLC field, with the first bad field and
 *     the candle date named (Requirement 6.7).
 *   - {@link SignalViolation} — defensive: a producer bug caught by
 *     {@link buildSignal} (Requirement 1.8).
 */
export type StrategyError =
  | LookAheadViolation
  | { readonly reason: "insufficient_data"; readonly message: string }
  | {
      readonly reason: "invalid_candle";
      readonly field: "open" | "high" | "low" | "close";
      readonly date: string;
      readonly message: string;
    }
  | SignalViolation;

/** The result of evaluating a strategy for a Pair and Decision_Date. */
export type StrategyResult = Result<StrategySignal, StrategyError>;

/**
 * A deterministic, Look_Ahead_Safe strategy. `config` is held frozen by the
 * factory that created it; `evaluate` is a pure function of its inputs and
 * never mutates the caller's candle array.
 */
export interface Strategy<C> {
  readonly id: StrategyId;
  readonly config: Readonly<C>;
  evaluate(
    candles: readonly Candle[],
    decisionDate: TradingDate,
  ): StrategyResult;
}

/**
 * The error a strategy factory returns when its configuration is invalid. No
 * strategy instance is created on failure, so the caller's previously active
 * configuration is left unchanged (Requirements 2.11, 4.9, 5.10, 8.6, 9.7).
 */
export interface ConfigError {
  readonly reason: "invalid_config";
  readonly parameter: string;
  readonly message: string;
}
