// @vitest-environment jsdom
//
// ConfluencePanel DOM tests (task 23.3 — Requirements 12.5, 12.8, 12.10, 12.12, 12.14,
// 12.16, 12.17, 12.18, 14.1, 14.2).
//
// These EXAMPLE DOM tests render the Confluence panel with Testing Library against a view
// model shaped by the PURE `shapeConfluence` shaper from a realistic `Confluence` slice
// fixture (never a hand-built view model), so the rendered output stays faithful to what a
// real snapshot produces. They assert the panel's interaction and presentation contract:
//
//   - Click, Enter, and Space each pin the selected cell's rationale synchronously, and it
//     stays pinned until another cell is selected or Dismiss / Escape clears it (Req 12.5).
//   - The validation label and the "Strength is not a probability" note appear in BOTH the
//     header region and the detail region (Req 12.8).
//   - A single tab stop with roving `tabIndex`: exactly one cell button is tabbable and the
//     arrow keys move focus WITHOUT selecting (Req 12.10).
//   - The empty view model renders the explicit empty message (Req 12.12).
//   - A `SetupsTab` load failure renders the empty state (Req 12.12 via the tab's fallback).
//   - Folded-in presentation: the Confluence_Summary line and a per-row Score_Gauge render
//     beside the numeric score (Req 12.16, 12.17); a CONFLICT_FLAT row shows its conflict
//     summary sentence (Req 12.14); muted-emphasis cells carry the `data-emphasis` hook yet
//     keep their labels (Req 12.18); and with an `unvalidated` slice the status markers use
//     ONE neutral colour treatment while staying distinguishable by text (Req 14.1, 14.2).
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { EMPTY_CONFLUENCE } from "../../api/snapshot";
import type {
  Confluence,
  ConfluenceCell,
  ConfluencePair,
  ConfluenceStatus,
  ConfluenceStrategyId,
  FiringSetupRow,
} from "../../api/types";
import { shapeConfluence, STRATEGY_IDS } from "../../pure/shapeConfluence";
import { SelectionProvider } from "../../state/selection";
import { ConfluencePanel } from "./ConfluencePanel";
import { SetupsTab, type SetupsEvidence } from "./SetupsTab";

afterEach(cleanup);

// --- Realistic slice fixtures ------------------------------------------------------------

/** All-unit weights except `third_party`, which stays display-only (weight 0) by default. */
const WEIGHTS: Readonly<Record<ConfluenceStrategyId, number>> = {
  trend: 1,
  breakout: 1,
  range: 1,
  reversal: 1,
  custom_pattern: 1,
  third_party: 0,
};

function available(
  strategyId: ConfluenceStrategyId,
  direction: "UP" | "DOWN" | "FLAT",
  strength: number,
  rationale = `${strategyId} rationale: direction ${direction} strength ${strength}`,
): ConfluenceCell {
  return { strategyId, available: true, direction, strength, rationale };
}

function unavailable(strategyId: ConfluenceStrategyId, reason: string): ConfluenceCell {
  return { strategyId, available: false, reason };
}

/** Build the six cells in STRATEGY_IDS order, defaulting any un-overridden id to FLAT. */
function cells(
  overrides: Partial<Record<ConfluenceStrategyId, ConfluenceCell>>,
): readonly ConfluenceCell[] {
  return STRATEGY_IDS.map((id) => overrides[id] ?? available(id, "FLAT", 0));
}

function pairRow(
  pair: string,
  status: ConfluenceStatus,
  score: number,
  cellSet: readonly ConfluenceCell[],
  opposingStrategyIds: readonly ConfluenceStrategyId[] = [],
): ConfluencePair {
  return { pair, score, status, opposingStrategyIds, cells: cellSet };
}

function slice(
  pairs: readonly ConfluencePair[],
  opts: {
    readonly weights?: Readonly<Record<ConfluenceStrategyId, number>>;
    readonly alignmentThreshold?: number;
    readonly conflictThreshold?: number;
    readonly validationLabel?: string;
  } = {},
): Confluence {
  return {
    validationLabel: (opts.validationLabel ?? "unvalidated") as "unvalidated",
    weights: opts.weights ?? WEIGHTS,
    conflictThreshold: opts.conflictThreshold ?? 0.6,
    alignmentThreshold: opts.alignmentThreshold ?? 0.4,
    pairs,
  };
}

/** A realistic, representative slice: one row per status, with a conflict + opposing ids. */
function richSlice(): Confluence {
  return slice([
    pairRow(
      "EURUSD",
      "ALIGNED_UP",
      0.72,
      cells({
        trend: available("trend", "UP", 0.8),
        breakout: available("breakout", "UP", 0.6),
        range: available("range", "FLAT", 0),
      }),
    ),
    pairRow(
      "GBPUSD",
      "ALIGNED_DOWN",
      -0.65,
      cells({ trend: available("trend", "DOWN", 0.7) }),
    ),
    pairRow(
      "USDJPY",
      "CONFLICT_FLAT",
      0,
      cells({
        trend: available("trend", "UP", 0.9),
        reversal: available("reversal", "DOWN", 0.85),
      }),
      ["trend", "reversal"],
    ),
    pairRow("USDCHF", "NEUTRAL", 0.1, cells({})),
    pairRow(
      "USDCAD",
      "INSUFFICIENT_DATA",
      0,
      cells({ trend: unavailable("trend", "candles_unavailable") }),
    ),
  ]);
}

/** Render the panel standalone with a view model shaped from `s`. */
function renderPanel(s: Confluence): void {
  render(<ConfluencePanel viewModel={shapeConfluence(s)} />);
}

/** Every cell button carries `aria-label` → every grid cell is addressable by role+name. */
function cellButton(accessibleSubstring: RegExp): HTMLButtonElement {
  return screen.getByRole("button", { name: accessibleSubstring }) as HTMLButtonElement;
}

// --- Selection (click / Enter / Space) → pinned rationale (Req 12.5) --------------------

describe("ConfluencePanel — selecting a cell pins its rationale (Req 12.5)", () => {
  it("a click shows the selected cell's rationale synchronously", () => {
    renderPanel(richSlice());
    const detail = screen.getByTestId("confluence-detail");
    // Nothing pinned yet: the detail region shows the prompt, not a rationale.
    expect(within(detail).queryByText(/trend rationale: direction UP/)).toBeNull();

    fireEvent.click(cellButton(/EURUSD, trend, Up/));
    expect(within(detail).getByText(/trend rationale: direction UP strength 0\.8/)).toBeTruthy();
  });

  it("Enter shows the selected cell's rationale synchronously", () => {
    renderPanel(richSlice());
    const button = cellButton(/EURUSD, breakout, Up/);
    // Enter falls through to native button activation (the component intercepts only the
    // navigation keys); model the browser's resulting activation as a click.
    fireEvent.keyDown(button, { key: "Enter" });
    fireEvent.click(button);
    const detail = screen.getByTestId("confluence-detail");
    expect(within(detail).getByText(/breakout rationale: direction UP strength 0\.6/)).toBeTruthy();
  });

  it("Space shows the selected cell's rationale synchronously", () => {
    renderPanel(richSlice());
    const button = cellButton(/GBPUSD, trend, Down/);
    fireEvent.keyDown(button, { key: " " });
    fireEvent.click(button);
    const detail = screen.getByTestId("confluence-detail");
    expect(within(detail).getByText(/trend rationale: direction DOWN strength 0\.7/)).toBeTruthy();
  });

  it("keeps the rationale pinned until another cell is selected", () => {
    renderPanel(richSlice());
    const detail = screen.getByTestId("confluence-detail");

    fireEvent.click(cellButton(/EURUSD, trend, Up/));
    expect(within(detail).getByText(/trend rationale: direction UP strength 0\.8/)).toBeTruthy();

    // Selecting a different cell replaces the pinned rationale with the new one.
    fireEvent.click(cellButton(/EURUSD, breakout, Up/));
    expect(within(detail).queryByText(/trend rationale: direction UP strength 0\.8/)).toBeNull();
    expect(within(detail).getByText(/breakout rationale: direction UP strength 0\.6/)).toBeTruthy();
  });

  it("the Dismiss button clears the pinned rationale", () => {
    renderPanel(richSlice());
    const detail = screen.getByTestId("confluence-detail");

    fireEvent.click(cellButton(/EURUSD, trend, Up/));
    expect(within(detail).getByText(/trend rationale: direction UP/)).toBeTruthy();

    fireEvent.click(within(detail).getByRole("button", { name: /Dismiss/ }));
    expect(within(detail).queryByText(/trend rationale: direction UP/)).toBeNull();
  });

  it("Escape on the selected cell dismisses the pinned rationale", () => {
    renderPanel(richSlice());
    const detail = screen.getByTestId("confluence-detail");
    const button = cellButton(/EURUSD, trend, Up/);

    fireEvent.click(button);
    expect(within(detail).getByText(/trend rationale: direction UP/)).toBeTruthy();

    fireEvent.keyDown(button, { key: "Escape" });
    expect(within(detail).queryByText(/trend rationale: direction UP/)).toBeNull();
  });
});

// --- Validation label + strength note in BOTH regions (Req 12.8) ------------------------

describe("ConfluencePanel — label + probability note in both regions (Req 12.8)", () => {
  it("the Un-validated label appears in the header AND the detail region", () => {
    renderPanel(richSlice());
    // Both the header ValidationNote and the detail-region ValidationNote render it.
    expect(screen.getAllByText("Un-validated").length).toBeGreaterThanOrEqual(2);
  });

  it("the 'Strength is not a probability' note appears in the header AND the detail region", () => {
    renderPanel(richSlice());
    expect(
      screen.getAllByText(/Strength is not a probability/).length,
    ).toBeGreaterThanOrEqual(2);
  });
});

// --- Single tab stop + roving tabIndex arrow navigation (Req 12.10) ---------------------

describe("ConfluencePanel — single tab stop, arrow-key focus (Req 12.10)", () => {
  it("exactly one cell button is tabbable at a time", () => {
    renderPanel(richSlice());
    const grid = screen.getByRole("grid");
    const cellButtons = within(grid)
      .getAllByRole("button")
      .filter((b) => b.getAttribute("aria-label") !== null);
    const tabbable = cellButtons.filter((b) => b.getAttribute("tabindex") === "0");
    expect(tabbable.length).toBe(1);
    // Every other cell button is removed from the tab order.
    expect(cellButtons.filter((b) => b.getAttribute("tabindex") === "-1").length).toBe(
      cellButtons.length - 1,
    );
  });

  it("an arrow key moves focus to the next cell WITHOUT selecting it", () => {
    renderPanel(richSlice());
    const detail = screen.getByTestId("confluence-detail");
    const first = cellButton(/EURUSD, trend, Up/);
    first.focus();
    expect(document.activeElement).toBe(first);

    // ArrowRight moves focus to the next column's cell and selects nothing.
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(document.activeElement).toBe(cellButton(/EURUSD, breakout, Up/));
    expect(within(detail).queryByText(/rationale:/)).toBeNull();

    // ArrowDown then moves focus down a row, still without pinning a rationale.
    const second = cellButton(/EURUSD, breakout, Up/);
    fireEvent.keyDown(second, { key: "ArrowDown" });
    expect(document.activeElement).toBe(cellButton(/GBPUSD, breakout/));
    expect(within(detail).queryByText(/rationale:/)).toBeNull();
  });

  it("moving focus then activating pins only the newly focused cell", () => {
    renderPanel(richSlice());
    const detail = screen.getByTestId("confluence-detail");
    const first = cellButton(/EURUSD, trend, Up/);
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });

    const focused = document.activeElement as HTMLButtonElement;
    fireEvent.click(focused);
    expect(within(detail).getByText(/breakout rationale: direction UP strength 0\.6/)).toBeTruthy();
    expect(within(detail).queryByText(/trend rationale: direction UP strength 0\.8/)).toBeNull();
  });
});

// --- Empty view model (Req 12.12) -------------------------------------------------------

describe("ConfluencePanel — empty view model (Req 12.12)", () => {
  it("renders the explicit empty message and no grid", () => {
    renderPanel(slice([]));
    expect(screen.getByText("no confluence data for this run")).toBeTruthy();
    expect(screen.queryByRole("grid")).toBeNull();
    // The validation label still shows even in the empty state.
    expect(screen.getByText("Un-validated")).toBeTruthy();
  });
});

// --- SetupsTab load failure → empty state (Req 12.12) -----------------------------------

describe("ConfluencePanel via SetupsTab — load failure renders the empty state (Req 12.12)", () => {
  const DATE = "2026-02-01";
  const evidence: SetupsEvidence = {
    analogueOutcomes: [],
    tradeLedgerSummary: { window: null, strategies: [] },
    provenance: [],
    validationStatus: [],
  };
  // A firing row so the tab reaches its `content` state — where the ConfluencePanel renders.
  const firing: FiringSetupRow = {
    decision_date: DATE,
    pair: "EURUSD",
    strategy_id: "s1",
    direction: "UP",
    horizon: 2,
    earned_confidence: 0.6,
    stop_loss_pips: 30,
    take_profit_pips: 45,
    surfaced: true,
    suppression_reason: null,
  };

  it("a failed confluence load degrades to the empty confluence panel", async () => {
    // The tab's own `defaultLoadConfluence` catches a snapshot failure and returns the
    // fail-safe EMPTY_CONFLUENCE slice (it never rejects, so the tab never shows an error
    // for a confluence failure). Inject that caught-failure result directly: a confluence
    // load that resolves to EMPTY_CONFLUENCE must render the panel's explicit empty state.
    render(
      <SelectionProvider initialState={{ pair: "ALL", date: null }}>
        <SetupsTab
          loadDecisionDates={() =>
            Promise.resolve({ rows: [{ decision_date: DATE }], lastUpdated: null })
          }
          loadFiringSetups={() => Promise.resolve({ rows: [firing], lastUpdated: null })}
          loadPairEvaluations={() => Promise.resolve({ rows: [], lastUpdated: null })}
          loadDailyCommentary={() =>
            Promise.resolve({ decision_date: "", note_text: "", generated: false })
          }
          loadEvidence={() => Promise.resolve(evidence)}
          loadConfluence={() => Promise.resolve(EMPTY_CONFLUENCE)}
        />
      </SelectionProvider>,
    );
    expect(await screen.findByText("no confluence data for this run")).toBeTruthy();
  });
});

// --- Folded-in presentation: summary + gauge (Req 12.16, 12.17) -------------------------

describe("ConfluencePanel — summary line + per-row gauge beside the score (Req 12.16, 12.17)", () => {
  it("renders the Confluence_Summary counts line", () => {
    renderPanel(richSlice());
    const summary = screen.getByTestId("confluence-summary");
    // One of each: 2 aligned (UP + DOWN), 1 conflict, 2 neutral (NEUTRAL + INSUFFICIENT).
    expect(summary.textContent).toMatch(/2 aligned, 1 conflict, 2 neutral/);
  });

  it("renders the numeric score AND a Score_Gauge in the same cell per row", () => {
    renderPanel(richSlice());
    const grid = screen.getByRole("grid");
    // The EURUSD score (0.72) is shown as text in a row that also renders the gauge.
    const scoreText = within(grid).getByText("0.72");
    const scoreCell = scoreText.closest("td") as HTMLElement;
    // The diverging gauge is decorative (aria-hidden) and sits beside the numeric score.
    const gauge = scoreCell.querySelector('[aria-hidden="true"]');
    expect(gauge).not.toBeNull();
    expect(scoreCell.textContent).toContain("0.72");
  });
});

// --- Folded-in presentation: conflict summary sentence (Req 12.14) ----------------------

describe("ConfluencePanel — CONFLICT_FLAT conflict summary sentence (Req 12.14)", () => {
  it("shows a conflict-summary sentence naming the opposing UP and DOWN ids", () => {
    renderPanel(richSlice());
    const conflict = screen.getByTestId("conflict-summary");
    expect(conflict.textContent).toMatch(/Stay flat/i);
    expect(conflict.textContent).toContain("trend");
    expect(conflict.textContent).toContain("reversal");
  });
});

// --- Folded-in presentation: muted emphasis style hook (Req 12.18) ----------------------

describe("ConfluencePanel — muted cells carry the style hook yet keep labels (Req 12.18)", () => {
  it("a FLAT / unavailable / zero-weight cell button is data-emphasis='muted' but keeps its label", () => {
    renderPanel(richSlice());

    // A FLAT cell is muted but still labelled.
    const flatCell = cellButton(/EURUSD, range, Flat/);
    expect(flatCell.getAttribute("data-emphasis")).toBe("muted");
    expect(within(flatCell).getByText(/Flat/)).toBeTruthy();

    // A directional, positive-weight cell is the signal emphasis.
    const signalCell = cellButton(/EURUSD, trend, Up/);
    expect(signalCell.getAttribute("data-emphasis")).toBe("signal");

    // An unavailable cell is muted and still carries its "Unavailable" label.
    const unavailableCell = cellButton(/USDCAD, trend, unavailable/);
    expect(unavailableCell.getAttribute("data-emphasis")).toBe("muted");
    expect(within(unavailableCell).getByText(/Unavailable/)).toBeTruthy();
  });
});

// --- Honest presentation: neutral colour while un-validated (Req 14.1, 14.2) ------------

describe("ConfluencePanel — un-validated slice uses one neutral colour, text still distinct (Req 14.1, 14.2)", () => {
  it("every status marker shares one neutral colour yet stays distinguishable by text", () => {
    renderPanel(richSlice());
    const grid = screen.getByRole("grid");

    // The distinct status TEXT carries the meaning while un-validated.
    expect(within(grid).getByText("Aligned up")).toBeTruthy();
    expect(within(grid).getByText("Aligned down")).toBeTruthy();
    expect(within(grid).getByText("Neutral")).toBeTruthy();
    expect(within(grid).getByText("Insufficient data")).toBeTruthy();
    // The CONFLICT_FLAT row keeps its distinct "Stay Flat" marker.
    expect(screen.getByTestId("stay-flat-marker").textContent).toMatch(/Stay Flat/);

    // Colour is suppressed: the non-conflict status labels all share ONE colour treatment.
    // The colour is carried by the OUTER status span (the label text sits in a child span).
    const colourOf = (label: string): string => {
      const inner = within(grid).getByText(label);
      const outer = inner.parentElement as HTMLElement;
      return outer.style.color;
    };
    const colours = new Set([
      colourOf("Aligned up"),
      colourOf("Aligned down"),
      colourOf("Neutral"),
    ]);
    expect(colours.size).toBe(1);
  });

  it("a validated slice DOES differentiate the status colours", () => {
    renderPanel(slice(richSlice().pairs, { validationLabel: "validated" }));
    const grid = screen.getByRole("grid");
    const colourOf = (label: string): string =>
      (within(grid).getByText(label).parentElement as HTMLElement).style.color;
    // Once validated, UP and DOWN are coloured differently (green vs red).
    expect(colourOf("Aligned up")).not.toBe(colourOf("Aligned down"));
  });
});
