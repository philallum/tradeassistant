// Unit test for the scheduled-run container entry wiring (task 6.2;
// dashboard-data-activation Requirements 3.4, 3.5).
//
// Two independent assertions, both deterministic and network-free:
//
//   1. WIRING (Req 3.4): the production `loadEvaluations` seam in `main.ts`
//      passes a DEFINED (non-undefined) `gatePassing` resolver into
//      `makePipelineLoader`. We mock the pipeline module so `makePipelineLoader`
//      becomes a capturing spy and assert the `PipelineDeps` it receives carry
//      a `gatePassing` that is a function — i.e. `evaluatePair` will use the
//      injected resolver rather than the `resolveGatePassingDefault = () =>
//      false` fallback.
//
//   2. FIRING PRECONDITION UNCHANGED (Req 3.5): the `fires()` predicate in
//      `src/dashboard/dashboard.ts` is byte-for-byte
//      `gatePassing && !newsSuppressed && direction !== "FLAT" &&
//      earnedConfidence >= confidenceThreshold`. We assert that exact source
//      text is present AND confirm the behaviour with a truth table over
//      `dailyRun` (which fires a card ONLY when all four conditions hold).
//
// Importing `main.ts` must NOT start a run: its top-level `main()` is guarded by
// the `invokedDirectly()` entry-point check (mirroring `src/ops/seed-run/main.ts`),
// so under vitest (where `process.argv[1]` is the test runner) it stays dormant.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { dailyRun, type PairEvaluation } from "../dashboard/index.js";
import type { Confidence } from "../confidence/types.js";
import type { SupabaseConfig } from "../storage/supabaseConfig.js";
import type { PipelineDeps } from "../pipeline/types.js";

// --- Mock the pipeline module so `makePipelineLoader` captures its deps -------
// We keep every real export (resolver factory, types, etc.) and replace ONLY
// `makePipelineLoader` with a spy that records the `PipelineDeps` it is handed
// and returns an inert loader. `main.ts` imports `makePipelineLoader` from this
// exact specifier, so the mock intercepts the production call.
const captured: { deps: PipelineDeps | undefined } = { deps: undefined };

vi.mock("../pipeline/index.js", async (importActual) => {
  const actual = await importActual<typeof import("../pipeline/index.js")>();
  return {
    ...actual,
    makePipelineLoader: (deps: PipelineDeps) => {
      captured.deps = deps;
      // Inert loader: the test never exercises the real pipeline, so return no
      // evaluations. The point is capturing `deps`, not running the pipeline.
      return () => Promise.resolve([] as PairEvaluation[]);
    },
  };
});

const SUPABASE: SupabaseConfig = {
  target: "hosted",
  url: "https://pooler.example.supabase.co",
  key: "test-key",
};

describe("scheduled-run main.ts wiring — injects a defined gatePassing (Req 3.4)", () => {
  it("passes a non-undefined gatePassing resolver (a function) into makePipelineLoader", async () => {
    // Import after the mock is registered so `main.ts` binds the spied factory.
    const { loadEvaluations } = await import("./main.js");

    await loadEvaluations("2024-03-15", SUPABASE);

    expect(captured.deps).toBeDefined();
    const deps = captured.deps!;
    expect(deps.gatePassing).not.toBeUndefined();
    expect(typeof deps.gatePassing).toBe("function");
    // The storage ports are also wired, so the pipeline runs over real stores.
    expect(deps.candleStore).toBeDefined();
    expect(deps.vectorStore).toBeDefined();
    expect(deps.analogueStore).toBeDefined();
  });
});

// --- Firing precondition is byte-for-byte unchanged (Req 3.5) -----------------

const HERE = dirname(fileURLToPath(import.meta.url));
const DASHBOARD_SOURCE = readFileSync(
  join(HERE, "..", "dashboard", "dashboard.ts"),
  "utf8",
);

/**
 * The exact firing precondition the design freezes (Req 3.5). This string is
 * compared against the live `fires()` body source, so any relaxation /
 * re-implementation of the predicate fails the test.
 */
const FROZEN_FIRING_PREDICATE = [
  "evaluation.gatePassing &&",
  '    !evaluation.newsSuppressed &&',
  '    evaluation.direction !== "FLAT" &&',
  "    evaluation.earnedConfidence >= confidenceThreshold",
].join("\n");

describe("fires() firing precondition is unchanged (Req 3.5)", () => {
  it("the fires() source contains the byte-for-byte four-condition predicate", () => {
    expect(DASHBOARD_SOURCE).toContain(FROZEN_FIRING_PREDICATE);
  });

  // Behavioural truth table over dailyRun: a card renders ONLY when all four
  // conditions hold, and NOT when any single one fails. This confirms the
  // predicate's meaning end-to-end without re-implementing it.
  const DECISION_DATE = "2024-03-15";
  const THRESHOLD = 0.55 as Confidence; // DEFAULT_CONFIDENCE_THRESHOLD

  function evalWith(overrides: Partial<PairEvaluation>): PairEvaluation {
    return {
      pair: "EURUSD",
      gatePassing: true,
      newsSuppressed: false,
      direction: "UP",
      earnedConfidence: 0.9 as Confidence,
      horizon: 2,
      excursionProfile: { favorablePips: 40, adversePips: 15 },
      stopLossPips: 15,
      takeProfitPips: 40,
      rationale: "r",
      analogueLabels: ["a"],
      ...overrides,
    };
  }

  function firesViaDashboard(evaluation: PairEvaluation): boolean {
    return dailyRun(DECISION_DATE, [evaluation]).cards.length === 1;
  }

  it("fires when all four conditions hold", () => {
    expect(firesViaDashboard(evalWith({}))).toBe(true);
  });

  it("does NOT fire when gate is not passing", () => {
    expect(firesViaDashboard(evalWith({ gatePassing: false }))).toBe(false);
  });

  it("does NOT fire when news-suppressed", () => {
    expect(firesViaDashboard(evalWith({ newsSuppressed: true }))).toBe(false);
  });

  it("does NOT fire when direction is FLAT", () => {
    expect(
      firesViaDashboard(evalWith({ direction: "FLAT" })),
    ).toBe(false);
  });

  it("does NOT fire when confidence is below the threshold", () => {
    expect(
      firesViaDashboard(
        evalWith({ earnedConfidence: (THRESHOLD - 0.01) as Confidence }),
      ),
    ).toBe(false);
  });

  it("fires at exactly the threshold (>= boundary)", () => {
    expect(
      firesViaDashboard(
        evalWith({ earnedConfidence: THRESHOLD }),
      ),
    ).toBe(true);
  });
});
