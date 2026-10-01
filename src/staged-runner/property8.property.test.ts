// Property 8: The composed run always runs stages in dependency order.
//
// Feature: operational-wiring, Property 8: The composed run always runs stages in dependency order
// Validates: Requirements 2.6
//
// Requirement 2.6: the composed end-to-end run orders Backfill_Stage before
// Backtest_Stage and Backtest_Stage before Forward_Look_Stage, because each
// stage consumes the prior stage's stored output.
//
// The three stages are module-level functions, not values injected into
// `runAll`, so this property drives the REAL `runAll` over in-memory stores and
// observes the actual invocation order two ways:
//
//   1. The `stages` array `runAll` returns records every stage that executed,
//      in execution order. We assert it is always a PREFIX of the canonical
//      order [backfill, backtest, forwardLook] — never reordered, never
//      skipping an earlier stage — and that a later stage appears only when the
//      immediately-prior stage returned `ok: true`.
//   2. The genuine downstream side effects (RESEARCH-LOG append for backtest,
//      persistView for forwardLook) confirm that a stage recorded as "not run"
//      genuinely produced no output.
//
// Random seeding makes the run stop at different points (after backfill, after
// backtest, or a full three-stage run), so the ordering invariant is exercised
// across all composed-run shapes rather than a single happy path.

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import type { Pair } from "../ingestion/types.js";
import { PAIRS } from "../ingestion/types.js";
import type { StageName } from "./types.js";
import { runAll } from "./stagedRunner.js";
import { buildCsvContent, makeTrackedComposedRunDeps } from "./testHelpers.js";

const CANONICAL_ORDER: readonly StageName[] = [
  "backfill",
  "backtest",
  "forwardLook",
];

// A bounded set of distinct trading dates (sorted, de-duplicated) suitable for
// a CSV. Enough history that backfill stores candles + vectors for the pair.
const datesArb = fc
  .array(
    fc.integer({ min: 0, max: 2000 }).map((d) =>
      new Date(Date.UTC(2015, 0, 5) + d * 86_400_000).toISOString().slice(0, 10),
    ),
    { minLength: 2, maxLength: 20 },
  )
  .map((raw) => [...new Set(raw)].sort());

// Feature: operational-wiring, Property 8: The composed run always runs stages in dependency order

describe("Property 8: The composed run always runs stages in dependency order", () => {
  it(
    "runAll executes stages as a prefix of backfill → backtest → forwardLook, each only after the prior stage succeeded",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          // Which pairs get fed candles (controls whether backtest's
          // prerequisite is met) — may be empty so backtest aborts.
          fc.uniqueArray(fc.constantFrom<Pair>(...PAIRS), {
            minLength: 0,
            maxLength: PAIRS.length,
          }),
          datesArb,
          // Whether forwardLook's prerequisites (vectors + matured outcomes)
          // are pre-seeded, so a successful backtest can be followed by a
          // genuine forwardLook run.
          fc.boolean(),
          async (fedPairs, dates, seedForward) => {
            const csvContents: Partial<Record<Pair, string>> = {};
            for (const pair of fedPairs) {
              csvContents[pair] = buildCsvContent(dates);
            }

            const deps = await makeTrackedComposedRunDeps({
              csvContents,
              seedForward,
            });

            // Feature: operational-wiring, Property 8: The composed run always runs stages in dependency order
            const { stages } = await runAll(deps, "backfill");

            const ran = stages.map((s) => s.stage);

            // (1) The executed stages are a PREFIX of the canonical order: the
            // sequence is never reordered and never skips an earlier stage.
            expect(ran).toEqual(CANONICAL_ORDER.slice(0, ran.length));

            // (2) The run always starts with backfill and runs at least it.
            expect(ran.length).toBeGreaterThanOrEqual(1);
            expect(ran[0]).toBe("backfill");

            // (3) A later stage appears ONLY when the immediately-prior stage
            // returned ok:true — the run stops at the first failure.
            for (let i = 1; i < stages.length; i++) {
              expect(stages[i - 1]!.result.ok).toBe(true);
            }
            // The last-recorded stage is the only one allowed to have failed;
            // if the run stopped early, that stage failed. If it ran all three,
            // forwardLook is last and may be ok or not.
            for (let i = 0; i < stages.length - 1; i++) {
              expect(stages[i]!.result.ok).toBe(true);
            }

            // (4) Side-effect cross-check: a stage that was NOT recorded as run
            // produced no observable output.
            const backtestRan = ran.includes("backtest");
            const forwardRan = ran.includes("forwardLook");

            // forwardLook never runs before backtest ran and succeeded.
            if (forwardRan) {
              expect(backtestRan).toBe(true);
              const backtest = stages.find((s) => s.stage === "backtest")!;
              expect(backtest.result.ok).toBe(true);
            }

            // If forwardLook never ran, persistView must never have fired.
            if (!forwardRan) {
              expect(deps.persistViewCount()).toBe(0);
            }

            // If backtest never ran, RESEARCH-LOG was never written by it.
            if (!backtestRan) {
              expect(deps.researchLogWritten()).toBe(false);
            }
          },
        ),
        { numRuns: 100 },
      );
    },
  );
});
