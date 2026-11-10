import { describe, expect, it } from "vitest";
import type { FiringSetupRow } from "../api/types";
import { INVALIDATION_NOTE, shapeInvalidation } from "./shapeInvalidation";

const DATE = "2026-11-10";

function firing(over: Partial<FiringSetupRow> = {}): FiringSetupRow {
  return {
    decision_date: DATE,
    pair: "EURUSD",
    strategy_id: "system",
    direction: "UP",
    horizon: 1,
    earned_confidence: 0.571,
    stop_loss_pips: 31.5,
    take_profit_pips: 47.5,
    surfaced: true,
    suppression_reason: null,
    ...over,
  };
}

describe("shapeInvalidation", () => {
  it("states an UP thesis as a fall below the open of the session after the Decision_Date", () => {
    const vm = shapeInvalidation("EURUSD", [firing()], DATE);
    expect(vm?.pipsText).toBe("31.5");
    expect(vm?.text).toBe(
      "If price falls 31.5 pips below the open of the session after 2026-11-10 before that session closes, this pattern thesis is invalidated.",
    );
    expect(vm?.tag).toBe("unvalidated");
    expect(vm?.note).toBe(INVALIDATION_NOTE);
  });

  it("states a DOWN thesis as a rise above the open of the session after the Decision_Date", () => {
    const vm = shapeInvalidation("EURUSD", [firing({ direction: "DOWN" })], DATE);
    expect(vm?.text).toContain("rises 31.5 pips above");
  });

  it("rounds for display and drops a trailing .0", () => {
    expect(shapeInvalidation("EURUSD", [firing({ stop_loss_pips: 31.26 })], DATE)?.pipsText).toBe("31.3");
    expect(shapeInvalidation("EURUSD", [firing({ stop_loss_pips: 32.04 })], DATE)?.pipsText).toBe("32");
  });

  it("is null when there are too few analogues (null distance)", () => {
    expect(shapeInvalidation("EURUSD", [firing({ stop_loss_pips: null })], DATE)).toBeNull();
  });

  it("is null for non-positive or non-finite distances", () => {
    expect(shapeInvalidation("EURUSD", [firing({ stop_loss_pips: 0 })], DATE)).toBeNull();
    expect(shapeInvalidation("EURUSD", [firing({ stop_loss_pips: Number.NaN })], DATE)).toBeNull();
  });

  it("is null for an unsurfaced or FLAT row, another pair, or another date", () => {
    expect(shapeInvalidation("EURUSD", [firing({ surfaced: false })], DATE)).toBeNull();
    expect(shapeInvalidation("EURUSD", [firing({ direction: "FLAT" })], DATE)).toBeNull();
    expect(shapeInvalidation("GBPUSD", [firing()], DATE)).toBeNull();
    expect(shapeInvalidation("EURUSD", [firing({ decision_date: "2026-11-09" })], DATE)).toBeNull();
  });

  it("never exposes a take-profit value and does not mutate its input", () => {
    const rows = [firing()];
    const before = JSON.stringify(rows);
    const vm = shapeInvalidation("EURUSD", rows, DATE);
    expect(JSON.stringify(vm)).not.toContain("47.5");
    expect(JSON.stringify(vm)).not.toMatch(/stop.?loss|take.?profit|expectancy/i);
    expect(JSON.stringify(rows)).toBe(before);
  });
});
