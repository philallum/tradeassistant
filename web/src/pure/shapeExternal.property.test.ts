// Feature: dashboard-ui, Property 10: External-comparison projection
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { shapeExternal } from "./shapeExternal.ts";
import type { ExternalReferenceComparisonRow } from "../api/types.ts";

// For any set of `external_reference_comparison` rows for a pair + Decision_Date,
// `shapeExternal` projects the system's own Direction_Class, the provider's reference
// direction, and the Reference_Comparison verbatim from the latest-Decision_Date row; and
// when that comparison is `unavailable` it yields an explicit "reference unavailable"
// marker (a non-error display state), never a fabricated reference (Req 12.1, 12.3, 20.1).
//
// **Validates: Requirements 12.1, 12.3**

const NUM_RUNS = 300; // >= 100 iterations required by the task.

const OWN_DIRECTIONS: readonly (ExternalReferenceComparisonRow["own_direction"])[] = [
  "UP",
  "DOWN",
  "FLAT",
  null,
];
const REFERENCE_DIRECTIONS: readonly (ExternalReferenceComparisonRow["reference_direction"])[] =
  ["BUY", "SELL", "HOLD", null];
const COMPARISONS: readonly ExternalReferenceComparisonRow["comparison"][] = [
  "agree",
  "diverge",
  "neutral",
  "unavailable",
];

/**
 * Arbitrary over ISO calendar-date strings in the fixed `YYYY-MM-DD` form the shaper
 * assumes (chronological order coincides with lexicographic string order). The span is
 * bounded and intentionally small so dates collide frequently, exercising the
 * latest-row-selection path when several rows share the maximum Decision_Date.
 */
const isoDateArb: fc.Arbitrary<string> = fc
  .date({
    min: new Date("2024-01-01T00:00:00.000Z"),
    max: new Date("2024-03-31T00:00:00.000Z"),
    noInvalidDate: true,
  })
  .map((d) => d.toISOString().slice(0, 10));

/**
 * Arbitrary over a single `v_external_reference_comparison` wire-format row. Each nullable
 * union column spans its full persisted domain (including `null`), and `reference_score`
 * spans negatives, zero, and fractional values (noNaN) so the verbatim-copy assertion is
 * checked across the real numeric input space. `provenance` / `is_display_only` /
 * `fetched_at` are generated too (the shaper ignores them, but realistic rows keep the
 * test honest).
 */
const rowArb: fc.Arbitrary<ExternalReferenceComparisonRow> = fc.record({
  decision_date: isoDateArb,
  pair: fc.string({ minLength: 1, maxLength: 8 }),
  own_direction: fc.constantFrom(...OWN_DIRECTIONS),
  reference_direction: fc.constantFrom(...REFERENCE_DIRECTIONS),
  reference_score: fc.option(fc.double({ min: -1000, max: 1000, noNaN: true }), {
    nil: null,
  }),
  provider: fc.option(fc.string({ minLength: 1, maxLength: 12 }), { nil: null }),
  comparison: fc.constantFrom(...COMPARISONS),
  provenance: fc.string({ minLength: 1, maxLength: 12 }),
  is_display_only: fc.boolean(),
  fetched_at: fc.option(isoDateArb, { nil: null }),
});

const rowsArb: fc.Arbitrary<readonly ExternalReferenceComparisonRow[]> = fc.array(rowArb, {
  minLength: 1,
  maxLength: 40,
});

/** The row the shaper must select: maximum Decision_Date, first-seen on ties. */
function expectedRow(
  rows: readonly ExternalReferenceComparisonRow[],
): ExternalReferenceComparisonRow {
  let chosen = rows[0]!;
  for (const row of rows) {
    if (row.decision_date > chosen.decision_date) chosen = row;
  }
  return chosen;
}

/** Every row sharing the maximum Decision_Date — any of these is a valid selection. */
function maxDateRows(
  rows: readonly ExternalReferenceComparisonRow[],
): readonly ExternalReferenceComparisonRow[] {
  const maxDate = rows.reduce(
    (acc, r) => (r.decision_date > acc ? r.decision_date : acc),
    rows[0]!.decision_date,
  );
  return rows.filter((r) => r.decision_date === maxDate);
}

describe("Property 10: External-comparison projection", () => {
  it("non-empty: present, and own/reference direction + comparison projected verbatim", () => {
    fc.assert(
      fc.property(rowsArb, (rows) => {
        const vm = shapeExternal(rows);
        const row = expectedRow(rows);

        // (a) A row exists → the section is present (never omitted).
        expect(vm.present).toBe(true);

        // (b) Verbatim projection of the selected latest-Decision_Date row. Object.is pins
        // exact identity on the numeric reference_score (no recomputation / coercion).
        expect(vm.ownDirection).toBe(row.own_direction);
        expect(vm.referenceDirection).toBe(row.reference_direction);
        expect(vm.comparison).toBe(row.comparison);
        expect(vm.provider).toBe(row.provider);
        expect(Object.is(vm.referenceScore, row.reference_score)).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("referenceUnavailable is true exactly when the comparison is `unavailable` (non-error marker, never fabricated)", () => {
    fc.assert(
      fc.property(rowsArb, (rows) => {
        const vm = shapeExternal(rows);
        const row = expectedRow(rows);

        // (c) The marker is a pure function of the persisted comparison enum...
        expect(vm.referenceUnavailable).toBe(row.comparison === "unavailable");

        // ...and it is an inert display state: the reference direction/score are still
        // whatever the row persisted (possibly null), never a fabricated reference.
        expect(vm.referenceDirection).toBe(row.reference_direction);
        expect(Object.is(vm.referenceScore, row.reference_score)).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("selection is independent of input order and duplicate rows", () => {
    fc.assert(
      fc.property(rowsArb, (rows) => {
        // The shaper selects by Decision_Date, not position. Any ordering (and any run of
        // duplicates) must therefore project some row carrying the MAXIMUM Decision_Date.
        // When several rows tie on that date they may differ, so the stable invariant is
        // membership in that tied set rather than one fixed row.
        const candidates = maxDateRows(rows);

        for (const vm of [
          shapeExternal(rows),
          shapeExternal([...rows].reverse()),
          shapeExternal([...rows, ...rows]),
        ]) {
          expect(vm.present).toBe(true);
          const match = candidates.some(
            (row) =>
              vm.ownDirection === row.own_direction &&
              vm.referenceDirection === row.reference_direction &&
              vm.comparison === row.comparison &&
              vm.provider === row.provider &&
              Object.is(vm.referenceScore, row.reference_score) &&
              vm.referenceUnavailable === (row.comparison === "unavailable"),
          );
          expect(match).toBe(true);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("empty input yields an omitted (present: false) model, never a fabricated reference", () => {
    const vm = shapeExternal([]);
    expect(vm.present).toBe(false);
    expect(vm.referenceUnavailable).toBe(false);
    expect(vm.ownDirection).toBeNull();
    expect(vm.referenceDirection).toBeNull();
    expect(vm.referenceScore).toBeNull();
    expect(vm.provider).toBeNull();
    expect(vm.comparison).toBeNull();
  });
});
