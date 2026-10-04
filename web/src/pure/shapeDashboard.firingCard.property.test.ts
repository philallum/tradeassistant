// Feature: dashboard-ui, Property 5: Firing-card projection is verbatim with explicit null markers
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { Direction, FiringSetupRow, Horizon, Pair } from "../api/endpoints.ts";
import { PAIRS } from "../api/endpoints.ts";
import { shapeDashboardView } from "./shapeDashboard.ts";
import { formatPips, NOT_ACTIONABLE } from "./format.ts";

// For any surfaced `firing_setups` row, the shaped card's pair, direction, horizon, and
// earned confidence equal the row's values exactly, and each of stop-loss / take-profit is
// either the row's numeric value or, when the row value is null, an explicit not-actionable
// marker — never a fabricated number.
//
// **Validates: Requirements 9.1, 9.2, 9.10, 20.1**

const NUM_RUNS = 300; // >= 100 iterations required by the task.

const DIRECTIONS: readonly Direction[] = ["UP", "DOWN", "FLAT"];
const HORIZONS: readonly Horizon[] = [1, 2, 3];

const pairArb: fc.Arbitrary<Pair> = fc.constantFrom(...PAIRS);
const directionArb: fc.Arbitrary<Direction> = fc.constantFrom(...DIRECTIONS);
const horizonArb: fc.Arbitrary<Horizon> = fc.constantFrom(...HORIZONS);

/**
 * A pip distance as persisted on a surfaced row: either a real finite number or `null`
 * (the not-actionable boundary). The numeric branch includes negative, zero, and
 * fractional values so the verbatim assertions cannot accidentally pass by coincidence,
 * and `null` is drawn frequently so the explicit-marker branch is well exercised.
 */
const pipsArb: fc.Arbitrary<number | null> = fc.oneof(
  { arbitrary: fc.constant(null), weight: 1 },
  {
    arbitrary: fc.double({
      min: -500,
      max: 5000,
      noNaN: true,
      noDefaultInfinity: true,
    }),
    weight: 2,
  },
);

/** An ISO `YYYY-MM-DD` Decision_Date in the valid serving-layer input space. */
const isoDateArb: fc.Arbitrary<string> = fc
  .date({
    min: new Date("2000-01-01T00:00:00.000Z"),
    max: new Date("2099-12-31T00:00:00.000Z"),
    noInvalidDate: true,
  })
  .map((d) => d.toISOString().slice(0, 10));

/**
 * Arbitrary over a SURFACED `firing_setups` row — the input space Property 5 ranges over.
 * `surfaced` is pinned true so the row always becomes a card; suppression fields are set to
 * the non-suppressed defaults a surfaced row carries.
 */
const surfacedRowArb: fc.Arbitrary<FiringSetupRow> = fc.record({
  decision_date: isoDateArb,
  pair: pairArb,
  strategy_id: fc.string({ minLength: 1, maxLength: 24 }),
  direction: directionArb,
  horizon: horizonArb,
  earned_confidence: fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
  stop_loss_pips: pipsArb,
  take_profit_pips: pipsArb,
  surfaced: fc.constant(true),
  suppression_reason: fc.constant(null),
  competing_pairs: fc.constant(null),
});

/**
 * Assert that a shaped card projects the row verbatim, and that each pip boundary is
 * rendered either as the exact stored number or the explicit not-actionable marker —
 * never a fabricated number.
 */
function assertVerbatim(row: FiringSetupRow, card: {
  readonly pair: string;
  readonly strategyId: string;
  readonly direction: Direction;
  readonly horizon: Horizon;
  readonly earnedConfidence: number;
  readonly stopLossPips: number | null;
  readonly takeProfitPips: number | null;
}): void {
  // Scalar fields equal the row exactly (Req 9.1, 9.10, 20.1).
  expect(card.pair).toBe(row.pair);
  expect(card.strategyId).toBe(row.strategy_id);
  expect(card.direction).toBe(row.direction);
  expect(card.horizon).toBe(row.horizon);
  expect(card.earnedConfidence).toBe(row.earned_confidence);

  // The card carries the raw boundary verbatim (number or null) — nothing fabricated.
  expect(card.stopLossPips).toBe(row.stop_loss_pips);
  expect(card.takeProfitPips).toBe(row.take_profit_pips);

  // The format boundary: null -> explicit marker; otherwise a string carrying the exact
  // numeric value and never the marker (Req 9.2).
  for (const value of [row.stop_loss_pips, row.take_profit_pips] as const) {
    const rendered = formatPips(value);
    if (value === null) {
      expect(rendered).toBe(NOT_ACTIONABLE);
    } else {
      expect(rendered).not.toBe(NOT_ACTIONABLE);
      // The exact stored number appears verbatim in the rendered string — no rounding,
      // no substitution, no fabricated figure.
      expect(rendered).toContain(String(value));
      expect(rendered).toBe(`${value} pips`);
    }
  }
}

describe("Property 5: Firing-card projection is verbatim with explicit null markers", () => {
  it("projects a surfaced row to a card verbatim with explicit null pip markers (ALL pairs)", () => {
    fc.assert(
      fc.property(surfacedRowArb, (row) => {
        const vm = shapeDashboardView([row], "ALL");

        // A surfaced row always yields exactly one card under the "ALL" selection.
        expect(vm.cards).toHaveLength(1);
        const card = vm.cards[0]!;
        assertVerbatim(row, card);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("projects verbatim when the row's own pair is selected, across a batch of rows", () => {
    fc.assert(
      fc.property(
        fc.array(surfacedRowArb, { minLength: 1, maxLength: 25 }),
        pairArb,
        (rows, selected) => {
          const vm = shapeDashboardView(rows, selected);

          // Every surfaced row for the selected pair must appear as a card, in order,
          // projected verbatim. (All generated rows are surfaced.)
          const expected = rows.filter((r) => r.pair === selected);
          expect(vm.cards).toHaveLength(expected.length);

          expected.forEach((row, i) => {
            const card = vm.cards[i]!;
            assertVerbatim(row, card);
          });
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
