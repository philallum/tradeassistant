// Feature: mobile-dashboard-single-window, Property 3: Single-pair confluence selection is a
// faithful sub-slice. For any ConfluenceViewModel and any Pair, selectPairConfluenceRow
// returns null exactly when the view model has no row for the pair; otherwise it returns the
// unchanged source RowVM (the unique row whose pair matches).
//
// **Validates: Requirements 5.8**

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { selectPairConfluenceRow } from "./selectPairConfluenceRow.ts";
import type { ConfluenceViewModel, RowVM } from "./shapeConfluence.ts";
import { PAIRS } from "../api/types.ts";
import type { Pair } from "../api/types.ts";

const NUM_RUNS = 200; // >= 100 iterations required by the task.

const pairArb: fc.Arbitrary<Pair> = fc.constantFrom(...PAIRS);

/** A RowVM for the given pair with arbitrary (distinguishing) presentation fields. */
function rowArb(pair: Pair): fc.Arbitrary<RowVM> {
  return fc
    .record({
      scoreText: fc.string({ maxLength: 8 }),
      score: fc.double({ min: -1, max: 1, noNaN: true }),
      markerText: fc.string({ maxLength: 12 }),
      statusLabel: fc.string({ maxLength: 12 }),
      stayFlat: fc.boolean(),
      conflictSummary: fc.option(fc.string({ maxLength: 16 }), { nil: null }),
      status: fc.constantFrom(
        "ALIGNED_UP",
        "ALIGNED_DOWN",
        "NEUTRAL",
        "CONFLICT_FLAT",
        "INSUFFICIENT_DATA",
      ) as fc.Arbitrary<RowVM["status"]>,
      marker: fc.constantFrom("green", "red", "neutral", "conflict") as fc.Arbitrary<
        RowVM["marker"]
      >,
    })
    .map(
      (r) =>
        ({
          pair,
          scoreText: r.scoreText,
          score: r.score,
          gauge: { min: -1, max: 1, value: r.score, posThreshold: 0.5, negThreshold: -0.5 },
          status: r.status,
          statusLabel: r.statusLabel,
          marker: r.marker,
          markerText: r.markerText,
          stayFlat: r.stayFlat,
          conflictSummary: r.conflictSummary,
          cells: [],
        }) satisfies RowVM,
    );
}

/** A view model whose rows cover an arbitrary subset of the pairs (one row per pair, any order). */
const viewModelArb: fc.Arbitrary<ConfluenceViewModel> = fc
  .shuffledSubarray([...PAIRS])
  .chain((pairs) => fc.tuple(...pairs.map((p) => rowArb(p))))
  .map((rows) => ({
    empty: rows.length === 0,
    emptyText: "",
    validationLabel: "",
    validated: false,
    strengthNote: "",
    summary: { aligned: 0, conflict: 0, neutral: 0, text: "" },
    columns: [],
    rows,
  }));

describe("Property 3: Single-pair confluence selection is a faithful sub-slice", () => {
  it("returns null iff no row matches, else the unchanged source row", () => {
    fc.assert(
      fc.property(viewModelArb, pairArb, (vm, pair) => {
        const result = selectPairConfluenceRow(vm, pair);
        const matches = vm.rows.filter((r) => r.pair === pair);
        if (matches.length === 0) {
          expect(result).toBeNull();
        } else {
          expect(matches).toHaveLength(1);
          expect(result).toBe(matches[0]); // same reference: unchanged
          expect(result).toEqual(matches[0]);
          expect(result?.pair).toBe(pair);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
