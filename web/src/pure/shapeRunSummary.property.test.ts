import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { shapeRunSummary, CONFIDENCE_THRESHOLD } from "./shapeRunSummary.ts";
import type { PairEvaluationRow } from "../api/types.ts";

// `shapeRunSummary` turns the snapshot's `pairEvaluations` slice (every pair the run
// evaluated, fired or not) into the run-completion readout the Setups silent state renders.
// It must: project each row verbatim, compute gapToThreshold = earned_confidence - threshold,
// tally evaluated/fired counts, preserve input order, and return an absent model for an
// empty input (so the plain "no setups fired" message is kept in that case).

const NUM_RUNS = 300;

const DIRECTIONS: readonly PairEvaluationRow["direction"][] = ["UP", "DOWN", "FLAT"];
const HORIZONS: readonly PairEvaluationRow["horizon"][] = [1, 2, 3];

const rowArb: fc.Arbitrary<PairEvaluationRow> = fc.record({
  decision_date: fc.constant("2026-10-09"),
  pair: fc.constantFrom("EURUSD", "GBPUSD", "USDJPY", "USDCHF", "USDCAD"),
  direction: fc.constantFrom(...DIRECTIONS),
  horizon: fc.constantFrom(...HORIZONS),
  earned_confidence: fc.double({ min: 0, max: 1, noNaN: true }),
  fired: fc.boolean(),
  choppiness: fc.double({ min: 0, max: 1, noNaN: true }),
});

describe("shapeRunSummary", () => {
  it("returns an absent model for an empty input (keeps the plain silent message)", () => {
    const vm = shapeRunSummary([]);
    expect(vm.present).toBe(false);
    expect(vm.evaluatedCount).toBe(0);
    expect(vm.firedCount).toBe(0);
    expect(vm.pairs).toEqual([]);
    expect(vm.decisionDate).toBeNull();
  });

  it("projects verbatim, computes the gap, and tallies counts for a known input", () => {
    const rows: PairEvaluationRow[] = [
      { decision_date: "2026-10-09", pair: "EURUSD", direction: "DOWN", horizon: 1, earned_confidence: 0.40, fired: false, choppiness: 0.3 },
      { decision_date: "2026-10-09", pair: "GBPUSD", direction: "UP", horizon: 2, earned_confidence: 0.62, fired: true, choppiness: 0.8 },
      { decision_date: "2026-10-09", pair: "USDJPY", direction: "FLAT", horizon: 1, earned_confidence: 0.99, fired: false, choppiness: 0.5 },
    ];
    const vm = shapeRunSummary(rows);

    expect(vm.present).toBe(true);
    expect(vm.decisionDate).toBe("2026-10-09");
    expect(vm.evaluatedCount).toBe(3);
    expect(vm.firedCount).toBe(1);
    expect(vm.threshold).toBe(CONFIDENCE_THRESHOLD);

    const eur = vm.pairs[0]!;
    expect(eur).toMatchObject({ pair: "EURUSD", direction: "DOWN", earnedConfidence: 0.40, fired: false, choppiness: 0.3 });
    expect(eur.gapToThreshold).toBeCloseTo(0.40 - 0.55, 10);

    const gbp = vm.pairs[1]!;
    expect(gbp.gapToThreshold).toBeCloseTo(0.62 - 0.55, 10);
  });

  it("respects a custom threshold for the gap", () => {
    const rows: PairEvaluationRow[] = [
      { decision_date: "2026-10-09", pair: "EURUSD", direction: "UP", horizon: 1, earned_confidence: 0.6, fired: true, choppiness: 0.2 },
    ];
    expect(shapeRunSummary(rows, 0.7).pairs[0]!.gapToThreshold).toBeCloseTo(0.6 - 0.7, 10);
  });

  it("property: verbatim projection, order preservation, gap, and counts hold for any rows", () => {
    fc.assert(
      fc.property(fc.array(rowArb, { minLength: 1, maxLength: 10 }), (rows) => {
        const vm = shapeRunSummary(rows);
        expect(vm.present).toBe(true);
        expect(vm.evaluatedCount).toBe(rows.length);
        // Order-preserving, verbatim per field, gap = confidence - threshold.
        rows.forEach((row, i) => {
          const p = vm.pairs[i]!;
          expect(p.pair).toBe(row.pair);
          expect(p.direction).toBe(row.direction);
          expect(p.horizon).toBe(row.horizon);
          expect(p.earnedConfidence).toBe(row.earned_confidence);
          expect(p.fired).toBe(row.fired);
          expect(p.choppiness).toBe(row.choppiness);
          expect(p.gapToThreshold).toBeCloseTo(row.earned_confidence - CONFIDENCE_THRESHOLD, 10);
        });
        // firedCount equals the number of fired rows.
        expect(vm.firedCount).toBe(rows.filter((r) => r.fired).length);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
