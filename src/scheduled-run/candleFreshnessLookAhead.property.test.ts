import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { OhlcIngestion } from "../ingestion/ohlcIngestion.js";
import {
  InMemoryCandleStore,
  PAIRS,
  type Pair,
  type RawCandle,
} from "../ingestion/types.js";
import { compareTradingDates, formatTradingDate } from "../guard/tradingDate.js";
import type { TradingDate } from "../guard/types.js";

// Feature: daily-candle-freshness-and-cleanup, Property 2: look-ahead safety of
// ingested candles
//
// Validates: Requirements 2.2, 4.2
//
// Given RawCandles with dates STRADDLING a random Decision_Date, after
// `ingest(pair, raw, decisionDate)` no stored candle is dated on/after the
// Decision_Date. The look-ahead guard rejects any at/after-dated row; because it
// runs BEFORE the upsert, a violating batch stores nothing (the stage then
// degrades for that pair), so the invariant holds either way.

const pairArb: fc.Arbitrary<Pair> = fc.constantFrom(...PAIRS);

const weekdayDateArb: fc.Arbitrary<TradingDate> = fc
  .date({
    min: new Date(Date.UTC(2018, 0, 1)),
    max: new Date(Date.UTC(2030, 11, 31)),
    noInvalidDate: true,
  })
  .map((d) => formatTradingDate(d))
  .filter((d) => {
    const day = new Date(`${d}T00:00:00Z`).getUTCDay();
    return day >= 1 && day <= 5;
  });

function validCandle(pair: Pair, date: TradingDate): RawCandle {
  return { asset: pair, pair, date, open: 1.1, high: 1.3, low: 1.0, close: 1.2, source: "prop" };
}

describe("look-ahead safety of ingested candles", () => {
  it("no stored candle is dated on/after the decision date", async () => {
    await fc.assert(
      fc.asyncProperty(
        pairArb,
        weekdayDateArb, // decisionDate
        fc.array(weekdayDateArb, { minLength: 1, maxLength: 12 }),
        async (pair, decisionDate, dates) => {
          const batch = dates.map((d) => validCandle(pair, d));

          const store = new InMemoryCandleStore();
          const ingestion = new OhlcIngestion(store);

          // The guard throws when the batch contains an at/after-dated row; the
          // stage catches this per pair. Here we only assert the stored set is
          // look-ahead safe, so swallow the throw exactly as the stage does.
          try {
            await ingestion.ingest(pair, batch, decisionDate);
          } catch {
            // violating batch — nothing was upserted.
          }

          const stored = await store.getCandles(pair);
          for (const candle of stored) {
            expect(compareTradingDates(candle.date, decisionDate)).toBeLessThan(0);
          }
        },
      ),
      { numRuns: 150 },
    );
  });
});
