import { describe, expect, it } from "vitest";

import type { SignalPredictionRow } from "../../dashboard/signalScorecard.js";
import { InMemoryIntradayValidationStore } from "../../intraday-validation/store.js";
import type { IntradayValidationRecord, ValidationState } from "../../intraday-validation/types.js";
import { MIN_GROUP_DAYS, evaluateConfluenceQuestion, evaluateIntradayQuestion } from "./layerMeasurements.js";
import { runLayerMeasurements } from "./main.js";

type Dir = "UP" | "DOWN" | "FLAT";
function pred(date: string, strategyId: string, predicted: Dir, realized: Dir | null): SignalPredictionRow {
  return {
    decisionDate: date,
    pair: "EURUSD",
    strategyId,
    predictedDirection: predicted,
    realizedDirection: realized,
    correct: realized === null || predicted === "FLAT" ? null : realized === predicted,
  } as SignalPredictionRow;
}
function day(i: number): string {
  return `2026-${String(1 + Math.floor(i / 28)).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`;
}
function validation(date: string, original: Dir, state: ValidationState): Pick<IntradayValidationRecord, "decisionDate" | "pair" | "originalDirection" | "result"> {
  return { decisionDate: date, pair: "EURUSD", originalDirection: original, result: { state, confidenceDelta: 0, currentConfidence: 50, reason: "" } };
}

describe("confluence question", () => {
  it("separates aligned, opposed and all directional pattern days", () => {
    const rows: SignalPredictionRow[] = [];
    for (let i = 0; i < 40; i += 1) {
      const d = day(i);
      const aligned = i < 20;
      rows.push(pred(d, "custom_pattern", "UP", i % 2 === 0 ? "UP" : "DOWN"));
      rows.push(pred(d, "trend", aligned ? "UP" : "DOWN", null));
      rows.push(pred(d, "breakout", aligned ? "UP" : "FLAT", null));
      rows.push(pred(d, "range", aligned ? "UP" : "FLAT", null));
    }
    const r = evaluateConfluenceQuestion(rows);
    const [alone, aligned, opposed] = r.groups;
    expect(alone?.rate.n).toBe(40);
    expect(aligned?.rate.n).toBe(20);
    expect(opposed?.rate.n).toBe(20);
    expect(r.adequate).toBe(false); // 20 < MIN_GROUP_DAYS
    expect(r.summary).toContain("Not enough matured days yet");
    expect(r.summary).toContain("Approximation");
  });

  it("ignores FLAT calls, unmatured days and realised-FLAT days", () => {
    const rows = [
      pred("2026-01-01", "custom_pattern", "FLAT", "UP"),
      pred("2026-01-02", "custom_pattern", "UP", null),
      pred("2026-01-03", "custom_pattern", "UP", "FLAT"),
    ];
    expect(evaluateConfluenceQuestion(rows).groups[0]?.rate.n).toBe(0);
  });

  it("reports a difference only once both groups have enough matured days", () => {
    const rows: SignalPredictionRow[] = [];
    for (let i = 0; i < MIN_GROUP_DAYS; i += 1) {
      const d = day(i);
      rows.push(pred(d, "custom_pattern", "UP", "UP"));
      rows.push(pred(d, "trend", "UP", null), pred(d, "breakout", "UP", null));
    }
    const r = evaluateConfluenceQuestion(rows);
    expect(r.groups[1]?.rate.n).toBe(MIN_GROUP_DAYS);
    expect(r.adequate).toBe(true);
    expect(r.summary).toContain("Difference");
  });
});

describe("intraday question", () => {
  it("compares supported with contradicted days using the recorded realised outcome", () => {
    const preds: SignalPredictionRow[] = [];
    const vals: ReturnType<typeof validation>[] = [];
    for (let i = 0; i < 70; i += 1) {
      const d = day(i);
      const supports = i < 35;
      preds.push(pred(d, "custom_pattern", "UP", supports ? "UP" : "DOWN"));
      vals.push(validation(d, "UP", supports ? "SUPPORTS" : "CONTRADICTS"));
    }
    const r = evaluateIntradayQuestion(vals, preds);
    expect(r.groups[0]?.rate.rate).toBe(1);
    expect(r.groups[2]?.rate.rate).toBe(0);
    expect(r.adequate).toBe(true);
    expect(r.summary).toContain("intervals do not overlap");
  });

  it("skips not-applicable, flat and unmatured rows", () => {
    const r = evaluateIntradayQuestion(
      [validation("2026-01-01", "UP", "NOT_APPLICABLE"), validation("2026-01-02", "FLAT", "SUPPORTS"), validation("2026-01-03", "UP", "SUPPORTS")],
      [pred("2026-01-03", "custom_pattern", "UP", null)],
    );
    expect(r.groups.every((g) => g.rate.n === 0)).toBe(true);
    expect(r.adequate).toBe(false);
  });
});

describe("runLayerMeasurements", () => {
  it("is read-only and renders verdict-free lines from the two stores", async () => {
    const intradayStore = new InMemoryIntradayValidationStore();
    const writes: unknown[] = [];
    const predictionStore = {
      upsert: (r: readonly SignalPredictionRow[]) => {
        writes.push(r);
        return Promise.resolve();
      },
      getByDecisionDate: () => Promise.resolve([]),
      getOpen: () => Promise.resolve([]),
      getAll: () => Promise.resolve([pred("2026-01-01", "custom_pattern", "UP", "UP")]),
    };
    const { lines } = await runLayerMeasurements({ predictionStore, intradayStore });
    expect(writes).toEqual([]);
    expect(lines.join("\n")).not.toMatch(/PASS|CUT|KILL/);
    expect(lines.join("\n")).toContain("confluence-adds-information");
    expect(lines.join("\n")).toContain("intraday-delta-adds-information");
  });
});
