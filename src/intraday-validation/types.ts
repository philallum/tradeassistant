// Intraday 4H Candle Validation — shared types (intraday-validation feature).
//
// This module is part of the DETERMINISTIC CORE for the intraday enrichment
// layer: pure types and enumerations with NO LLM input and no I/O. The
// validation layer is a READ-ONLY consumer of the already-persisted daily
// prediction; nothing here feeds back into the daily firing / scoring path.
//
// "Strength is not a probability": the Confidence_Delta and Current_Confidence
// below are a deterministic, bounded, UNVALIDATED adjustment of the original
// Earned_Confidence — never a calibrated probability claim.

import type { Pair } from "../ingestion/types.js";
import type { DirectionClass } from "../retrieval/types.js";
import type { TradingDate } from "../guard/types.js";

/** The literal validation-label carried on the slice (mirrors confluence). */
export const INTRADAY_VALIDATION_LABEL = "unvalidated" as const;

/**
 * The deterministic validation state of the currently-forming 4H candle versus
 * the original daily direction. `NOT_APPLICABLE` is reserved for a FLAT original
 * direction (no support/contradict is defined against FLAT).
 */
export type ValidationState =
  | "STRONGLY_SUPPORTS"
  | "SUPPORTS"
  | "NEUTRAL"
  | "CONTRADICTS"
  | "STRONGLY_CONTRADICTS"
  | "NOT_APPLICABLE";

/** The ordered set of validation states (for exhaustive tests/iteration). */
export const VALIDATION_STATES: readonly ValidationState[] = [
  "STRONGLY_SUPPORTS",
  "SUPPORTS",
  "NEUTRAL",
  "CONTRADICTS",
  "STRONGLY_CONTRADICTS",
  "NOT_APPLICABLE",
] as const;

/**
 * The minimal OHLC of a (possibly still-forming) 4H candle. `currentPrice` is
 * the close-so-far of the forming bar. All four are plain price units (NOT
 * pips); every downstream feature is a pip-agnostic ratio.
 */
export interface IntradayCandle {
  /** The bar's open price. */
  readonly open: number;
  /** The bar's highest traded price so far. */
  readonly high: number;
  /** The bar's lowest traded price so far. */
  readonly low: number;
  /** The bar's close-so-far (the latest traded price). */
  readonly currentPrice: number;
}

/**
 * A fetched 4H bar: its OHLC plus the UTC instant the bar opened (ISO-8601).
 * The open instant is what the Forming_Bar selector screens against the fixed
 * UTC 4H boundaries; it is NOT floored to a calendar day.
 */
export interface Intraday4hBar extends IntradayCandle {
  /** The bar's open instant in UTC, ISO-8601 (e.g. `2026-11-06T04:00:00.000Z`). */
  readonly openTimeUtc: string;
}

/**
 * The deterministic, pip-agnostic shape features of a 4H candle. Every field is
 * a ratio or a signed price delta; nothing is a pip count, so EURUSD and USDJPY
 * are classified by identical rules.
 */
export interface CandleFeatures {
  /** `high - low` (≥ 0). */
  readonly range: number;
  /** `currentPrice - open` (signed). */
  readonly body: number;
  /** `UP` if `body ≥ 0`, else `DOWN`; `FLAT` only for an exactly-zero body. */
  readonly bodyDirection: DirectionClass;
  /** `|body| / range` in [0, 1]; `0` when `range === 0`. */
  readonly bodyToRange: number;
  /** `high - max(open, currentPrice)` (≥ 0). */
  readonly upperWick: number;
  /** `min(open, currentPrice) - low` (≥ 0). */
  readonly lowerWick: number;
  /** `(currentPrice - low) / range` in [0, 1]; `0.5` when `range === 0`. */
  readonly pricePositionInRange: number;
}

/**
 * The outcome of classifying one 4H candle against the original daily direction:
 * the deterministic {@link ValidationState}, a BOUNDED symmetric Confidence_Delta
 * in percentage points (`[-10, +10]`), the resulting Current_Confidence in
 * percentage points (`[0, 100]`), and a plain-language, display-only reason.
 */
export interface ValidationResult {
  readonly state: ValidationState;
  /** Confidence_Delta in percentage points, bounded to `[-10, +10]`. */
  readonly confidenceDelta: number;
  /** Current_Confidence in percentage points, clamped to `[0, 100]`. */
  readonly currentConfidence: number;
  /** Plain-language explanation of the classification (display-only). */
  readonly reason: string;
}

/**
 * One persisted/surfaced intraday-validation record, tying the forming 4H candle
 * and its validation back to the original daily prediction for a
 * `(decisionDate, pair)`. The original direction/confidence are a SNAPSHOT of
 * what was validated (audit) — never a mutation of the daily rows.
 */
export interface IntradayValidationRecord {
  readonly decisionDate: TradingDate;
  readonly pair: Pair;
  /** The original daily direction being validated. */
  readonly originalDirection: DirectionClass;
  /** The original Earned_Confidence in percentage points `[0, 100]` (untouched). */
  readonly originalConfidence: number;
  /** When the forming 4H bar was observed (ISO-8601 UTC). */
  readonly validationTimestamp: string;
  /** The forming bar's open instant (ISO-8601 UTC) — boundary audit. */
  readonly barOpenUtc: string;
  /** The forming bar's minimal OHLC. */
  readonly candle: IntradayCandle;
  /** The derived shape features (persisted so usefulness can be measured later). */
  readonly features: CandleFeatures;
  /** The deterministic validation outcome. */
  readonly result: ValidationResult;
}
