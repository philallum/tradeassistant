// Reversal / Exhaustion Strategy — extreme extension with fading momentum
// (Requirement 5; Design "Reversal (reversal.ts, Requirement 5)").
//
// A deterministic, Look_Ahead_Safe signal producer. The latest close's
// extension from a Baseline_MA (a `baselinePeriod` SMA of close) is measured in
// ATR_14 units. A directional signal is emitted only when that extension is
// beyond the threshold AND momentum is fading in the same direction, so the
// strategy fires against stretched, exhausting moves: an over-extended rally
// (positive extension) gives DOWN, an over-extended sell-off (negative
// extension) gives UP. Strength scales how far past the threshold the extension
// has reached.
//
// Pure and dependency-light: candle preparation, the indicator helpers, ATR,
// and the signal contract all come from the shared Stage A modules. This module
// touches no clock, randomness, environment, network, or storage — identical
// inputs always yield identical outputs.

import { prepareCandles } from "./candles.js";
import { sma, roundTo, clamp01, atrUsable } from "./indicators.js";
import { computeAtr14 } from "../confidence/atr.js";
import { ok, err } from "../guard/types.js";
import type { Candle, Result, TradingDate } from "../guard/types.js";
import {
  buildSignal,
  type SignalDirection,
  type Strategy,
  type StrategyResult,
  type ConfigError,
} from "./types.js";

/** The {@link StrategyId} this module produces. */
const STRATEGY_ID = "reversal" as const;

/** Decimal places used when formatting extension, ATR, and ROC values into the rationale. */
const RATIONALE_DP = 5 as const;

/**
 * Configuration for the Reversal_Strategy (Requirement 5.9).
 *
 *   - `extensionThreshold` — how many ATR units the close must be stretched from
 *     the Baseline_MA before a signal can fire (default 2.0), a finite number
 *     greater than 0.
 *   - `baselinePeriod` — the Baseline_MA (SMA of close) lookback (default 20), a
 *     positive integer.
 *   - `momentumWindow` — how many candles each rate-of-change window spans
 *     (default 3), a positive integer.
 */
export interface ReversalConfig {
  readonly extensionThreshold: number;
  readonly baselinePeriod: number;
  readonly momentumWindow: number;
}

/** The default Reversal_Strategy configuration: 2.0 / 20 / 3 (Requirement 5.9). */
export const DEFAULT_REVERSAL_CONFIG: ReversalConfig = {
  extensionThreshold: 2.0,
  baselinePeriod: 20,
  momentumWindow: 3,
};

/** A parameter name that may be reported as invalid by {@link validateConfig}. */
type ReversalParameter =
  | "extensionThreshold"
  | "baselinePeriod"
  | "momentumWindow";

const configError = (
  parameter: string,
  message: string,
): Result<never, ConfigError> =>
  err({ reason: "invalid_config", parameter, message });

/** Whether `value` is an integer of at least 1. */
const isPositiveInteger = (value: number): boolean =>
  Number.isInteger(value) && value >= 1;

/**
 * Validate a resolved {@link ReversalConfig}, naming the first invalid
 * parameter (Requirement 5.10). `extensionThreshold` must be finite and greater
 * than 0, and both `baselinePeriod` and `momentumWindow` must be positive
 * integers.
 */
function validateConfig(
  config: ReversalConfig,
): Result<ReversalConfig, ConfigError> {
  if (!(Number.isFinite(config.extensionThreshold) && config.extensionThreshold > 0)) {
    return configError(
      "extensionThreshold",
      "extensionThreshold must be a finite number greater than 0",
    );
  }

  const periods: readonly [ReversalParameter, number][] = [
    ["baselinePeriod", config.baselinePeriod],
    ["momentumWindow", config.momentumWindow],
  ];
  for (const [parameter, value] of periods) {
    if (!isPositiveInteger(value)) {
      return configError(
        parameter,
        `${parameter} must be a positive integer`,
      );
    }
  }

  return ok(config);
}

/** Extract the close price series from prepared candles. */
const closesOf = (candles: readonly Candle[]): number[] =>
  candles.map((candle) => candle.close);

/**
 * Create a Reversal_Strategy instance (Requirement 5).
 *
 * The configuration is resolved from {@link DEFAULT_REVERSAL_CONFIG} overlaid
 * with `partial`, then validated BEFORE any instance is returned, so an invalid
 * configuration leaves the caller's previously active instance unchanged and no
 * candle is ever read (Requirement 5.10). On success the returned `config` is
 * `Object.freeze`d.
 *
 * `evaluate` is a pure function of its inputs: it prepares candles (look-ahead
 * guard, emptiness, OHLC finiteness), guards history length, confirms ATR is
 * usable, measures the ATR-scaled extension from the Baseline_MA, checks for
 * fading momentum in the extension's direction, derives the direction, scales
 * strength by how far past the threshold the extension reaches, and records the
 * extension, ATR, and both rate-of-change values in the rationale. It never
 * mutates the caller's candle array and never throws.
 *
 * @param partial Optional overrides for the extension threshold, Baseline_MA
 *                period, and momentum window.
 */
export function createReversalStrategy(
  partial?: Partial<ReversalConfig>,
): Result<Strategy<ReversalConfig>, ConfigError> {
  const resolved: ReversalConfig = { ...DEFAULT_REVERSAL_CONFIG, ...partial };

  const validated = validateConfig(resolved);
  if (!validated.ok) {
    return err(validated.error);
  }

  const config: ReversalConfig = Object.freeze({ ...resolved });

  const strategy: Strategy<ReversalConfig> = {
    id: STRATEGY_ID,
    config,
    evaluate(
      candles: readonly Candle[],
      decisionDate: TradingDate,
    ): StrategyResult {
      const prepared = prepareCandles(candles, decisionDate);
      if (!prepared.ok) {
        return err(prepared.error);
      }
      const prep = prepared.value;
      const closes = closesOf(prep);
      const n = closes.length;
      const L = n - 1;
      const w = config.momentumWindow;
      const thr = config.extensionThreshold;

      // 1. History guard runs BEFORE the ATR check, so a short series reports
      //    "insufficient candles" rather than "zero ATR". The two causes use
      //    DISTINCT rationale text (Requirement 5.8). Need `baselinePeriod`
      //    closes for the Baseline_MA and `2 * momentumWindow` closes back for
      //    the preceding ROC window, so n must reach their sum.
      const required = config.baselinePeriod + 2 * w;
      if (n < required) {
        return buildSignal(
          STRATEGY_ID,
          "FLAT",
          0,
          `reversal: insufficient candles: need ${required}, have ${n}`,
        );
      }

      // 2. ATR usability over ALL prepared candles including the latest. A zero
      //    or non-finite ATR cannot scale the extension, so emit FLAT with a
      //    rationale that is textually distinct from the history case
      //    (Requirement 5.8).
      const atr = computeAtr14(prep);
      if (!atrUsable(atr)) {
        return buildSignal(STRATEGY_ID, "FLAT", 0, "reversal: zero ATR");
      }

      // 3. Baseline_MA over the last `baselinePeriod` closes, and the UNROUNDED
      //    ATR-scaled extension of the latest close (Requirement 5.1).
      const close = closes[L] as number;
      const baselineMA = sma(closes, config.baselinePeriod);
      const extension = (close - baselineMA) / atr;

      // 4. Rate of change over the most recent and the immediately preceding
      //    momentum window (Requirement 5.5). The history guard guarantees
      //    L - 2w >= 0, so both indices are defined.
      const rocRecent = close - (closes[L - w] as number);
      const rocPrev = (closes[L - w] as number) - (closes[L - 2 * w] as number);

      const extText = roundTo(extension, RATIONALE_DP);
      const atrText = roundTo(atr, RATIONALE_DP);
      const rocRecentText = roundTo(rocRecent, RATIONALE_DP);
      const rocPrevText = roundTo(rocPrev, RATIONALE_DP);
      const prefix =
        `reversal: extension=${extText} atr=${atrText} ` +
        `rocRecent=${rocRecentText} rocPrev=${rocPrevText}`;

      // 5. Momentum exhaustion: the recent ROC is strictly smaller in magnitude
      //    than the preceding one AND both ROCs share the extension's strict
      //    sign — positive ROCs for a positive extension, negative ROCs for a
      //    negative extension (Requirement 5.5).
      const fading = Math.abs(rocRecent) < Math.abs(rocPrev);
      const sameSign =
        (extension > 0 && rocRecent > 0 && rocPrev > 0) ||
        (extension < 0 && rocRecent < 0 && rocPrev < 0);
      const exhaustion = fading && sameSign;

      // 6. Direction. An over-extended rally with fading momentum reverses DOWN;
      //    an over-extended sell-off with fading momentum reverses UP. Anything
      //    else is FLAT with strength 0 (Requirements 5.2 to 5.4).
      let direction: SignalDirection = "FLAT";
      if (extension > thr && exhaustion) direction = "DOWN";
      else if (extension < -thr && exhaustion) direction = "UP";

      if (direction === "FLAT") {
        return buildSignal(STRATEGY_ID, "FLAT", 0, `${prefix} -> FLAT`);
      }

      // 7. Strength scales how far past the threshold the extension reaches.
      //    |extension| > thr on this path, so (|extension| - thr) / thr is
      //    non-negative, and clamp01 caps it at 1 (Requirement 5.6).
      const strength = clamp01((Math.abs(extension) - thr) / thr);

      return buildSignal(
        STRATEGY_ID,
        direction,
        strength,
        `${prefix} -> ${direction}`,
      );
    },
  };

  return ok(strategy);
}
