// Container entry point for the GCP-scheduled INTRADAY 4H validation refresh —
// Task 9 (intraday-validation feature).
//
// This is the runnable script a SECOND Cloud Run Job executes once per trading
// day, a few hours AFTER the daily run (triggered by a second Cloud Scheduler
// job at ~08:00 UK). It is deliberately SEPARATE from the daily entry point
// (`main.ts`) and shares NONE of its firing/scoring logic:
//
//   1. read the same runtime configuration from the environment;
//   2. SKIP non-trading days (defence-in-depth; the cron is Mon-Fri);
//   3. read the PUBLISHED daily snapshot (`dashboard.json`) — the authoritative,
//      immutable record of the original prediction for EVERY evaluated pair
//      (fired or not) in `pairEvaluations` — READ-ONLY, never recomputed. If the
//      snapshot cannot be read it falls back to the fired pairs in `firing_setups`;
//   4. fetch the currently-forming 4H candle per pair (Twelve Data `interval=4h`),
//      select the forming bar timezone-aware, classify it against the original
//      direction, and persist the result to its OWN `intraday_validations` table;
//   5. republish `dashboard.json` as the SAME published snapshot with ONLY the
//      `intradayValidation` key replaced (and the schema version stamped), through
//      the existing fail-safe sink.
//
// ISOLATION: it NEVER runs the daily pipeline, NEVER writes `firing_setups` /
// `realized_outcomes` / `pattern_vectors` / `analogue_outcomes`, and NEVER
// recomputes direction or confidence. Because the republish is a key-replace on the
// published snapshot, every OTHER slice (pairEvaluations, confluence, trackRecord,
// scorecard, AI notes, ...) stays byte-identical. If there is no readable published
// snapshot for this Decision_Date it SKIPS the republish rather than publish a
// degraded file. Every failure path degrades to "validation unavailable" and
// leaves the daily forecast byte-identical.

import { fileURLToPath } from "node:url";

import { loadScheduledRunConfig } from "./config.js";
import type { ScheduledRunConfig } from "./config.js";
import { isTradingDay } from "../guard/tradingDate.js";
import type { TradingDate } from "../guard/types.js";
import type { DirectionClass } from "../retrieval/types.js";
import { isPair } from "../ingestion/types.js";
import {
  SupabaseRestClient,
  SupabaseIntradayValidationStore,
} from "../storage/supabase/index.js";
import { TwelveDataIntradayClient } from "../ingestion/intradayFeed/twelveDataIntraday.js";
import {
  runIntradayValidation,
  type Intraday4hSource,
  type OriginalPrediction,
} from "../intraday-validation/index.js";
import type { IntradayValidationStore } from "../intraday-validation/store.js";
import { buildIntradayValidationSlice } from "./intradayValidationSlice.js";
import {
  SNAPSHOT_SCHEMA_VERSION,
  writeDashboardSnapshot,
  type DashboardSnapshot,
  type SnapshotSink,
} from "./snapshot.js";
import {
  fetchPublishedSnapshot,
  originalsFromPublished,
  type PublishedSnapshot,
} from "./publishedSnapshot.js";
import { makeGcsSnapshotSink } from "./gcsSnapshotSink.js";
import { resolveAccessTokenProvider } from "./accessToken.js";
import { warnEvent } from "./warn.js";

/** Env var carrying the intraday 4H provider API key (reuses Twelve Data's key). */
export const INTRADAY_API_KEY_ENV = "TWELVE_DATA_API_KEY" as const;
/** Optional env var overriding the intraday provider base URL. */
export const INTRADAY_BASE_URL_ENV = "TWELVE_DATA_BASE_URL" as const;

/** The DB shape of a `firing_setups` row we read back (direction + confidence). */
interface FiringSetupReadRow {
  readonly decision_date: string;
  readonly pair: string;
  readonly direction: string;
  readonly earned_confidence: number;
}

/**
 * FALLBACK read of the per-pair daily prediction from `firing_setups` (used only
 * when the published snapshot is unreadable). It holds FIRED pairs only, so it gives
 * partial coverage. READ-ONLY; converts the stored `[0,1]` confidence to percentage
 * points `[0,100]` (rounded to 2 dp). Returns `[]` fail-safe on any read error; the
 * error is reported through the optional `onError` so an empty result caused by a failed
 * read is distinguishable from "no fired setups".
 */
export async function loadOriginalsFromFiringSetups(
  client: SupabaseRestClient,
  decisionDate: TradingDate,
  onError?: (err: unknown) => void,
): Promise<readonly OriginalPrediction[]> {
  try {
    const rows = await client.select<FiringSetupReadRow>(
      "firing_setups",
      "select=decision_date,pair,direction,earned_confidence" +
        `&decision_date=eq.${encodeURIComponent(decisionDate)}&order=pair.asc`,
    );
    const out: OriginalPrediction[] = [];
    for (const r of rows) {
      if (!isPair(r.pair)) continue;
      out.push({
        pair: r.pair,
        direction: r.direction as DirectionClass,
        confidence: Math.round(r.earned_confidence * 10_000) / 100,
      });
    }
    return out;
  } catch (err) {
    onError?.(err);
    return [];
  }
}

/** Injectable seams so the Job orchestration is unit-testable with no network. */
export interface IntradayJobDeps {
  /** The resolved run config (Decision_Date + Supabase connection). */
  readonly config: ScheduledRunConfig;
  /** The 4H source. Defaults to the Twelve Data client built from the env. */
  readonly source?: Intraday4hSource;
  /** The validation store. Defaults to the Supabase adapter. */
  readonly store?: IntradayValidationStore;
  /** Load the published daily snapshot. Defaults to the public GCS object read. */
  readonly loadPublished?: () => Promise<PublishedSnapshot | null>;
  /** Fallback original-prediction read. Defaults to the `firing_setups` select. */
  readonly loadFallbackOriginals?: (
    decisionDate: TradingDate,
  ) => Promise<readonly OriginalPrediction[]>;
  /** The snapshot sink. Defaults to the GCS sink (undefined → logged no-op). */
  readonly snapshotSink?: SnapshotSink | undefined;
  /** The current instant (UTC). Injected for determinism. Defaults to `new Date()`. */
  readonly now?: Date;
  /** Env the provider config is read from. Defaults to `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Write the snapshot. Defaults to {@link writeDashboardSnapshot}. */
  readonly writeSnapshot?: typeof writeDashboardSnapshot;
  /** Secret-free warning sink. */
  readonly warn?: (collaborator: string, err: unknown) => void;
}

/** The outcome of a Job run (for logging / tests). */
export interface IntradayJobResult {
  readonly decisionDate: TradingDate;
  /** Pairs that produced a persisted validation record. */
  readonly validated: number;
  /** Pairs that degraded to "validation unavailable". */
  readonly unavailable: number;
  /** Whether the snapshot was (re)written. */
  readonly republished: boolean;
}

function defaultWarn(collaborator: string, err: unknown): void {
  warnEvent("intraday_validation.startup_warning", { collaborator }, err);
}

/**
 * Build the Twelve Data 4H source from the environment, or `null` when no key is
 * configured (the Job then republishes the snapshot with an empty slice — fail-safe).
 */
function buildSourceFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): Intraday4hSource | null {
  const apiKey = env[INTRADAY_API_KEY_ENV]?.trim();
  if (apiKey === undefined || apiKey === "") {
    return null;
  }
  const baseUrl = env[INTRADAY_BASE_URL_ENV]?.trim();
  return new TwelveDataIntradayClient(
    baseUrl === undefined || baseUrl === "" ? { apiKey } : { apiKey, baseUrl },
  );
}

/**
 * Run the intraday validation Job: read the published daily prediction, validate
 * the forming 4H candle per pair, persist, and republish the SAME snapshot with only
 * the v8 `intradayValidation` slice replaced. Never throws for a provider/data
 * failure; the republish is best-effort (a failing write is logged + swallowed).
 */
export async function runIntradayValidationJob(
  deps: IntradayJobDeps,
): Promise<IntradayJobResult> {
  const warn = deps.warn ?? defaultWarn;
  const now = deps.now ?? new Date();
  const env = deps.env ?? process.env;
  const decisionDate = deps.config.decisionDate;
  const client = new SupabaseRestClient(deps.config.supabase);

  const store = deps.store ?? new SupabaseIntradayValidationStore(client);
  const source = deps.source ?? buildSourceFromEnv(env);
  const writeSnapshot = deps.writeSnapshot ?? writeDashboardSnapshot;
  const loadPublished =
    deps.loadPublished ?? (() => fetchPublishedSnapshot(deps.config.dashboardSnapshotBucket));
  const loadFallbackOriginals =
    deps.loadFallbackOriginals ??
    ((d: TradingDate) =>
      loadOriginalsFromFiringSetups(client, d, (err) => {
        warn("firing_setups_fallback", err);
      }));

  // The published daily snapshot is BOTH the source of the original prediction
  // (every evaluated pair) AND the base the republish key-replaces.
  const published = await loadPublished();

  let validated = 0;
  let unavailable = 0;

  // 1-4. Compute + persist the validation, unless no provider is configured.
  if (source === null) {
    warn("intraday_source", new Error("no intraday 4H provider configured (missing TWELVE_DATA_API_KEY)"));
  } else {
    try {
      let originals = originalsFromPublished(published, decisionDate);
      if (originals.length === 0) {
        warn(
          "intraday_originals",
          new Error("no pairEvaluations in the published snapshot; falling back to fired firing_setups"),
        );
        originals = await loadFallbackOriginals(decisionDate);
      }
      const result = await runIntradayValidation({
        decisionDate,
        originals,
        source,
        store,
        now,
      });
      validated = result.records.length;
      unavailable = result.unavailable.length;
    } catch (err) {
      // The whole compute/persist step is fail-safe: a defect still lets the Job
      // republish the snapshot (with whatever is already persisted).
      warn("intraday_validation", err);
    }
  }

  // 5. Republish the SAME snapshot with only the intradayValidation slice replaced.
  const republished = await republishSnapshot({
    published,
    decisionDate,
    store,
    snapshotSink: deps.snapshotSink ?? (await resolveSnapshotSink(deps.config, warn)),
    writeSnapshot,
    warn,
  });

  return { decisionDate, validated, unavailable, republished };
}

interface RepublishDeps {
  readonly published: PublishedSnapshot | null;
  readonly decisionDate: TradingDate;
  readonly store: IntradayValidationStore;
  readonly snapshotSink: SnapshotSink | undefined;
  readonly writeSnapshot: typeof writeDashboardSnapshot;
  readonly warn: (collaborator: string, err: unknown) => void;
}

/**
 * Republish the published snapshot with ONLY `intradayValidation` replaced (and the
 * schema version stamped). Every other key is carried through untouched, so the daily
 * slices stay byte-identical. SKIPS (returns false) when there is no readable
 * published snapshot for THIS Decision_Date — it never publishes a degraded or
 * mismatched file. Fail-safe: never throws.
 */
async function republishSnapshot(deps: RepublishDeps): Promise<boolean> {
  try {
    if (deps.published === null) {
      deps.warn("snapshot_republish", new Error("no readable published snapshot; skipping republish"));
      return false;
    }
    if (deps.published.decisionDate !== deps.decisionDate) {
      deps.warn(
        "snapshot_republish",
        new Error("published snapshot is for a different Decision_Date; skipping republish"),
      );
      return false;
    }
    const intradayValidation = await buildIntradayValidationSlice({
      decisionDate: deps.decisionDate,
      store: deps.store,
    });
    // Spread preserves every existing key in order; an existing `intradayValidation`
    // is replaced in place, an absent one is appended LAST.
    const snapshot = {
      ...deps.published,
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      intradayValidation,
    } as unknown as DashboardSnapshot;
    return await deps.writeSnapshot(snapshot, deps.snapshotSink);
  } catch (err) {
    deps.warn("snapshot_republish", err);
    return false;
  }
}

/** Resolve the GCS snapshot sink (shared with the daily Job's bucket). */
async function resolveSnapshotSink(
  config: ScheduledRunConfig,
  warn: (collaborator: string, err: unknown) => void,
): Promise<SnapshotSink | undefined> {
  const bucket = config.dashboardSnapshotBucket;
  if (bucket === undefined) {
    return undefined;
  }
  try {
    const tokens = await resolveAccessTokenProvider();
    return makeGcsSnapshotSink({ bucket, tokens });
  } catch (err) {
    warn("snapshot_sink", err);
    return undefined;
  }
}

/** Run the intraday validation refresh and report the outcome, then exit. */
async function main(): Promise<void> {
  const config = loadScheduledRunConfig();

  console.log(
    JSON.stringify({
      event: "intraday_validation.start",
      decisionDate: config.decisionDate,
      supabaseTarget: config.supabase.target,
      supabaseUrl: config.supabase.url,
    }),
  );

  if (!isTradingDay(config.decisionDate)) {
    console.log(
      JSON.stringify({
        event: "intraday_validation.skipped_non_trading_day",
        decisionDate: config.decisionDate,
      }),
    );
    return;
  }

  const result = await runIntradayValidationJob({ config });

  console.log(
    JSON.stringify({
      event: "intraday_validation.complete",
      decisionDate: result.decisionDate,
      validated: result.validated,
      unavailable: result.unavailable,
      republished: result.republished,
    }),
  );
}

/** True iff this module is the process entry point (so importing it is inert). */
function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  return import.meta.url === `file://${entry}` || fileURLToPath(import.meta.url) === entry;
}

if (invokedDirectly()) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ event: "intraday_validation.error", message }));
    process.exitCode = 1;
  });
}
