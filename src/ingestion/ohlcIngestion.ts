// OHLC Validation and Idempotent Ingestion (Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.6).
//
// Authoritative TypeScript ingestion pipeline for the 5 major FX pairs.
// Enforces OHLC validity invariants, New York close session boundaries,
// look-ahead safety, and idempotent storage.

import { lookAheadGuard } from "../guard/lookAheadGuard.js";
import { err, ok } from "../guard/types.js";
import type { Candle, Result, TradingDate } from "../guard/types.js";
import {
  extractSessionDate,
  normalizeSessionBoundary,
} from "./sessionBoundary.js";
import { InMemoryCandleStore } from "./types.js";
import type {
  CandleStore,
  IngestReport,
  OhlcValidityError,
  Pair,
  PerPairCoverage,
  RawCandle,
} from "./types.js";

/**
 * Validates a single candidate candle against the OHLC invariant:
 *   high >= low AND open in [low, high] AND close in [low, high]
 * Requirement 7.3.
 */
export function validateCandle(
  candle: RawCandle,
  defaultAsset: Pair = "EURUSD",
): Result<Candle, OhlcValidityError> {
  const { open, high, low, close } = candle;

  // Basic numeric check
  if (
    typeof open !== "number" ||
    typeof high !== "number" ||
    typeof low !== "number" ||
    typeof close !== "number" ||
    Number.isNaN(open) ||
    Number.isNaN(high) ||
    Number.isNaN(low) ||
    Number.isNaN(close)
  ) {
    return err({
      reason: "ohlc_validity_error",
      candle,
      message: "Candle OHLC values must be non-NaN finite numbers",
    });
  }

  // Core invariant: high >= low and open, close in [low, high]
  if (high < low) {
    return err({
      reason: "ohlc_validity_error",
      candle,
      message: `Invalid OHLC: high (${high}) is less than low (${low})`,
    });
  }

  if (open < low || open > high) {
    return err({
      reason: "ohlc_validity_error",
      candle,
      message: `Invalid OHLC: open (${open}) is outside range [low=${low}, high=${high}]`,
    });
  }

  if (close < low || close > high) {
    return err({
      reason: "ohlc_validity_error",
      candle,
      message: `Invalid OHLC: close (${close}) is outside range [low=${low}, high=${high}]`,
    });
  }

  let sessionDate: TradingDate;
  try {
    sessionDate = extractSessionDate(candle).date;
  } catch (e) {
    return err({
      reason: "ohlc_validity_error",
      candle,
      message: e instanceof Error ? e.message : "Failed to extract session date",
    });
  }

  const asset = candle.asset ?? candle.pair ?? defaultAsset;

  return ok({
    asset,
    date: sessionDate,
    open,
    high,
    low,
    close,
    source: candle.source ?? "feed",
  });
}

/**
 * OHLC Ingestion service (Design Component 2).
 */
export class OhlcIngestion {
  private readonly store: CandleStore;

  constructor(store: CandleStore = new InMemoryCandleStore()) {
    this.store = store;
  }

  /**
   * Validate a single candidate candle (Requirement 7.3).
   */
  validate(candle: RawCandle): Result<Candle, OhlcValidityError> {
    return validateCandle(candle);
  }

  /**
   * Ingest a batch of raw candles for a currency pair (Requirements 7.1, 7.2, 7.4, 7.5).
   * Validates each candle, normalizes session boundaries, runs look-ahead safety
   * on any windowing constraints, and idempotently upserts to the store.
   */
  async ingest(
    pair: Pair,
    rawCandles: readonly RawCandle[],
    decisionDate?: TradingDate,
  ): Promise<IngestReport> {
    const validRaw: RawCandle[] = [];
    const errors: OhlcValidityError[] = [];

    for (const raw of rawCandles) {
      const valid = validateCandle(raw, pair);
      if (valid.ok) {
        validRaw.push(raw);
      } else {
        errors.push(valid.error);
      }
    }

    // Normalize session boundaries to Monday-Friday 17:00 NY close (Req 7.7, 7.8)
    const normalized = normalizeSessionBoundary(validRaw, pair);

    // Apply look-ahead guard if a historical decision date context is specified (Req 7.5)
    let candlesToStore = normalized;
    if (decisionDate) {
      const guardResult = lookAheadGuard.assertPastOnly(
        normalized,
        decisionDate,
      );
      if (!guardResult.ok) {
        throw new Error(guardResult.error.message);
      }
      candlesToStore = guardResult.value;
    }

    // Idempotent upsert into store keyed by (asset, date) (Req 7.2, 7.4)
    await this.store.upsertCandles(candlesToStore);

    return {
      pair,
      totalReceived: rawCandles.length,
      accepted: candlesToStore.length,
      rejected: errors.length,
      errors,
    };
  }

  /**
   * Retrieve per-pair coverage summary of ingested daily history (Requirement 7.6).
   */
  async coverageSummary(): Promise<readonly PerPairCoverage[]> {
    return this.store.getCoverageSummary();
  }

  /**
   * Query stored candles for a pair.
   */
  async getCandles(
    pair: Pair,
    startDate?: TradingDate,
    endDate?: TradingDate,
  ): Promise<readonly Candle[]> {
    return this.store.getCandles(pair, startDate, endDate);
  }
}
