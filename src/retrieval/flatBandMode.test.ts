import { describe, expect, it } from "vitest";

import type { Candle } from "../guard/types.js";
import { resolve } from "./resolver.js";
import { InMemoryAnalogueStore } from "./types.js";

/** Next session moves open 1.1000 -> close 1.1010 (+10 pips); ATR 0.0100 (= 100 pips). */
const forward: Candle[] = [
  { asset: "EURUSD", date: "2024-01-03", open: 1.1, high: 1.102, low: 1.099, close: 1.101 },
  { asset: "EURUSD", date: "2024-01-04", open: 1.101, high: 1.103, low: 1.1, close: 1.102 },
  { asset: "EURUSD", date: "2024-01-05", open: 1.102, high: 1.104, low: 1.101, close: 1.103 },
];
const ATR_PRICE = 0.01;

async function directions(options?: Parameters<typeof resolve>[6]): Promise<string[]> {
  const store = new InMemoryAnalogueStore();
  const out = await resolve("2024-01-02", "EURUSD", forward, ATR_PRICE, "2024-02-01", store, options);
  return [out.perHorizon[1].direction, out.perHorizon[2].direction, out.perHorizon[3].direction];
}

describe("resolver FLAT band mode", () => {
  it("default and explicit legacy are identical (live behaviour unchanged)", async () => {
    const omitted = await directions();
    expect(await directions({ flatBandMode: "legacy" })).toEqual(omitted);
    // Legacy compares pips with a price-unit band (~0.005): a +10 pip move is UP.
    expect(omitted).toEqual(["UP", "UP", "UP"]);
  });

  it("atr_pips converts the ATR to pips: +10 pips inside a 50-pip band is FLAT", async () => {
    expect((await directions({ flatBandMode: "atr_pips" }))[0]).toBe("FLAT");
  });

  it("atr_pips still classifies a move larger than the band by sign", async () => {
    const big: Candle[] = [
      { asset: "EURUSD", date: "2024-01-03", open: 1.1, high: 1.11, low: 1.099, close: 1.108 },
    ];
    const store = new InMemoryAnalogueStore();
    const out = await resolve("2024-01-02", "EURUSD", big, ATR_PRICE, "2024-02-01", store, {
      flatBandMode: "atr_pips",
    });
    expect(out.perHorizon[1].direction).toBe("UP"); // +80 pips > 50-pip band
  });

  it("handles JPY pairs with their 0.01 pip size", async () => {
    const jpy: Candle[] = [
      { asset: "USDJPY", date: "2024-01-03", open: 150, high: 150.5, low: 149.8, close: 150.3 },
    ];
    const store = new InMemoryAnalogueStore();
    // ATR 1.00 price = 100 pips -> 50 pip band; move is +30 pips -> FLAT.
    const out = await resolve("2024-01-02", "USDJPY", jpy, 1.0, "2024-02-01", store, { flatBandMode: "atr_pips" });
    expect(out.perHorizon[1].direction).toBe("FLAT");
  });
});

describe("resolver label alignment", () => {
  const candles: Candle[] = [
    { asset: "EURUSD", date: "2024-01-02", open: 1.1, high: 1.11, low: 1.09, close: 1.108 }, // the decision date itself: +80 pips
    { asset: "EURUSD", date: "2024-01-03", open: 1.108, high: 1.109, low: 1.1, close: 1.101 }, // next session: -70 pips
  ];

  it("default measures the session AFTER the decision date (live behaviour)", async () => {
    const out = await resolve("2024-01-02", "EURUSD", candles, 0, "2024-02-01", new InMemoryAnalogueStore());
    expect(out.perHorizon[1].direction).toBe("DOWN");
  });

  it("on_decision_date measures the session labelled with the decision date", async () => {
    const out = await resolve("2024-01-02", "EURUSD", candles, 0, "2024-02-01", new InMemoryAnalogueStore(), {
      labelAlignment: "on_decision_date",
    });
    expect(out.perHorizon[1].direction).toBe("UP");
  });
});
