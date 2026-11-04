// Read-through memoisation of matured analogue outcomes for the replay.
//
// Replaying the forecast over ~20 past dates x 5 pairs would otherwise re-read the
// same pair-wide matured-outcome table 100 times. `getMaturedOutcomes(asset, X)`
// is by contract "matured rows with decision_date < X", so one read bounded at the
// latest date (`asOf`) can answer every earlier bound by filtering in memory. The
// cached rows are the ones matured as of NOW; consumers (retrieval's maturity
// guard and the forecast's own `isMatured` filter) still re-apply their as-of-date
// maturity checks, so no outcome that had not closed by a replay date can leak in.
//
// Writes and `getOutcomes` pass straight through; the replay never calls them.

import type { TradingDate } from "../guard/types.js";
import type { Pair } from "../ingestion/types.js";
import type { AnalogueRecord, AnalogueStore } from "../retrieval/types.js";

export function memoizeMaturedOutcomes(inner: AnalogueStore, asOf: TradingDate): AnalogueStore {
  const cache = new Map<Pair, Promise<readonly AnalogueRecord[]>>();
  return {
    upsertOutcome: (record) => inner.upsertOutcome(record),
    getOutcomes: (asset, decisionDate) => inner.getOutcomes(asset, decisionDate),
    async getMaturedOutcomes(asset, beforeDate) {
      let all = cache.get(asset);
      if (all === undefined) {
        all = inner.getMaturedOutcomes(asset, asOf);
        cache.set(asset, all);
      }
      const rows = await all;
      return rows.filter((r) => r.decisionDate < beforeDate);
    },
  };
}
