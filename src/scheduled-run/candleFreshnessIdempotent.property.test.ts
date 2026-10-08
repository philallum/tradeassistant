import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { OhlcIngestion } from "../ingestion/ohlcIngestion.js";
import {
  InMemoryCandleStore,
  PAIRS,
  type Pair,
  type RawCandle,
} from "../ingestion/types.js";
import type { Candle } from "../guard/types.js";
import { formatTradingDate } from "../guard/tradingDate.js";

// Feature: daily-candle-freshness-and-cleanup, Property 1: idempotent ingestion
//
// Validates: Requirements 2.3, 4.3, 5.2
//
// Ingesting a random candle batch twice into an InMemoryCandleStore leaves the
// stored set unchanged after the second ingest — no duplicate rows, no mutated
// values. This is the idempotent `(asset, date)` upsert that makes a re-run a
// storage no-op.

const pairArb: fc.Arbitrary<Pair> = fc.constantFrom(...PAIRS);

/** A weekday date in a bounded window (so it is a kept Mon-Fri session). */
const weekdayDateArb: fc.Arbitrary<string> = fc
  .date({
    min: new Date(Date.UTC(2015, 0, 1)),
    max: new Date(Date.UTC(2030, 11, 31)),
    noInvalidDate: true,
  })
  .map((d) => formatTradingDate(d))
  .filter((d) => {
    const day = new Date(`${d}T00:00:00Z`).getUTCDay();
    return day >= 1 && day <= 5;
  });

/** A valid OHLC candle: low <= open/close <= high. */
const candleArb = (pair: Pair): fc.Arbitrary<RawCandle> =>
  fc
    .record({
      date: weekdayDateArb,
      low: fc.double({ min: 0.5, max: 1.5, noNaN: true }),
      span: fc.double({ min: 0, max: 0.5, noNaN: true }),
      openFrac: fc.double({ min: 0, max: 1, noNaN: true }),
      closeFrac: fc.double({ min: 0, max: 1, noNaN: true }),
    })
    .map(({ date, low, span, openFrac, closeFrac }) => {
      const high = low + span;
      return {
        asset: pair,
        pair,
        date,
        low,
        high,
        open: low + openFrac * span,
        close: low + closeFrac * span,
        source: "prop",
      } satisfies RawCandle;
    });

/** A snapshot of the store's full stored set, canonicalized for comparison. */
async function snapshot(
  store: InMemoryCandleStore,
): Promise<ReadonlyArray<Candle>> {
  const all: Candle[] = [];
  for (const pair of PAIRS) {
    all.push(...(await store.getCandles(pair)));
  }
  return all.sort((a, b) => `${a.asset}:${a.date}`.localeCompare(`${b.asset}:${b.date}`));
}

const batchArb = (pair: Pair): fc.Arbitrary<readonly RawCandle[]> =>
  fc.array(candleArb(pair), { minLength: 1, maxLength: 10 });

describe("idempotent ingestion", () => {
  it("ingesting the same batch twice leaves the stored set unchanged", async () => {
    await fc.assert(
      fc.asyncProperty(
        pairArb.chain((pair) => fc.tuple(fc.constant(pair), batchArb(pair))),
        async ([pair, batch]) => {
          const store = new InMemoryCandleStore();
          const ingestion = new OhlcIngestion(store);

          await ingestion.ingest(pair, batch);
          const afterFirst = await snapshot(store);

          await ingestion.ingest(pair, batch);
          const afterSecond = await snapshot(store);

          expect(afterSecond).toEqual(afterFirst);
        },
      ),
      { numRuns: 100 },
    );
  });
});
