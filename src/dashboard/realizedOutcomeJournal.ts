// Realized-Outcome Journal with Strategy_Source attribution — Design Component 19
// (Requirements 25.1, 25.2, 25.3, 25.4, 25.7, 17.1).
//
// This module records the growing predicted-versus-actual corpus. For each fired
// setup it writes ONE `realized_outcomes` row keyed by (strategyId, pair,
// decisionDate) pairing what a Strategy_Source predicted (direction, selected
// horizon, Earned_Confidence, empirical Stop_Loss/Take_Profit) with the actual
// matured forward outcome (terminal Direction_Class and MFE/MAE) — but ONLY once
// the setup's Horizon window has closed.
//
// Look-ahead safety (Requirements 25.3, 4.2). The realized side is populated
// EXCLUSIVELY from matured forward outcomes derived from candles dated strictly
// after the Decision_Date, gated by the shared Look-Ahead Guard (`isMatured`).
// Before its window closes an entry is recorded predicted-only with
// `matured = false` and no realized fields; nothing about the future leaks in.
//
// Extension seam / scoring isolation (Requirements 25.4, 25.6). The journal is a
// SEPARATE consumer of shared storage. It reads deterministic inputs the pipeline
// already produced (firing setups + resolved forward outcomes) and appends its own
// rows; it NEVER feeds the directional probability, Earned_Confidence, retrieval,
// or the Kill_Gate verdict. Recording a journal entry therefore leaves every v1
// computation byte-for-byte identical. It takes NO LLM input.
//
// Idempotency (Requirement 25.7). The upsert is keyed on the SQL primary key
// (strategy_id, pair, decision_date), so re-running maturation for the same setup
// UPDATES in place rather than duplicating — a day can be re-run any number of
// times with the same stored result.

import { isMatured } from "../guard/lookAheadGuard.js";
import type { TradingDate } from "../guard/types.js";
import type { Pair } from "../ingestion/types.js";
import type { DirectionClass, ForwardOutcome } from "../retrieval/types.js";
import { SYSTEM_STRATEGY_ID } from "./persistFiringSetups.js";

/**
 * Strategy_Source identifier (Requirement 25.1). The v1 deterministic pattern
 * system uses the default `"system"`; `"llm"` and `"algo"` are reserved for
 * future strategies. The open `(string & {})` arm keeps the union extensible
 * without losing autocomplete on the known values.
 */
export type StrategyId = "system" | "llm" | "algo" | (string & {});

/**
 * A single `realized_outcomes` row — the predicted-versus-actual pairing for one
 * fired setup (Design Component 19, Requirement 25). Field names mirror the SQL
 * columns. Every value is deterministic; no LLM-derived field appears here.
 *
 * The predicted side (direction, horizon, confidence, boundaries) is always
 * present. The realized side (`realizedDirection`, `realizedMfePips`,
 * `realizedMaePips`) is filled ONLY once the Horizon window has matured
 * (Requirements 25.2, 25.3); until then it is undefined and `matured` is false.
 */
export interface RealizedOutcomeEntry {
  /** Strategy_Source attribution; v1 deterministic system = 'system' (Req 25.1). */
  readonly strategyId: StrategyId;
  readonly pair: Pair;
  /** The date the setup fired. */
  readonly decisionDate: TradingDate;
  /** What was predicted for the setup. */
  readonly predictedDirection: DirectionClass;
  readonly horizon: 1 | 2 | 3;
  readonly earnedConfidence: number;
  /** Empirical Stop_Loss in pips as surfaced, or `null` when below the floor. */
  readonly stopLossPips: number | null;
  /** Empirical Take_Profit in pips as surfaced, or `null` when below the floor. */
  readonly takeProfitPips: number | null;
  /** Terminal Direction_Class of the matured outcome; undefined until matured (Req 25.2, 25.3). */
  readonly realizedDirection?: DirectionClass;
  /** Maximum favorable excursion in pips of the matured outcome; undefined until matured. */
  readonly realizedMfePips?: number;
  /** Maximum adverse excursion in pips of the matured outcome; undefined until matured. */
  readonly realizedMaePips?: number;
  /** True once the horizon window has closed and the realized side is populated (Req 25.3). */
  readonly matured: boolean;
}

/**
 * Storage PORT for the `realized_outcomes` table (Requirement 25, 17.1). The
 * journal depends only on this port, never on Supabase directly, mirroring the
 * storage-port + in-memory reference pattern used across the codebase (e.g.
 * `FiringSetupStore`, `AnalogueStore`). Implementations upsert by the SQL
 * composite primary key (strategy_id, pair, decision_date) so re-running a day
 * is idempotent (Requirement 25.7).
 */
export interface RealizedOutcomeStore {
  /** Upsert one journal entry, keyed by (strategyId, pair, decisionDate). */
  upsert(entry: RealizedOutcomeEntry): Promise<void>;
  /** Read a single entry by its composite key, or null when absent. */
  get(
    strategyId: StrategyId,
    pair: Pair,
    decisionDate: TradingDate,
  ): Promise<RealizedOutcomeEntry | null>;
  /** Read every entry recorded for a Decision_Date (order unspecified). */
  getByDecisionDate(decisionDate: TradingDate): Promise<readonly RealizedOutcomeEntry[]>;
}

/** Composite-key string used by the in-memory store (mirrors the SQL PK). */
function entryKey(strategyId: StrategyId, pair: Pair, decisionDate: TradingDate): string {
  return `${strategyId}|${pair}|${decisionDate}`;
}

/**
 * In-memory reference implementation of {@link RealizedOutcomeStore}.
 *
 * Deterministic and dependency-free; upserts by the same composite key as the
 * SQL primary key (strategy_id, pair, decision_date), so re-persisting the same
 * key REPLACES the entry rather than duplicating it (Requirement 25.7). Serves as
 * the reference for the Supabase adapter and lets the journaling flow run offline.
 */
export class InMemoryRealizedOutcomeStore implements RealizedOutcomeStore {
  readonly #entries = new Map<string, RealizedOutcomeEntry>();

  constructor(initial: readonly RealizedOutcomeEntry[] = []) {
    for (const entry of initial) {
      this.#entries.set(entryKey(entry.strategyId, entry.pair, entry.decisionDate), entry);
    }
  }

  upsert(entry: RealizedOutcomeEntry): Promise<void> {
    this.#entries.set(entryKey(entry.strategyId, entry.pair, entry.decisionDate), entry);
    return Promise.resolve();
  }

  get(
    strategyId: StrategyId,
    pair: Pair,
    decisionDate: TradingDate,
  ): Promise<RealizedOutcomeEntry | null> {
    return Promise.resolve(this.#entries.get(entryKey(strategyId, pair, decisionDate)) ?? null);
  }

  getByDecisionDate(decisionDate: TradingDate): Promise<readonly RealizedOutcomeEntry[]> {
    const entries = [...this.#entries.values()].filter((e) => e.decisionDate === decisionDate);
    return Promise.resolve(entries);
  }

  /** Test/inspection helper: total number of entries currently held. */
  size(): number {
    return this.#entries.size;
  }

  clear(): void {
    this.#entries.clear();
  }
}

/**
 * The predicted side of a fired setup to journal (Requirement 25.2). These are
 * the deterministic values the setup fired with — mirroring the surfaced
 * `firing_setups` row / `FiringCard` — never re-derived here.
 */
export interface FiredSetupPrediction {
  readonly pair: Pair;
  readonly predictedDirection: DirectionClass;
  readonly horizon: 1 | 2 | 3;
  readonly earnedConfidence: number;
  readonly stopLossPips: number | null;
  readonly takeProfitPips: number | null;
}

/**
 * Options for {@link journalRealizedOutcomes}.
 */
export interface JournalRealizedOutcomesOptions {
  /**
   * Strategy_Source attribution for these entries; defaults to the v1
   * deterministic system, `'system'` (Requirement 25.1).
   */
  readonly strategyId?: StrategyId;
  /**
   * Resolved forward outcomes per pair, keyed by Pair. Supplied by the
   * forward-outcome resolver (`resolve`, Component 4). The realized side is read
   * from the entry's SELECTED horizon and written ONLY when that horizon has
   * matured as of `evalDate`. A pair absent from this map (or whose horizon has
   * not matured) is journaled predicted-only with `matured = false`.
   */
  readonly forwardOutcomes?: ReadonlyMap<Pair, ForwardOutcome>;
}

/**
 * Build the journal entry for a single fired setup, pairing its prediction with
 * the matured forward outcome when — and only when — its selected Horizon window
 * has closed as of `evalDate` (Requirements 25.2, 25.3).
 *
 * Look-ahead safety is enforced by the shared Look-Ahead Guard's `isMatured`
 * (Requirement 4.2): the realized side is populated only for a matured horizon,
 * and the resolver that produced `forwardOutcome` already used only candles
 * dated strictly after the Decision_Date. Before maturation the entry carries
 * the prediction alone with `matured = false` and no realized fields.
 */
function buildEntry(
  strategyId: StrategyId,
  decisionDate: TradingDate,
  evalDate: TradingDate,
  prediction: FiredSetupPrediction,
  forwardOutcome: ForwardOutcome | undefined,
): RealizedOutcomeEntry {
  const base = {
    strategyId,
    pair: prediction.pair,
    decisionDate,
    predictedDirection: prediction.predictedDirection,
    horizon: prediction.horizon,
    earnedConfidence: prediction.earnedConfidence,
    stopLossPips: prediction.stopLossPips,
    takeProfitPips: prediction.takeProfitPips,
  } as const;

  // The realized side is admitted ONLY once the selected horizon window has
  // closed as of evalDate (Look-Ahead Guard, Requirements 25.3, 4.2).
  const matured = isMatured(decisionDate, prediction.horizon, evalDate);
  if (!matured || !forwardOutcome) {
    return { ...base, matured: false };
  }

  const horizonOutcome = forwardOutcome.perHorizon[prediction.horizon];
  return {
    ...base,
    matured: true,
    realizedDirection: horizonOutcome.direction,
    realizedMfePips: horizonOutcome.mfePips,
    realizedMaePips: horizonOutcome.maePips,
  };
}

/**
 * Journal the realized outcomes for a set of fired setups on a Decision_Date to
 * `realized_outcomes`, one entry per fired setup keyed by (strategyId, pair,
 * decisionDate) (Design Component 19, Requirement 25).
 *
 * Each entry records the setup's prediction; its realized forward outcome
 * (terminal Direction_Class + MFE/MAE at the selected Horizon) is filled ONLY
 * once that Horizon window has closed as of `evalDate` — populated exclusively
 * from the resolver's matured forward outcome (candles strictly after the
 * Decision_Date) via the shared Look-Ahead Guard (Requirements 25.2, 25.3, 4.2).
 *
 * The upsert is idempotent on the composite key, so re-running the same
 * Decision_Date (for example on a later `evalDate` once the window has matured)
 * UPDATES the entry in place rather than duplicating it (Requirement 25.7).
 *
 * This is a separate consumer of shared storage: it reads only deterministic
 * values the pipeline already produced and appends its own rows. It NEVER feeds
 * the directional probability, Earned_Confidence, retrieval, or the Kill_Gate
 * verdict, so recording it leaves every v1 computation unchanged (Requirement
 * 25.4). It takes NO LLM input.
 *
 * @param store       The `realized_outcomes` storage PORT (Supabase adapter in
 *                    prod, in-memory reference in tests).
 * @param decisionDate The Decision_Date the setups fired on.
 * @param evalDate    The current evaluation date — determines whether each
 *                    setup's Horizon window has matured.
 * @param predictions The fired setups' predictions to journal (one per pair).
 * @param options     Optional strategy id and resolved forward outcomes.
 * @returns The entries that were persisted, in the input order.
 */
export async function journalRealizedOutcomes(
  store: RealizedOutcomeStore,
  decisionDate: TradingDate,
  evalDate: TradingDate,
  predictions: readonly FiredSetupPrediction[],
  options: JournalRealizedOutcomesOptions = {},
): Promise<readonly RealizedOutcomeEntry[]> {
  const strategyId = options.strategyId ?? SYSTEM_STRATEGY_ID;
  const forwardOutcomes = options.forwardOutcomes;

  const entries: RealizedOutcomeEntry[] = [];
  for (const prediction of predictions) {
    const entry = buildEntry(
      strategyId,
      decisionDate,
      evalDate,
      prediction,
      forwardOutcomes?.get(prediction.pair),
    );
    // Idempotent per-key upserts; sequential writes keep the port simple and
    // the ordering deterministic.
    await store.upsert(entry);
    entries.push(entry);
  }

  return entries;
}
