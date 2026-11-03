import { describe, expect, it } from "vitest";
import { prepareCandles } from "./candles.js";
import type { Candle, TradingDate } from "../guard/types.js";

// --- Test fixtures -----------------------------------------------------------

/**
 * Build a plain OHLC candle. OHLC values default to a simple, finite set so a
 * test only has to override the field it cares about. `partial` can inject a
 * non-finite or non-number OHLC value for the invalid-candle cases.
 */
function candle(
  date: TradingDate,
  partial: Partial<Pick<Candle, "open" | "high" | "low" | "close">> = {},
  asset = "EURUSD",
): Candle {
  return {
    asset,
    date,
    open: 1,
    high: 2,
    low: 0.5,
    close: 1.5,
    ...partial,
  };
}

// --- Look-ahead safety (Requirements 6.1, 6.2) -------------------------------

describe("prepareCandles — look-ahead safety (Req 6.1, 6.2)", () => {
  it("rejects a candle dated ON the decision date as a look_ahead_violation", () => {
    const decisionDate = "2025-01-10";
    const candles = [candle("2025-01-09"), candle("2025-01-10")];

    const result = prepareCandles(candles, decisionDate);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error.reason).toBe("look_ahead_violation");
    if (result.error.reason !== "look_ahead_violation") return;
    expect(result.error.decisionDate).toBe(decisionDate);
    expect(result.error.violatingCandles.map((c) => c.date)).toEqual([
      "2025-01-10",
    ]);
  });

  it("rejects a candle dated AFTER the decision date as a look_ahead_violation", () => {
    const decisionDate = "2025-01-10";
    const candles = [candle("2025-01-09"), candle("2025-01-11")];

    const result = prepareCandles(candles, decisionDate);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error.reason).toBe("look_ahead_violation");
  });
});

// --- Look-ahead wins over non-finite OHLC (Requirement 6.9) ------------------

describe("prepareCandles — look-ahead wins over other defects (Req 6.9)", () => {
  it("returns look_ahead_violation when a candle is BOTH future-dated AND non-finite", () => {
    const decisionDate = "2025-01-10";
    // This candle is both dated at the decision date AND has a NaN open. The
    // look-ahead check runs first and must win over invalid_candle (Req 6.9).
    const candles = [candle("2025-01-10", { open: Number.NaN })];

    const result = prepareCandles(candles, decisionDate);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error.reason).toBe("look_ahead_violation");
  });
});

// --- Empty input (Requirement 6.8) -------------------------------------------

describe("prepareCandles — empty input (Req 6.8)", () => {
  it("returns insufficient_data for an empty array", () => {
    const result = prepareCandles([], "2025-01-10");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error.reason).toBe("insufficient_data");
  });
});

// --- Invalid OHLC: first bad field named, in field order (Requirement 6.7) ---

describe("prepareCandles — invalid OHLC fields (Req 6.7)", () => {
  it("names a single non-finite field and the candle date", () => {
    const result = prepareCandles(
      [candle("2025-01-05", { low: Number.POSITIVE_INFINITY })],
      "2025-01-10",
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error.reason).toBe("invalid_candle");
    if (result.error.reason !== "invalid_candle") return;
    expect(result.error.field).toBe("low");
    expect(result.error.date).toBe("2025-01-05");
  });

  it("reports the FIRST bad field in open/high/low/close order when several are bad", () => {
    // high, low and close are all non-finite; the check order (open, high, low,
    // close) means `high` must be the reported field, not `low` or `close`.
    const result = prepareCandles(
      [
        candle("2025-01-05", {
          high: Number.NaN,
          low: Number.POSITIVE_INFINITY,
          close: Number.NEGATIVE_INFINITY,
        }),
      ],
      "2025-01-10",
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error.reason).toBe("invalid_candle");
    if (result.error.reason !== "invalid_candle") return;
    expect(result.error.field).toBe("high");
    expect(result.error.date).toBe("2025-01-05");
  });

  it("reports `open` first when every OHLC field is bad", () => {
    const result = prepareCandles(
      [
        candle("2025-01-05", {
          open: Number.NaN,
          high: Number.NaN,
          low: Number.NaN,
          close: Number.NaN,
        }),
      ],
      "2025-01-10",
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    if (result.error.reason !== "invalid_candle") throw new Error("wrong reason");
    expect(result.error.field).toBe("open");
  });
});

// --- Input is never mutated (Requirement 6.6) --------------------------------

describe("prepareCandles — never mutates the caller's input (Req 6.6)", () => {
  it("leaves the input array and candle objects structurally unchanged", () => {
    const candles = [
      candle("2025-01-03"),
      candle("2025-01-01"),
      candle("2025-01-02"),
    ];
    // Structural snapshot of the input taken before the call.
    const snapshot: string = JSON.stringify(candles);

    const result = prepareCandles(candles, "2025-01-10");

    expect(result.ok).toBe(true);
    // The input array order and every candle object are unchanged.
    expect(JSON.stringify(candles)).toBe(snapshot);
    expect(candles.map((c) => c.date)).toEqual([
      "2025-01-03",
      "2025-01-01",
      "2025-01-02",
    ]);
  });

  it("does not attempt to mutate a deeply frozen input", () => {
    const candles = Object.freeze([
      Object.freeze(candle("2025-01-03")),
      Object.freeze(candle("2025-01-01")),
      Object.freeze(candle("2025-01-02")),
    ]) as readonly Candle[];

    // In strict mode a write to a frozen object throws; a successful call proves
    // prepareCandles never writes to the caller's array or candle objects.
    const result = prepareCandles(candles, "2025-01-10");

    expect(result.ok).toBe(true);
  });
});

// --- Output is date-sorted (Requirement 6.7 preparation / Design) ------------

describe("prepareCandles — output ordering", () => {
  it("returns a copy sorted ascending by date", () => {
    const candles = [
      candle("2025-01-03"),
      candle("2025-01-01"),
      candle("2025-01-04"),
      candle("2025-01-02"),
    ];

    const result = prepareCandles(candles, "2025-01-10");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.value.map((c) => c.date)).toEqual([
      "2025-01-01",
      "2025-01-02",
      "2025-01-03",
      "2025-01-04",
    ]);
    // The sorted result is a fresh array, not the caller's input.
    expect(result.value).not.toBe(candles);
  });

  it("is a stable sort: candles sharing a date keep their input order", () => {
    const first = candle("2025-01-02", {}, "AAA");
    const second = candle("2025-01-02", {}, "BBB");
    const earlier = candle("2025-01-01", {}, "CCC");

    const result = prepareCandles([first, second, earlier], "2025-01-10");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.value.map((c) => c.asset)).toEqual(["CCC", "AAA", "BBB"]);
  });
});
