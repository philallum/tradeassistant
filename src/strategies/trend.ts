// Trend Following Strategy — EMA alignment with a slope confirmation
// (Requirement 2; Design "Trend (trend.ts, Requirement 2)").
//
// A deterministic, Look_Ahead_Safe signal producer. The Fast_EMA and Slow_EMA
// of the close price are compared, and the Fast_EMA slope over the configured
// slope window must agree with the EMA alignment before a directional signal is
// emitted. Strength scales the EMA gap by ATR_14.
//
// Pure and dependency-light: candle preparation, the EMA helpers, ATR, and the
// signal contract all come from the shared Stage A modules. This module touches
// no clock, randomness, environment, network, or storage — identical inputs
// always yield identical outputs.

import { prepareCandles } from "./candles.js";
import { emaSeries, roundTo, clamp01, atrUsable } from "./indicators.js";
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
const STRATEGY_ID = "trend" as const;

/** Decimal places used when formatting EMA and slope values into the rationale. */
const RATIONALE_DP = 5 as const;

/**
 * Configuration for the Trend_Strategy (Requirement 2.10).
 *
 *   - `fastPeriod` — the Fast_EMA period (default 20).
 *   - `slowPeriod` — the Slow_EMA period (default 50).
 *   - `slopeWindow` — how many candles back the Fast_EMA slope is measured over
 *     (default 5).
 *
 * All three are integers of at least 1, and `fastPeriod` must be strictly less
 * than `slowPeriod`.
 */
export interface TrendConfig {
  readonly fastPeriod: number;
  readonly slowPeriod: number;
  readonly slopeWindow: number;
}

/** The default Trend_Strategy configuration: 20 / 50 / 5 (Requirement 2.10). */
export const DEFAULT_TREND_CONFIG: TrendConfig = {
  fastPeriod: 20,
  slowPeriod: 50,
  slopeWindow: 5,
};

/** A parameter name that may be reported as invalid by {@link validateConfig}. */
type TrendParameter = "fastPeriod" | "slowPeriod" | "slopeWindow";

const configError = (
  parameter: string,
  message: string,
): Result<never, ConfigError> =>
  err({ reason: "invalid_config", parameter, message });

/** Whether `value` is an integer of at least 1. */
const isPositiveInteger = (value: number): boolean =>
  Number.isInteger(value) && value >= 1;

/**
 * Validate a resolved {@link TrendConfig}, naming the first invalid parameter
 * (Requirement 2.11). Each of `fastPeriod`, `slowPeriod`, and `slopeWindow`
 * must be an integer of at least 1, and `fastPeriod` must be strictly less than
 * `slowPeriod`.
 */
function validateConfig(config: TrendConfig): Result<TrendConfig, ConfigError> {
  const checks: readonly [TrendParameter, number][] = [
    ["fastPeriod", config.fastPeriod],
    ["slowPeriod", config.slowPeriod],
    ["slopeWindow", config.slopeWindow],
  ];
  for (const [parameter, value] of checks) {
    if (!isPositiveInteger(value)) {
      return configError(
        parameter,
        `${parameter} must be an integer of at least 1`,
      );
    }
  }

  if (config.fastPeriod >= config.slowPeriod) {
    return configError(
      "fastPeriod",
      "fastPeriod must be strictly less than slowPeriod",
    );
  }

  return ok(config);
}

/** Extract the close price series from prepared candles. */
const closesOf = (candles: readonly Candle[]): number[] =>
  candles.map((candle) => candle.close);

/**
 * Create a Trend_Strategy instance (Requirement 2).
 *
 * The configuration is resolved from {@link DEFAULT_TREND_CONFIG} overlaid with
 * `partial`, then validated BEFORE any instance is returned, so an invalid
 * configuration leaves the caller's previously active instance unchanged
 * (Requirement 2.11). On success the returned `config` is `Object.freeze`d.
 *
 * `evaluate` is a pure function of its inputs: it prepares candles (look-ahead
 * guard, emptiness, OHLC finiteness), guards history length, confirms ATR is
 * usable, derives the direction from the EMA gap and slope, scales strength by
 * ATR, and records the EMA and slope values in the rationale. It never mutates
 * the caller's candle array and never throws.
 *
 * @param partial Optional overrides for the Fast_EMA period, Slow_EMA period,
 *                and slope window.
 */
export function createTrendStrategy(
  partial?: Partial<TrendConfig>,
): Result<Strategy<TrendConfig>, ConfigError> {
  const resolved: TrendConfig = { ...DEFAULT_TREND_CONFIG, ...partial };

  const validated = validateConfig(resolved);
  if (!validated.ok) {
    return err(validated.error);
  }

  const config: TrendConfig = Object.freeze({ ...resolved });

  const strategy: Strategy<TrendConfig> = {
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

      // 1. History guard runs BEFORE the ATR check, so a short series reports
      //    "insufficient history" rather than "ATR unavailable" (Requirement 2.9).
      const required = config.slowPeriod + config.slopeWindow;
      if (n < required) {
        return buildSignal(
          STRATEGY_ID,
          "FLAT",
          0,
          `trend: insufficient history: need ${required} candles, have ${n}`,
        );
      }

      // 2. EMA series, slope over the configured window, and the EMA gap. The
      //    history guard guarantees fast[L], slow[L], and fast[L - slopeWindow]
      //    are all defined (n >= slowPeriod + slopeWindow >= fastPeriod).
      const fastSeries = emaSeries(closes, config.fastPeriod);
      const slowSeries = emaSeries(closes, config.slowPeriod);
      const fast = fastSeries[L] as number;
      const slow = slowSeries[L] as number;
      const fastLagged = fastSeries[L - config.slopeWindow] as number;
      const slope = fast - fastLagged;
      const diff = fast - slow;

      const fastText = roundTo(fast, RATIONALE_DP);
      const slowText = roundTo(slow, RATIONALE_DP);
      const slopeText = roundTo(slope, RATIONALE_DP);
      const prefix =
        `trend: fastEMA(${config.fastPeriod})=${fastText} ` +
        `slowEMA(${config.slowPeriod})=${slowText} ` +
        `slope(${config.slopeWindow})=${slopeText}`;

      // 3. ATR usability (Requirement 2.8). Checked after the history guard.
      const atr = computeAtr14(prep);
      if (!atrUsable(atr)) {
        return buildSignal(
          STRATEGY_ID,
          "FLAT",
          0,
          `${prefix} -> FLAT (ATR unavailable)`,
        );
      }

      // 4. Direction from the EMA gap and slope (Requirements 2.2 to 2.4, 2.6).
      let direction: SignalDirection = "FLAT";
      if (diff > 0 && slope > 0) direction = "UP";
      else if (diff < 0 && slope < 0) direction = "DOWN";

      // 5. Strength scales the EMA gap by ATR for UP/DOWN; FLAT is 0
      //    (Requirements 2.5, 2.6).
      const strength = direction === "FLAT" ? 0 : clamp01(Math.abs(diff) / atr);

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
