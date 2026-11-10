// Adapter from a fetched hourly batch to the archive store.
import type { HourlyBar } from "../ingestion/sessionAggregation.js";
import type { Pair } from "../ingestion/types.js";
import type { HourlyBarStore } from "./types.js";

/** Build an observer that archives every batch to `store`, tagging bars with `source`. */
export function hourlyArchiver(
  store: HourlyBarStore,
  source: string,
): (pair: Pair, bars: readonly HourlyBar[]) => Promise<void> {
  return async (pair, bars) => {
    await store.upsert(
      bars.map((b) => ({ pair, openMs: b.openMs, open: b.open, high: b.high, low: b.low, close: b.close, source })),
    );
  };
}
