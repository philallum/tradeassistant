// @vitest-environment jsdom
//
// IntradayValidationCard DOM test (Task 8). Verifies the card renders the
// validation state, the current confidence labelled as an unvalidated
// adjustment, and the change; and that it shows the explicit "unavailable"
// marker when there is no validation. The original daily forecast is rendered by
// PairSummary / the strategy cards, so this card is structurally its own
// section — confirmed via its aria-label and data-testid.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { shapeIntradayValidation } from "../pure/shapeIntradayValidation";
import type { IntradayValidation } from "../api/types";
import { IntradayValidationCard } from "./IntradayValidationCard";

afterEach(() => {
  cleanup();
});

const AVAILABLE: IntradayValidation = {
  observedAt: "2026-11-06T08:00:00.000Z",
  validationLabel: "unvalidated",
  rows: [
    {
      pair: "EURUSD",
      decisionDate: "2026-11-06",
      originalDirection: "UP",
      originalConfidence: 58,
      validationState: "SUPPORTS",
      confidenceDelta: 5,
      currentConfidence: 63,
      reason: "Current 4H candle is a directional bullish bar.",
      barOpenUtc: "2026-11-06T04:00:00.000Z",
      h4: { open: 1.0, high: 1.1, low: 0.99, currentPrice: 1.08 },
    },
  ],
};

const EMPTY: IntradayValidation = { observedAt: null, validationLabel: "unvalidated", rows: [] };

describe("IntradayValidationCard", () => {
  it("renders the validation state, current confidence (unvalidated) and change", () => {
    render(<IntradayValidationCard pair="EURUSD" vm={shapeIntradayValidation(AVAILABLE, "EURUSD")} />);
    const card = screen.getByTestId("intraday-validation");
    expect(card.getAttribute("data-status")).toBe("available");
    expect(card.getAttribute("aria-label")).toContain("EURUSD");
    expect(screen.getByTestId("intraday-state").textContent).toBe("Supports");
    expect(screen.getByTestId("intraday-current").textContent).toBe("63%");
    expect(screen.getByTestId("intraday-change").textContent).toBe("+5pp");
    // The non-probability disclaimer is present.
    expect(card.textContent).toContain("unvalidated adjustment");
    // It is a distinct section from the original forecast (its own labelled region).
    expect(card.tagName.toLowerCase()).toBe("section");
  });

  it("renders the explicit unavailable marker when there is no validation", () => {
    render(<IntradayValidationCard pair="EURUSD" vm={shapeIntradayValidation(EMPTY, "EURUSD")} />);
    const card = screen.getByTestId("intraday-validation");
    expect(card.getAttribute("data-status")).toBe("unavailable");
    expect(screen.getByTestId("intraday-unavailable").textContent).toContain("unavailable");
    expect(screen.queryByTestId("intraday-state")).toBeNull();
  });
});
