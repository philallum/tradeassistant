// @vitest-environment jsdom
//
// Feature: mobile-dashboard-single-window, Property 6: Rendered Master_Card values are an
// exact copy of shaper-output strings.
//
// Validates: Requirements 9.2
//
// For arbitrary `SetupTradeVM`, `RowVM`, `EvidenceVM`, and `DailyNoteViewModel` values,
// rendering `VerdictBanner`, `PairConfluenceMatrix`, and `ContextDrawers` must produce DOM
// text for each labelled field that equals the corresponding view-model field run only
// through the existing `format.ts` formatter already used for that field elsewhere in the
// codebase — no extra rounding, truncation, or substitution. Arbitraries are built the same
// way the `confidence/` and `csv-loader/` property suites build `fc.record` generators.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import fc from "fast-check";

import type { Direction } from "../api/types";
import { formatConfidence, formatDirection, formatPips } from "../pure/format";
import type { DailyNoteViewModel } from "../pure/shapeDailyNote";
import type { EvidenceVM } from "../pure/shapeEvidence";
import type { CellVM, ColumnVM, RowVM } from "../pure/shapeConfluence";
import type { SetupTradeVM } from "../pure/shapeSetupTrades";
import { ContextDrawers } from "./ContextDrawers";
import { PairConfluenceMatrix } from "./PairConfluenceMatrix";
import { VerdictBanner } from "./VerdictBanner";

afterEach(() => {
  cleanup();
});

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------------------
// Arbitraries — built the same way `confidence/` and `csv-loader/` property suites build
// `fc.record` generators for their domain types: constrained numeric ranges plus
// `fc.constantFrom`/`fc.option` for the small enumerated/nullable fields.
// ---------------------------------------------------------------------------------------

const direction: fc.Arbitrary<Direction> = fc.constantFrom("UP", "DOWN", "FLAT");

const pipsValue: fc.Arbitrary<number> = fc.integer({ min: -500, max: 500 });

const probability: fc.Arbitrary<number> = fc.float({
  min: 0,
  max: Math.fround(1),
  noNaN: true,
  noDefaultInfinity: true,
});

function maybeValidated<T>(value: fc.Arbitrary<T>): fc.Arbitrary<{
  value: T;
  validated: boolean;
}> {
  return fc.record({ value, validated: fc.boolean() });
}

const setupTradeVM: fc.Arbitrary<SetupTradeVM> = fc.record({
  pair: fc.constantFrom(...(["EURUSD", "GBPUSD", "USDJPY", "USDCHF", "USDCAD"] as const)),
  strategyId: fc.constantFrom("s1", "s2", "trend"),
  forecast: fc.record({
    label: fc.constant("FORECAST" as const),
    direction,
    horizon: fc.constantFrom(1, 2, 3) as fc.Arbitrary<1 | 2 | 3>,
    confidence: maybeValidated(probability),
    analogueCount: fc.integer({ min: 0, max: 50 }),
    historicalAgreement: fc.option(probability, { nil: null }),
  }),
  trade: fc.record({
    label: fc.constant("TRADE" as const),
    entryAssumption: fc.option(fc.constantFrom("Next open", "Market close"), { nil: null }),
    stopLossPips: maybeValidated(fc.option(pipsValue, { nil: null })),
    takeProfitPips: maybeValidated(fc.option(pipsValue, { nil: null })),
    horizonExpiry: fc.option(fc.constantFrom("2026-09-17", "2026-10-01"), { nil: null }),
    netExpectancyPips: maybeValidated(fc.option(pipsValue, { nil: null })),
  }),
  anyUnvalidated: fc.boolean(),
});

const cellVM: fc.Arbitrary<CellVM> = fc.record({
  strategyId: fc.constantFrom("trend", "breakout", "range", "reversal", "custom_pattern"),
  available: fc.constant(true),
  directionLabel: fc.constantFrom("Up", "Down", "Flat"),
  glyph: fc.constantFrom("▲", "▼", "–"),
  strengthText: fc
    .float({ min: 0, max: Math.fround(1), noNaN: true, noDefaultInfinity: true })
    .map((v) => v.toFixed(2)),
  strength: probability,
  emphasis: fc.constantFrom("signal", "muted"),
  detailText: fc.constantFrom("some rationale", "another rationale"),
  highlighted: fc.boolean(),
  highlightLabel: fc.option(fc.constant("Conflicting"), { nil: null }),
  accessibleName: fc.constantFrom("acc-name-a", "acc-name-b"),
});

const rowVM: fc.Arbitrary<RowVM> = fc
  .record({
    pair: fc.constantFrom<RowVM["pair"]>("EURUSD", "GBPUSD", "USDJPY", "USDCHF", "USDCAD"),
    score: fc.float({ min: Math.fround(-1), max: Math.fround(1), noNaN: true, noDefaultInfinity: true }),
    status: fc.constantFrom<RowVM["status"]>(
      "ALIGNED_UP",
      "ALIGNED_DOWN",
      "NEUTRAL",
      "INSUFFICIENT_DATA",
      "CONFLICT_FLAT",
    ),
    marker: fc.constantFrom<RowVM["marker"]>("green", "red", "neutral", "conflict"),
    markerText: fc.constantFrom("Aligned up", "Aligned down", "Neutral", "Stay Flat"),
    stayFlat: fc.boolean(),
    conflictSummary: fc.option(fc.constant("opposing summary"), { nil: null }),
    cells: fc.uniqueArray(cellVM, {
      minLength: 1,
      maxLength: 5,
      selector: (c) => c.strategyId,
    }),
  })
  .map((r) => ({
    ...r,
    scoreText: r.score.toFixed(2),
    statusLabel: r.markerText,
    gauge: { min: -1 as const, max: 1 as const, value: r.score, posThreshold: 0.4, negThreshold: -0.4 },
  }));

const performanceSummaryRow = fc.record({
  strategyId: fc.constant("system"),
  netExpectancyPips: pipsValue,
  netExpectancyR: fc.float({ min: -5, max: 5, noNaN: true, noDefaultInfinity: true }),
  grossExpectancyPips: pipsValue,
  winRate: probability,
  avgWinPips: fc.integer({ min: 0, max: 500 }),
  avgLossPips: fc.integer({ min: 0, max: 500 }),
  profitFactor: fc.option(fc.float({ min: 0, max: Math.fround(10), noNaN: true, noDefaultInfinity: true }), {
    nil: null,
  }),
  maxDrawdownPips: fc.integer({ min: 0, max: 1000 }),
  longestLosingStreak: fc.integer({ min: 0, max: 20 }),
  tradeCount: fc.integer({ min: 1, max: 200 }),
  timeInMarketDays: fc.integer({ min: 0, max: 500 }),
  ambiguousShare: probability,
  expiredShare: probability,
});

const evidenceVM: fc.Arbitrary<EvidenceVM> = fc.record({
  pair: fc.constantFrom("EURUSD", "GBPUSD", "USDJPY", "USDCHF", "USDCAD"),
  horizon: fc.constantFrom(1, 2, 3),
  analogueCount: fc.integer({ min: 1, max: 50 }),
  targetOnly: fc.integer({ min: 0, max: 10 }),
  stopOnly: fc.integer({ min: 0, max: 10 }),
  ambiguous: fc.integer({ min: 0, max: 10 }),
  neither: fc.integer({ min: 0, max: 10 }),
  classifiable: fc.constant(true),
  ledger: fc.option(performanceSummaryRow, { nil: null }),
});

const dailyNoteVM: fc.Arbitrary<DailyNoteViewModel> = fc.oneof(
  fc.record({
    status: fc.constant("generated" as const),
    text: fc.constantFrom(
      "Quiet session; EURUSD leads.",
      "Choppy majors; no clear edge.",
      "GBPUSD trending; others flat.",
    ),
    decisionDate: fc.constantFrom("2026-09-16", "2026-10-01"),
  }),
  fc.record({
    status: fc.constant("unavailable" as const),
    text: fc.constant(null),
    decisionDate: fc.constantFrom("2026-09-16", "2026-10-01"),
  }),
  fc.record({
    status: fc.constant("absent" as const),
    text: fc.constant(null),
    decisionDate: fc.constant(null),
  }),
);

// ---------------------------------------------------------------------------------------
// VerdictBanner
// ---------------------------------------------------------------------------------------

describe("Property 6 — VerdictBanner renders shaper strings verbatim", () => {
  it("every labelled field equals the exact format.ts string for that field", () => {
    fc.assert(
      fc.property(setupTradeVM, (vm) => {
        const { unmount } = render(<VerdictBanner vm={vm} />);
        try {
          expect(screen.getByTestId("verdict-direction").textContent).toContain(
            formatDirection(vm.forecast.direction),
          );
          expect(screen.getByTestId("verdict-confidence").textContent).toBe(
            formatConfidence(vm.forecast.confidence.value),
          );
          expect(screen.getByTestId("verdict-entry").textContent).toBe(
            vm.trade.entryAssumption ?? "—",
          );
          expect(screen.getByTestId("verdict-stop-loss").textContent).toContain(
            formatPips(vm.trade.stopLossPips.value),
          );
          expect(screen.getByTestId("verdict-take-profit").textContent).toContain(
            formatPips(vm.trade.takeProfitPips.value),
          );
          expect(screen.getByTestId("verdict-net-expectancy").textContent).toBe(
            formatPips(vm.trade.netExpectancyPips.value),
          );
        } finally {
          unmount();
          cleanup();
        }
      }),
      { numRuns: NUM_RUNS },
    );
  }, 30_000);
});

// ---------------------------------------------------------------------------------------
// PairConfluenceMatrix
// ---------------------------------------------------------------------------------------

function columnsFor(row: RowVM): readonly ColumnVM[] {
  return row.cells.map((cell) => ({
    strategyId: cell.strategyId,
    header: cell.strategyId,
    displayOnly: false,
  }));
}

describe("Property 6 — PairConfluenceMatrix renders shaper strings verbatim", () => {
  it("score, status, and per-cell fields equal the shaper's own strings", () => {
    fc.assert(
      fc.property(rowVM, (row) => {
        const { unmount } = render(
          <PairConfluenceMatrix row={row} columns={columnsFor(row)} validated={false} />,
        );
        try {
          expect(screen.getByTestId("confluence-score").textContent).toBe(row.scoreText);
          expect(screen.getByTestId("confluence-status").textContent).toBe(
            row.stayFlat ? row.markerText : row.statusLabel,
          );
          for (const cell of row.cells) {
            const cellEl = screen.getByTestId(`matrix-cell-${cell.strategyId}`);
            expect(cellEl.textContent).toContain(cell.directionLabel);
            if (cell.available) {
              expect(
                screen.getByTestId(`matrix-strength-${cell.strategyId}`).textContent,
              ).toBe(cell.strengthText);
            }
          }
        } finally {
          unmount();
          cleanup();
        }
      }),
      { numRuns: NUM_RUNS },
    );
  }, 30_000);
});

// ---------------------------------------------------------------------------------------
// ContextDrawers
// ---------------------------------------------------------------------------------------

describe("Property 6 — ContextDrawers renders shaper strings verbatim", () => {
  it("the generated note's text is the exact verbatim shaper string, with no substitution", () => {
    fc.assert(
      fc.property(dailyNoteVM, evidenceVM, (note, evidence) => {
        const { unmount } = render(<ContextDrawers note={note} evidence={evidence} />);
        try {
          const noteHeader = screen.getByRole("button", { name: /Daily AI note/ });
          fireEvent.click(noteHeader);
          if (note.status === "generated" && note.text !== null) {
            expect(screen.getByText(note.text).textContent).toBe(note.text);
          }
        } finally {
          unmount();
          cleanup();
        }
      }),
      { numRuns: NUM_RUNS },
    );
  }, 30_000);

  it("the evidence drawer's analogue tally and ledger percentages equal the shaper's own numbers", () => {
    fc.assert(
      fc.property(dailyNoteVM, evidenceVM, (note, evidence) => {
        const { unmount } = render(<ContextDrawers note={note} evidence={evidence} />);
        try {
          const evidenceHeader = screen.getByRole("button", { name: /Historical evidence/ });
          fireEvent.click(evidenceHeader);
          const body = screen.getByTestId("evidence-body");
          expect(body.textContent).toContain(`${evidence.analogueCount} matured analogue`);
          expect(body.textContent).toContain(`${evidence.horizon}d horizon`);
          if (evidence.ledger !== null) {
            expect(body.textContent).toContain(`Simulated trades: ${evidence.ledger.tradeCount}`);
            expect(body.textContent).toContain(
              `win rate ${Math.round(evidence.ledger.winRate * 100)}%`,
            );
          }
        } finally {
          unmount();
          cleanup();
        }
      }),
      { numRuns: NUM_RUNS },
    );
  }, 30_000);
});
