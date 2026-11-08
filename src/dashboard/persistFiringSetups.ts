// Persist per-pair firing / suppression outcomes to `firing_setups` —
// Design Component 11 storage (Requirements 21, 17.1).
//
// After `dailyRun()` produces a DashboardView for a Decision_Date, this module
// records ONE `firing_setups` row per pair, keyed by (decision_date, pair). It
// writes the deterministic outcome of each pair's firing decision:
//
//   - `surfaced` is true for the rendered FiringCards, false for every pair that
//     did not fire (Requirement 16.2).
//   - `suppression_reason` records WHY a non-surfaced pair stayed silent:
//     'below_floor' (empirical boundaries not actionable) or 'not_fired'
//     (confidence below threshold / FLAT direction). There is NO suppression
//     step: the news suppressor and the Gate_Auto_Block have been removed
//     (Requirements 3.4, 3.5), so 'news' is no longer a reason; the
//     Currency_Concentration_Guard has likewise been removed (Requirement 3.3),
//     so 'currency_concentration' is no longer a reason and no competing-pairs
//     plumbing is recorded. See the SQL check constraint on
//     `firing_setups.suppression_reason` (Requirement 21.5).
//   - direction / horizon / earned_confidence / stop_loss_pips / take_profit_pips
//     carry the deterministic values; boundaries are `null` when not actionable
//     (Requirements 21.4, 21.5).
//
// Single-strategy: the Strategy_Source multi-strategy abstraction has been
// removed (Requirement 7.4). There is no `strategy_id` in the domain model;
// the retained Supabase write path hardcodes the single plain `'system'` column
// default where the schema still requires it, until the schema reduction drops
// it in Phase 4.
//
// Compute/storage separation (Requirement 17.1): persistence goes through the
// `FiringSetupStore` PORT, never a Supabase client directly, mirroring the
// storage-port + in-memory reference pattern used across the codebase (e.g.
// `AnalogueStore`). The upsert is idempotent on the composite key, so re-running
// the same Decision_Date replaces rather than duplicates rows.
//
// This module is part of the DETERMINISTIC CORE: it derives every persisted value
// from the same typed `PairEvaluation` inputs the dashboard consumed and from the
// dashboard's own `DashboardView` — it never re-implements the firing logic, and
// it takes NO LLM input (the outward-only rationale/labels are not persisted
// here).

import type { Pair } from "../ingestion/types.js";
import { PAIRS } from "../ingestion/types.js";
import type { TradingDate } from "../guard/types.js";
import type { DirectionClass } from "../retrieval/types.js";
import { fires, type PairEvaluation } from "./dashboard.js";
import { DEFAULT_DASHBOARD_CONFIG, type DashboardConfig, type DashboardView } from "./types.js";

/**
 * The reasons a non-surfaced pair stayed silent. `null` accompanies a surfaced
 * pair (Requirements 21.5, 3.5).
 *
 * There is NO suppression step. The news suppressor and the Gate_Auto_Block
 * have been removed (Requirements 3.4, 3.5), so `news` is no longer a reason.
 * The Choppiness_Guard has been removed as a suppressor (Requirement 3.1), so
 * `too_choppy` is no longer a suppression reason; the Choppiness_Metric is a
 * displayed field on the observation instead (Requirement 3.2). The
 * Currency_Concentration_Guard has likewise been removed (Requirement 3.3), so
 * `currency_concentration` is no longer a suppression reason. A non-firing pair
 * is an explicit "no trade" observation recorded as `not_fired`.
 */
export type SuppressionReason = "below_floor" | "not_fired";

/**
 * A single `firing_setups` row (Requirement 21). Field names mirror the SQL
 * columns; every value is deterministic (no LLM-derived field).
 */
export interface FiringSetupRow {
  readonly decisionDate: TradingDate;
  readonly pair: Pair;
  readonly direction: DirectionClass;
  readonly horizon: 1 | 2 | 3;
  readonly earnedConfidence: number;
  /** Empirical Stop_Loss in pips (Component 15), or `null` when below the floor. */
  readonly stopLossPips: number | null;
  /** Empirical Take_Profit in pips (Component 15), or `null` when below the floor. */
  readonly takeProfitPips: number | null;
  /** True for a rendered card; false for a non-firing / suppressed pair. */
  readonly surfaced: boolean;
  /** Why a non-surfaced pair stayed silent, or `null` when surfaced. */
  readonly suppressionReason: SuppressionReason | null;
}

/**
 * Storage PORT for the `firing_setups` table (Requirements 21, 17.1). The
 * dashboard persistence depends only on this port, never on Supabase directly,
 * keeping compute independent of storage. Implementations upsert by the SQL
 * composite primary key (decision_date, pair) so re-running a day is idempotent.
 */
export interface FiringSetupStore {
  /** Upsert one firing-setup row, keyed by (decisionDate, pair). */
  upsert(row: FiringSetupRow): Promise<void>;
  /** Read a single row by its composite key, or null when absent. */
  get(decisionDate: TradingDate, pair: Pair): Promise<FiringSetupRow | null>;
  /** Read every row recorded for a Decision_Date (order unspecified). */
  getByDecisionDate(decisionDate: TradingDate): Promise<readonly FiringSetupRow[]>;
}

/** Composite-key string used by the in-memory store (mirrors the SQL PK). */
function rowKey(decisionDate: TradingDate, pair: Pair): string {
  return `${decisionDate}|${pair}`;
}

/**
 * In-memory reference implementation of {@link FiringSetupStore}.
 *
 * Deterministic and dependency-free; upserts by the same composite key as the
 * SQL primary key (decision_date, pair), so re-persisting the same key replaces
 * the row rather than duplicating it. Serves as the reference for the Supabase
 * adapter and lets the persistence flow run offline.
 */
export class InMemoryFiringSetupStore implements FiringSetupStore {
  readonly #rows = new Map<string, FiringSetupRow>();

  constructor(initial: readonly FiringSetupRow[] = []) {
    for (const row of initial) {
      this.#rows.set(rowKey(row.decisionDate, row.pair), row);
    }
  }

  upsert(row: FiringSetupRow): Promise<void> {
    this.#rows.set(rowKey(row.decisionDate, row.pair), row);
    return Promise.resolve();
  }

  get(decisionDate: TradingDate, pair: Pair): Promise<FiringSetupRow | null> {
    return Promise.resolve(this.#rows.get(rowKey(decisionDate, pair)) ?? null);
  }

  getByDecisionDate(decisionDate: TradingDate): Promise<readonly FiringSetupRow[]> {
    const rows = [...this.#rows.values()].filter((r) => r.decisionDate === decisionDate);
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

/**
 * Options for {@link persistFiringSetups}.
 */
export interface PersistFiringSetupsOptions {
  /**
   * The dashboard configuration used for the run (defaults to the standard
   * config). Only used to keep the derivation aligned with `dailyRun`; the
   * DashboardView already reflects the applied firing decisions.
   */
  readonly config?: DashboardConfig;
}

/**
 * Classify the deterministic firing/suppression outcome of a single pair into a
 * `firing_setups` row, using the dashboard's own decisions (its rendered cards)
 * plus the pair's evaluation inputs.
 *
 * Precedence for a NON-surfaced pair mirrors the firing test in `dailyRun`:
 *   1. confidence below threshold / FLAT direction → 'not_fired',
 *   2. below-floor boundaries on a pair that otherwise fired → 'below_floor'.
 *
 * There is no suppression step: the news suppressor and the Gate_Auto_Block
 * have been removed (Requirements 3.4, 3.5), so there is no 'news' outcome. The
 * Choppiness_Guard is no longer a suppressor (Requirement 3.1) and the
 * Currency_Concentration_Guard has likewise been removed (Requirement 3.3), so
 * there is no 'too_choppy' or 'currency_concentration' outcome; the
 * Choppiness_Metric is a displayed field instead.
 */
function classifyPair(
  pair: Pair,
  evaluation: PairEvaluation | undefined,
  surfacedPairs: ReadonlySet<Pair>,
  confidenceThreshold: number,
): { surfaced: boolean; reason: SuppressionReason | null } {
  // (1) Surfaced: the dashboard rendered a card for this pair.
  if (surfacedPairs.has(pair)) {
    return { surfaced: true, reason: null };
  }

  // From here the pair did NOT surface. Attribute the reason from its
  // evaluation inputs, mirroring the firing test.
  if (!evaluation) {
    // No evaluation provided for this pair ⇒ treated as non-firing (Req 16.1).
    return { surfaced: false, reason: "not_fired" };
  }

  // (2) Did the pair satisfy both firing conditions? If not → not_fired (the
  // explicit "no trade" observation, Requirement 3.5).
  if (!fires(evaluation, confidenceThreshold)) {
    return { surfaced: false, reason: "not_fired" };
  }

  // (3) It fired but is absent from the rendered cards: the only remaining
  // reason is non-actionable empirical boundaries below the 30-analogue floor
  // (Requirement 21.5).
  return { surfaced: false, reason: "below_floor" };
}

/**
 * Persist the per-pair firing / suppression outcomes for a Decision_Date to
 * `firing_setups`, one row per pair keyed by (decision_date, pair)
 * (Requirement 21).
 *
 * Every one of the five pairs is written: surfaced pairs carry `surfaced = true`
 * and a null suppression reason; every other pair carries `surfaced = false`
 * and the reason it stayed silent ('below_floor' or 'not_fired').
 * The upsert is idempotent on the composite key, so re-running the same
 * Decision_Date replaces rows rather than duplicating them.
 *
 * The derivation reuses the dashboard's OWN decisions — its rendered cards —
 * together with the same `PairEvaluation` inputs `dailyRun` consumed. It never
 * re-implements the firing logic and takes no LLM input.
 *
 * @param store        The `firing_setups` storage PORT (Supabase adapter in
 *                     prod, in-memory reference in tests).
 * @param view         The DashboardView produced by `dailyRun` for this date.
 * @param evaluations  The per-pair deterministic evaluations passed to
 *                     `dailyRun`; used to attribute suppression reasons.
 * @param options      Optional config.
 * @returns The rows that were persisted, in canonical PAIRS order.
 */
export async function persistFiringSetups(
  store: FiringSetupStore,
  view: DashboardView,
  evaluations: readonly PairEvaluation[],
  options: PersistFiringSetupsOptions = {},
): Promise<readonly FiringSetupRow[]> {
  const config = options.config ?? DEFAULT_DASHBOARD_CONFIG;

  // Index the dashboard's own decisions and the pair evaluations by pair.
  const byPair = new Map<Pair, PairEvaluation>();
  for (const evaluation of evaluations) byPair.set(evaluation.pair, evaluation);

  const cardsByPair = new Map<Pair, DashboardView["cards"][number]>();
  const surfacedPairs = new Set<Pair>();
  for (const card of view.cards) {
    cardsByPair.set(card.pair, card);
    surfacedPairs.add(card.pair);
  }

  const rows: FiringSetupRow[] = [];

  // Iterate the canonical PAIRS order so the persisted set is deterministic and
  // covers all five pairs, even those absent from the input (treated as
  // non-firing, Requirement 16.1).
  for (const pair of PAIRS) {
    const evaluation = byPair.get(pair);
    const card = cardsByPair.get(pair);
    const { surfaced, reason } = classifyPair(
      pair,
      evaluation,
      surfacedPairs,
      config.confidenceThreshold,
    );

    // Prefer the rendered card's values when surfaced; otherwise fall back to
    // the evaluation inputs. Direction/horizon always come from the
    // deterministic source; a pair with no evaluation and no card records a
    // neutral FLAT/horizon-1 placeholder (it never surfaces).
    const source = card ?? evaluation;
    const direction: DirectionClass = source?.direction ?? "FLAT";
    const horizon: 1 | 2 | 3 = source?.horizon ?? 1;
    const earnedConfidence = source?.earnedConfidence ?? 0;
    const stopLossPips = source?.stopLossPips ?? null;
    const takeProfitPips = source?.takeProfitPips ?? null;

    const row: FiringSetupRow = {
      decisionDate: view.decisionDate,
      pair,
      direction,
      horizon,
      earnedConfidence,
      stopLossPips,
      takeProfitPips,
      surfaced,
      suppressionReason: reason,
    };

    // Idempotent per-key upserts; sequential writes keep the port simple and
    // the ordering deterministic.
    await store.upsert(row);
    rows.push(row);
  }

  return rows;
}
