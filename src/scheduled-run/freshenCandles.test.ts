import { describe, expect, it, vi } from "vitest";

import { freshenCandles, type FreshenCandlesDeps } from "./main.js";
import type { loadScheduledRunConfig } from "./config.js";
import type { CandleFreshnessDeps } from "./candleFreshness.js";
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
      const runStage = vi.fn((): Promise<unknown> => Promise.resolve([]));
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
        return Promise.resolve<unknown>([]);
      });
      const buildStores = vi.fn(() => stores);
      const deps: FreshenCandlesDeps = {
        // An FCS key present ⇒ a non-empty provider list ⇒ the stage runs.
        env: { EXTERNAL_SIGNAL_API_KEY: "fcs-key-not-logged" },
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
      expect(captured?.chain.providerNames).toContain("FCS");
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

  it("(c) catches a thrown stage error and resolves (fail-safe)", async () => {
    const console_ = captureConsole();
    try {
      const stores = makeStores();
      const runStage = vi.fn(
        (): Promise<unknown> => Promise.reject(new Error("unexpected stage boom")),
      );
      const buildStores = vi.fn(() => stores);
      const deps: FreshenCandlesDeps = {
        env: { EXTERNAL_SIGNAL_API_KEY: "fcs-key-not-logged" },
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
