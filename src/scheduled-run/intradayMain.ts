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
//   3. read back the latest Decision_Date's PERSISTED daily prediction
//      (direction + Earned_Confidence per pair) from `firing_setups` / the
//      snapshot — READ-ONLY, never recomputed;
//   4. fetch the currently-forming 4H candle per pair (Twelve Data `interval=4h`),
//      select the forming bar timezone-aware, classify it against the original
//      direction, and persist the result to its OWN `intraday_validations` table;
//   5. rebuild and republish `dashboard.json` with the v8 `intradayValidation`
//      slice filled, reusing the existing fail-safe snapshot sink.
//
// ISOLATION: it NEVER runs the daily pipeline, NEVER writes `firing_setups` /
// `realized_outcomes` / `pattern_vectors` / `analogue_outcomes`, and NEVER
// recomputes direction or confidence. Every failure path (no key, provider down,
// stale/invalid bar, read-back empty, write error) degrades to "validation
// unavailable" and leaves the daily forecast byte-identical.

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
import type { SupabaseConfig } from "../storage/supabaseConfig.js";
import { TwelveDataIntradayClient } from "../ingestion/intradayFeed/twelveDataIntraday.js";
import {
  runIntradayValidation,
  type Intraday4hSource,
  type OriginalPrediction,
} from "../intraday-validation/index.js";
import type { IntradayValidationStore } from "../intraday-validation/store.js";
import { buildIntradayValidationSlice } from "./intradayValidationSlice.js";
import {
  buildDashboardSnapshot,
  writeDashboardSnapshot,
  type DashboardSnapshot,
  type SnapshotSink,
} from "./snapshot.js";
import { loadSnapshotHistory } from "./snapshotHistory.js";
import { makeGcsSnapshotSink } from "./gcsSnapshotSink.js";
import { resolveAccessTokenProvider } from "./accessToken.js";

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
 * Read back the latest persisted Decision_Date's per-pair daily prediction as
 * {@link OriginalPrediction}s. READ-ONLY: a plain select of `firing_setups`
 * (direction + Earned_Confidence), converting the stored `[0,1]` confidence to
 * PERCENTAGE POINTS `[0,100]`. Returns `[]` fail-safe on any read error (the Job
 * then republishes an empty intraday slice).
 */
export async function loadOriginalsFromFiringSetups(
  client: SupabaseRestClient,
  decisionDate: TradingDate,
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
        confidence: r.earned_confidence * 100,
      });
    }
    return out;
  } catch {
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
  /** Read back the latest daily prediction. Defaults to the firing_setups read. */
  readonly loadOriginals?: (decisionDate: TradingDate) => Promise<readonly OriginalPrediction[]>;
  /** The snapshot sink. Defaults to the GCS sink (undefined → logged no-op). */
  readonly snapshotSink?: SnapshotSink | undefined;
  /** Load the read-back history slices. Defaults to {@link loadSnapshotHistory}. */
  readonly loadHistory?: (
    client: SupabaseRestClient,
    decisionDate: TradingDate,
  ) => Promise<Awaited<ReturnType<typeof loadSnapshotHistory>>>;
  /** The current instant (UTC). Injected for determinism. Defaults to `new Date()`. */
  readonly now?: Date;
  /** Env the provider config is read from. Defaults to `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Assemble the snapshot. Defaults to {@link buildDashboardSnapshot}. */
  readonly buildSnapshot?: typeof buildDashboardSnapshot;
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
  const message = err instanceof Error ? err.message : String(err);
  console.warn(JSON.stringify({ event: "intraday_validation.startup_warning", collaborator, message }));
}

/**
 * Build the Twelve Data 4H source from the environment, or `null` when no key is
 * configured (the Job then republishes an empty slice — fail-safe).
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
 * Run the intraday validation Job: read back the daily prediction, validate the
 * forming 4H candle per pair, persist, and republish the snapshot with the v8
 * slice filled. Never throws for a provider/data failure; the snapshot republish
 * is best-effort (a failing write is logged + swallowed).
 */
export async function runIntradayValidationJob(
  deps: IntradayJobDeps,
): Promise<IntradayJobResult> {
  const warn = deps.warn ?? defaultWarn;
  const now = deps.now ?? new Date();
  const env = deps.env ?? process.env;
  const supabase: SupabaseConfig = deps.config.supabase;
  const client = new SupabaseRestClient(supabase);
  const decisionDate = deps.config.decisionDate;

  const store = deps.store ?? new SupabaseIntradayValidationStore(client);
  const source = deps.source ?? buildSourceFromEnv(env);
  const loadOriginals =
    deps.loadOriginals ?? ((d: TradingDate) => loadOriginalsFromFiringSetups(client, d));
  const buildSnapshot = deps.buildSnapshot ?? buildDashboardSnapshot;
  const writeSnapshot = deps.writeSnapshot ?? writeDashboardSnapshot;

  let validated = 0;
  let unavailable = 0;

  // 1-4. Compute + persist the validation, unless no provider is configured.
  if (source === null) {
    warn("intraday_source", new Error("no intraday 4H provider configured (missing TWELVE_DATA_API_KEY)"));
  } else {
    try {
      const originals = await loadOriginals(decisionDate);
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

  // 5. Rebuild + republish the snapshot with the v8 slice from the store.
  const loadHistory =
    deps.loadHistory ?? ((c, d) => loadSnapshotHistory(c, { decisionDate: d }));
  const republished = await republishSnapshot({
    client,
    decisionDate,
    store,
    snapshotSink: deps.snapshotSink ?? (await resolveSnapshotSink(deps.config, warn)),
    buildSnapshot,
    writeSnapshot,
    loadHistory,
    warn,
  });

  return { decisionDate, validated, unavailable, republished };
}

interface RepublishDeps {
  readonly client: SupabaseRestClient;
  readonly decisionDate: TradingDate;
  readonly store: IntradayValidationStore;
  readonly snapshotSink: SnapshotSink | undefined;
  readonly buildSnapshot: typeof buildDashboardSnapshot;
  readonly writeSnapshot: typeof writeDashboardSnapshot;
  readonly loadHistory: (
    client: SupabaseRestClient,
    decisionDate: TradingDate,
  ) => Promise<Awaited<ReturnType<typeof loadSnapshotHistory>>>;
  readonly warn: (collaborator: string, err: unknown) => void;
}

/**
 * Rebuild `dashboard.json` from the persisted history plus the just-written
 * intraday slice and write it through the best-effort sink. The daily firing
 * view is read back from `firing_setups` via `loadSnapshotHistory` and merged by
 * `buildDashboardSnapshot`; this Job produces NO firing view of its own, so it
 * passes an empty view (today's firing rows are already in history). Fail-safe.
 */
async function republishSnapshot(deps: RepublishDeps): Promise<boolean> {
  try {
    const history = await deps.loadHistory(deps.client, deps.decisionDate);
    const intradayValidation = await buildIntradayValidationSlice({
      decisionDate: deps.decisionDate,
      store: deps.store,
    });
    const snapshot: DashboardSnapshot = deps.buildSnapshot(
      { decisionDate: deps.decisionDate, cards: [] },
      undefined,
      history,
      undefined,
      [],
      {},
      undefined,
      undefined,
      undefined,
      intradayValidation,
    );
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
