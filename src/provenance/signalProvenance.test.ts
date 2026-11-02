import { describe, expect, it } from "vitest";
import { addTradingDays } from "../guard/tradingDate.js";
import type { TradingDate } from "../guard/types.js";
import { InMemoryCandleStore, type Pair } from "../ingestion/types.js";
import {
  deriveSignalProvenance,
  sessionCloseTimestamp,
} from "./signalProvenance.js";

const PAIR: Pair = "EURUSD";
const DECISION: TradingDate = "2026-09-17"; // Thursday; target = Wed 2026-09-16
const CLOCK = new Date("2026-09-17T06:00:00Z");

/** Weekday candles for `pair` from `start` through `end`, skipping `skip`. */
async function storeWith(
  start: TradingDate,
  end: TradingDate,
  skip: readonly TradingDate[] = [],
): Promise<InMemoryCandleStore> {
  const store = new InMemoryCandleStore();
  const candles = [];
  let d = start;
  for (let i = 0; i < 200 && d <= end; i++) {
    if (!skip.includes(d)) {
      candles.push({
        asset: PAIR,
        date: d,
        open: 1.1,
        high: 1.2,
        low: 1.0,
        close: 1.15,
      });
    }
    d = addTradingDays(d, 1);
  }
  await store.upsertCandles(candles);
  return store;
}

describe("deriveSignalProvenance", () => {
  it("fresh pair => complete, entry strictly after last candle, explicit tz", async () => {
    const store = await storeWith("2026-08-03", "2026-09-16");
    const p = await deriveSignalProvenance({
      pair: PAIR,
      decisionDate: DECISION,
      horizonDays: 3,
      computedAt: CLOCK,
      candleStore: store,
    });
    expect(p.dataComplete).toBe(true);
    expect(p.staleReason).toBeNull();
    expect(p.lastCandleTimestamp).toBe("2026-09-16T17:00:00-04:00");
    expect(p.computedAt).toBe("2026-09-17T06:00:00.000Z");
    expect(p.earliestEntryRef).toBe("2026-09-17T17:00:00-04:00");
    expect(Date.parse(p.earliestEntryRef)).toBeGreaterThan(
      Date.parse(p.lastCandleTimestamp),
    );
    expect(p.horizonStart).toBe(p.earliestEntryRef);
    expect(p.horizonEnd).toBe("2026-09-21T17:00:00-04:00"); // Thu, Fri, Mon
  });

  it("applies the DST-correct offset to the NY close", () => {
    expect(sessionCloseTimestamp("2026-01-15")).toBe("2026-01-15T17:00:00-05:00");
    expect(sessionCloseTimestamp("2026-07-15")).toBe("2026-07-15T17:00:00-04:00");
    // Day after the March spring-forward (Sunday 2026-03-08).
    expect(sessionCloseTimestamp("2026-03-06")).toBe("2026-03-06T17:00:00-05:00");
    expect(sessionCloseTimestamp("2026-03-09")).toBe("2026-03-09T17:00:00-04:00");
  });

  it("is deterministic (same inputs => identical output) and LLM-free", async () => {
    const store = await storeWith("2026-08-03", "2026-09-16");
    const input = {
      pair: PAIR,
      decisionDate: DECISION,
      horizonDays: 1,
      computedAt: CLOCK,
      candleStore: store,
    };
    const a = await deriveSignalProvenance(input);
    const b = await deriveSignalProvenance(input);
    expect(a).toEqual(b);
    expect(Object.keys(a).sort()).toEqual(
      [
        "pair",
        "lastCandleTimestamp",
        "computedAt",
        "earliestEntryRef",
        "horizonStart",
        "horizonEnd",
        "dataComplete",
        "staleReason",
      ].sort(),
    );
  });

  it("stale (several trading days behind) => stale", async () => {
    const store = await storeWith("2026-08-03", "2026-09-10");
    const p = await deriveSignalProvenance({
      pair: PAIR,
      decisionDate: DECISION,
      horizonDays: 1,
      computedAt: CLOCK,
      candleStore: store,
    });
    expect(p.dataComplete).toBe(false);
    expect(p.staleReason).toBe("stale");
    expect(p.lastCandleTimestamp).toBe("2026-09-10T17:00:00-04:00");
  });

  it("one missing latest weekday => missing_candle", async () => {
    const store = await storeWith("2026-08-03", "2026-09-15");
    const p = await deriveSignalProvenance({
      pair: PAIR,
      decisionDate: DECISION,
      horizonDays: 1,
      computedAt: CLOCK,
      candleStore: store,
    });
    expect(p.dataComplete).toBe(false);
    expect(p.staleReason).toBe("missing_candle");
  });

  it("no stored candles => missing_candle", async () => {
    const p = await deriveSignalProvenance({
      pair: PAIR,
      decisionDate: DECISION,
      horizonDays: 1,
      computedAt: CLOCK,
      candleStore: new InMemoryCandleStore(),
    });
    expect(p.dataComplete).toBe(false);
    expect(p.staleReason).toBe("missing_candle");
  });

  it("missing day that is a known holiday => holiday", async () => {
    const store = await storeWith("2026-08-03", "2026-09-15");
    const p = await deriveSignalProvenance({
      pair: PAIR,
      decisionDate: DECISION,
      horizonDays: 1,
      computedAt: CLOCK,
      candleStore: store,
      holidays: new Set<TradingDate>(["2026-09-16"]),
    });
    expect(p.dataComplete).toBe(false);
    expect(p.staleReason).toBe("holiday");
  });

  it("Friday candle with Monday not yet published => weekend_gap", async () => {
    const store = await storeWith("2026-08-03", "2026-09-11"); // Friday
    const p = await deriveSignalProvenance({
      pair: PAIR,
      decisionDate: "2026-09-15", // Tue; target = Mon 2026-09-14
      horizonDays: 1,
      computedAt: CLOCK,
      candleStore: store,
    });
    expect(p.dataComplete).toBe(false);
    expect(p.staleReason).toBe("weekend_gap");
  });

  it("interior gap in otherwise fresh history => missing_candle / holiday", async () => {
    const store = await storeWith("2026-08-03", "2026-09-16", ["2026-09-09"]);
    const base = {
      pair: PAIR,
      decisionDate: DECISION,
      horizonDays: 1,
      computedAt: CLOCK,
      candleStore: store,
    };
    const missing = await deriveSignalProvenance(base);
    expect(missing.dataComplete).toBe(false);
    expect(missing.staleReason).toBe("missing_candle");

    const holiday = await deriveSignalProvenance({
      ...base,
      holidays: new Set<TradingDate>(["2026-09-09"]),
    });
    expect(holiday.staleReason).toBe("holiday");
  });
});
