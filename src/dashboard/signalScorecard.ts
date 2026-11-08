// Signal Scorecard — per-signal daily direction record (signal-scorecard feature).
//
// Keeps a permanent, dated record of what EACH of the six signals suggested for
// a pair on a Decision_Date (UP | DOWN | FLAT), and — once the following session
// closes — what the market actually did. The point is a running "which signal
// was historically right or wrong" ledger covering ALL SIX signals uniformly,
// including the non-replayable `third_party` read (a live external signal that
// cannot be reconstructed after the fact) and every day's `custom_pattern` call,
// not just the days a setup fired.
//
// This module is a SEPARATE, read-only consumer of already-produced data that
// mirrors the storage-port + in-memory-reference pattern used across the
// codebase (e.g. `FiringSetupStore`, `RealizedOutcomeStore`, `TradeLedgerStore`):
//
//   1. `recordPredictions` reads the per-run Confluence_Matrix that the daily
//      run ALREADY builds (`buildConfluenceMatrix`) and writes one row per
//      available signal cell per pair with its `predictedDirection`. It computes
//      NO new signal — it only copies the directions the matrix produced. An
//      `unavailable` cell is skipped (no direction to record).
//
//   2. `reconcileOutcomes` fills the realized side of any still-open prior row
//      whose following session has now closed, using the SAME outcome rule the
//      rest of the project scores by — `realizedDirectionAfter` from
//      `../track-record/strategyRecord.js` (the sign of the next session's
//      open-to-close move; exactly 0 is FLAT). A directional (UP/DOWN) call is
//      marked `correct` iff it equals the realized direction; a FLAT prediction
//      is an abstention and stays `correct = null` even once matured.
//
// Scoring isolation: this never feeds the directional probability,
// Earned_Confidence, retrieval, or the Kill_Gate verdict. It takes NO LLM input
// — the Confluence_Matrix cells are deterministic StrategySignals (LLM-tagged
// values are refused upstream by `validateStrategySignal`). Recording or
// reconciling leaves every firing/scoring computation byte-for-byte identical.
//
// Idempotency: the upsert is keyed on the SQL primary key
// (decision_date, pair, strategy_id), so re-running a Decision_Date replaces
// rather than duplicates, and re-reconciling a matured row updates it in place.

import type { TradingDate } from "../guard/types.js";
import { PAIRS, type CandleStore, type Pair } from "../ingestion/types.js";
import type {
  ConfluenceMatrix,
} from "../strategies/confluenceMatrix.js";
import {
  STRATEGY_IDS,
  type StrategyId,
  type SignalDirection,
} from "../strategies/types.js";
import { realizedDirectionAfter } from "../track-record/strategyRecord.js";

/**
 * Default backlog window for {@link reconcileOutcomes}, in calendar days. Matches
 * the snapshot history window so the scorecard reconciles over the same recent
 * horizon the dashboard renders, without depending on the `scheduled-run` layer.
 */
export const RECONCILE_WINDOW_DAYS = 400 as const;

/** Compute the inclusive lower-bound date `windowDays` before `decisionDate` (UTC). */
function windowStartDate(decisionDate: string, windowDays: number): string {
  const start = new Date(`${decisionDate}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - windowDays);
  return start.toISOString().slice(0, 10);
}

/**
 * A single `signal_predictions` row — one signal's suggested direction for a
 * pair on a Decision_Date, paired with the realized next-session direction once
 * matured. Field names mirror the domain; the Supabase adapter maps them to the
 * snake_case SQL columns. Every value is deterministic (no LLM-derived field).
 */
export interface SignalPredictionRow {
  readonly decisionDate: TradingDate;
  readonly pair: Pair;
  readonly strategyId: StrategyId;
  /** What the signal suggested for the day (UP | DOWN | FLAT). */
  readonly predictedDirection: SignalDirection;
  /** Realized next-session direction; `null` until the following session closes. */
  readonly realizedDirection: SignalDirection | null;
  /**
   * `true`/`false` for a matured directional (UP/DOWN) call, `null` while still
   * open OR when the prediction was FLAT (an abstention is never scored).
   */
  readonly correct: boolean | null;
}

/**
 * Storage PORT for the `signal_predictions` table. Callers depend only on this
 * port, never on Supabase directly, mirroring the storage-port + in-memory
 * reference pattern used across the codebase. Implementations upsert by the SQL
 * composite primary key (decision_date, pair, strategy_id) so re-running a day
 * is idempotent.
 */
export interface SignalPredictionStore {
  /** Upsert rows, keyed by (decisionDate, pair, strategyId). */
  upsert(rows: readonly SignalPredictionRow[]): Promise<void>;
  /** Read every row for a Decision_Date (order unspecified). */
  getByDecisionDate(decisionDate: TradingDate): Promise<readonly SignalPredictionRow[]>;
  /**
   * Read every row whose realized side is still unfilled (`realizedDirection`
   * is null) with a `decisionDate` within `[from, to]` inclusive. Used by the
   * reconciliation pass to find the backlog to mature.
   */
  getOpen(from: TradingDate, to: TradingDate): Promise<readonly SignalPredictionRow[]>;
  /**
   * Read every recorded row (matured and still-open), across all dates, within
   * an optional `[from, to]` Decision_Date window. Used to aggregate the
   * scorecard slice. Order unspecified.
   */
  getAll(from?: TradingDate, to?: TradingDate): Promise<readonly SignalPredictionRow[]>;
}

/** Composite-key string used by the in-memory store (mirrors the SQL PK). */
function rowKey(decisionDate: TradingDate, pair: Pair, strategyId: StrategyId): string {
  return `${decisionDate}|${pair}|${strategyId}`;
}

/**
 * In-memory reference implementation of {@link SignalPredictionStore}.
 *
 * Deterministic and dependency-free; upserts by the same composite key as the
 * SQL primary key, so re-persisting a key REPLACES the row rather than
 * duplicating it. Serves as the reference for the Supabase adapter and lets the
 * scorecard flow run offline.
 */
export class InMemorySignalPredictionStore implements SignalPredictionStore {
  readonly #rows = new Map<string, SignalPredictionRow>();

  constructor(initial: readonly SignalPredictionRow[] = []) {
    for (const row of initial) {
      this.#rows.set(rowKey(row.decisionDate, row.pair, row.strategyId), row);
    }
  }

  upsert(rows: readonly SignalPredictionRow[]): Promise<void> {
    for (const row of rows) {
      this.#rows.set(rowKey(row.decisionDate, row.pair, row.strategyId), row);
    }
    return Promise.resolve();
  }

  getByDecisionDate(decisionDate: TradingDate): Promise<readonly SignalPredictionRow[]> {
    const rows = [...this.#rows.values()].filter((r) => r.decisionDate === decisionDate);
    return Promise.resolve(rows);
  }

  getOpen(from: TradingDate, to: TradingDate): Promise<readonly SignalPredictionRow[]> {
    const rows = [...this.#rows.values()].filter(
      (r) =>
        r.realizedDirection === null &&
        r.decisionDate >= from &&
        r.decisionDate <= to,
    );
    return Promise.resolve(rows);
  }

  getAll(from?: TradingDate, to?: TradingDate): Promise<readonly SignalPredictionRow[]> {
    const rows = [...this.#rows.values()].filter(
      (r) =>
        (from === undefined || r.decisionDate >= from) &&
        (to === undefined || r.decisionDate <= to),
    );
    return Promise.resolve(rows);
  }

  /** Test/inspection helper: total number of rows currently held. */
  size(): number {
    return this.#rows.size;
  }

  clear(): void {
    this.#rows.clear();
  }
}

/** Options for {@link recordPredictions}. */
export interface RecordPredictionsOptions {
  /** Signals whose cells must NOT be recorded for this call. */
  readonly excludeStrategyIds?: readonly StrategyId[];
}

/**
 * Record one row per AVAILABLE signal cell in the per-run Confluence_Matrix,
 * keyed by (decisionDate, pair, strategyId), carrying the signal's suggested
 * direction. The realized side is left unfilled (`realizedDirection = null`,
 * `correct = null`); a later {@link reconcileOutcomes} fills it once the
 * following session closes.
 *
 * The matrix is the deterministic artifact the daily run already builds, so this
 * computes no new signal — it copies the direction each cell produced. An
 * `unavailable` cell (a strategy error, no pattern evaluation, or no third-party
 * reference) has no direction and is skipped, so only genuinely produced signals
 * are recorded.
 *
 * Idempotent: re-running the same Decision_Date upserts the same keys.
 *
 * `options.excludeStrategyIds` omits whole signals from this recording (their cells are
 * simply not written). The daily run uses it to withhold `third_party` on a REPLAYED
 * Decision_Date: that signal is a LIVE external read that cannot be reconstructed for a
 * past date, so recording it under a replayed date would store today's value as that
 * date's prediction. Omitted by default, so the normal run records all six signals.
 *
 * @returns The rows that were persisted.
 */
export async function recordPredictions(
  store: SignalPredictionStore,
  matrix: ConfluenceMatrix,
  options: RecordPredictionsOptions = {},
): Promise<readonly SignalPredictionRow[]> {
  const rows: SignalPredictionRow[] = [];
  const excluded = new Set<StrategyId>(options.excludeStrategyIds ?? []);

  for (const pairConfluence of matrix.pairs) {
    // Cells are in canonical STRATEGY_IDS order (length six); index into the
    // id list so each recorded row is tagged with the right strategy.
    pairConfluence.cells.forEach((cell, index) => {
      if (!cell.available) return; // no direction to record for an unavailable cell
      const strategyId = STRATEGY_IDS[index] ?? cell.signal.strategyId;
      if (excluded.has(strategyId)) return;
      rows.push({
        decisionDate: matrix.decisionDate,
        pair: pairConfluence.pair,
        strategyId,
        predictedDirection: cell.signal.direction,
        realizedDirection: null,
        correct: null,
      });
    });
  }

  await store.upsert(rows);
  return rows;
}

/** An aggregated recorded tally for one pair+signal (domain shape, wire-agnostic). */
export interface SignalScorecardTally {
  readonly pair: Pair;
  readonly strategyId: StrategyId;
  /** Matured directional (UP/DOWN) calls. */
  readonly calls: number;
  /** Matured calls whose recorded direction matched the realized direction. */
  readonly correct: number;
  /** Matured FLAT predictions (abstentions) — outcome known, not scored. */
  readonly flat: number;
  /** Predictions recorded but not yet reconciled. */
  readonly pending: number;
}

/** The aggregated recorded scorecard: per pair+signal tallies plus the grand total. */
export interface SignalScorecardAggregate {
  readonly totalRecorded: number;
  readonly tallies: readonly SignalScorecardTally[];
}

/**
 * Aggregate recorded `signal_predictions` rows into per (pair, strategyId)
 * tallies. A matured FLAT prediction counts toward `flat` (an abstention,
 * outcome known but not scored); a matured UP/DOWN prediction counts toward
 * `calls` and, when it matched the realized direction, `correct`; a still-open
 * row (no `realizedDirection`) counts toward `pending`. Pure — no I/O, no clock.
 * Tallies are emitted in (pair, strategyId) encounter order of first sighting.
 */
export function aggregateSignalScorecard(
  rows: readonly SignalPredictionRow[],
): SignalScorecardAggregate {
  const byKey = new Map<string, { -readonly [K in keyof SignalScorecardTally]: SignalScorecardTally[K] }>();

  for (const row of rows) {
    const key = `${row.pair}|${row.strategyId}`;
    let tally = byKey.get(key);
    if (tally === undefined) {
      tally = { pair: row.pair, strategyId: row.strategyId, calls: 0, correct: 0, flat: 0, pending: 0 };
      byKey.set(key, tally);
    }
    if (row.realizedDirection === null) {
      tally.pending += 1;
    } else if (row.predictedDirection === "FLAT") {
      tally.flat += 1;
    } else {
      tally.calls += 1;
      if (row.correct === true) tally.correct += 1;
    }
  }

  return { totalRecorded: rows.length, tallies: [...byKey.values()] };
}

/** Score a directional call; a FLAT prediction (abstention) is never scored. */
function scoreCall(
  predicted: SignalDirection,
  realized: SignalDirection,
): boolean | null {
  if (predicted === "FLAT") return null; // abstention
  return predicted === realized;
}

/**
 * Fill the realized side of still-open rows whose following session has now
 * closed, scoring each directional call against the actual next-session move.
 *
 * The outcome rule is the project's shared `realizedDirectionAfter` (the sign of
 * the next session's open-to-close move, exactly 0 is FLAT), so a recorded
 * signal's record is measured exactly the way the pattern engine's outcomes and
 * the replay-based track record are. A row is matured ONLY when a candle strictly
 * after its `decisionDate` exists for the pair — before then it is left open and
 * retried on a later run. The realized direction therefore comes exclusively
 * from candles dated after the Decision_Date (no look-ahead into the prediction).
 *
 * Candles for the window are loaded per pair with isolated failure handling: a
 * pair whose load throws is skipped (its rows stay open and retry later) while
 * every other pair reconciles. Idempotent: re-reconciling an already-matured row
 * writes the same result.
 *
 * @param store        The scorecard store.
 * @param decisionDate The current run's Decision_Date — the upper bound of the
 *                     backlog window and the "now" the maturation is measured at.
 * @param candleStore  The candle storage port the next-session move is read from.
 * @param options      Optional backlog window (defaults to {@link HISTORY_WINDOW_DAYS}).
 * @returns The rows that were newly matured and updated this pass.
 */
export async function reconcileOutcomes(
  store: SignalPredictionStore,
  decisionDate: TradingDate,
  candleStore: CandleStore,
  options: { readonly windowDays?: number } = {},
): Promise<readonly SignalPredictionRow[]> {
  const windowDays = options.windowDays ?? RECONCILE_WINDOW_DAYS;
  const from = windowStartDate(decisionDate, windowDays);

  const open = await store.getOpen(from, decisionDate);
  if (open.length === 0) return [];

  // Load candles once per pair (only the pairs with open rows), isolating a
  // per-pair failure so one unreadable pair never blocks the rest.
  const pairsWithOpen = new Set<Pair>(open.map((r) => r.pair));
  const candlesByPair = new Map<Pair, Awaited<ReturnType<CandleStore["getCandles"]>>>();
  await Promise.all(
    PAIRS.filter((p) => pairsWithOpen.has(p)).map(async (pair) => {
      try {
        // Load through the Decision_Date (inclusive) so the forward candle of a
        // prediction made on a prior day is available.
        const candles = await candleStore.getCandles(pair, from, decisionDate);
        candlesByPair.set(pair, candles);
      } catch {
        // Skip this pair; its open rows stay open and retry on a later run.
      }
    }),
  );

  const updated: SignalPredictionRow[] = [];
  for (const row of open) {
    const candles = candlesByPair.get(row.pair);
    if (candles === undefined) continue; // load failed; leave open

    const realized = realizedDirectionAfter(candles, row.decisionDate);
    if (realized === null) continue; // no forward candle yet; still open

    updated.push({
      ...row,
      realizedDirection: realized,
      correct: scoreCall(row.predictedDirection, realized),
    });
  }

  if (updated.length > 0) {
    await store.upsert(updated);
  }
  return updated;
}
