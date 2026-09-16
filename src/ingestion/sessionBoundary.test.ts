import { describe, expect, it } from "vitest";
import { normalizeSessionBoundary } from "./sessionBoundary.js";
import type { RawCandle } from "./types.js";

describe("Session-Boundary Normalization (Requirements 7.7, 7.8)", () => {
  it("normalizes Monday-Friday daily candles preserving OHLC", () => {
    const raw: RawCandle[] = [
      { date: "2026-01-05", open: 1.1, high: 1.12, low: 1.09, close: 1.11, asset: "EURUSD" }, // Mon
      { date: "2026-01-06", open: 1.11, high: 1.13, low: 1.10, close: 1.12, asset: "EURUSD" }, // Tue
    ];

    const result = normalizeSessionBoundary(raw);
    expect(result).toHaveLength(2);
    expect(result[0]?.date).toBe("2026-01-05");
    expect(result[0]?.open).toBe(1.1);
    expect(result[1]?.date).toBe("2026-01-06");
  });

  it("merges Sunday partial candles into Monday daily candle", () => {
    const raw: RawCandle[] = [
      // Sunday partial opening (Jan 04)
      { date: "2026-01-04", open: 1.095, high: 1.102, low: 1.094, close: 1.1, asset: "EURUSD" },
      // Monday session (Jan 05)
      { date: "2026-01-05", open: 1.1, high: 1.125, low: 1.098, close: 1.12, asset: "EURUSD" },
    ];

    const result = normalizeSessionBoundary(raw);
    expect(result).toHaveLength(1);
    const monday = result[0];
    expect(monday?.date).toBe("2026-01-05");
    expect(monday?.open).toBe(1.095); // Sunday's open
    expect(monday?.high).toBe(1.125); // max(1.102, 1.125)
    expect(monday?.low).toBe(1.094);  // min(1.094, 1.098)
    expect(monday?.close).toBe(1.12); // Monday's close
  });

  it("maps Sunday partial candle to Monday date if Monday candle was absent", () => {
    const raw: RawCandle[] = [
      { date: "2026-01-04", open: 1.095, high: 1.102, low: 1.094, close: 1.1, asset: "EURUSD" },
    ];

    const result = normalizeSessionBoundary(raw);
    expect(result).toHaveLength(1);
    expect(result[0]?.date).toBe("2026-01-05");
    expect(result[0]?.open).toBe(1.095);
  });

  it("handles UTC timestamps crossing 17:00 America/New_York session close", () => {
    // 2026-01-05 21:00 UTC during EST is 16:00 NY -> belongs to 2026-01-05 session
    // 2026-01-05 23:00 UTC during EST is 18:00 NY -> belongs to 2026-01-06 session
    const raw: RawCandle[] = [
      { timestamp: "2026-01-05T21:00:00Z", open: 1.1, high: 1.11, low: 1.09, close: 1.105, asset: "EURUSD" },
      { timestamp: "2026-01-05T23:00:00Z", open: 1.105, high: 1.12, low: 1.1, close: 1.115, asset: "EURUSD" },
    ];

    const result = normalizeSessionBoundary(raw);
    expect(result).toHaveLength(2);
    expect(result[0]?.date).toBe("2026-01-05");
    expect(result[1]?.date).toBe("2026-01-06");
  });
});
