// Range / Mean Reversion Strategy — Bollinger_Bands escape with RSI confirmation
// (Requirement 4; Design "Range (range.ts, Requirement 4)").
//
// A deterministic, Look_Ahead_Safe signal producer. Bollinger_Bands are built
// from the last `bbPeriod` closes including the latest completed candle, using
// a population standard deviation. The latest close must pierce a band AND the
// Wilder RSI must agree (oversold for UP, overbought for DOWN) before a
// directional signal is emitted. Strength is the mean of a band-penetration
// score and an RSI-distance score, each clamped to [0, 1].
//
// Pure and dependency-light: candle preparation, the indicator helpers, and the
// signal contract all come from the shared Stage A modules. This module touches
// no clock, randomness, environment, network, or storage — identical inputs
// always yield identical outputs.

import { prepareCandles } from "./candles.js";
import { sma, populationStdDev, rsiWilder, roundTo, clamp01 } from "./indicators.js";
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
const STRATEGY_ID = "range" as const;

/** Decimal places used when formatting close and band values into the rationale. */
const BAND_DP = 5 as const;

/** Decimal places used when formatting the RSI value into the rationale. */
const RSI_DP = 2 as const;

/**
 * Configuration for the Range_Strategy (Requirement 4.9).
 *
 *   - `bbPeriod` — the Bollinger_Bands lookback (default 20), an integer of at
 *     least 2.
 *   - `bbK` — the band width in standard deviations (default 2), greater than 0.
 *   - `rsiPeriod` — the Wilder RSI period (default 14), an integer of at least 2.
 *   - `oversold` — the RSI oversold threshold for UP (default 30).
 *   - `overbought` — the RSI overbought threshold for DOWN (default 70).
 *
 * The thresholds must satisfy `0 <= oversold < overbought <= 100`.
 */
export interface RangeConfig {
  readonly bbPeriod: number;
  readonly bbK: number;
  readonly rsiPeriod: number;
  readonly oversold: number;
  readonly overbought: number;
}

/** The default Range_Strategy configuration: 20 / 2 / 14 / 30 / 70 (Requirement 4.9). */
export const DEFAULT_RANGE_CONFIG: RangeConfig = {
  bbPeriod: 20,
  bbK: 2,
  rsiPeriod: 14,
  oversold: 30,
  overbought: 70,
};

/** A parameter name that may be reported as invalid by {@link validateConfig}. */
type RangeParameter =
  | "bbPeriod"
  | "bbK"
  | "rsiPeriod"
  | "oversold"
  | "overbought";

const configError = (
  parameter: string,
  message: string,
): Result<never, ConfigError> =>
  err({ reason: "invalid_config", parameter, message });

/** Whether `value` is an integer of at least 2. */
const isPeriod = (value: number): boolean =>
  Number.isInteger(value) && value >= 2;

/**
 * Validate a resolved {@link RangeConfig}, naming the first invalid parameter
 * (Requirement 4.9). `bbPeriod` and `rsiPeriod` must be integers of at least 2,
 * `bbK` must be greater than 0, and the thresholds must satisfy
 * `0 <= oversold < overbought <= 100`.
 */
function validateConfig(config: RangeConfig): Result<RangeConfig, ConfigError> {
  const periods: readonly [RangeParameter, number][] = [
    ["bbPeriod", config.bbPeriod],
    ["rsiPeriod", config.rsiPeriod],
  ];
  for (const [parameter, value] of periods) {
    if (!isPeriod(value)) {
      return configError(
        parameter,
        `${parameter} must be an integer of at least 2`,
      );
    }
  }

  if (!(Number.isFinite(config.bbK) && config.bbK > 0)) {
    return configError("bbK", "bbK must be greater than 0");
  }

  if (!(Number.isFinite(config.oversold) && config.oversold >= 0)) {
    return configError("oversold", "oversold must be at least 0");
  }

  if (!(Number.isFinite(config.overbought) && config.overbought <= 100)) {
    return configError("overbought", "overbought must be at most 100");
  }

  if (config.oversold >= config.overbought) {
    return configError(
      "oversold",
      "oversold must be strictly less than overbought",
    );
  }

  return ok(config);
}

/** Extract the close price series from prepared candles. */
const closesOf = (candles: readonly Candle[]): number[] =>
  candles.map((candle) => candle.close);

/**
 * Create a Range_Strategy instance (Requirement 4).
 *
 * The configuration is resolved from {@link DEFAULT_RANGE_CONFIG} overlaid with
 * `partial`, then validated BEFORE any instance is returned, so an invalid
 * configuration leaves the caller's previously active instance unchanged
 * (Requirement 4.9). On success the returned `config` is `Object.freeze`d.
 *
 * `evaluate` is a pure function of its inputs: it prepares candles (look-ahead
 * guard, emptiness, OHLC finiteness), guards history length, builds the
 * Bollinger_Bands from the last `bbPeriod` closes including the latest,
 * confirms non-zero volatility, derives the direction from the band pierce and
 * the Wilder RSI agreement, scores strength from band penetration and RSI
 * distance, and records the close, bands, and RSI in the rationale. It never
 * mutates the caller's candle array and never throws.
 *
 * @param partial Optional overrides for the band period, band width, RSI
 *                period, and the oversold / overbought thresholds.
 */
export function createRangeStrategy(
  partial?: Partial<RangeConfig>,
): Result<Strategy<RangeConfig>, ConfigError> {
  const resolved: RangeConfig = { ...DEFAULT_RANGE_CONFIG, ...partial };

  const validated = validateConfig(resolved);
  if (!validated.ok) {
    return err(validated.error);
  }

  const config: RangeConfig = Object.freeze({ ...resolved });

  const strategy: Strategy<RangeConfig> = {
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

      // 1. History guard. Bollinger_Bands need `bbPeriod` closes and the Wilder
      //    RSI needs `rsiPeriod + 1` closes (one extra for the first change), so
      //    n must reach the larger of the two (Requirement 4.6).
      const required = Math.max(config.bbPeriod, config.rsiPeriod + 1);
      if (n < required) {
        return buildSignal(
          STRATEGY_ID,
          "FLAT",
          0,
          `range: insufficient history: need ${required} candles, have ${n}`,
        );
      }

      // 2. Bollinger_Bands over the last `bbPeriod` closes INCLUDING the latest
      //    completed candle (Requirement 4.8). A zero standard deviation means
      //    there is no volatility to pierce, so emit FLAT (Requirement 4.7).
      const window = closes.slice(-config.bbPeriod);
      const mid = sma(window, config.bbPeriod);
      const sd = populationStdDev(window);
      const close = closes[n - 1] as number;

      if (sd === 0) {
        return buildSignal(STRATEGY_ID, "FLAT", 0, "range: zero volatility");
      }

      const lower = mid - config.bbK * sd;
      const upper = mid + config.bbK * sd;
      const bandSpan = upper - lower;

      // 3. Wilder RSI over the full close series.
      const rsi = rsiWilder(closes, config.rsiPeriod);

      const closeText = roundTo(close, BAND_DP);
      const lowerText = roundTo(lower, BAND_DP);
      const upperText = roundTo(upper, BAND_DP);
      const rsiText = roundTo(rsi, RSI_DP);
      const prefix =
        `range: close=${closeText} ` +
        `lower=${lowerText} upper=${upperText} rsi=${rsiText}`;

      // 4. Direction requires BOTH a band pierce AND RSI agreement
      //    (Requirements 4.1 to 4.3). Anything else is FLAT with strength 0.
      let direction: SignalDirection = "FLAT";
      if (close < lower && rsi < config.oversold) direction = "UP";
      else if (close > upper && rsi > config.overbought) direction = "DOWN";

      if (direction === "FLAT") {
        return buildSignal(STRATEGY_ID, "FLAT", 0, `${prefix} -> FLAT`);
      }

      // 5. Strength is the mean of a band-penetration score and an RSI-distance
      //    score, each clamped to [0, 1] (Requirement 4.4). `bbPeriod >= 2` and
      //    `bbK > 0` keep `bandSpan > 0` whenever `sd > 0`, and the thresholds
      //    keep the RSI divisors strictly positive.
      let penetration: number;
      let rsiScore: number;
      if (direction === "UP") {
        penetration = (lower - close) / bandSpan;
        rsiScore = (config.oversold - rsi) / config.oversold;
      } else {
        penetration = (close - upper) / bandSpan;
        rsiScore = (rsi - config.overbought) / (100 - config.overbought);
      }
      const strength = (clamp01(penetration) + clamp01(rsiScore)) / 2;

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
