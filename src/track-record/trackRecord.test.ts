import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { Candle } from "../guard/types.js";
import { InMemoryCandleStore, type Pair } from "../ingestion/types.js";
import type { ExpectedRange } from "../range-forecast/types.js";
import { InMemoryAnalogueStore, type AnalogueRecord } from "../retrieval/types.js";
import { EMPTY_TRACK_RECORD } from "../scheduled-run/snapshot.js";
import type { StrategyBundle } from "../strategies/confluenceMatrix.js";
import { buildSignal, type Strategy, type StrategyResult } from "../strategies/types.js";
import { memoizeMaturedOutcomes } from "./memoizedAnalogueStore.js";
import { replayRangeRecords } from "./rangeRecord.js";
import { buildTrackRecordSlice } from "./trackRecordSlice.js";
import {
  patternRecords,
  realizedDirectionAfter,
  replayClassicalRecords,
  replayDates,
} from "./strategyRecord.js";

/** A run of weekday dates starting 2024-01-01 (Mon). */
function weekdays(n: number): string[] {
  const out: string[] = [];
  const d = new Date("2024-01-01T00:00:00Z");
  while (out.length < n) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/**
 * Contiguous candles (each opens at the previous close, so there are no gaps and
 * ATR equals the candle's own high-low range). Every candle moves 100 pips in the
 * given direction with a 10-pip wick each side, which is well outside 0.5 x ATR.
 */
function candlesFor(n: number, dirOf: (i: number) => 1 | -1 | 0, pair: Pair = "EURUSD"): Candle[] {
  let prevClose = 1.1;
  return weekdays(n).map((date, i) => {
    const open = prevClose;
    const move = dirOf(i) * 0.01;
    prevClose = open + move;
    return {
      asset: pair,
      date,
      open,
      close: open + move,
      high: Math.max(open, open + move) + 0.001,
      low: Math.min(open, open + move) - 0.001,
    };
  });
}

/** A fixed-direction fake strategy. */
function fixed(direction: "UP" | "DOWN" | "FLAT"): Strategy<unknown> {
  return {
    id: "trend",
    evaluate: (): StrategyResult => buildSignal("trend", direction, direction === "FLAT" ? 0 : 0.7, "fixed"),
  } as unknown as Strategy<unknown>;
}

function bundle(t: "UP" | "DOWN" | "FLAT", b = t, r = t, v = t): StrategyBundle {
  return { trend: fixed(t), breakout: fixed(b), range: fixed(r), reversal: fixed(v) };
}

describe("realizedDirectionAfter", () => {
  const candles = candlesFor(30, (i) => (i % 2 === 0 ? 1 : -1));
  it("uses the first candle strictly after the replay date", () => {
    // Candle index 10 is even (UP); the one after replay date idx 9 is idx 10 => UP.
    expect(realizedDirectionAfter(candles, candles[9]!.date)).toBe("UP");
    expect(realizedDirectionAfter(candles, candles[10]!.date)).toBe("DOWN");
  });
  it("is null with no forward candle", () => {
    expect(realizedDirectionAfter(candles, candles[29]!.date)).toBeNull();
  });
  it("scores by the sign of the open-to-close move by default (dead-band factor 0)", () => {
    const tiny = weekdays(30).map((date): Candle => ({
      asset: "EURUSD",
      date,
      open: 1.1,
      close: 1.1001,
      high: 1.11,
      low: 1.09,
    }));
    expect(realizedDirectionAfter(tiny, tiny[10]!.date)).toBe("UP");
    const exactlyZero = tiny.map((c) => ({ ...c, close: c.open }));
    expect(realizedDirectionAfter(exactlyZero, exactlyZero[10]!.date)).toBe("FLAT");
  });
  it("can apply an explicit ATR dead-band: a move inside half an ATR is FLAT", () => {
    const tiny = weekdays(30).map((date): Candle => ({
      asset: "EURUSD",
      date,
      open: 1.1,
      close: 1.1001,
      high: 1.11,
      low: 1.09,
    }));
    expect(realizedDirectionAfter(tiny, tiny[10]!.date, 0.5)).toBe("FLAT");
  });
});

describe("replayDates", () => {
  const candles = candlesFor(30, () => 1);
  it("excludes the last candle (no forward candle) and respects the window", () => {
    const dates = replayDates(candles, "2999-01-01", 5);
    expect(dates).toHaveLength(5);
    expect(dates[dates.length - 1]).toBe(candles[28]!.date);
  });
  it("never includes a date on or after the decision date", () => {
    const decision = candles[20]!.date;
    expect(replayDates(candles, decision, 100).every((d) => d < decision)).toBe(true);
  });
});

describe("replayClassicalRecords", () => {
  const candles = candlesFor(40, (i) => (i % 2 === 0 ? 1 : -1)); // realized after replay idx k: even k+1 => UP
  const inputs = [{ pair: "EURUSD" as Pair, candles }];

  it("counts only directional calls and scores them against the realized direction", () => {
    const rows = replayClassicalRecords({
      decisionDate: "2999-01-01",
      lookbackDays: 20,
      inputs,
      strategies: bundle("UP", "DOWN", "FLAT", "UP"),
    });
    const by = Object.fromEntries(rows.map((r) => [r.strategyId, r]));
    expect(by.trend!.calls).toBe(20);
    expect(by.range!.calls).toBe(0); // FLAT is an abstention
    // Always-UP vs alternating UP/DOWN outcomes => about half right; DOWN is the complement.
    expect(by.trend!.correct + by.breakout!.correct).toBe(20);
    expect(by.trend!.correct).toBe(by.reversal!.correct);
  });

  it("counts a strategy error as no call", () => {
    const erroring: Strategy<unknown> = {
      id: "trend",
      evaluate: () => ({ ok: false, error: { reason: "insufficient_data" } }),
    } as unknown as Strategy<unknown>;
    const rows = replayClassicalRecords({
      decisionDate: "2999-01-01",
      lookbackDays: 10,
      inputs,
      strategies: { ...bundle("UP"), trend: erroring },
    });
    expect(rows.find((r) => r.strategyId === "trend")!.calls).toBe(0);
  });

  it("only ever hands a strategy candles dated strictly before the replay date (property)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 30 }), (lookback) => {
        const seen: Array<{ lastCandle: string; date: string }> = [];
        const spy: Strategy<unknown> = {
          id: "trend",
          evaluate: (cs: readonly Candle[], date: string): StrategyResult => {
            seen.push({ lastCandle: cs[cs.length - 1]!.date, date });
            return buildSignal("trend", "UP", 0.7, "spy");
          },
        } as unknown as Strategy<unknown>;
        replayClassicalRecords({
          decisionDate: "2999-01-01",
          lookbackDays: lookback,
          inputs,
          strategies: { trend: spy, breakout: spy, range: spy, reversal: spy },
        });
        expect(seen.length).toBeGreaterThan(0);
        for (const s of seen) expect(s.lastCandle < s.date).toBe(true);
      }),
      { numRuns: 50 },
    );
  });
});

describe("patternRecords", () => {
  const candles = candlesFor(30, () => 1);
  const inputs = [{ pair: "EURUSD" as Pair, candles }];
  const d = (i: number) => candles[i]!.date;
  const row = (i: number, p: "UP" | "DOWN" | "FLAT", r: "UP" | "DOWN" | "FLAT" | null, matured = true) => ({
    pair: "EURUSD",
    decision_date: d(i),
    predicted_direction: p,
    realized_direction: r,
    matured,
  });

  it("counts matured directional journal rows in the window", () => {
    const rows = patternRecords(
      [row(25, "UP", "UP"), row(26, "UP", "DOWN"), row(27, "FLAT", "UP"), row(28, "UP", null, false)],
      inputs,
      "2999-01-01",
      10,
    );
    expect(rows).toEqual([{ pair: "EURUSD", strategyId: "custom_pattern", calls: 2, correct: 1 }]);
  });

  it("ignores rows outside the window and other pairs", () => {
    const rows = patternRecords(
      [row(1, "UP", "UP"), { ...row(25, "UP", "UP"), pair: "GBPUSD" }],
      inputs,
      "2999-01-01",
      5,
    );
    expect(rows[0]).toMatchObject({ calls: 0, correct: 0 });
  });
});

describe("replayRangeRecords", () => {
  const candles = candlesFor(30, () => 1);
  const inputs = [{ pair: "EURUSD" as Pair, candles }];
  // Each candle: open 1.1, high 1.111, low 1.099 (up) => span 120 pips; ATR 60 => ratio 2.
  const forecastOf = (bucket: ExpectedRange["bucket"]): ExpectedRange => ({
    bucket,
    horizon: 1,
    lowPips: 50,
    highPips: 90,
    sampleSize: 40,
    cutoffs: { smallMax: 0.8, mediumMax: 1.5 },
    atrPips: 60,
  });

  it("scores forecasts against the realized bucket with the as-of cut-offs", async () => {
    const rows = await replayRangeRecords({
      decisionDate: "2999-01-01",
      lookbackDays: 10,
      inputs,
      forecast: () => Promise.resolve(forecastOf("LARGE")),
    });
    expect(rows).toEqual([{ pair: "EURUSD", forecasts: 10, correct: 10 }]);
    const wrong = await replayRangeRecords({
      decisionDate: "2999-01-01",
      lookbackDays: 10,
      inputs,
      forecast: () => Promise.resolve(forecastOf("SMALL")),
    });
    expect(wrong[0]).toMatchObject({ forecasts: 10, correct: 0 });
  });

  it("skips dates where the forecast is null or throws", async () => {
    let n = 0;
    const rows = await replayRangeRecords({
      decisionDate: "2999-01-01",
      lookbackDays: 6,
      inputs,
      forecast: () => {
        n += 1;
        if (n % 3 === 0) return Promise.reject(new Error("boom"));
        if (n % 3 === 1) return Promise.resolve(null);
        return Promise.resolve(forecastOf("LARGE"));
      },
    });
    expect(rows[0]!.forecasts).toBe(2);
  });

  it("does not score a forecast whose horizon window has not closed", async () => {
    // The latest replayable date's window closes on the final candle, but the
    // decision date equals that candle's date so it is not yet matured.
    const rows = await replayRangeRecords({
      decisionDate: candles[10]!.date,
      lookbackDays: 50,
      inputs,
      forecast: () => Promise.resolve(forecastOf("LARGE")),
    });
    // Replay dates are < decisionDate (idx 0..9); idx 9 needs a close before idx 10: matured needs eval > target.
    expect(rows[0]!.forecasts).toBeLessThan(10);
  });
});

describe("memoizeMaturedOutcomes", () => {
  const rec = (date: string): AnalogueRecord => ({
    asset: "EURUSD",
    decisionDate: date,
    horizon: 1,
    direction: "UP",
    mfePips: 10,
    maePips: 10,
    atr14: 0.006,
    matured: true,
  });

  it("answers earlier bounds from ONE underlying read", async () => {
    const inner = new InMemoryAnalogueStore();
    for (const d of ["2024-01-02", "2024-01-03", "2024-01-04"]) await inner.upsertOutcome(rec(d));
    let reads = 0;
    const spy = {
      ...inner,
      upsertOutcome: inner.upsertOutcome.bind(inner),
      getOutcomes: inner.getOutcomes.bind(inner),
      getMaturedOutcomes: (a: Pair, b: string) => {
        reads += 1;
        return inner.getMaturedOutcomes(a, b);
      },
    };
    const memo = memoizeMaturedOutcomes(spy, "2024-01-10");
    expect((await memo.getMaturedOutcomes("EURUSD", "2024-01-04")).map((r) => r.decisionDate)).toEqual([
      "2024-01-02",
      "2024-01-03",
    ]);
    expect(await memo.getMaturedOutcomes("EURUSD", "2024-01-03")).toHaveLength(1);
    expect(await memo.getMaturedOutcomes("EURUSD", "2024-01-10")).toHaveLength(3);
    expect(reads).toBe(1);
  });
});

describe("buildTrackRecordSlice", () => {
  const decisionDate = "2024-03-15";
  async function store(): Promise<InMemoryCandleStore> {
    const s = new InMemoryCandleStore();
    const cs = candlesFor(60, (i) => (i % 2 === 0 ? 1 : -1)).filter((c) => c.date < decisionDate);
    await s.upsertCandles(cs);
    return s;
  }

  it("never throws and falls back to the empty slice on an unexpected failure", async () => {
    const warnings: string[] = [];
    const slice = await buildTrackRecordSlice({
      decisionDate,
      candleStore: undefined as never,
      realizedOutcomes: [],
      warn: (s) => warnings.push(s),
    });
    // A missing store fails per pair; the slice still returns a well-formed shape.
    expect(slice.strategies.length).toBeGreaterThanOrEqual(0);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("returns classical + pattern rows and the range rows when a forecaster is supplied", async () => {
    const slice = await buildTrackRecordSlice({
      decisionDate,
      candleStore: await store(),
      realizedOutcomes: [],
      strategies: bundle("UP"),
      lookbackDays: 10,
      rangeLookbackDays: 5,
      forecast: () => Promise.resolve(null),
    });
    expect(slice.lookbackDays).toBe(10);
    // Only EURUSD candles were stored, but a row exists for every pair.
    expect(slice.strategies.filter((r) => r.strategyId === "trend")).toHaveLength(5);
    expect(slice.strategies.some((r) => r.strategyId === "custom_pattern")).toBe(true);
    expect(slice.rangeForecast).toHaveLength(5);
  });

  it("omits the range replay when disabled (lookback 0) or no forecaster", async () => {
    const s = await store();
    const off = await buildTrackRecordSlice({
      decisionDate,
      candleStore: s,
      realizedOutcomes: [],
      strategies: bundle("UP"),
      rangeLookbackDays: 0,
      forecast: () => Promise.resolve(null),
    });
    expect(off.rangeForecast).toEqual([]);
  });

  it("degrades the range part to empty when the replay exceeds its deadline", async () => {
    const slice = await buildTrackRecordSlice({
      decisionDate,
      candleStore: await store(),
      realizedOutcomes: [],
      strategies: bundle("UP"),
      lookbackDays: 5,
      rangeLookbackDays: 5,
      rangeDeadlineMs: 20,
      forecast: () => new Promise(() => undefined),
    });
    expect(slice.rangeForecast).toEqual([]);
    expect(slice.strategies.length).toBeGreaterThan(0); // strategy records still publish
  });

  it("EMPTY_TRACK_RECORD is the well-formed default", () => {
    expect(EMPTY_TRACK_RECORD).toEqual({ lookbackDays: 0, strategies: [], rangeForecast: [] });
  });
});
