import { describe, expect, it } from "vitest";
import type { TradingDate } from "../guard/types.js";
import { OhlcIngestion } from "../ingestion/ohlcIngestion.js";
import {
  InMemoryCandleStore,
  type CandleStore,
  type Pair,
  type PerPairCoverage,
  type RawCandle,
} from "../ingestion/types.js";
import { verifyFreshness, type VerifiableSnapshot } from "./freshnessVerification.js";
import { mostRecentCompletedTradingDay } from "./completedTradingDay.js";

// Unit tests for the read-only freshness verification check (Task 14.1; R6.2,
// 6.3). Fully injected: an in-memory `CandleStore` + a provided snapshot
// object + a Decision_Date. No live network, no filesystem, no DB writes. The
// check must leave stored candles untouched and perform NO write.

const DECISION_DATE: TradingDate = "2026-09-17"; // Thursday
// target = most recent Completed_Trading_Day = 2026-09-16 (Wednesday).
const TARGET = mostRecentCompletedTradingDay(DECISION_DATE);

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

describe("verifyFreshness", () => {
  it("a fresh pair verifies equal (latest stored date == target, no residual gap)", async () => {
    const store = new InMemoryCandleStore();
    // EURUSD stored right up to the target → fresh.
    await seedPair(store, "EURUSD", ["2026-09-15", TARGET]);

    const result = await verifyFreshness({
      decisionDate: DECISION_DATE,
      candleStore: store,
      snapshot: snapshot(DECISION_DATE),
    });

    const eur = result.pairs.find((p) => p.pair === "EURUSD");
    expect(eur).toBeDefined();
    expect(eur?.latestDate).toBe(TARGET);
    expect(eur?.target).toBe(TARGET);
    expect(eur?.fresh).toBe(true);
    expect(eur?.residualGap).toBe(false);
  });

  it("a stale pair reports the residual gap (latest stored date behind the target)", async () => {
    const store = new InMemoryCandleStore();
    // GBPUSD stored only up to 2026-09-09 → several trading days behind.
    await seedPair(store, "GBPUSD", ["2026-09-09"]);

    const result = await verifyFreshness({
      decisionDate: DECISION_DATE,
      candleStore: store,
      snapshot: snapshot(DECISION_DATE),
    });

    const gbp = result.pairs.find((p) => p.pair === "GBPUSD");
    expect(gbp?.latestDate).toBe("2026-09-09");
    expect(gbp?.fresh).toBe(false);
    expect(gbp?.residualGap).toBe(true);
  });

  it("a pair with no stored history reports a residual gap (null latest date)", async () => {
    const store = new InMemoryCandleStore();
    // USDJPY has no candles at all.

    const result = await verifyFreshness({
      decisionDate: DECISION_DATE,
      candleStore: store,
      snapshot: snapshot(DECISION_DATE),
    });

    const jpy = result.pairs.find((p) => p.pair === "USDJPY");
    expect(jpy?.latestDate).toBeNull();
    expect(jpy?.fresh).toBe(false);
    expect(jpy?.residualGap).toBe(true);
  });

  it("confirms the snapshot reflects fresh history when its Decision_Date is at/after the run's", async () => {
    const store = new InMemoryCandleStore();
    await seedPair(store, "EURUSD", [TARGET]);

    const result = await verifyFreshness({
      decisionDate: DECISION_DATE,
      candleStore: store,
      snapshot: snapshot(DECISION_DATE),
    });

    expect(result.snapshotDecisionDate).toBe(DECISION_DATE);
    expect(result.snapshotReflectsFreshHistory).toBe(true);
  });

  it("flags a stale snapshot whose Decision_Date predates the run's", async () => {
    const store = new InMemoryCandleStore();
    await seedPair(store, "EURUSD", [TARGET]);

    const result = await verifyFreshness({
      decisionDate: DECISION_DATE,
      candleStore: store,
      // A snapshot produced for an earlier Decision_Date → does NOT reflect
      // the most recent Completed_Trading_Day.
      snapshot: snapshot("2026-09-10"),
    });

    expect(result.snapshotReflectsFreshHistory).toBe(false);
    expect(result.allFresh).toBe(false);
  });

  it("reports allFresh only when every pair is fresh AND the snapshot reflects fresh history", async () => {
    const store = new InMemoryCandleStore();
    // Seed every pair up to the target.
    for (const pair of ["EURUSD", "GBPUSD", "USDJPY", "USDCHF", "USDCAD"] as const) {
      await seedPair(store, pair, [TARGET]);
    }

    const result = await verifyFreshness({
      decisionDate: DECISION_DATE,
      candleStore: store,
      snapshot: snapshot(DECISION_DATE),
    });

    expect(result.pairs.every((p) => p.fresh)).toBe(true);
    expect(result.snapshotReflectsFreshHistory).toBe(true);
    expect(result.allFresh).toBe(true);
  });

  it("performs NO write and leaves stored candles untouched (read-only)", async () => {
    const store = new InMemoryCandleStore();
    await seedPair(store, "EURUSD", ["2026-09-15", TARGET]);
    await seedPair(store, "GBPUSD", ["2026-09-09"]);

    const eurBefore = await store.getCandles("EURUSD");
    const gbpBefore = await store.getCandles("GBPUSD");

    // Wrap the store so any mutating method call fails the test.
    const readOnly: CandleStore = {
      getCoverageSummary: (): Promise<readonly PerPairCoverage[]> =>
        store.getCoverageSummary(),
      getCandles: (asset, startDate, endDate) =>
        store.getCandles(asset, startDate, endDate),
      upsertCandles: (): Promise<void> => {
        throw new Error("verifyFreshness must not write (upsertCandles called)");
      },
    };

    await verifyFreshness({
      decisionDate: DECISION_DATE,
      candleStore: readOnly,
      snapshot: snapshot(DECISION_DATE),
    });

    const eurAfter = await store.getCandles("EURUSD");
    const gbpAfter = await store.getCandles("GBPUSD");
    expect(eurAfter).toEqual(eurBefore);
    expect(gbpAfter).toEqual(gbpBefore);
  });

  it("does not mutate the provided snapshot object", async () => {
    const store = new InMemoryCandleStore();
    await seedPair(store, "EURUSD", [TARGET]);
    const snap = snapshot(DECISION_DATE);
    const frozen = Object.freeze({ ...snap });

    await verifyFreshness({
      decisionDate: DECISION_DATE,
      candleStore: store,
      snapshot: frozen,
    });

    expect(frozen.decisionDate).toBe(DECISION_DATE);
  });
});
