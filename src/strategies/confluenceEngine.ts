// Confluence_Engine — "Stay Flat on Conflict" weighted aggregation
// (Requirements 8, 9; Design "6. Confluence engine: src/strategies/confluenceEngine.ts").
//
// The engine is the one place the six Strategy_Ids are combined into a single
// directional read. It is a pure, deterministic function of its inputs:
//   - `createConfluenceEngine` merges config overrides over the defaults and
//     validates every weight and threshold BEFORE an engine exists, so an
//     invalid configuration leaves the caller's previously active engine
//     unchanged (Requirements 8.6, 9.7).
//   - `aggregate` re-validates every input signal (rejecting anything invalid,
//     including an LLM-tagged value), refuses duplicate Strategy_Ids, sorts into
//     the canonical STRATEGY_IDS order, computes the bounded weighted mean, and
//     classifies the result with the Stay_Flat_On_Conflict rule.
//
// Pure and dependency-light: it imports the shared signal contract from
// `./types.js`, the `Result`/`ok`/`err` primitives from `src/guard`, and only
// the `Deterministic` projection from `../llm/types.js` (the LLM-tag rejection
// itself is handled inside `validateStrategySignal`). It touches no clock,
// randomness, environment, network, or storage — identical inputs always yield
// identical outputs.

import { ok, err } from "../guard/types.js";
import type { Result } from "../guard/types.js";
// `isLlmTagged` enforcement lives inside `validateStrategySignal`, which every
// input passes through in step 1 of `aggregate`; only the `Deterministic<T>`
// compile-time projection is needed directly here. Nothing else is imported
// from `src/llm` (Requirement 13.8 import boundary).
import type { Deterministic } from "../llm/types.js";
import {
  STRATEGY_IDS,
  validateStrategySignal,
  type StrategyId,
  type StrategySignal,
  type SignalViolation,
  type ConfigError,
} from "./types.js";

/**
 * The classification of an aggregated set of signals (Requirement 9).
 *
 *   - `ALIGNED_UP` / `ALIGNED_DOWN` — at least two contributing strategies and
 *     the score clears the alignment threshold (Requirements 9.3, 9.4).
 *   - `NEUTRAL` — contributing strategies disagree weakly, there is only one
 *     contributor, or none (Requirements 9.5, 9.10).
 *   - `CONFLICT_FLAT` — strong opposition forces Stay_Flat (Requirements 9.1, 9.2).
 *   - `INSUFFICIENT_DATA` — the total positive weight is zero (Requirement 8.3).
 */
export type ConfluenceStatus =
  | "ALIGNED_UP"
  | "ALIGNED_DOWN"
  | "NEUTRAL"
  | "CONFLICT_FLAT"
  | "INSUFFICIENT_DATA";

/** A non-negative weight for every Strategy_Id (Requirement 8.4). */
export type ConfluenceWeights = Readonly<Record<StrategyId, number>>;

/**
 * The Confluence_Engine configuration (Requirements 8.4, 8.5, 9.6).
 *
 *   - `weights` — a finite, non-negative weight per Strategy_Id.
 *   - `conflictThreshold` — the strength at or above which an opposing UP and
 *     DOWN pair counts as "strong" (default 0.6). Finite, within `[0, 1]`.
 *   - `alignmentThreshold` — the absolute score required to classify alignment
 *     (default 0.4). Finite, within `[0, 1]`.
 */
export interface ConfluenceConfig {
  readonly weights: ConfluenceWeights;
  readonly conflictThreshold: number;
  readonly alignmentThreshold: number;
}

/**
 * The default configuration: every classical and custom-pattern strategy
 * carries weight 1, `third_party` carries weight 0 (display-only until
 * validated), the conflict threshold is 0.6, and the alignment threshold is 0.4
 * (Requirements 8.4, 8.5, 9.6).
 */
export const DEFAULT_CONFLUENCE_CONFIG: ConfluenceConfig = {
  weights: {
    trend: 1,
    breakout: 1,
    range: 1,
    reversal: 1,
    custom_pattern: 1,
    third_party: 0,
  },
  conflictThreshold: 0.6,
  alignmentThreshold: 0.4,
};

/**
 * The aggregated outcome for one Pair (Requirements 8, 9, 11.3, 11.4).
 *
 *   - `score` — the bounded weighted mean in `[-1, 1]`, with `-0` normalised to
 *     `0` (Requirements 8.1, 8.2).
 *   - `status` — the {@link ConfluenceStatus} classification.
 *   - `opposingStrategyIds` — the canonical-order union of the strongly opposing
 *     strategies; non-empty ONLY when the status is `CONFLICT_FLAT`
 *     (Requirements 9.9, 11.3, 11.4).
 *   - `signals` — every input signal (including zero-weight ones), in canonical
 *     STRATEGY_IDS order (Requirement 8.4).
 */
export interface ConfluenceResult {
  readonly score: number;
  readonly status: ConfluenceStatus;
  readonly opposingStrategyIds: readonly StrategyId[];
  readonly signals: readonly StrategySignal[];
}

/**
 * Why a call to {@link ConfluenceEngine.aggregate} was rejected (Requirements
 * 8.7, 8.10, 13.8).
 *
 *   - `duplicate_strategy_id` — two inputs share a Strategy_Id, with the
 *     duplicate named (Requirement 8.7).
 *   - `invalid_signal` — an input failed {@link validateStrategySignal} (shape,
 *     field, or an LLM-tagged value), with its array index and the underlying
 *     {@link SignalViolation} (Requirements 8.10, 13.8).
 */
export type ConfluenceError =
  | {
      readonly reason: "duplicate_strategy_id";
      readonly strategyId: StrategyId;
      readonly message: string;
    }
  | {
      readonly reason: "invalid_signal";
      readonly index: number;
      readonly violation: SignalViolation;
      readonly message: string;
    };

/**
 * A configured Confluence_Engine. `config` is held frozen by the factory;
 * `aggregate` is a pure function of its inputs and never mutates the caller's
 * signal array. Its parameter is typed `Deterministic<StrategySignal>` so an
 * LLM-tagged value is non-assignable at compile time (Requirement 13.8); the
 * runtime re-validation in `aggregate` is the belt-and-braces enforcement.
 */
export interface ConfluenceEngine {
  readonly config: ConfluenceConfig;
  aggregate(
    signals: readonly Deterministic<StrategySignal>[],
  ): Result<ConfluenceResult, ConfluenceError>;
}

/** The sign a {@link import("./types.js").SignalDirection} contributes. */
const SIGN: Readonly<Record<StrategySignal["direction"], number>> = {
  UP: 1,
  DOWN: -1,
  FLAT: 0,
};

/** Canonical index of each Strategy_Id, for stable STRATEGY_IDS-order sorting. */
const CANONICAL_INDEX: Readonly<Record<StrategyId, number>> = Object.freeze(
  STRATEGY_IDS.reduce<Record<StrategyId, number>>(
    (acc, id, index) => {
      acc[id] = index;
      return acc;
    },
    {} as Record<StrategyId, number>,
  ),
);

const configError = (
  parameter: string,
  message: string,
): Result<never, ConfigError> =>
  err({ reason: "invalid_config", parameter, message });

/** Clamp `value` into the inclusive `[min, max]` interval. */
const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** Normalise a possible `-0` to `+0`, leaving every other value untouched. */
const normalizeZero = (value: number): number => (value === 0 ? 0 : value);

/**
 * Validate a resolved {@link ConfluenceConfig}, naming the first offending
 * Strategy_Id or parameter (Requirements 8.6, 9.7). Weights are checked in
 * canonical STRATEGY_IDS order so the failure is deterministic.
 */
function validateConfig(
  config: ConfluenceConfig,
): Result<ConfluenceConfig, ConfigError> {
  for (const id of STRATEGY_IDS) {
    const weight = config.weights[id];
    if (!Number.isFinite(weight) || weight < 0) {
      return configError(
        id,
        `weight for ${id} must be a finite number of at least 0`,
      );
    }
  }

  const thresholds: readonly [string, number][] = [
    ["conflictThreshold", config.conflictThreshold],
    ["alignmentThreshold", config.alignmentThreshold],
  ];
  for (const [parameter, value] of thresholds) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      return configError(
        parameter,
        `${parameter} must be a finite number within [0, 1]`,
      );
    }
  }

  return ok(config);
}

/**
 * Create a Confluence_Engine (Requirements 8, 9).
 *
 * The configuration is resolved from {@link DEFAULT_CONFLUENCE_CONFIG} overlaid
 * with `partial` (weights merged per-key over the defaults), then validated
 * BEFORE any engine is returned. A negative, `NaN`, or infinite weight returns
 * a {@link ConfigError} naming the Strategy_Id (Requirement 8.6); a threshold
 * that is non-finite or outside `[0, 1]` returns a {@link ConfigError} naming
 * the parameter (Requirement 9.7). No engine is created on failure, so the
 * caller's previously active engine is left unchanged.
 *
 * On success the returned `config` (and its nested `weights`) are frozen.
 *
 * @param partial Optional weight and threshold overrides.
 */
export function createConfluenceEngine(partial?: {
  readonly weights?: Partial<ConfluenceWeights>;
  readonly conflictThreshold?: number;
  readonly alignmentThreshold?: number;
}): Result<ConfluenceEngine, ConfigError> {
  const resolved: ConfluenceConfig = {
    weights: { ...DEFAULT_CONFLUENCE_CONFIG.weights, ...partial?.weights },
    conflictThreshold:
      partial?.conflictThreshold ?? DEFAULT_CONFLUENCE_CONFIG.conflictThreshold,
    alignmentThreshold:
      partial?.alignmentThreshold ??
      DEFAULT_CONFLUENCE_CONFIG.alignmentThreshold,
  };

  const validated = validateConfig(resolved);
  if (!validated.ok) {
    return err(validated.error);
  }

  const config: ConfluenceConfig = Object.freeze({
    weights: Object.freeze({ ...resolved.weights }),
    conflictThreshold: resolved.conflictThreshold,
    alignmentThreshold: resolved.alignmentThreshold,
  });

  const engine: ConfluenceEngine = {
    config,
    aggregate(
      signals: readonly Deterministic<StrategySignal>[],
    ): Result<ConfluenceResult, ConfluenceError> {
      // 1. Re-validate every input. The first failure — including an LLM-tagged
      //    value — rejects the whole aggregation with the index and violation,
      //    and no score is produced (Requirements 8.10, 13.8).
      const validatedSignals: StrategySignal[] = [];
      for (let index = 0; index < signals.length; index += 1) {
        const check = validateStrategySignal(signals[index]);
        if (!check.ok) {
          return err({
            reason: "invalid_signal",
            index,
            violation: check.error,
            message: `signal at index ${index} is invalid: ${check.error.message}`,
          });
        }
        validatedSignals.push(check.value);
      }

      // 2. Reject duplicate Strategy_Ids, naming the duplicate (Requirement 8.7).
      const seen = new Set<StrategyId>();
      for (const signal of validatedSignals) {
        if (seen.has(signal.strategyId)) {
          return err({
            reason: "duplicate_strategy_id",
            strategyId: signal.strategyId,
            message: `duplicate signal for strategyId ${signal.strategyId}`,
          });
        }
        seen.add(signal.strategyId);
      }

      // 3. Sort into canonical STRATEGY_IDS order. This fixes the summation
      //    order (so aggregation is order-independent) and the order of the
      //    returned `signals` and `opposingStrategyIds`.
      const sorted = [...validatedSignals].sort(
        (a, b) => CANONICAL_INDEX[a.strategyId] - CANONICAL_INDEX[b.strategyId],
      );

      // 4. W = Σ w_i. A zero total weight — including the empty list — is
      //    INSUFFICIENT_DATA with score 0 and an empty opposing list (Req 8.3).
      const totalWeight = sorted.reduce(
        (sum, signal) => sum + config.weights[signal.strategyId],
        0,
      );
      if (totalWeight === 0) {
        return ok({
          score: 0,
          status: "INSUFFICIENT_DATA",
          opposingStrategyIds: [],
          signals: sorted,
        });
      }

      // 5. score = clamp(Σ w_i · sgn_i · s_i / W, -1, 1), with -0 → +0. The
      //    clamp absorbs rounding error and is symmetric (Requirements 8.1, 8.2).
      const weightedSum = sorted.reduce(
        (sum, signal) =>
          sum +
          config.weights[signal.strategyId] *
            SIGN[signal.direction] *
            signal.strength,
        0,
      );
      const score = normalizeZero(clamp(weightedSum / totalWeight, -1, 1));

      // 6. Conflict: a strongly opposing UP set and DOWN set among the
      //    positive-weight signals forces Stay_Flat (Requirements 9.1, 9.2, 9.9).
      const strongUp: StrategyId[] = [];
      const strongDown: StrategyId[] = [];
      for (const signal of sorted) {
        if (config.weights[signal.strategyId] <= 0) continue;
        if (signal.strength < config.conflictThreshold) continue;
        if (signal.direction === "UP") strongUp.push(signal.strategyId);
        else if (signal.direction === "DOWN") strongDown.push(signal.strategyId);
      }
      if (strongUp.length > 0 && strongDown.length > 0) {
        // Canonical-order union of both sets (both are already in canonical
        // order because `sorted` is; concatenating UP then DOWN then re-sorting
        // keeps the result canonical and disjoint).
        const opposing = [...strongUp, ...strongDown].sort(
          (a, b) => CANONICAL_INDEX[a] - CANONICAL_INDEX[b],
        );
        return ok({
          score,
          status: "CONFLICT_FLAT",
          opposingStrategyIds: opposing,
          signals: sorted,
        });
      }

      // 7. Otherwise classify by the number of contributing (positive-weight,
      //    non-FLAT) strategies and the alignment threshold (Req 9.3–9.5, 9.10).
      const contributing = sorted.filter(
        (signal) =>
          config.weights[signal.strategyId] > 0 && signal.direction !== "FLAT",
      );

      let status: ConfluenceStatus;
      if (contributing.length >= 2) {
        // A score of exactly 0 expresses no directional lean, so it is always
        // NEUTRAL even when alignmentThreshold is 0 — where the `>=` / `<=`
        // bounds would otherwise both admit zero and resolve it to ALIGNED_UP,
        // breaking UP/DOWN symmetry (Requirements 9.5, 9.8). For every non-zero
        // score the threshold comparisons below are unchanged (Req 9.3, 9.4).
        if (score === 0) status = "NEUTRAL";
        else if (score >= config.alignmentThreshold) status = "ALIGNED_UP";
        else if (score <= -config.alignmentThreshold) status = "ALIGNED_DOWN";
        else status = "NEUTRAL";
      } else {
        // 0 or 1 contributor is always NEUTRAL (Requirement 9.10 and the
        // resolved all-FLAT gap).
        status = "NEUTRAL";
      }

      // 8. opposingStrategyIds is [] unless the status is CONFLICT_FLAT (Req 11.3).
      return ok({
        score,
        status,
        opposingStrategyIds: [],
        signals: sorted,
      });
    },
  };

  return ok(engine);
}
