// Feature: dashboard-ui, Property 6: Confidence-trend projection.
// For any set of `firing_setups` rows and any target `pair`, `shapeConfidenceTrend`
// produces one point per row matching `pair`, each point's `earnedConfidence` drawn
// VERBATIM from the source row's `earned_confidence`, ordered ascending by Decision_Date
// (stable over equal dates), and the accompanying accessibility table mirrors those same
// points in the same order.
//
// **Validates: Requirements 9.5, 9.10, 20.1**

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { shapeConfidenceTrend } from "./shapeCharts.ts";
import type { FiringSetupRow, Pair } from "../api/types.ts";
import { PAIRS } from "../api/types.ts";

const NUM_RUNS = 300; // >= 100 iterations required by the task.

/**
 * Arbitrary over ISO calendar-date strings in the fixed `YYYY-MM-DD` form the serving
 * layer uses, where chronological order coincides with lexicographic string order. The
 * span is intentionally small so repeated dates occur often, exercising the stable-sort
 * tie-break path of the shaper.
 */
const isoDateArb: fc.Arbitrary<string> = fc
  .date({
    min: new Date("2020-01-01T00:00:00.000Z"),
    max: new Date("2021-12-31T00:00:00.000Z"),
    noInvalidDate: true,
  })
  .map((d) => d.toISOString().slice(0, 10));

/** One of the five supported pairs, drawn verbatim from the wire-format `PAIRS` set. */
const pairArb: fc.Arbitrary<Pair> = fc.constantFrom(...PAIRS);

/**
 * A `firing_setups` row generator. Only `decision_date`, `pair`, and `earned_confidence`
 * drive this property; the remaining columns are populated with representative valid values
 * so the rows are well-formed. `earned_confidence` spans arbitrary finite doubles (incl.
 * negatives / zero / fractions) to confirm the value is carried verbatim rather than
 * recomputed, normalized, or clamped.
 */
const rowArb: fc.Arbitrary<FiringSetupRow> = fc.record({
  decision_date: isoDateArb,
  pair: pairArb,
  strategy_id: fc.uuid(),
  direction: fc.constantFrom<FiringSetupRow["direction"]>("UP", "DOWN", "FLAT"),
  horizon: fc.constantFrom<FiringSetupRow["horizon"]>(1, 2, 3),
  earned_confidence: fc.double({ noNaN: true, noDefaultInfinity: true }),
  stop_loss_pips: fc.option(fc.double({ noNaN: true, noDefaultInfinity: true }), {
    nil: null,
  }),
  take_profit_pips: fc.option(fc.double({ noNaN: true, noDefaultInfinity: true }), {
    nil: null,
  }),
  surfaced: fc.boolean(),
  suppression_reason: fc.constantFrom<FiringSetupRow["suppression_reason"]>(
    "below_floor",
    "not_fired",
    null,
  ),
});

/** A set of rows spanning multiple pairs so the per-pair filter is genuinely exercised. */
const rowsArb: fc.Arbitrary<readonly FiringSetupRow[]> = fc.array(rowArb, {
  minLength: 0,
  maxLength: 40,
});

describe("Property 6: Confidence-trend projection", () => {
  it("emits one verbatim, date-ascending point per matching row, mirrored by the a11y table", () => {
    fc.assert(
      fc.property(rowsArb, pairArb, (rows, pair) => {
        const series = shapeConfidenceTrend(rows, pair);
        const matching = rows.filter((row) => row.pair === pair);

        // The series echoes the requested pair.
        expect(series.pair).toBe(pair);

        // (count) One point per row whose pair matches the target — no more, no fewer.
        expect(series.points.length).toBe(matching.length);

        // (ascending) Points are non-decreasing by Decision_Date.
        for (let i = 1; i < series.points.length; i += 1) {
          expect(series.points[i]!.decisionDate >= series.points[i - 1]!.decisionDate).toBe(
            true,
          );
        }

        // (verbatim + stable order) Sorting the matching rows ourselves with a stable sort
        // over the ISO date must reproduce the exact (date, confidence) sequence — proving
        // every `earnedConfidence` is the source row's value verbatim and that ties keep
        // input order.
        const expected = matching
          .map((row, index) => ({ row, index }))
          .sort((a, b) => {
            if (a.row.decision_date < b.row.decision_date) return -1;
            if (a.row.decision_date > b.row.decision_date) return 1;
            return a.index - b.index;
          })
          .map((entry) => entry.row);

        expect(series.points.length).toBe(expected.length);
        series.points.forEach((point, i) => {
          const sourceRow = expected[i]!;
          expect(point.decisionDate).toBe(sourceRow.decision_date);
          // Verbatim identity: use Object.is so a signed-zero or exact double is not
          // treated as "equal enough" by coercion.
          expect(Object.is(point.earnedConfidence, sourceRow.earned_confidence)).toBe(true);
        });

        // (a11y mirror) The accessibility table lists the same values in the same order.
        expect(series.table.columns).toEqual(["Decision date", "Earned confidence"]);
        expect(series.table.rows.length).toBe(series.points.length);
        series.table.rows.forEach((tableRow, i) => {
          const point = series.points[i]!;
          expect(tableRow[0]).toBe(point.decisionDate);
          expect(Object.is(tableRow[1], point.earnedConfidence)).toBe(true);
        });

        // (isolation) No point carries a pair other than the target — the filter never
        // leaks a foreign-pair row into the projection.
        expect(series.points.length).toBe(
          rows.filter((row) => row.pair === pair).length,
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
