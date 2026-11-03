// Feature: multi-strategy-confluence-engine, Property 28/30/31: Confluence view-model.
//
// Property-based coverage for the pure `shapeConfluence` view-model shaper. The three
// properties below exercise the shaper over arbitrary VALID Confluence slices — the same
// structural shape the strict snapshot parser (`parseConfluenceStrict` in
// `../api/snapshot.ts`) accepts — so they probe the real input space without a browser, a
// network, or a clock.
//
// **Validates: Requirements 12.1, 12.2, 12.3, 12.4, 12.6, 12.7, 12.9, 12.11, 12.12, 12.13,
// 12.14, 12.15, 12.16, 12.17, 12.18, 14.1, 14.2, 14.3, 14.4**

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { shapeConfluence, STRATEGY_IDS } from "./shapeConfluence.ts";
import type {
  Confluence,
  ConfluenceCell,
  ConfluencePair,
  ConfluenceStatus,
  ConfluenceStrategyId,
  Direction,
} from "../api/types.ts";
import { PAIRS } from "../api/types.ts";

const NUM_RUNS = 200; // >= 100 iterations required by the task.

const DIRECTIONS: readonly Direction[] = ["UP", "DOWN", "FLAT"];
const STATUSES: readonly ConfluenceStatus[] = [
  "ALIGNED_UP",
  "ALIGNED_DOWN",
  "NEUTRAL",
  "CONFLICT_FLAT",
  "INSUFFICIENT_DATA",
];

/** Direction label the shaper emits (mirrors `formatDirection`). */
const DIRECTION_LABEL: Readonly<Record<Direction, string>> = {
  UP: "Up",
  DOWN: "Down",
  FLAT: "Flat",
};

/** A bounded, finite float in `[lo, hi]`. */
const boundedFloat = (lo: number, hi: number): fc.Arbitrary<number> =>
  fc.double({ min: lo, max: hi, noNaN: true });

/**
 * Arbitrary over the six per-Strategy_Id weights. Each weight is a finite non-negative
 * number; `0` is generated frequently (via `fc.oneof` biasing a zero branch) so the
 * display-only / `emphasis` zero-weight paths are exercised for EVERY Strategy_Id, not just
 * `third_party`.
 */
const weightsArb: fc.Arbitrary<Confluence["weights"]> = fc
  .record(
    Object.fromEntries(
      STRATEGY_IDS.map((id) => [
        id,
        fc.oneof(fc.constant(0), boundedFloat(0, 5)),
      ]),
    ) as Record<ConfluenceStrategyId, fc.Arbitrary<number>>,
  )
  .map((w) => w as Confluence["weights"]);

/**
 * Arbitrary over one Strategy_Id cell: either an available signal (direction + bounded
 * strength + rationale) or an explicit unavailable marker with a NON-EMPTY reason, matching
 * what the strict parser accepts. A caller may force the direction (used to guarantee the
 * opposing UP/DOWN cells a CONFLICT_FLAT row requires).
 */
function cellArb(
  id: ConfluenceStrategyId,
  direction?: Direction,
): fc.Arbitrary<ConfluenceCell> {
  const available: fc.Arbitrary<ConfluenceCell> = fc.record({
    strategyId: fc.constant(id),
    available: fc.constant(true as const),
    direction: direction ? fc.constant(direction) : fc.constantFrom(...DIRECTIONS),
    strength: boundedFloat(0, 1),
    rationale: fc.string({ maxLength: 24 }),
  });
  if (direction) {
    // A forced-direction cell MUST be available so the opposing id names a real UP/DOWN cell.
    return available;
  }
  const unavailable: fc.Arbitrary<ConfluenceCell> = fc.record({
    strategyId: fc.constant(id),
    available: fc.constant(false as const),
    reason: fc.string({ minLength: 1, maxLength: 24 }),
  });
  return fc.oneof(available, unavailable);
}

/**
 * Build one Pair's six cells (in `STRATEGY_IDS` order) together with a consistent
 * `opposingStrategyIds` list. For a `CONFLICT_FLAT` pair the cells are constrained so that
 * at least one is an available UP and another an available DOWN, and `opposingStrategyIds`
 * names exactly those two (plus optionally more opposing ids), as the engine would emit. For
 * every other status `opposingStrategyIds` is empty (Requirements 11.3, 11.4).
 */
function cellsAndOpposingArb(
  status: ConfluenceStatus,
): fc.Arbitrary<{
  readonly cells: readonly ConfluenceCell[];
  readonly opposingStrategyIds: readonly ConfluenceStrategyId[];
}> {
  if (status !== "CONFLICT_FLAT") {
    return fc
      .tuple(...STRATEGY_IDS.map((id) => cellArb(id)))
      .map((cells) => ({ cells, opposingStrategyIds: [] as readonly ConfluenceStrategyId[] }));
  }

  // Choose two distinct Strategy_Ids: one forced UP, one forced DOWN.
  return fc
    .tuple(fc.integer({ min: 0, max: 5 }), fc.integer({ min: 1, max: 5 }))
    .chain(([i, delta]) => {
      const upIdx = i;
      const downIdx = (i + delta) % STRATEGY_IDS.length;
      const upId = STRATEGY_IDS[upIdx]!;
      const downId = STRATEGY_IDS[downIdx]!;
      const cellArbs = STRATEGY_IDS.map((id) => {
        if (id === upId) return cellArb(id, "UP");
        if (id === downId) return cellArb(id, "DOWN");
        return cellArb(id);
      });
      return fc.tuple(...cellArbs).map((cells) => ({
        cells,
        opposingStrategyIds: [upId, downId] as readonly ConfluenceStrategyId[],
      }));
    });
}

/** Arbitrary over one well-formed {@link ConfluencePair} for a given pair name. */
function pairArb(pairName: string): fc.Arbitrary<ConfluencePair> {
  return fc.constantFrom(...STATUSES).chain((status) =>
    fc
      .tuple(boundedFloat(-1, 1), cellsAndOpposingArb(status))
      .map(([score, { cells, opposingStrategyIds }]) => ({
        pair: pairName,
        score,
        status,
        opposingStrategyIds,
        cells,
      })),
  );
}

/**
 * Arbitrary over a VALID {@link Confluence} slice. `pairCount` bounds the number of Pairs
 * (0..5); the Pairs are drawn as a prefix of the canonical `PAIRS` list so every Pair name
 * is distinct and known (the shaper reorders into `PAIRS` order and drops unknown pairs).
 * Weights, thresholds, and the `unvalidated` validation label follow the strict wire shape.
 */
function sliceArb(opts?: { minPairs?: number }): fc.Arbitrary<Confluence> {
  const minPairs = opts?.minPairs ?? 0;
  return fc
    .record({
      weights: weightsArb,
      conflictThreshold: boundedFloat(0, 1),
      alignmentThreshold: boundedFloat(0, 1),
      pairCount: fc.integer({ min: minPairs, max: PAIRS.length }),
    })
    .chain(({ weights, conflictThreshold, alignmentThreshold, pairCount }) => {
      const names = PAIRS.slice(0, pairCount);
      const pairArbs = names.map((name) => pairArb(name));
      const pairsArb =
        pairArbs.length === 0
          ? fc.constant([] as ConfluencePair[])
          : fc.tuple(...pairArbs).map((ps) => ps as ConfluencePair[]);
      return pairsArb.map((pairs) => ({
        validationLabel: "unvalidated" as const,
        weights,
        conflictThreshold,
        alignmentThreshold,
        pairs,
      }));
    });
}

const nonEmptySliceArb = sliceArb({ minPairs: 1 });

/**
 * Widen `validationLabel` so a test can produce an arbitrary validation string (the wire
 * type pins it to `"unvalidated"`, but the shaper reads it as an opaque string to decide
 * `validated`). Produces slices whose label is either `"unvalidated"` or a non-empty other
 * label, so the validated/unvalidated branch is exercised.
 */
const anyValidationSliceArb: fc.Arbitrary<Confluence> = fc
  .tuple(
    sliceArb(),
    fc.oneof(fc.constant("unvalidated"), fc.string({ minLength: 1, maxLength: 16 })),
  )
  .map(([slice, label]) => ({ ...slice, validationLabel: label as "unvalidated" }));

/** Deep structural equality via JSON (the view model is a plain, finite, acyclic value). */
function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

describe("Property 28: View-model is complete, labelled, and deterministic", () => {
  // Feature: multi-strategy-confluence-engine, Property 28: View-model is complete, labelled, and deterministic
  it("one row/column per Pair/Strategy_Id, labelled cells and rows, correct markers, deterministic", () => {
    fc.assert(
      fc.property(nonEmptySliceArb, (slice) => {
        const vm = shapeConfluence(slice);

        // One row per Pair, one column per Strategy_Id.
        expect(vm.empty).toBe(false);
        expect(vm.rows.length).toBe(slice.pairs.length);
        expect(vm.columns.map((c) => c.strategyId)).toEqual([...STRATEGY_IDS]);

        // `third_party` (and any other) column is "display-only" exactly when its weight is 0.
        for (const col of vm.columns) {
          expect(col.displayOnly).toBe(slice.weights[col.strategyId] === 0);
          expect(col.header.includes("display-only")).toBe(
            slice.weights[col.strategyId] === 0,
          );
        }

        for (const row of vm.rows) {
          const srcPair = slice.pairs.find((p) => p.pair === row.pair)!;
          expect(srcPair).toBeDefined();

          // Row has non-empty score and status text, plus the correct marker per status.
          expect(row.scoreText.length).toBeGreaterThan(0);
          expect(row.statusLabel.length).toBeGreaterThan(0);
          expect(row.markerText.length).toBeGreaterThan(0);
          switch (row.status) {
            case "ALIGNED_UP":
              expect(row.marker).toBe("green");
              break;
            case "ALIGNED_DOWN":
              expect(row.marker).toBe("red");
              break;
            case "NEUTRAL":
            case "INSUFFICIENT_DATA":
              expect(row.marker).toBe("neutral");
              break;
            case "CONFLICT_FLAT":
              expect(row.marker).toBe("conflict");
              expect(row.markerText).toBe("Stay Flat");
              expect(row.stayFlat).toBe(true);
              break;
          }

          // One cell per Strategy_Id, in canonical order.
          expect(row.cells.map((c) => c.strategyId)).toEqual([...STRATEGY_IDS]);

          const opposing = new Set(
            srcPair.status === "CONFLICT_FLAT" ? srcPair.opposingStrategyIds : [],
          );

          for (const cell of row.cells) {
            const srcCell = srcPair.cells.find((c) => c.strategyId === cell.strategyId)!;
            if (cell.available) {
              // Non-empty direction label + numeric strength for available cells.
              expect(cell.directionLabel.length).toBeGreaterThan(0);
              expect(cell.directionLabel).not.toBe("Unavailable");
              expect(typeof cell.strength).toBe("number");
              expect(srcCell.available).toBe(true);
              if (srcCell.available) {
                expect(cell.strength).toBe(srcCell.strength);
                expect(cell.directionLabel).toBe(DIRECTION_LABEL[srcCell.direction]);
                // Accessible name carries Pair, Strategy_Id, direction, and strength.
                expect(cell.accessibleName).toContain(row.pair);
                expect(cell.accessibleName).toContain(cell.strategyId);
                expect(cell.accessibleName).toContain(cell.directionLabel);
                expect(cell.accessibleName).toContain(cell.strengthText);
              }
            } else {
              // Unavailable cell: explicit "Unavailable" label, non-empty reason, null strength.
              expect(cell.directionLabel).toBe("Unavailable");
              expect(cell.strength).toBeNull();
              expect(srcCell.available).toBe(false);
              if (!srcCell.available) {
                expect(srcCell.reason.length).toBeGreaterThan(0);
                expect(cell.detailText).toBe(srcCell.reason);
                // Accessible name carries Pair, Strategy_Id, and the unavailable reason.
                expect(cell.accessibleName).toContain(row.pair);
                expect(cell.accessibleName).toContain(cell.strategyId);
                expect(cell.accessibleName).toContain(srcCell.reason);
              }
            }

            // In CONFLICT_FLAT rows, exactly the opposing-id cells are highlighted with a label.
            expect(cell.highlighted).toBe(opposing.has(cell.strategyId));
            if (cell.highlighted) {
              expect(cell.highlightLabel).not.toBeNull();
              expect((cell.highlightLabel ?? "").length).toBeGreaterThan(0);
            } else {
              expect(cell.highlightLabel).toBeNull();
            }
          }
        }

        // Determinism: two calls on deeply-equal input return deeply-equal output.
        const again = shapeConfluence(JSON.parse(JSON.stringify(slice)) as Confluence);
        expect(deepEqual(vm, again)).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: multi-strategy-confluence-engine, Property 28: View-model is complete, labelled, and deterministic
  it("an empty slice yields empty === true with no rows", () => {
    fc.assert(
      fc.property(
        fc.record({
          weights: weightsArb,
          conflictThreshold: boundedFloat(0, 1),
          alignmentThreshold: boundedFloat(0, 1),
        }),
        ({ weights, conflictThreshold, alignmentThreshold }) => {
          const slice: Confluence = {
            validationLabel: "unvalidated",
            weights,
            conflictThreshold,
            alignmentThreshold,
            pairs: [],
          };
          const vm = shapeConfluence(slice);
          expect(vm.empty).toBe(true);
          expect(vm.rows.length).toBe(0);
          expect(vm.emptyText.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

describe("Property 30: Supplementary presentation is faithful to the slice", () => {
  // Feature: multi-strategy-confluence-engine, Property 30: Supplementary presentation is faithful to the slice
  it("conflictSummary, gauge, summary counts, and emphasis are all faithful to the slice", () => {
    fc.assert(
      fc.property(nonEmptySliceArb, (slice) => {
        const vm = shapeConfluence(slice);

        for (const row of vm.rows) {
          const srcPair = slice.pairs.find((p) => p.pair === row.pair)!;

          if (row.status === "CONFLICT_FLAT") {
            // Non-empty conflict summary naming an opposing UP and an opposing DOWN id.
            expect(row.conflictSummary).not.toBeNull();
            const summary = row.conflictSummary ?? "";
            expect(summary.length).toBeGreaterThan(0);
            const opposing = srcPair.opposingStrategyIds;
            const opposingUp = opposing.filter((id) => {
              const c = srcPair.cells.find((x) => x.strategyId === id);
              return c !== undefined && c.available && c.direction === "UP";
            });
            const opposingDown = opposing.filter((id) => {
              const c = srcPair.cells.find((x) => x.strategyId === id);
              return c !== undefined && c.available && c.direction === "DOWN";
            });
            expect(opposingUp.length).toBeGreaterThan(0);
            expect(opposingDown.length).toBeGreaterThan(0);
            expect(opposingUp.some((id) => summary.includes(id))).toBe(true);
            expect(opposingDown.some((id) => summary.includes(id))).toBe(true);
          } else {
            expect(row.conflictSummary).toBeNull();
          }

          // Gauge over the fixed [-1, 1] interval; value is the score; ticks are ±alignmentThreshold.
          expect(row.gauge.min).toBe(-1);
          expect(row.gauge.max).toBe(1);
          expect(row.gauge.value).toBe(row.score);
          expect(row.gauge.posThreshold).toBe(slice.alignmentThreshold);
          expect(row.gauge.negThreshold).toBe(-slice.alignmentThreshold);
          // scoreText stays the numeric score.
          expect(row.scoreText).toBe(row.score.toFixed(2));

          // Emphasis is "signal" iff available, non-FLAT, and weight > 0; else "muted".
          for (const cell of row.cells) {
            const srcCell = srcPair.cells.find((c) => c.strategyId === cell.strategyId)!;
            const expectSignal =
              srcCell.available &&
              srcCell.direction !== "FLAT" &&
              slice.weights[cell.strategyId] > 0;
            expect(cell.emphasis).toBe(expectSignal ? "signal" : "muted");
            // Emphasis removes no label: direction label and strength stay intact.
            expect(cell.directionLabel.length).toBeGreaterThan(0);
            if (srcCell.available) {
              expect(cell.strength).toBe(srcCell.strength);
            }
          }
        }

        // Summary counts partition the rows: each status counted once, totals sum to rows.length.
        const { aligned, conflict, neutral } = vm.summary;
        expect(aligned + conflict + neutral).toBe(vm.rows.length);
        const expectedAligned = vm.rows.filter(
          (r) => r.status === "ALIGNED_UP" || r.status === "ALIGNED_DOWN",
        ).length;
        const expectedConflict = vm.rows.filter((r) => r.status === "CONFLICT_FLAT").length;
        const expectedNeutral = vm.rows.filter(
          (r) => r.status === "NEUTRAL" || r.status === "INSUFFICIENT_DATA",
        ).length;
        expect(aligned).toBe(expectedAligned);
        expect(conflict).toBe(expectedConflict);
        expect(neutral).toBe(expectedNeutral);

        // Determinism.
        const again = shapeConfluence(JSON.parse(JSON.stringify(slice)) as Confluence);
        expect(deepEqual(vm, again)).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe("Property 31: Colour is suppressed until validated", () => {
  // Feature: multi-strategy-confluence-engine, Property 31: Colour is suppressed until validated
  it("validated tracks the label, but markers/labels are computed from status regardless", () => {
    fc.assert(
      fc.property(anyValidationSliceArb, (slice) => {
        const vm = shapeConfluence(slice);

        // `validated` is true exactly when the label is not "unvalidated".
        expect(vm.validated).toBe(slice.validationLabel !== "unvalidated");

        // Marker and marker/status text are a pure function of status, regardless of validation.
        for (const row of vm.rows) {
          switch (row.status) {
            case "ALIGNED_UP":
              expect(row.marker).toBe("green");
              break;
            case "ALIGNED_DOWN":
              expect(row.marker).toBe("red");
              break;
            case "NEUTRAL":
            case "INSUFFICIENT_DATA":
              expect(row.marker).toBe("neutral");
              break;
            case "CONFLICT_FLAT":
              expect(row.marker).toBe("conflict");
              expect(row.markerText).toBe("Stay Flat");
              break;
          }
          expect(row.markerText.length).toBeGreaterThan(0);
          expect(row.statusLabel.length).toBeGreaterThan(0);
        }

        // Output is a pure deterministic function of the slice: markers/labels do not change
        // when validation is toggled; only `validated` flips.
        const toggled: Confluence = {
          ...slice,
          validationLabel: (slice.validationLabel === "unvalidated"
            ? "validated"
            : "unvalidated") as "unvalidated",
        };
        const vmToggled = shapeConfluence(toggled);
        expect(vmToggled.validated).toBe(!vm.validated);
        expect(vmToggled.rows.map((r) => r.marker)).toEqual(vm.rows.map((r) => r.marker));
        expect(vmToggled.rows.map((r) => r.markerText)).toEqual(
          vm.rows.map((r) => r.markerText),
        );
        expect(vmToggled.rows.map((r) => r.statusLabel)).toEqual(
          vm.rows.map((r) => r.statusLabel),
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: multi-strategy-confluence-engine, Property 31: Colour is suppressed until validated
  it("an unvalidated slice still distinguishes every status via markerText/statusLabel", () => {
    fc.assert(
      fc.property(nonEmptySliceArb, (slice) => {
        // slice.validationLabel is always "unvalidated" here.
        const vm = shapeConfluence(slice);
        expect(vm.validated).toBe(false);

        // Every status that appears is distinguishable by its marker text / status label,
        // so meaning survives colour suppression.
        const seen = new Map<ConfluenceStatus, string>();
        for (const row of vm.rows) {
          const key = `${row.markerText}|${row.statusLabel}`;
          const prior = seen.get(row.status);
          if (prior !== undefined) {
            expect(prior).toBe(key); // same status → same text
          } else {
            seen.set(row.status, key);
          }
          if (row.status === "CONFLICT_FLAT") {
            expect(row.markerText).toBe("Stay Flat");
          }
        }
        // Distinct statuses map to distinct marker-text/status-label pairs (ALIGNED_UP vs
        // ALIGNED_DOWN vs CONFLICT_FLAT differ; NEUTRAL vs INSUFFICIENT_DATA differ too).
        const distinctStatuses = new Set(vm.rows.map((r) => r.status));
        const distinctKeys = new Set(
          vm.rows.map((r) => `${r.markerText}|${r.statusLabel}`),
        );
        expect(distinctKeys.size).toBe(distinctStatuses.size);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
