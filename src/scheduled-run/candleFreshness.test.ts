import { describe, expect, it } from "vitest";
import type { TradingDate } from "../guard/types.js";
import { OhlcIngestion } from "../ingestion/ohlcIngestion.js";
import {
  InMemoryCandleStore,
  type Pair,
  type RawCandle,
} from "../ingestion/types.js";
import { InMemoryPatternVectorStore } from "../encoder/types.js";
import type {
  ProviderChain,
  ResolveOutcome,
} from "../ingestion/ohlcFeed/providerChain.js";
import {
  runCandleFreshnessStage,
  type CandleFreshnessPairSummary,
} from "./candleFreshness.js";
import { mostRecentCompletedTradingDay } from "./completedTradingDay.js";

// Unit tests for the Candle_Freshness_Stage (Task 9.1; R2.1, 2.3, 2.4, 3.1,
// 3.3, 3.4, 4.1, 4.2, 4.3). No live network — a stub ProviderChain + in-memory
// stores + the real OhlcIngestion.

const DECISION_DATE: TradingDate = "2026-09-17"; // Thursday
// target = most recent Completed_Trading_Day = 2026-09-16 (Wednesday).
const TARGET = mostRecentCompletedTradingDay(DECISION_DATE);

function candle(pair: Pair, date: TradingDate, source = "stub"): RawCandle {
  return { asset: pair, pair, date, open: 1.1, high: 1.2, low: 1.0, close: 1.15, source };
}

/** A stub ProviderChain that records calls and returns scripted outcomes. */
class StubChain implements ProviderChain {
  readonly providerNames = ["Stub"];
  readonly latestCalls: Pair[][] = [];
  readonly rangeCalls: Array<{ pair: Pair; from: TradingDate; to: TradingDate }> = [];

  constructor(
    private readonly latest: (pairs: readonly Pair[]) => ReadonlyMap<Pair, ResolveOutcome>,
    private readonly range: (pair: Pair) => ResolveOutcome,
  ) {}

  resolveLatest(
    pairs: readonly Pair[],
    asOf: TradingDate,
  ): Promise<ReadonlyMap<Pair, ResolveOutcome>> {
    void asOf;
    this.latestCalls.push([...pairs]);
    return Promise.resolve(this.latest(pairs));
  }

  resolveRange(
    pair: Pair,
    from: TradingDate,
    to: TradingDate,
  ): Promise<ResolveOutcome> {
    this.rangeCalls.push({ pair, from, to });
    return Promise.resolve(this.range(pair));
  }
}

/** Seed a store so a pair's latest stored date equals `latest`. */
async function seedPair(
  ingestion: OhlcIngestion,
  pair: Pair,
  dates: readonly TradingDate[],
): Promise<void> {
  await ingestion.ingest(
    pair,
    dates.map((d) => candle(pair, d)),
  );
}

function makeDeps(
  chain: ProviderChain,
  store: InMemoryCandleStore,
  logs: object[],
): Parameters<typeof runCandleFreshnessStage>[0] {
  return {
    decisionDate: DECISION_DATE,
    ingestion: new OhlcIngestion(store),
    candleStore: store,
    vectorStore: new InMemoryPatternVectorStore(),
    chain,
    maxLookbackTradingDays: 90,
    logger: (e) => logs.push(e),
  };
}

function summaryFor(
  summaries: readonly CandleFreshnessPairSummary[],
  pair: Pair,
): CandleFreshnessPairSummary {
  const s = summaries.find((x) => x.pair === pair);
  if (s === undefined) throw new Error(`no summary for ${pair}`);
  return s;
}

const emptyLatest = (): ReadonlyMap<Pair, ResolveOutcome> => new Map();

describe("runCandleFreshnessStage", () => {
  it("a single-day top-up ingests the latest candle via resolveLatest (not resolveRange)", async () => {
    const store = new InMemoryCandleStore();
    const ingestion = new OhlcIngestion(store);
    // EURUSD last stored 2026-09-15 (Tuesday) → exactly one trading day behind
    // the 2026-09-16 target.
    await seedPair(ingestion, "EURUSD", ["2026-09-14", "2026-09-15"]);

    const chain = new StubChain(
      () => new Map<Pair, ResolveOutcome>([["EURUSD", { candles: [candle("EURUSD", TARGET)], provider: "FCS" }]]),
      () => ({ reason: "ohlc_feed_error", mode: "empty", provider: "none", pair: "EURUSD", message: "x" }),
    );
    const logs: object[] = [];
    const summaries = await runCandleFreshnessStage(makeDeps(chain, store, logs));

    const eur = summaryFor(summaries, "EURUSD");
    expect(eur.gap).toBe("top_up");
    expect(eur.provider).toBe("FCS");
    expect(eur.accepted).toBeGreaterThanOrEqual(1);
    expect(eur.latestDate).toBe(TARGET);
    // Top-up uses resolveLatest; no range fetch for EURUSD.
    expect(chain.rangeCalls.find((r) => r.pair === "EURUSD")).toBeUndefined();
    expect(chain.latestCalls.some((pairs) => pairs.includes("EURUSD"))).toBe(true);
  });

  it("a multi-day backfill ingests the fetched range via resolveRange", async () => {
    const store = new InMemoryCandleStore();
    const ingestion = new OhlcIngestion(store);
    // GBPUSD last stored 2026-09-09 → several trading days behind the target.
    await seedPair(ingestion, "GBPUSD", ["2026-09-09"]);

    const rangeCandles = ["2026-09-10", "2026-09-11", "2026-09-14", "2026-09-15", "2026-09-16"].map(
      (d) => candle("GBPUSD", d),
    );
    const chain = new StubChain(emptyLatest, (pair) =>
      pair === "GBPUSD"
        ? { candles: rangeCandles, provider: "TwelveData" }
        : { reason: "ohlc_feed_error", mode: "empty", provider: "none", pair, message: "x" },
    );
    const logs: object[] = [];
    const summaries = await runCandleFreshnessStage(makeDeps(chain, store, logs));

    const gbp = summaryFor(summaries, "GBPUSD");
    expect(gbp.gap).toBe("backfill");
    expect(gbp.provider).toBe("TwelveData");
    expect(gbp.accepted).toBe(5);
    expect(gbp.latestDate).toBe(TARGET);
    expect(gbp.residualGap).toBe(false);
    expect(chain.rangeCalls.some((r) => r.pair === "GBPUSD")).toBe(true);
  });

  it("a no-gap pair triggers NO resolveRange and no resolveLatest for it", async () => {
    const store = new InMemoryCandleStore();
    const ingestion = new OhlcIngestion(store);
    // USDJPY already stored up to the target → up_to_date.
    await seedPair(ingestion, "USDJPY", [TARGET]);

    const chain = new StubChain(emptyLatest, (pair) => ({
      reason: "ohlc_feed_error", mode: "empty", provider: "none", pair, message: "x",
    }));
    const logs: object[] = [];
    const summaries = await runCandleFreshnessStage(makeDeps(chain, store, logs));

    const jpy = summaryFor(summaries, "USDJPY");
    expect(jpy.gap).toBe("up_to_date");
    expect(jpy.provider).toBeNull();
    expect(chain.rangeCalls.find((r) => r.pair === "USDJPY")).toBeUndefined();
    expect(chain.latestCalls.some((pairs) => pairs.includes("USDJPY"))).toBe(false);
  });

  it("a partial catch-up ingests what it got and logs the residual gap", async () => {
    const store = new InMemoryCandleStore();
    const ingestion = new OhlcIngestion(store);
    await seedPair(ingestion, "USDCHF", ["2026-09-09"]);

    // Provider returns only part of the range (stops before the target).
    const partial = ["2026-09-10", "2026-09-11"].map((d) => candle("USDCHF", d));
    const chain = new StubChain(emptyLatest, (pair) =>
      pair === "USDCHF"
        ? { candles: partial, provider: "Massive" }
        : { reason: "ohlc_feed_error", mode: "empty", provider: "none", pair, message: "x" },
    );
    const logs: object[] = [];
    const summaries = await runCandleFreshnessStage(makeDeps(chain, store, logs));

    const chf = summaryFor(summaries, "USDCHF");
    expect(chf.accepted).toBe(2);
    expect(chf.latestDate).toBe("2026-09-11");
    expect(chf.residualGap).toBe(true); // still behind the 2026-09-16 target
  });

  it("an invalid candle is rejected (not stored), valid ones kept", async () => {
    const store = new InMemoryCandleStore();
    const ingestion = new OhlcIngestion(store);
    await seedPair(ingestion, "USDCAD", ["2026-09-09"]);

    const invalid: RawCandle = { asset: "USDCAD", pair: "USDCAD", date: "2026-09-10", open: 1, high: 0.5, low: 0.9, close: 1 }; // high < low
    const valid = candle("USDCAD", "2026-09-11");
    const chain = new StubChain(emptyLatest, (pair) =>
      pair === "USDCAD"
        ? { candles: [invalid, valid], provider: "Massive" }
        : { reason: "ohlc_feed_error", mode: "empty", provider: "none", pair, message: "x" },
    );
    const logs: object[] = [];
    const summaries = await runCandleFreshnessStage(makeDeps(chain, store, logs));

    const cad = summaryFor(summaries, "USDCAD");
    expect(cad.rejected).toBe(1);
    expect(cad.accepted).toBe(1);
    const stored = await store.getCandles("USDCAD");
    expect(stored.some((c) => c.date === "2026-09-10")).toBe(false);
    expect(stored.some((c) => c.date === "2026-09-11")).toBe(true);
  });

  it("logs candle_freshness.nothing_accepted when a provider's candles are all dropped", async () => {
    const store = new InMemoryCandleStore();
    const ingestion = new OhlcIngestion(store);
    await seedPair(ingestion, "USDCAD", ["2026-09-09"]);

    const invalid: RawCandle = { asset: "USDCAD", pair: "USDCAD", date: "2026-09-10", open: 1, high: 0.5, low: 0.9, close: 1 };
    const chain = new StubChain(emptyLatest, (pair) =>
      pair === "USDCAD"
        ? { candles: [invalid], provider: "Massive" }
        : { reason: "ohlc_feed_error", mode: "empty", provider: "none", pair, message: "x" },
    );
    const logs: object[] = [];
    await runCandleFreshnessStage(makeDeps(chain, store, logs));

    const warn = logs.find((l) => (l as { event?: string }).event === "candle_freshness.nothing_accepted");
    expect(warn).toMatchObject({ pair: "USDCAD", provider: "Massive", fetched: 1, dates: ["2026-09-10"] });
  });

  it("does not log nothing_accepted when at least one candle is accepted", async () => {
    const store = new InMemoryCandleStore();
    const ingestion = new OhlcIngestion(store);
    await seedPair(ingestion, "USDCAD", ["2026-09-09"]);
    const chain = new StubChain(emptyLatest, (pair) =>
      pair === "USDCAD"
        ? { candles: [candle("USDCAD", "2026-09-10")], provider: "Massive" }
        : { reason: "ohlc_feed_error", mode: "empty", provider: "none", pair, message: "x" },
    );
    const logs: object[] = [];
    await runCandleFreshnessStage(makeDeps(chain, store, logs));
    expect(logs.some((l) => (l as { event?: string }).event === "candle_freshness.nothing_accepted")).toBe(false);
  });

  it("a re-run is a storage no-op (idempotent upsert)", async () => {
    const store = new InMemoryCandleStore();
    const ingestion = new OhlcIngestion(store);
    await seedPair(ingestion, "GBPUSD", ["2026-09-09"]);

    const rangeCandles = ["2026-09-10", "2026-09-11", "2026-09-14", "2026-09-15", "2026-09-16"].map(
      (d) => candle("GBPUSD", d),
    );
    const chain = new StubChain(emptyLatest, (pair) =>
      pair === "GBPUSD"
        ? { candles: rangeCandles, provider: "TwelveData" }
        : { reason: "ohlc_feed_error", mode: "empty", provider: "none", pair, message: "x" },
    );
    const logs: object[] = [];
    const deps = makeDeps(chain, store, logs);

    await runCandleFreshnessStage(deps);
    const afterFirst = await store.getCandles("GBPUSD");
    // Second run: GBPUSD is now up_to_date, nothing changes.
    await runCandleFreshnessStage(deps);
    const afterSecond = await store.getCandles("GBPUSD");
    expect(afterSecond).toHaveLength(afterFirst.length);
  });

  it("all-providers-fail logs a secret-free warning and proceeds (history intact)", async () => {
    const store = new InMemoryCandleStore();
    const ingestion = new OhlcIngestion(store);
    await seedPair(ingestion, "GBPUSD", ["2026-09-09"]);
    const before = await store.getCandles("GBPUSD");

    const chain = new StubChain(emptyLatest, (pair) => ({
      reason: "ohlc_feed_error", mode: "unavailable", provider: "TwelveData", pair, message: "network error",
    }));
    const logs: object[] = [];
    const summaries = await runCandleFreshnessStage(makeDeps(chain, store, logs));

    const gbp = summaryFor(summaries, "GBPUSD");
    expect(gbp.degraded).toBe(true);
    expect(gbp.provider).toBeNull();
    const after = await store.getCandles("GBPUSD");
    expect(after).toEqual(before); // non-destructive
  });

  it("the per-pair log carries no secret (only names/dates/counts)", async () => {
    const store = new InMemoryCandleStore();
    const ingestion = new OhlcIngestion(store);
    await seedPair(ingestion, "EURUSD", ["2026-09-15"]);

    const secret = "SUPER_SECRET_API_KEY_123";
    const chain = new StubChain(
      () => new Map<Pair, ResolveOutcome>([["EURUSD", { candles: [candle("EURUSD", TARGET)], provider: "FCS" }]]),
      () => ({ reason: "ohlc_feed_error", mode: "empty", provider: "none", pair: "EURUSD", message: "x" }),
    );
    const logs: object[] = [];
    await runCandleFreshnessStage(makeDeps(chain, store, logs));

    const serialized = JSON.stringify(logs);
    expect(serialized).not.toContain(secret);
  });
});
