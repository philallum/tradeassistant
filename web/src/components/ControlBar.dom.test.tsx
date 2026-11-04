// @vitest-environment jsdom
//
// Single-window dashboard — ControlBar DOM tests (task 2.12).
//
// Validates: Requirements 2.1, 2.2, 2.5, 12.1

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PAIRS } from "../api/types";
import { SelectionProvider } from "../state/selection";
import { ControlBar } from "./ControlBar";

afterEach(() => {
  cleanup();
});

function renderBar(): void {
  render(
    <SelectionProvider initialState={{ pair: "ALL", date: "2026-09-16" }}>
      <ControlBar
        dates={["2026-09-14", "2026-09-15", "2026-09-16"]}
        lastUpdated="2026-09-16T00:00:00.000Z"
        isRefreshing={false}
        onRefresh={() => undefined}
      />
    </SelectionProvider>,
  );
}

describe("ControlBar", () => {
  it("renders exactly one h1 (Req 12.1)", () => {
    renderBar();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("gives the pair selector, date selector and refresh control accessible names (Req 2.1, 2.2)", () => {
    renderBar();
    expect(screen.getByRole("combobox", { name: /Currency pair/i })).toBeTruthy();
    expect(
      screen.getByRole("combobox", { name: /Decision date \(historical browse\)/i }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /Refresh data/i })).toBeTruthy();
  });

  it("is sticky at the top of the viewport (Req 2.5)", () => {
    renderBar();
    const banner = screen.getByRole("banner");
    expect(banner.style.position).toBe("sticky");
    expect(banner.style.top).toBe("0px");
  });

  it("offers exactly the five pairs (plus the All pairs option) in the pair selector (Req 2.1)", () => {
    renderBar();
    const select = screen.getByRole("combobox", { name: /Currency pair/i });
    const values = within(select)
      .getAllByRole("option")
      .map((o) => (o as HTMLOptionElement).value);
    expect(values.filter((v) => v !== "ALL")).toEqual([...PAIRS]);
    expect(PAIRS).toHaveLength(5);
    expect(values).toHaveLength(6);
  });
});
