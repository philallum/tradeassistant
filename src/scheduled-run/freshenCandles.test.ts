import { describe, expect, it, vi } from "vitest";

import { freshenCandles, logFreshnessDegradation, type FreshenCandlesDeps } from "./main.js";
import type { loadScheduledRunConfig } from "./config.js";
import type { CandleFreshnessDeps, CandleFreshnessPairSummary } from "./candleFreshness.js";
import { InMemoryCandleStore } from "../ingestion/types.js";
import { InMemoryPatternVectorStore } from "../encoder/types.js";
import type { TradingDate } from "../guard/types.js";

// Unit tests for the Candle_Freshness_Stage daily-entry wiring (Task 11.1;
// R2.1, 1.4, 1.5, 4.1). Because `main()` is a process entry, the wiring is
// tested through the extracted `freshenCandles(config, deps)` seam with injected
// `buildStores` / `runStage` so NO live network is touched.

type Config = ReturnType<typeof loadScheduledRunConfig>;

const DECISION_DATE: TradingDate = "2026-09-17"; // Thursday (a trading day)

/** A minimal config carrying only what `freshenCandles` reads. */
function makeConfig(): Config {
  return {
    decisionDate: DECISION_DATE,
    supabase: { target: "test", url: "https://example.test", key: "unused" },
  } as unknown as Config;
}

/** In-memory stores so the injected `buildStores` never touches the network. */
function makeStores(): { candleStore: InMemoryCandleStore; vectorStore: InMemoryPatternVectorStore } {
  return {
    candleStore: new InMemoryCandleStore(),
    vectorStore: new InMemoryPatternVectorStore(),
  };
}

/** Capture every console line a run emitted, as secret-free strings. */
function captureConsole(): {
  logs: () => string;
  warnings: () => string;
  restore: () => void;
} {
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  const flat = (spy: typeof logSpy): string =>
    spy.mock.calls
      .flat()
      .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
      .join("\n");
  return {
    logs: () => flat(logSpy),
    warnings: () => flat(warnSpy),
    restore: () => {
      logSpy.mockRestore();
      warnSpy.mockRestore();
    },
  };
}

describe("freshenCandles daily-entry wiring", () => {
  it("(a) skips the stage with a secret-free warning when no provider is configured", async () => {
    const console_ = captureConsole();
    try {
      const runStage = vi.fn(
        (): Promise<readonly CandleFreshnessPairSummary[]> => Promise.resolve([]),
      );
      const buildStores = vi.fn();
      const deps: FreshenCandlesDeps = {
        // Empty env ⇒ ohlcFeedConfigFromEnv returns { providers: [] }.
        env: {},
        runStage,
        buildStores,
      };

      await freshenCandles(makeConfig(), deps);

      expect(runStage).not.toHaveBeenCalled();
      expect(buildStores).not.toHaveBeenCalled();

      const warnings = console_.warnings();
      expect(warnings).toContain("startup_warning");
      expect(warnings).toContain("candle_freshness");
      expect(warnings).toContain("no OHLC feed provider configured");
    } finally {
      console_.restore();
    }
  });

  it("(b) runs the stage with wired deps when a provider is configured", async () => {
    const console_ = captureConsole();
    try {
      const stores = makeStores();
      let captured: CandleFreshnessDeps | undefined;
      const runStage = vi.fn((stageDeps: CandleFreshnessDeps) => {
        captured = stageDeps;
        return Promise.resolve<readonly CandleFreshnessPairSummary[]>([]);
      });
      const buildStores = vi.fn(() => stores);
      const deps: FreshenCandlesDeps = {
        // A Twelve Data key present ⇒ a non-empty provider list ⇒ the stage runs.
        env: { TWELVE_DATA_API_KEY: "td-key-not-logged" },
        runStage,
        buildStores,
      };

      await freshenCandles(makeConfig(), deps);

      expect(buildStores).toHaveBeenCalledTimes(1);
      expect(runStage).toHaveBeenCalledTimes(1);
      expect(captured).toBeDefined();
      expect(captured?.decisionDate).toBe(DECISION_DATE);
      expect(captured?.candleStore).toBe(stores.candleStore);
      expect(captured?.vectorStore).toBe(stores.vectorStore);
      expect(captured?.chain.providerNames).toContain("TwelveData");
      expect(captured?.maxLookbackTradingDays).toBeGreaterThan(0);

      // The start/complete logs are structured and carry no key value.
      const logs = console_.logs();
      expect(logs).toContain("candle_freshness.start");
      expect(logs).toContain("candle_freshness.complete");
      expect(logs).not.toContain("fcs-key-not-logged");
      expect(console_.warnings()).not.toContain("fcs-key-not-logged");
    } finally {
      console_.restore();
    }
  });

  it("(b2) emits a high-severity candle_freshness.degraded event when a pair is left behind", async () => {
    const console_ = captureConsole();
    try {
      const stores = makeStores();
      // A degraded EURUSD (no provider served it) + an up-to-date GBPUSD.
      const summaries: readonly CandleFreshnessPairSummary[] = [
        {
          pair: "EURUSD",
          gap: "backfill",
          provider: null,
          fetched: 0,
          accepted: 0,
          rejected: 0,
          latestDate: "2026-09-10",
          target: "2026-09-16",
          residualGap: true,
          degraded: true,
        },
        {
          pair: "GBPUSD",
          gap: "up_to_date",
          provider: null,
          fetched: 0,
          accepted: 0,
          rejected: 0,
          latestDate: "2026-09-16",
          target: "2026-09-16",
          residualGap: false,
          degraded: false,
        },
      ];
      const runStage = vi.fn(
        (): Promise<readonly CandleFreshnessPairSummary[]> => Promise.resolve(summaries),
      );
      const deps: FreshenCandlesDeps = {
        env: { TWELVE_DATA_API_KEY: "td-key-not-logged" },
        runStage,
        buildStores: vi.fn(() => stores),
        sleep: () => Promise.resolve(),
      };

      await freshenCandles(makeConfig(), deps);

      const logs = console_.logs();
      expect(logs).toContain("candle_freshness.degraded");
      expect(logs).toContain("\"severity\":\"ERROR\"");
      // Names the behind pair, not the fresh one.
      expect(logs).toContain("EURUSD");
      expect(logs).not.toContain("fcs-key-not-logged");
    } finally {
      console_.restore();
    }
  });

  describe("retry while a pair is still behind", () => {
    const summary = (behind: boolean): CandleFreshnessPairSummary => ({
      pair: "EURUSD",
      gap: behind ? "top_up" : "up_to_date",
      provider: null,
      fetched: 0,
      accepted: 0,
      rejected: 0,
      latestDate: behind ? "2026-09-15" : "2026-09-16",
      target: "2026-09-16",
      residualGap: behind,
      degraded: false,
    });

    it("retries until the candle appears, waiting between attempts, then logs no degradation", async () => {
      const console_ = captureConsole();
      try {
        const results = [[summary(true)], [summary(true)], [summary(false)]];
        const runStage = vi.fn(
          (): Promise<readonly CandleFreshnessPairSummary[]> =>
            Promise.resolve(results.shift() ?? [summary(false)]),
        );
        const sleep = vi.fn(() => Promise.resolve());
        await freshenCandles(makeConfig(), {
          env: { TWELVE_DATA_API_KEY: "k", CANDLE_FRESHNESS_RETRY_DELAY_SECONDS: "7" },
          runStage,
          buildStores: vi.fn(() => makeStores()),
          sleep,
        });
        expect(runStage).toHaveBeenCalledTimes(3);
        expect(sleep).toHaveBeenCalledTimes(2);
        expect(sleep).toHaveBeenCalledWith(7000);
        expect(console_.logs()).toContain("candle_freshness.retry");
        expect(console_.logs()).not.toContain("candle_freshness.degraded");
      } finally {
        console_.restore();
      }
    });

    it("gives up after the bounded number of retries and still logs the degradation", async () => {
      const console_ = captureConsole();
      try {
        const runStage = vi.fn(
          (): Promise<readonly CandleFreshnessPairSummary[]> => Promise.resolve([summary(true)]),
        );
        await freshenCandles(makeConfig(), {
          env: { TWELVE_DATA_API_KEY: "k", CANDLE_FRESHNESS_RETRY_ATTEMPTS: "2" },
          runStage,
          buildStores: vi.fn(() => makeStores()),
          sleep: () => Promise.resolve(),
        });
        expect(runStage).toHaveBeenCalledTimes(3); // 1 + 2 retries
        expect(console_.logs()).toContain("candle_freshness.degraded");
      } finally {
        console_.restore();
      }
    });

    it("does not retry when retries are disabled or nothing is behind", async () => {
      const console_ = captureConsole();
      try {
        const behind = vi.fn(
          (): Promise<readonly CandleFreshnessPairSummary[]> => Promise.resolve([summary(true)]),
        );
        const sleep = vi.fn(() => Promise.resolve());
        await freshenCandles(makeConfig(), {
          env: { TWELVE_DATA_API_KEY: "k", CANDLE_FRESHNESS_RETRY_ATTEMPTS: "0" },
          runStage: behind,
          buildStores: vi.fn(() => makeStores()),
          sleep,
        });
        expect(behind).toHaveBeenCalledTimes(1);

        const fresh = vi.fn(
          (): Promise<readonly CandleFreshnessPairSummary[]> => Promise.resolve([summary(false)]),
        );
        await freshenCandles(makeConfig(), {
          env: { TWELVE_DATA_API_KEY: "k" },
          runStage: fresh,
          buildStores: vi.fn(() => makeStores()),
          sleep,
        });
        expect(fresh).toHaveBeenCalledTimes(1);
        expect(sleep).not.toHaveBeenCalled();
      } finally {
        console_.restore();
      }
    });
  });

  it("(c) catches a thrown stage error and resolves (fail-safe)", async () => {
    const console_ = captureConsole();
    try {
      const stores = makeStores();
      const runStage = vi.fn(
        (): Promise<readonly CandleFreshnessPairSummary[]> =>
          Promise.reject(new Error("unexpected stage boom")),
      );
      const buildStores = vi.fn(() => stores);
      const deps: FreshenCandlesDeps = {
        env: { TWELVE_DATA_API_KEY: "td-key-not-logged" },
        runStage,
        buildStores,
      };

      // Must NOT propagate — the run proceeds on existing history.
      await expect(freshenCandles(makeConfig(), deps)).resolves.toBeUndefined();

      expect(runStage).toHaveBeenCalledTimes(1);
      const warnings = console_.warnings();
      expect(warnings).toContain("candle_freshness");
      expect(warnings).toContain("unexpected stage boom");
      expect(warnings).not.toContain("fcs-key-not-logged");
    } finally {
      console_.restore();
    }
  });
});

describe("logFreshnessDegradation (Phase 2a alert signal)", () => {
  const fresh = (pair: string): CandleFreshnessPairSummary => ({
    pair: pair as CandleFreshnessPairSummary["pair"],
    gap: "up_to_date",
    provider: null,
    fetched: 0,
    accepted: 0,
    rejected: 0,
    latestDate: "2026-09-16",
    target: "2026-09-16",
    residualGap: false,
    degraded: false,
  });

  it("emits NOTHING when every pair is up to date", () => {
    const events: object[] = [];
    logFreshnessDegradation("2026-09-16", [fresh("EURUSD"), fresh("GBPUSD")], (e) =>
      events.push(e),
    );
    expect(events).toEqual([]);
  });

  it("fires on a residual gap even when not marked degraded (e.g. provider served but still behind)", () => {
    const events: Array<Record<string, unknown>> = [];
    const stillBehind: CandleFreshnessPairSummary = {
      ...fresh("USDJPY"),
      gap: "backfill",
      provider: "TwelveData",
      latestDate: "2026-09-12",
      residualGap: true,
      degraded: false,
    };
    logFreshnessDegradation("2026-09-16", [stillBehind, fresh("EURUSD")], (e) =>
      events.push(e as Record<string, unknown>),
    );
    expect(events).toHaveLength(1);
    const event = events[0]!;
    expect(event.event).toBe("candle_freshness.degraded");
    expect(event.severity).toBe("ERROR");
    const pairsBehind = event.pairsBehind as Array<{ pair: string }>;
    expect(pairsBehind.map((p) => p.pair)).toEqual(["USDJPY"]);
  });
});
