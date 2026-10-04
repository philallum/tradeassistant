// Feature: dashboard-ui, Property 4: Suppression shaping preserves pair, reason, and competing pairs
// For any suppressed `firing_setups` row, the shaped suppression preserves the pair and the
// `suppression_reason` verbatim across all five reasons
// (`news`, `currency_concentration`, `below_floor`, `not_fired`, `too_choppy`), and when the
// reason is `currency_concentration` it preserves the full `competing_pairs` array unchanged.
// Suppressions are ALWAYS cross-pair, so preservation holds regardless of the pair argument
// passed to `shapeDashboardView`.
//
// **Validates: Requirements 9.3, 9.4, 8.5**

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { shapeDashboardView } from "./shapeDashboard.js";
import { PAIRS } from "../api/endpoints.js";
import type { FiringSetupRow, Direction, Horizon, Pair } from "../api/endpoints.js";

const NUM_RUNS = 300; // >= 100 iterations required by the task.

/** The five suppression reasons a suppressed row can carry (base-table CHECK constraint). */
const SUPPRESSION_REASONS = [
  "news",
  "currency_concentration",
  "below_floor",
  "not_fired",
  "too_choppy",
] as const;
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

/** A `competing_pairs` array — any strings, especially other pairs; may be empty. */
const competingPairsArb: fc.Arbitrary<readonly string[]> = fc.array(
  fc.oneof(pairArb, fc.string()),
  { minLength: 0, maxLength: 5 },
);

/**
 * A SUPPRESSED `firing_setups` row (`surfaced=false`, non-null `suppression_reason`).
 *
 * For `currency_concentration` the row always carries a concrete `competing_pairs` array so
 * the "full array unchanged" clause is exercised on every such row; for the other four
 * reasons `competing_pairs` is drawn from an array-or-null so both carriers are covered.
 */
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
      competing: competingPairsArb,
      competingOrNull: fc.option(competingPairsArb, { nil: null }),
    })
    .map((r) => {
      const competing_pairs =
        r.reason === "currency_concentration" ? r.competing : r.competingOrNull;
      return {
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
        competing_pairs,
      };
    });
}

/** The pair argument to `shapeDashboardView`: a specific pair or the cross-pair "ALL". */
const pairSelectionArb: fc.Arbitrary<Pair | "ALL"> = fc.oneof(
  pairArb,
  fc.constant<"ALL">("ALL"),
);

describe("Property 4: Suppression shaping preserves pair, reason, and competing pairs", () => {
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

          // Positional preservation: each shaped suppression mirrors its source row's pair,
          // reason, and competing_pairs verbatim (Req 9.3, 9.4).
          rows.forEach((row, i) => {
            const sup = vm.suppressions[i]!;
            expect(sup.pair).toBe(row.pair);
            expect(sup.reason).toBe(row.suppression_reason);

            if (row.suppression_reason === "currency_concentration") {
              // Full competing_pairs array preserved unchanged, element-for-element (Req 8.5, 9.3).
              expect(sup.competingPairs).not.toBeNull();
              expect(sup.competingPairs).toStrictEqual(row.competing_pairs);
            } else {
              // Other reasons: whatever the row carried (array or null) is passed through.
              expect(sup.competingPairs).toStrictEqual(row.competing_pairs);
            }
          });
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("preserves competing_pairs regardless of which pair is selected (cross-pair invariant)", () => {
    fc.assert(
      fc.property(
        isoDateArb.chain((date) =>
          suppressedRowArb(date).map((row) => ({
            // Force a currency_concentration row with a concrete competing_pairs array.
            row: {
              ...row,
              suppression_reason: "currency_concentration" as const,
              competing_pairs: row.competing_pairs ?? [],
            },
          })),
        ),
        ({ row }) => {
          // The same suppressed row shaped under every possible pair selection yields the
          // identical competing_pairs — it is never filtered by the active pair (Req 8.5).
          const selections: readonly (Pair | "ALL")[] = [...PAIRS, "ALL"];
          const results = selections.map(
            (sel) => shapeDashboardView([row], sel).suppressions[0]!,
          );
          for (const sup of results) {
            expect(sup.pair).toBe(row.pair);
            expect(sup.reason).toBe("currency_concentration");
            expect(sup.competingPairs).toStrictEqual(row.competing_pairs);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
