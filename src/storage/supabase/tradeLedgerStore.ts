// Supabase-backed TradeLedgerStore adapter — trader-edge-validation Stage C
// (task 5; design R3). Backed by the `trade_ledger` table added in migration
// 20260916000007_trade_ledger.sql.
//
// Implements the SAME `TradeLedgerStore` PORT as the in-memory reference
// `InMemoryTradeLedgerStore` (src/trade-ledger/types.ts), reaching storage ONLY
// through the injected `SupabaseRestClient` and re-implementing no builder math.
//
// FAIL-SAFE READ (R3 / Stage C deploy-safety): `getByWindow` degrades to an
// EMPTY result on ANY error — including the additive-migration torn-deploy case
// where the `trade_ledger` table is not yet present — logging a secret-free
// warning rather than throwing. This is what makes a torn deploy harmless: code
// live before the migration simply reads an empty ledger. The Supabase key is
// never part of a `SupabaseRestError`, so it is never surfaced. Writes use the
// POST upsert path and are NOT swallowed (a failed write should surface to the
// operator ops entry, which is not on the daily-run critical path).

import type {
  TradeLedgerRow,
  TradeLedgerStore,
} from "../../trade-ledger/types.js";
import type { Pair } from "../../ingestion/types.js";
import type { TradingDate } from "../../guard/types.js";
import type { DirectionClass } from "../../retrieval/types.js";
import type { TradeOutcomeKind } from "../../trade-sim/types.js";
import { SupabaseRestError, type SupabaseRestClient } from "./client.js";

const TRADE_LEDGER = "trade_ledger";

/** trade_ledger row shape (matches the SQL columns exactly). */
interface TradeLedgerDbRow {
  readonly strategy_id: string;
  readonly pair: string;
  readonly decision_date: string;
  readonly fired: boolean;
  readonly direction: string;
  readonly horizon: number;
  readonly earned_confidence: number;
  readonly entry_price: number;
  readonly entry_date: string;
  readonly stop_loss_pips: number | null;
  readonly take_profit_pips: number | null;
  readonly outcome: string;
  readonly gross_pips: number;
  readonly cost_pips: number;
  readonly net_pips: number;
  readonly r_multiple: number | null;
}

/** Map a domain {@link TradeLedgerRow} to its `trade_ledger` DB row. */
function toDbRow(row: TradeLedgerRow): Record<string, unknown> {
  return {
    strategy_id: row.strategyId,
    pair: row.pair,
    decision_date: row.decisionDate,
    fired: row.fired,
    direction: row.direction,
    horizon: row.horizon,
    earned_confidence: row.earnedConfidence,
    entry_price: row.entryPrice,
    entry_date: row.entryDate,
    stop_loss_pips: row.stopLossPips,
    take_profit_pips: row.takeProfitPips,
    outcome: row.outcome,
    gross_pips: row.grossPips,
    cost_pips: row.costPips,
    net_pips: row.netPips,
    r_multiple: row.rMultiple,
  };
}

/** Reconstruct a domain {@link TradeLedgerRow} from a DB row. */
function fromDbRow(row: TradeLedgerDbRow): TradeLedgerRow {
  return {
    strategyId: row.strategy_id,
    pair: row.pair as Pair,
    decisionDate: row.decision_date,
    fired: row.fired,
    direction: row.direction as DirectionClass,
    horizon: row.horizon as 1 | 2 | 3,
    earnedConfidence: row.earned_confidence,
    entryPrice: row.entry_price,
    entryDate: row.entry_date,
    stopLossPips: row.stop_loss_pips,
    takeProfitPips: row.take_profit_pips,
    outcome: row.outcome as TradeOutcomeKind,
    grossPips: row.gross_pips,
    costPips: row.cost_pips,
    netPips: row.net_pips,
    rMultiple: row.r_multiple,
  };
}

/** A minimal secret-free logger seam (defaults to `console.warn`). */
export interface LedgerLogger {
  warn(message: string): void;
}

const defaultLogger: LedgerLogger = {
  warn: (message: string) => console.warn(message),
};

export class SupabaseTradeLedgerStore implements TradeLedgerStore {
  readonly #client: SupabaseRestClient;
  readonly #logger: LedgerLogger;

  constructor(client: SupabaseRestClient, logger: LedgerLogger = defaultLogger) {
    this.#client = client;
    this.#logger = logger;
  }

  /** Upsert ledger rows (POST). Not swallowed — a failed write surfaces to ops. */
  async appendRows(rows: readonly TradeLedgerRow[]): Promise<void> {
    if (rows.length === 0) return;
    await this.#client.insertReturning<TradeLedgerDbRow>(
      TRADE_LEDGER,
      rows.map(toDbRow),
    );
  }

  /**
   * Read rows whose decision_date is within [from, to], optionally one strategy.
   * FAIL-SAFE: any error (including a not-yet-present `trade_ledger` table during
   * a torn additive deploy) degrades to `[]` with a secret-free warning.
   */
  async getByWindow(
    from: TradingDate,
    to: TradingDate,
    strategyId?: string,
  ): Promise<readonly TradeLedgerRow[]> {
    try {
      const strategyFilter =
        strategyId === undefined ? "" : `&strategy_id=eq.${encodeURIComponent(strategyId)}`;
      const query =
        `decision_date=gte.${encodeURIComponent(from)}` +
        `&decision_date=lte.${encodeURIComponent(to)}` +
        strategyFilter +
        `&order=decision_date.asc,pair.asc,strategy_id.asc`;
      const rows = await this.#client.select<TradeLedgerDbRow>(TRADE_LEDGER, query);
      return rows.map(fromDbRow);
    } catch (err) {
      // Secret-free: carry ONLY the table + status (SupabaseRestError never holds
      // the key); any other error is logged by name without its payload.
      const detail =
        err instanceof SupabaseRestError
          ? `HTTP ${err.status} on "${err.table}"`
          : err instanceof Error
            ? err.name
            : "unknown error";
      this.#logger.warn(
        `trade_ledger read failed (${detail}); degrading to empty ledger (fail-safe)`,
      );
      return [];
    }
  }
}
