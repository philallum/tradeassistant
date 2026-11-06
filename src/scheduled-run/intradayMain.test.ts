import { describe, expect, it } from "vitest";

import { ok } from "../guard/types.js";
import type { ScheduledRunConfig } from "./config.js";
import type { SupabaseConfig } from "../storage/supabaseConfig.js";
import { InMemoryIntradayValidationStore } from "../intraday-validation/store.js";
import type { Intraday4hSource, OriginalPrediction } from "../intraday-validation/index.js";
import type { Intraday4hBar } from "../intraday-validation/types.js";
import {
  runIntradayValidationJob,
  type IntradayJobDeps,
} from "./intradayMain.js";
import type { DashboardSnapshot, SnapshotSink } from "./snapshot.js";

// Task 9: intraday Job entrypoint + isolation regression. These drive the
// injectable orchestration (no network): the Job validates, persists, and
// republishes a v8 snapshot; a no-source run still republishes an empty slice;
// and the daily firing rows in the republished snapshot are byte-identical with
// and without the intraday validation (isolation).

const SUPABASE: SupabaseConfig = {
  target: "hosted",
  url: "https://proj.supabase.co",
  key: "scoped-write-jwt",
  apiKey: "sb_publishable_anon",
};

const CONFIG: ScheduledRunConfig = {
  decisionDate: "2026-11-06",
  supabase: SUPABASE,
  gcpProject: undefined,
  gcpRegion: undefined,
  geminiModel: undefined,
  dashboardSnapshotBucket: undefined,
};

const NOW = new Date("2026-11-06T06:30:00.000Z");
const BAR_OPEN = "2026-11-06T04:00:00.000Z";

function strongBull(): Intraday4hBar {
  return { openTimeUtc: BAR_OPEN, open: 1.0, high: 1.102, low: 0.99, currentPrice: 1.1 };
}

const ORIGINALS: readonly OriginalPrediction[] = [{ pair: "EURUSD", direction: "UP", confidence: 58 }];

const source: Intraday4hSource = { fetch4h: () => Promise.resolve(ok([strongBull()])) };

/** A sink that captures the parsed snapshot written to dashboard.json. */
function capturingSink(captured: { snapshot: DashboardSnapshot | null }): SnapshotSink {
  return (_fileName, body) => {
    captured.snapshot = JSON.parse(body) as DashboardSnapshot;
    return Promise.resolve();
  };
}

/** The daily firing rows the republish reads back from history (the source of truth). */
const DAILY_FIRING = [
  {
    decision_date: "2026-11-06",
    pair: "EURUSD",
    strategy_id: "system",
    direction: "UP" as const,
    horizon: 2 as const,
    earned_confidence: 0.58,
    stop_loss_pips: 40,
    take_profit_pips: 60,
    surfaced: true,
    suppression_reason: null,
  },
];

/**
 * Build the base Job deps. `withSource` controls whether a 4H source is wired
 * (the "no provider configured" case omits it entirely and passes an empty env,
 * so `buildSourceFromEnv` returns null). The history read-back (the daily firing
 * rows, the source of truth) is injected so no live Supabase read is attempted.
 */
function makeDeps(
  captured: { snapshot: DashboardSnapshot | null },
  options: { withSource: boolean; sink?: SnapshotSink } = { withSource: true },
): IntradayJobDeps {
  const base = {
    config: CONFIG,
    store: new InMemoryIntradayValidationStore(),
    loadOriginals: () => Promise.resolve(ORIGINALS),
    snapshotSink: options.sink ?? capturingSink(captured),
    now: NOW,
    loadHistory: () => Promise.resolve({ firingSetups: DAILY_FIRING }),
  } satisfies Partial<IntradayJobDeps>;

  return options.withSource
    ? { ...base, source, env: { TWELVE_DATA_API_KEY: "key" } }
    : { ...base, env: {} };
}

describe("runIntradayValidationJob", () => {
  it("validates, persists, and republishes a v8 snapshot with the slice filled", async () => {
    const captured: { snapshot: DashboardSnapshot | null } = { snapshot: null };
    const result = await runIntradayValidationJob(makeDeps(captured));

    expect(result.validated).toBe(1);
    expect(result.unavailable).toBe(0);
    expect(result.republished).toBe(true);

    const snap = captured.snapshot!;
    expect(snap.schemaVersion).toBe(8);
    expect(snap.intradayValidation.rows).toHaveLength(1);
    expect(snap.intradayValidation.rows[0]?.validationState).toBe("STRONGLY_SUPPORTS");
    expect(snap.intradayValidation.rows[0]?.currentConfidence).toBe(68);
    // intradayValidation is the LAST key (byte order preserved).
    expect(Object.keys(snap).at(-1)).toBe("intradayValidation");
  });

  it("republishes an EMPTY slice when no provider is configured (fail-safe)", async () => {
    const captured: { snapshot: DashboardSnapshot | null } = { snapshot: null };
    const result = await runIntradayValidationJob(
      makeDeps(captured, { withSource: false }), // no TWELVE_DATA_API_KEY
    );
    expect(result.validated).toBe(0);
    expect(result.republished).toBe(true);
    expect(captured.snapshot!.intradayValidation.rows).toHaveLength(0);
  });

  it("ISOLATION: the daily firing rows are byte-identical with and without validation", async () => {
    const withCaptured: { snapshot: DashboardSnapshot | null } = { snapshot: null };
    await runIntradayValidationJob(makeDeps(withCaptured));

    const withoutCaptured: { snapshot: DashboardSnapshot | null } = { snapshot: null };
    await runIntradayValidationJob(makeDeps(withoutCaptured, { withSource: false }));

    // The daily forecast slice is identical regardless of the intraday outcome.
    expect(JSON.stringify(withCaptured.snapshot!.firingSetups)).toBe(
      JSON.stringify(withoutCaptured.snapshot!.firingSetups),
    );
    // And it matches the source-of-truth history verbatim (never recomputed).
    expect(JSON.stringify(withCaptured.snapshot!.firingSetups)).toBe(JSON.stringify(DAILY_FIRING));
  });

  it("does not throw when a sink write fails (republished=false)", async () => {
    const result = await runIntradayValidationJob(
      makeDeps(
        { snapshot: null },
        { withSource: true, sink: () => Promise.reject(new Error("upload failed")) },
      ),
    );
    expect(result.republished).toBe(false);
    expect(result.validated).toBe(1);
  });
});
