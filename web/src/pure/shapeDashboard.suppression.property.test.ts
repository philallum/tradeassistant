// shapeDashboardView — suppression shaping preserves pair + reason verbatim.
//
// After the de-scope the dashboard-level suppressors are removed: the only surviving
// `suppression_reason` values are `below_floor` and `not_fired`, and the `competing_pairs`
// plumbing is gone (design C2 / Data Models). For any suppressed `firing_setups` row the
// shaped suppression preserves the pair and the `suppression_reason` verbatim across both
// surviving reasons. Suppressions are ALWAYS cross-pair, so preservation holds regardless of
// the pair argument passed to `shapeDashboardView`.
//
// **Validates: Requirements 9.3, 9.4, 8.5**

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { shapeDashboardView } from "./shapeDashboard.js";
import { PAIRS } from "../api/types.js";
import type { FiringSetupRow, Direction, Horizon, Pair } from "../api/types.js";

const NUM_RUNS = 300; // >= 100 iterations required by the task.

/** The two surviving suppression reasons (the non-null `suppression_reason` domain). */
const SUPPRESSION_REASONS = ["below_floor", "not_fired"] as const;
type SuppressionReason = (typeof SUPPRESSION_REASONS)[number];

const pairArb: fc.Arbitrary<Pair> = fc.constantFrom(...PAIRS);
const directionArb: fc.Arbitrary<Direction> = fc.constantFrom("UP", "DOWN", "FLAT");
const horizonArb: fc.Arbitrary<Horizon> = fc.constantFrom(1, 2, 3);
const isoDateArb: fc.Arbitrary<string> = fc
  .date({
    min: new Date("2020-01-01T00:00:00.000Z"),
    max: new Date("2030-12-31T00:00:00.000Z"),
    noInvalidDate: true,
  })
  .map((d) => d.toISOString().slice(0, 10));

/** A SUPPRESSED `firing_setups` row (`surfaced=false`, non-null `suppression_reason`). */
function suppressedRowArb(
  decisionDate: string,
): fc.Arbitrary<FiringSetupRow & { suppression_reason: SuppressionReason }> {
  return fc
    .record({
      pair: pairArb,
      strategy_id: fc.string(),
      direction: directionArb,
      horizon: horizonArb,
      earned_confidence: fc.double({ min: 0, max: 1, noNaN: true }),
      stop_loss_pips: fc.option(fc.double({ min: 0, max: 500, noNaN: true }), { nil: null }),
      take_profit_pips: fc.option(fc.double({ min: 0, max: 500, noNaN: true }), { nil: null }),
      reason: fc.constantFrom(...SUPPRESSION_REASONS),
    })
    .map((r) => ({
      decision_date: decisionDate,
      pair: r.pair,
      strategy_id: r.strategy_id,
      direction: r.direction,
      horizon: r.horizon,
      earned_confidence: r.earned_confidence,
      stop_loss_pips: r.stop_loss_pips,
      take_profit_pips: r.take_profit_pips,
      surfaced: false,
      suppression_reason: r.reason,
    }));
}

/** The pair argument to `shapeDashboardView`: a specific pair or the cross-pair "ALL". */
const pairSelectionArb: fc.Arbitrary<Pair | "ALL"> = fc.oneof(
  pairArb,
  fc.constant<"ALL">("ALL"),
);

describe("shapeDashboardView: suppression shaping preserves pair + reason", () => {
  it("preserves pair + reason verbatim for every suppressed row, independent of pair selection", () => {
    fc.assert(
      fc.property(
        isoDateArb.chain((date) =>
          fc.record({
            rows: fc.array(suppressedRowArb(date), { minLength: 1, maxLength: 20 }),
            selection: pairSelectionArb,
          }),
        ),
        ({ rows, selection }) => {
          const vm = shapeDashboardView(rows, selection);

          // Suppressions are cross-pair: every suppressed row produces exactly one entry,
          // regardless of the pair selection (Req 8.5). No surfaced rows here → no cards.
          expect(vm.suppressions).toHaveLength(rows.length);
          expect(vm.cards).toHaveLength(0);

          // Positional preservation: each shaped suppression mirrors its source row's pair
          // and reason verbatim (Req 9.3, 9.4).
          rows.forEach((row, i) => {
            const sup = vm.suppressions[i]!;
            expect(sup.pair).toBe(row.pair);
            expect(sup.reason).toBe(row.suppression_reason);
            // The removed `competing_pairs` field is gone from the view model entirely.
            expect("competingPairs" in sup).toBe(false);
          });
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("keeps suppressions cross-pair regardless of which pair is selected", () => {
    fc.assert(
      fc.property(
        isoDateArb.chain((date) => suppressedRowArb(date)),
        (row) => {
          const selections: readonly (Pair | "ALL")[] = [...PAIRS, "ALL"];
          const results = selections.map(
            (sel) => shapeDashboardView([row], sel).suppressions[0]!,
          );
          for (const sup of results) {
            expect(sup.pair).toBe(row.pair);
            expect(sup.reason).toBe(row.suppression_reason);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
