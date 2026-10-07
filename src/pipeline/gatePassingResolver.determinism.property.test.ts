import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { makeGatePassingResolver } from "./gatePassingResolver.js";
import type { Pair } from "../ingestion/types.js";
import type { TradingDate } from "../guard/types.js";
import type { GateVerdictStore } from "../kill-gate/types.js";
import type { FeatureRegistryStore } from "../feature-registry/types.js";

// Feature: dashboard-data-activation, Property 6: Resolver is deterministic over a fixed history
//
// *For any* fixed recorded-verdict history (a `latestPassVerdict` that is a pure
// function of `config_id`) and a fixed Decision_Date, repeated invocations of the
// resolver for the same pair/date yield identical boolean results. The resolver is
// a pure, read-only view over the recorded rows (design Component 5): it re-runs no
// backtest and re-computes no gate math, so holding the history and date fixed must
// leave every invocation producing the same value (parent Req 3.1, 16.7).
//
// Validates: Requirements 3.7

const NUM_RUNS = 200; // >= 100 iterations per spec convention.

const PAIRS: readonly Pair[] = [
  "EURUSD",
  "GBPUSD",
  "USDJPY",
  "USDCHF",
  "USDCAD",
] as const;

/**
 * The resolver only reaches storage through `latestPassVerdict`; the two store
 * ports are part of the injected deps shape but are never touched by the
 * read path under test. These no-network stubs stand in for them so the test
 * never approaches live infrastructure.
 */
const unusedStoreStub = <T>(): T =>
  new Proxy(
    {},
    {
      get() {
        throw new Error(
          "store method must not be called by the resolver read path",
        );
      },
    },
  ) as T;

/** A bounded ISO Decision_Date arbitrary (safe — never an invalid Date). */
const decisionDateArb: fc.Arbitrary<TradingDate> = fc
  .integer({ min: 0, max: 9131 }) // days from 2000-01-01 through ~2025-01-01
  .map((days) => {
    const d = new Date(Date.UTC(2000, 0, 1) + days * 86_400_000);
    return d.toISOString().slice(0, 10);
  });

describe("gatePassingResolver — Property 6: deterministic over a fixed history", () => {
  it("yields identical results across repeated invocations for a fixed history + Decision_Date", async () => {
    await fc.assert(
      fc.asyncProperty(
        // A fixed recorded-verdict history: for each pair's active config, record
        // whether a PASS exists (and, when it does, a stable verdict id). This map
        // is the complete recorded history the resolver reads over.
        fc.dictionary(
          fc.constantFrom(...PAIRS).map((p) => `${p}-active`),
          fc.option(
            fc.string({ minLength: 1, maxLength: 24 }).map((verdictId) => ({
              verdictId,
            })),
            { nil: null },
          ),
        ),
        // The pair whose active config is resolved.
        fc.constantFrom(...PAIRS),
        // A fixed Decision_Date for the invocation(s).
        decisionDateArb,
        // The number of repeated invocations (>= 2) to compare.
        fc.integer({ min: 2, max: 6 }),
        async (history, pair, decisionDate, repeats) => {
          // `latestPassVerdict` is a PURE function of `config_id`: it reads the
          // fixed history and never mutates it, so the resolver's view is stable.
          const latestPassVerdict = (
            configId: string,
          ): Promise<{ readonly verdictId: string } | null> =>
            Promise.resolve(history[configId] ?? null);

          // Construct the resolver ONCE over the fixed history.
          const resolve = makeGatePassingResolver({
            gateVerdictStore: unusedStoreStub<GateVerdictStore>(),
            featureRegistryStore: unusedStoreStub<FeatureRegistryStore>(),
            latestPassVerdict,
          });

          // Invoke it `repeats` times for the SAME pair/date.
          const results: boolean[] = [];
          for (let i = 0; i < repeats; i += 1) {
            results.push(await resolve(pair, decisionDate));
          }

          // Every invocation must agree with the first.
          const [first] = results;
          for (const r of results) {
            expect(r).toBe(first);
          }

          // And that stable value must reflect the fixed history exactly: `true`
          // iff a PASS is recorded for the pair's active config.
          const recorded = history[`${pair}-active`] ?? null;
          expect(first).toBe(recorded !== null);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
