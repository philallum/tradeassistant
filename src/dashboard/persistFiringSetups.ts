// Persist per-pair firing / suppression outcomes to `firing_setups` —
// Design Component 11 storage (Requirements 21, 22, 25.1, 17.1).
//
// After `dailyRun()` produces a DashboardView for a Decision_Date, this module
// records ONE `firing_setups` row per pair, keyed by (decision_date, pair,
// strategy_id) — the composite primary key introduced by the strategy-attribution
// follow-up migration (Requirement 25.1). It writes the deterministic outcome of
// each pair's firing decision and the Currency Concentration Guard:
//
//   - `surfaced` is true for the rendered FiringCards, false for every pair that
//     did not fire or that a suppressor removed (Requirement 16.2).
//   - `suppression_reason` records WHY a non-surfaced pair stayed silent:
//     'news' (news filter), 'currency_concentration' (guard, with the competing
//     pairs that outranked it), 'below_floor' (empirical boundaries not
//     actionable), or 'not_fired' (gate/confidence/FLAT). See the SQL check
//     constraint on `firing_setups.suppression_reason` (Requirements 22.3, 21.5).
//   - direction / horizon / earned_confidence / stop_loss_pips / take_profit_pips
//     carry the deterministic values; boundaries are `null` when not actionable
//     (Requirements 21.4, 21.5).
//
// Compute/storage separation (Requirement 17.1): persistence goes through the
// `FiringSetupStore` PORT, never a Supabase client directly, mirroring the
// storage-port + in-memory reference pattern used across the codebase (e.g.
// `FeatureRegistryStore`, `CalendarEventStore`, `AnalogueStore`). The upsert is
// idempotent on the composite key, so re-running the same Decision_Date replaces
// rather than duplicates rows.
//
// This module is part of the DETERMINISTIC CORE: it derives every persisted value
// from the same typed `PairEvaluation` inputs the dashboard consumed and from the
// dashboard's own `DashboardView` — it never re-implements the firing or guard
// logic, and it takes NO LLM input (the outward-only rationale/labels are not
// persisted here).

import type { Pair } from "../ingestion/types.js";
import { PAIRS } from "../ingestion/types.js";
import type { TradingDate } from "../guard/types.js";
import type { DirectionClass } from "../retrieval/types.js";
import type { PairEvaluation } from "./dashboard.js";
import { DEFAULT_DASHBOARD_CONFIG, type DashboardConfig, type DashboardView } from "./types.js";

/** The Strategy_Source for the v1 deterministic system (Requirement 25.1). */
export const SYSTEM_STRATEGY_ID = "system" as const;

/**
 * The reasons a non-surfaced pair stayed silent, matching the
 * `firing_setups.suppression_reason` SQL check constraint. `null` accompanies a
 * surfaced pair (Requirements 22.3, 21.5, 16.6, 16.2).
 *
 * 'too_choppy' is recorded for a pair the Choppiness Volatility Silence Guard
 * hard-vetoed (Component 18, Requirement 24); it is read from the DashboardView's
 * own suppressions, and may also be supplied via a {@link PairOutcomeOverride}
 * for an out-of-band suppressor.
 */
export type SuppressionReason =
  | "news"
  | "currency_concentration"
  | "below_floor"
  | "not_fired"
  | "too_choppy";

/**
 * A single `firing_setups` row (Requirements 21, 22, 25.1). Field names mirror
 * the SQL columns; every value is deterministic (no LLM-derived field).
 */
export interface FiringSetupRow {
  /** Strategy_Source attribution; v1 deterministic system = 'system' (Req 25.1). */
  readonly strategyId: string;
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
  /**
   * For a `currency_concentration` suppression, the aligned same-currency pairs
   * that outranked this one (Requirement 22.3); otherwise empty.
   */
  readonly competingPairs: readonly Pair[];
}

/**
 * Storage PORT for the `firing_setups` table (Requirements 21, 22, 17.1). The
 * dashboard persistence depends only on this port, never on Supabase directly,
 * keeping compute independent of storage. Implementations upsert by the SQL
 * composite primary key (decision_date, pair, strategy_id) so re-running a day
 * is idempotent (Requirement 25.1).
 */
export interface FiringSetupStore {
  /** Upsert one firing-setup row, keyed by (decisionDate, pair, strategyId). */
  upsert(row: FiringSetupRow): Promise<void>;
  /** Read a single row by its composite key, or null when absent. */
  get(
    decisionDate: TradingDate,
    pair: Pair,
    strategyId: string,
  ): Promise<FiringSetupRow | null>;
  /** Read every row recorded for a Decision_Date (order unspecified). */
  getByDecisionDate(decisionDate: TradingDate): Promise<readonly FiringSetupRow[]>;
}

/** Composite-key string used by the in-memory store (mirrors the SQL PK). */
function rowKey(decisionDate: TradingDate, pair: Pair, strategyId: string): string {
  return `${decisionDate}|${pair}|${strategyId}`;
}

/**
 * In-memory reference implementation of {@link FiringSetupStore}.
 *
 * Deterministic and dependency-free; upserts by the same composite key as the
 * SQL primary key (decision_date, pair, strategy_id), so re-persisting the same
 * key replaces the row rather than duplicating it. Serves as the reference for
 * the Supabase adapter and lets the persistence flow run offline.
 */
export class InMemoryFiringSetupStore implements FiringSetupStore {
  readonly #rows = new Map<string, FiringSetupRow>();

  constructor(initial: readonly FiringSetupRow[] = []) {
    for (const row of initial) {
      this.#rows.set(rowKey(row.decisionDate, row.pair, row.strategyId), row);
    }
  }

  upsert(row: FiringSetupRow): Promise<void> {
    this.#rows.set(rowKey(row.decisionDate, row.pair, row.strategyId), row);
    return Promise.resolve();
  }

  get(
    decisionDate: TradingDate,
    pair: Pair,
    strategyId: string,
  ): Promise<FiringSetupRow | null> {
    return Promise.resolve(this.#rows.get(rowKey(decisionDate, pair, strategyId)) ?? null);
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
 * An optional per-pair suppression override supplied by an additional
 * suppressor that runs outside `dailyRun` (e.g. the choppiness suppressor from
 * Component 18, task 10.x). When a caller marks a pair here, its row is written
 * as non-surfaced with the given reason regardless of how the pair would
 * otherwise classify. Only the reasons an out-of-band suppressor legitimately
 * produces are accepted.
 */
export interface PairOutcomeOverride {
  readonly pair: Pair;
  readonly reason: "too_choppy";
}

/**
 * Options for {@link persistFiringSetups}.
 */
export interface PersistFiringSetupsOptions {
  /**
   * The dashboard configuration used for the run (defaults to the standard
   * config). Only used to keep the derivation aligned with `dailyRun`; the
   * DashboardView already reflects the applied firing/guard decisions.
   */
  readonly config?: DashboardConfig;
  /**
   * Strategy_Source attribution for these rows; defaults to the v1 deterministic
   * system, `'system'` (Requirement 25.1).
   */
  readonly strategyId?: string;
  /**
   * Out-of-band suppression overrides (e.g. choppiness) applied to pairs that
   * would otherwise be recorded as fired/surfaced or as another suppression.
   */
  readonly overrides?: readonly PairOutcomeOverride[];
}

/**
 * Classify the deterministic firing/suppression outcome of a single pair into a
 * `firing_setups` row, using the dashboard's own decisions (its rendered cards
 * and currency-concentration suppressions) plus the pair's evaluation inputs.
 *
 * Precedence for a NON-surfaced pair mirrors the pipeline order in `dailyRun`:
 *   1. news suppression (checked first — it vetoes before the firing test),
 *   2. gate / confidence / FLAT → 'not_fired',
 *   3. currency-concentration guard → 'currency_concentration' (+ competing pairs),
 *   4. choppiness guard → 'too_choppy',
 *   5. below-floor boundaries on a pair that otherwise fired → 'below_floor'.
 * An explicit override (e.g. 'too_choppy') takes precedence over all of these.
 */
function classifyPair(
  pair: Pair,
  evaluation: PairEvaluation | undefined,
  surfacedPairs: ReadonlySet<Pair>,
  suppressedByGuard: ReadonlyMap<Pair, readonly Pair[]>,
  choppyPairs: ReadonlySet<Pair>,
  override: PairOutcomeOverride | undefined,
  confidenceThreshold: number,
): { surfaced: boolean; reason: SuppressionReason | null; competingPairs: readonly Pair[] } {
  // (0) Out-of-band suppression override (e.g. choppiness) wins outright.
  if (override) {
    return { surfaced: false, reason: override.reason, competingPairs: [] };
  }

  // (1) Surfaced: the dashboard rendered a card for this pair.
  if (surfacedPairs.has(pair)) {
    return { surfaced: true, reason: null, competingPairs: [] };
  }

  // (2) Currency Concentration Guard suppression — it fired but was de-duplicated.
  const competing = suppressedByGuard.get(pair);
  if (competing) {
    return { surfaced: false, reason: "currency_concentration", competingPairs: competing };
  }

  // (3) Choppiness Volatility Silence Guard suppression — it fired and survived
  // the concentration guard but was hard-vetoed as too choppy (Requirement 24).
  if (choppyPairs.has(pair)) {
    return { surfaced: false, reason: "too_choppy", competingPairs: [] };
  }

  // From here the pair did NOT surface and was not guard-suppressed. Attribute
  // the reason from its evaluation inputs, in pipeline order.
  if (!evaluation) {
    // No evaluation provided for this pair ⇒ treated as non-firing (Req 16.1).
    return { surfaced: false, reason: "not_fired", competingPairs: [] };
  }

  // (3) News suppression is a hard veto checked before the firing decision.
  if (evaluation.newsSuppressed) {
    return { surfaced: false, reason: "news", competingPairs: [] };
  }

  // (4) Did the pair satisfy all three firing conditions? If not → not_fired.
  const wouldFire =
    evaluation.gatePassing &&
    evaluation.direction !== "FLAT" &&
    evaluation.earnedConfidence >= confidenceThreshold;
  if (!wouldFire) {
    return { surfaced: false, reason: "not_fired", competingPairs: [] };
  }

  // (5) It fired and survived the guard but is absent from the rendered cards:
  // the only remaining reason is non-actionable empirical boundaries below the
  // 30-analogue floor (Requirement 21.5).
  return { surfaced: false, reason: "below_floor", competingPairs: [] };
}

/**
 * Persist the per-pair firing / suppression outcomes for a Decision_Date to
 * `firing_setups`, one row per pair keyed by (decision_date, pair, strategy_id)
 * (Requirements 21, 22, 25.1).
 *
 * Every one of the five pairs is written: surfaced pairs carry `surfaced = true`
 * and a null suppression reason; every other pair carries `surfaced = false`
 * and the reason it stayed silent ('news', 'currency_concentration' with its
 * competing pairs, 'below_floor', 'not_fired', or an override 'too_choppy').
 * The upsert is idempotent on the composite key, so re-running the same
 * Decision_Date replaces rows rather than duplicating them.
 *
 * The derivation reuses the dashboard's OWN decisions — its rendered cards and
 * its currency-concentration suppressions — together with the same
 * `PairEvaluation` inputs `dailyRun` consumed. It never re-implements the firing
 * or guard logic and takes no LLM input.
 *
 * @param store        The `firing_setups` storage PORT (Supabase adapter in
 *                     prod, in-memory reference in tests).
 * @param view         The DashboardView produced by `dailyRun` for this date.
 * @param evaluations  The per-pair deterministic evaluations passed to
 *                     `dailyRun`; used to attribute suppression reasons.
 * @param options      Optional config, strategy id, and out-of-band overrides.
 * @returns The rows that were persisted, in canonical PAIRS order.
 */
export async function persistFiringSetups(
  store: FiringSetupStore,
  view: DashboardView,
  evaluations: readonly PairEvaluation[],
  options: PersistFiringSetupsOptions = {},
): Promise<readonly FiringSetupRow[]> {
  const config = options.config ?? DEFAULT_DASHBOARD_CONFIG;
  const strategyId = options.strategyId ?? SYSTEM_STRATEGY_ID;

  // Index the dashboard's own decisions and the pair evaluations by pair.
  const byPair = new Map<Pair, PairEvaluation>();
  for (const evaluation of evaluations) byPair.set(evaluation.pair, evaluation);

  const cardsByPair = new Map<Pair, DashboardView["cards"][number]>();
  const surfacedPairs = new Set<Pair>();
  for (const card of view.cards) {
    cardsByPair.set(card.pair, card);
    surfacedPairs.add(card.pair);
  }

  const suppressedByGuard = new Map<Pair, readonly Pair[]>();
  const choppyPairs = new Set<Pair>();
  for (const suppressed of view.suppressed) {
    if (suppressed.reason === "currency_concentration") {
      suppressedByGuard.set(suppressed.pair, suppressed.competingPairs);
    } else if (suppressed.reason === "too_choppy") {
      choppyPairs.add(suppressed.pair);
    }
  }

  const overrideByPair = new Map<Pair, PairOutcomeOverride>();
  for (const override of options.overrides ?? []) overrideByPair.set(override.pair, override);

  const rows: FiringSetupRow[] = [];

  // Iterate the canonical PAIRS order so the persisted set is deterministic and
  // covers all five pairs, even those absent from the input (treated as
  // non-firing, Requirement 16.1).
  for (const pair of PAIRS) {
    const evaluation = byPair.get(pair);
    const card = cardsByPair.get(pair);
    const { surfaced, reason, competingPairs } = classifyPair(
      pair,
      evaluation,
      surfacedPairs,
      suppressedByGuard,
      choppyPairs,
      overrideByPair.get(pair),
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
      strategyId,
      decisionDate: view.decisionDate,
      pair,
      direction,
      horizon,
      earnedConfidence,
      stopLossPips,
      takeProfitPips,
      surfaced,
      suppressionReason: reason,
      competingPairs,
    };

    // Idempotent per-key upserts; sequential writes keep the port simple and
    // the ordering deterministic.
    await store.upsert(row);
    rows.push(row);
  }

  return rows;
}
