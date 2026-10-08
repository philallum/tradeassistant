import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { TradingDate } from "../guard/types.js";
import { OhlcIngestion } from "../ingestion/ohlcIngestion.js";
import {
  InMemoryCandleStore,
  PAIRS,
  type Pair,
  type RawCandle,
} from "../ingestion/types.js";
import type { Candle } from "../guard/types.js";
import { InMemoryPatternVectorStore } from "../encoder/types.js";
import { addTradingDays, formatTradingDate } from "../guard/tradingDate.js";
import type {
  ProviderChain,
  ResolveOutcome,
} from "../ingestion/ohlcFeed/providerChain.js";
import { runCandleFreshnessStage } from "./candleFreshness.js";
import { mostRecentCompletedTradingDay } from "./completedTradingDay.js";

// Feature: daily-candle-freshness-and-cleanup, Property 6: all-fail degradation
// is non-destructive  — Validates: Requirements 1.5, 4.1, 4.3
//
// Feature: daily-candle-freshness-and-cleanup, Property 7: no gap means no range
// fetch  — Validates: Requirements 3.4
//
// Both drive the stage with a stub ProviderChain that records every call.

const pairArb: fc.Arbitrary<Pair> = fc.constantFrom(...PAIRS);

const weekdayDateArb: fc.Arbitrary<TradingDate> = fc
  .date({
    min: new Date(Date.UTC(2020, 0, 1)),
    max: new Date(Date.UTC(2030, 11, 31)),
    noInvalidDate: true,
  })
  .map((d) => formatTradingDate(d))
  .filter((d) => {
    const day = new Date(`${d}T00:00:00Z`).getUTCDay();
    return day >= 1 && day <= 5;
  });

function validCandle(pair: Pair, date: TradingDate): RawCandle {
  return { asset: pair, pair, date, open: 1.1, high: 1.3, low: 1.0, close: 1.2, source: "seed" };
}

/** A stub chain that records calls; `latest`/`range` return scripted outcomes. */
class RecordingChain implements ProviderChain {
  readonly providerNames = ["Stub"];
  readonly latestCalls: Pair[][] = [];
  readonly rangeCalls: Pair[] = [];
  constructor(
    private readonly latestFn: (pairs: readonly Pair[]) => ReadonlyMap<Pair, ResolveOutcome>,
    private readonly rangeFn: (pair: Pair) => ResolveOutcome,
  ) {}
  resolveLatest(pairs: readonly Pair[]): Promise<ReadonlyMap<Pair, ResolveOutcome>> {
    this.latestCalls.push([...pairs]);
    return Promise.resolve(this.latestFn(pairs));
  }
  resolveRange(pair: Pair): Promise<ResolveOutcome> {
    this.rangeCalls.push(pair);
    return Promise.resolve(this.rangeFn(pair));
  }
}

async function snapshot(store: InMemoryCandleStore): Promise<ReadonlyArray<Candle>> {
  const all: Candle[] = [];
  for (const pair of PAIRS) all.push(...(await store.getCandles(pair)));
  return all.sort((a, b) => `${a.asset}:${a.date}`.localeCompare(`${b.asset}:${b.date}`));
}

describe("Property 6: all-fail degradation is non-destructive", () => {
  it("every provider failing leaves the pre-run stored set intact and logs a secret-free warning", async () => {
    await fc.assert(
      fc.asyncProperty(
        pairArb,
        weekdayDateArb, // decisionDate
        fc.array(weekdayDateArb, { minLength: 1, maxLength: 6 }),
        async (pair, decisionDate, seedDates) => {
          const store = new InMemoryCandleStore();
          const ingestion = new OhlcIngestion(store);
          // Seed WELL BEFORE the decision date so the look-ahead guard never
          // rejects the seed and the pair has history to protect.
          const safeSeeds = seedDates
            .filter((d) => d < decisionDate)
            .map((d) => validCandle(pair, d));
          if (safeSeeds.length > 0) {
            await ingestion.ingest(pair, safeSeeds);
          }
          const before = await snapshot(store);

          // Every provider fails for every pair (latest + range).
          const chain = new RecordingChain(
            (pairs) => {
              const m = new Map<Pair, ResolveOutcome>();
              for (const p of pairs) {
                m.set(p, { reason: "ohlc_feed_error", mode: "unavailable", provider: "Stub", pair: p, message: "down" });
              }
              return m;
            },
            (p) => ({ reason: "ohlc_feed_error", mode: "unavailable", provider: "Stub", pair: p, message: "down" }),
          );

          const logs: object[] = [];
          const summaries = await runCandleFreshnessStage({
            decisionDate,
            ingestion,
            candleStore: store,
            vectorStore: new InMemoryPatternVectorStore(),
            chain,
            maxLookbackTradingDays: 90,
            logger: (e) => logs.push(e),
          });

          // Non-destructive: the stored set is exactly intact.
          expect(await snapshot(store)).toEqual(before);
          // The pair's summary records degradation with no winning provider.
          const s = summaries.find((x) => x.pair === pair)!;
          if (s.gap !== "up_to_date") {
            expect(s.degraded).toBe(true);
            expect(s.provider).toBeNull();
          }
          // No secret leaked into the logs.
          expect(JSON.stringify(logs)).not.toContain("API_KEY");
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("Property 7: no gap means no range fetch", () => {
  it("a pair already at the target triggers no resolveRange for that pair", async () => {
    await fc.assert(
      fc.asyncProperty(
        pairArb,
        weekdayDateArb, // decisionDate
        async (pair, decisionDate) => {
          const target = mostRecentCompletedTradingDay(decisionDate);
          const store = new InMemoryCandleStore();
          const ingestion = new OhlcIngestion(store);
          // Seed the pair up to AND including the target → up_to_date, no gap.
          await ingestion.ingest(pair, [
            validCandle(pair, addTradingDays(target, -1)),
            validCandle(pair, target),
          ]);

          const chain = new RecordingChain(
            () => new Map<Pair, ResolveOutcome>(),
            (p) => ({ reason: "ohlc_feed_error", mode: "empty", provider: "Stub", pair: p, message: "x" }),
          );

          await runCandleFreshnessStage({
            decisionDate,
            ingestion,
            candleStore: store,
            vectorStore: new InMemoryPatternVectorStore(),
            chain,
            maxLookbackTradingDays: 90,
            logger: () => {},
          });

          // No range fetch for the up-to-date pair.
          expect(chain.rangeCalls).not.toContain(pair);
        },
      ),
      { numRuns: 100 },
    );
  });
});
