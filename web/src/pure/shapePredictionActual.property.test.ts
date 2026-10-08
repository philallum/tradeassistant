// Feature: dashboard-ui, Property 9: Prediction-versus-actual selection and projection
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { shapePredictionActual } from "./shapePredictionActual.ts";
import type { Direction, Horizon, RealizedOutcomeRow } from "../api/types.ts";

// For any set of `realized_outcomes` rows for a pair, `shapePredictionActual` selects the
// matured row with the maximum Decision_Date (when any matured row exists); the predicted
// and realized fields of the selected row are projected verbatim; and when the selected row
// is not matured (or no matured row exists) the actual outcome is a pending marker — never a
// fabricated realized direction or excursion value (Req 10.1, 10.2, 10.3, 10.4, 20.1).
//
// **Validates: Requirements 10.1, 10.2, 10.3, 10.4, 20.1**

const NUM_RUNS = 300; // >= 100 iterations required by the task.

const DIRECTIONS: readonly Direction[] = ["UP", "DOWN", "FLAT"];
const HORIZONS: readonly Horizon[] = [1, 2, 3];

const directionArb: fc.Arbitrary<Direction> = fc.constantFrom(...DIRECTIONS);
const horizonArb: fc.Arbitrary<Horizon> = fc.constantFrom(...HORIZONS);

/** Nullable pip value: spans negatives, zero, fractional values, and the `null` sentinel. */
const nullablePipsArb: fc.Arbitrary<number | null> = fc.option(
  fc.double({ min: -1000, max: 1000, noNaN: true }),
  { nil: null },
);

/**
 * Arbitrary over ISO calendar-date strings in the fixed `YYYY-MM-DD` form the shaper assumes
 * (chronological order coincides with lexicographic string order). The span is bounded and
 * intentionally small so dates collide frequently — exercising the max-selection tie-break
 * (rows sharing the max date keep input order via the strict `>` comparison in the shaper).
 */
const isoDateArb: fc.Arbitrary<string> = fc
  .date({
    min: new Date("2024-01-01T00:00:00.000Z"),
    max: new Date("2024-03-31T00:00:00.000Z"),
    noInvalidDate: true,
  })
  .map((d) => d.toISOString().slice(0, 10));

/**
 * Arbitrary over a single `v_realized_outcomes` wire-format row. Realized columns are
 * independently nullable (and `matured` is an independent boolean) so the generator produces
 * both coherent rows (matured + complete realized data) and incoherent ones (matured flag
 * disagrees with still-null excursion columns) — the shaper must treat the latter as pending.
 */
const rowArb: fc.Arbitrary<RealizedOutcomeRow> = fc.record({
  strategy_id: fc.string({ minLength: 1, maxLength: 8 }),
  pair: fc.constantFrom("EURUSD", "GBPUSD", "USDJPY", "USDCHF", "USDCAD"),
  decision_date: isoDateArb,
  predicted_direction: directionArb,
  horizon: horizonArb,
  earned_confidence: fc.double({ min: 0, max: 1, noNaN: true }),
  stop_loss_pips: nullablePipsArb,
  take_profit_pips: nullablePipsArb,
  realized_direction: fc.option(directionArb, { nil: null }),
  realized_mfe_pips: nullablePipsArb,
  realized_mae_pips: nullablePipsArb,
  matured: fc.boolean(),
});

const rowsArb: fc.Arbitrary<readonly RealizedOutcomeRow[]> = fc.array(rowArb, {
  minLength: 0,
  maxLength: 40,
});

/** A matured row carrying complete realized data — the shaper must project its `actual`. */
const maturedCompleteRowArb: fc.Arbitrary<RealizedOutcomeRow> = rowArb.map((r) => ({
  ...r,
  matured: true,
  realized_direction: r.realized_direction ?? "UP",
  realized_mfe_pips: r.realized_mfe_pips ?? 0,
  realized_mae_pips: r.realized_mae_pips ?? 0,
}));

describe("Property 9: Prediction-versus-actual selection and projection", () => {
  it("empty input yields hasData:false and no fabricated fields", () => {
    const vm = shapePredictionActual([]);
    expect(vm.hasData).toBe(false);
    expect(vm.pending).toBe(false);
    expect(vm.decisionDate).toBeNull();
    expect(vm.horizon).toBeNull();
    expect(vm.predicted).toBeNull();
    expect(vm.actual).toBeNull();
  });

  it(
    "selects the max-Decision_Date matured row, projects predicted + actual verbatim, " +
      "never fabricates for pending rows",
    () => {
      fc.assert(
        fc.property(rowsArb, (rows) => {
          const vm = shapePredictionActual(rows);

          // (c) Empty input is the only route to hasData:false.
          if (rows.length === 0) {
            expect(vm.hasData).toBe(false);
            return;
          }
          expect(vm.hasData).toBe(true);

          // Recompute the selection independently of the shaper.
          const matured = rows.filter((r) => r.matured);
          const pool = matured.length > 0 ? matured : rows;
          const expectedMaxDate = pool.reduce(
            (max, r) => (r.decision_date > max ? r.decision_date : max),
            pool[0]!.decision_date,
          );

          // (a) Selection: when a matured row exists the selected Decision_Date is the max
          // among matured rows; otherwise it is the max over all rows (pending).
          expect(vm.decisionDate).toBe(expectedMaxDate);

          // The selected row the shaper actually projected (first row at the max date in the
          // chosen pool, since the shaper keeps the earliest-seen on a strict `>` tie-break).
          const selected = pool.find((r) => r.decision_date === expectedMaxDate)!;

          // Predicted fields are ALWAYS projected verbatim when hasData (Req 10.1, 10.4).
          expect(vm.horizon).toBe(selected.horizon);
          expect(vm.predicted).not.toBeNull();
          expect(vm.predicted!.direction).toBe(selected.predicted_direction);
          expect(Object.is(vm.predicted!.earnedConfidence, selected.earned_confidence)).toBe(
            true,
          );
          expect(Object.is(vm.predicted!.stopLossPips, selected.stop_loss_pips)).toBe(true);
          expect(Object.is(vm.predicted!.takeProfitPips, selected.take_profit_pips)).toBe(
            true,
          );

          const fullyRealized =
            selected.matured &&
            selected.realized_direction !== null &&
            selected.realized_mfe_pips !== null &&
            selected.realized_mae_pips !== null;

          if (fullyRealized) {
            // (a) Actual projected verbatim from the selected row.
            expect(vm.pending).toBe(false);
            expect(vm.actual).not.toBeNull();
            expect(vm.actual!.direction).toBe(selected.realized_direction);
            expect(Object.is(vm.actual!.mfePips, selected.realized_mfe_pips)).toBe(true);
            expect(Object.is(vm.actual!.maePips, selected.realized_mae_pips)).toBe(true);
          } else {
            // (b) Pending marker — actual is null, never a fabricated outcome (Req 10.2).
            expect(vm.pending).toBe(true);
            expect(vm.actual).toBeNull();
          }
        }),
        { numRuns: NUM_RUNS },
      );
    },
  );

  it(
    "order- and duplicate-independent: the SELECTION (date, maturity, projected row) is " +
      "invariant under reordering and duplication",
    () => {
      fc.assert(
        fc.property(
          fc.array(rowArb, { minLength: 1, maxLength: 25 }),
          fc.nat(),
          (rows, dupPick) => {
            const base = shapePredictionActual(rows);

            // A deterministic reordering of the same multiset of rows, plus a variant that
            // also appends a duplicate of an existing row.
            const shuffled = [...rows].reverse();
            const withDup = [...rows, rows[dupPick % rows.length]!];

            // `hasData` and the selected Decision_Date are a function of the multiset of
            // (date, matured) pairs alone, so neither reordering nor duplication can change
            // them. (Which specific row at that max date is projected — and hence `pending`
            // when matured rows tie on the max date but differ in realized completeness — is
            // decided by the shaper's deterministic first-seen tie-break, which is
            // order-sensitive by design; so we do not over-assert `pending`/full VM here.)
            for (const variant of [shuffled, withDup]) {
              const vm = shapePredictionActual(variant);
              expect(vm.hasData).toBe(base.hasData);
              expect(vm.decisionDate).toBe(base.decisionDate);

              // Whatever row is projected, it must genuinely come from the input at the
              // selected Decision_Date — never fabricated.
              if (vm.predicted !== null) {
                const source = variant.find(
                  (r) =>
                    r.decision_date === vm.decisionDate &&
                    r.predicted_direction === vm.predicted!.direction &&
                    Object.is(r.earned_confidence, vm.predicted!.earnedConfidence) &&
                    Object.is(r.stop_loss_pips, vm.predicted!.stopLossPips) &&
                    Object.is(r.take_profit_pips, vm.predicted!.takeProfitPips) &&
                    r.horizon === vm.horizon,
                );
                expect(source).toBeDefined();
              }
            }
          },
        ),
        { numRuns: NUM_RUNS },
      );
    },
  );

  it("a matured+complete row is always selected over pending rows and projected verbatim", () => {
    fc.assert(
      fc.property(
        fc.array(rowArb, { minLength: 0, maxLength: 20 }),
        maturedCompleteRowArb,
        fc.array(rowArb, { minLength: 0, maxLength: 20 }),
        (before, winner, after) => {
          // Force `winner` to carry the strict maximum Decision_Date so it is THE selection.
          const dominant: RealizedOutcomeRow = { ...winner, decision_date: "2025-12-31" };
          const others = [...before, ...after].map((r) =>
            r.decision_date >= dominant.decision_date
              ? { ...r, decision_date: "2024-01-01" }
              : r,
          );
          const vm = shapePredictionActual([...others, dominant]);

          expect(vm.hasData).toBe(true);
          expect(vm.pending).toBe(false);
          expect(vm.decisionDate).toBe(dominant.decision_date);
          expect(vm.predicted!.direction).toBe(dominant.predicted_direction);
          expect(vm.actual).not.toBeNull();
          expect(vm.actual!.direction).toBe(dominant.realized_direction);
          expect(Object.is(vm.actual!.mfePips, dominant.realized_mfe_pips)).toBe(true);
          expect(Object.is(vm.actual!.maePips, dominant.realized_mae_pips)).toBe(true);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
