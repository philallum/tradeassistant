// Supabase-backed IntradayValidationStore adapter — intraday-validation feature.
// Backed by the `intraday_validations` table added in migration
// 20260916000010_intraday_validations.sql.
//
// Implements the SAME `IntradayValidationStore` PORT as the in-memory reference
// `InMemoryIntradayValidationStore` (src/intraday-validation/store.ts), reaching
// storage ONLY through the injected `SupabaseRestClient` and re-implementing no
// validation math.
//
// FAIL-SAFE READS (torn-deploy safety): `getByDecisionDate` / `getAll` degrade
// to an EMPTY result on ANY error — including the additive-migration torn-deploy
// case where `intraday_validations` is not yet present — logging a secret-free
// warning rather than throwing. Code live before the migration simply reads an
// empty slice. The Supabase key is never part of a `SupabaseRestError`.
//
// The `upsert` uses the idempotent PostgREST merge path keyed on the composite
// PK `(decision_date, pair)`, so re-running a validation for a day overwrites
// rather than duplicating. A write failure is NOT swallowed here; the Job wiring
// wraps the whole step in its own fail-safe try/catch so a write error can never
// fail the republish.

import type { Pair } from "../../ingestion/types.js";
import type { TradingDate } from "../../guard/types.js";
import type { DirectionClass } from "../../retrieval/types.js";
import type {
  IntradayValidationRecord,
  ValidationState,
} from "../../intraday-validation/types.js";
import type { IntradayValidationStore } from "../../intraday-validation/store.js";
import { SupabaseRestError, type SupabaseRestClient } from "./client.js";

const INTRADAY_VALIDATIONS = "intraday_validations";
const CONFLICT_TARGET = "decision_date,pair";

/** intraday_validations row shape (matches the SQL columns exactly). */
interface IntradayValidationDbRow {
  readonly decision_date: string;
  readonly pair: string;
  readonly original_direction: string;
  readonly original_confidence: number;
  readonly validation_timestamp: string;
  readonly bar_open_utc: string;
  readonly h4_open: number;
  readonly h4_high: number;
  readonly h4_low: number;
  readonly h4_current_price: number;
  readonly body: number;
  readonly range: number;
  readonly upper_wick: number;
  readonly lower_wick: number;
  readonly validation_state: string;
  readonly confidence_delta: number;
  readonly current_confidence: number;
  readonly reason: string;
}

/** Map a domain {@link IntradayValidationRecord} to its DB row. */
function toDbRow(record: IntradayValidationRecord): Record<string, unknown> {
  return {
    decision_date: record.decisionDate,
    pair: record.pair,
    original_direction: record.originalDirection,
    original_confidence: record.originalConfidence,
    validation_timestamp: record.validationTimestamp,
    bar_open_utc: record.barOpenUtc,
    h4_open: record.candle.open,
    h4_high: record.candle.high,
    h4_low: record.candle.low,
    h4_current_price: record.candle.currentPrice,
    body: record.features.body,
    range: record.features.range,
    upper_wick: record.features.upperWick,
    lower_wick: record.features.lowerWick,
    validation_state: record.result.state,
    confidence_delta: record.result.confidenceDelta,
    current_confidence: record.result.currentConfidence,
    reason: record.result.reason,
  };
}

/** Reconstruct a domain {@link IntradayValidationRecord} from a DB row. */
function fromDbRow(row: IntradayValidationDbRow): IntradayValidationRecord {
  const body = row.body;
  const range = row.range;
  const bodyDirection: DirectionClass = body > 0 ? "UP" : body < 0 ? "DOWN" : "FLAT";
  const bodyToRange = range === 0 ? 0 : Math.abs(body) / range;
  const pricePositionInRange =
    range === 0 ? 0.5 : (row.h4_current_price - row.h4_low) / range;
  return {
    decisionDate: row.decision_date,
    pair: row.pair as Pair,
    originalDirection: row.original_direction as DirectionClass,
    originalConfidence: row.original_confidence,
    validationTimestamp: row.validation_timestamp,
    barOpenUtc: row.bar_open_utc,
    candle: {
      open: row.h4_open,
      high: row.h4_high,
      low: row.h4_low,
      currentPrice: row.h4_current_price,
    },
    features: {
      range,
      body,
      bodyDirection,
      bodyToRange,
      upperWick: row.upper_wick,
      lowerWick: row.lower_wick,
      pricePositionInRange,
    },
    result: {
      state: row.validation_state as ValidationState,
      confidenceDelta: row.confidence_delta,
      currentConfidence: row.current_confidence,
      reason: row.reason,
    },
  };
}

/** A minimal secret-free logger seam (defaults to `console.warn`). */
export interface IntradayValidationLogger {
  warn(message: string): void;
}

const defaultLogger: IntradayValidationLogger = {
  warn: (message: string) => console.warn(message),
};

const SELECT_COLUMNS =
  "select=decision_date,pair,original_direction,original_confidence," +
  "validation_timestamp,bar_open_utc,h4_open,h4_high,h4_low,h4_current_price," +
  "body,range,upper_wick,lower_wick,validation_state,confidence_delta," +
  "current_confidence,reason";

export class SupabaseIntradayValidationStore implements IntradayValidationStore {
  readonly #client: SupabaseRestClient;
  readonly #logger: IntradayValidationLogger;

  constructor(client: SupabaseRestClient, logger: IntradayValidationLogger = defaultLogger) {
    this.#client = client;
    this.#logger = logger;
  }

  /** Idempotent merge upsert on the composite PK. Not swallowed (see header). */
  async upsert(records: readonly IntradayValidationRecord[]): Promise<void> {
    if (records.length === 0) return;
    await this.#client.upsert(INTRADAY_VALIDATIONS, records.map(toDbRow), CONFLICT_TARGET);
  }

  /**
   * Read every row for a Decision_Date. FAIL-SAFE: any error (including a
   * not-yet-present table during a torn additive deploy) degrades to `[]` with a
   * secret-free warning.
   */
  async getByDecisionDate(
    decisionDate: TradingDate,
  ): Promise<readonly IntradayValidationRecord[]> {
    const query =
      `${SELECT_COLUMNS}` +
      `&decision_date=eq.${encodeURIComponent(decisionDate)}` +
      `&order=pair.asc`;
    return this.#safeSelect(query);
  }

  /** Read every recorded row within an optional `[from, to]` window. FAIL-SAFE. */
  async getAll(from?: TradingDate, to?: TradingDate): Promise<readonly IntradayValidationRecord[]> {
    const filters =
      (from === undefined ? "" : `&decision_date=gte.${encodeURIComponent(from)}`) +
      (to === undefined ? "" : `&decision_date=lte.${encodeURIComponent(to)}`);
    const query = `${SELECT_COLUMNS}${filters}&order=decision_date.asc,pair.asc`;
    return this.#safeSelect(query);
  }

  /** Shared fail-safe select: degrades to `[]` with a secret-free warning. */
  async #safeSelect(query: string): Promise<readonly IntradayValidationRecord[]> {
    try {
      const rows = await this.#client.select<IntradayValidationDbRow>(
        INTRADAY_VALIDATIONS,
        query,
      );
      return rows.map(fromDbRow);
    } catch (err) {
      const detail =
        err instanceof SupabaseRestError
          ? `HTTP ${err.status} on "${err.table}"`
          : err instanceof Error
            ? err.name
            : "unknown error";
      this.#logger.warn(
        `intraday_validations read failed (${detail}); degrading to empty slice (fail-safe)`,
      );
      return [];
    }
  }
}
