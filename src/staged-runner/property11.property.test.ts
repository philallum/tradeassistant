// Property 11: A failed stage stops the composed run.
//
// Feature: operational-wiring, Property 11: A failed stage stops the composed run
// Validates: Requirements 2.9
//
// Requirement 2.9: if any stage in the composed end-to-end run fails, the run
// stops at the failed stage and does NOT execute subsequent stages.
//
// The stages are module-level functions, not injected into `runAll`, so this
// property forces a GENUINE stage failure by driving the real `runAll` over
// unseeded in-memory candle/vector stores: backfill runs and succeeds but — fed
// only header-only CSVs — stores no candles and no vectors, so the backtest
// stage hits its missing-prerequisite guard and aborts with `ok: false`.
//
// We then assert the composed run STOPS at backtest and the later forwardLook
// stage produces NO side effects:
//   - the returned `stages` array ends at the failed backtest (forwardLook is
//     never recorded), and
//   - forwardLook's `persistView` is never invoked.
//
// To prove the stop is caused by the failure and not merely by forwardLook's own
// prerequisites being unmet, we seed forwardLook's prerequisites (stored vectors
// + matured outcomes). Even though forwardLook COULD run, it must not, because
// backtest failed first.

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { runAll } from "./stagedRunner.js";
import { makeTrackedComposedRunDeps } from "./testHelpers.js";

// Feature: operational-wiring, Property 11: A failed stage stops the composed run

describe("Property 11: A failed stage stops the composed run", () => {
  it(
    "when backtest fails, the composed run stops and forwardLook produces no side effects",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          // A Decision_Date and the strictly-earlier prior date used for the
          // seeded forwardLook prerequisites. Varied so the failure-stop
          // invariant is exercised across inputs, not a single fixture.
          fc
            .integer({ min: 0, max: 3650 })
            .map((d) =>
              new Date(Date.UTC(2018, 0, 2) + d * 86_400_000).toISOString().slice(0, 10),
            ),
          async (decisionDate) => {
            // No csvContents → every pair is fed a header-only CSV → backfill
            // stores NOTHING. seedForward:true seeds forwardLook's prerequisites
            // so that forwardLook would be ABLE to run if it were reached.
            const deps = await makeTrackedComposedRunDeps({
              seedForward: true,
              decisionDate,
              priorDate: "2016-01-01",
            });

            // Feature: operational-wiring, Property 11: A failed stage stops the composed run
            const { stages } = await runAll(deps, "backfill");

            const ran = stages.map((s) => s.stage);

            // The run reached backfill (ok) then backtest (failed) and stopped.
            expect(ran).toEqual(["backfill", "backtest"]);

            const backfill = stages.find((s) => s.stage === "backfill")!;
            expect(backfill.result.ok).toBe(true);

            const backtest = stages.find((s) => s.stage === "backtest")!;
            expect(backtest.result.ok).toBe(false);
            if (!backtest.result.ok) {
              // The failure names the missing prerequisite (not a fabricated
              // success) — a genuine abort, not an empty pass.
              expect(backtest.result.missingPrerequisite.length).toBeGreaterThan(0);
            }

            // forwardLook was never recorded — the run stopped at the failure.
            expect(ran).not.toContain("forwardLook");

            // The decisive side-effect assertion: forwardLook's persistView was
            // NEVER invoked, so no later-stage side effect occurred even though
            // forwardLook's own prerequisites were satisfied.
            expect(deps.persistViewCount()).toBe(0);
          },
        ),
        { numRuns: 100 },
      );
    },
  );
});
