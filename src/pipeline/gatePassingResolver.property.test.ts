// Property test for the GatePassingResolver (dashboard-data-activation
// Task 5.2; design Component 5).
//
// Feature: dashboard-data-activation, Property 4: Resolver reflects recorded PASS / no-PASS exactly
//
// **Validates: Requirements 3.2, 3.6**
//
// Property 4 — for any pair / Decision_Date, `makeGatePassingResolver(deps)`
// resolves `true` when a PASS exists for the pair's active config and `false`
// when none exists, never surfacing an un-passed pair. The resolver is driven
// through its injected `latestPassVerdict` dep (Req 3.2, 3.6): a no-network
// stub keyed on a recorded verdict history returns `{ verdictId }` when a PASS
// is recorded for the active `config_id` and `null` otherwise. No live
// infrastructure is touched and no gate math is re-run — the stub is a pure
// read over the modelled recorded rows, mirroring the real adapter's
// `latestPassVerdict` helper.
//
// The resolution hinges only on whether the pair's active config
// (`activeConfigFor(pair)`, defaulting to `` `${pair}-active` ``) has a recorded
// PASS, so the generated history is a set of config ids that passed. For each
// generated pair the expected result is exactly "the pair's active config id is
// in that passing set", which is the invariant asserted here.

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { PAIRS, type Pair } from "../ingestion/types.js";
import type { TradingDate } from "../guard/types.js";
import {
  makeGatePassingResolver,
  type GatePassingResolverDeps,
} from "./gatePassingResolver.js";

/**
 * A no-network stub `latestPassVerdict` over a modelled recorded-verdict
 * history: `passingConfigs` is the set of `config_id`s with a recorded PASS. It
 * returns `{ verdictId }` for a config in that set (deriving a stable id as the
 * real adapter would read back the newest PASS row's id) and `null` otherwise —
 * never hitting any live store.
 */
function latestPassVerdictStub(
  passingConfigs: ReadonlySet<string>,
): GatePassingResolverDeps["latestPassVerdict"] {
  return (configId: string) =>
    Promise.resolve(
      passingConfigs.has(configId)
        ? { verdictId: `verdict-${configId}` }
        : null,
    );
}

/** The default `Pair → config_id` naming the resolver and Gate_Run share. */
const activeConfigFor = (pair: Pair): string => `${pair}-active`;

/** Arbitrary over the five supported FX pairs. */
const pairArb: fc.Arbitrary<Pair> = fc.constantFrom<Pair>(...PAIRS);

/**
 * A `YYYY-MM-DD` Decision_Date generated from day offsets (no invalid-time
 * edge). The resolver's result does not vary with the date under the
 * recommended-default mapping, so the date is varied purely to exercise the
 * full `(pair, decisionDate)` contract surface.
 */
const decisionDateArb: fc.Arbitrary<TradingDate> = fc
  .integer({ min: 0, max: 13_000 })
  .map((offset) =>
    new Date(Date.UTC(2000, 0, 1) + offset * 86_400_000)
      .toISOString()
      .slice(0, 10),
  );

/**
 * An arbitrary recorded-verdict history: the subset of pairs whose active
 * config has a recorded PASS. Modelled as a set of `config_id`s so the resolver
 * reads exactly the active-config PASS state and nothing else.
 */
const passingSetArb: fc.Arbitrary<ReadonlySet<string>> = fc
  .subarray([...PAIRS])
  .map((pairs) => new Set(pairs.map((p) => activeConfigFor(p))));

describe("Property 4: Resolver reflects recorded PASS / no-PASS exactly", () => {
  it("resolves true iff a PASS is recorded for the pair's active config, false otherwise", async () => {
    await fc.assert(
      fc.asyncProperty(
        pairArb,
        decisionDateArb,
        passingSetArb,
        async (pair, decisionDate, passingConfigs) => {
          const deps: GatePassingResolverDeps = {
            // The resolver reads only through `latestPassVerdict`; the two
            // adapters are never touched for this property, so unused stubs are
            // sufficient and keep the test off any live store.
            gateVerdictStore: {} as GatePassingResolverDeps["gateVerdictStore"],
            featureRegistryStore:
              {} as GatePassingResolverDeps["featureRegistryStore"],
            activeConfigFor,
            latestPassVerdict: latestPassVerdictStub(passingConfigs),
          };

          const resolve = makeGatePassingResolver(deps);
          const result = await resolve(pair, decisionDate);

          // The ground truth: a PASS backs this pair iff its active config id
          // is in the recorded passing set.
          const expected = passingConfigs.has(activeConfigFor(pair));
          expect(result).toBe(expected);

          // Never surface an un-passed pair as passing.
          if (!expected) {
            expect(result).toBe(false);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
