// Analogue Retrieval and Forward-Outcome Resolver Types.
// Requirements 9.1–9.9, 4.2, 20.

import type { Pair } from "../ingestion/types.js";
import type { TradingDate } from "../guard/types.js";

/** Terminal direction class for a resolved forward outcome. (Requirement 10.5) */
export type DirectionClass = "UP" | "DOWN" | "FLAT";

/**
 * Per-horizon outcome for a single resolved analogue.
 * (Requirement 9.6)
 */
export interface HorizonOutcome {
  readonly direction: DirectionClass;
  /** Maximum favorable excursion in pips. */
  readonly mfePips: number;
  /** Maximum adverse excursion in pips. */
  readonly maePips: number;
}

/**
 * Full forward outcome across all three horizons.
 * Keys are 1 | 2 | 3 trading-day horizons. (Requirement 9.6)
 */
export type ForwardOutcome = {
  readonly perHorizon: {
    readonly 1: HorizonOutcome;
    readonly 2: HorizonOutcome;
    readonly 3: HorizonOutcome;
  };
};

/**
 * A stored analogue record (corresponds to a row in `analogue_outcomes`).
 * Requirements 9.5, 9.6.
 */
export interface AnalogueRecord {
  readonly asset: Pair;
  /** The analogue's own trading date (= the decision_date at which the pattern was encoded). */
  readonly decisionDate: TradingDate;
  readonly horizon: 1 | 2 | 3;
  readonly direction: DirectionClass;
  readonly mfePips: number;
  readonly maePips: number;
  /** ATR-14 at the analogue date — used for FLAT dead-band classification. */
  readonly atr14: number;
  /** True once the full horizon window has closed. (Requirement 4.2, 9.5) */
  readonly matured: boolean;
  /** Cosine distance to the query embedding, populated during retrieval. */
  readonly cosineDistance?: number;
}

/**
 * Configuration for retrieval. (Requirements 9.1, 9.8, 20.1)
 */
export interface RetrievalConfig {
  /** Maximum number of analogues to return. */
  readonly k: number;
  /** Similarity-radius cutoff: only analogues with cosineDistance <= epsilon are admitted. */
  readonly epsilon: number;
}

/**
 * The Analogue storage PORT. (Requirement 17.1)
 * Allows compute to run against any storage backend (in-memory, Supabase).
 */
export interface AnalogueStore {
  /**
   * Upsert an analogue outcome keyed by (asset, decision_date, horizon).
   * (Requirement 9.6)
   */
  upsertOutcome(record: AnalogueRecord): Promise<void>;

  /**
   * Retrieve all matured outcomes for an asset with decision_date < beforeDate.
   * (Requirements 9.3, 9.5)
   */
  getMaturedOutcomes(
    asset: Pair,
    beforeDate: TradingDate,
  ): Promise<readonly AnalogueRecord[]>;

  /**
   * Retrieve all outcomes for an asset and decisionDate (any maturity).
   */
  getOutcomes(
    asset: Pair,
    decisionDate: TradingDate,
  ): Promise<readonly AnalogueRecord[]>;
}

/**
 * In-memory AnalogueStore reference implementation.
 */
export class InMemoryAnalogueStore implements AnalogueStore {
  // Key: `${asset}:${decisionDate}:${horizon}`
  private readonly store = new Map<string, AnalogueRecord>();

  upsertOutcome(record: AnalogueRecord): Promise<void> {
    const key = `${record.asset}:${record.decisionDate}:${record.horizon}`;
    this.store.set(key, record);
    return Promise.resolve();
  }

  getMaturedOutcomes(
    asset: Pair,
    beforeDate: TradingDate,
  ): Promise<readonly AnalogueRecord[]> {
    const results: AnalogueRecord[] = [];
    for (const record of this.store.values()) {
      if (record.asset !== asset) continue;
      if (!record.matured) continue;
      if (record.decisionDate >= beforeDate) continue;
      results.push(record);
    }
    return Promise.resolve(
      results.sort((a, b) =>
        a.decisionDate.localeCompare(b.decisionDate) ||
        a.horizon - b.horizon,
      ),
    );
  }

  getOutcomes(
    asset: Pair,
    decisionDate: TradingDate,
  ): Promise<readonly AnalogueRecord[]> {
    const results: AnalogueRecord[] = [];
    for (const record of this.store.values()) {
      if (record.asset === asset && record.decisionDate === decisionDate) {
        results.push(record);
      }
    }
    return Promise.resolve(results.sort((a, b) => a.horizon - b.horizon));
  }

  clear(): void {
    this.store.clear();
  }
}
