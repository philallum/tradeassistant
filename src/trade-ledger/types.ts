// Trade_Ledger types + storage port — trader-edge-validation Stage C (task 4; design R3).
//
// The Trade_Ledger is the deterministic record of every simulated trade over an
// evaluation window: ONE row per eligible forecast. It is the SOLE source of
// every aggregate performance metric (R3.4) — nothing downstream recomputes a
// summary by a path that bypasses it. Suppressed (non-fired) forecasts are kept
// with `fired: false` so the SELECTION rule itself can be evaluated (R3.2), and
// `ambiguous` outcomes are a first-class category never folded into win/loss
// (R3.5). Deterministic and reproducible from stored inputs + a stated
// Parameter_Set + Execution_Model (R3.3). LLM-free; a separate read-only consumer
// that never feeds the live firing / scoring decision.

import type { TradingDate } from "../guard/types.js";
import type { Pair } from "../ingestion/types.js";
import type { DirectionClass } from "../retrieval/types.js";
import type { TradeOutcomeKind } from "../trade-sim/types.js";

/**
 * One ledger row. Keyed by `(strategyId, pair, decisionDate)` — the system is
 * `strategyId: "system"`; a Comparator_Strategy (R5) uses its own id so the same
 * ledger holds every strategy side by side under one Execution_Model.
 */
export interface TradeLedgerRow {
  readonly strategyId: string;
  readonly pair: Pair;
  readonly decisionDate: TradingDate;
  /** False for a SUPPRESSED forecast kept to evaluate the selection rule (R3.2). */
  readonly fired: boolean;
  readonly direction: DirectionClass;
  readonly horizon: 1 | 2 | 3;
  readonly earnedConfidence: number;
  readonly entryPrice: number;
  readonly entryDate: TradingDate;
  /** Positive Stop_Loss pip distance, or null when below the risk-boundary floor. */
  readonly stopLossPips: number | null;
  /** Positive Take_Profit pip distance, or null when below the floor. */
  readonly takeProfitPips: number | null;
  readonly outcome: TradeOutcomeKind;
  /** Realized pips before costs. */
  readonly grossPips: number;
  /** Execution_Model friction applied (always ≥ 0). */
  readonly costPips: number;
  /** Net-of-cost realized pips (`grossPips − costPips`). */
  readonly netPips: number;
  /** `netPips` divided by the risked distance (entry→SL); null when SL is null. */
  readonly rMultiple: number | null;
}

/**
 * Storage PORT for the `trade_ledger` table (R3.1, R3.4). Mirrors the house
 * port + in-memory-reference + Supabase-adapter triad (`FiringSetupStore`,
 * `RealizedOutcomeStore`, `EvaluationReportStore`). Upserts are idempotent on
 * the composite key so re-building a window replaces rather than duplicates.
 */
export interface TradeLedgerStore {
  /** Upsert ledger rows, keyed by (strategyId, pair, decisionDate). */
  appendRows(rows: readonly TradeLedgerRow[]): Promise<void>;
  /** Read rows whose decisionDate is within [from, to], optionally one strategy. */
  getByWindow(
    from: TradingDate,
    to: TradingDate,
    strategyId?: string,
  ): Promise<readonly TradeLedgerRow[]>;
}

/** Composite-key string mirroring the SQL primary key. */
function rowKey(row: TradeLedgerRow): string {
  return `${row.strategyId}|${row.pair}|${row.decisionDate}`;
}

/**
 * In-memory reference implementation of {@link TradeLedgerStore}. Deterministic,
 * dependency-free; upserts by the same composite key as the SQL PK so a repeat
 * append replaces the row. Serves as the reference for the Supabase adapter and
 * lets the ledger run offline in tests.
 */
export class InMemoryTradeLedgerStore implements TradeLedgerStore {
  readonly #rows = new Map<string, TradeLedgerRow>();

  constructor(initial: readonly TradeLedgerRow[] = []) {
    for (const row of initial) this.#rows.set(rowKey(row), row);
  }

  appendRows(rows: readonly TradeLedgerRow[]): Promise<void> {
    for (const row of rows) this.#rows.set(rowKey(row), row);
    return Promise.resolve();
  }

  getByWindow(
    from: TradingDate,
    to: TradingDate,
    strategyId?: string,
  ): Promise<readonly TradeLedgerRow[]> {
    const rows = [...this.#rows.values()].filter(
      (r) =>
        r.decisionDate >= from &&
        r.decisionDate <= to &&
        (strategyId === undefined || r.strategyId === strategyId),
    );
    // Deterministic order: date, then pair, then strategy.
    rows.sort(
      (a, b) =>
        a.decisionDate.localeCompare(b.decisionDate) ||
        a.pair.localeCompare(b.pair) ||
        a.strategyId.localeCompare(b.strategyId),
    );
    return Promise.resolve(rows);
  }

  size(): number {
    return this.#rows.size;
  }

  clear(): void {
    this.#rows.clear();
  }
}
