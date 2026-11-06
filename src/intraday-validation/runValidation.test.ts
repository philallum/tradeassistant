import { describe, expect, it } from "vitest";

import { err, ok, type Result } from "../guard/types.js";
import type { Pair } from "../ingestion/types.js";
import type { IntradayFeedError } from "../ingestion/intradayFeed/twelveDataIntraday.js";
import { runIntradayValidation, type Intraday4hSource, type OriginalPrediction } from "./runValidation.js";
import { InMemoryIntradayValidationStore } from "./store.js";
import type { Intraday4hBar } from "./types.js";

// Task 6: compute step. Happy path, per-pair isolation, FLAT → NOT_APPLICABLE,
// and no daily-path writes (the step only touches its own store).

const NOW = new Date("2026-11-06T06:30:00.000Z"); // inside the 04:00 UTC bar
const BAR_OPEN = "2026-11-06T04:00:00.000Z";

/** A strong bullish forming bar for the current 4H window. */
function strongBull(): Intraday4hBar {
  return { openTimeUtc: BAR_OPEN, open: 1.0, high: 1.102, low: 0.99, currentPrice: 1.1 };
}

/** A source that returns a fixed bar for some pairs and an error for others. */
function source(
  byPair: Partial<Record<Pair, Result<readonly Intraday4hBar[], IntradayFeedError>>>,
): Intraday4hSource {
  return {
    fetch4h: (pair: Pair) =>
      Promise.resolve(
        byPair[pair] ??
          err<IntradayFeedError>({
            reason: "intraday_feed_error",
            mode: "empty",
            provider: "TwelveData",
            pair,
            message: `no stub for ${pair}`,
          }),
      ),
  };
}

const ORIGINALS: readonly OriginalPrediction[] = [
  { pair: "EURUSD", direction: "UP", confidence: 58 },
  { pair: "GBPUSD", direction: "DOWN", confidence: 60 },
];

describe("runIntradayValidation", () => {
  it("validates each pair's forming bar and persists the records", async () => {
    const store = new InMemoryIntradayValidationStore();
    const result = await runIntradayValidation({
      decisionDate: "2026-11-06",
      originals: ORIGINALS,
      source: source({ EURUSD: ok([strongBull()]), GBPUSD: ok([strongBull()]) }),
      store,
      now: NOW,
    });

    expect(result.records).toHaveLength(2);
    const eur = result.records.find((r) => r.pair === "EURUSD")!;
    expect(eur.result.state).toBe("STRONGLY_SUPPORTS");
    expect(eur.result.currentConfidence).toBe(68);
    expect(eur.barOpenUtc).toBe(BAR_OPEN);

    // A bullish bar CONTRADICTS the DOWN forecast on GBPUSD.
    const gbp = result.records.find((r) => r.pair === "GBPUSD")!;
    expect(gbp.result.state).toBe("STRONGLY_CONTRADICTS");
    expect(gbp.result.currentConfidence).toBe(50);

    const persisted = await store.getByDecisionDate("2026-11-06");
    expect(persisted.map((r) => r.pair)).toEqual(["EURUSD", "GBPUSD"]);
  });

  it("isolates a per-pair provider failure (the other pair still validates)", async () => {
    const store = new InMemoryIntradayValidationStore();
    const result = await runIntradayValidation({
      decisionDate: "2026-11-06",
      originals: ORIGINALS,
      source: source({ EURUSD: ok([strongBull()]) }), // GBPUSD → error
      store,
      now: NOW,
    });
    expect(result.records.map((r) => r.pair)).toEqual(["EURUSD"]);
    expect(result.unavailable.map((u) => u.pair)).toEqual(["GBPUSD"]);
  });

  it("marks a pair unavailable when only a stale bar is returned", async () => {
    const store = new InMemoryIntradayValidationStore();
    const stale: Intraday4hBar = { ...strongBull(), openTimeUtc: "2026-11-06T00:00:00.000Z" };
    const result = await runIntradayValidation({
      decisionDate: "2026-11-06",
      originals: [{ pair: "EURUSD", direction: "UP", confidence: 58 }],
      source: source({ EURUSD: ok([stale]) }),
      store,
      now: NOW,
    });
    expect(result.records).toHaveLength(0);
    expect(result.unavailable[0]?.pair).toBe("EURUSD");
  });

  it("classifies a FLAT original direction as NOT_APPLICABLE with zero delta", async () => {
    const store = new InMemoryIntradayValidationStore();
    const result = await runIntradayValidation({
      decisionDate: "2026-11-06",
      originals: [{ pair: "EURUSD", direction: "FLAT", confidence: 50 }],
      source: source({ EURUSD: ok([strongBull()]) }),
      store,
      now: NOW,
    });
    expect(result.records[0]?.result.state).toBe("NOT_APPLICABLE");
    expect(result.records[0]?.result.confidenceDelta).toBe(0);
  });

  it("marks a pair unavailable when the forming candle is non-computable", async () => {
    const store = new InMemoryIntradayValidationStore();
    const bad: Intraday4hBar = { openTimeUtc: BAR_OPEN, open: 1.0, high: 0.5, low: 0.9, currentPrice: 0.8 };
    const result = await runIntradayValidation({
      decisionDate: "2026-11-06",
      originals: [{ pair: "EURUSD", direction: "UP", confidence: 58 }],
      source: source({ EURUSD: ok([bad]) }),
      store,
      now: NOW,
    });
    expect(result.records).toHaveLength(0);
    expect(result.unavailable[0]?.pair).toBe("EURUSD");
  });
});
