// IntradayValidationStore PORT + in-memory reference — Task 5
// (intraday-validation feature).
//
// Follows the project's storage-port convention: a thin interface with an
// in-memory reference implementation here (deterministic, no I/O) and a
// Supabase adapter in `src/storage/supabase/`. The validation layer writes ONLY
// through this port and ONLY to its own `intraday_validations` collection; it
// never touches `firing_setups`, `pattern_vectors`, `analogue_outcomes`, or any
// other daily-path table.

import type { TradingDate } from "../guard/types.js";
import type { IntradayValidationRecord } from "./types.js";

/**
 * The IntradayValidationStore PORT. Records are keyed by `(decisionDate, pair)`
 * so a validation record is unambiguously tied to one original daily prediction.
 */
export interface IntradayValidationStore {
  /** Idempotent upsert keyed by `(decisionDate, pair)`. */
  upsert(records: readonly IntradayValidationRecord[]): Promise<void>;
  /** Read every validation record for a Decision_Date. */
  getByDecisionDate(decisionDate: TradingDate): Promise<readonly IntradayValidationRecord[]>;
  /** Read every recorded validation (optionally within a Decision_Date window). */
  getAll(from?: TradingDate, to?: TradingDate): Promise<readonly IntradayValidationRecord[]>;
}

/** In-memory reference implementation (deterministic; used in tests). */
export class InMemoryIntradayValidationStore implements IntradayValidationStore {
  // Key format: `${decisionDate}:${pair}`.
  readonly #store = new Map<string, IntradayValidationRecord>();

  upsert(records: readonly IntradayValidationRecord[]): Promise<void> {
    for (const record of records) {
      this.#store.set(`${record.decisionDate}:${record.pair}`, record);
    }
    return Promise.resolve();
  }

  getByDecisionDate(decisionDate: TradingDate): Promise<readonly IntradayValidationRecord[]> {
    const out = [...this.#store.values()]
      .filter((r) => r.decisionDate === decisionDate)
      .sort((a, b) => a.pair.localeCompare(b.pair));
    return Promise.resolve(out);
  }

  getAll(from?: TradingDate, to?: TradingDate): Promise<readonly IntradayValidationRecord[]> {
    const out = [...this.#store.values()]
      .filter(
        (r) =>
          (from === undefined || r.decisionDate >= from) &&
          (to === undefined || r.decisionDate <= to),
      )
      .sort((a, b) =>
        a.decisionDate === b.decisionDate
          ? a.pair.localeCompare(b.pair)
          : a.decisionDate.localeCompare(b.decisionDate),
      );
    return Promise.resolve(out);
  }

  clear(): void {
    this.#store.clear();
  }
}
