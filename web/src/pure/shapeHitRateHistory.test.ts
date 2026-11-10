import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { RealizedOutcomeRow } from "../api/types";
import { FORWARD_TEST_START, LEDGER_LIMIT, MIN_RELIABLE_N, shapeHitRateHistory } from "./shapeHitRateHistory";

function row(over: Partial<RealizedOutcomeRow> = {}): RealizedOutcomeRow {
  return {
    strategy_id: "system",
    pair: "EURUSD",
    decision_date: "2026-11-02",
    predicted_direction: "UP",
    horizon: 1,
    earned_confidence: 0.57,
    stop_loss_pips: null,
    take_profit_pips: null,
    realized_direction: "UP",
    realized_mfe_pips: 10,
    realized_mae_pips: 4,
    matured: true,
    ...over,
  };
}

describe("shapeHitRateHistory", () => {
  it("is unavailable and empty for no rows", () => {
    const vm = shapeHitRateHistory([]);
    expect(vm.available).toBe(false);
    expect(vm.overall.n).toBe(0);
    expect(vm.overall.rateText).toBe("–");
    expect(vm.byPair).toEqual([]);
    expect(vm.byBand).toEqual([]);
    expect(vm.recent).toEqual([]);
    expect(vm.caution).toBeNull();
  });

  it("counts unmatured rows as pending, never as decided", () => {
    const vm = shapeHitRateHistory([
      row({ matured: false, realized_direction: null }),
      row({ pair: "GBPUSD", matured: false, realized_direction: null }),
    ]);
    expect(vm.available).toBe(false);
    expect(vm.pending).toBe(2);
    expect(vm.overall.n).toBe(0);
  });

  it("scores right, wrong and realized-FLAT (a miss) correctly", () => {
    const vm = shapeHitRateHistory([
      row({ decision_date: "2026-11-02" }),
      row({ decision_date: "2026-11-03", realized_direction: "DOWN" }),
      row({ decision_date: "2026-11-04", realized_direction: "FLAT" }),
      row({ decision_date: "2026-11-05", predicted_direction: "DOWN", realized_direction: "DOWN" }),
    ]);
    expect(vm.overall.n).toBe(4);
    expect(vm.overall.correct).toBe(2);
    expect(vm.overall.rateText).toBe("50.0%");
    expect(vm.overall.smallSample).toBe(true);
    expect(vm.caution).toContain("Only 4 decided setups");
  });

  it("ignores FLAT predictions and collapses duplicate (pair, date) rows", () => {
    const vm = shapeHitRateHistory([
      row(),
      row(),
      row({ decision_date: "2026-11-03", predicted_direction: "FLAT", realized_direction: "FLAT" }),
    ]);
    expect(vm.overall.n).toBe(1);
  });

  it("groups by pair (sorted) and by 0.05 confidence band with correct edges", () => {
    const vm = shapeHitRateHistory([
      row({ pair: "USDJPY", earned_confidence: 0.55, decision_date: "2026-11-02" }),
      row({ pair: "EURUSD", earned_confidence: 0.5499999999, decision_date: "2026-11-03", realized_direction: "DOWN" }),
      row({ pair: "EURUSD", earned_confidence: 0.6, decision_date: "2026-11-04" }),
    ]);
    expect(vm.byPair.map((b) => b.label)).toEqual(["EURUSD", "USDJPY"]);
    expect(vm.byBand.map((b) => b.label)).toEqual(["50–55%", "55–60%", "60–65%"]);
    expect(vm.byBand.map((b) => b.n)).toEqual([1, 1, 1]);
  });

  it("lists the ledger newest first and caps it", () => {
    const rows = Array.from({ length: LEDGER_LIMIT + 5 }, (_, i) =>
      row({ decision_date: `2026-10-${String(i + 1).padStart(2, "0")}` }),
    );
    const vm = shapeHitRateHistory(rows);
    expect(vm.recent).toHaveLength(LEDGER_LIMIT);
    expect(vm.recent[0]?.decisionDate).toBe(`2026-10-${LEDGER_LIMIT + 5}`);
  });

  it("drops the small-sample caution at MIN_RELIABLE_N", () => {
    const rows = Array.from({ length: MIN_RELIABLE_N }, (_, i) =>
      row({ pair: i % 2 === 0 ? "EURUSD" : "GBPUSD", decision_date: `2026-09-${String(i + 1).padStart(2, "0")}` }),
    );
    const vm = shapeHitRateHistory(rows);
    expect(vm.overall.smallSample).toBe(false);
    expect(vm.caution).toBeNull();
  });

  it("does not mutate its input", () => {
    const rows = [row({ decision_date: "2026-11-03" }), row({ decision_date: "2026-11-02" })];
    const before = JSON.stringify(rows);
    shapeHitRateHistory(rows);
    expect(JSON.stringify(rows)).toBe(before);
  });
});

describe("shapeHitRateHistory intervals and framing", () => {
  it("carries a Wilson interval and compares it with the coin-flip line", () => {
    const rows = Array.from({ length: 40 }, (_, i) =>
      row({ decision_date: `2026-11-${String((i % 28) + 1).padStart(2, "0")}`, pair: i < 28 ? "EURUSD" : "GBPUSD", realized_direction: i % 2 === 0 ? "UP" : "DOWN" }),
    );
    const vm = shapeHitRateHistory(rows);
    expect(vm.overall.intervalText).toMatch(/^95% interval \d+%–\d+%$/);
    expect(vm.overall.versusCoinFlip).toBe("indistinguishable");
    expect(vm.readingText).toContain("not distinguishable from a coin flip");
    expect(vm.coinFlipNote).toContain("50%");
  });

  it("flags an interval that clears the coin flip, and shows nothing for no data", () => {
    const wins = Array.from({ length: 60 }, (_, i) => row({ pair: `P${i}`, decision_date: "2026-11-02" }));
    expect(shapeHitRateHistory(wins).overall.versusCoinFlip).toBe("above");
    const none = shapeHitRateHistory([]);
    expect(none.overall.versusCoinFlip).toBe("none");
    expect(none.readingText).toBeNull();
    expect(none.overall.intervalText).toBe("–");
  });

  it("states the forward-test start and keeps it equal to the backend protocol constant", () => {
    const vm = shapeHitRateHistory([]);
    expect(vm.forwardStartNote).toContain(FORWARD_TEST_START);
    const backend = readFileSync(join(__dirname, "..", "..", "..", "src", "walk-forward", "evidenceProtocol.ts"), "utf8");
    expect(backend).toContain(`FORWARD_TEST_START = "${FORWARD_TEST_START}"`);
  });
});
