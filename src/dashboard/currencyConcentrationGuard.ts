// Currency Concentration Guard — Design Component 16 (Requirement 22).
//
// A DETERMINISTIC-CORE dashboard-level suppression step. It limits simultaneous
// directional exposure to the same base or quote currency across the five
// pairs. It is a pure function of the firing setups and their Earned_Confidence
// values, with NO LLM input (Requirement 22.4).
//
// Grouping (Requirement 22.1): same-day firing setups are grouped by a shared
// currency AND directional alignment on that currency. Alignment is computed
// from the pair structure and Direction_Class via `currencyStances`, NOT naive
// symbol matching — e.g. EURUSD UP (USD −1) and USDJPY UP (USD +1) are NOT
// aligned on USD, whereas EURUSD UP (USD −1) and GBPUSD UP (USD −1) ARE.
//
// Retention (Requirements 22.2, 22.5): within each aligned group, only the
// `maxConcurrentAligned` (default 2) highest-Earned_Confidence setups are
// retained; the rest are suppressed with a `currency_concentration` reason and
// the competing pairs that outranked them (Requirement 22.3). A setup may belong
// to two aligned groups (its base-currency stance and its quote-currency
// stance); it is suppressed if it is outranked beyond the top-N in ANY group it
// belongs to.

import type { Pair } from "../ingestion/types.js";
import type { TradingDate } from "../guard/types.js";
import {
  currencyStances,
  DEFAULT_MAX_CONCURRENT_ALIGNED,
  type CurrencyConcentrationGuard,
  type CurrencyConcentrationResult,
  type CurrencyStance,
  type FiringSetup,
  type SuppressedSetup,
} from "./types.js";

/** A group of firing setups aligned on a shared (currency, stance). */
interface AlignedGroup {
  /** A stable key: `${currency}:${stance}` (for deterministic ordering only). */
  readonly key: string;
  /** The aligned setups, in their original (already-deterministic) order. */
  readonly members: readonly FiringSetup[];
}

/**
 * Deterministic total order for ranking aligned setups by conviction: highest
 * Earned_Confidence first; ties broken by pair symbol ascending so the outcome
 * is reproducible for identical inputs (Requirement 3.1).
 */
function byConvictionThenPair(a: FiringSetup, b: FiringSetup): number {
  if (b.earnedConfidence !== a.earnedConfidence) {
    return b.earnedConfidence - a.earnedConfidence;
  }
  return a.pair.localeCompare(b.pair);
}

/**
 * Partition the firing setups into aligned groups keyed by (currency, stance).
 * A FLAT setup contributes no stance and therefore joins no group, so it is
 * never suppressed by the guard. A directional setup contributes to exactly one
 * group per currency it touches (its base and its quote).
 */
function buildAlignedGroups(firing: readonly FiringSetup[]): AlignedGroup[] {
  // currency:stance -> setups
  const groups = new Map<string, FiringSetup[]>();
  for (const setup of firing) {
    const stances = currencyStances(setup.pair, setup.direction);
    for (const [currency, stance] of stances) {
      const key = groupKey(currency, stance);
      const bucket = groups.get(key);
      if (bucket) {
        bucket.push(setup);
      } else {
        groups.set(key, [setup]);
      }
    }
  }
  // Emit in a deterministic key order.
  return [...groups.keys()]
    .sort((a, b) => a.localeCompare(b))
    .map((key) => ({ key, members: groups.get(key) ?? [] }));
}

/** The stable group key for a (currency, stance) pair. */
function groupKey(currency: string, stance: CurrencyStance): string {
  return `${currency}:${stance}`;
}

/**
 * Apply the Currency Concentration Guard to a set of same-day firing setups.
 *
 * A pure, deterministic function (Requirement 22.4). For identical inputs it
 * returns identical `kept` / `suppressed` sets (Requirement 3.1).
 *
 * @param firing       The setups that passed the per-pair firing decision.
 * @param decisionDate The Decision_Date (part of the interface; the guard is a
 *                     pure function of the setups, so the date is not needed to
 *                     rank them — the caller has already restricted `firing` to
 *                     a single Decision_Date).
 * @param config       Optional `{ maxConcurrentAligned }` (default 2).
 */
export function applyCurrencyConcentrationGuard(
  firing: readonly FiringSetup[],
  // Part of the Component 16 interface; the setups are already scoped to a single
  // Decision_Date by the caller, so the guard does not need the date to rank
  // them. The leading underscore marks it intentionally unused.
  _decisionDate: TradingDate,
  config?: { maxConcurrentAligned?: number },
): CurrencyConcentrationResult {
  const n = config?.maxConcurrentAligned ?? DEFAULT_MAX_CONCURRENT_ALIGNED;
  const maxKeep = Math.max(0, Math.trunc(n));

  const groups = buildAlignedGroups(firing);

  // For each suppressed pair, accumulate the union of competing (outranking)
  // aligned pairs across every group in which it was outranked.
  const suppressedCompetitors = new Map<Pair, Set<Pair>>();

  for (const group of groups) {
    if (group.members.length <= maxKeep) {
      continue; // group fits under the cap — nobody suppressed here.
    }
    const ranked = [...group.members].sort(byConvictionThenPair);
    const kept = ranked.slice(0, maxKeep);
    const losers = ranked.slice(maxKeep);
    for (const loser of losers) {
      // The competing pairs are the aligned setups that outranked this loser:
      // everyone ahead of it in this group's ranking (kept + higher-ranked
      // losers), excluding itself.
      let competitors = suppressedCompetitors.get(loser.pair);
      if (!competitors) {
        competitors = new Set<Pair>();
        suppressedCompetitors.set(loser.pair, competitors);
      }
      for (const other of kept) {
        competitors.add(other.pair);
      }
      for (const other of ranked) {
        if (other.pair === loser.pair) break; // stop at self: only those ahead.
        competitors.add(other.pair);
      }
    }
  }

  const suppressed: SuppressedSetup[] = [];
  const kept: FiringSetup[] = [];
  for (const setup of firing) {
    const competitors = suppressedCompetitors.get(setup.pair);
    if (competitors && competitors.size > 0) {
      suppressed.push({
        pair: setup.pair,
        reason: "currency_concentration",
        competingPairs: [...competitors].sort((a, b) => a.localeCompare(b)),
      });
    } else {
      kept.push(setup);
    }
  }

  return { kept, suppressed };
}

/**
 * The Currency Concentration Guard as the Component 16 interface object
 * (Requirement 22). A thin wrapper over {@link applyCurrencyConcentrationGuard}.
 */
export const currencyConcentrationGuard: CurrencyConcentrationGuard = {
  apply(firing, decisionDate, config) {
    return applyCurrencyConcentrationGuard(firing, decisionDate, config);
  },
};
