import { describe, expect, it } from "vitest";

import type { AnalogueOutcomeRow } from "../api/types";
import { shapeEvidence } from "./shapeEvidence";

const row = (over: Partial<AnalogueOutcomeRow>): AnalogueOutcomeRow => ({
  asset: "EURUSD",
  decision_date: "2024-01-02",
  horizon: 1,
  direction: "UP",
  mfe_pips: 40,
  mae_pips: 20,
  matured: true,
  ...over,
});

describe("shapeEvidence", () => {
  it("is the pair's own base rate at the horizon, from matured rows only", () => {
    const vm = shapeEvidence({
      pair: "EURUSD",
      horizon: 1,
      analogueOutcomes: [
        row({ direction: "UP" }),
        row({ direction: "UP" }),
        row({ direction: "DOWN" }),
        row({ direction: "DOWN", matured: false }),
        row({ direction: "DOWN", horizon: 2 }),
        row({ direction: "DOWN", asset: "GBPUSD" }),
      ],
    });
    expect(vm.sampleCount).toBe(3);
    expect(vm.upShare).toBeCloseTo(2 / 3, 6);
    expect(vm.downShare).toBeCloseTo(1 / 3, 6);
  });

  it("has null shares (never a fabricated 0%) with no matured outcomes", () => {
    const vm = shapeEvidence({ pair: "EURUSD", horizon: 1, analogueOutcomes: [] });
    expect(vm).toMatchObject({ sampleCount: 0, upShare: null, downShare: null });
  });

  it("exposes no stop-loss, take-profit or expectancy field", () => {
    const keys = Object.keys(shapeEvidence({ pair: "EURUSD", horizon: 1, analogueOutcomes: [] }));
    expect(keys.join(",")).not.toMatch(/stop|target|profit|expectancy|ledger/i);
  });
});
