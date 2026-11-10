import { describe, expect, it } from "vitest";

import { sessionWindowUtcMs } from "../ingestion/sessionAggregation.js";
import { fromPips } from "./pip.js";
import { firstTouchOrder, hourlyIntraCandleResolver, type ResolverBar } from "./hourlyResolver.js";
import { simulateTrade } from "./tradeSimulation.js";
import type { TradeProposal } from "./types.js";

const H = 3_600_000;
const bar = (i: number, high: number, low: number): ResolverBar => ({ openMs: i * H, high, low });

describe("firstTouchOrder", () => {
  const stop = 1.099;
  const target = 1.103;
  it("returns the level touched first, in time order regardless of input order", () => {
    const bars = [bar(3, 1.104, 1.1), bar(1, 1.1005, 1.0985), bar(2, 1.101, 1.1)]; // stop touched at hour 1
    expect(firstTouchOrder(bars, stop, target)).toBe("stop_first");
    expect(firstTouchOrder([bar(1, 1.1035, 1.1), bar(2, 1.1, 1.0985)], stop, target)).toBe("target_first");
  });
  it("stays unresolved when neither is touched or when one hour touches both", () => {
    expect(firstTouchOrder([bar(1, 1.101, 1.1)], stop, target)).toBeNull();
    expect(firstTouchOrder([bar(1, 1.104, 1.098)], stop, target)).toBeNull();
    expect(firstTouchOrder([], stop, target)).toBeNull();
  });
});

describe("hourlyIntraCandleResolver turns an ambiguous daily candle into a decided trade", () => {
  const proposal: TradeProposal = {
    pair: "EURUSD",
    decisionDate: "2024-03-04",
    direction: "UP",
    horizon: 1,
    entryPrice: 1.1,
    entryDate: "2024-03-05",
    stopLossPips: 20,
    takeProfitPips: 20,
  };
  const daily = [{ asset: "EURUSD", date: "2024-03-05", open: 1.1, high: 1.103, low: 1.097, close: 1.1 }];
  const { startMs } = sessionWindowUtcMs("2024-03-05");

  it("is ambiguous on daily data alone", () => {
    expect(simulateTrade(proposal, daily).kind).toBe("ambiguous");
  });

  it("resolves target_first when the hourly path rises first", () => {
    const bars: ResolverBar[] = [
      { openMs: startMs + 2 * H, high: 1.1025, low: 1.1, },
      { openMs: startMs + 5 * H, high: 1.1, low: 1.0975 },
    ];
    const out = simulateTrade(proposal, daily, hourlyIntraCandleResolver(proposal, () => bars));
    expect(out.kind).toBe("target_first");
    expect(out.grossPips).toBe(20);
  });

  it("resolves stop_first when the hourly path falls first", () => {
    const bars: ResolverBar[] = [
      { openMs: startMs + 1 * H, high: 1.1, low: 1.0975 },
      { openMs: startMs + 4 * H, high: 1.1025, low: 1.1 },
    ];
    const out = simulateTrade(proposal, daily, hourlyIntraCandleResolver(proposal, () => bars));
    expect(out.kind).toBe("stop_first");
    expect(out.grossPips).toBe(-20);
  });

  it("asks only for the session window of the candle it is resolving", () => {
    const seen: [number, number][] = [];
    simulateTrade(proposal, daily, hourlyIntraCandleResolver(proposal, (_p, from, to) => (seen.push([from, to]), [])));
    expect(seen).toEqual([[sessionWindowUtcMs("2024-03-05").startMs, sessionWindowUtcMs("2024-03-05").endMs]]);
    expect(fromPips(20, "EURUSD")).toBeCloseTo(0.002, 10);
  });
});
