// @vitest-environment jsdom
//
// Single-window dashboard — AllPairsStrip DOM tests (task 2.10).
//
// Validates: Requirements 4.1, 4.3, 4.4, 4.7, 4.8

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PAIRS } from "../api/types";
import type { Pair } from "../api/types";
import type { AllPairsStripVM, StripEntryVM } from "../pure/shapeAllPairsStrip";
import { AllPairsStrip } from "./AllPairsStrip";

afterEach(() => {
  cleanup();
});

function entry(pair: Pair, over: Partial<StripEntryVM> = {}): StripEntryVM {
  return { pair, hasData: true, statusLabel: "Bullish", marker: "green", scoreText: "+2", ...over };
}

const STRIP: AllPairsStripVM = {
  entries: PAIRS.map((p) =>
    p === "USDCHF" ? entry(p, { hasData: false, statusLabel: "", marker: "none", scoreText: "No signal" }) : entry(p),
  ),
};

function setup(selected: Pair = "EURUSD") {
  const onSelectPair = vi.fn();
  render(<AllPairsStrip strip={STRIP} selectedPair={selected} onSelectPair={onSelectPair} />);
  return onSelectPair;
}

function btn(pair: Pair): HTMLElement {
  return screen.getByRole("button", { name: new RegExp(`^${pair}:`) });
}

describe("AllPairsStrip", () => {
  it("renders five entries as buttons (Req 4.1)", () => {
    setup();
    expect(screen.getAllByRole("button")).toHaveLength(5);
  });

  it("calls onSelectPair on click (Req 4.3)", () => {
    const onSelect = setup();
    fireEvent.click(btn("GBPUSD"));
    expect(onSelect).toHaveBeenCalledWith("GBPUSD");
  });

  it("activates on Enter and Space (keyDown then click models native button) (Req 4.7)", () => {
    const onSelect = setup();
    for (const key of ["Enter", " "]) {
      const b = btn("USDJPY");
      fireEvent.keyDown(b, { key });
      fireEvent.click(b);
    }
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onSelect).toHaveBeenCalledWith("USDJPY");
  });

  it("indicates the selected pair via aria-pressed and a text cue (Req 4.4)", () => {
    setup("GBPUSD");
    expect(btn("GBPUSD").getAttribute("aria-pressed")).toBe("true");
    expect(btn("GBPUSD").textContent).toContain("Selected");
    expect(btn("EURUSD").getAttribute("aria-pressed")).toBe("false");
    expect(btn("EURUSD").textContent).not.toContain("Selected");
  });

  it("shows a no-data marker for a pair without data (Req 4.8)", () => {
    setup();
    const b = btn("USDCHF");
    expect(b.getAttribute("data-has-data")).toBe("false");
    expect(b.textContent).toContain("No signal");
    expect(btn("EURUSD").getAttribute("data-has-data")).toBe("true");
  });

  it("makes every control keyboard focusable (Req 4.7)", () => {
    setup();
    for (const b of screen.getAllByRole("button")) {
      expect(b.tabIndex).toBeGreaterThanOrEqual(0);
      b.focus();
      expect(document.activeElement).toBe(b);
    }
  });
});
