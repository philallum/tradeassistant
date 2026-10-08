// Unit tests — one-off backfill operator entry over in-memory fixtures (Task
// 12.1; design Component 7, Requirements 5.1, 5.2, 5.3).
//
// Drives `runCandleBackfill` with injected deps so NO live network is touched:
// a stub `ProviderChain` whose `resolveRange` returns in-memory `RawCandle[]`,
// the in-memory `CandleStore` / `PatternVectorStore`, and a REAL `OhlcIngestion`
// — so the genuine validate → NY-close normalize → look-ahead guard → idempotent
// upsert → encode path is exercised end-to-end.
//
// Asserts (a) with a provider configured the stage runs for all five pairs and
// reports a per-pair new latest date + residual gap; (b) a second run over the
// same stores adds no duplicate candles (idempotent, R5.2); (c) with no provider
// configured it returns `{ ranStage: false }` without throwing and logs a
// secret-free skip; (d) no secret / API-key value appears in any logged line.
//
// The console-capture + secret-leak assertion pattern mirrors
// `src/scheduled-run/freshenCandles.test.ts`.

import { describe, expect, it, vi } from "vitest";

import {
  runCandleBackfill,
  type CandleBackfillDeps,
  type CandleBackfillStores,
} from "./main.js";
import { OhlcIngestion } from "../../ingestion/ohlcIngestion.js";
import { InMemoryCandleStore, PAIRS } from "../../ingestion/types.js";
import type { Pair, RawCandle } from "../../ingestion/types.js";
import { InMemoryPatternVectorStore } from "../../encoder/types.js";
import type {
  ProviderChain,
  ResolveOutcome,
} from "../../ingestion/ohlcFeed/providerChain.js";
import type { ScheduledRunConfig } from "../../scheduled-run/config.js";
import type { TradingDate } from "../../guard/types.js";

const DECISION_DATE: TradingDate = "2026-10-05"; // Monday (a trading day)
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

/** In-memory stores so no injected builder ever touches the network. */
function makeStores(): CandleBackfillStores & {
  candleStore: InMemoryCandleStore;
  vectorStore: InMemoryPatternVectorStore;
} {
  return {
    candleStore: new InMemoryCandleStore(),
    vectorStore: new InMemoryPatternVectorStore(),
  };
}

/**
 * A tiny daily-candle series for a pair over consecutive weekdays ending just
 * before the Decision_Date, all look-ahead safe (strictly before the date).
 * The provider provenance name is stamped on `source` so the summary can report
 * the winning provider without any secret.
 */
function rangeCandles(pair: Pair): readonly RawCandle[] {
  // Weekdays leading up to (but before) 2026-10-05 — a ~3-week-behind backfill.
  const dates = [
    "2026-09-16",
    "2026-09-17",
    "2026-09-18",
    "2026-09-21",
    "2026-09-22",
    "2026-09-23",
    "2026-09-24",
    "2026-09-25",
    "2026-09-28",
    "2026-09-29",
    "2026-09-30",
    "2026-10-01",
    "2026-10-02",
  ];
  return dates.map((date) => ({
    pair,
    date,
    open: 1.1,
    high: 1.2,
    low: 1.0,
    close: 1.15,
    source: "TwelveData",
  }));
}

/**
 * A stub Provider_Fallback_Chain: FCS cannot serve a range so a real chain would
 * skip it; this stub models the net effect — `resolveRange` wins on TwelveData,
 * `resolveLatest` is unused for a multi-week backfill but defined for shape.
 */
function makeStubChain(): ProviderChain {
  return {
    providerNames: ["FCS", "TwelveData", "Massive"],
    resolveLatest: (pairs: readonly Pair[]) => {
      const out = new Map<Pair, ResolveOutcome>();
      for (const pair of pairs) {
        out.set(pair, { candles: rangeCandles(pair).slice(-1), provider: "TwelveData" });
      }
      return Promise.resolve(out);
    },
    resolveRange: (pair: Pair) =>
      Promise.resolve<ResolveOutcome>({
        candles: rangeCandles(pair),
        provider: "TwelveData",
      }),
  };
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

/** Count all stored candles across the five pairs. */
async function storedCount(store: InMemoryCandleStore): Promise<number> {
  let total = 0;
  for (const pair of PAIRS) {
    const candles = await store.getCandles(pair);
    total += candles.length;
  }
  return total;
}

describe("runCandleBackfill one-off operator entry", () => {
  it("(a) runs the stage for all five pairs and reports new latest date + residual gap", async () => {
    const console_ = captureConsole();
    try {
      const stores = makeStores();
      const deps: CandleBackfillDeps = {
        config: makeConfig(),
        stores,
        chain: makeStubChain(),
        ingestion: new OhlcIngestion(stores.candleStore),
        env: {},
      };

      const result = await runCandleBackfill(deps);

      expect(result.ranStage).toBe(true);
      if (!result.ranStage) return;

      // One summary per pair, each reporting the winning provider, a new latest
      // stored date, and whether a residual gap remains.
      expect(result.summaries).toHaveLength(PAIRS.length);
      for (const pair of PAIRS) {
        const summary = result.summaries.find((s) => s.pair === pair);
        expect(summary).toBeDefined();
        expect(summary?.provider).toBe("TwelveData");
        expect(summary?.accepted).toBeGreaterThan(0);
        // The latest stored date advanced to the last range candle.
        expect(summary?.latestDate).toBe("2026-10-02");
        expect(summary?.target).toBe("2026-10-02"); // most recent completed trading day
        expect(summary?.residualGap).toBe(false);
      }

      // Candles were actually stored for every pair through the real ingest path.
      expect(await storedCount(stores.candleStore)).toBeGreaterThan(0);

      // The structured logs name the events, pairs, and provenance.
      const logs = console_.logs();
      expect(logs).toContain("candle_backfill.start");
      expect(logs).toContain("candle_backfill.recorded");
      expect(logs).toContain("candle_backfill.rollup");
      expect(logs).toContain("TwelveData");
    } finally {
      console_.restore();
    }
  });

  it("(b) is idempotent: a second run over the same stores adds no duplicate candles", async () => {
    const console_ = captureConsole();
    try {
      const stores = makeStores();
      const deps: CandleBackfillDeps = {
        config: makeConfig(),
        stores,
        chain: makeStubChain(),
        ingestion: new OhlcIngestion(stores.candleStore),
        env: {},
      };

      await runCandleBackfill(deps);
      const afterFirst = await storedCount(stores.candleStore);
      expect(afterFirst).toBeGreaterThan(0);

      // Re-run over the SAME in-memory stores: the idempotent (asset, date)
      // upsert must not grow the stored set.
      await runCandleBackfill(deps);
      const afterSecond = await storedCount(stores.candleStore);

      expect(afterSecond).toBe(afterFirst);
    } finally {
      console_.restore();
    }
  });

  it("(c) returns ranStage:false and does NOT throw when no provider is configured", async () => {
    const console_ = captureConsole();
    try {
      const runStage = vi.fn(() => Promise.resolve([]));
      const deps: CandleBackfillDeps = {
        config: makeConfig(),
        // Empty env ⇒ ohlcFeedConfigFromEnv returns { providers: [] }; no chain
        // injected ⇒ the entry skips before building stores/chain.
        env: {},
        runStage,
      };

      const result = await runCandleBackfill(deps);

      expect(result.ranStage).toBe(false);
      if (result.ranStage) return;
      expect(result.reason).toContain("no OHLC feed provider");
      expect(runStage).not.toHaveBeenCalled();

      const logs = console_.logs();
      expect(logs).toContain("candle_backfill.skipped");
      expect(logs).toContain("no_provider_configured");
    } finally {
      console_.restore();
    }
  });

  it("(d) never logs a secret / API-key value in any line", async () => {
    const console_ = captureConsole();
    try {
      const stores = makeStores();
      const deps: CandleBackfillDeps = {
        config: makeConfig(),
        stores,
        chain: makeStubChain(),
        ingestion: new OhlcIngestion(stores.candleStore),
        // A provider key present in env must never surface in a log line.
        env: { EXTERNAL_SIGNAL_API_KEY: API_KEY_SENTINEL },
      };

      await runCandleBackfill(deps);

      const all = `${console_.logs()}\n${console_.errors()}`;
      expect(all).not.toContain(API_KEY_SENTINEL);
      expect(all).not.toContain(SUPABASE_KEY_SENTINEL);
      // The non-secret target / url references ARE present.
      expect(all).toContain("https://example.test");
    } finally {
      console_.restore();
    }
  });
});
