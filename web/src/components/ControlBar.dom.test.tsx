// @vitest-environment jsdom
//
// ControlBar DOM tests. The bar offers the date selector and refresh only: the All_Pairs_Strip is
// the single pair navigator, so there is NO pair dropdown or segmented control here.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SelectionProvider } from "../state/selection";
import { ControlBar } from "./ControlBar";

afterEach(() => {
  cleanup();
});

function renderBar(): void {
  render(
    <SelectionProvider initialState={{ pair: "EURUSD", date: "2026-09-16" }}>
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

  it("gives the date selector and refresh control accessible names (Req 2.2)", () => {
    renderBar();
    expect(
      screen.getByRole("combobox", { name: /Decision date \(historical browse\)/i }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /Refresh data/i })).toBeTruthy();
  });

  it("has NO pair selector: no pair dropdown, radiogroup or 'All pairs' option", () => {
    renderBar();
    expect(screen.queryByRole("combobox", { name: /Currency pair/i })).toBeNull();
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(document.body.textContent).not.toMatch(/all pairs/i);
    // The only combobox is the date selector.
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
  });

  it("is sticky at the top of the viewport (Req 2.5)", () => {
    renderBar();
    const banner = screen.getByRole("banner");
    expect(banner.style.position).toBe("sticky");
    expect(banner.style.top).toBe("0px");
  });
});
