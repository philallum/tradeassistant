// Read-only freshness-verification operator entry — Design Component 8
// (Requirements 6.1, 6.2).
//
// This is the run-to-completion OPERATOR entry that CONFIRMS, after a daily run,
// that the Candle_Freshness_Stage actually reached the dashboard: per pair the
// hosted `candles` table's latest stored date equals the most recent
// Completed_Trading_Day (R6.2), and the published `dashboard.json` snapshot's
// Decision_Date reflects a run computed over history that includes that day
// (R6.1). It is the read-only sibling of the one-off backfill entry
// (`src/ops/candle-backfill/main.ts`): where that entry WRITES to catch a stale
// DB up to date, this entry only READS and reports.
//
// It REUSES the already-built pieces and re-implements NONE of the verification
// logic:
//   - `verifyFreshness` (src/scheduled-run/freshnessVerification.ts, Task 14)
//     does the per-pair latest-vs-target comparison and the
//     snapshot-reflects-fresh-history check; it is strictly read-only — it only
//     queries `getCoverageSummary` / `getCandles` and reads the snapshot's
//     `decisionDate`, never writing.
//   - `buildSupabaseStores` provides the hosted stores; ONLY the read-only
//     `candleStore` is used (no `vectorStore`, no `upsertCandles`).
//   - `loadScheduledRunConfig` resolves the Decision_Date + hosted Supabase and
//     the non-secret `DASHBOARD_SNAPSHOT_BUCKET`.
//
// Modelled EXACTLY on `src/ops/candle-backfill/main.ts`: every dependency is
// injectable with a hosted/default resolution so the entry runs live with no
// arguments, yet a unit test injects everything (an in-memory `CandleStore` + a
// provided snapshot) to exercise it with NO network and NO filesystem. An
// `invokedDirectly()` guard means importing the module (e.g. from a test) does
// not start a run.
//
// SNAPSHOT READ PATH: the repo publishes `dashboard.json` to a PUBLIC-READ GCS
// bucket (`makeGcsSnapshotSink` / `DASHBOARD_SNAPSHOT_BUCKET`). There is no
// existing READER helper, so the live default fetches that same public object
// over plain `fetch` at the GCS public-object URL
// (`https://storage.googleapis.com/<bucket>/dashboard.json`) — the read side of
// the exact transport the sink writes, inventing no new transport. The public
// object needs no credential, so this stays secret-free. Snapshot acquisition is
// fully INJECTABLE (`snapshot` or `readSnapshot`) so the test supplies it with
// no I/O.
//
// SECRET-FREE (R1.7, Req 6.1/6.2): no Supabase key or API key is ever logged.
// The structured logs carry only non-secret references — `supabaseTarget` /
// `supabaseUrl`, per-pair `pair` / `latestDate` / `target` / `fresh` /
// `residualGap`, `snapshotDecisionDate`, `snapshotReflectsFreshHistory`, and
// `allFresh`.
//
// ☁️ OPERATIONAL SAFETY: this module only BUILDS the entry and is unit-testable
// with injected fixtures (no network). Executing it against the hosted DB is a
// LIVE READ — an OPERATOR action (task 15) run under the operational-safety
// protocol — and is NOT performed autonomously. The check is read-only: it
// performs no write and touches no decision path.

import { fileURLToPath } from "node:url";

import type { CandleStore } from "../../ingestion/types.js";
import type { ScheduledRunConfig } from "../../scheduled-run/config.js";
import { loadScheduledRunConfig } from "../../scheduled-run/config.js";
import {
  verifyFreshness,
  type FreshnessVerificationResult,
  type VerifiableSnapshot,
} from "../../scheduled-run/freshnessVerification.js";
import { SNAPSHOT_FILE_NAME } from "../../scheduled-run/snapshot.js";
import { buildSupabaseStores } from "../../storage/supabase/index.js";

/** The GCS public-object host the published snapshot is readable from. */
const GCS_PUBLIC_HOST = "https://storage.googleapis.com";

/**
 * Build the PUBLIC-READ URL for a published snapshot object in `bucket`. This is
 * the read side of the transport `makeGcsSnapshotSink` writes to: the object is
 * public-read, so no credential is attached and nothing secret is involved.
 */
export function snapshotPublicUrl(
  bucket: string,
  fileName: string = SNAPSHOT_FILE_NAME,
): string {
  return `${GCS_PUBLIC_HOST}/${encodeURIComponent(bucket)}/${encodeURIComponent(fileName)}`;
}

/**
 * Injectable collaborators for {@link runFreshnessVerify}. Every field is
 * OPTIONAL with a hosted/default resolution so the entry runs live with no
 * arguments, yet a unit test can inject in-memory fixtures (an in-memory
 * `CandleStore` + a provided snapshot) to exercise it WITHOUT any network or
 * filesystem. No field carries a secret value.
 */
export interface FreshnessVerifyDeps {
  /** Resolved scheduled-run config (hosted Supabase + Decision_Date). */
  readonly config?: ScheduledRunConfig;
  /**
   * The READ-ONLY candle store. Defaults to the hosted Supabase candle adapter
   * (built from the resolved config). Only `getCoverageSummary` / `getCandles`
   * are ever queried — never `upsertCandles`.
   */
  readonly candleStore?: CandleStore;
  /** Injectable `fetch` passed to the Supabase builder AND the snapshot reader. */
  readonly fetchImpl?: typeof fetch;
  /**
   * The published snapshot object (already read). When provided it is used
   * directly, so a test supplies it with no I/O.
   */
  readonly snapshot?: VerifiableSnapshot;
  /**
   * A reader for the published snapshot. Defaults to fetching the public GCS
   * object named by `DASHBOARD_SNAPSHOT_BUCKET`. Overridden in tests to avoid
   * any network/filesystem.
   */
  readonly readSnapshot?: () => Promise<VerifiableSnapshot>;
  /** The environment the config readers read (defaults to `process.env`). */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** The verification helper. Defaults to the real `verifyFreshness`. */
  readonly verify?: typeof verifyFreshness;
}

/**
 * The outcome of a verification run. On a run it carries the read-only
 * `FreshnessVerificationResult`; when the published snapshot cannot be resolved
 * (no bucket configured, or the read failed) it returns `ranCheck: false` with a
 * secret-free reason — mirroring the backfill entry's `ranStage: false` degrade,
 * because a read-only check should log a secret-free skip rather than throw on a
 * mis-provisioned environment.
 */
export type FreshnessVerifyResult =
  | { readonly ranCheck: true; readonly result: FreshnessVerificationResult }
  | { readonly ranCheck: false; readonly reason: string };

/**
 * Fetch the published `dashboard.json` snapshot from the public-read GCS bucket
 * named by `DASHBOARD_SNAPSHOT_BUCKET` and return its `decisionDate` as a
 * {@link VerifiableSnapshot}. The object is public-read so no credential is
 * attached (secret-free). Returns `null` when no bucket is configured; throws on
 * a transport/parse failure so the caller can degrade to a secret-free skip.
 */
async function readPublishedSnapshot(
  bucket: string,
  fetchImpl: typeof fetch,
): Promise<VerifiableSnapshot> {
  const url = snapshotPublicUrl(bucket);
  const res = await fetchImpl(url);
  if (!res.ok) {
    // Secret-free: carry ONLY the status (no bucket contents, no credential).
    throw new Error(`snapshot read failed: HTTP ${res.status}`);
  }
  const body: unknown = await res.json();
  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as { decisionDate?: unknown }).decisionDate !== "string"
  ) {
    throw new Error("snapshot read failed: missing decisionDate");
  }
  return { decisionDate: (body as { decisionDate: string }).decisionDate };
}

/**
 * Run the read-only freshness verification: resolve config/env → acquire the
 * published snapshot (injected, or fetched from the public bucket) → build the
 * hosted READ-ONLY candle store → drive the SHARED `verifyFreshness` once →
 * report per pair the latest stored date vs target + residual gap, plus whether
 * the snapshot reflects fresh history (names/dates/counts only, no secrets).
 *
 * When the snapshot cannot be resolved (no bucket configured, or the read
 * failed) it logs a secret-free skip and returns `{ ranCheck: false }` WITHOUT
 * throwing — a read-only check degrades benignly on a mis-provisioned
 * environment. A residual gap on some pair is NOT a failure — it is reported in
 * the result.
 *
 * Collaborators are injectable so this is unit-testable without a live network;
 * the LIVE execution against the hosted DB is an OPERATOR action (the ☁️ step,
 * task 15).
 */
export async function runFreshnessVerify(
  deps: FreshnessVerifyDeps = {},
): Promise<FreshnessVerifyResult> {
  const env = deps.env ?? process.env;
  const config = deps.config ?? loadScheduledRunConfig(env);
  const fetchImpl = deps.fetchImpl ?? fetch;

  // Acquire the published snapshot. Prefer an injected object, then an injected
  // reader, then the live default (fetch the public GCS object). On any failure
  // to resolve it, degrade to a secret-free skip rather than throwing.
  let snapshot: VerifiableSnapshot;
  if (deps.snapshot !== undefined) {
    snapshot = deps.snapshot;
  } else {
    const bucket = config.dashboardSnapshotBucket;
    if (deps.readSnapshot === undefined && bucket === undefined) {
      console.log(
        JSON.stringify({
          event: "freshness_verify.skipped",
          reason: "no_snapshot_bucket_configured",
        }),
      );
      return {
        ranCheck: false,
        reason: "no dashboard snapshot bucket configured",
      };
    }
    try {
      snapshot =
        deps.readSnapshot !== undefined
          ? await deps.readSnapshot()
          : await readPublishedSnapshot(bucket as string, fetchImpl);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(
        JSON.stringify({
          event: "freshness_verify.skipped",
          reason: "snapshot_unavailable",
          message,
        }),
      );
      return { ranCheck: false, reason: "published snapshot unavailable" };
    }
  }

  // Build ONLY the read-only candle store. `verifyFreshness` queries
  // `getCoverageSummary` / `getCandles` and never writes.
  const candleStore =
    deps.candleStore ??
    buildSupabaseStores(config.supabase, deps.fetchImpl).candleStore;
  const verify = deps.verify ?? verifyFreshness;

  console.log(
    JSON.stringify({
      event: "freshness_verify.start",
      decisionDate: config.decisionDate,
      supabaseTarget: config.supabase.target,
      supabaseUrl: config.supabase.url,
    }),
  );

  const result = await verify({
    decisionDate: config.decisionDate,
    candleStore,
    snapshot,
  });

  // Per-pair finding — names/dates only, NO secret.
  for (const pair of result.pairs) {
    console.log(
      JSON.stringify({
        event: "freshness_verify.pair",
        pair: pair.pair,
        latestDate: pair.latestDate,
        target: pair.target,
        fresh: pair.fresh,
        residualGap: pair.residualGap,
      }),
    );
  }

  // Roll-up: the snapshot freshness and the overall verdict (names/dates only).
  console.log(
    JSON.stringify({
      event: "freshness_verify.rollup",
      target: result.target,
      snapshotDecisionDate: result.snapshotDecisionDate,
      snapshotReflectsFreshHistory: result.snapshotReflectsFreshHistory,
      pairs: result.pairs.length,
      pairsWithResidualGap: result.pairs
        .filter((p) => p.residualGap)
        .map((p) => p.pair),
      allFresh: result.allFresh,
    }),
  );

  return { ranCheck: true, result };
}

/**
 * Entry wrapper mirroring `candle-backfill/main.ts`: run the read-only
 * verification and emit secret-free structured logs. A residual gap or a stale
 * snapshot is NOT a failure exit — it is reported in the per-pair / roll-up
 * logs. Only an unexpected thrown error sets a non-zero exit code (handled by
 * the direct-invocation guard below).
 */
export async function main(): Promise<void> {
  await runFreshnessVerify();
}

/**
 * True iff this module is the process entry point, so importing it (e.g. from a
 * test) does NOT start a run. Mirrors the direct-invocation guard of
 * `candle-backfill/main.ts`.
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
    console.error(JSON.stringify({ event: "freshness_verify.error", message }));
    process.exitCode = 1;
  });
}
