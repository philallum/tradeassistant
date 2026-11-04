// @vitest-environment jsdom
//
// Single-window dashboard — VerdictBanner DOM tests (task 2.6).
//
// Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.9, 3.10, 12.7

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { Direction } from "../api/types";
import { NOT_ACTIONABLE } from "../pure/format";
import type { SetupTradeVM } from "../pure/shapeSetupTrades";
import { directionGlyph } from "../tabs/Setups/FiringCard";
import { UNVALIDATED_BADGE_TEXT, VALIDATED_BADGE_TEXT, VerdictBanner } from "./VerdictBanner";

afterEach(() => {
  cleanup();
});

function makeVM(
  over: {
    direction?: Direction;
    anyUnvalidated?: boolean;
    sl?: number | null;
    tp?: number | null;
    expectancy?: number | null;
    validated?: boolean;
    entry?: string | null;
  } = {},
): SetupTradeVM {
  const validated = over.validated ?? true;
  return {
    pair: "EURUSD",
    strategyId: "s1",
    forecast: {
      label: "FORECAST",
      direction: over.direction ?? "UP",
      horizon: 1,
      confidence: { value: 0.64, validated },
      analogueCount: 10,
      historicalAgreement: 0.6,
    },
    trade: {
      label: "TRADE",
      entryAssumption: over.entry === undefined ? "Next open" : over.entry,
      stopLossPips: { value: over.sl === undefined ? 25 : over.sl, validated },
      takeProfitPips: { value: over.tp === undefined ? 40 : over.tp, validated },
      horizonExpiry: "2026-09-17",
      netExpectancyPips: {
        value: over.expectancy === undefined ? 3 : over.expectancy,
        validated,
      },
    },
    anyUnvalidated: over.anyUnvalidated ?? !validated,
  };
}

const text = (id: string): string => screen.getByTestId(id).textContent ?? "";

describe("VerdictBanner", () => {
  it("renders one example per field (Req 3.1-3.6)", () => {
    render(<VerdictBanner vm={makeVM()} />);
    expect(text("verdict-direction")).toContain("Up");
    expect(text("verdict-confidence")).toBe("64%");
    expect(text("verdict-entry")).toBe("Next open");
    expect(text("verdict-stop-loss")).toBe("25 pips");
    expect(text("verdict-take-profit")).toBe("40 pips");
    expect(text("verdict-net-expectancy")).toBe("3 pips");
    expect(text("validation-badge")).toBe(VALIDATED_BADGE_TEXT);
  });

  it("distinguishes UP / DOWN / FLAT by text and glyph, not colour (Req 3.7, 12.7)", () => {
    const seen: { label: string; glyph: string }[] = [];
    for (const direction of ["UP", "DOWN", "FLAT"] as const) {
      const { unmount } = render(<VerdictBanner vm={makeVM({ direction })} />);
      const glyph = text("verdict-direction-glyph");
      expect(glyph).toBe(directionGlyph(direction));
      seen.push({ label: text("verdict-direction"), glyph });
      unmount();
    }
    expect(new Set(seen.map((s) => s.label)).size).toBe(3);
    expect(new Set(seen.map((s) => s.glyph)).size).toBe(3);
    expect(seen[0]!.label).toContain("Up");
    expect(seen[1]!.label).toContain("Down");
    expect(seen[2]!.label).toContain("Flat");
  });

  it("shows the un-validated badge at the same font size as numeric values (Req 3.9)", () => {
    render(<VerdictBanner vm={makeVM({ validated: false })} />);
    const badge = screen.getByTestId("validation-badge");
    expect(badge.textContent).toBe(UNVALIDATED_BADGE_TEXT);
    expect(badge.style.fontSize).toBe(screen.getByTestId("verdict-stop-loss").style.fontSize);
    expect(badge.style.fontSize).toBe(screen.getByTestId("verdict-confidence").style.fontSize);
  });

  it("marks un-validated fields and keeps that distinct from the not-available marker (Req 3.9)", () => {
    render(<VerdictBanner vm={makeVM({ validated: false, sl: null })} />);
    const sl = screen.getByTestId("verdict-stop-loss");
    const tp = screen.getByTestId("verdict-take-profit");
    // Not-available: dash only, no un-validated marker text.
    expect(sl.textContent).toContain(NOT_ACTIONABLE);
    // Un-validated numeric value: carries the "(un-validated)" marker.
    expect(tp.textContent).toContain("40 pips");
    expect(tp.textContent).toContain("un-validated");
    expect(NOT_ACTIONABLE).not.toMatch(/un-validated/);
    expect(tp.textContent).not.toContain(NOT_ACTIONABLE);
  });

  it("renders no button elements (Req 3.10)", () => {
    const { container } = render(<VerdictBanner vm={makeVM({ validated: false })} />);
    expect(container.querySelectorAll("button, [role='button']")).toHaveLength(0);
  });
});
