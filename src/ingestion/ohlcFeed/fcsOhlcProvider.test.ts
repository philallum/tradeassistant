import { describe, expect, it } from "vitest";
import { FcsOhlcFeedProvider } from "./fcsOhlcProvider.js";
import type { OhlcProviderConfig } from "./types.js";

// Unit tests for the FCS adapter (Task 2.1; Requirements 1.2, 1.3, 1.6, 1.7, 4.1).
//
// With an injected `fetch` stub (no live network): a representative success body
// maps to RawCandle(s) with OHLC preserved and `source="FCS"`; `fetchRange`
// returns `range_unsupported`; each failure mode (network/non-200/non-JSON/empty)
// maps to the right Result; and NO api-key value appears in any error message.

const API_KEY = "fcs-secret-xyz987";
const BASE_URL = "https://fcs.example";

function config(): OhlcProviderConfig {
  return { provider: "FCS", keyEnvName: "EXTERNAL_SIGNAL_API_KEY", apiKey: API_KEY, baseUrl: BASE_URL };
}

/** A fetch stub returning a JSON body with HTTP 200. */
function jsonFetch(body: unknown, status = 200): typeof fetch {
  return () =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
}

/** A fetch stub returning a non-JSON body with HTTP 200. */
function textFetch(text: string): typeof fetch {
  return () => Promise.resolve(new Response(text, { status: 200 }));
}

/** A fetch stub that rejects (network error). */
function networkErrorFetch(): typeof fetch {
  return () => Promise.reject(new Error("ECONNREFUSED"));
}

const SUCCESS_BODY = {
  status: true,
  code: 200,
  response: [
    {
      ticker: "FX:EURUSD",
      active: { o: "1.1000", h: "1.1100", l: "1.0950", c: "1.1050", date: "2026-09-15" },
    },
    {
      ticker: "FX:GBPUSD",
      active: { o: 1.25, h: 1.26, l: 1.24, c: 1.255, date: "2026-09-15" },
    },
  ],
};

describe("FcsOhlcFeedProvider", () => {
  it("declares the latest-only capability", () => {
    const provider = new FcsOhlcFeedProvider(config(), jsonFetch(SUCCESS_BODY));
    expect(provider.name).toBe("FCS");
    expect(provider.supportsLatest).toBe(true);
    expect(provider.supportsRange).toBe(false);
  });

  it("fetchLatest maps a success body to RawCandles with OHLC preserved and source stamped", async () => {
    const provider = new FcsOhlcFeedProvider(config(), jsonFetch(SUCCESS_BODY));
    const result = await provider.fetchLatest(["EURUSD", "GBPUSD"], "2026-09-16");

    const eur = result.get("EURUSD");
    expect(eur?.ok).toBe(true);
    if (eur?.ok) {
      expect(eur.value).toHaveLength(1);
      const candle = eur.value[0]!;
      expect(candle).toMatchObject({
        asset: "EURUSD",
        date: "2026-09-15",
        open: 1.1,
        high: 1.11,
        low: 1.095,
        close: 1.105,
        source: "FCS",
      });
    }

    const gbp = result.get("GBPUSD");
    expect(gbp?.ok).toBe(true);
    if (gbp?.ok) {
      expect(gbp.value[0]).toMatchObject({ open: 1.25, high: 1.26, low: 1.24, close: 1.255 });
    }
  });

  it("falls back to asOf for the candle date when the row carries no date", async () => {
    const body = {
      status: true,
      response: [{ ticker: "FX:EURUSD", active: { o: 1, h: 2, l: 0.5, c: 1.5 } }],
    };
    const provider = new FcsOhlcFeedProvider(config(), jsonFetch(body));
    const result = await provider.fetchLatest(["EURUSD"], "2026-09-16");
    const eur = result.get("EURUSD");
    expect(eur?.ok && eur.value[0]?.date).toBe("2026-09-16");
  });

  it("fetchRange returns range_unsupported immediately", async () => {
    const provider = new FcsOhlcFeedProvider(config(), jsonFetch(SUCCESS_BODY));
    const result = await provider.fetchRange("EURUSD", "2026-09-01", "2026-09-15");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.mode).toBe("range_unsupported");
      expect(result.error.provider).toBe("FCS");
      expect(result.error.message).not.toContain(API_KEY);
    }
  });

  it("maps a network error to unavailable (no secret leak)", async () => {
    const provider = new FcsOhlcFeedProvider(config(), networkErrorFetch());
    const result = await provider.fetchLatest(["EURUSD"], "2026-09-16");
    const eur = result.get("EURUSD");
    expect(eur?.ok).toBe(false);
    if (eur && !eur.ok) {
      expect(eur.error.mode).toBe("unavailable");
      expect(eur.error.message).not.toContain(API_KEY);
    }
  });

  it("maps a non-200 to unavailable", async () => {
    const provider = new FcsOhlcFeedProvider(config(), jsonFetch(SUCCESS_BODY, 503));
    const result = await provider.fetchLatest(["EURUSD"], "2026-09-16");
    const eur = result.get("EURUSD");
    expect(eur?.ok === false && eur.error.mode).toBe("unavailable");
  });

  it("maps a non-JSON body to invalid", async () => {
    const provider = new FcsOhlcFeedProvider(config(), textFetch("<html>nope</html>"));
    const result = await provider.fetchLatest(["EURUSD"], "2026-09-16");
    const eur = result.get("EURUSD");
    expect(eur?.ok === false && eur.error.mode).toBe("invalid");
  });

  it("maps a missing row to empty", async () => {
    const body = { status: true, response: [{ ticker: "FX:EURUSD", active: { o: 1, h: 2, l: 0.5, c: 1.5 } }] };
    const provider = new FcsOhlcFeedProvider(config(), jsonFetch(body));
    const result = await provider.fetchLatest(["USDJPY"], "2026-09-16");
    const jpy = result.get("USDJPY");
    expect(jpy?.ok === false && jpy.error.mode).toBe("empty");
  });

  it("never puts the api key in a request error message", async () => {
    const provider = new FcsOhlcFeedProvider(config(), jsonFetch({ status: false, code: 403, msg: "denied" }));
    const result = await provider.fetchLatest(["EURUSD"], "2026-09-16");
    const eur = result.get("EURUSD");
    expect(eur?.ok).toBe(false);
    if (eur && !eur.ok) {
      expect(eur.error.message).not.toContain(API_KEY);
    }
  });
});
