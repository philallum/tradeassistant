import { describe, expect, it } from "vitest";
import { err, ok, type Result } from "../../guard/types.js";
import type { TradingDate } from "../../guard/types.js";
import type { Pair, RawCandle } from "../types.js";
import { chainFromProviders, isResolved } from "./providerChain.js";
import type { OhlcFeedError, OhlcFeedProvider } from "./types.js";

// Unit tests for the Provider_Fallback_Chain resolver (Task 5.1; R1.1, R1.3, R4.1).
//
// first-usable-wins per pair; FCS skipped on a range so Twelve Data serves it;
// advance past unconfigured/empty/erroring providers; all-fail resolves to a
// typed secret-free error.

type LatestMap = ReadonlyMap<Pair, Result<readonly RawCandle[], OhlcFeedError>>;

function candle(pair: Pair, source: string): RawCandle {
  return { asset: pair, pair, date: "2026-09-15", open: 1, high: 2, low: 0.5, close: 1.5, source };
}

function feedError(provider: string, pair: Pair, mode: OhlcFeedError["mode"]): OhlcFeedError {
  return { reason: "ohlc_feed_error", mode, provider, pair, message: `${provider} ${mode} ${pair}` };
}

/** A fully-configurable stub provider for exercising the chain. */
class StubProvider implements OhlcFeedProvider {
  readonly #latestByPair: ReadonlyMap<Pair, Result<readonly RawCandle[], OhlcFeedError>>;
  readonly #range: Result<readonly RawCandle[], OhlcFeedError>;
  readonly latestCalls: Pair[][] = [];
  readonly rangeCalls: Pair[] = [];

  constructor(
    readonly name: string,
    readonly supportsLatest: boolean,
    readonly supportsRange: boolean,
    opts: {
      latest?: ReadonlyMap<Pair, Result<readonly RawCandle[], OhlcFeedError>>;
      range?: Result<readonly RawCandle[], OhlcFeedError>;
    } = {},
  ) {
    this.#latestByPair = opts.latest ?? new Map();
    this.#range = opts.range ?? err(feedError(name, "EURUSD", "empty"));
  }

  fetchLatest(pairs: readonly Pair[], asOf: TradingDate): Promise<LatestMap> {
    void asOf;
    this.latestCalls.push([...pairs]);
    const out = new Map<Pair, Result<readonly RawCandle[], OhlcFeedError>>();
    for (const pair of pairs) {
      out.set(pair, this.#latestByPair.get(pair) ?? err(feedError(this.name, pair, "empty")));
    }
    return Promise.resolve(out);
  }

  fetchRange(
    pair: Pair,
    from: TradingDate,
    to: TradingDate,
  ): Promise<Result<readonly RawCandle[], OhlcFeedError>> {
    void from;
    void to;
    this.rangeCalls.push(pair);
    return Promise.resolve(this.#range);
  }
}

describe("ProviderChain.resolveLatest", () => {
  it("the first provider that returns usable candles wins the pair", async () => {
    const fcs = new StubProvider("FCS", true, false, {
      latest: new Map([["EURUSD", ok([candle("EURUSD", "FCS")])]]),
    });
    const td = new StubProvider("TwelveData", true, true, {
      latest: new Map([["EURUSD", ok([candle("EURUSD", "TwelveData")])]]),
    });
    const chain = chainFromProviders([fcs, td]);
    const result = await chain.resolveLatest(["EURUSD"], "2026-09-16");
    const outcome = result.get("EURUSD")!;
    expect(isResolved(outcome)).toBe(true);
    if (isResolved(outcome)) {
      expect(outcome.provider).toBe("FCS");
    }
    // A won pair is removed from the outstanding set — TwelveData is never asked.
    expect(td.latestCalls).toHaveLength(0);
  });

  it("advances to the next provider for pairs the first could not serve", async () => {
    const fcs = new StubProvider("FCS", true, false, {
      latest: new Map([["EURUSD", ok([candle("EURUSD", "FCS")])]]),
    });
    const td = new StubProvider("TwelveData", true, true, {
      latest: new Map([["GBPUSD", ok([candle("GBPUSD", "TwelveData")])]]),
    });
    const chain = chainFromProviders([fcs, td]);
    const result = await chain.resolveLatest(["EURUSD", "GBPUSD"], "2026-09-16");

    const eur = result.get("EURUSD")!;
    const gbp = result.get("GBPUSD")!;
    expect(isResolved(eur) && eur.provider).toBe("FCS");
    expect(isResolved(gbp) && gbp.provider).toBe("TwelveData");
    // TwelveData is asked only for the still-outstanding GBPUSD.
    expect(td.latestCalls).toEqual([["GBPUSD"]]);
  });

  it("skips a provider that lacks supportsLatest", async () => {
    const noLatest = new StubProvider("RangeOnly", false, true, {
      latest: new Map([["EURUSD", ok([candle("EURUSD", "RangeOnly")])]]),
    });
    const td = new StubProvider("TwelveData", true, true, {
      latest: new Map([["EURUSD", ok([candle("EURUSD", "TwelveData")])]]),
    });
    const chain = chainFromProviders([noLatest, td]);
    const result = await chain.resolveLatest(["EURUSD"], "2026-09-16");
    const eur = result.get("EURUSD")!;
    expect(isResolved(eur) && eur.provider).toBe("TwelveData");
    expect(noLatest.latestCalls).toHaveLength(0);
  });

  it("advances past an empty result and an errored result", async () => {
    const empty = new StubProvider("FCS", true, false, {
      latest: new Map([["EURUSD", ok([])]]), // 200 but no usable candle
    });
    const erroring = new StubProvider("TwelveData", true, true, {
      latest: new Map([["EURUSD", err(feedError("TwelveData", "EURUSD", "unavailable"))]]),
    });
    const winner = new StubProvider("Massive", true, true, {
      latest: new Map([["EURUSD", ok([candle("EURUSD", "Massive")])]]),
    });
    const chain = chainFromProviders([empty, erroring, winner]);
    const result = await chain.resolveLatest(["EURUSD"], "2026-09-16");
    const eur = result.get("EURUSD")!;
    expect(isResolved(eur) && eur.provider).toBe("Massive");
  });

  it("resolves to a typed secret-free error when every provider fails", async () => {
    const a = new StubProvider("FCS", true, false, {
      latest: new Map([["EURUSD", err(feedError("FCS", "EURUSD", "unavailable"))]]),
    });
    const b = new StubProvider("TwelveData", true, true, {
      latest: new Map([["EURUSD", err(feedError("TwelveData", "EURUSD", "invalid"))]]),
    });
    const chain = chainFromProviders([a, b]);
    const result = await chain.resolveLatest(["EURUSD"], "2026-09-16");
    const eur = result.get("EURUSD")!;
    expect(isResolved(eur)).toBe(false);
    if (!isResolved(eur)) {
      expect(eur.reason).toBe("ohlc_feed_error");
      expect(eur.message.length).toBeGreaterThan(0);
    }
  });
});

describe("ProviderChain.resolveRange", () => {
  it("skips FCS (no range support) so Twelve Data serves the range", async () => {
    const fcs = new StubProvider("FCS", true, false);
    const td = new StubProvider("TwelveData", true, true, {
      range: ok([candle("EURUSD", "TwelveData")]),
    });
    const chain = chainFromProviders([fcs, td]);
    const outcome = await chain.resolveRange("EURUSD", "2026-09-01", "2026-09-15");
    expect(isResolved(outcome) && outcome.provider).toBe("TwelveData");
    // FCS is never asked for a range.
    expect(fcs.rangeCalls).toHaveLength(0);
    expect(td.rangeCalls).toEqual(["EURUSD"]);
  });

  it("advances past an erroring range provider to the next", async () => {
    const td = new StubProvider("TwelveData", true, true, {
      range: err(feedError("TwelveData", "EURUSD", "unavailable")),
    });
    const mv = new StubProvider("Massive", true, true, {
      range: ok([candle("EURUSD", "Massive")]),
    });
    const chain = chainFromProviders([td, mv]);
    const outcome = await chain.resolveRange("EURUSD", "2026-09-01", "2026-09-15");
    expect(isResolved(outcome) && outcome.provider).toBe("Massive");
  });

  it("resolves to a typed secret-free error when no provider can serve the range", async () => {
    const fcs = new StubProvider("FCS", true, false);
    const td = new StubProvider("TwelveData", true, true, {
      range: err(feedError("TwelveData", "EURUSD", "empty")),
    });
    const chain = chainFromProviders([fcs, td]);
    const outcome = await chain.resolveRange("EURUSD", "2026-09-01", "2026-09-15");
    expect(isResolved(outcome)).toBe(false);
    if (!isResolved(outcome)) {
      expect(outcome.reason).toBe("ohlc_feed_error");
    }
  });

  it("resolves to a typed error when the chain is empty", async () => {
    const chain = chainFromProviders([]);
    const outcome = await chain.resolveRange("EURUSD", "2026-09-01", "2026-09-15");
    expect(isResolved(outcome)).toBe(false);
    if (!isResolved(outcome)) {
      expect(outcome.mode).toBe("unconfigured");
    }
  });
});
