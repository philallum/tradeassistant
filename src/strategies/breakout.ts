// Breakout Strategy — Donchian channel escape with ATR-scaled strength
// (Requirement 3; Design "Breakout (breakout.ts, Requirement 3)").
//
// A deterministic, Look_Ahead_Safe signal producer. The Donchian_Channel is
// built from the N candles immediately BEFORE the most recent completed candle,
// so the breakout candle can never define its own channel. The latest close is
// then compared with the channel high and low: strictly above gives UP,
// strictly below gives DOWN, anything inside the channel is FLAT. Strength
// scales the breakout distance by ATR_14.
//
// Pure and dependency-light: candle preparation, the indicator helpers, ATR,
// and the signal contract all come from the shared Stage A modules. This module
// touches no clock, randomness, environment, network, or storage — identical
// inputs always yield identical outputs.

import { prepareCandles } from "./candles.js";
import { roundTo, clamp01, atrUsable } from "./indicators.js";
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
const STRATEGY_ID = "breakout" as const;

/** Decimal places used when formatting channel and close values into the rationale. */
const RATIONALE_DP = 5 as const;

/**
 * Configuration for the Breakout_Strategy (Requirement 3.1).
 *
 *   - `channelPeriod` — the Donchian_Channel lookback N (default 20), an
 *     integer of at least 1.
 */
export interface BreakoutConfig {
  readonly channelPeriod: number;
}

/** The default Breakout_Strategy configuration: a 20-candle channel (Requirement 3.1). */
export const DEFAULT_BREAKOUT_CONFIG: BreakoutConfig = {
  channelPeriod: 20,
};

/** A parameter name that may be reported as invalid by {@link validateConfig}. */
type BreakoutParameter = "channelPeriod";

const configError = (
  parameter: string,
  message: string,
): Result<never, ConfigError> =>
  err({ reason: "invalid_config", parameter, message });

/** Whether `value` is an integer of at least 1. */
const isPositiveInteger = (value: number): boolean =>
  Number.isInteger(value) && value >= 1;

/**
 * Validate a resolved {@link BreakoutConfig}, naming the first invalid
 * parameter (Requirement 3, mirroring the Trend validation contract).
 * `channelPeriod` must be an integer of at least 1.
 */
function validateConfig(
  config: BreakoutConfig,
): Result<BreakoutConfig, ConfigError> {
  const checks: readonly [BreakoutParameter, number][] = [
    ["channelPeriod", config.channelPeriod],
  ];
  for (const [parameter, value] of checks) {
    if (!isPositiveInteger(value)) {
      return configError(
        parameter,
        `${parameter} must be an integer of at least 1`,
      );
    }
  }

  return ok(config);
}

/**
 * Create a Breakout_Strategy instance (Requirement 3).
 *
 * The configuration is resolved from {@link DEFAULT_BREAKOUT_CONFIG} overlaid
 * with `partial`, then validated BEFORE any instance is returned, so an invalid
 * configuration leaves the caller's previously active instance unchanged. On
 * success the returned `config` is `Object.freeze`d.
 *
 * `evaluate` is a pure function of its inputs: it prepares candles (look-ahead
 * guard, emptiness, OHLC finiteness), guards history length, builds the channel
 * from the N candles that EXCLUDE the latest one, derives the direction from
 * the latest close, scales strength by ATR, and records the channel high, low,
 * and close in the rationale. It never mutates the caller's candle array and
 * never throws.
 *
 * @param partial Optional override for the channel period N.
 */
export function createBreakoutStrategy(
  partial?: Partial<BreakoutConfig>,
): Result<Strategy<BreakoutConfig>, ConfigError> {
  const resolved: BreakoutConfig = { ...DEFAULT_BREAKOUT_CONFIG, ...partial };

  const validated = validateConfig(resolved);
  if (!validated.ok) {
    return err(validated.error);
  }

  const config: BreakoutConfig = Object.freeze({ ...resolved });

  const strategy: Strategy<BreakoutConfig> = {
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
      const n = prep.length;
      const N = config.channelPeriod;

      // 1. History guard. Need the N channel candles plus the latest completed
      //    candle, so n must be at least N + 1 (Requirement 3.8).
      if (n < N + 1) {
        return buildSignal(
          STRATEGY_ID,
          "FLAT",
          0,
          `breakout: insufficient history: need ${N + 1} candles, have ${n}`,
        );
      }

      // 2. The latest completed candle and the channel window that EXCLUDES it:
      //    candles[n-1-N .. n-2], so the breakout candle cannot define its own
      //    channel (Requirements 3.1, 3.9).
      const last = prep[n - 1] as Candle;
      const close = last.close;
      const window = prep.slice(n - 1 - N, n - 1);
      let high = window[0]?.high ?? Number.NEGATIVE_INFINITY;
      let low = window[0]?.low ?? Number.POSITIVE_INFINITY;
      for (const candle of window) {
        if (candle.high > high) high = candle.high;
        if (candle.low < low) low = candle.low;
      }

      const highText = roundTo(high, RATIONALE_DP);
      const lowText = roundTo(low, RATIONALE_DP);
      const closeText = roundTo(close, RATIONALE_DP);
      const prefix =
        `breakout: channelHigh(${N})=${highText} ` +
        `channelLow(${N})=${lowText} close=${closeText}`;

      // 3. Direction from the latest close relative to the channel. A close at
      //    or inside the channel is FLAT with strength 0 (Requirements 3.2 to
      //    3.4, 3.6).
      let direction: SignalDirection = "FLAT";
      if (close > high) direction = "UP";
      else if (close < low) direction = "DOWN";

      if (direction === "FLAT") {
        return buildSignal(STRATEGY_ID, "FLAT", 0, `${prefix} -> FLAT`);
      }

      // 4. ATR usability over ALL prepared candles including the latest. If ATR
      //    is unusable, keep the detected direction with strength 0 and report
      //    that ATR is unavailable (Requirement 3.10).
      const atr = computeAtr14(prep);
      if (!atrUsable(atr)) {
        return buildSignal(
          STRATEGY_ID,
          direction,
          0,
          `${prefix} -> ${direction} (ATR unavailable)`,
        );
      }

      // 5. Strength scales the breakout distance by ATR (Requirement 3.5).
      const distance = direction === "UP" ? close - high : low - close;
      const strength = clamp01(distance / atr);

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
