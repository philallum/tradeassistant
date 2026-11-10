// Hourly bar archive (additive; never read by the live decision path).
//
// The daily candle is BUILT from hourly bars on the 17:00 America/New_York close and the hourly
// bars were then discarded. Keeping them lets an offline simulation answer the one question daily
// bars cannot: within a session, did price touch the stop or the target first?
//
// Pure types + an in-memory reference implementation. Nothing here feeds firing, confidence or
// scoring.
import type { Pair } from "../ingestion/types.js";

/** One archived hourly bar, stamped with the instant it OPENED (epoch ms, UTC). */
export interface HourlyBarRow {
  readonly pair: Pair;
  readonly openMs: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  /** Provenance tag (provider name), never a secret. */
  readonly source: string;
}

/** Storage port for the hourly archive. Keyed by `(pair, openMs)`; upserts are idempotent. */
export interface HourlyBarStore {
  upsert(rows: readonly HourlyBarRow[]): Promise<void>;
  /** Bars with `fromMs <= openMs < toMs`, ascending by `openMs`. */
  getRange(pair: Pair, fromMs: number, toMs: number): Promise<readonly HourlyBarRow[]>;
}

/** In-memory reference implementation (deterministic; used in tests and the offline harness). */
export class InMemoryHourlyBarStore implements HourlyBarStore {
  readonly #rows = new Map<string, HourlyBarRow>();

  upsert(rows: readonly HourlyBarRow[]): Promise<void> {
    for (const r of rows) this.#rows.set(`${r.pair}:${r.openMs}`, r);
    return Promise.resolve();
  }

  getRange(pair: Pair, fromMs: number, toMs: number): Promise<readonly HourlyBarRow[]> {
    const out = [...this.#rows.values()]
      .filter((r) => r.pair === pair && r.openMs >= fromMs && r.openMs < toMs)
      .sort((a, b) => a.openMs - b.openMs);
    return Promise.resolve(out);
  }

  get size(): number {
    return this.#rows.size;
  }
}
