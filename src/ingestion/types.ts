// OHLC Ingestion and Normalization Types (Requirements 7.1-7.8, 17.1).

import type { Candle, TradingDate } from "../guard/types.js";

/** The 5 major FX currency pairs supported by the system. */
export const PAIRS = [
  "EURUSD",
  "GBPUSD",
  "USDJPY",
  "USDCHF",
  "USDCAD",
] as const;

export type Pair = (typeof PAIRS)[number];

/** Helper type guard for Pair. */
export function isPair(value: string): value is Pair {
  return PAIRS.includes(value as Pair);
}

/**
 * Raw input candle before validation and session-boundary normalization.
 */
export interface RawCandle {
  readonly asset?: string;
  readonly pair?: Pair;
  readonly date?: string;
  readonly timestamp?: string | number | Date;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly source?: string;
}

/**
 * Typed rejection error when candidate candle violates OHLC invariant
 * (high >= low and open,close in [low, high]).
 * Requirement 7.3.
 */
export interface OhlcValidityError {
  readonly reason: "ohlc_validity_error";
  readonly candle: RawCandle;
  readonly message: string;
}

/** Summary report of an ingestion run. */
export interface IngestReport {
  readonly pair: Pair;
  readonly totalReceived: number;
  readonly accepted: number;
  readonly rejected: number;
  readonly errors: readonly OhlcValidityError[];
}

/** Summary of stored historical candle coverage per currency pair. */
export interface PerPairCoverage {
  readonly pair: Pair;
  readonly count: number;
  readonly earliestDate: TradingDate | null;
  readonly latestDate: TradingDate | null;
}

/**
 * The Candle storage PORT (Requirement 17.1).
 * Allows compute/ingestion to run against any storage backend (in-memory, Supabase).
 */
export interface CandleStore {
  /** Upsert candles idempotently keyed by (asset, date). (Requirement 7.4) */
  upsertCandles(candles: readonly Candle[]): Promise<void>;

  /** Query stored candles for an asset in an optional date range. */
  getCandles(
    asset: Pair,
    startDate?: TradingDate,
    endDate?: TradingDate,
  ): Promise<readonly Candle[]>;

  /** Get historical coverage summary across pairs. */
  getCoverageSummary(): Promise<readonly PerPairCoverage[]>;
}

/**
 * In-memory CandleStore reference implementation.
 */
export class InMemoryCandleStore implements CandleStore {
  // Key format: `${asset}:${date}`
  private readonly store = new Map<string, Candle>();

  upsertCandles(candles: readonly Candle[]): Promise<void> {
    for (const candle of candles) {
      const key = `${candle.asset}:${candle.date}`;
      this.store.set(key, candle);
    }
    return Promise.resolve();
  }

  getCandles(
    asset: Pair,
    startDate?: TradingDate,
    endDate?: TradingDate,
  ): Promise<readonly Candle[]> {
    const results: Candle[] = [];
    for (const candle of this.store.values()) {
      if (candle.asset !== asset) {
        continue;
      }
      if (startDate && candle.date < startDate) {
        continue;
      }
      if (endDate && candle.date > endDate) {
        continue;
      }
      results.push(candle);
    }
    // Sort chronologically
    return Promise.resolve(results.sort((a, b) => a.date.localeCompare(b.date)));
  }

  getCoverageSummary(): Promise<readonly PerPairCoverage[]> {
    const summary = PAIRS.map((pair) => {
      const pairCandles: Candle[] = [];
      for (const candle of this.store.values()) {
        if (candle.asset === pair) {
          pairCandles.push(candle);
        }
      }
      if (pairCandles.length === 0) {
        return {
          pair,
          count: 0,
          earliestDate: null,
          latestDate: null,
        };
      }
      pairCandles.sort((a, b) => a.date.localeCompare(b.date));
      return {
        pair,
        count: pairCandles.length,
        earliestDate: pairCandles[0]?.date ?? null,
        latestDate: pairCandles[pairCandles.length - 1]?.date ?? null,
      };
    });
    return Promise.resolve(summary);
  }

  clear(): void {
    this.store.clear();
  }
}
