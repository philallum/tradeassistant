import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { CSV_HEADER, parseCsvCandles } from "./csvLoader.js";
import { PAIRS } from "../ingestion/types.js";

// Feature: operational-wiring, Property 4: A malformed header aborts the file and feeds nothing
//
// Validates: Requirements 1.5.
//
// Requirement 1.5: if a file's parsed header row does not contain EXACTLY the 6
// expected columns (Time, Open, High, Low, Close, Volume) in the expected order,
// the parser must abort that file, return an error result identifying the file
// by name, and feed NO candles.

const EXPECTED_HEADER = [...CSV_HEADER]; // ["Time","Open","High","Low","Close","Volume"]

/**
 * Build the tab-separated text of one otherwise-valid 7-column data row. These
 * rows are structurally correct (7 tab columns, finite OHLC, non-empty Time) so
 * the ONLY thing that can make the file fail is the malformed header — this
 * isolates the header-abort behavior under test.
 */
function validDataRow(seed: number): string {
  const base = 1 + (seed % 50) / 100; // 1.00 .. 1.49
  const open = base;
  const high = base + 0.01;
  const low = base - 0.01;
  const close = base + 0.005;
  const day = String(1 + (seed % 28)).padStart(2, "0");
  const time = `2020-01-${day} 00:00:00`;
  const volume = String(1000 + seed);
  const tickCount = String(seed);
  return [time, open, high, low, close, volume, tickCount].join("\t");
}

/**
 * Column-name pool used to build header rows. Includes the expected names plus
 * plausible-but-wrong alternatives so generated headers can be wrong by name,
 * case, count, or order.
 */
const columnNameArb = fc.oneof(
  fc.constantFrom(...EXPECTED_HEADER),
  fc.constantFrom(
    "time",
    "TIME",
    "Timestamp",
    "open",
    "OPEN",
    "Opening",
    "high",
    "low",
    "close",
    "Vol",
    "volume",
    "VOLUME",
    "TickCount",
    "Extra",
    "",
  ),
  fc.string({ minLength: 1, maxLength: 8 }),
);

/**
 * Generates header column arrays that are guaranteed NOT to equal the expected
 * 6 columns in order. Covers wrong count (too few / too many), wrong names,
 * wrong case, wrong order (a shuffle that differs), and extra/missing columns.
 * Anything that happens to reconstruct the exact expected header is rejected.
 */
const malformedHeaderColsArb: fc.Arbitrary<string[]> = fc
  .oneof(
    // Arbitrary columns of arbitrary length (0..10) — most are malformed.
    fc.array(columnNameArb, { minLength: 0, maxLength: 10 }),
    // A permutation of the expected header (order and/or count perturbed).
    fc.shuffledSubarray(EXPECTED_HEADER, { minLength: 0, maxLength: 6 }),
    // Expected header plus one or more extra trailing columns.
    fc
      .array(columnNameArb, { minLength: 1, maxLength: 4 })
      .map((extra) => [...EXPECTED_HEADER, ...extra]),
    // Expected header with one column dropped.
    fc
      .integer({ min: 0, max: EXPECTED_HEADER.length - 1 })
      .map((i) => EXPECTED_HEADER.filter((_, idx) => idx !== i)),
    // Expected header with one column renamed.
    fc
      .tuple(
        fc.integer({ min: 0, max: EXPECTED_HEADER.length - 1 }),
        fc.string({ minLength: 1, maxLength: 8 }),
      )
      .map(([i, name]) => EXPECTED_HEADER.map((c, idx) => (idx === i ? name : c))),
  )
  .filter(
    (cols) =>
      // Exclude the (rare) case that equals the exact expected header in order.
      !(
        cols.length === EXPECTED_HEADER.length &&
        EXPECTED_HEADER.every((expected, i) => cols[i] === expected)
      ),
  );

const scenarioArb = fc.record({
  file: fc
    .constantFrom(...PAIRS)
    .map((pair) => `${pair}_D1.csv`),
  pair: fc.constantFrom(...PAIRS),
  headerCols: malformedHeaderColsArb,
  // Zero or more otherwise-valid data rows follow the malformed header.
  dataSeeds: fc.array(fc.integer({ min: 0, max: 100000 }), {
    minLength: 0,
    maxLength: 6,
  }),
  // Exercise both CRLF and LF endings.
  crlf: fc.boolean(),
});

describe("Property 4: a malformed header aborts the file and feeds nothing", () => {
  it("returns the failure branch with a file-named CsvParseError and zero candles", () => {
    fc.assert(
      fc.property(scenarioArb, ({ file, pair, headerCols, dataSeeds, crlf }) => {
        const eol = crlf ? "\r\n" : "\n";
        const headerLine = headerCols.join("\t");
        const dataLines = dataSeeds.map((s) => validDataRow(s));
        const contents = [headerLine, ...dataLines].join(eol);

        const result = parseCsvCandles(file, contents, pair);

        // 1. Must be the failure branch of the discriminated result.
        expect(result.ok).toBe(false);

        // 2. Failure carries a CsvParseError identifying the file by name.
        if (result.ok) {
          throw new Error("expected failure branch");
        }
        expect(result.error.file).toBe(file);
        expect(typeof result.error.reason).toBe("string");
        expect(result.error.reason.length).toBeGreaterThan(0);

        // 3. No candles are produced/fed — the failure branch has no `candles`.
        expect("candles" in result).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});
