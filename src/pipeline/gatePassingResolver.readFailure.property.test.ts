import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  makeGatePassingResolver,
  type GatePassingResolverDeps,
} from "./gatePassingResolver.js";
import { InMemoryGateVerdictStore } from "../kill-gate/types.js";
import { InMemoryFeatureRegistryStore } from "../feature-registry/types.js";
import { PAIRS, type Pair } from "../ingestion/types.js";
import type { TradingDate } from "../guard/types.js";

// Feature: dashboard-data-activation, Property 5: Resolver never coerces true on read failure
//
// Validates: Requirements 3.8
//
// For ANY induced store/read failure, the resolver promise REJECTS and never
// resolves `true`. The failure is induced purely in the injected
// `latestPassVerdict` read helper (the gate-verdict adapter's read path): the
// stub rejects with an arbitrary error. The resolver must surface that failure
// unchanged — it must NOT swallow it and must NOT coerce gate-passing to `true`
// for any Pair (Requirement 3.8).
//
// No-network / offline stub idiom: the required `gateVerdictStore` /
// `featureRegistryStore` deps are the dependency-free in-memory reference
// implementations, and `latestPassVerdict` is a local stub — no live
// infrastructure is ever touched.

/** Bounded trading-date arbitrary (never yields an invalid Date). */
const tradingDateArb: fc.Arbitrary<TradingDate> = fc
  .integer({ min: 0, max: 9131 }) // 2000-01-01 through ~2025-01-01
  .map((days) =>
    new Date(Date.UTC(2000, 0, 1) + days * 86_400_000)
      .toISOString()
      .slice(0, 10),
  );

const pairArb: fc.Arbitrary<Pair> = fc.constantFrom(...PAIRS);

/**
 * Arbitrary store/read failure, modelled as a varied `Error` — the realistic
 * shape of an unreachable backing store (Req 3.8's "store is unreachable"). The
 * message and name vary across runs so the property holds for ANY induced
 * failure, not one fixed error.
 */
const errorArb: fc.Arbitrary<Error> = fc
  .record({ name: fc.string(), message: fc.string() })
  .map(({ name, message }) => {
    const err = new Error(message);
    err.name = name;
    return err;
  });

describe("Property 5: resolver never coerces true on read failure", () => {
  it("rejects (and never resolves true) for any induced read failure", async () => {
    await fc.assert(
      fc.asyncProperty(
        pairArb,
        tradingDateArb,
        errorArb,
        async (pair, decisionDate, reason) => {
          // Induce the store/read failure in the injected read helper only.
          const deps: GatePassingResolverDeps = {
            gateVerdictStore: new InMemoryGateVerdictStore(),
            featureRegistryStore: new InMemoryFeatureRegistryStore(),
            latestPassVerdict: () => {
              throw reason;
            },
          };

          const resolver = makeGatePassingResolver(deps);

          // The resolver must REJECT (surfacing the failure unchanged) and must
          // NEVER resolve `true`. Probe the raw promise directly so a (wrong)
          // resolution to `true` is observed on the settlement outcome rather
          // than masked by a rejection-only assertion.
          let resolved: boolean | undefined;
          let didReject = false;
          try {
            resolved = await Promise.resolve(resolver(pair, decisionDate));
          } catch {
            didReject = true;
          }
          // Surfaced the read failure (Req 3.8: never silently swallowed)...
          expect(didReject).toBe(true);
          // ...and never coerced gate-passing to `true` for any Pair.
          expect(resolved).not.toBe(true);
          expect(resolved).toBeUndefined();
        },
      ),
      { numRuns: 200 },
    );
  });
});
