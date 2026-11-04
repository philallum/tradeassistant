// @vitest-environment jsdom
//
// Single-window dashboard — no-signal state DOM tests (task 5.2).
// The VerdictBanner (null vm) and the AllPairsStrip no-data entry must both render the
// shared constants from pure/noSignalCopy.ts, so changing a constant changes the UI.
//
// Validates: Requirements 3.6, 4.8, 9.6

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PAIRS } from "../api/types";
import { NO_SIGNAL_TEXT, PAIR_DID_NOT_FIRE_LABEL } from "../pure/noSignalCopy";
import type { ConfluenceViewModel, RowVM } from "../pure/shapeConfluence";
import { shapeAllPairsStrip } from "../pure/shapeAllPairsStrip";
import { AllPairsStrip } from "./AllPairsStrip";
import { VerdictBanner } from "./VerdictBanner";

afterEach(() => {
  cleanup();
  vi.doUnmock("../pure/noSignalCopy");
  vi.resetModules();
});

function row(pair: RowVM["pair"]): RowVM {
  return {
    pair,
    scoreText: "+2",
    score: 0.6,
    gauge: { min: -1, max: 1, value: 0.6, posThreshold: 0.5, negThreshold: -0.5 },
    status: "ALIGNED_UP",
    statusLabel: "Bullish",
    marker: "green",
    markerText: "up",
    stayFlat: false,
    conflictSummary: null,
    cells: [],
  };
}

/** Confluence view model with a row for every pair except USDCHF. */
const CONFLUENCE: ConfluenceViewModel = {
  empty: false,
  emptyText: "",
  validationLabel: "",
  validated: false,
  strengthNote: "",
  summary: { aligned: 4, conflict: 0, neutral: 0, text: "" },
  columns: [],
  rows: PAIRS.filter((p) => p !== "USDCHF").map(row),
};

describe("no-signal state", () => {
  it("VerdictBanner with a null vm shows the constant and no direction/confidence/pips (Req 3.6, 9.6)", () => {
    const { container } = render(<VerdictBanner vm={null} pair="USDCHF" />);
    expect(screen.getByTestId("verdict-no-signal").textContent).toBe(PAIR_DID_NOT_FIRE_LABEL);
    expect(screen.queryByTestId("verdict-direction")).toBeNull();
    expect(screen.queryByTestId("verdict-confidence")).toBeNull();
    expect(screen.queryByTestId("verdict-stop-loss")).toBeNull();
    expect(screen.queryByTestId("verdict-take-profit")).toBeNull();
    expect(screen.queryByTestId("verdict-net-expectancy")).toBeNull();
    expect(screen.queryByTestId("validation-badge")).toBeNull();
    expect(container.textContent).not.toMatch(/pips|%/);
  });

  it("AllPairsStrip entry for a missing pair shows NO_SIGNAL_TEXT (Req 4.8, 9.6)", () => {
    const strip = shapeAllPairsStrip(CONFLUENCE);
    render(<AllPairsStrip strip={strip} selectedPair="EURUSD" onSelectPair={() => undefined} />);
    const b = screen.getByRole("button", { name: /^USDCHF:/ });
    expect(b.getAttribute("data-has-data")).toBe("false");
    expect(b.textContent).toContain(NO_SIGNAL_TEXT);
    expect(b.getAttribute("aria-label")).toContain(NO_SIGNAL_TEXT);
  });

  it("changing the constants changes both the banner and the strip entry", async () => {
    const NEW_NO_SIGNAL = `${NO_SIGNAL_TEXT} (changed)`;
    const NEW_LABEL = `${PAIR_DID_NOT_FIRE_LABEL} (changed)`;
    vi.resetModules();
    vi.doMock("../pure/noSignalCopy", () => ({
      NO_SIGNAL_TEXT: NEW_NO_SIGNAL,
      PAIR_DID_NOT_FIRE_LABEL: NEW_LABEL,
    }));
    // Re-import everything (including React and testing-library) from the fresh module
    // registry so a single React instance is shared.
    const rtl = await import("@testing-library/react");
    const { VerdictBanner: Banner } = await import("./VerdictBanner");
    const { AllPairsStrip: Strip } = await import("./AllPairsStrip");
    const { shapeAllPairsStrip: shape } = await import("../pure/shapeAllPairsStrip");

    rtl.render(<Banner vm={null} />);
    expect(rtl.screen.getByTestId("verdict-no-signal").textContent).toBe(NEW_LABEL);
    rtl.cleanup();

    rtl.render(<Strip strip={shape(CONFLUENCE)} selectedPair="EURUSD" onSelectPair={() => undefined} />);
    const b = rtl.screen.getByRole("button", { name: /^USDCHF:/ });
    expect(b.textContent).toContain(NEW_NO_SIGNAL);
    rtl.cleanup();
  });
});
