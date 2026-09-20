import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { LlmInterface, type LlmProvider } from "../llm/llmInterface.js";
import {
  InMemoryRoleRejectionRecorder,
  type RiskFlag,
  type RoleInput,
  type RoleOutput,
  type SanctionedRole,
} from "../llm/types.js";
import { riskFlag, suppress } from "./newsFilter.js";
import { ALL_PAIRS, InMemoryNewsRiskFlagStore, PAIRS, type Pair } from "./types.js";

// Feature: fx-daily-pattern-assistant, Property 29: For all Pairs and Decision_Dates where the news filter indicates elevated event risk, any otherwise-firing setup for that Pair is suppressed and the stated reason is recorded.
//
// Validates: Requirement 14.4
//
// The News Filter is a SUPPRESSOR ONLY (Requirement 14.5): its deterministic
// `suppress()` decides whether an OTHERWISE-FIRING setup is silenced, and on
// suppression it records the flag's STATED REASON (Requirement 14.4). This
// property drives arbitrary Pairs and Decision_Dates through the pipeline with
// an "elevated" or "high" RiskFlag carrying an arbitrary non-empty reason and
// asserts, across ≥100 generated cases:
//
//   1. Suppression — an otherwise-firing setup (modelled as `fires = true`) is
//      SUPPRESSED: `suppress(flag).suppressed === true`, so the setup is no
//      longer surfaced. (Requirement 14.4)
//   2. Stated reason recorded — the decision carries the flag's reason
//      (`suppress(flag).reason === flag.reason`) AND, after `riskFlag()`
//      persists per-pair via an InMemoryNewsRiskFlagStore, the stored
//      NewsRiskFlagRow for (decisionDate, pair) durably records the same
//      `level` and `reason`. (Requirement 14.4)
//   3. Contrast — a "none" flag does NOT suppress, so the otherwise-firing
//      setup is PERMITTED; suppression is specifically tied to elevated/high
//      event risk.
//
// The LLM is a deterministic fake returning the generated flag, and the clock
// is fixed, so identical inputs always yield identical outcomes.

/** A clock that returns a fixed timestamp for deterministic behaviour. */
const fixedClock = { now: () => "2026-03-16T12:00:00.000Z" };

/** Build a real LlmInterface backed by a fake provider that returns `flag`. */
function llmReturning(flag: RiskFlag): LlmInterface {
  const provider: LlmProvider = {
    complete<R extends SanctionedRole>(role: R, input: RoleInput[R]): Promise<RoleOutput[R]> {
      void role;
      void input;
      return Promise.resolve(flag as RoleOutput[R]);
    },
  };
  return new LlmInterface({
    provider,
    rejectionRecorder: new InMemoryRoleRejectionRecorder(),
    clock: fixedClock,
  });
}

/**
 * An otherwise-firing setup: a setup the deterministic engine WOULD surface
 * (`fires = true`). Applying the news suppression flips it to not-surfaced when
 * the decision suppresses.
 */
interface Setup {
  readonly pair: Pair;
  readonly fires: boolean;
}

/** An arbitrary Decision_Date-shaped string (ISO-8601 YYYY-MM-DD). */
const decisionDateArb: fc.Arbitrary<string> = fc
  .record({
    year: fc.integer({ min: 2000, max: 2099 }),
    month: fc.integer({ min: 1, max: 12 }),
    day: fc.integer({ min: 1, max: 28 }),
  })
  .map(
    ({ year, month, day }) =>
      `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  );

/** An arbitrary non-empty reason string. */
const reasonArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 80 })
  .filter((s) => s.trim().length > 0);

/** An elevated / high RiskFlag with an arbitrary non-empty reason. */
const elevatedFlagArb: fc.Arbitrary<RiskFlag> = fc.record({
  level: fc.constantFrom<RiskFlag["level"]>("elevated", "high"),
  reason: reasonArb,
});

describe("Property 29: elevated event risk suppresses an otherwise-firing setup", () => {
  it("suppresses an otherwise-firing setup and records the stated reason (decision + persisted flag)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...PAIRS),
        decisionDateArb,
        elevatedFlagArb,
        async (pair, decisionDate, flag) => {
          // An otherwise-firing setup for this pair: the engine WOULD surface it.
          const setup: Setup = { pair, fires: true };

          const store = new InMemoryNewsRiskFlagStore();
          const llm = llmReturning(flag);

          // The news_filter role produces the structured flag; riskFlag()
          // persists it per pair (feedOk = true).
          const returned = await riskFlag(decisionDate, [], llm, store);
          expect(returned).toEqual(flag);

          const decision = suppress(returned);

          // (1) The otherwise-firing setup is SUPPRESSED.
          expect(decision.suppressed).toBe(true);
          // Applying the suppression flips the setup to not-surfaced.
          const surfaced = setup.fires && !decision.suppressed;
          expect(surfaced).toBe(false);

          // (2a) The STATED REASON is recorded on the decision.
          expect(decision.reason).toBe(flag.reason);

          // (2b) The stated reason is DURABLY recorded for (decisionDate, pair).
          const row = await store.getFlag(decisionDate, pair);
          expect(row).not.toBeNull();
          expect(row?.level).toBe(flag.level);
          expect(row?.reason).toBe(flag.reason);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("suppression is durably recorded for EVERY pair on the Decision_Date", async () => {
    await fc.assert(
      fc.asyncProperty(decisionDateArb, elevatedFlagArb, async (decisionDate, flag) => {
        const store = new InMemoryNewsRiskFlagStore();
        const llm = llmReturning(flag);

        await riskFlag(decisionDate, [], llm, store);
        const decision = suppress(flag);
        expect(decision.suppressed).toBe(true);

        for (const pair of ALL_PAIRS) {
          const row = await store.getFlag(decisionDate, pair);
          expect(row?.level).toBe(flag.level);
          expect(row?.reason).toBe(flag.reason);
          // Applying the elevated-risk suppression silences each pair's
          // otherwise-firing setup.
          const setup: Setup = { pair, fires: true };
          const surfaced = setup.fires && !decision.suppressed;
          expect(surfaced).toBe(false);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("contrast: a `none` flag does NOT suppress — the otherwise-firing setup is permitted", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...PAIRS),
        decisionDateArb,
        reasonArb,
        async (pair, decisionDate, reason) => {
          const flag: RiskFlag = { level: "none", reason };
          const setup: Setup = { pair, fires: true };

          const store = new InMemoryNewsRiskFlagStore();
          const llm = llmReturning(flag);
          await riskFlag(decisionDate, [], llm, store);

          const decision = suppress(flag);

          // No suppression => the otherwise-firing setup remains surfaced.
          expect(decision.suppressed).toBe(false);
          const surfaced = setup.fires && !decision.suppressed;
          expect(surfaced).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});
