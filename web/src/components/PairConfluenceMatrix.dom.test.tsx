// @vitest-environment jsdom
//
// PairConfluenceMatrix DOM tests.
// Validates: Requirements 5.1, 5.3, 5.7, 5.9, 6.2, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10,
// 12.2, 12.3, 12.7, 12.8
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { Confluence, ConfluenceCell, ConfluenceStrategyId } from "../api/types";
import { shapeConfluence, STRATEGY_IDS, type RowVM } from "../pure/shapeConfluence";
import { PairConfluenceMatrix } from "./PairConfluenceMatrix";

afterEach(cleanup);

const WEIGHTS: Readonly<Record<ConfluenceStrategyId, number>> = {
  trend: 1,
  breakout: 1,
  range: 1,
  reversal: 1,
  custom_pattern: 1,
  third_party: 0,
};

function avail(
  strategyId: ConfluenceStrategyId,
  direction: "UP" | "DOWN" | "FLAT",
  strength: number,
): ConfluenceCell {
  return {
    strategyId,
    available: true,
    direction,
    strength,
    rationale: `${strategyId} rationale ${direction}`,
  };
}

function makeSlice(validated: boolean): Confluence {
  const cells: ConfluenceCell[] = STRATEGY_IDS.map((id) => {
    if (id === "trend") return avail(id, "UP", 0.8);
    if (id === "breakout") return avail(id, "DOWN", 0.6);
    if (id === "range") return { strategyId: id, available: false, reason: "candles_unavailable" };
    return avail(id, "FLAT", 0);
  });
  return {
    validationLabel: (validated ? "validated" : "unvalidated") as "unvalidated",
    weights: WEIGHTS,
    conflictThreshold: 0.6,
    alignmentThreshold: 0.4,
    pairs: [
      {
        pair: "EURUSD",
        score: 0.72,
        status: "ALIGNED_UP",
        opposingStrategyIds: [],
        cells,
      },
    ],
  };
}

function setup(validated = false): { row: RowVM } {
  const vm = shapeConfluence(makeSlice(validated));
  const row = vm.rows[0]!;
  render(<PairConfluenceMatrix row={row} columns={vm.columns} validated={vm.validated} />);
  return { row };
}

function cellButtons(): HTMLButtonElement[] {
  const group = screen.getByRole("group", { name: /strategy cells/ });
  return within(group).getAllByRole("button") as HTMLButtonElement[];
}

function drawerText(): string {
  return screen.getByTestId("rationale-drawer").textContent ?? "";
}

describe("PairConfluenceMatrix — structure", () => {
  it("renders six cells in canonical strategy order", () => {
    setup();
    const buttons = cellButtons();
    expect(buttons).toHaveLength(6);
    expect(buttons.map((b) => b.getAttribute("data-testid"))).toEqual(
      STRATEGY_IDS.map((id) => `matrix-cell-${id}`),
    );
  });

  it("an unavailable cell shows no strength but stays focusable and activatable", () => {
    setup();
    expect(screen.queryByTestId("matrix-strength-range")).toBeNull();
    expect(screen.getByTestId("matrix-strength-trend").textContent).toBe("0.80");

    const range = screen.getByTestId("matrix-cell-range");
    expect(within(range).getByText(/Unavailable/)).toBeTruthy();
    range.focus();
    expect(document.activeElement).toBe(range);
    fireEvent.click(range);
    expect(range.getAttribute("aria-pressed")).toBe("true");
    expect(drawerText()).toContain("candles_unavailable");
  });

  it("carries a non-colour direction cue (word and glyph) on every cell", () => {
    setup();
    const trend = screen.getByTestId("matrix-cell-trend");
    expect(trend.textContent).toContain("Up");
    expect(trend.textContent).toContain("▲");
    const breakout = screen.getByTestId("matrix-cell-breakout");
    expect(breakout.textContent).toContain("Down");
    expect(breakout.textContent).toContain("▼");
  });

  it("labels the display-only column", () => {
    setup();
    expect(screen.getByTestId("matrix-cell-third_party").getAttribute("data-display-only")).toBe(
      "true",
    );
    expect(screen.getByText("Third party (display-only)")).toBeTruthy();
  });
});

describe("PairConfluenceMatrix — roving tabindex and keyboard focus", () => {
  it("exposes exactly one Tab stop on the 1x6 grid", () => {
    setup();
    const buttons = cellButtons();
    expect(buttons.filter((b) => b.tabIndex === 0)).toHaveLength(1);
    expect(buttons.filter((b) => b.tabIndex === -1)).toHaveLength(5);
  });

  it("arrow / Home / End move focus and the Tab stop without changing the pinned drawer", () => {
    setup();
    const buttons = cellButtons();
    fireEvent.click(buttons[1]!); // pin breakout
    const pinned = drawerText();
    expect(pinned).toContain("breakout rationale DOWN");

    buttons[1]!.focus();
    fireEvent.keyDown(buttons[1]!, { key: "ArrowRight" });
    expect(document.activeElement).toBe(buttons[2]);
    expect(buttons[2]!.tabIndex).toBe(0);
    expect(buttons.filter((b) => b.tabIndex === 0)).toHaveLength(1);

    fireEvent.keyDown(buttons[2]!, { key: "End" });
    expect(document.activeElement).toBe(buttons[5]);

    fireEvent.keyDown(buttons[5]!, { key: "ArrowRight" }); // clamped
    expect(document.activeElement).toBe(buttons[5]);

    fireEvent.keyDown(buttons[5]!, { key: "Home" });
    expect(document.activeElement).toBe(buttons[0]);

    fireEvent.keyDown(buttons[0]!, { key: "ArrowLeft" }); // clamped
    expect(document.activeElement).toBe(buttons[0]);

    expect(drawerText()).toBe(pinned);
    expect(buttons[1]!.getAttribute("aria-pressed")).toBe("true");
  });
});

describe("PairConfluenceMatrix — drawer", () => {
  it("starts with no drawer content and all cells unpressed", () => {
    setup();
    expect(screen.queryByTestId("rationale-drawer-content")).toBeNull();
    for (const b of cellButtons()) expect(b.getAttribute("aria-pressed")).toBe("false");
  });

  it("Enter and Space (native activation) reveal the drawer with aria-pressed", () => {
    setup();
    const [trend, breakout] = cellButtons();

    fireEvent.keyDown(trend!, { key: "Enter" });
    fireEvent.click(trend!);
    expect(trend!.getAttribute("aria-pressed")).toBe("true");
    expect(drawerText()).toContain("trend rationale UP");

    fireEvent.keyDown(breakout!, { key: " " });
    fireEvent.click(breakout!);
    expect(breakout!.getAttribute("aria-pressed")).toBe("true");
    expect(drawerText()).toContain("breakout rationale DOWN");
  });

  it("at most one drawer is open and one cell is pressed", () => {
    setup();
    const buttons = cellButtons();
    fireEvent.click(buttons[0]!);
    fireEvent.click(buttons[1]!);
    expect(screen.getAllByTestId("rationale-drawer-content")).toHaveLength(1);
    expect(buttons.filter((b) => b.getAttribute("aria-pressed") === "true")).toHaveLength(1);
    expect(drawerText()).not.toContain("trend rationale");
  });

  it("re-activating the pinned cell hides the drawer", () => {
    setup();
    const [trend] = cellButtons();
    fireEvent.click(trend!);
    fireEvent.click(trend!);
    expect(screen.queryByTestId("rationale-drawer-content")).toBeNull();
    expect(trend!.getAttribute("aria-pressed")).toBe("false");
  });

  it("Escape on a cell dismisses the drawer", () => {
    setup();
    const [trend] = cellButtons();
    fireEvent.click(trend!);
    fireEvent.keyDown(trend!, { key: "Escape" });
    expect(screen.queryByTestId("rationale-drawer-content")).toBeNull();
    expect(trend!.getAttribute("aria-pressed")).toBe("false");
  });

  it("the Dismiss control closes the drawer", () => {
    setup();
    fireEvent.click(cellButtons()[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByTestId("rationale-drawer-content")).toBeNull();
  });
});

describe("PairConfluenceMatrix — honest presentation when unvalidated", () => {
  it("uses the neutral treatment while unvalidated, keeping text labels", () => {
    setup(false);
    const status = screen.getByTestId("confluence-status");
    expect(status.getAttribute("data-validated")).toBe("false");
    expect(status.textContent).toBe("Aligned up");
    expect(screen.getByTestId("confluence-score").textContent).toBe("0.72");
    const neutralColour = status.style.color;

    cleanup();
    setup(true);
    const validatedStatus = screen.getByTestId("confluence-status");
    expect(validatedStatus.getAttribute("data-validated")).toBe("true");
    expect(validatedStatus.style.color).not.toBe(neutralColour);
  });

  it("renders a no-data message when the row is null", () => {
    render(<PairConfluenceMatrix row={null} columns={[]} />);
    expect(screen.getByText("No confluence data for this pair.")).toBeTruthy();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});
