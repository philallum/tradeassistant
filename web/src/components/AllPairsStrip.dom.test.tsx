// @vitest-environment jsdom
//
// AllPairsStrip DOM tests: the single pair navigator, showing conviction tier + vote tally.
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
  return {
    pair,
    hasData: true,
    label: "Lean up",
    tier: "LEAN",
    glyph: "\u25B2",
    tallyText: "2 up \u00B7 0 down \u00B7 3 flat",
    ...over,
  };
}

const STRIP: AllPairsStripVM = {
  entries: PAIRS.map((p) => {
    if (p === "USDCHF") {
      return entry(p, { hasData: false, label: "", tier: "none", glyph: "\u2205", tallyText: "No signal" });
    }
    if (p === "GBPUSD") {
      return entry(p, { label: "Split", tier: "SPLIT", glyph: "\u21C5", tallyText: "1 up \u00B7 1 down \u00B7 3 flat" });
    }
    return entry(p);
  }),
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
  it("renders exactly five entries as buttons: the only pair navigation", () => {
    setup();
    expect(screen.getAllByRole("button")).toHaveLength(5);
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });

  it("shows the conviction tier and the vote tally, never the retired 'Neutral' label", () => {
    setup();
    expect(btn("EURUSD").textContent).toContain("Lean up");
    expect(btn("EURUSD").textContent).toContain("2 up \u00B7 0 down \u00B7 3 flat");
    expect(btn("GBPUSD").textContent).toContain("Split");
    expect(btn("GBPUSD").getAttribute("aria-label")).toContain("1 up \u00B7 1 down \u00B7 3 flat");
    expect(document.body.textContent).not.toMatch(/neutral/i);
  });

  it("calls onSelectPair on click", () => {
    const onSelect = setup();
    fireEvent.click(btn("GBPUSD"));
    expect(onSelect).toHaveBeenCalledWith("GBPUSD");
  });

  it("activates on Enter and Space (keyDown then click models a native button)", () => {
    const onSelect = setup();
    for (const key of ["Enter", " "]) {
      const b = btn("USDJPY");
      fireEvent.keyDown(b, { key });
      fireEvent.click(b);
    }
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onSelect).toHaveBeenCalledWith("USDJPY");
  });

  it("indicates the selected pair via aria-pressed and a text cue", () => {
    setup("GBPUSD");
    expect(btn("GBPUSD").getAttribute("aria-pressed")).toBe("true");
    expect(btn("GBPUSD").textContent).toContain("Selected");
    expect(btn("EURUSD").getAttribute("aria-pressed")).toBe("false");
    expect(btn("EURUSD").textContent).not.toContain("Selected");
  });

  it("shows a no-data marker for a pair without data", () => {
    setup();
    const b = btn("USDCHF");
    expect(b.getAttribute("data-has-data")).toBe("false");
    expect(b.textContent).toContain("No signal");
    expect(btn("EURUSD").getAttribute("data-has-data")).toBe("true");
  });

  it("makes every control keyboard focusable", () => {
    setup();
    for (const b of screen.getAllByRole("button")) {
      expect(b.tabIndex).toBeGreaterThanOrEqual(0);
      b.focus();
      expect(document.activeElement).toBe(b);
    }
  });
});
