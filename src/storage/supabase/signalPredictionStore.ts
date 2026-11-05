// Supabase-backed SignalPredictionStore adapter — signal-scorecard feature.
// Backed by the `signal_predictions` table added in migration
// 20260916000009_signal_predictions.sql.
//
// Implements the SAME `SignalPredictionStore` PORT as the in-memory reference
// `InMemorySignalPredictionStore` (src/dashboard/signalScorecard.ts), reaching
// storage ONLY through the injected `SupabaseRestClient` and re-implementing no
// scoring math.
//
// FAIL-SAFE READS (torn-deploy safety): `getByDecisionDate` / `getOpen` degrade
// to an EMPTY result on ANY error — including the additive-migration torn-deploy
// case where `signal_predictions` is not yet present — logging a secret-free
// warning rather than throwing. Code live before the migration simply reads an
// empty scorecard. The Supabase key is never part of a `SupabaseRestError`, so
// it is never surfaced.
//
// The `upsert` uses the idempotent PostgREST merge path keyed on the composite
// PK (decision_date, pair, strategy_id), so recording a day and later
// reconciling its realized side both land on the same rows without duplication.
// A write failure is NOT swallowed here; the daily-run wiring wraps the whole
// scorecard step in its own fail-safe try/catch so a write error can never fail
// the run.

import type {
  SignalPredictionRow,
  SignalPredictionStore,
} from "../../dashboard/signalScorecard.js";
import type { Pair } from "../../ingestion/types.js";
import type { TradingDate } from "../../guard/types.js";
import type { StrategyId, SignalDirection } from "../../strategies/types.js";
import { SupabaseRestError, type SupabaseRestClient } from "./client.js";

const SIGNAL_PREDICTIONS = "signal_predictions";
const CONFLICT_TARGET = "decision_date,pair,strategy_id";

/** signal_predictions row shape (matches the SQL columns exactly). */
interface SignalPredictionDbRow {
  readonly decision_date: string;
  readonly pair: string;
  readonly strategy_id: string;
  readonly predicted_direction: string;
  readonly realized_direction: string | null;
  readonly correct: boolean | null;
}

/** Map a domain {@link SignalPredictionRow} to its DB row. */
function toDbRow(row: SignalPredictionRow): Record<string, unknown> {
  return {
    decision_date: row.decisionDate,
    pair: row.pair,
    strategy_id: row.strategyId,
    predicted_direction: row.predictedDirection,
    realized_direction: row.realizedDirection,
    correct: row.correct,
    // Stamp the reconciliation time only once the realized side is filled, so
    // an operator can see when a row matured; left null while still open.
    reconciled_at: row.realizedDirection === null ? null : new Date().toISOString(),
  };
}

/** Reconstruct a domain {@link SignalPredictionRow} from a DB row. */
function fromDbRow(row: SignalPredictionDbRow): SignalPredictionRow {
  return {
    decisionDate: row.decision_date,
    pair: row.pair as Pair,
    strategyId: row.strategy_id as StrategyId,
    predictedDirection: row.predicted_direction as SignalDirection,
    realizedDirection: row.realized_direction as SignalDirection | null,
    correct: row.correct,
  };
}

/** A minimal secret-free logger seam (defaults to `console.warn`). */
export interface SignalPredictionLogger {
  warn(message: string): void;
}

const defaultLogger: SignalPredictionLogger = {
  warn: (message: string) => console.warn(message),
};

const SELECT_COLUMNS =
  "select=decision_date,pair,strategy_id,predicted_direction,realized_direction,correct";

export class SupabaseSignalPredictionStore implements SignalPredictionStore {
  readonly #client: SupabaseRestClient;
  readonly #logger: SignalPredictionLogger;

  constructor(client: SupabaseRestClient, logger: SignalPredictionLogger = defaultLogger) {
    this.#client = client;
    this.#logger = logger;
  }

  /** Idempotent merge upsert on the composite PK. Not swallowed (see header). */
  async upsert(rows: readonly SignalPredictionRow[]): Promise<void> {
    if (rows.length === 0) return;
    await this.#client.upsert(SIGNAL_PREDICTIONS, rows.map(toDbRow), CONFLICT_TARGET);
  }

  /**
   * Read every row for a Decision_Date. FAIL-SAFE: any error (including a
   * not-yet-present table during a torn additive deploy) degrades to `[]` with a
   * secret-free warning.
   */
  async getByDecisionDate(decisionDate: TradingDate): Promise<readonly SignalPredictionRow[]> {
    const query =
      `${SELECT_COLUMNS}` +
      `&decision_date=eq.${encodeURIComponent(decisionDate)}` +
      `&order=pair.asc,strategy_id.asc`;
    return this.#safeSelect(query);
  }

  /**
   * Read every still-open row (realized_direction is null) with decision_date in
   * `[from, to]`. FAIL-SAFE like {@link getByDecisionDate}.
   */
  async getOpen(from: TradingDate, to: TradingDate): Promise<readonly SignalPredictionRow[]> {
    const query =
      `${SELECT_COLUMNS}` +
      `&realized_direction=is.null` +
      `&decision_date=gte.${encodeURIComponent(from)}` +
      `&decision_date=lte.${encodeURIComponent(to)}` +
      `&order=decision_date.asc,pair.asc,strategy_id.asc`;
    return this.#safeSelect(query);
  }

  /**
   * Read every recorded row within an optional `[from, to]` Decision_Date
   * window (used to aggregate the scorecard slice). FAIL-SAFE like
   * {@link getByDecisionDate}.
   */
  async getAll(from?: TradingDate, to?: TradingDate): Promise<readonly SignalPredictionRow[]> {
    const filters =
      (from === undefined ? "" : `&decision_date=gte.${encodeURIComponent(from)}`) +
      (to === undefined ? "" : `&decision_date=lte.${encodeURIComponent(to)}`);
    const query =
      `${SELECT_COLUMNS}${filters}&order=decision_date.asc,pair.asc,strategy_id.asc`;
    return this.#safeSelect(query);
  }

  /** Shared fail-safe select: degrades to `[]` with a secret-free warning. */
  async #safeSelect(query: string): Promise<readonly SignalPredictionRow[]> {
    try {
      const rows = await this.#client.select<SignalPredictionDbRow>(
        SIGNAL_PREDICTIONS,
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
        `signal_predictions read failed (${detail}); degrading to empty scorecard (fail-safe)`,
      );
      return [];
    }
  }
}
