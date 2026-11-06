import { describe, expect, it } from "vitest";

import { ok } from "../guard/types.js";
import type { ScheduledRunConfig } from "./config.js";
import type { SupabaseConfig } from "../storage/supabaseConfig.js";
import { InMemoryIntradayValidationStore } from "../intraday-validation/store.js";
import type { Intraday4hSource, OriginalPrediction } from "../intraday-validation/index.js";
import type { Intraday4hBar } from "../intraday-validation/types.js";
import { runIntradayValidationJob, type IntradayJobDeps } from "./intradayMain.js";
import type { PublishedSnapshot } from "./publishedSnapshot.js";
import type { DashboardSnapshot, SnapshotSink } from "./snapshot.js";

// Task 9: intraday Job entrypoint + isolation regression. These drive the
// injectable orchestration (no network). The Job reads the PUBLISHED daily
// snapshot, validates EVERY evaluated pair, and republishes the SAME snapshot with
// only `intradayValidation` replaced — so every other slice is byte-identical.

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

const source: Intraday4hSource = { fetch4h: () => Promise.resolve(ok([strongBull()])) };

/** A published daily snapshot: 5 evaluated pairs (2 fired, 3 not, incl. a FLAT) + other slices. */
function publishedSnapshot(decisionDate = "2026-11-06"): PublishedSnapshot {
  const ev = (pair: string, direction: string, conf: number, fired: boolean) => ({
    decision_date: decisionDate,
    pair,
    direction,
    horizon: 1,
    earned_confidence: conf,
    fired,
    choppiness: 0.4,
  });
  return {
    schemaVersion: 7,
    decisionDate,
    generatedAt: "2026-11-05T22:30:00.000Z",
    decisionDates: [decisionDate],
    firingSetups: [{ decision_date: decisionDate, pair: "GBPUSD", strategy_id: "system", direction: "DOWN" }],
    pairEvaluations: [
      ev("EURUSD", "UP", 0.5, false),
      ev("GBPUSD", "DOWN", 0.6, true),
      ev("USDJPY", "FLAT", 0.5, false),
      ev("USDCHF", "UP", 0.58333, true),
      ev("USDCAD", "DOWN", 0.52, false),
    ],
    confluence: { validationLabel: "unvalidated", pairs: [{ pair: "EURUSD" }] },
    trackRecord: { lookbackDays: 20, strategies: [{ pair: "EURUSD" }], rangeForecast: [] },
    signalScorecard: { totalRecorded: 30, rows: [] },
    dailyCommentary: { decision_date: decisionDate, note_text: "Quiet.", generated: true },
  };
}

/** A sink that captures the parsed snapshot written to dashboard.json. */
function capturingSink(captured: { snapshot: Record<string, unknown> | null }): SnapshotSink {
  return (_fileName, body) => {
    captured.snapshot = JSON.parse(body) as Record<string, unknown>;
    return Promise.resolve();
  };
}

function makeDeps(
  captured: { snapshot: Record<string, unknown> | null },
  options: {
    withSource?: boolean;
    published?: PublishedSnapshot | null;
    fallback?: readonly OriginalPrediction[];
    sink?: SnapshotSink;
  } = {},
): IntradayJobDeps {
  const published = options.published === undefined ? publishedSnapshot() : options.published;
  const base = {
    config: CONFIG,
    store: new InMemoryIntradayValidationStore(),
    loadPublished: () => Promise.resolve(published),
    loadFallbackOriginals: () => Promise.resolve(options.fallback ?? []),
    snapshotSink: options.sink ?? capturingSink(captured),
    now: NOW,
  } satisfies Partial<IntradayJobDeps>;
  return options.withSource === false
    ? { ...base, env: {} }
    : { ...base, source, env: { TWELVE_DATA_API_KEY: "key" } };
}

/** The snapshot with the intraday-owned keys removed (for byte-identity comparison). */
function withoutIntraday(snapshot: Record<string, unknown>): Record<string, unknown> {
  const { intradayValidation: _i, schemaVersion: _s, ...rest } = snapshot;
  void _i;
  void _s;
  return rest;
}

describe("runIntradayValidationJob", () => {
  it("validates EVERY evaluated pair (incl. FLAT and non-fired) and republishes a v8 snapshot", async () => {
    const captured: { snapshot: Record<string, unknown> | null } = { snapshot: null };
    const result = await runIntradayValidationJob(makeDeps(captured));

    expect(result.validated).toBe(5);
    expect(result.unavailable).toBe(0);
    expect(result.republished).toBe(true);

    const snap = captured.snapshot as unknown as DashboardSnapshot;
    expect(snap.schemaVersion).toBe(8);
    const rows = snap.intradayValidation.rows;
    expect(rows.map((r) => r.pair).sort()).toEqual(["EURUSD", "GBPUSD", "USDCAD", "USDCHF", "USDJPY"]);
    // A FLAT original direction is NOT_APPLICABLE with zero delta.
    expect(rows.find((r) => r.pair === "USDJPY")?.validationState).toBe("NOT_APPLICABLE");
    // Confidence is converted to percentage points (no float noise).
    expect(rows.find((r) => r.pair === "USDCHF")?.originalConfidence).toBe(58.33);
    // intradayValidation is the LAST key (byte order preserved).
    expect(Object.keys(snap).at(-1)).toBe("intradayValidation");
  });

  it("ISOLATION: every daily slice of the published snapshot is byte-identical after the Job", async () => {
    const before = publishedSnapshot();
    const captured: { snapshot: Record<string, unknown> | null } = { snapshot: null };
    await runIntradayValidationJob(makeDeps(captured, { published: before }));

    // Everything except the intraday-owned keys is untouched — including
    // pairEvaluations, confluence, trackRecord, signalScorecard and dailyCommentary.
    expect(JSON.stringify(withoutIntraday(captured.snapshot!))).toBe(
      JSON.stringify(withoutIntraday(before as Record<string, unknown>)),
    );
  });

  it("ISOLATION: the daily slices are also unchanged when the provider is not configured", async () => {
    const before = publishedSnapshot();
    const captured: { snapshot: Record<string, unknown> | null } = { snapshot: null };
    const result = await runIntradayValidationJob(
      makeDeps(captured, { withSource: false, published: before }),
    );
    expect(result.validated).toBe(0);
    expect(result.republished).toBe(true);
    expect(JSON.stringify(withoutIntraday(captured.snapshot!))).toBe(
      JSON.stringify(withoutIntraday(before as Record<string, unknown>)),
    );
    expect((captured.snapshot!.intradayValidation as { rows: unknown[] }).rows).toHaveLength(0);
  });

  it("SKIPS the republish (never publishes a degraded file) when no published snapshot is readable", async () => {
    const captured: { snapshot: Record<string, unknown> | null } = { snapshot: null };
    const result = await runIntradayValidationJob(makeDeps(captured, { published: null }));
    expect(result.republished).toBe(false);
    expect(captured.snapshot).toBeNull();
  });

  it("SKIPS the republish when the published snapshot is for a different Decision_Date", async () => {
    const captured: { snapshot: Record<string, unknown> | null } = { snapshot: null };
    const result = await runIntradayValidationJob(
      makeDeps(captured, { published: publishedSnapshot("2026-11-05") }),
    );
    expect(result.republished).toBe(false);
    expect(captured.snapshot).toBeNull();
  });

  it("falls back to the fired firing_setups when the published snapshot has no evaluations", async () => {
    const captured: { snapshot: Record<string, unknown> | null } = { snapshot: null };
    const noEvals = { ...publishedSnapshot(), pairEvaluations: [] };
    const result = await runIntradayValidationJob(
      makeDeps(captured, {
        published: noEvals,
        fallback: [{ pair: "GBPUSD", direction: "DOWN", confidence: 60 }],
      }),
    );
    expect(result.validated).toBe(1);
  });

  it("does not throw when a sink write fails (republished=false)", async () => {
    const result = await runIntradayValidationJob(
      makeDeps(
        { snapshot: null },
        { sink: () => Promise.reject(new Error("upload failed")) },
      ),
    );
    expect(result.republished).toBe(false);
    expect(result.validated).toBe(5);
  });
});
