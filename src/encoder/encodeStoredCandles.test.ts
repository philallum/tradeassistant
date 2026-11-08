import { describe, expect, it } from "vitest";

import type { Candle, TradingDate } from "../guard/types.js";
import { InMemoryCandleStore, type Pair } from "../ingestion/types.js";
import { encodeAllForPair, encodeDatesIntoVectors } from "./encodeStoredCandles.js";
import { InMemoryPatternVectorStore, type PatternVector } from "./types.js";

const PAIR: Pair = "EURUSD";

/** `count` consecutive weekday candles starting 2024-01-01 (a Monday). */
function candles(count: number): Candle[] {
  const out: Candle[] = [];
  let price = 1.1;
  for (let day = 0; out.length < count; day += 1) {
    const dt = new Date(Date.UTC(2024, 0, 1 + day));
    if (dt.getUTCDay() === 0 || dt.getUTCDay() === 6) continue;
    price += 0.001;
    out.push({
      asset: PAIR,
      date: dt.toISOString().slice(0, 10),
      open: price,
      high: price + 0.002,
      low: price - 0.002,
      close: price,
      source: "test",
    });
  }
  return out;
}

/** A vector store whose write fails for one specific date (simulates a network error). */
class FailingForDateStore extends InMemoryPatternVectorStore {
  constructor(private readonly failDate: TradingDate) {
    super();
  }

  override upsertVector(pair: Pair, date: TradingDate, vector: PatternVector): Promise<void> {
    if (date === this.failDate) {
      return Promise.reject(new Error("write failed"));
    }
    return super.upsertVector(pair, date, vector);
  }
}

async function seededCandleStore(count: number): Promise<{
  store: InMemoryCandleStore;
  dates: TradingDate[];
}> {
  const store = new InMemoryCandleStore();
  const rows = candles(count);
  await store.upsertCandles(rows);
  return { store, dates: rows.map((c) => c.date) };
}

describe("encodeDatesIntoVectors: skipped dates are reported, never silent", () => {
  it("reports the skipped date and its error via onSkip, and keeps encoding the others", async () => {
    const { store, dates } = await seededCandleStore(25);
    const failDate = dates[10] as TradingDate;
    const vectors = new FailingForDateStore(failDate);
    const skipped: Array<{ date: TradingDate; message: string }> = [];

    const encoded = await encodeDatesIntoVectors(store, vectors, PAIR, dates, undefined, (date, err) => {
      skipped.push({ date, message: err instanceof Error ? err.message : String(err) });
    });

    expect(skipped).toEqual([{ date: failDate, message: "write failed" }]);
    expect(encoded).not.toContain(failDate);
    expect(encoded).toHaveLength(dates.length - 1);
    expect((await vectors.getVectorsByAsset(PAIR)).length).toBe(dates.length - 1);
  });

  it("without onSkip the skip is still tolerated (behaviour unchanged)", async () => {
    const { store, dates } = await seededCandleStore(25);
    const vectors = new FailingForDateStore(dates[10] as TradingDate);

    const encoded = await encodeDatesIntoVectors(store, vectors, PAIR, dates);

    expect(encoded).toHaveLength(dates.length - 1);
  });

  it("encodeAllForPair forwards onSkip", async () => {
    const { store, dates } = await seededCandleStore(25);
    const failDate = dates[5] as TradingDate;
    const vectors = new FailingForDateStore(failDate);
    const seen: TradingDate[] = [];

    await encodeAllForPair(store, vectors, PAIR, undefined, (date) => {
      seen.push(date);
    });

    expect(seen).toEqual([failDate]);
  });

  it("reports nothing when every date encodes", async () => {
    const { store, dates } = await seededCandleStore(25);
    const seen: TradingDate[] = [];

    const encoded = await encodeDatesIntoVectors(
      store,
      new InMemoryPatternVectorStore(),
      PAIR,
      dates,
      undefined,
      (date) => {
        seen.push(date);
      },
    );

    expect(seen).toEqual([]);
    expect(encoded).toHaveLength(dates.length);
  });
});
