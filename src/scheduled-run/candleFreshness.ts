// Candle_Freshness_Stage — Design Component 4 (Requirements 2.1, 2.2, 2.3, 2.4,
// 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 4.3, 4.4).
//
// Runs at the start of the daily run, BEFORE the deterministic pipeline reads
// candle history. For each of the five pairs it computes the gap between the
// last stored candle and the most recent Completed_Trading_Day, fetches the
// missing daily candles through the Provider_Fallback_Chain, and ingests them
// idempotently through the existing `OhlcIngestion` (validation + session-
// boundary normalization + look-ahead guard + idempotent `(asset, date)`
// upsert). Newly covered dates are encoded into pattern vectors via the shared
// encode helper so retrieval/firing downstream see fresh data.
//
// FAIL-SAFE (R4.1): the stage NEVER throws for a provider failure. The chain
// already returns typed, secret-free errors; an all-providers-fail outcome logs
// a secret-free warning and proceeds on the pair's existing history. Each pair's
// post-fetch work is wrapped so one pair's unexpected error cannot abort the
// others.
//
// SECRET-FREE (R1.7): no API key or secret value is ever logged. The per-pair
// log carries only names/dates/counts and the winning provider's provenance tag.

import { encodeDatesIntoVectors } from "../encoder/encodeStoredCandles.js";
import type { PatternVectorStore } from "../encoder/types.js";
import { compareTradingDates } from "../guard/tradingDate.js";
import type { TradingDate } from "../guard/types.js";
import type { OhlcIngestion } from "../ingestion/ohlcIngestion.js";
import type { CandleStore, IngestReport, Pair, RawCandle } from "../ingestion/types.js";
import { PAIRS } from "../ingestion/types.js";
import {
  isResolved,
  type ProviderChain,
  type ResolveOutcome,
} from "../ingestion/ohlcFeed/providerChain.js";
import { backfillRangeStart, classifyGap, type GapClass } from "./candleGap.js";
import { mostRecentCompletedTradingDay } from "./completedTradingDay.js";

/** Injectable collaborators so the stage is unit-testable with no network. */
export interface CandleFreshnessDeps {
  readonly decisionDate: TradingDate;
  readonly ingestion: OhlcIngestion;
  readonly candleStore: CandleStore;
  readonly vectorStore: PatternVectorStore;
  readonly chain: ProviderChain;
  readonly maxLookbackTradingDays: number;
  /** Defaults to `console.log(JSON.stringify(event))`. */
  readonly logger?: (event: object) => void;
}

/** The per-pair outcome the stage returns (and logs). All fields secret-free. */
export interface CandleFreshnessPairSummary {
  readonly pair: Pair;
  /** How the gap was classified. */
  readonly gap: GapClass;
  /** The winning provider's provenance tag, or `null` when none served. */
  readonly provider: string | null;
  /** Candles returned by the provider (0 when none/failed). */
  readonly fetched: number;
  /** Candles accepted by `OhlcIngestion` (passed validation + look-ahead). */
  readonly accepted: number;
  /** Candles rejected by `OhlcIngestion` validation. */
  readonly rejected: number;
  /** The resulting latest stored date for the pair, or `null`. */
  readonly latestDate: TradingDate | null;
  /** The target (most recent Completed_Trading_Day). */
  readonly target: TradingDate;
  /** True when the latest stored date is still behind the target. */
  readonly residualGap: boolean;
  /** True when every provider failed/was unconfigured for this pair. */
  readonly degraded: boolean;
}

const defaultLogger = (event: object): void => {
  console.log(JSON.stringify(event));
};

/**
 * Run the Candle_Freshness_Stage for all five pairs. Returns a per-pair summary
 * array. Never throws for a provider failure; per-pair work is isolated so one
 * pair's unexpected error does not abort the others.
 */
export async function runCandleFreshnessStage(
  deps: CandleFreshnessDeps,
): Promise<readonly CandleFreshnessPairSummary[]> {
  const log = deps.logger ?? defaultLogger;
  const target = mostRecentCompletedTradingDay(deps.decisionDate);

  // --- 1. Read coverage once and classify each pair's gap. -----------------
  const coverage = await deps.candleStore.getCoverageSummary();
  const latestByPair = new Map<Pair, TradingDate | null>();
  for (const pair of PAIRS) {
    const entry = coverage.find((c) => c.pair === pair);
    latestByPair.set(pair, entry?.latestDate ?? null);
  }

  const gapByPair = new Map<Pair, GapClass>();
  const topUpPairs: Pair[] = [];
  for (const pair of PAIRS) {
    const gap = classifyGap(latestByPair.get(pair) ?? null, target);
    gapByPair.set(pair, gap);
    if (gap === "top_up") {
      topUpPairs.push(pair);
    }
  }

  // --- 2. Resolve all top-up pairs in ONE batched call (R1.2 rate limits).  -
  // Batching the top-up across every pair that needs it respects the primary
  // provider's per-minute request budget (FCS serves all five in one call).
  const topUpOutcomes =
    topUpPairs.length > 0
      ? await deps.chain.resolveLatest(topUpPairs, deps.decisionDate, target)
      : new Map<Pair, ResolveOutcome>();

  // --- 3. Per pair: resolve (backfill if needed), ingest, encode, log. -----
  const summaries: CandleFreshnessPairSummary[] = [];
  for (const pair of PAIRS) {
    const gap = gapByPair.get(pair) ?? "up_to_date";
    const preRunLatest = latestByPair.get(pair) ?? null;

    try {
      const summary = await processPair(deps, {
        pair,
        gap,
        target,
        preRunLatest,
        topUpOutcome: topUpOutcomes.get(pair),
      });
      summaries.push(summary);
      log({ event: "candle_freshness_pair", ...summary });
    } catch (error) {
      // An unexpected throw inside a pair's work must not abort the others
      // (the orchestrator-level try/catch is Phase 3). Log secret-free and
      // record a degraded no-op summary so the pair keeps its history.
      const message = error instanceof Error ? error.message : String(error);
      const summary: CandleFreshnessPairSummary = {
        pair,
        gap,
        provider: null,
        fetched: 0,
        accepted: 0,
        rejected: 0,
        latestDate: preRunLatest,
        target,
        residualGap: isBehind(preRunLatest, target),
        degraded: true,
      };
      summaries.push(summary);
      log({ event: "candle_freshness_pair_error", pair, message });
    }
  }

  return summaries;
}

interface PairWork {
  readonly pair: Pair;
  readonly gap: GapClass;
  readonly target: TradingDate;
  readonly preRunLatest: TradingDate | null;
  readonly topUpOutcome: ResolveOutcome | undefined;
}

async function processPair(
  deps: CandleFreshnessDeps,
  work: PairWork,
): Promise<CandleFreshnessPairSummary> {
  const { pair, gap, target, preRunLatest } = work;

  // No gap: the last stored candle is already the target — make NO fetch for
  // this pair (R3.4). A top-up pair uses the batched outcome; a backfill pair
  // issues a bounded range request.
  if (gap === "up_to_date") {
    return noFetchSummary(pair, gap, target, preRunLatest);
  }

  let outcome: ResolveOutcome;
  if (gap === "top_up") {
    outcome =
      work.topUpOutcome ??
      ({
        reason: "ohlc_feed_error",
        mode: "empty",
        provider: "none",
        pair,
        message: `no top-up outcome for ${pair}`,
      } satisfies ResolveOutcome);
  } else {
    const from = backfillRangeStart(preRunLatest, target, deps.maxLookbackTradingDays);
    outcome = await deps.chain.resolveRange(pair, from, target);
  }

  // All providers failed/unconfigured: degrade safely (R1.5, R4.1) — log a
  // secret-free warning and proceed on the existing history (no delete, no
  // mutation beyond what we never did).
  if (!isResolved(outcome)) {
    return {
      pair,
      gap,
      provider: null,
      fetched: 0,
      accepted: 0,
      rejected: 0,
      latestDate: preRunLatest,
      target,
      residualGap: isBehind(preRunLatest, target),
      degraded: true,
    };
  }

  const candles: readonly RawCandle[] = outcome.candles;

  // Ingest through the single validated path (R1.4): validate + normalize +
  // look-ahead guard (rejects at/after decisionDate rows) + idempotent upsert.
  const report: IngestReport = await deps.ingestion.ingest(
    pair,
    candles,
    deps.decisionDate,
  );

  // Encode the newly covered dates so vectors exist for retrieval. The accepted
  // dates are those now stored in `(preRunLatest, target]`; encoding reads a
  // trailing window STRICTLY BEFORE each date (look-ahead safe via the helper).
  const newlyCovered = await datesToEncode(deps, pair, preRunLatest, target);
  await encodeDatesIntoVectors(deps.candleStore, deps.vectorStore, pair, newlyCovered);

  const latestDate = await latestStored(deps, pair);
  return {
    pair,
    gap,
    provider: outcome.provider,
    fetched: candles.length,
    accepted: report.accepted,
    rejected: report.rejected,
    latestDate,
    target,
    residualGap: isBehind(latestDate, target),
    degraded: false,
  };
}

/** The dates in `(preRunLatest, target]` now backed by a stored candle. */
async function datesToEncode(
  deps: CandleFreshnessDeps,
  pair: Pair,
  preRunLatest: TradingDate | null,
  target: TradingDate,
): Promise<readonly TradingDate[]> {
  const stored = await deps.candleStore.getCandles(pair);
  return stored
    .map((c) => c.date)
    .filter(
      (d) =>
        (preRunLatest === null || compareTradingDates(d, preRunLatest) > 0) &&
        compareTradingDates(d, target) <= 0,
    );
}

async function latestStored(
  deps: CandleFreshnessDeps,
  pair: Pair,
): Promise<TradingDate | null> {
  const coverage = await deps.candleStore.getCoverageSummary();
  return coverage.find((c) => c.pair === pair)?.latestDate ?? null;
}

function noFetchSummary(
  pair: Pair,
  gap: GapClass,
  target: TradingDate,
  latestDate: TradingDate | null,
): CandleFreshnessPairSummary {
  return {
    pair,
    gap,
    provider: null,
    fetched: 0,
    accepted: 0,
    rejected: 0,
    latestDate,
    target,
    residualGap: isBehind(latestDate, target),
    degraded: false,
  };
}

/** True when `latestDate` is null or strictly before `target`. */
function isBehind(latestDate: TradingDate | null, target: TradingDate): boolean {
  return latestDate === null || compareTradingDates(latestDate, target) < 0;
}
