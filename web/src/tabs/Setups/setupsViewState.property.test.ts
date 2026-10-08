// Feature: dashboard-ui, task 9.2: Setups-tab view-state resolver (tab-local invariants)
//
// NOTE: this is NOT one of the design's numbered correctness Properties — it is a
// tab-local property test for the pure `resolveSetupsViewState` helper authored for the
// Setups tab (task 9.2). It exercises the one-of-four display-state classification that the
// Setups tab branches on, so the "no data for this date" / "no data for this pair on this
// date" / silent "no setups fired" / content states are checked in web/'s own vitest +
// fast-check toolchain (component render tests under jsdom are deferred to tasks 9.7/9.8).
//
// It asserts, over arbitrary shaped view models + pair selections, that the classification
// honours the design's empty-state matrix and the Req 8.5 rule that cross-pair suppressions
// are never hidden behind the pair-scoped empty banner:
//   - empty input  → "no-data-date"            (Req 7.4)
//   - rows, none surfaced → "silent"           (Req 13.1, 13.2) — even for a single pair,
//        so suppressions still render (never "no-data-pair")
//   - specific pair, surfaced rows exist, but that pair has no card and no suppression
//        → "no-data-pair"                       (Req 8.7)
//   - otherwise → "content"                    (Req 8.3)

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { resolveSetupsViewState } from "./setupsViewState";
import type { SetupsViewModel, CardVM, SuppressionVM } from "../../pure/shapeDashboard";
import { PAIRS } from "../../api/types";
import type { Direction, Horizon, Pair } from "../../api/types";
import { ALL_PAIRS, type PairSelection } from "../../state/selection";

const NUM_RUNS = 300; // >= 100 iterations required by the task.

const directionArb: fc.Arbitrary<Direction> = fc.constantFrom<Direction>("UP", "DOWN", "FLAT");
const horizonArb: fc.Arbitrary<Horizon> = fc.constantFrom<Horizon>(1, 2, 3);
const pairArb: fc.Arbitrary<Pair> = fc.constantFrom(...PAIRS);
const selectionArb: fc.Arbitrary<PairSelection> = fc.constantFrom<PairSelection>(
  ALL_PAIRS,
  ...PAIRS,
);

const reasonArb: fc.Arbitrary<SuppressionVM["reason"]> = fc.constantFrom(
  "below_floor",
  "not_fired",
);

const cardArb: fc.Arbitrary<CardVM> = fc.record({
  pair: pairArb,
  strategyId: fc.string({ minLength: 1, maxLength: 8 }),
  direction: directionArb,
  horizon: horizonArb,
  earnedConfidence: fc.double({ min: 0, max: 1, noNaN: true }),
  stopLossPips: fc.option(fc.integer({ min: 1, max: 500 }), { nil: null }),
  takeProfitPips: fc.option(fc.integer({ min: 1, max: 500 }), { nil: null }),
});

const suppressionArb: fc.Arbitrary<SuppressionVM> = fc.record({
  pair: pairArb,
  reason: reasonArb,
});

/**
 * Build a view model whose flags are self-consistent with its lists the way the real
 * `shapeDashboardView` produces them:
 *   - `hasRows` is independent (an empty date can still be modeled with hasRows=false),
 *   - `isSilent` ⇒ there are no cards (a silent day surfaced nothing).
 */
const modelArb: fc.Arbitrary<SetupsViewModel> = fc
  .record({
    cards: fc.array(cardArb, { maxLength: 5 }),
    suppressions: fc.array(suppressionArb, { maxLength: 6 }),
    hasRows: fc.boolean(),
    isSilent: fc.boolean(),
  })
  .map(({ cards, suppressions, hasRows, isSilent }) => {
    // Enforce the invariants the shaper guarantees so we never test impossible states.
    const effectiveHasRows = hasRows || cards.length > 0 || suppressions.length > 0;
    const effectiveSilent = isSilent && effectiveHasRows;
    const effectiveCards = effectiveSilent ? [] : cards;
    return {
      decisionDate: effectiveHasRows ? "2026-09-16" : "",
      cards: effectiveCards,
      suppressions,
      isSilent: effectiveSilent,
      hasRows: effectiveHasRows,
    } satisfies SetupsViewModel;
  });

describe("resolveSetupsViewState", () => {
  it("empty date (no rows) always resolves to 'no-data-date'", () => {
    fc.assert(
      fc.property(selectionArb, (pair) => {
        const empty: SetupsViewModel = {
          decisionDate: "",
          cards: [],
          suppressions: [],
          isSilent: false,
          hasRows: false,
        };
        expect(resolveSetupsViewState(empty, pair)).toBe("no-data-date");
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("a silent day resolves to 'silent' for every pair selection (suppressions never hidden)", () => {
    fc.assert(
      fc.property(modelArb, selectionArb, (model, pair) => {
        if (model.hasRows && model.isSilent) {
          expect(resolveSetupsViewState(model, pair)).toBe("silent");
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("a specific pair with no card and no suppression of its own resolves to 'no-data-pair'", () => {
    fc.assert(
      fc.property(modelArb, pairArb, (model, pair) => {
        const hasRows = model.hasRows;
        const silent = model.isSilent;
        const hasPairCard = model.cards.some((c) => c.pair === pair);
        const hasPairSuppression = model.suppressions.some((s) => s.pair === pair);
        // `resolveSetupsViewState` scopes cards itself only for ALL vs specific; here the
        // model's cards are the already-scoped list, so the resolver's "hasPairCard" is
        // `cards.length > 0`. Reconstruct the resolver's own view of a pair-scoped card set.
        if (hasRows && !silent && !hasPairCard && !hasPairSuppression) {
          // Scope the model's cards to this pair exactly as the shaper would have for a
          // specific-pair call (so cards.length reflects only this pair).
          const scoped: SetupsViewModel = {
            ...model,
            cards: model.cards.filter((c) => c.pair === pair),
          };
          expect(resolveSetupsViewState(scoped, pair)).toBe("no-data-pair");
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("'ALL' with surfaced cards present resolves to 'content'", () => {
    fc.assert(
      fc.property(modelArb, (model) => {
        if (model.hasRows && !model.isSilent && model.cards.length > 0) {
          expect(resolveSetupsViewState(model, ALL_PAIRS)).toBe("content");
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("is total: every (model, selection) yields one of the four known states", () => {
    const known = new Set(["no-data-date", "no-data-pair", "silent", "content"]);
    fc.assert(
      fc.property(modelArb, selectionArb, (model, pair) => {
        expect(known.has(resolveSetupsViewState(model, pair))).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
