// Look-Ahead Safety Guard Types (Requirements 4, 7.5, 9.3, 9.5).
//
// Shared primitives and domain types for date-boundary safety.

/**
 * ISO-8601 calendar date string in YYYY-MM-DD format representing a trading day.
 * Daily candles are defined on the 17:00 America/New_York session close
 * (Monday-Friday 5-day week).
 */
export type TradingDate = string;

/**
 * Pure discriminated union representing a computation result.
 */
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

/**
 * Daily OHLC candle representation across ingestion, feature computation, and storage.
 * Requirement 7.
 */
export interface Candle {
  readonly asset: string;
  readonly date: TradingDate;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly source?: string;
  readonly ingestedAt?: string;
}

/**
 * Typed rejection outcome returned when a candle dated at or after a Decision_Date
 * is submitted to a historical computation (Requirements 4.1, 4.4).
 */
export interface LookAheadViolation {
  readonly reason: "look_ahead_violation";
  readonly decisionDate: TradingDate;
  readonly violatingCandles: readonly Candle[];
  readonly message: string;
}

/**
 * Minimal structural analogue interface inspected by the Look-Ahead Guard.
 * Requirements 9.3, 9.5.
 */
export interface Analogue {
  readonly asset?: string;
  readonly pair?: string;
  readonly decisionDate?: TradingDate;
  readonly date?: TradingDate;
  readonly horizon?: 1 | 2 | 3;
  readonly [key: string]: unknown;
}

/**
 * LookAheadGuard interface as specified in Design Component 1.
 */
export interface LookAheadGuard {
  /**
   * Rejects any candle dated >= decisionDate for feature/retrieval use.
   * (Requirements 4.1, 4.4)
   */
  assertPastOnly(
    candles: readonly Candle[],
    decisionDate: TradingDate,
  ): Result<Candle[], LookAheadViolation>;

  /**
   * Returns true only if the full horizon window (1, 2, or 3 trading days)
   * has closed as of evalDate.
   * (Requirement 4.2)
   */
  isMatured(
    outcomeStart: TradingDate,
    horizonDays: 1 | 2 | 3,
    evalDate: TradingDate,
  ): boolean;

  /**
   * Filters an analogue set to matured, strictly-pre-date entries.
   * (Requirements 9.3, 9.5)
   */
  maturedPreDateOnly<T extends Analogue>(
    analogues: readonly T[],
    decisionDate: TradingDate,
    evalDate: TradingDate,
  ): T[];
}
