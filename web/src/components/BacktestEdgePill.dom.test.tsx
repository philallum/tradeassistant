// @vitest-environment jsdom
//
// Single-window dashboard — BacktestEdgePill DOM tests (task 2.6).
//
// Validates: Requirements 8.5, 8.6

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { NO_SIGNAL_TEXT } from "../pure/noSignalCopy";
import { BACKTEST_EDGE_LABEL, BacktestEdgePill } from "./BacktestEdgePill";

afterEach(() => {
  cleanup();
});

describe("BacktestEdgePill", () => {
  it("shows the shaper's edge text verbatim when available (Req 8.5)", () => {
    render(<BacktestEdgePill vm={{ available: true, edgeText: "+3.2 pp" }} />);
    expect(screen.getByText(BACKTEST_EDGE_LABEL)).toBeTruthy();
    expect(screen.getByTestId("backtest-edge-value").textContent).toBe("+3.2 pp");
    expect(screen.getByTestId("backtest-edge-pill").getAttribute("data-available")).toBe("true");
  });

  it("shows the explicit no-signal marker, not a number, when unavailable (Req 8.6)", () => {
    render(<BacktestEdgePill vm={{ available: false, edgeText: "" }} />);
    const value = screen.getByTestId("backtest-edge-value");
    expect(value.textContent).toBe(NO_SIGNAL_TEXT);
    expect(value.textContent).not.toMatch(/\d/);
    expect(screen.getByTestId("backtest-edge-pill").getAttribute("data-available")).toBe("false");
  });
});
