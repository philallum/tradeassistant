import { describe, expect, it } from "vitest";

import { InMemoryPatternVectorStore } from "../encoder/index.js";
import type { Candle } from "../guard/types.js";
import { InMemoryCandleStore, type Pair } from "../ingestion/index.js";
import {
  InMemoryAnalogueStore,
  type AnalogueRecord,
  type AnalogueStore,
} from "../retrieval/index.js";
import { evaluatePair } from "./dailyPipeline.js";
import { DEFAULT_PIPELINE_CONFIG, type PipelineDeps } from "./types.js";

// The expected-candle-size forecast is DISPLAY-ONLY and fail-safe: a store error degrades it to
// "no forecast". That degradation must be REPORTED (via the injected `onWarn`) so it is not
// indistinguishable from "too little history", and reporting must never change the evaluation.

const PAIR: Pair = "EURUSD";
const DECISION_DATE = "2023-06-01";

function candles(count: number): Candle[] {
  const out: Candle[] = [];
  let close = 1.1;
  for (let i = 0; i < count; i += 1) {
    const d = new Date(Date.UTC(2023, 0, 2 + i));
    const prev = close;
    close += 0.0007;
    out.push({
      asset: PAIR,
      date: d.toISOString().slice(0, 10),
      open: prev,
      high: close + 0.0008,
      low: prev - 0.0008,
      close,
    });
  }
  return out;
}

/** An AnalogueStore whose matured-outcome read succeeds the first N times, then fails. */
class FailsAfterStore implements AnalogueStore {
  private readonly inner = new InMemoryAnalogueStore();
  calls = 0;

  constructor(private readonly succeedFor: number) {}

  upsertOutcome(record: AnalogueRecord): Promise<void> {
    return this.inner.upsertOutcome(record);
  }

  getMaturedOutcomes(asset: Pair, beforeDate: string): Promise<readonly AnalogueRecord[]> {
    this.calls += 1;
    if (this.calls > this.succeedFor) {
      return Promise.reject(new Error("store unavailable"));
    }
    return this.inner.getMaturedOutcomes(asset, beforeDate);
  }

  getOutcomes(asset: Pair, decisionDate: string): Promise<readonly AnalogueRecord[]> {
    return this.inner.getOutcomes(asset, decisionDate);
  }
}

async function deps(
  succeedFor: number,
  onWarn?: PipelineDeps["onWarn"],
): Promise<PipelineDeps & { analogueStore: FailsAfterStore }> {
  const candleStore = new InMemoryCandleStore();
  await candleStore.upsertCandles(candles(45));
  return {
    candleStore,
    vectorStore: new InMemoryPatternVectorStore(),
    analogueStore: new FailsAfterStore(succeedFor),
    ...(onWarn !== undefined ? { onWarn } : {}),
  };
}

describe("expected-range failure is reported, not silent", () => {
  it("reports the degraded step via onWarn when the forecast read fails", async () => {
    const notices: Array<{ step: string; pair: Pair; message: string }> = [];
    // retrieve() reads matured outcomes once (succeeds); the forecast read is the 2nd and fails.
    const d = await deps(1, (step, pair, err) => {
      notices.push({ step, pair, message: err instanceof Error ? err.message : String(err) });
    });

    const evaluation = await evaluatePair(PAIR, DECISION_DATE, d, DEFAULT_PIPELINE_CONFIG);

    expect(notices).toEqual([{ step: "expected_range", pair: PAIR, message: "store unavailable" }]);
    expect("expectedRange" in evaluation).toBe(false); // degraded to "no forecast"
  });

  it("reporting never changes the evaluation (observer-only)", async () => {
    const withObserver = await evaluatePair(
      PAIR,
      DECISION_DATE,
      await deps(1, () => {}),
      DEFAULT_PIPELINE_CONFIG,
    );
    const withoutObserver = await evaluatePair(
      PAIR,
      DECISION_DATE,
      await deps(1),
      DEFAULT_PIPELINE_CONFIG,
    );

    expect(withObserver).toStrictEqual(withoutObserver);
  });

  it("emits nothing when the forecast read succeeds", async () => {
    const notices: string[] = [];
    const d = await deps(Number.POSITIVE_INFINITY, (step) => {
      notices.push(step);
    });

    await evaluatePair(PAIR, DECISION_DATE, d, DEFAULT_PIPELINE_CONFIG);

    expect(notices).toEqual([]);
  });
});
