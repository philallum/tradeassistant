// Property-based tests for the CsvLoader parser (spec Req 1.2).
//
// Property 2 asserts the RawCandle mapping is invariant to columns 6 (Volume)
// and 7 (tick count): whatever those columns contain, the mapped candle carries
// only the verbatim Time and the Open/High/Low/Close from columns 2-5, plus the
// file's `pair` and `source: "csv"`. No field is derived from Volume or tick
// count.

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { PAIRS } from "../ingestion/types.js";
import type { Pair, RawCandle } from "../ingestion/types.js";
import { CSV_HEADER, parseCsvCandles } from "./csvLoader.js";

// Feature: operational-wiring, Property 2: CSV mapping excludes Volume and tick count
//
// Validates: Requirements 1.2

const HEADER = CSV_HEADER.join("\t");

/** A parseable finite OHLC number rendered as a string (no NaN/Infinity). */
const priceArb: fc.Arbitrary<number> = fc.double({
  min: 0.0001,
  max: 100_000,
  noNaN: true,
  noDefaultInfinity: true,
});

/** A `YYYY-MM-DD 00:00:00` timestamp, the daily CSV_Candle_File convention. */
const timeArb: fc.Arbitrary<string> = fc
  .integer({ min: 0, max: 9131 }) // 2000-01-01 .. ~2025-01-01
  .map(
    (days) =>
      `${new Date(Date.UTC(2000, 0, 1) + days * 86_400_000)
        .toISOString()
        .slice(0, 10)} 00:00:00`,
  );

/**
 * Arbitrary text for column 6 (Volume) / column 7 (tick count). These vary
 * freely — integers, decimals, negatives, huge values, and non-numeric junk —
 * but never contain a tab or newline (which would change the column count).
 */
const junkColArb: fc.Arbitrary<string> = fc.oneof(
  fc.integer({ min: -1_000_000, max: 1_000_000 }).map(String),
  fc.double({ noNaN: true, noDefaultInfinity: true }).map(String),
  fc
    .string()
    .map((s) => s.replace(/[\t\n\r]/g, ""))
    .filter((s) => s.length > 0),
);

interface RowFields {
  readonly time: string;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: string;
  readonly ticks: string;
}

const rowArb: fc.Arbitrary<RowFields> = fc.record({
  time: timeArb,
  open: priceArb,
  high: priceArb,
  low: priceArb,
  close: priceArb,
  volume: junkColArb,
  ticks: junkColArb,
});

function buildFile(rows: readonly RowFields[]): string {
  const lines = [HEADER];
  for (const r of rows) {
    lines.push(
      [r.time, r.open, r.high, r.low, r.close, r.volume, r.ticks].join("\t"),
    );
  }
  return lines.join("\n");
}

/** The set of RawCandle fields the mapper is allowed to populate (spec Req 1.2). */
const ALLOWED_FIELDS: ReadonlySet<string> = new Set([
  "pair",
  "timestamp",
  "open",
  "high",
  "low",
  "close",
  "source",
]);

describe("Property 2: CSV mapping excludes Volume and tick count", () => {
  it("maps only Time + OHLC (cols 2-5); no field is derived from Volume/tickCount", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<Pair>(...PAIRS),
        fc.array(rowArb, { minLength: 1, maxLength: 30 }),
        (pair, rows) => {
          const result = parseCsvCandles("F_D1.csv", buildFile(rows), pair);

          // Structurally valid rows always parse (Volume/ticks never affect this).
          expect(result.ok).toBe(true);
          if (!result.ok) return;

          expect(result.candles).toHaveLength(rows.length);

          result.candles.forEach((candle: RawCandle, i) => {
            const src = rows[i];
            if (!src) throw new Error("missing source row");

            // Only the seven allowed fields are present — nothing derived from
            // column 6 (Volume) or column 7 (tick count) leaked in.
            for (const key of Object.keys(candle)) {
              expect(ALLOWED_FIELDS.has(key)).toBe(true);
            }

            // The populated values come strictly from cols 1-5 and the loader.
            expect(candle.pair).toBe(pair);
            expect(candle.timestamp).toBe(src.time); // verbatim Time
            expect(candle.open).toBe(src.open);
            expect(candle.high).toBe(src.high);
            expect(candle.low).toBe(src.low);
            expect(candle.close).toBe(src.close);
            expect(candle.source).toBe("csv");

            // No value equals the (typically distinct) Volume/tick-count text,
            // and asset/date remain unpopulated.
            expect(candle.asset).toBeUndefined();
            expect(candle.date).toBeUndefined();
          });
        },
      ),
      { numRuns: 100 },
    );
  });

  it("mapped candle is unchanged when Volume/tickCount are varied arbitrarily", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<Pair>(...PAIRS),
        rowArb, // baseline row (its own volume/ticks)
        junkColArb, // alternate volume
        junkColArb, // alternate ticks
        (pair, base, altVolume, altTicks) => {
          const baseFile = buildFile([base]);
          const variedFile = buildFile([
            { ...base, volume: altVolume, ticks: altTicks },
          ]);

          const a = parseCsvCandles("F_D1.csv", baseFile, pair);
          const b = parseCsvCandles("F_D1.csv", variedFile, pair);

          expect(a.ok).toBe(true);
          expect(b.ok).toBe(true);
          if (!a.ok || !b.ok) return;

          // Changing only cols 6-7 must produce a byte-identical RawCandle.
          expect(b.candles).toEqual(a.candles);
        },
      ),
      { numRuns: 100 },
    );
  });
});
