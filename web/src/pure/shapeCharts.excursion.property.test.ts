// Feature: dashboard-ui, Property 7: Excursion-profile projection
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { shapeExcursionProfile } from "./shapeCharts.ts";
import type { AnalogueOutcomeRow, Direction, Horizon } from "../api/types.ts";

// For any set of `analogue_outcomes` rows, `shapeExcursionProfile` produces one point per
// row whose `mfe_pips`/`mae_pips` (and horizon/direction) equal the source row's values
// verbatim, ordered ascending by Decision_Date; the a11y table mirrors the same values in
// the same order. No value is recomputed or interpolated (Req 10.4, 20.1).
//
// **Validates: Requirements 9.6, 10.4, 20.1**

const NUM_RUNS = 300; // >= 100 iterations required by the task.

const DIRECTIONS: readonly Direction[] = ["UP", "DOWN", "FLAT"];
const HORIZONS: readonly Horizon[] = [1, 2, 3];

const directionArb: fc.Arbitrary<Direction> = fc.constantFrom(...DIRECTIONS);
const horizonArb: fc.Arbitrary<Horizon> = fc.constantFrom(...HORIZONS);

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
 * Arbitrary over a single `v_analogue_outcomes` wire-format row. `mfe_pips`/`mae_pips` span
 * negatives, zero, and fractional values (noNaN) so the verbatim-copy assertion is checked
 * across the real numeric input space, not just tidy positives. `asset`/`matured` are
 * generated too (the shaper ignores them, but realistic rows keep the test honest).
 */
const rowArb: fc.Arbitrary<AnalogueOutcomeRow> = fc.record({
  asset: fc.string({ minLength: 1, maxLength: 8 }),
  decision_date: isoDateArb,
  horizon: horizonArb,
  direction: directionArb,
  mfe_pips: fc.double({ min: -1000, max: 1000, noNaN: true }),
  mae_pips: fc.double({ min: -1000, max: 1000, noNaN: true }),
  matured: fc.boolean(),
});

const rowsArb: fc.Arbitrary<readonly AnalogueOutcomeRow[]> = fc.array(rowArb, {
  minLength: 0,
  maxLength: 40,
});

/** Multiset key for a row's charted fields, so we can compare bags ignoring order. */
function rowKey(
  decisionDate: string,
  horizon: Horizon,
  direction: Direction,
  mfePips: number,
  maePips: number,
): string {
  return JSON.stringify([decisionDate, horizon, direction, mfePips, maePips]);
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

describe("Property 7: Excursion-profile projection", () => {
  it("one verbatim point per row, ascending by Decision_Date, a11y table mirrors points", () => {
    fc.assert(
      fc.property(rowsArb, (rows) => {
        const series = shapeExcursionProfile(rows);

        // (1) One point per input row — none dropped, none fabricated.
        expect(series.points.length).toBe(rows.length);

        // (2) Verbatim projection: the bag of charted fields equals the bag of source
        // rows' fields field-for-field (no recomputation / interpolation).
        const pointKeys = series.points.map((p) =>
          rowKey(p.decisionDate, p.horizon, p.direction, p.mfePips, p.maePips),
        );
        const expectedKeys = rows.map((r) =>
          rowKey(r.decision_date, r.horizon, r.direction, r.mfe_pips, r.mae_pips),
        );
        expectSameBag(pointKeys, expectedKeys);

        // (3) Ordered ascending (non-decreasing) by Decision_Date.
        for (let i = 1; i < series.points.length; i += 1) {
          expect(series.points[i - 1]!.decisionDate <= series.points[i]!.decisionDate).toBe(
            true,
          );
        }

        // (4) a11y table mirrors the points in the SAME order, cell-for-cell verbatim.
        expect(series.table.columns).toEqual([
          "Decision date",
          "Horizon",
          "Direction",
          "MFE (pips)",
          "MAE (pips)",
        ]);
        expect(series.table.rows.length).toBe(series.points.length);
        series.points.forEach((p, i) => {
          expect(series.table.rows[i]).toEqual([
            p.decisionDate,
            p.horizon,
            p.direction,
            p.mfePips,
            p.maePips,
          ]);
        });
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("stable order: rows sharing a Decision_Date keep their input order", () => {
    fc.assert(
      fc.property(
        fc.array(rowArb, { minLength: 2, maxLength: 20 }),
        fc.constantFrom("2024-02-01", "2024-02-15"),
        (rows, sharedDate) => {
          // Force every row onto the same Decision_Date so the ONLY correct output order
          // is the input order (the stable-sort tie-break).
          const sameDate = rows.map((r) => ({ ...r, decision_date: sharedDate }));
          const series = shapeExcursionProfile(sameDate);

          expect(series.points.length).toBe(sameDate.length);
          sameDate.forEach((r, i) => {
            const p = series.points[i]!;
            expect(p.decisionDate).toBe(r.decision_date);
            expect(p.horizon).toBe(r.horizon);
            expect(p.direction).toBe(r.direction);
            expect(p.mfePips).toBe(r.mfe_pips);
            expect(p.maePips).toBe(r.mae_pips);
          });
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("empty input yields no points and an empty a11y table body", () => {
    const series = shapeExcursionProfile([]);
    expect(series.points).toEqual([]);
    expect(series.table.rows).toEqual([]);
    expect(series.table.columns).toEqual([
      "Decision date",
      "Horizon",
      "Direction",
      "MFE (pips)",
      "MAE (pips)",
    ]);
  });
});
