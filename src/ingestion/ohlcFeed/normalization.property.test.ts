import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { FcsOhlcFeedProvider } from "./fcsOhlcProvider.js";
import { TwelveDataOhlcFeedProvider } from "./twelveDataOhlcProvider.js";
import { MassiveOhlcFeedProvider } from "./massiveOhlcProvider.js";
import type { OhlcProviderConfig } from "./types.js";
import type { RawCandle } from "../types.js";

// Feature: daily-candle-freshness-and-cleanup, Property 5: normalization to RawCandle preserves OHLC values verbatim
//
// Validates: Requirements 1.4, 1.6
//
// Each adapter normalizes its provider-native daily row to the single internal
// `RawCandle` shape. Across random coercible finite OHLC rows, normalization must
// preserve open/high/low/close EXACTLY and stamp `source` with the provider name
// (no unit scaling is applied by any of these three adapters).

/** Finite OHLC values that survive a `Number(String(x))` round-trip exactly. */
const ohlcArb = fc.record({
  open: fc.double({ min: 0.0001, max: 100000, noNaN: true, noDefaultInfinity: true }),
  high: fc.double({ min: 0.0001, max: 100000, noNaN: true, noDefaultInfinity: true }),
  low: fc.double({ min: 0.0001, max: 100000, noNaN: true, noDefaultInfinity: true }),
  close: fc.double({ min: 0.0001, max: 100000, noNaN: true, noDefaultInfinity: true }),
});

/** Whether the row is emitted with numeric-string fields or native numbers. */
const asStringsArb = fc.boolean();

// Generate a YYYY-MM-DD by offsetting whole days from a fixed epoch, which
// avoids any invalid-Date edge cases from `fc.date`.
const EPOCH_DAYS = Date.UTC(2010, 0, 1) / 86_400_000;
const dateArb = fc
  .integer({ min: 0, max: 7000 })
  .map((offset) => new Date((EPOCH_DAYS + offset) * 86_400_000).toISOString().slice(0, 10));

function fcsConfig(): OhlcProviderConfig {
  return { provider: "FCS", keyEnvName: "EXTERNAL_SIGNAL_API_KEY", apiKey: "k", baseUrl: "https://fcs.example" };
}
function tdConfig(): OhlcProviderConfig {
  return { provider: "TwelveData", keyEnvName: "TWELVE_DATA_API_KEY", apiKey: "k", baseUrl: "https://td.example" };
}
function mvConfig(): OhlcProviderConfig {
  return { provider: "Massive", keyEnvName: "MASSIVE_API_KEY", apiKey: "k", baseUrl: "https://massive.example" };
}

/** A one-shot fetch stub returning the given JSON body. */
function jsonFetch(body: unknown): typeof fetch {
  return () =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
}

/** Emit a numeric field as a string or a native number per `asStrings`. */
function field(n: number, asStrings: boolean): number | string {
  return asStrings ? String(n) : n;
}

function assertPreserved(
  candle: RawCandle,
  ohlc: { open: number; high: number; low: number; close: number },
  source: string,
): void {
  expect(candle.open).toBe(Number(String(ohlc.open)));
  expect(candle.high).toBe(Number(String(ohlc.high)));
  expect(candle.low).toBe(Number(String(ohlc.low)));
  expect(candle.close).toBe(Number(String(ohlc.close)));
  expect(candle.source).toBe(source);
}

describe("Property 5: normalization to RawCandle preserves OHLC values verbatim", () => {
  it("FcsOhlcFeedProvider preserves OHLC exactly and stamps source=FCS", async () => {
    await fc.assert(
      fc.asyncProperty(ohlcArb, asStringsArb, dateArb, async (ohlc, asStrings, date) => {
        const body = {
          status: true,
          response: [
            {
              ticker: "FX:EURUSD",
              active: {
                o: field(ohlc.open, asStrings),
                h: field(ohlc.high, asStrings),
                l: field(ohlc.low, asStrings),
                c: field(ohlc.close, asStrings),
                date,
              },
            },
          ],
        };
        const provider = new FcsOhlcFeedProvider(fcsConfig(), jsonFetch(body));
        const result = await provider.fetchLatest(["EURUSD"], "2026-09-16");
        const eur = result.get("EURUSD");
        expect(eur?.ok).toBe(true);
        if (eur?.ok) {
          assertPreserved(eur.value[0]!, ohlc, "FCS");
        }
      }),
      { numRuns: 150 },
    );
  });

  it("TwelveDataOhlcFeedProvider preserves OHLC exactly and stamps source=TwelveData", async () => {
    await fc.assert(
      fc.asyncProperty(ohlcArb, asStringsArb, dateArb, async (ohlc, asStrings, date) => {
        const body = {
          status: "ok",
          values: [
            {
              datetime: date,
              open: field(ohlc.open, asStrings),
              high: field(ohlc.high, asStrings),
              low: field(ohlc.low, asStrings),
              close: field(ohlc.close, asStrings),
            },
          ],
        };
        const provider = new TwelveDataOhlcFeedProvider(tdConfig(), jsonFetch(body));
        const result = await provider.fetchRange("EURUSD", date, date);
        expect(result.ok).toBe(true);
        if (result.ok) {
          assertPreserved(result.value[0]!, ohlc, "TwelveData");
        }
      }),
      { numRuns: 150 },
    );
  });

  it("MassiveOhlcFeedProvider preserves OHLC exactly and stamps source=Massive", async () => {
    await fc.assert(
      fc.asyncProperty(ohlcArb, asStringsArb, dateArb, async (ohlc, asStrings, date) => {
        const ms = Date.parse(`${date}T00:00:00Z`);
        const body = {
          status: "OK",
          results: [
            {
              o: field(ohlc.open, asStrings),
              h: field(ohlc.high, asStrings),
              l: field(ohlc.low, asStrings),
              c: field(ohlc.close, asStrings),
              t: ms,
            },
          ],
        };
        const provider = new MassiveOhlcFeedProvider(mvConfig(), jsonFetch(body));
        const result = await provider.fetchRange("EURUSD", date, date);
        expect(result.ok).toBe(true);
        if (result.ok) {
          assertPreserved(result.value[0]!, ohlc, "Massive");
          expect(result.value[0]!.date).toBe(date);
        }
      }),
      { numRuns: 150 },
    );
  });
});
