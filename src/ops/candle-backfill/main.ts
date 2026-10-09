// One-off backfill operator entry — Design Component 7 (Requirements 5.1, 5.2,
// 5.3).
//
// This is the run-to-completion OPERATOR entry that closes the current candle
// gap (the hosted `candles` table ends 2026-09-15) for all five pairs by driving
// a bounded Gap_Backfill up to the most recent Completed_Trading_Day. It is the
// one-off sibling of the daily Candle_Freshness_Stage wiring: where the daily
// entry (`src/scheduled-run/main.ts`) runs the stage fail-safe on the cadence,
// this entry runs the SAME stage once, on demand, to catch a cold/stale hosted
// DB up to date.
//
// It REUSES the already-built pieces and re-implements NONE of the
// gap/ingest/encode logic:
//   - `runCandleFreshnessStage` (src/scheduled-run/candleFreshness.ts) does the
//     per-pair gap → top-up/backfill → ingest (via `OhlcIngestion`) → encode →
//     secret-free summary; it never throws for a provider failure.
//   - `buildProviderChain` + `ohlcFeedConfigFromEnv` (src/ingestion/ohlcFeed/)
//     assemble the FCS → Twelve Data → Massive chain. Because the pairs are
//     ~3 weeks behind, each pair classifies `backfill` and the stage calls
//     `chain.resolveRange`, which skips the latest-only FCS and reaches Twelve
//     Data / Massive.
//   - `resolveMaxLookback` (src/scheduled-run/candleGap.ts) bounds the lookback.
//   - `OhlcIngestion` + `buildSupabaseStores` provide the validated idempotent
//     ingest path and the hosted stores.
//   - `loadScheduledRunConfig` resolves the Decision_Date + hosted Supabase.
//
// Modelled on `src/ops/evaluation-run/main.ts`: every dependency is injectable
// with a hosted/default resolution so the entry runs live with no arguments, yet
// a unit test injects everything (a stub `runStage` or a stub chain + in-memory
// stores) to exercise it with NO network. An `invokedDirectly()` guard means
// importing the module (e.g. from a test) does not start a run.
//
// SECRET-FREE (R1.7, parent Req 6.2/6.3): no API key or Supabase key is ever
// logged. The structured logs carry only non-secret references —
// `supabaseTarget` / `supabaseUrl`, provider provenance NAMES, and
// names/dates/counts from the per-pair summary.
//
// ☁️ OPERATIONAL SAFETY: this module only BUILDS the entry and is unit-testable
// with injected fixtures (no network). Executing it against the hosted DB is a
// LIVE WRITE — an OPERATOR action (task 13) run under the operational-safety
// protocol — and is NOT performed autonomously.

import { fileURLToPath } from "node:url";

import { OhlcIngestion } from "../../ingestion/ohlcIngestion.js";
import type { CandleStore } from "../../ingestion/types.js";
import type { PatternVectorStore } from "../../encoder/types.js";
import {
  buildProviderChain,
  ohlcFeedConfigFromEnv,
  type ProviderChain,
} from "../../ingestion/ohlcFeed/index.js";
import { resolveMaxLookback } from "../../scheduled-run/candleGap.js";
import {
  runCandleFreshnessStage,
  type CandleFreshnessPairSummary,
} from "../../scheduled-run/candleFreshness.js";
import type { ScheduledRunConfig } from "../../scheduled-run/config.js";
import { loadScheduledRunConfig } from "../../scheduled-run/config.js";
import { buildSupabaseStores } from "../../storage/supabase/index.js";

/** The candle/vector stores the backfill drives (the analogue store is unused). */
export interface CandleBackfillStores {
  readonly candleStore: CandleStore;
  readonly vectorStore: PatternVectorStore;
}

/**
 * Injectable collaborators for {@link runCandleBackfill}. Every field is OPTIONAL
 * with a hosted/default resolution so the entry runs live with no arguments, yet
 * a unit test can inject in-memory fixtures (or a stub `runStage`) to exercise it
 * WITHOUT any network. No field carries a secret value.
 */
export interface CandleBackfillDeps {
  /** Resolved scheduled-run config (hosted Supabase + Decision_Date). */
  readonly config?: ScheduledRunConfig;
  /** The candle/vector stores. Defaults to the hosted Supabase adapters. */
  readonly stores?: CandleBackfillStores;
  /** Injectable `fetch` passed to the Supabase builders AND the provider chain. */
  readonly fetchImpl?: typeof fetch;
  /** The Provider_Fallback_Chain. Defaults to the env-configured FCS→TD→Massive chain. */
  readonly chain?: ProviderChain;
  /** The idempotent ingest path. Defaults to a new `OhlcIngestion` over the candle store. */
  readonly ingestion?: OhlcIngestion;
  /** The bounded Gap_Backfill lookback. Defaults to `resolveMaxLookback(env)`. */
  readonly maxLookbackTradingDays?: number;
  /** The environment the config readers read (defaults to `process.env`). */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** The stage runner. Defaults to the real `runCandleFreshnessStage` — a test injects a stub. */
  readonly runStage?: typeof runCandleFreshnessStage;
}

/**
 * The outcome of a backfill run. On a run it carries the per-pair summaries the
 * stage produced; when no OHLC feed provider is configured it returns
 * `ranStage: false` with a secret-free reason (the run is a logged no-op, NOT a
 * throw) so the entry degrades benignly on a mis-provisioned environment.
 */
export type CandleBackfillResult =
  | { readonly ranStage: true; readonly summaries: readonly CandleFreshnessPairSummary[] }
  | { readonly ranStage: false; readonly reason: string };

/**
 * Run the one-off bounded Gap_Backfill for all five pairs: resolve config/env →
 * (if a provider is configured) build the hosted stores + chain → drive the
 * SHARED `runCandleFreshnessStage` once up to the most recent
 * Completed_Trading_Day → report per pair the new latest stored date + residual
 * gap (names/dates/counts only, no secrets).
 *
 * When no OHLC feed provider is configured (`ohlcFeedConfigFromEnv(env).providers`
 * is empty) it logs a secret-free skip and returns `{ ranStage: false }` without
 * throwing. A degraded/partial backfill (some pairs still behind) is NOT a
 * failure — it is reported in the summaries.
 *
 * Collaborators are injectable so this is unit-testable without a live network;
 * the LIVE execution against the hosted DB is an OPERATOR action (the ☁️ step,
 * task 13).
 */
export async function runCandleBackfill(
  deps: CandleBackfillDeps = {},
): Promise<CandleBackfillResult> {
  const config = deps.config ?? loadScheduledRunConfig(deps.env);
  const env = deps.env ?? process.env;

  // Guard: with no provider configured there is nothing to fetch. Degrade
  // benignly with a secret-free log rather than building stores / throwing.
  const feedConfig = ohlcFeedConfigFromEnv(env);
  if (deps.chain === undefined && feedConfig.providers.length === 0) {
    console.log(
      JSON.stringify({
        event: "candle_backfill.skipped",
        reason: "no_provider_configured",
      }),
    );
    return { ranStage: false, reason: "no OHLC feed provider configured" };
  }

  const stores =
    deps.stores ?? buildSupabaseStores(config.supabase, deps.fetchImpl);
  const chain =
    deps.chain ?? buildProviderChain(feedConfig, deps.fetchImpl);
  const ingestion = deps.ingestion ?? new OhlcIngestion(stores.candleStore);
  const maxLookbackTradingDays =
    deps.maxLookbackTradingDays ?? resolveMaxLookback(env);
  const runStage = deps.runStage ?? runCandleFreshnessStage;

  console.log(
    JSON.stringify({
      event: "candle_backfill.start",
      decisionDate: config.decisionDate,
      supabaseTarget: config.supabase.target,
      supabaseUrl: config.supabase.url,
      providers: chain.providerNames,
    }),
  );

  // Drive the SHARED stage once. For a pair ~3 weeks behind it classifies
  // `backfill` and uses `chain.resolveRange`, which skips latest-only FCS and
  // reaches Twelve Data / Massive. The stage never throws for a provider failure.
  const summaries = await runStage({
    decisionDate: config.decisionDate,
    ingestion,
    candleStore: stores.candleStore,
    vectorStore: stores.vectorStore,
    chain,
    maxLookbackTradingDays,
  });

  // Per-pair completion report — names/dates/counts only, NO secret.
  for (const summary of summaries) {
    console.log(
      JSON.stringify({
        event: "candle_backfill.recorded",
        pair: summary.pair,
        provider: summary.provider,
        fetched: summary.fetched,
        accepted: summary.accepted,
        rejected: summary.rejected,
        latestDate: summary.latestDate,
        target: summary.target,
        residualGap: summary.residualGap,
      }),
    );
  }

  // Roll-up: which pairs are still behind the target after the backfill. A
  // residual gap is reported, not treated as a failure exit.
  const pairsWithResidualGap = summaries
    .filter((s) => s.residualGap)
    .map((s) => s.pair);
  console.log(
    JSON.stringify({
      event: "candle_backfill.rollup",
      pairs: summaries.length,
      pairsWithResidualGap,
    }),
  );

  return { ranStage: true, summaries };
}

/**
 * Entry wrapper mirroring `evaluation-run/main.ts`: run the backfill and emit a
 * secret-free completion log. A degraded/partial backfill is NOT a failure exit
 * — it is reported in the per-pair logs. Only an unexpected thrown error sets a
 * non-zero exit code (handled by the direct-invocation guard below).
 */
export async function main(): Promise<void> {
  await runCandleBackfill();
}

/**
 * True iff this module is the process entry point, so importing it (e.g. from a
 * test) does NOT start a run. Mirrors the direct-invocation guard of
 * `evaluation-run/main.ts`.
 */
function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  return (
    import.meta.url === `file://${entry}` ||
    fileURLToPath(import.meta.url) === entry
  );
}

if (invokedDirectly()) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ event: "candle_backfill.error", message }));
    process.exitCode = 1;
  });
}
