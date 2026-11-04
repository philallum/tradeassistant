// Feature: mobile-dashboard-single-window, Property 1: All_Pairs_Strip is a verbatim projection
// of the confluence rows. For any ConfluenceViewModel (including ones with missing pairs) and
// every pair, the strip entry's statusLabel/scoreText/marker equal the matching RowVM when a
// row exists (hasData true); otherwise hasData is false, marker is "none" and scoreText is the
// shared NO_SIGNAL_TEXT constant.
//
// **Validates: Requirements 4.6, 4.8**

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { shapeAllPairsStrip } from "./shapeAllPairsStrip.ts";
import { NO_SIGNAL_TEXT } from "./noSignalCopy.ts";
import type { ConfluenceViewModel, RowVM } from "./shapeConfluence.ts";
import { PAIRS } from "../api/types.ts";
import type { Pair } from "../api/types.ts";

const NUM_RUNS = 200; // >= 100 iterations required by the task.

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

describe("Property 1: All_Pairs_Strip is a verbatim projection of the confluence rows", () => {
  it("copies row fields verbatim when a row exists, else an explicit no-data entry", () => {
    fc.assert(
      fc.property(viewModelArb, (vm) => {
        const { entries } = shapeAllPairsStrip(vm);
        for (const pair of PAIRS) {
          const entry = entries.find((e) => e.pair === pair);
          expect(entry).toBeDefined();
          const row = vm.rows.find((r) => r.pair === pair);
          if (row !== undefined) {
            expect(entry?.hasData).toBe(true);
            expect(entry?.statusLabel).toBe(row.statusLabel);
            expect(entry?.scoreText).toBe(row.scoreText);
            expect(entry?.marker).toBe(row.marker);
          } else {
            expect(entry?.hasData).toBe(false);
            expect(entry?.marker).toBe("none");
            expect(entry?.scoreText).toBe(NO_SIGNAL_TEXT);
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// Feature: mobile-dashboard-single-window, Property 2: All_Pairs_Strip always lists exactly the
// five pairs, in canonical order. For any ConfluenceViewModel (including the empty one with no
// rows), entries has length 5 and entries.map(e => e.pair) equals PAIRS.
//
// **Validates: Requirements 4.1**

/** The empty view model (no rows), explicitly part of the input space. */
const emptyViewModel: ConfluenceViewModel = {
  empty: true,
  emptyText: "",
  validationLabel: "",
  validated: false,
  strengthNote: "",
  summary: { aligned: 0, conflict: 0, neutral: 0, text: "" },
  columns: [],
  rows: [],
};

describe("Property 2: All_Pairs_Strip always lists exactly the five pairs, in canonical order", () => {
  it("has five entries in PAIRS order for any view model, including the empty one", () => {
    fc.assert(
      fc.property(fc.oneof(fc.constant(emptyViewModel), viewModelArb), (vm) => {
        const { entries } = shapeAllPairsStrip(vm);
        expect(entries).toHaveLength(5);
        expect(entries.map((e) => e.pair)).toEqual([...PAIRS]);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("handles the empty view model explicitly", () => {
    const { entries } = shapeAllPairsStrip(emptyViewModel);
    expect(entries).toHaveLength(5);
    expect(entries.map((e) => e.pair)).toEqual([...PAIRS]);
  });
});
