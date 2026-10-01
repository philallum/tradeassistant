// Property-based test for the CSV_Loader parser (spec Req 1.1).
//
// This exercises the PARSING seam (`parseCsvCandles`) only; it touches no disk
// and no ingestion. The generator constructs the SAME logical CSV content and
// materializes it with two different line-ending conventions, so the property
// isolates line-ending handling from every other parse concern.

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { PAIRS } from "../ingestion/types.js";
import type { Pair } from "../ingestion/types.js";
import { CSV_HEADER, parseCsvCandles } from "./csvLoader.js";

// Feature: operational-wiring, Property 1: CSV parsing is line-ending independent
//
// Validates: Requirements 1.1

/**
 * A single logical CSV_Candle_File described as an ordered list of physical
 * lines: line 0 is the header, the rest are valid 7-column tab-separated data
 * rows (6 named fields + trailing tick count). Keeping the lines as an abstract
 * array — rather than a joined string — lets us join with LF vs CRLF without
 * changing the underlying logical content, which is exactly the invariant under
 * test.
 */
const logicalFileArb: fc.Arbitrary<{ pair: Pair; lines: string[] }> = fc
  .tuple(
    fc.constantFrom<Pair>(...PAIRS),
    fc.array(
      fc.record({
        // Distinct verbatim daily timestamps of the documented shape.
        dayOffset: fc.integer({ min: 0, max: 5000 }),
        open: fc.double({ min: 0.1, max: 200, noNaN: true, noDefaultInfinity: true }),
        high: fc.double({ min: 0.1, max: 200, noNaN: true, noDefaultInfinity: true }),
        low: fc.double({ min: 0.1, max: 200, noNaN: true, noDefaultInfinity: true }),
        close: fc.double({ min: 0.1, max: 200, noNaN: true, noDefaultInfinity: true }),
        volume: fc.integer({ min: 0, max: 1_000_000 }),
        ticks: fc.integer({ min: 0, max: 100_000 }),
      }),
      { minLength: 1, maxLength: 20 },
    ),
  )
  .map(([pair, rows]) => {
    const header = CSV_HEADER.join("\t");
    const DAY_MS = 86_400_000;
    const base = Date.UTC(2010, 0, 1);
    const dataLines = rows.map((r) => {
      const date = new Date(base + r.dayOffset * DAY_MS)
        .toISOString()
        .slice(0, 10);
      const time = `${date} 00:00:00`;
      return [time, r.open, r.high, r.low, r.close, r.volume, r.ticks].join(
        "\t",
      );
    });
    return { pair, lines: [header, ...dataLines] };
  });

describe("Property 1: CSV parsing is line-ending independent", () => {
  it("parses identical results whether logical lines are joined with LF or CRLF", () => {
    fc.assert(
      fc.property(
        logicalFileArb,
        // A random optional trailing newline — a real CSV_Candle_File often ends
        // with one, and it must not perturb the parse relative to the same
        // content without one, in either ending style.
        fc.boolean(),
        ({ pair, lines }, trailingNewline) => {
          const lfContent = lines.join("\n") + (trailingNewline ? "\n" : "");
          const crlfContent =
            lines.join("\r\n") + (trailingNewline ? "\r\n" : "");

          const lfResult = parseCsvCandles("EURUSD_D1.csv", lfContent, pair);
          const crlfResult = parseCsvCandles(
            "EURUSD_D1.csv",
            crlfContent,
            pair,
          );

          // Same logical content ⇒ identical discriminated result regardless of
          // the line-ending convention used to materialize it.
          expect(crlfResult).toStrictEqual(lfResult);

          // And that shared result must be a successful, non-empty parse — this
          // rules out the vacuous case where both variants fail identically and
          // still compare equal.
          expect(lfResult.ok).toBe(true);
          if (lfResult.ok) {
            expect(lfResult.candles.length).toBe(lines.length - 1);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
