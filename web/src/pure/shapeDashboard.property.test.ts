// Feature: dashboard-ui, Property 3: Dashboard view model completeness, silent, and empty
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { shapeDashboardView } from "./shapeDashboard";
import type { CardVM, SuppressionVM } from "./shapeDashboard";
import { PAIRS } from "./../api/types";
import type { FiringSetupRow, Direction, Horizon, Pair } from "./../api/types";

// For any set of persisted `firing_setups` rows for a Decision_Date, the view model
// produced by `shapeDashboardView` contains exactly one card per surfaced row (every
// surfaced row's pair appears, and no card exists without a corresponding surfaced row)
// and one suppression entry per suppressed row (every suppressed row's pair and reason
// appear); `isSilent` is true iff rows are present and no row is surfaced; and `hasRows`
// is false iff the input is empty.
//
// Scoping note: cards are PAIR-SCOPED — when a specific pair is passed only that pair's
// surfaced rows become cards, and "ALL" includes every surfaced row. The "exactly one card
// per surfaced row" / "every surfaced pair appears" invariants are therefore asserted
// against the `"ALL"` view model (the unscoped projection). Suppressions are ALWAYS
// cross-pair, so suppression completeness holds for every scoping. We additionally assert
// the pair-scoped card projection is the "ALL" cards filtered to the selected pair.
//
// **Validates: Requirements 6.2, 7.2, 7.4, 8.7, 13.1, 13.3, 19.4**

const NUM_RUNS = 300; // >= 100 iterations required by the task.

const DIRECTIONS: readonly Direction[] = ["UP", "DOWN", "FLAT"];
const HORIZONS: readonly Horizon[] = [1, 2, 3];
const SUPPRESSION_REASONS = ["below_floor", "not_fired"] as const;

const directionArb: fc.Arbitrary<Direction> = fc.constantFrom(...DIRECTIONS);
const horizonArb: fc.Arbitrary<Horizon> = fc.constantFrom(...HORIZONS);
const pairArb: fc.Arbitrary<Pair> = fc.constantFrom(...PAIRS);

/** A fixed Decision_Date shared across the rows (the shaper takes `rows[0]`'s date). */
const DECISION_DATE = "2026-09-16";

/**
 * Arbitrary over a single `firing_setups` wire-format row. The generator covers the full
 * input space the shaper partitions over:
 *  - `surfaced` rows (→ cards),
 *  - unsurfaced rows WITH a non-null `suppression_reason` (→ suppression entries), and
 *  - unsurfaced rows WITHOUT a reason (`null`) which the shaper fabricates nothing for.
 * All rows share the same `decision_date` so they belong to one Decision_Date, as the
 * shaper assumes.
 */
const rowArb: fc.Arbitrary<FiringSetupRow> = fc
  .record({
    pair: pairArb,
    strategy_id: fc.string({ minLength: 1, maxLength: 12 }),
    direction: directionArb,
    horizon: horizonArb,
    earned_confidence: fc.double({ min: 0, max: 1, noNaN: true }),
    stop_loss_pips: fc.option(fc.integer({ min: 1, max: 500 }), { nil: null }),
    take_profit_pips: fc.option(fc.integer({ min: 1, max: 500 }), { nil: null }),
    surfaced: fc.boolean(),
    reason: fc.option(fc.constantFrom(...SUPPRESSION_REASONS), { nil: null }),
  })
  .map(
    (r): FiringSetupRow => ({
      decision_date: DECISION_DATE,
      pair: r.pair,
      strategy_id: r.strategy_id,
      direction: r.direction,
      horizon: r.horizon,
      earned_confidence: r.earned_confidence,
      stop_loss_pips: r.stop_loss_pips,
      take_profit_pips: r.take_profit_pips,
      surfaced: r.surfaced,
      // A surfaced row's reason is irrelevant to the shaper; keep it null for realism.
      suppression_reason: r.surfaced ? null : r.reason,
    }),
  );

const rowsArb: fc.Arbitrary<readonly FiringSetupRow[]> = fc.array(rowArb, {
  minLength: 0,
  maxLength: 40,
});

/** Multiset key for a card so we can compare card bags ignoring order. */
function cardKey(c: CardVM): string {
  return JSON.stringify([
    c.pair,
    c.strategyId,
    c.direction,
    c.horizon,
    c.earnedConfidence,
    c.stopLossPips,
    c.takeProfitPips,
  ]);
}

/** Multiset key for a suppression entry. */
function suppressionKey(s: SuppressionVM): string {
  return JSON.stringify([s.pair, s.reason]);
}

function bag(keys: readonly string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
  return m;
}

function expectSameBag(a: readonly string[], b: readonly string[]): void {
  const ba = bag(a);
  const bb = bag(b);
  expect(ba.size).toBe(bb.size);
  for (const [k, n] of ba) {
    expect(bb.get(k)).toBe(n);
  }
}

describe("Property 3: Dashboard view model completeness, silent, and empty", () => {
  it("one card per surfaced row (ALL), one suppression per suppressed row, silent/empty flags", () => {
    fc.assert(
      fc.property(rowsArb, (rows) => {
        const vm = shapeDashboardView(rows, "ALL");

        const surfacedRows = rows.filter((r) => r.surfaced);
        const suppressedRows = rows.filter(
          (r) => !r.surfaced && r.suppression_reason !== null,
        );

        // (1) Cards (ALL view): exactly one card per surfaced row — the card bag equals the
        // surfaced-row bag field-for-field (verbatim projection), so there is no card
        // without a corresponding surfaced row and none is dropped.
        expect(vm.cards.length).toBe(surfacedRows.length);
        const expectedCardKeys = surfacedRows.map((r) =>
          cardKey({
            pair: r.pair,
            strategyId: r.strategy_id,
            direction: r.direction,
            horizon: r.horizon,
            earnedConfidence: r.earned_confidence,
            stopLossPips: r.stop_loss_pips,
            takeProfitPips: r.take_profit_pips,
          }),
        );
        expectSameBag(vm.cards.map(cardKey), expectedCardKeys);

        // Every surfaced row's pair appears among the cards.
        const cardPairs = new Set(vm.cards.map((c) => c.pair));
        for (const r of surfacedRows) {
          expect(cardPairs.has(r.pair)).toBe(true);
        }

        // (2) Suppressions: exactly one entry per suppressed row — pair + reason preserved.
        expect(vm.suppressions.length).toBe(suppressedRows.length);
        const expectedSupKeys = suppressedRows.map((r) =>
          suppressionKey({
            pair: r.pair,
            // non-null on suppressed rows by construction of the filter above.
            reason: r.suppression_reason as SuppressionVM["reason"],
          }),
        );
        expectSameBag(vm.suppressions.map(suppressionKey), expectedSupKeys);

        // Every suppressed row's pair and reason appear in some suppression entry.
        for (const r of suppressedRows) {
          const match = vm.suppressions.some(
            (s) => s.pair === r.pair && s.reason === r.suppression_reason,
          );
          expect(match).toBe(true);
        }

        // (3) isSilent is true iff rows are present and none is surfaced.
        const expectedSilent = rows.length > 0 && surfacedRows.length === 0;
        expect(vm.isSilent).toBe(expectedSilent);

        // (4) hasRows is false iff the input is empty.
        expect(vm.hasRows).toBe(rows.length > 0);
        expect(vm.hasRows).toBe(!(rows.length === 0));

        // decisionDate is drawn verbatim from the rows (empty string when no rows).
        expect(vm.decisionDate).toBe(rows.length > 0 ? DECISION_DATE : "");
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("pair-scoped cards equal the ALL cards filtered to that pair; suppressions stay cross-pair", () => {
    fc.assert(
      fc.property(rowsArb, pairArb, (rows, pair) => {
        const all = shapeDashboardView(rows, "ALL");
        const scoped = shapeDashboardView(rows, pair);

        // Pair-scoped cards are exactly the ALL cards whose pair matches the selection.
        const expectedScopedCardKeys = all.cards
          .filter((c) => c.pair === pair)
          .map(cardKey);
        expectSameBag(scoped.cards.map(cardKey), expectedScopedCardKeys);

        // Every scoped card belongs to the selected pair (no card without a surfaced row
        // for that pair).
        for (const c of scoped.cards) {
          expect(c.pair).toBe(pair);
        }

        // Suppressions are ALWAYS cross-pair: identical regardless of pair scoping.
        expectSameBag(
          scoped.suppressions.map(suppressionKey),
          all.suppressions.map(suppressionKey),
        );

        // Silent / empty flags are scoping-independent (defined over the raw rows).
        expect(scoped.isSilent).toBe(all.isSilent);
        expect(scoped.hasRows).toBe(all.hasRows);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("empty input yields no cards, no suppressions, not silent, hasRows false", () => {
    const vm = shapeDashboardView([], "ALL");
    expect(vm.cards).toEqual([]);
    expect(vm.suppressions).toEqual([]);
    expect(vm.isSilent).toBe(false);
    expect(vm.hasRows).toBe(false);
    expect(vm.decisionDate).toBe("");
  });
});
