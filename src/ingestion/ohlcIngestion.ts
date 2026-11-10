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
import { validateRange } from "./rangeGuard.js";
import { InMemoryCandleStore } from "./types.js";
import type {
  CandleStore,
  IngestReport,
  OhlcValidityError,
  Pair,
  PerPairCoverage,
  RawCandle,
} from "./types.js";

/** Calendar days of stored history read before a batch for the range guard (>= 60 trading days). */
const RANGE_HISTORY_WINDOW_DAYS = 120;

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

  private readonly log: (event: object) => void;

  constructor(
    store: CandleStore = new InMemoryCandleStore(),
    log: (event: object) => void = (event) => {
      console.log(JSON.stringify(event));
    },
  ) {
    this.store = store;
    this.log = log;
  }

  /**
   * Drop candles whose range fails {@link validateRange}, pushing a typed error for each and
   * logging a secret-free `candle_ingest.range_rejected` event. History = stored candles plus
   * the batch itself, bounded to a window before the batch so the store read stays small.
   */
  private async applyRangeGuard(
    pair: Pair,
    candles: readonly Candle[],
    errors: OhlcValidityError[],
  ): Promise<readonly Candle[]> {
    if (candles.length === 0) return candles;

    const dates = candles.map((c) => c.date).sort();
    const earliest = dates[0] as TradingDate;
    const latest = dates[dates.length - 1] as TradingDate;
    const startMs = Date.parse(`${earliest}T00:00:00Z`) - RANGE_HISTORY_WINDOW_DAYS * 86_400_000;
    const start = Number.isNaN(startMs) ? undefined : new Date(startMs).toISOString().slice(0, 10);

    const stored = await this.store.getCandles(pair, start, latest);
    const byDate = new Map<string, Candle>();
    for (const c of stored) byDate.set(c.date, c);
    // Batch candles are NOT used as history for themselves when they replace a stored date.
    for (const c of candles) if (!byDate.has(c.date)) byDate.set(c.date, c);
    const history = [...byDate.values()];

    const accepted: Candle[] = [];
    for (const candle of candles) {
      const verdict = validateRange(candle, history);
      if (verdict.ok) {
        accepted.push(candle);
        continue;
      }
      errors.push({ reason: "ohlc_validity_error", candle, message: verdict.message });
      this.log({
        event: "candle_ingest.range_rejected",
        severity: "WARNING",
        pair,
        date: candle.date,
        kind: verdict.kind,
        range: verdict.range,
        medianRange: verdict.medianRange,
      });
    }
    return accepted;
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

    // Range sanity guard: reject implausibly small/large daily ranges (forming or mis-dated
    // bars) using only candles dated strictly before each candidate.
    const rangeChecked = await this.applyRangeGuard(pair, normalized, errors);

    // Apply look-ahead guard if a historical decision date context is specified (Req 7.5)
    let candlesToStore = rangeChecked;
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
