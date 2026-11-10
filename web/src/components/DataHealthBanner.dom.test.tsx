// @vitest-environment jsdom
//
// DataHealthBanner DOM test. Renders nothing when healthy; otherwise a non-blocking
// role="status" notice with the shaped text and a working dismiss control.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { DataHealthVM } from "../pure/shapeDataHealth";
import { DataHealthBanner } from "./DataHealthBanner";

afterEach(() => {
  cleanup();
});

const DELAYED: DataHealthVM = {
  message: "Data feed delayed; evaluating on the latest available session close.",
  detail: "EURUSD: latest session candle missing",
  pairs: ["EURUSD"],
  source: "provenance",
};

describe("DataHealthBanner", () => {
  it("renders nothing when health is null", () => {
    const { container } = render(<DataHealthBanner health={null} />);
    expect(container.innerHTML).toBe("");
  });

  it("shows the message and detail in a status region", () => {
    render(<DataHealthBanner health={DELAYED} />);
    const region = screen.getByRole("status");
    expect(region.textContent).toContain("Data feed delayed");
    expect(region.textContent).toContain("EURUSD: latest session candle missing");
  });

  it("can be dismissed", () => {
    render(<DataHealthBanner health={DELAYED} />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss data delay notice" }));
    expect(screen.queryByTestId("data-health-banner")).toBeNull();
  });
});
