import { describe, expect, it } from "vitest";

import type { Exposure } from "../api/types";
import { CONCENTRATED_NOTE, shapeExposure } from "./shapeExposure";

// EURUSD short + GBPUSD short + USDCHF long: USD +3, EUR -1, GBP -1, CHF -1.
const USD_STACK: Exposure = {
  perCurrency: [
    { currency: "CHF", net: -1 },
    { currency: "EUR", net: -1 },
    { currency: "GBP", net: -1 },
    { currency: "USD", net: 3 },
  ],
  concentrated: true,
  strongestPair: "EURUSD",
};

describe("shapeExposure", () => {
  it("states a USD stack as one effective bet, largest leg first", () => {
    const vm = shapeExposure(USD_STACK, 3, true)!;
    expect(vm.headline).toBe("3 setups, one effective currency bet");
    expect(vm.legs[0]).toMatchObject({ currency: "USD", net: 3, text: "Long USD x3" });
    expect(vm.legs.map((l) => l.currency)).toEqual(["USD", "CHF", "EUR", "GBP"]);
    expect(vm.legs[1]?.text).toBe("Short CHF x1");
    expect(vm.note).toBe(CONCENTRATED_NOTE);
  });

  it("shows combined exposure without the concentration note when setups offset", () => {
    const vm = shapeExposure(
      { perCurrency: [{ currency: "EUR", net: 1 }, { currency: "GBP", net: 1 }, { currency: "USD", net: -2 }], concentrated: false, strongestPair: null },
      2,
      true,
    )!;
    expect(vm.concentrated).toBe(false);
    expect(vm.note).toBeNull();
    expect(vm.headline).toBe("2 setups, combined currency exposure");
  });

  it("is hidden for fewer than two setups, for an older browsed date, and with no net legs", () => {
    expect(shapeExposure(USD_STACK, 1, true)).toBeNull();
    expect(shapeExposure(USD_STACK, 3, false)).toBeNull();
    expect(shapeExposure({ perCurrency: [{ currency: "USD", net: 0 }], concentrated: false, strongestPair: null }, 2, true)).toBeNull();
  });

  it("never mentions sizing or advice", () => {
    expect(JSON.stringify(shapeExposure(USD_STACK, 3, true))).not.toMatch(/size|lot|stake|buy|sell/i);
  });
});
