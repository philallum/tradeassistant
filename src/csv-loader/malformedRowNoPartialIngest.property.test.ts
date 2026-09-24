// Property-based test for the CSV_Loader parser (spec Req 1.9).
//
// This exercises the PARSING seam (`parseCsvCandles`) only; it touches no disk
// and no ingestion. The generator builds a file with a VALID header and a set
// of otherwise-valid data rows, then injects at least one STRUCTURALLY malformed
// row at an arbitrary position, so the property isolates the all-or-nothing
// abort-and-feed-nothing behavior from every other parse concern.
//
// NOTE: this is a STRUCTURAL / parse failure (wrong tab-column count, or an
// unparsable Time/Open/High/Low/Close). It is deliberately DISTINCT from
// OHLC-validity rejection (e.g. high < low), which is structurally valid here
// and is the ingestion module's job — those rows are NOT tested here.

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { PAIRS } from "../ingestion/types.js";
import { CSV_HEADER, parseCsvCandles } from "./csvLoader.js";

// Feature: operational-wiring, Property 6: A malformed row causes no partial ingest
//
// Validates: Requirements 1.9
//
// Requirement 1.9: if a data row does not contain exactly 7 tab-separated
// columns, OR contains a Time/Open/High/Low/Close value that cannot be parsed
// into its expected type, the parser must abort processing of that file, report
// an error identifying the file by name AND the offending row, and feed NO
// candles from that file (all-or-nothing — no partial ingest).

const HEADER_LINE = CSV_HEADER.join("\t");

/**
 * Build one otherwise-valid 7-column data row (6 named fields + trailing tick
 * count). These are structurally correct AND OHLC-orderly, so the only thing
 * that makes the file fail is the injected malformed row.
 */
function validDataRow(seed: number): string {
  const base = 1 + (seed % 50) / 100; // 1.00 .. 1.49
  const open = base;
  const high = base + 0.02;
  const low = base - 0.02;
  const close = base + 0.005;
  const day = String(1 + (seed % 28)).padStart(2, "0");
  const time = `2020-01-${day} 00:00:00`;
  const volume = String(1000 + seed);
  const ticks = String(seed % 500);
  return [time, open, high, low, close, volume, ticks].join("\t");
}

/**
 * Generates a single STRUCTURALLY malformed data row. Every branch is a genuine
 * parse-level failure the parser must reject: wrong tab-column count (too few or
 * too many), empty Time, or a non-numeric Open/High/Low/Close. It never emits an
 * OHLC-validity issue (e.g. high < low) — those are structurally valid and left
 * to ingestion.
 */
const malformedRowArb: fc.Arbitrary<string> = fc.oneof(
  // Too few columns (1..6). Uses a leading non-empty token so the row is never
  // a blank line (which the parser legitimately skips) — it is a real data row
  // with the wrong column count.
  fc
    .array(fc.string({ maxLength: 8 }), { minLength: 0, maxLength: 5 })
    .map((rest) => ["2020-03-01 00:00:00", ...rest].join("\t")),
  // Too many columns (8..12).
  fc
    .array(fc.string({ maxLength: 8 }), { minLength: 8, maxLength: 12 })
    .map((cols) => cols.join("\t")),
  // Exactly 7 columns but empty Time.
  fc
    .tuple(
      fc.double({ min: 0.5, max: 2, noNaN: true, noDefaultInfinity: true }),
      fc.integer({ min: 0, max: 100000 }),
    )
    .map(([base, ticks]) =>
      ["", base, base + 0.02, base - 0.02, base + 0.005, 1000, ticks].join("\t"),
    ),
  // Exactly 7 columns but a non-numeric value in one of Open/High/Low/Close.
  fc
    .tuple(
      fc.integer({ min: 1, max: 4 }), // which OHLC column (1..4) is corrupted
      // Genuinely non-numeric tokens. NOTE: `Number("")` and `Number(" ")` are
      // 0 (finite), so blanks are deliberately excluded — they parse fine.
      fc.constantFrom("N/A", "abc", "--", "1.2.3", "NaN", "x", "1e", "+-2"),
      fc.integer({ min: 0, max: 100000 }),
    )
    .map(([badCol, badValue, ticks]) => {
      const cols = ["2020-02-01 00:00:00", "1.10", "1.12", "1.08", "1.105", "1000", String(ticks)];
      cols[badCol] = badValue;
      return cols.join("\t");
    }),
);

const scenarioArb = fc
  .record({
    file: fc.constantFrom(...PAIRS).map((pair) => `${pair}_D1.csv`),
    pair: fc.constantFrom(...PAIRS),
    // Otherwise-valid data rows surrounding the malformed one.
    validSeeds: fc.array(fc.integer({ min: 0, max: 100000 }), {
      minLength: 0,
      maxLength: 8,
    }),
    malformedRow: malformedRowArb,
    crlf: fc.boolean(),
  })
  // Position at which to inject the malformed row among the valid rows
  // (0..validSeeds.length, i.e. it can be first, middle, or last).
  .chain((s) =>
    fc
      .integer({ min: 0, max: s.validSeeds.length })
      .map((insertAt) => ({ ...s, insertAt })),
  );

describe("Property 6: a malformed row causes no partial ingest", () => {
  it("returns the failure branch with a file-named, row-identified CsvParseError and zero candles", () => {
    fc.assert(
      fc.property(scenarioArb, ({ file, pair, validSeeds, malformedRow, insertAt, crlf }) => {
        const eol = crlf ? "\r\n" : "\n";

        const validRows = validSeeds.map((seed) => validDataRow(seed));
        const dataRows = [
          ...validRows.slice(0, insertAt),
          malformedRow,
          ...validRows.slice(insertAt),
        ];
        const contents = [HEADER_LINE, ...dataRows].join(eol);

        const result = parseCsvCandles(file, contents, pair);

        // 1. All-or-nothing: must be the failure branch of the discriminated result.
        expect(result.ok).toBe(false);
        if (result.ok) {
          throw new Error("expected failure branch");
        }

        // 2. The error identifies the file by name.
        expect(result.error.file).toBe(file);

        // 3. The error identifies the offending row — a positive 1-based data
        //    row index equal to the malformed row's position among data rows.
        expect(result.error.offendingRow).toBe(insertAt + 1);

        // 4. A non-empty human-readable reason accompanies the error.
        expect(typeof result.error.reason).toBe("string");
        expect(result.error.reason.length).toBeGreaterThan(0);

        // 5. NO candles are produced/fed — no partial parse of preceding valid
        //    rows. The failure branch carries no `candles` field at all.
        expect("candles" in result).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});
