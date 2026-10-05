// Feature: dashboard-ui, Property 8: Price-series projection
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { shapePriceSeries } from "./shapeCharts.ts";
import type { CandleRow } from "../api/endpoints.ts";

// For any set of `candles` rows, `shapePriceSeries` produces one point per row whose OHLC
// (open/high/low/close) equal the source row's values verbatim, ordered ascending by
// `date`; the a11y table mirrors the same values in the same order. No value is recomputed
// or interpolated (Req 9.9, 9.10, 20.1).
//
// **Validates: Requirements 9.9, 9.10, 20.1**

const NUM_RUNS = 300; // >= 100 iterations required by the task.

/**
 * Arbitrary over ISO calendar-date strings in the fixed `YYYY-MM-DD` form the shaper
 * assumes (chronological order coincides with lexicographic string order). The span is
 * bounded and intentionally small so dates collide frequently, exercising the stable-sort
 * tie-breaking path (rows sharing a date must keep input order).
 */
const isoDateArb: fc.Arbitrary<string> = fc
  .date({
    min: new Date("2024-01-01T00:00:00.000Z"),
    max: new Date("2024-03-31T00:00:00.000Z"),
    noInvalidDate: true,
  })
  .map((d) => d.toISOString().slice(0, 10));

/**
 * Arbitrary over a single `v_candles` wire-format row. The OHLC values span negatives,
 * zero, and fractional values (noNaN) so the verbatim-copy assertion is checked across the
 * real numeric input space, not just tidy positives. `asset` is generated too (the shaper
 * ignores it, but realistic rows keep the test honest).
 */
const rowArb: fc.Arbitrary<CandleRow> = fc.record({
  asset: fc.string({ minLength: 1, maxLength: 8 }),
  date: isoDateArb,
  open: fc.double({ min: -1000, max: 1000, noNaN: true }),
  high: fc.double({ min: -1000, max: 1000, noNaN: true }),
  low: fc.double({ min: -1000, max: 1000, noNaN: true }),
  close: fc.double({ min: -1000, max: 1000, noNaN: true }),
});

const rowsArb: fc.Arbitrary<readonly CandleRow[]> = fc.array(rowArb, {
  minLength: 0,
  maxLength: 40,
});

/** Multiset key for a row's charted fields, so we can compare bags ignoring order. */
function rowKey(
  date: string,
  open: number,
  high: number,
  low: number,
  close: number,
): string {
  return JSON.stringify([date, open, high, low, close]);
}

function bag(keys: readonly string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
  return m;
}

function expectSameBag(a: readonly string[], b: readonly string[]): void {
  const ba = bag(a);
  const bb = bag(b);
  expect(ba.size).toBe(bb.size);
  for (const [k, n] of ba) {
    expect(bb.get(k)).toBe(n);
  }
}

describe("Property 8: Price-series projection", () => {
  it("one verbatim OHLC point per row, ascending by date, a11y table mirrors points", () => {
    fc.assert(
      fc.property(rowsArb, (rows) => {
        const series = shapePriceSeries(rows);

        // (1) One point per input row — none dropped, none fabricated.
        expect(series.points.length).toBe(rows.length);

        // (2) Verbatim projection: the bag of charted fields equals the bag of source
        // rows' fields field-for-field (no recomputation / interpolation).
        const pointKeys = series.points.map((p) =>
          rowKey(p.date, p.open, p.high, p.low, p.close),
        );
        const expectedKeys = rows.map((r) =>
          rowKey(r.date, r.open, r.high, r.low, r.close),
        );
        expectSameBag(pointKeys, expectedKeys);

        // (3) Ordered ascending (non-decreasing) by date.
        for (let i = 1; i < series.points.length; i += 1) {
          expect(series.points[i - 1]!.date <= series.points[i]!.date).toBe(true);
        }

        // (4) a11y table mirrors the points in the SAME order, cell-for-cell verbatim.
        expect(series.table.columns).toEqual([
          "Date",
          "Open",
          "High",
          "Low",
          "Close",
        ]);
        expect(series.table.rows.length).toBe(series.points.length);
        series.points.forEach((p, i) => {
          expect(series.table.rows[i]).toEqual([p.date, p.open, p.high, p.low, p.close]);
        });
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("verbatim OHLC uses exact float identity (Object.is)", () => {
    fc.assert(
      fc.property(rowsArb, (rows) => {
        const series = shapePriceSeries(rows);
        // Each output point's OHLC/date must be byte-exact identical to SOME source row's
        // (bag membership already proven above; here we assert exact float identity so a
        // silent rounding/renormalization would be caught, e.g. -0 vs 0).
        const sourceKeys = bag(
          rows.map((r) => rowKey(r.date, r.open, r.high, r.low, r.close)),
        );
        series.points.forEach((p) => {
          // Reconstruct this point from the matching source row via Object.is on each
          // field: find a source row that is identical field-for-field.
          const match = rows.some(
            (r) =>
              r.date === p.date &&
              Object.is(r.open, p.open) &&
              Object.is(r.high, p.high) &&
              Object.is(r.low, p.low) &&
              Object.is(r.close, p.close),
          );
          expect(match).toBe(true);
        });
        // Sanity: the exact-identity bag has the same cardinality as the point count.
        expect([...sourceKeys.values()].reduce((a, b) => a + b, 0)).toBe(
          series.points.length,
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("stable order: rows sharing a date keep their input order", () => {
    fc.assert(
      fc.property(
        fc.array(rowArb, { minLength: 2, maxLength: 20 }),
        fc.constantFrom("2024-02-01", "2024-02-15"),
        (rows, sharedDate) => {
          // Force every row onto the same date so the ONLY correct output order is the
          // input order (the stable-sort tie-break).
          const sameDate = rows.map((r) => ({ ...r, date: sharedDate }));
          const series = shapePriceSeries(sameDate);

          expect(series.points.length).toBe(sameDate.length);
          sameDate.forEach((r, i) => {
            const p = series.points[i]!;
            expect(p.date).toBe(r.date);
            expect(Object.is(p.open, r.open)).toBe(true);
            expect(Object.is(p.high, r.high)).toBe(true);
            expect(Object.is(p.low, r.low)).toBe(true);
            expect(Object.is(p.close, r.close)).toBe(true);
          });
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("empty input yields no points and an empty a11y table body", () => {
    const series = shapePriceSeries([]);
    expect(series.points).toEqual([]);
    expect(series.table.rows).toEqual([]);
    expect(series.table.columns).toEqual(["Date", "Open", "High", "Low", "Close"]);
  });
});
