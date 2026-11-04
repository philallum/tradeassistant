// @vitest-environment jsdom
//
// Single-window dashboard — MasterCard DOM tests (task 2.14).
//
// Validates: Requirements 1.2, 1.3, 8.1, 8.2, 8.4, 7.2, 12.1

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { Confluence, ConfluenceCell } from "../api/types";
import { PAIRS } from "../api/types";
import { shapeConfluence, STRATEGY_IDS } from "../pure/shapeConfluence";
import type { DailyNoteViewModel } from "../pure/shapeDailyNote";
import type { EvidenceVM } from "../pure/shapeEvidence";
import type { SetupTradeVM } from "../pure/shapeSetupTrades";
import { MasterCard } from "./MasterCard";

afterEach(() => {
  cleanup();
});

const SETUP: SetupTradeVM = {
  pair: "EURUSD",
  strategyId: "s1",
  forecast: {
    label: "FORECAST",
    direction: "UP",
    horizon: 1,
    confidence: { value: 0.64, validated: true },
    analogueCount: 10,
    historicalAgreement: 0.6,
  },
  trade: {
    label: "TRADE",
    entryAssumption: "Next open",
    stopLossPips: { value: 25, validated: true },
    takeProfitPips: { value: 40, validated: true },
    horizonExpiry: "2026-09-17",
    netExpectancyPips: { value: 3, validated: true },
  },
  anyUnvalidated: false,
};

const NOTE: DailyNoteViewModel = {
  status: "generated",
  text: "Quiet session.",
  decisionDate: "2026-09-16",
};

const EVIDENCE: EvidenceVM = {
  pair: "EURUSD",
  horizon: 5,
  analogueCount: 12,
  targetOnly: 5,
  stopOnly: 3,
  ambiguous: 1,
  neither: 3,
  classifiable: true,
  ledger: null,
};

function renderCard(): HTMLElement {
  const cells: ConfluenceCell[] = STRATEGY_IDS.map((id) => ({
    strategyId: id,
    available: true,
    direction: "UP",
    strength: 0.5,
    rationale: `${id} rationale`,
  }));
  const slice: Confluence = {
    validationLabel: "unvalidated" as "unvalidated",
    weights: {
      trend: 1,
      breakout: 1,
      range: 1,
      reversal: 1,
      custom_pattern: 1,
      third_party: 0,
    },
    conflictThreshold: 0.6,
    alignmentThreshold: 0.4,
    pairs: [{ pair: "EURUSD", score: 0.7, status: "ALIGNED_UP", opposingStrategyIds: [], cells }],
  };
  const vm = shapeConfluence(slice);
  const { container } = render(
    <MasterCard
      setup={SETUP}
      edge={{ available: true, edgeText: "+3.2 pp" }}
      row={vm.rows[0] ?? null}
      columns={vm.columns}
      validated={vm.validated}
      note={NOTE}
      evidence={EVIDENCE}
    />,
  );
  return container;
}

/** True when `a` appears before `b` in document order. */
function before(a: Element, b: Element): boolean {
  return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

describe("MasterCard", () => {
  it("renders banner, pill, matrix, drawers in that DOM order (Req 1.2, 8.1, 8.2)", () => {
    renderCard();
    const banner = screen.getByTestId("verdict-direction");
    const pill = screen.getByTestId("backtest-edge-pill");
    const matrix = screen.getByRole("group", { name: /strategy cells/ });
    const drawers = screen.getByTestId("context-drawers");
    expect(before(banner, pill)).toBe(true);
    expect(before(pill, matrix)).toBe(true);
    expect(before(matrix, drawers)).toBe(true);
  });

  it("renders exactly one backtest edge pill (Req 8.4)", () => {
    renderCard();
    expect(screen.getAllByTestId("backtest-edge-pill")).toHaveLength(1);
  });

  it("has no table with more than one pair column (Req 1.3)", () => {
    const container = renderCard();
    const pairs: readonly string[] = PAIRS;
    for (const table of Array.from(container.querySelectorAll("table"))) {
      const headers = Array.from(table.querySelectorAll("th, [role='columnheader']"));
      const pairHeaders = headers.filter((h) => pairs.includes((h.textContent ?? "").trim()));
      expect(pairHeaders.length).toBeLessThanOrEqual(1);
    }
  });

  it("renders no h1; the ControlBar owns it (Req 12.1)", () => {
    const container = renderCard();
    expect(container.querySelectorAll("h1")).toHaveLength(0);
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });

  it("has both drawers collapsed by default (Req 7.2)", () => {
    renderCard();
    const drawers = screen.getByTestId("context-drawers");
    const buttons = Array.from(drawers.querySelectorAll("button"));
    expect(buttons).toHaveLength(2);
    for (const b of buttons) {
      expect(b.getAttribute("aria-expanded")).toBe("false");
    }
    expect(screen.queryByTestId("evidence-body")).toBeNull();
    expect(screen.queryByText("Quiet session.")).toBeNull();
  });
});
