import { describe, expect, it } from "vitest";

import { shapeIntradayValidation, VALIDATION_UNAVAILABLE_TEXT } from "./shapeIntradayValidation";
import type { IntradayValidation, IntradayValidationRow } from "../api/types";

// Task 8 (web): the intraday-validation shaper. Maps a slice row to the VM,
// renders "unavailable" when absent, and never recomputes.

function row(pair: string, over: Partial<IntradayValidationRow> = {}): IntradayValidationRow {
  return {
    pair,
    decisionDate: "2026-11-06",
    originalDirection: "UP",
    originalConfidence: 58,
    validationState: "SUPPORTS",
    confidenceDelta: 5,
    currentConfidence: 63,
    reason: "Current 4H candle is a directional bullish bar; this is directionally consistent with the original up forecast.",
    barOpenUtc: "2026-11-06T04:00:00.000Z",
    h4: { open: 1.0, high: 1.1, low: 0.99, currentPrice: 1.08 },
    ...over,
  };
}

function slice(rows: readonly IntradayValidationRow[], observedAt: string | null = "2026-11-06T08:00:00.000Z"): IntradayValidation {
  return { observedAt, validationLabel: "unvalidated", rows };
}

describe("shapeIntradayValidation", () => {
  it("maps an available row to the view model verbatim", () => {
    const vm = shapeIntradayValidation(slice([row("EURUSD")]), "EURUSD");
    expect(vm.status).toBe("available");
    expect(vm.stateLabel).toBe("Supports");
    expect(vm.currentConfidenceText).toBe("63%");
    expect(vm.changeText).toBe("+5pp");
    expect(vm.reason).toContain("directionally consistent");
    expect(vm.observedAt).toBe("2026-11-06T08:00:00.000Z");
    expect(vm.adjustmentLabel).toBe("unvalidated adjustment");
  });

  it("formats a negative delta with its sign and a zero delta as 0pp", () => {
    expect(
      shapeIntradayValidation(slice([row("EURUSD", { confidenceDelta: -10, validationState: "STRONGLY_CONTRADICTS" })]), "EURUSD")
        .changeText,
    ).toBe("-10pp");
    expect(
      shapeIntradayValidation(slice([row("EURUSD", { confidenceDelta: 0, validationState: "NEUTRAL" })]), "EURUSD")
        .changeText,
    ).toBe("0pp");
  });

  it("returns the explicit unavailable VM when there is no row for the pair", () => {
    const vm = shapeIntradayValidation(slice([row("EURUSD")]), "GBPUSD");
    expect(vm.status).toBe("unavailable");
    expect(vm.stateLabel).toBeNull();
    expect(vm.currentConfidenceText).toBeNull();
  });

  it("returns unavailable for an empty (pre-v8 / not-run) slice", () => {
    const vm = shapeIntradayValidation(slice([], null), "EURUSD");
    expect(vm.status).toBe("unavailable");
    expect(VALIDATION_UNAVAILABLE_TEXT.length).toBeGreaterThan(0);
  });

  it("labels every state", () => {
    const states = [
      ["STRONGLY_SUPPORTS", "Strongly supports"],
      ["SUPPORTS", "Supports"],
      ["NEUTRAL", "Neutral"],
      ["CONTRADICTS", "Contradicts"],
      ["STRONGLY_CONTRADICTS", "Strongly contradicts"],
      ["NOT_APPLICABLE", "Not applicable"],
    ] as const;
    for (const [state, label] of states) {
      const vm = shapeIntradayValidation(slice([row("EURUSD", { validationState: state })]), "EURUSD");
      expect(vm.stateLabel).toBe(label);
    }
  });
});
