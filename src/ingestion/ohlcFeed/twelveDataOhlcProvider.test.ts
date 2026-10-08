import { describe, expect, it } from "vitest";
import { TwelveDataOhlcFeedProvider, toTwelveDataSymbol } from "./twelveDataOhlcProvider.js";
import type { OhlcProviderConfig } from "./types.js";

// Unit tests for the Twelve Data adapter (Task 3.1; Requirements 1.2, 1.3, 1.6).
//
// With an injected `fetch` stub: `fetchLatest` and `fetchRange` map a
// representative `time_series` body to RawCandle(s) with OHLC preserved and
// `source="TwelveData"`; each failure mode maps to the right Result; and no
// api-key value appears in any error message.

const API_KEY = "twelve-secret-abc123";
const BASE_URL = "https://td.example";

function config(): OhlcProviderConfig {
  return { provider: "TwelveData", keyEnvName: "TWELVE_DATA_API_KEY", apiKey: API_KEY, baseUrl: BASE_URL };
}

/** A fetch stub that records the requested URL and returns a JSON body. */
function recordingJsonFetch(
  body: unknown,
  status = 200,
): { fetchImpl: typeof fetch; urls: string[] } {
  const urls: string[] = [];
  const fetchImpl: typeof fetch = (url) => {
    urls.push(typeof url === "string" ? url : url instanceof URL ? url.href : url.url);
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
  };
  return { fetchImpl, urls };
}

function textFetch(text: string): typeof fetch {
  return () => Promise.resolve(new Response(text, { status: 200 }));
}

function networkErrorFetch(): typeof fetch {
  return () => Promise.reject(new Error("getaddrinfo ENOTFOUND"));
}

const RANGE_BODY = {
  status: "ok",
  values: [
    { datetime: "2026-09-15", open: "1.1050", high: "1.1120", low: "1.1000", close: "1.1080" },
    { datetime: "2026-09-14", open: "1.1000", high: "1.1070", low: "1.0980", close: "1.1050" },
  ],
};

describe("TwelveDataOhlcFeedProvider", () => {
  it("declares the latest + range capability", () => {
    const { fetchImpl } = recordingJsonFetch(RANGE_BODY);
    const provider = new TwelveDataOhlcFeedProvider(config(), fetchImpl);
    expect(provider.name).toBe("TwelveData");
    expect(provider.supportsLatest).toBe(true);
    expect(provider.supportsRange).toBe(true);
  });

  it("maps the EURUSD form to the EUR/USD symbol", () => {
    expect(toTwelveDataSymbol("EURUSD")).toBe("EUR/USD");
    expect(toTwelveDataSymbol("USDJPY")).toBe("USD/JPY");
  });

  it("fetchRange maps a success body to RawCandles preserving OHLC and stamping source", async () => {
    const { fetchImpl, urls } = recordingJsonFetch(RANGE_BODY);
    const provider = new TwelveDataOhlcFeedProvider(config(), fetchImpl);
    const result = await provider.fetchRange("EURUSD", "2026-09-14", "2026-09-15");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(2);
      expect(result.value[0]).toMatchObject({
        asset: "EURUSD",
        date: "2026-09-15",
        open: 1.105,
        high: 1.112,
        low: 1.1,
        close: 1.108,
        source: "TwelveData",
      });
    }
    // Verify the request used the expected endpoint/params.
    expect(urls[0]).toContain("/time_series?");
    expect(urls[0]).toContain("symbol=EUR%2FUSD");
    expect(urls[0]).toContain("interval=1day");
    expect(urls[0]).toContain("start_date=2026-09-14");
    expect(urls[0]).toContain("end_date=2026-09-15");
  });

  it("fetchLatest requests outputsize=1 and maps the newest value", async () => {
    const { fetchImpl, urls } = recordingJsonFetch({
      status: "ok",
      values: [{ datetime: "2026-09-15", open: 1.1, high: 1.2, low: 1.0, close: 1.15 }],
    });
    const provider = new TwelveDataOhlcFeedProvider(config(), fetchImpl);
    const result = await provider.fetchLatest(["EURUSD"], "2026-09-16");
    const eur = result.get("EURUSD");
    expect(eur?.ok).toBe(true);
    if (eur?.ok) {
      expect(eur.value[0]).toMatchObject({ date: "2026-09-15", open: 1.1, close: 1.15 });
    }
    expect(urls[0]).toContain("outputsize=1");
  });

  it("maps a network error to unavailable", async () => {
    const provider = new TwelveDataOhlcFeedProvider(config(), networkErrorFetch());
    const result = await provider.fetchRange("EURUSD", "2026-09-14", "2026-09-15");
    expect(result.ok === false && result.error.mode).toBe("unavailable");
    if (!result.ok) expect(result.error.message).not.toContain(API_KEY);
  });

  it("maps a non-200 to unavailable", async () => {
    const { fetchImpl } = recordingJsonFetch(RANGE_BODY, 429);
    const provider = new TwelveDataOhlcFeedProvider(config(), fetchImpl);
    const result = await provider.fetchRange("EURUSD", "2026-09-14", "2026-09-15");
    expect(result.ok === false && result.error.mode).toBe("unavailable");
  });

  it("maps a non-JSON body to invalid", async () => {
    const provider = new TwelveDataOhlcFeedProvider(config(), textFetch("not json"));
    const result = await provider.fetchRange("EURUSD", "2026-09-14", "2026-09-15");
    expect(result.ok === false && result.error.mode).toBe("invalid");
  });

  it("maps a status:error body to invalid", async () => {
    const { fetchImpl } = recordingJsonFetch({ status: "error", code: 400, message: "bad symbol" });
    const provider = new TwelveDataOhlcFeedProvider(config(), fetchImpl);
    const result = await provider.fetchRange("EURUSD", "2026-09-14", "2026-09-15");
    expect(result.ok === false && result.error.mode).toBe("invalid");
    if (!result.ok) expect(result.error.message).not.toContain(API_KEY);
  });

  it("maps empty values to empty", async () => {
    const { fetchImpl } = recordingJsonFetch({ status: "ok", values: [] });
    const provider = new TwelveDataOhlcFeedProvider(config(), fetchImpl);
    const result = await provider.fetchRange("EURUSD", "2026-09-14", "2026-09-15");
    expect(result.ok === false && result.error.mode).toBe("empty");
  });
});
