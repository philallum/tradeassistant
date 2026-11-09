import { describe, expect, it } from "vitest";
import { InMemoryPatternVectorStore } from "../../encoder/types.js";
import type { ProviderChain, ResolveOutcome } from "../../ingestion/ohlcFeed/providerChain.js";
import { InMemoryCandleStore, type Pair, type RawCandle } from "../../ingestion/types.js";
import type { PipelineStores } from "../../pipeline/types.js";
import { InMemoryAnalogueStore } from "../../retrieval/types.js";
import type { ScheduledRunConfig } from "../../scheduled-run/config.js";
import { parseArgs, runCandleRepair } from "./main.js";

const CONFIG = {
  decisionDate: "2026-11-09",
  supabase: { target: "t", url: "https://x.invalid" },
} as unknown as ScheduledRunConfig;

function raw(pair: Pair, date: string, h = 1.12, l = 1.09): RawCandle {
  return { asset: pair, pair, date, open: 1.1, high: h, low: l, close: 1.11, source: "TwelveData" };
}

function chainOf(candles: (pair: Pair) => ResolveOutcome): ProviderChain {
  return {
    providerNames: ["TwelveData"],
    resolveLatest: () => Promise.resolve(new Map()),
    resolveRange: (pair) => Promise.resolve(candles(pair)),
  };
}

async function seed(): Promise<{ stores: PipelineStores; store: InMemoryCandleStore }> {
  const store = new InMemoryCandleStore();
  // Damaged Wednesday (tiny range), correct Thursday; Friday never stored.
  await store.upsertCandles([
    { asset: "EURUSD", date: "2026-11-04", open: 1.1, high: 1.10012, low: 1.09988, close: 1.1 },
    { asset: "EURUSD", date: "2026-11-05", open: 1.1, high: 1.12, low: 1.09, close: 1.11 },
  ]);
  return {
    store,
    stores: { candleStore: store, vectorStore: new InMemoryPatternVectorStore(), analogueStore: new InMemoryAnalogueStore() },
  };
}

const canonical = (pair: Pair): ResolveOutcome =>
  pair === "EURUSD"
    ? { provider: "TwelveData", candles: [raw(pair, "2026-11-04"), raw(pair, "2026-11-05"), raw(pair, "2026-11-06")] }
    : { reason: "ohlc_feed_error", mode: "empty", provider: "TwelveData", pair, message: "none" };

describe("runCandleRepair", () => {
  it("dry run (default) reports the plan and writes nothing", async () => {
    const { stores, store } = await seed();
    const before = JSON.stringify(await store.getCandles("EURUSD"));
    const logs: object[] = [];
    const result = await runCandleRepair(
      { from: "2026-11-02" },
      { config: CONFIG, stores, chain: chainOf(canonical), log: (e) => logs.push(e) },
    );
    expect(result.applied).toBe(false);
    expect(JSON.stringify(await store.getCandles("EURUSD"))).toBe(before);
    const eur = result.plans.find((p) => p.pair === "EURUSD")!;
    expect(eur.entries.map((e) => e.action)).toEqual(["replace", "same", "insert"]);
    expect(result.pairsFailed).toContain("USDJPY");
  });

  it("--apply writes only changed dates, adds the missing day, and encodes vectors", async () => {
    const { stores, store } = await seed();
    const result = await runCandleRepair(
      { from: "2026-11-02", apply: true },
      { config: CONFIG, stores, chain: chainOf(canonical), log: () => undefined },
    );
    expect(result.applied).toBe(true);
    expect(result.datesWritten).toBe(2);
    const stored = await store.getCandles("EURUSD");
    expect(stored.map((c) => c.date)).toEqual(["2026-11-04", "2026-11-05", "2026-11-06"]);
    expect(stored[0]?.high).toBe(1.12);
    const vectors = await stores.vectorStore.getVectorsByAsset("EURUSD");
    expect(vectors.map((v) => v.decisionDate)).toEqual(["2026-11-04", "2026-11-05", "2026-11-06"]);
  });

  it("never deletes a stored date that has no canonical candle", async () => {
    const { stores, store } = await seed();
    await runCandleRepair(
      { from: "2026-11-02", apply: true },
      {
        config: CONFIG,
        stores,
        chain: chainOf((pair) => ({ provider: "TwelveData", candles: [raw(pair, "2026-11-05")] })),
        log: () => undefined,
      },
    );
    expect((await store.getCandles("EURUSD")).map((c) => c.date)).toContain("2026-11-04");
  });

  it("refuses a range that reaches the Decision_Date", async () => {
    const { stores } = await seed();
    await expect(
      runCandleRepair({ from: "2026-11-02", to: "2026-11-09" }, { config: CONFIG, stores, chain: chainOf(canonical), log: () => undefined }),
    ).rejects.toThrow(/before the Decision_Date/);
  });
});

describe("parseArgs", () => {
  it("is dry-run unless --apply is passed", () => {
    expect(parseArgs(["--from", "2026-10-12"])).toEqual({ from: "2026-10-12", apply: false });
    expect(parseArgs(["--from", "2026-10-12", "--to", "2026-11-06", "--apply"])).toEqual({
      from: "2026-10-12",
      to: "2026-11-06",
      apply: true,
    });
  });
  it("requires --from and rejects unknown flags", () => {
    expect(() => parseArgs([])).toThrow();
    expect(() => parseArgs(["--from", "2026-10-12", "--force"])).toThrow();
  });
});
