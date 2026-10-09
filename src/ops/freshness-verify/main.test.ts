// Unit tests — read-only freshness-verification operator entry over in-memory
// fixtures (Task 15 LOCAL half; design Component 8, Requirements 6.1, 6.2).
//
// Drives `runFreshnessVerify` with injected deps so NO live network and NO
// filesystem are touched: an in-memory `CandleStore` (`InMemoryCandleStore`)
// seeded via the real `OhlcIngestion` validate/normalize path, and an injected
// snapshot object. A REAL `verifyFreshness` is used so the genuine
// latest-vs-target + snapshot-reflects-fresh-history logic is exercised.
//
// Asserts (a) all pairs fresh + a snapshot at/after the run date ⇒
// `allFresh === true` and NO write occurred; (b) a stale pair ⇒ that pair
// reports `residualGap === true` and `allFresh === false`; (c) the entry
// performs NO write — a read-only `CandleStore` whose `upsertCandles` throws is
// never called (the pattern from `freshnessVerification.test.ts`); (d) no
// secret value appears in any logged line; (e) importing the module does not
// start a run (the `invokedDirectly` guard).
//
// The console-capture + secret-leak assertion pattern mirrors
// `src/ops/candle-backfill/main.test.ts`.

import { describe, expect, it, vi } from "vitest";

import {
  runFreshnessVerify,
  type FreshnessVerifyDeps,
} from "./main.js";
import { OhlcIngestion } from "../../ingestion/ohlcIngestion.js";
import {
  InMemoryCandleStore,
  PAIRS,
  type CandleStore,
  type Pair,
  type PerPairCoverage,
  type RawCandle,
} from "../../ingestion/types.js";
import { mostRecentCompletedTradingDay } from "../../scheduled-run/completedTradingDay.js";
import {
  verifyFreshness,
  type VerifiableSnapshot,
} from "../../scheduled-run/freshnessVerification.js";
import type { ScheduledRunConfig } from "../../scheduled-run/config.js";
import type { TradingDate } from "../../guard/types.js";

const DECISION_DATE: TradingDate = "2026-09-17"; // Thursday (a trading day)
// target = most recent Completed_Trading_Day = 2026-09-16 (Wednesday).
const TARGET = mostRecentCompletedTradingDay(DECISION_DATE);
const SUPABASE_KEY_SENTINEL = "supabase-key-must-never-be-logged";
const API_KEY_SENTINEL = "fcs-api-key-must-never-be-logged";

/** A minimal config carrying only what the entry reads. */
function makeConfig(): ScheduledRunConfig {
  return {
    decisionDate: DECISION_DATE,
    supabase: {
      target: "test",
      url: "https://example.test",
      key: SUPABASE_KEY_SENTINEL,
    },
  } as unknown as ScheduledRunConfig;
}

function candle(pair: Pair, date: TradingDate): RawCandle {
  return { asset: pair, pair, date, open: 1.1, high: 1.2, low: 1.0, close: 1.15, source: "stub" };
}

async function seedPair(
  store: InMemoryCandleStore,
  pair: Pair,
  dates: readonly TradingDate[],
): Promise<void> {
  const ingestion = new OhlcIngestion(store);
  await ingestion.ingest(
    pair,
    dates.map((d) => candle(pair, d)),
  );
}

function snapshot(decisionDate: TradingDate): VerifiableSnapshot {
  return { decisionDate };
}

/** Capture every console line a run emitted, as secret-free strings. */
function captureConsole(): {
  logs: () => string;
  errors: () => string;
  restore: () => void;
} {
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  const flat = (spy: typeof logSpy): string =>
    spy.mock.calls
      .flat()
      .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
      .join("\n");
  return {
    logs: () => flat(logSpy),
    errors: () => flat(errSpy),
    restore: () => {
      logSpy.mockRestore();
      errSpy.mockRestore();
    },
  };
}

describe("runFreshnessVerify read-only operator entry", () => {
  it("(a) reports allFresh when every pair is fresh and the snapshot is at/after the run date", async () => {
    const console_ = captureConsole();
    try {
      const store = new InMemoryCandleStore();
      // Seed every pair right up to the target → fresh.
      for (const pair of PAIRS) {
        await seedPair(store, pair, ["2026-09-15", TARGET]);
      }

      const deps: FreshnessVerifyDeps = {
        config: makeConfig(),
        candleStore: store,
        snapshot: snapshot(DECISION_DATE),
        env: {},
      };

      const result = await runFreshnessVerify(deps);

      expect(result.ranCheck).toBe(true);
      if (!result.ranCheck) return;

      expect(result.result.allFresh).toBe(true);
      expect(result.result.snapshotReflectsFreshHistory).toBe(true);
      expect(result.result.pairs).toHaveLength(PAIRS.length);
      for (const pair of result.result.pairs) {
        expect(pair.latestDate).toBe(TARGET);
        expect(pair.target).toBe(TARGET);
        expect(pair.fresh).toBe(true);
        expect(pair.residualGap).toBe(false);
      }

      const logs = console_.logs();
      expect(logs).toContain("freshness_verify.start");
      expect(logs).toContain("freshness_verify.pair");
      expect(logs).toContain("freshness_verify.rollup");
    } finally {
      console_.restore();
    }
  });

  it("(b) a stale pair reports residualGap and allFresh is false", async () => {
    const console_ = captureConsole();
    try {
      const store = new InMemoryCandleStore();
      // Every pair fresh except GBPUSD, which is several trading days behind.
      for (const pair of PAIRS) {
        if (pair === "GBPUSD") {
          await seedPair(store, pair, ["2026-09-09"]);
        } else {
          await seedPair(store, pair, [TARGET]);
        }
      }

      const deps: FreshnessVerifyDeps = {
        config: makeConfig(),
        candleStore: store,
        snapshot: snapshot(DECISION_DATE),
        env: {},
      };

      const result = await runFreshnessVerify(deps);

      expect(result.ranCheck).toBe(true);
      if (!result.ranCheck) return;

      const gbp = result.result.pairs.find((p) => p.pair === "GBPUSD");
      expect(gbp?.latestDate).toBe("2026-09-09");
      expect(gbp?.fresh).toBe(false);
      expect(gbp?.residualGap).toBe(true);

      expect(result.result.allFresh).toBe(false);

      const logs = console_.logs();
      expect(logs).toContain("GBPUSD");
      expect(logs).toContain("freshness_verify.rollup");
    } finally {
      console_.restore();
    }
  });

  it("(c) performs NO write: upsertCandles is never called", async () => {
    const console_ = captureConsole();
    try {
      const backing = new InMemoryCandleStore();
      for (const pair of PAIRS) {
        await seedPair(backing, pair, [TARGET]);
      }

      // Wrap the store so any mutating call fails the test.
      const readOnly: CandleStore = {
        getCoverageSummary: (): Promise<readonly PerPairCoverage[]> =>
          backing.getCoverageSummary(),
        getCandles: (asset, startDate, endDate) =>
          backing.getCandles(asset, startDate, endDate),
        upsertCandles: (): Promise<void> => {
          throw new Error("runFreshnessVerify must not write (upsertCandles called)");
        },
      };

      const deps: FreshnessVerifyDeps = {
        config: makeConfig(),
        candleStore: readOnly,
        snapshot: snapshot(DECISION_DATE),
        env: {},
      };

      const result = await runFreshnessVerify(deps);
      expect(result.ranCheck).toBe(true);
    } finally {
      console_.restore();
    }
  });

  it("(d) never logs a secret / API-key value in any line", async () => {
    const console_ = captureConsole();
    try {
      const store = new InMemoryCandleStore();
      for (const pair of PAIRS) {
        await seedPair(store, pair, [TARGET]);
      }

      const deps: FreshnessVerifyDeps = {
        config: makeConfig(),
        candleStore: store,
        snapshot: snapshot(DECISION_DATE),
        // A provider key present in env must never surface in a log line.
        env: { EXTERNAL_SIGNAL_API_KEY: API_KEY_SENTINEL },
      };

      await runFreshnessVerify(deps);

      const all = `${console_.logs()}\n${console_.errors()}`;
      expect(all).not.toContain(API_KEY_SENTINEL);
      expect(all).not.toContain(SUPABASE_KEY_SENTINEL);
      // The non-secret target / url references ARE present.
      expect(all).toContain("https://example.test");
    } finally {
      console_.restore();
    }
  });

  it("(e) uses an injected readSnapshot without any network and reports its decisionDate", async () => {
    const console_ = captureConsole();
    try {
      const store = new InMemoryCandleStore();
      for (const pair of PAIRS) {
        await seedPair(store, pair, [TARGET]);
      }

      const readSnapshot = vi.fn(() => Promise.resolve(snapshot(DECISION_DATE)));
      const deps: FreshnessVerifyDeps = {
        config: makeConfig(),
        candleStore: store,
        readSnapshot,
        env: {},
      };

      const result = await runFreshnessVerify(deps);

      expect(readSnapshot).toHaveBeenCalledTimes(1);
      expect(result.ranCheck).toBe(true);
      if (!result.ranCheck) return;
      expect(result.result.snapshotDecisionDate).toBe(DECISION_DATE);
    } finally {
      console_.restore();
    }
  });

  it("(f) returns ranCheck:false and does NOT throw when no snapshot bucket is configured", async () => {
    const console_ = captureConsole();
    try {
      const verify = vi.fn<typeof verifyFreshness>();
      const deps: FreshnessVerifyDeps = {
        // No snapshot, no readSnapshot, and a config without a bucket ⇒ skip
        // before building any store or calling verify.
        config: makeConfig(),
        env: {},
        verify,
      };

      const result = await runFreshnessVerify(deps);

      expect(result.ranCheck).toBe(false);
      if (result.ranCheck) return;
      expect(result.reason).toContain("snapshot bucket");
      expect(verify).not.toHaveBeenCalled();

      const logs = console_.logs();
      expect(logs).toContain("freshness_verify.skipped");
      expect(logs).toContain("no_snapshot_bucket_configured");
    } finally {
      console_.restore();
    }
  });
});

describe("freshness-verify module import", () => {
  it("(g) importing the module does not start a run (invokedDirectly guard)", async () => {
    const console_ = captureConsole();
    try {
      const mod = await import("./main.js");
      expect(typeof mod.runFreshnessVerify).toBe("function");
      expect(typeof mod.main).toBe("function");
      // No run was triggered by import: no run-lifecycle events were logged.
      const logs = console_.logs();
      expect(logs).not.toContain("freshness_verify.start");
      expect(logs).not.toContain("freshness_verify.rollup");
    } finally {
      console_.restore();
    }
  });
});
