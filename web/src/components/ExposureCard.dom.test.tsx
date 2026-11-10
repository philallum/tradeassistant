// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { shapeExposure } from "../pure/shapeExposure";
import { ExposureCard } from "./ExposureCard";

afterEach(cleanup);

describe("ExposureCard", () => {
  it("warns when three USD pairs fire together", () => {
    const vm = shapeExposure(
      {
        perCurrency: [
          { currency: "CHF", net: -1 },
          { currency: "EUR", net: -1 },
          { currency: "GBP", net: -1 },
          { currency: "USD", net: 3 },
        ],
        concentrated: true,
        strongestPair: "EURUSD",
      },
      3,
      true,
    );
    render(<ExposureCard vm={vm} />);
    const card = screen.getByTestId("exposure-card");
    expect(card.getAttribute("data-concentrated")).toBe("true");
    expect(card.textContent).toContain("3 setups, one effective currency bet");
    expect(card.textContent).toContain("Long USD x3");
    expect(screen.getByTestId("exposure-note").textContent).toContain("single bet");
  });

  it("renders nothing when there is no view model", () => {
    render(<ExposureCard vm={null} />);
    expect(screen.queryByTestId("exposure-card")).toBeNull();
  });
});
