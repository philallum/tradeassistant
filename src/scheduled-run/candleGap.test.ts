import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_LOOKBACK_TRADING_DAYS,
  backfillRangeStart,
  classifyGap,
  resolveMaxLookback,
} from "./candleGap.js";
import { addTradingDays } from "../guard/tradingDate.js";

// Unit tests for the gap + bounded-lookback helper (Task 7; R3.1, R3.2, R4.4).

describe("resolveMaxLookback", () => {
  it("defaults when the env var is absent", () => {
    expect(resolveMaxLookback({})).toBe(DEFAULT_MAX_LOOKBACK_TRADING_DAYS);
  });

  it("reads a positive integer from the env var", () => {
    expect(
      resolveMaxLookback({ CANDLE_FRESHNESS_MAX_LOOKBACK_DAYS: "30" }),
    ).toBe(30);
  });

  it("falls back to the default on non-positive, NaN, or empty values", () => {
    expect(
      resolveMaxLookback({ CANDLE_FRESHNESS_MAX_LOOKBACK_DAYS: "0" }),
    ).toBe(DEFAULT_MAX_LOOKBACK_TRADING_DAYS);
    expect(
      resolveMaxLookback({ CANDLE_FRESHNESS_MAX_LOOKBACK_DAYS: "-5" }),
    ).toBe(DEFAULT_MAX_LOOKBACK_TRADING_DAYS);
    expect(
      resolveMaxLookback({ CANDLE_FRESHNESS_MAX_LOOKBACK_DAYS: "not-a-number" }),
    ).toBe(DEFAULT_MAX_LOOKBACK_TRADING_DAYS);
    expect(
      resolveMaxLookback({ CANDLE_FRESHNESS_MAX_LOOKBACK_DAYS: "  " }),
    ).toBe(DEFAULT_MAX_LOOKBACK_TRADING_DAYS);
  });
});

describe("classifyGap", () => {
  // Target is a Friday; the trading day before it is the prior Thursday.
  const target = "2026-09-11"; // Friday

  it("classifies no history as backfill", () => {
    expect(classifyGap(null, target)).toBe("backfill");
  });

  it("classifies a last-stored date at/after the target as up_to_date", () => {
    expect(classifyGap(target, target)).toBe("up_to_date");
    expect(classifyGap("2026-09-14", target)).toBe("up_to_date"); // Monday after
  });

  it("classifies exactly one trading day behind as top_up", () => {
    const oneBehind = addTradingDays(target, -1); // 2026-09-10 Thursday
    expect(classifyGap(oneBehind, target)).toBe("top_up");
  });

  it("classifies more than one trading day behind as backfill", () => {
    const twoBehind = addTradingDays(target, -2);
    expect(classifyGap(twoBehind, target)).toBe("backfill");
  });
});

describe("backfillRangeStart", () => {
  const target = "2026-09-11"; // Friday

  it("starts the trading day after latestDate when within the lookback bound", () => {
    const latest = addTradingDays(target, -3);
    expect(backfillRangeStart(latest, target, 90)).toBe(
      addTradingDays(latest, 1),
    );
  });

  it("clamps an ancient latestDate to the bounded start", () => {
    const ancient = "2010-01-04";
    const bounded = addTradingDays(target, -5);
    expect(backfillRangeStart(ancient, target, 5)).toBe(bounded);
  });

  it("covers the last maxLookback trading days ending at target when no history", () => {
    expect(backfillRangeStart(null, target, 5)).toBe(
      addTradingDays(target, -4),
    );
  });
});
