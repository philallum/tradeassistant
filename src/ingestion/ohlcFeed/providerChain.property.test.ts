import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { err, ok, type Result } from "../../guard/types.js";
import type { TradingDate } from "../../guard/types.js";
import { PAIRS, type Pair, type RawCandle } from "../types.js";
import { chainFromProviders, isResolved } from "./providerChain.js";
import type { OhlcFeedError, OhlcFeedProvider } from "./types.js";

// Feature: daily-candle-freshness-and-cleanup, Property 3: fallback-chain first-usable-wins per pair
//
// Validates: Requirements 1.3, 4.1
//
// Given random per-provider per-pair outcome assignments (usable / error /
// empty / unconfigured / missing-capability), the resolved winner for each pair
// is the EARLIEST provider in the fixed order that could serve it, and no later
// provider overwrites a pair already won by an earlier one.

type LatestMap = ReadonlyMap<Pair, Result<readonly RawCandle[], OhlcFeedError>>;

/** The possible per-pair outcomes a provider can be assigned for a run. */
type Outcome = "usable" | "empty" | "error" | "missing";

const outcomeArb = fc.constantFrom<Outcome>("usable", "empty", "error", "missing");

/** A provider that is present but may lack the latest capability. */
interface ProviderPlan {
  readonly name: string;
  readonly supportsLatest: boolean;
  readonly perPair: ReadonlyMap<Pair, Outcome>;
}

function candle(pair: Pair, source: string): RawCandle {
  return { asset: pair, pair, date: "2026-09-15", open: 1, high: 2, low: 0.5, close: 1.5, source };
}

function feedError(provider: string, pair: Pair): OhlcFeedError {
  return { reason: "ohlc_feed_error", mode: "unavailable", provider, pair, message: `${provider} failed ${pair}` };
}

class PlanProvider implements OhlcFeedProvider {
  readonly supportsRange = true;
  constructor(private readonly plan: ProviderPlan) {}
  get name(): string {
    return this.plan.name;
  }
  get supportsLatest(): boolean {
    return this.plan.supportsLatest;
  }
  fetchLatest(pairs: readonly Pair[], asOf: TradingDate): Promise<LatestMap> {
    void asOf;
    const out = new Map<Pair, Result<readonly RawCandle[], OhlcFeedError>>();
    for (const pair of pairs) {
      const outcome = this.plan.perPair.get(pair) ?? "missing";
      switch (outcome) {
        case "usable":
          out.set(pair, ok([candle(pair, this.plan.name)]));
          break;
        case "empty":
          out.set(pair, ok([]));
          break;
        case "error":
          out.set(pair, err(feedError(this.plan.name, pair)));
          break;
        case "missing":
          out.set(pair, err(feedError(this.plan.name, pair)));
          break;
      }
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
    return Promise.resolve(err(feedError(this.plan.name, pair)));
  }
}

/** For a provider plan, can it actually serve `pair` (capability + usable)? */
function providerServes(plan: ProviderPlan, pair: Pair): boolean {
  return plan.supportsLatest && plan.perPair.get(pair) === "usable";
}

const providerPlanArb = (name: string): fc.Arbitrary<ProviderPlan> =>
  fc.record({
    name: fc.constant(name),
    supportsLatest: fc.boolean(),
    perPair: fc
      .tuple(outcomeArb, outcomeArb, outcomeArb, outcomeArb, outcomeArb)
      .map((outcomes) => new Map(PAIRS.map((pair, i) => [pair, outcomes[i]!] as const))),
  });

const scenarioArb = fc.tuple(
  providerPlanArb("FCS"),
  providerPlanArb("TwelveData"),
  providerPlanArb("Massive"),
);

describe("Property 3: fallback-chain first-usable-wins per pair", () => {
  it("resolves each pair to the earliest usable provider; no later overwrite", async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (plans) => {
        const providers = plans.map((plan) => new PlanProvider(plan));
        const chain = chainFromProviders(providers);
        const result = await chain.resolveLatest(PAIRS, "2026-09-16");

        for (const pair of PAIRS) {
          const expectedWinner = plans.find((plan) => providerServes(plan, pair));
          const outcome = result.get(pair)!;

          if (expectedWinner === undefined) {
            // No provider could serve this pair → a typed secret-free error.
            expect(isResolved(outcome)).toBe(false);
            if (!isResolved(outcome)) {
              expect(outcome.reason).toBe("ohlc_feed_error");
            }
          } else {
            // The resolved winner is the earliest usable provider, and the
            // candle's source matches that provider (no later overwrite).
            expect(isResolved(outcome)).toBe(true);
            if (isResolved(outcome)) {
              expect(outcome.provider).toBe(expectedWinner.name);
              expect(outcome.candles[0]?.source).toBe(expectedWinner.name);
            }
          }
        }
      }),
      { numRuns: 200 },
    );
  });
});
