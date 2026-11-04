// Feature: mobile-dashboard-single-window, Property 4: Backtest edge pill never fabricates a value
//
// **Validates: Requirements 8.5, 8.6**

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { shapeBacktestEdge } from "./shapeBacktestEdge.ts";
import { formatDeltaPp } from "../tabs/Gate/format.ts";
import type { EvaluationReportRow } from "../api/types.ts";

const NUM_RUNS = 200;

const reportArb: fc.Arbitrary<EvaluationReportRow> = fc.record({
  config_id: fc.string({ maxLength: 16 }),
  split_test_start: fc.string({ maxLength: 16 }),
  split_test_end: fc.string({ maxLength: 16 }),
  sample_size: fc.nat(),
  predictions_count: fc.nat(),
  model_accuracy: fc.double({ min: 0, max: 1, noNaN: true }),
  baseline_accuracy: fc.double({ min: 0, max: 1, noNaN: true }),
  delta_vs_baseline: fc.double({ min: -1, max: 1, noNaN: true }),
});

describe("Property 4: Backtest edge pill never fabricates a value", () => {
  it("available is false iff report is null; otherwise edgeText is formatDeltaPp(delta)", () => {
    fc.assert(
      fc.property(fc.option(reportArb, { nil: null }), (report) => {
        const vm = shapeBacktestEdge(report);
        expect(vm.available).toBe(report !== null);
        if (report === null) {
          expect(vm.edgeText).toBe("");
        } else {
          expect(vm.edgeText).toBe(formatDeltaPp(report.delta_vs_baseline));
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
