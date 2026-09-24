import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { parseCsvCandles, CSV_HEADER } from "./csvLoader.js";
import type { Pair } from "../ingestion/types.js";

// Feature: operational-wiring, Property 3: CSV timestamp is passed through verbatim
//
// Validates: Requirements 1.3
//
// The parser performs NO timestamp altering, shifting, reformatting, or
// normalization (that is the ingestion module's job). For any valid
// `YYYY-MM-DD HH:MM:SS` Time string placed in column 1 of a data row, the
// resulting RawCandle.timestamp must equal the raw input Time string
// byte-for-byte.

const PAIRS: readonly Pair[] = [
  "EURUSD",
  "GBPUSD",
  "USDJPY",
  "USDCHF",
  "USDCAD",
] as const;

const pad2 = (n: number): string => n.toString().padStart(2, "0");
const pad4 = (n: number): string => n.toString().padStart(4, "0");

/**
 * Arbitrary calendar-shaped `YYYY-MM-DD HH:MM:SS` Time strings. The generator
 * ranges broadly (any day 01-28, any hour/minute/second, including but not
 * limited to the `00:00:00` daily-candle form) so the verbatim guarantee is
 * exercised well beyond the single documented example.
 */
const timeStringArb: fc.Arbitrary<string> = fc
  .record({
    year: fc.integer({ min: 1970, max: 2100 }),
    month: fc.integer({ min: 1, max: 12 }),
    day: fc.integer({ min: 1, max: 28 }),
    hour: fc.integer({ min: 0, max: 23 }),
    minute: fc.integer({ min: 0, max: 59 }),
    second: fc.integer({ min: 0, max: 59 }),
  })
  .map(
    ({ year, month, day, hour, minute, second }) =>
      `${pad4(year)}-${pad2(month)}-${pad2(day)} ${pad2(hour)}:${pad2(minute)}:${pad2(second)}`,
  );

/** A finite OHLC price. */
const priceArb: fc.Arbitrary<number> = fc.double({
  min: 0.0001,
  max: 100_000,
  noNaN: true,
  noDefaultInfinity: true,
});

const HEADER_LINE = CSV_HEADER.join("\t");

describe("Property 3: CSV timestamp is passed through verbatim", () => {
  it("RawCandle.timestamp equals the raw Time column byte-for-byte", () => {
    fc.assert(
      fc.property(
        timeStringArb,
        priceArb,
        priceArb,
        priceArb,
        priceArb,
        fc.integer({ min: 0, max: 1_000_000 }), // Volume (col 6, dropped)
        fc.integer({ min: 0, max: 100_000 }), // tick count (col 7, dropped)
        fc.constantFrom(...PAIRS),
        fc.constantFrom("\n", "\r\n"),
        (time, open, high, low, close, volume, ticks, pair, eol) => {
          const dataRow = [time, open, high, low, close, volume, ticks].join(
            "\t",
          );
          const contents = [HEADER_LINE, dataRow].join(eol);

          const result = parseCsvCandles("EURUSD_D1.csv", contents, pair);

          // The row is structurally valid, so parsing must succeed.
          expect(result.ok).toBe(true);
          if (!result.ok) return;

          expect(result.candles).toHaveLength(1);
          const candle = result.candles[0];
          // Verbatim: strict byte-for-byte equality with the raw Time string.
          // No shifting, no normalization, no reformatting (Req 1.3).
          expect(candle?.timestamp).toBe(time);
          // And it is the exact same string reference-value the caller supplied,
          // not a re-parsed/reserialized Date or number.
          expect(typeof candle?.timestamp).toBe("string");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("preserves every distinct Time verbatim across many rows in one file", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            time: timeStringArb,
            open: priceArb,
            high: priceArb,
            low: priceArb,
            close: priceArb,
          }),
          { minLength: 1, maxLength: 40 },
        ),
        fc.constantFrom(...PAIRS),
        (rows, pair) => {
          const lines = [HEADER_LINE];
          for (const r of rows) {
            lines.push(
              [r.time, r.open, r.high, r.low, r.close, 1000, 5].join("\t"),
            );
          }
          const contents = lines.join("\n");

          const result = parseCsvCandles("EURUSD_D1.csv", contents, pair);

          expect(result.ok).toBe(true);
          if (!result.ok) return;

          expect(result.candles).toHaveLength(rows.length);
          // Each parsed candle's timestamp matches its source row's Time exactly,
          // in order — no reordering, no reformatting.
          rows.forEach((r, i) => {
            expect(result.candles[i]?.timestamp).toBe(r.time);
          });
        },
      ),
      { numRuns: 100 },
    );
  });
});
