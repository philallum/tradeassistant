// Analogue Retrieval — Task 4.1.
// Requirements 9.1, 9.2, 9.3, 9.4, 9.5, 9.7, 9.8, 9.9, 20.
//
// Implements retrieve() with:
//   1. weekly_trend_sign metadata pre-filter (Req 9.2)
//   2. Self-exclusion of the query itself (Req 9.4)
//   3. Strictly-pre-date filter (Req 9.3)
//   4. Matured-only filter via LookAheadGuard (Req 9.5)
//   5. Similarity-radius epsilon cutoff (Req 9.8, 20.1–20.4)
//   6. Stable tie-break ordering: cosineDistance ASC, date ASC, asset ASC (Req 9.7)
//   7. Returns at most k analogues; all pre-filters still apply (Req 20.4)

import { lookAheadGuard } from "../guard/lookAheadGuard.js";
import type { TradingDate } from "../guard/types.js";
import type { Pair } from "../ingestion/types.js";
import type { PatternVector, PatternVectorStore } from "../encoder/types.js";
import type { AnalogueRecord, AnalogueStore, RetrievalConfig } from "./types.js";

/**
 * Retrieves the Analogue_Neighborhood for a query PatternVector.
 *
 * Steps (order matters; all constraints are cumulative):
 * 1. Query `vectorStore.queryNearest` pre-filtered on `weeklyTrendSign` and
 *    `excludeDecisionDate` (self-exclusion). (Req 9.1, 9.2, 9.4)
 * 2. Discard any candidate whose decision_date >= decisionDate. (Req 9.3)
 * 3. Discard any candidate whose cosineDistance > epsilon. (Req 9.8, 20.1)
 * 4. Cross-reference with `analogueStore.getMaturedOutcomes` — only candidates
 *    that have at least one matured outcome row survive. (Req 9.5)
 * 5. Apply `maturedPreDateOnly` from the LookAheadGuard as an additional
 *    structural safety check. (Req 9.3, 9.5)
 * 6. Sort by (cosineDistance ASC, decisionDate ASC, asset ASC) for determinism. (Req 9.7)
 * 7. Return at most `config.k` records.
 *
 * @param query          The query PatternVector (from patternVectorEncoder.encode)
 * @param queryAsset     The asset for the query (used when scoping by asset)
 * @param decisionDate   The Decision_Date — no analogue on or after this date admitted
 * @param evalDate       The evaluation date — used to confirm maturity
 * @param vectorStore    The PatternVectorStore (pgvector or in-memory)
 * @param analogueStore  The AnalogueStore for forward-outcome records
 * @param config         { k, epsilon }
 */
export async function retrieve(
  query: PatternVector,
  queryAsset: Pair,
  decisionDate: TradingDate,
  evalDate: TradingDate,
  vectorStore: PatternVectorStore,
  analogueStore: AnalogueStore,
  config: RetrievalConfig,
): Promise<readonly AnalogueRecord[]> {
  const { k, epsilon } = config;

  // Step 1: ANN search pre-filtered by weeklyTrendSign + self-exclusion.
  // We over-fetch (10× k) to have enough candidates after all other filters.
  // (Req 9.1, 9.2, 9.4)
  const rawCandidates = await vectorStore.queryNearest(
    query.embedding,
    query.weeklyTrendSign,
    {
      asset: queryAsset,
      excludeDecisionDate: decisionDate,
      limit: Math.max(k * 10, 200),
    },
  );

  // Step 2 + 3: strictly-pre-date AND epsilon cutoff. (Req 9.3, 9.8)
  const withinEpsilon = rawCandidates.filter(
    ({ vector, cosineDistance }) =>
      vector.decisionDate < decisionDate && cosineDistance <= epsilon,
  );

  // Step 4: fetch matured outcomes for this asset, strictly before decisionDate.
  // Build a set of dates that have at least one matured outcome. (Req 9.5)
  const maturedOutcomes = await analogueStore.getMaturedOutcomes(
    queryAsset,
    decisionDate,
  );
  const maturedDates = new Set(maturedOutcomes.map((r) => r.decisionDate));

  // Step 5: keep only candidates that have a matured outcome.
  // Additionally run maturedPreDateOnly as a structural safety net (Req 9.3, 9.5).
  const maturedAnalogueShape = Array.from(maturedDates).map((d) => ({
    decisionDate: d,
    asset: queryAsset,
    horizon: 1 as const,
  }));
  const guardPassed = lookAheadGuard.maturedPreDateOnly(
    maturedAnalogueShape,
    decisionDate,
    evalDate,
  );
  const guardPassedDates = new Set(guardPassed.map((a) => a.decisionDate));

  // Keep vector candidates whose date is in the guard-approved set.
  const eligible = withinEpsilon.filter(({ vector }) =>
    guardPassedDates.has(vector.decisionDate),
  );

  // Step 6: stable tie-break sort. (Req 9.7)
  const sorted = [...eligible].sort((a, b) => {
    const distDiff = a.cosineDistance - b.cosineDistance;
    if (Math.abs(distDiff) > 1e-9) return distDiff;
    const dateDiff = a.vector.decisionDate.localeCompare(b.vector.decisionDate);
    if (dateDiff !== 0) return dateDiff;
    return a.vector.asset.localeCompare(b.vector.asset);
  });

  // Step 7: take at most k and attach cosineDistance to each matured outcome record.
  const topK = sorted.slice(0, k);

  // Build a lookup of matured outcomes keyed by decisionDate.
  const outcomesByDate = new Map<string, AnalogueRecord>();
  for (const r of maturedOutcomes) {
    // Use the most-frequently needed horizon (1) as a representative record;
    // the full per-horizon set is accessed via the AnalogueStore in resolve().
    const existing = outcomesByDate.get(r.decisionDate);
    if (!existing || r.horizon < existing.horizon) {
      outcomesByDate.set(r.decisionDate, r);
    }
  }

  const result: AnalogueRecord[] = [];
  for (const { vector, cosineDistance } of topK) {
    const base = outcomesByDate.get(vector.decisionDate);
    if (base) {
      result.push({ ...base, cosineDistance });
    }
  }

  return result;
}
