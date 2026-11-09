import { describe, expect, it } from "vitest";
import { TwelveDataOhlcFeedProvider, toTwelveDataSymbol } from "./twelveDataOhlcProvider.js";
import type { OhlcProviderConfig } from "./types.js";

// Unit tests for the Twelve Data adapter. It fetches HOURLY bars and builds the system's own
// 17:00 America/New_York daily candles from them (closed + complete sessions only); each failure
// mode maps to the right Result and no api-key value appears in any error message.

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

/** 24 hourly bars for the Thursday 2026-11-05 session: Wed 22:00 UTC .. Thu 21:00 UTC. */
function thursdayValues(): Array<Record<string, string>> {
  const start = Date.parse("2026-11-04T22:00:00Z");
  const rows: Array<Record<string, string>> = [];
  for (let i = 0; i < 24; i += 1) {
    const dt = new Date(start + i * 3_600_000).toISOString().slice(0, 19).replace("T", " ");
    rows.push({
      datetime: dt,
      open: String(1.1 + i * 0.001),
      high: String(1.1 + i * 0.001 + 0.0005),
      low: String(1.1 + i * 0.001 - 0.0002),
      close: String(1.1 + (i + 1) * 0.001),
    });
  }
  return rows.reverse(); // Twelve Data returns newest first
}
const BODY = { status: "ok", values: thursdayValues() };
const AFTER_CLOSE = () => new Date("2026-11-06T22:30:00Z");

describe("TwelveDataOhlcFeedProvider", () => {
  it("declares the latest + range capability", () => {
    const { fetchImpl } = recordingJsonFetch(BODY);
    const provider = new TwelveDataOhlcFeedProvider(config(), fetchImpl, AFTER_CLOSE);
    expect(provider.name).toBe("TwelveData");
    expect(provider.supportsLatest).toBe(true);
    expect(provider.supportsRange).toBe(true);
  });

  it("maps the EURUSD form to the EUR/USD symbol", () => {
    expect(toTwelveDataSymbol("EURUSD")).toBe("EUR/USD");
    expect(toTwelveDataSymbol("USDJPY")).toBe("USD/JPY");
  });

  it("fetchRange builds the NY-close daily candle from hourly bars", async () => {
    const { fetchImpl, urls } = recordingJsonFetch(BODY);
    const provider = new TwelveDataOhlcFeedProvider(config(), fetchImpl, AFTER_CLOSE);
    const result = await provider.fetchRange("EURUSD", "2026-11-05", "2026-11-05");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      const c = result.value[0]!;
      expect(c).toMatchObject({ asset: "EURUSD", pair: "EURUSD", date: "2026-11-05", source: "TwelveData" });
      expect(c.open).toBeCloseTo(1.1, 10);
      expect(c.close).toBeCloseTo(1.124, 10);
      expect(c.high).toBeCloseTo(1.1 + 23 * 0.001 + 0.0005, 10);
      expect(c.low).toBeCloseTo(1.1 - 0.0002, 10);
    }
    expect(urls[0]).toContain("/time_series?");
    expect(urls[0]).toContain("symbol=EUR%2FUSD");
    expect(urls[0]).toContain("interval=1h");
    expect(urls[0]).toContain("timezone=UTC");
    expect(urls[0]).toContain("outputsize=5000");
  });

  it("fetchLatest returns only the newest closed complete session before asOf", async () => {
    const { fetchImpl } = recordingJsonFetch(BODY);
    const provider = new TwelveDataOhlcFeedProvider(config(), fetchImpl, AFTER_CLOSE);
    const result = await provider.fetchLatest(["EURUSD"], "2026-11-06");
    const eur = result.get("EURUSD");
    expect(eur?.ok).toBe(true);
    if (eur?.ok) {
      expect(eur.value).toHaveLength(1);
      expect(eur.value[0]).toMatchObject({ date: "2026-11-05" });
    }
  });

  it("never emits a session that has not closed yet (forming bar)", async () => {
    const { fetchImpl } = recordingJsonFetch(BODY);
    // 21:30 UTC Thursday: the session closes at 22:00 UTC.
    const provider = new TwelveDataOhlcFeedProvider(config(), fetchImpl, () => new Date("2026-11-05T21:30:00Z"));
    const result = await provider.fetchLatest(["EURUSD"], "2026-11-06");
    const eur = result.get("EURUSD");
    expect(eur?.ok).toBe(false);
    if (eur && !eur.ok) expect(eur.error.mode).toBe("empty");
  });

  it("rejects a partial session (too few bars)", async () => {
    const { fetchImpl } = recordingJsonFetch({ status: "ok", values: thursdayValues().slice(0, 8) });
    const provider = new TwelveDataOhlcFeedProvider(config(), fetchImpl, AFTER_CLOSE);
    const result = await provider.fetchRange("EURUSD", "2026-11-05", "2026-11-05");
    expect(result.ok === false && result.error.mode).toBe("empty");
  });

  it("maps a network error to unavailable", async () => {
    const provider = new TwelveDataOhlcFeedProvider(config(), networkErrorFetch(), AFTER_CLOSE);
    const result = await provider.fetchRange("EURUSD", "2026-11-05", "2026-11-05");
    expect(result.ok === false && result.error.mode).toBe("unavailable");
    if (!result.ok) expect(result.error.message).not.toContain(API_KEY);
  });

  it("maps a non-200 to unavailable", async () => {
    const { fetchImpl } = recordingJsonFetch(BODY, 429);
    const provider = new TwelveDataOhlcFeedProvider(config(), fetchImpl, AFTER_CLOSE);
    const result = await provider.fetchRange("EURUSD", "2026-11-05", "2026-11-05");
    expect(result.ok === false && result.error.mode).toBe("unavailable");
  });

  it("maps a non-JSON body to invalid", async () => {
    const provider = new TwelveDataOhlcFeedProvider(config(), textFetch("not json"), AFTER_CLOSE);
    const result = await provider.fetchRange("EURUSD", "2026-11-05", "2026-11-05");
    expect(result.ok === false && result.error.mode).toBe("invalid");
  });

  it("maps a status:error body to invalid", async () => {
    const { fetchImpl } = recordingJsonFetch({ status: "error", code: 400, message: "bad symbol" });
    const provider = new TwelveDataOhlcFeedProvider(config(), fetchImpl, AFTER_CLOSE);
    const result = await provider.fetchRange("EURUSD", "2026-11-05", "2026-11-05");
    expect(result.ok === false && result.error.mode).toBe("invalid");
    if (!result.ok) expect(result.error.message).not.toContain(API_KEY);
  });

  it("maps empty values to empty", async () => {
    const { fetchImpl } = recordingJsonFetch({ status: "ok", values: [] });
    const provider = new TwelveDataOhlcFeedProvider(config(), fetchImpl, AFTER_CLOSE);
    const result = await provider.fetchRange("EURUSD", "2026-11-05", "2026-11-05");
    expect(result.ok === false && result.error.mode).toBe("empty");
  });
});
