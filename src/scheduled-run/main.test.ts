// Unit test for the scheduled-run container entry (task 6.2;
// simplify-to-cloud-minimal Requirements 3.5, 3.6).
//
// FIRING PRECONDITION (Req 3.5, 3.6): the `fires()` predicate in
// `src/dashboard/dashboard.ts` is byte-for-byte
// `direction !== "FLAT" && earnedConfidence >= confidenceThreshold`. There is
// NO suppression step: the former Gate_Auto_Block (gatePassing) and the news
// suppressor (newsSuppressed) have both been removed, so a pair's observation
// is driven purely by its deterministic direction and Earned_Confidence. We
// assert that exact source text is present AND confirm the behaviour with a
// truth table over `dailyRun` (which fires a card ONLY when both conditions
// hold, and records an explicit "no trade" otherwise).
//
// (The gate-passing resolver and its wiring in `main.ts` were removed by the
// cloud-minimal simplification — the daily run no longer injects a `gatePassing`
// resolver — so the former wiring assertion no longer applies.)
//
// Importing `main.ts` must NOT start a run: its top-level `main()` is guarded by
// the `invokedDirectly()` entry-point check (mirroring `src/ops/seed-run/main.ts`),
// so under vitest (where `process.argv[1]` is the test runner) it stays dormant.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { dailyRun, type PairEvaluation } from "../dashboard/index.js";
import type { DashboardView } from "../dashboard/index.js";
import type { Confidence } from "../confidence/types.js";
import type { SupabaseConfig } from "../storage/supabaseConfig.js";
import { makePersistView } from "./main.js";
import type { RunMatrix } from "./confluenceSlice.js";
import {
  buildDashboardSnapshot,
  EMPTY_CONFLUENCE,
  EMPTY_SIGNAL_SCORECARD,
  EMPTY_TRACK_RECORD,
  type DashboardSnapshot,
  type SnapshotConfluenceSlice,
} from "./snapshot.js";

// --- Firing precondition is byte-for-byte the two-condition predicate (Req 3.5) ---

const HERE = dirname(fileURLToPath(import.meta.url));
const DASHBOARD_SOURCE = readFileSync(
  join(HERE, "..", "dashboard", "dashboard.ts"),
  "utf8",
);

/**
 * The exact firing precondition the design freezes (Req 3.5, 3.6): a two-
 * condition predicate with NO suppression step. This string is compared against
 * the live `fires()` body source, so re-introducing a gate / news suppressor —
 * or otherwise relaxing / re-implementing the predicate — fails the test.
 */
const FROZEN_FIRING_PREDICATE = [
  'evaluation.direction !== "FLAT" &&',
  "    evaluation.earnedConfidence >= confidenceThreshold",
].join("\n");

describe("fires() firing precondition is the two-condition predicate (Req 3.5, 3.6)", () => {
  it("the fires() source contains the byte-for-byte two-condition predicate", () => {
    expect(DASHBOARD_SOURCE).toContain(FROZEN_FIRING_PREDICATE);
  });

  // No suppression fields remain on the firing path: the frozen predicate — and
  // the PairEvaluation shape it reads — carry neither a gate nor a news flag.
  it("the fires() source no longer references any suppression flag", () => {
    expect(DASHBOARD_SOURCE).not.toContain("gatePassing");
    expect(DASHBOARD_SOURCE).not.toContain("newsSuppressed");
  });

  // Behavioural truth table over dailyRun: a card renders iff BOTH conditions
  // hold, and NOT when either one fails. This confirms the predicate's meaning
  // end-to-end without re-implementing it.
  const DECISION_DATE = "2024-03-15";
  const THRESHOLD = 0.55 as Confidence; // DEFAULT_CONFIDENCE_THRESHOLD

  function evalWith(overrides: Partial<PairEvaluation>): PairEvaluation {
    return {
      pair: "EURUSD",
      direction: "UP",
      earnedConfidence: 0.9 as Confidence,
      horizon: 2,
      excursionProfile: { favorablePips: 40, adversePips: 15 },
      stopLossPips: 15,
      takeProfitPips: 40,
      choppiness: 0.8,
      rationale: "r",
      analogueLabels: ["a"],
      ...overrides,
    };
  }

  function firesViaDashboard(evaluation: PairEvaluation): boolean {
    return dailyRun(DECISION_DATE, [evaluation]).cards.length === 1;
  }

  it("fires when both conditions hold", () => {
    expect(firesViaDashboard(evalWith({}))).toBe(true);
  });

  it("does NOT fire when direction is FLAT — the pair is an explicit 'no trade' observation", () => {
    // The pair is not suppressed; it simply expresses no directional view, so
    // the dashboard renders no directional card for it (Req 3.5).
    expect(firesViaDashboard(evalWith({ direction: "FLAT" }))).toBe(false);
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

// --- Confluence wiring is fail-safe and firing-neutral (task 19; Req 10.5, 10.6, 13.7) ---
//
// Subtask 19.1 wires the v5 `confluence` slice into the end-of-run snapshot
// assembly inside `persistView` (now the exported `makePersistView` factory).
// The confluence step is a SEPARATE read-only consumer: it writes nothing to the
// DB and returns nothing firing reads. These tests inject in-memory stubs for
// every collaborator (no network/DB) and assert the contract:
//
//   - the firing VIEW, the persisted ROWS, and the `cards` the persister saw are
//     IDENTICAL whether the confluence step SUCCEEDS or THROWS (Req 10.5, 13.7);
//   - when the confluence step throws/fails, the snapshot STILL publishes with an
//     `EMPTY_CONFLUENCE` slice (Req 10.6) — the run is never failed and no earlier
//     slice is disturbed.
//
// Only `makePersistView`'s injected seams are stubbed; the default production
// wiring is never reached (no Supabase client, no `console` sink, no real
// `buildConfluenceSlice`).

describe("makePersistView — confluence wiring is fail-safe and firing-neutral (Req 10.5, 10.6, 13.7)", () => {
  const DECISION_DATE = "2024-03-15";

  /** A dummy, never-dialled Supabase connection (no client is ever built). */
  const SUPABASE: SupabaseConfig = { target: "local", url: "http://unused", key: "unused" };

  function firingEvaluation(pair: PairEvaluation["pair"]): PairEvaluation {
    return {
      pair,
      direction: "UP",
      earnedConfidence: 0.9 as Confidence,
      horizon: 2,
      excursionProfile: { favorablePips: 40, adversePips: 15 },
      stopLossPips: 15,
      takeProfitPips: 40,
      choppiness: 0.8,
      rationale: "r",
      analogueLabels: ["a"],
    };
  }

  /** A non-empty, well-formed confluence slice the SUCCESS case returns. */
  const NON_EMPTY_SLICE: SnapshotConfluenceSlice = {
    validationLabel: "unvalidated",
    weights: { trend: 1, breakout: 1, range: 1, reversal: 1, custom_pattern: 1, third_party: 0 },
    conflictThreshold: 0.6,
    alignmentThreshold: 0.4,
    pairs: [
      {
        pair: "EURUSD",
        score: 0.5,
        status: "ALIGNED_UP",
        opposingStrategyIds: [],
        cells: [
          { strategyId: "trend", available: true, direction: "UP", strength: 0.5, rationale: "t" },
          { strategyId: "breakout", available: false, reason: "insufficient_data" },
          { strategyId: "range", available: false, reason: "insufficient_data" },
          { strategyId: "reversal", available: false, reason: "insufficient_data" },
          { strategyId: "custom_pattern", available: true, direction: "UP", strength: 0.9, rationale: "c" },
          { strategyId: "third_party", available: false, reason: "unavailable" },
        ],
      },
    ],
  };

  /**
   * Drive `makePersistView` once with a confluence builder that behaves per
   * `confluenceBehaviour`, capturing the view/cards the persister saw and the
   * snapshot the sink was handed. Every OTHER seam is a trivial, deterministic
   * stub so the only variable across runs is the confluence step.
   */
  async function runPersist(confluenceBehaviour: "succeed" | "throw"): Promise<{
    readonly persistedView: DashboardView | undefined;
    readonly snapshot: DashboardSnapshot | undefined;
    readonly warnings: readonly string[];
  }> {
    const evaluations = [firingEvaluation("EURUSD"), firingEvaluation("GBPUSD")];
    const view = dailyRun(DECISION_DATE, evaluations);

    let persistedView: DashboardView | undefined;
    let snapshot: DashboardSnapshot | undefined;
    const warnings: string[] = [];

    const persist = makePersistView({
      cached: { get: () => evaluations },
      displayDeps: {},
      snapshotSink: undefined,
      // Capture the EXACT view the DB persister (source of truth) was handed.
      persist: (v) => {
        persistedView = v;
        return Promise.resolve();
      },
      buildDisplay: () => Promise.resolve(undefined),
      loadHistory: () => Promise.resolve({}),
      buildEdge: () => Promise.resolve({}),
      buildConfluence: () => {
        if (confluenceBehaviour === "throw") {
          throw new Error("confluence boom");
        }
        return Promise.resolve(NON_EMPTY_SLICE);
      },
      buildTrackRecord: () => Promise.resolve(EMPTY_TRACK_RECORD),
      // Capture the assembled snapshot without writing anywhere.
      writeSnapshot: (snap) => {
        snapshot = snap;
        return Promise.resolve(true);
      },
      warn: (collaborator, err) => {
        const message = err instanceof Error ? err.message : String(err);
        warnings.push(`${collaborator}:${message}`);
      },
    });

    await persist(view, SUPABASE);
    return { persistedView, snapshot, warnings };
  }

  it("persists the identical firing view and cards whether confluence succeeds or throws", async () => {
    const ok = await runPersist("succeed");
    const boom = await runPersist("throw");

    // The persister (source of truth) saw the SAME view — same decisionDate and
    // byte-for-byte the same firing cards — regardless of the confluence outcome.
    expect(ok.persistedView).toBeDefined();
    expect(boom.persistedView).toEqual(ok.persistedView);
    expect(boom.persistedView?.cards).toEqual(ok.persistedView?.cards);

    // The snapshot's firing rows (derived from the view) are identical too.
    expect(boom.snapshot?.firingSetups).toEqual(ok.snapshot?.firingSetups);
    expect(boom.snapshot?.pairEvaluations).toEqual(ok.snapshot?.pairEvaluations);
  });

  it("still publishes the snapshot with EMPTY_CONFLUENCE when the confluence step throws", async () => {
    const boom = await runPersist("throw");

    // The snapshot was still assembled and written (the run is never failed).
    expect(boom.snapshot).toBeDefined();
    // The confluence step threw, so the appended slice degrades to the empty
    // default rather than failing the run (Req 10.6).
    expect(boom.snapshot?.confluence).toEqual(EMPTY_CONFLUENCE);
    // A secret-free warning named the failing collaborator.
    expect(boom.warnings.some((w) => w.startsWith("confluence_slice:"))).toBe(true);
  });

  it("carries the real confluence slice through when the step succeeds", async () => {
    const ok = await runPersist("succeed");

    expect(ok.snapshot?.confluence).toEqual(NON_EMPTY_SLICE);
    // The success path emits no confluence warning.
    expect(ok.warnings.some((w) => w.startsWith("confluence_slice:"))).toBe(false);
  });
});

// --- v6 track-record step is fail-safe and firing-neutral ---------------------------------

describe("makePersistView — track-record wiring is fail-safe and firing-neutral", () => {
  const DECISION_DATE = "2024-03-15";
  const SUPABASE: SupabaseConfig = { target: "local", url: "http://unused", key: "unused" };

  function firingEvaluation(pair: PairEvaluation["pair"]): PairEvaluation {
    return {
      pair,
      direction: "UP",
      earnedConfidence: 0.9 as Confidence,
      horizon: 2,
      excursionProfile: { favorablePips: 40, adversePips: 15 },
      stopLossPips: 15,
      takeProfitPips: 40,
      choppiness: 0.8,
      rationale: "r",
      analogueLabels: ["a"],
    };
  }

  async function run(behaviour: "succeed" | "throw") {
    const evaluations = [firingEvaluation("EURUSD")];
    const view = dailyRun(DECISION_DATE, evaluations);
    let persistedView: DashboardView | undefined;
    let snapshot: DashboardSnapshot | undefined;
    const warnings: string[] = [];
    const record = {
      lookbackDays: 60,
      strategies: [{ pair: "EURUSD", strategyId: "trend" as const, calls: 10, correct: 6 }],
      rangeForecast: [{ pair: "EURUSD", forecasts: 5, correct: 3 }],
    };
    const persist = makePersistView({
      cached: { get: () => evaluations },
      displayDeps: {},
      snapshotSink: undefined,
      persist: (v) => {
        persistedView = v;
        return Promise.resolve();
      },
      buildDisplay: () => Promise.resolve(undefined),
      loadHistory: () => Promise.resolve({}),
      buildEdge: () => Promise.resolve({}),
      buildConfluence: () => Promise.resolve(EMPTY_CONFLUENCE),
      buildTrackRecord: () => {
        if (behaviour === "throw") throw new Error("track boom");
        return Promise.resolve(record);
      },
      writeSnapshot: (snap) => {
        snapshot = snap;
        return Promise.resolve(true);
      },
      warn: (collaborator, err) => {
        warnings.push(`${collaborator}:${err instanceof Error ? err.message : String(err)}`);
      },
    });
    await persist(view, SUPABASE);
    return { persistedView, snapshot, warnings, record };
  }

  it("persists the identical firing view whether the track record succeeds or throws", async () => {
    const ok = await run("succeed");
    const boom = await run("throw");
    expect(boom.persistedView).toEqual(ok.persistedView);
    expect(boom.snapshot?.firingSetups).toEqual(ok.snapshot?.firingSetups);
  });

  it("degrades to EMPTY_TRACK_RECORD, still publishes, and warns secret-free when it throws", async () => {
    const boom = await run("throw");
    expect(boom.snapshot).toBeDefined();
    expect(boom.snapshot?.trackRecord).toEqual(EMPTY_TRACK_RECORD);
    expect(boom.warnings.some((w) => w.startsWith("track_record:"))).toBe(true);
  });

  it("carries the real track-record slice through when the step succeeds", async () => {
    const ok = await run("succeed");
    expect(ok.snapshot?.trackRecord).toEqual(ok.record);
  });
});

// --- the per-run Confluence_Matrix is built ONCE and shared (codebase-housekeeping Task 9) -----

describe("makePersistView - the confluence matrix is built once and shared", () => {
  const DECISION_DATE = "2024-03-15";
  const SUPABASE: SupabaseConfig = { target: "local", url: "http://unused", key: "unused" };

  const evaluation: PairEvaluation = {
    pair: "EURUSD",
    direction: "UP",
    earnedConfidence: 0.9 as Confidence,
    horizon: 2,
    excursionProfile: { favorablePips: 40, adversePips: 15 },
    stopLossPips: 15,
    takeProfitPips: 40,
    choppiness: 0.8,
    rationale: "r",
    analogueLabels: ["a"],
  };

  /** A recognisable sentinel: only identity matters to these tests. */
  const SHARED: RunMatrix = {
    matrix: { decisionDate: DECISION_DATE, config: {} as never, pairs: [] },
    failedPairs: new Set(),
  };

  async function drive(buildMatrix: () => Promise<RunMatrix | null>) {
    const evaluations = [evaluation];
    const view = dailyRun(DECISION_DATE, evaluations);
    const seenByConfluence: Array<RunMatrix | null> = [];
    const seenByScorecard: Array<RunMatrix | null> = [];
    const warnings: string[] = [];
    let snapshotWritten = false;

    const persist = makePersistView({
      cached: { get: () => evaluations },
      displayDeps: {},
      snapshotSink: undefined,
      persist: () => Promise.resolve(),
      buildDisplay: () => Promise.resolve(undefined),
      loadHistory: () => Promise.resolve({}),
      buildEdge: () => Promise.resolve({}),
      buildMatrix,
      buildConfluence: (_s, _v, _e, _d, run) => {
        seenByConfluence.push(run);
        return Promise.resolve(EMPTY_CONFLUENCE);
      },
      runScorecard: (_s, _v, _e, _d, run) => {
        seenByScorecard.push(run);
        return Promise.resolve();
      },
      buildScorecard: () => Promise.resolve(EMPTY_SIGNAL_SCORECARD),
      buildTrackRecord: () => Promise.resolve(EMPTY_TRACK_RECORD),
      writeSnapshot: () => {
        snapshotWritten = true;
        return Promise.resolve(true);
      },
      warn: (collaborator, err) => {
        warnings.push(`${collaborator}:${err instanceof Error ? err.message : String(err)}`);
      },
    });
    await persist(view, SUPABASE);
    return { seenByConfluence, seenByScorecard, warnings, snapshotWritten };
  }

  it("builds the matrix exactly once and hands the SAME object to the confluence slice and the scorecard", async () => {
    const buildMatrix = vi.fn(() => Promise.resolve<RunMatrix | null>(SHARED));

    const out = await drive(buildMatrix);

    expect(buildMatrix).toHaveBeenCalledTimes(1);
    expect(out.seenByConfluence).toHaveLength(1);
    expect(out.seenByScorecard).toHaveLength(1);
    expect(out.seenByConfluence[0]).toBe(SHARED);
    expect(out.seenByScorecard[0]).toBe(SHARED);
    expect(out.warnings).toEqual([]);
  });

  it("when the matrix cannot be built, both consumers get null, it is warned once, and the run still publishes", async () => {
    const out = await drive(() => Promise.reject(new Error("matrix boom")));

    expect(out.seenByConfluence).toEqual([null]);
    expect(out.seenByScorecard).toEqual([null]);
    expect(out.warnings).toEqual(["confluence_matrix:matrix boom"]);
    expect(out.snapshotWritten).toBe(true);
  });
});

// --- per-step timing is observation only (codebase-housekeeping Task 10) ----------------------

describe("makePersistView - per-step timing is observation only", () => {
  const DECISION_DATE = "2024-03-15";
  const PINNED_NOW = new Date("2024-03-15T22:30:00.000Z");
  const SUPABASE: SupabaseConfig = { target: "local", url: "http://unused", key: "unused" };

  const evaluation: PairEvaluation = {
    pair: "EURUSD",
    direction: "UP",
    earnedConfidence: 0.9 as Confidence,
    horizon: 2,
    excursionProfile: { favorablePips: 40, adversePips: 15 },
    stopLossPips: 15,
    takeProfitPips: 40,
    choppiness: 0.8,
    rationale: "r",
    analogueLabels: ["a"],
  };

  async function drive(options: { confluenceThrows: boolean; withTiming: boolean }) {
    const evaluations = [evaluation];
    const view = dailyRun(DECISION_DATE, evaluations);
    const timingLines: Array<{ step: string; outcome: string }> = [];
    const warnings: string[] = [];
    let snapshot: DashboardSnapshot | undefined;

    const persist = makePersistView({
      cached: { get: () => evaluations },
      displayDeps: {},
      snapshotSink: undefined,
      persist: () => Promise.resolve(),
      buildDisplay: () => Promise.resolve(undefined),
      loadHistory: () => Promise.resolve({}),
      buildEdge: () => Promise.resolve({}),
      buildMatrix: () => Promise.resolve(null),
      // Pin the snapshot clock. Production passes `now` as undefined, so `generatedAt` is
      // `new Date()` per call and two back-to-back drives can straddle a millisecond.
      buildSnapshot: (view, displayOnly, history, _now, ...rest) =>
        buildDashboardSnapshot(view, displayOnly, history, PINNED_NOW, ...rest),
      buildConfluence: () => {
        if (options.confluenceThrows) throw new Error("confluence boom");
        return Promise.resolve(EMPTY_CONFLUENCE);
      },
      runScorecard: () => Promise.resolve(),
      buildScorecard: () => Promise.resolve(EMPTY_SIGNAL_SCORECARD),
      buildTrackRecord: () => Promise.resolve(EMPTY_TRACK_RECORD),
      writeSnapshot: (snap) => {
        snapshot = snap;
        return Promise.resolve(true);
      },
      warn: (collaborator, err) => {
        warnings.push(`${collaborator}:${err instanceof Error ? err.message : String(err)}`);
      },
      ...(options.withTiming
        ? {
            timing: {
              log: (e: object) => {
                const { step, outcome } = e as { step: string; outcome: string };
                timingLines.push({ step, outcome });
              },
            },
          }
        : { timing: { log: () => {} } }),
    });
    await persist(view, SUPABASE);
    return { timingLines, warnings, snapshot };
  }

  it("emits one timing line per step, in run order", async () => {
    const out = await drive({ confluenceThrows: false, withTiming: true });

    expect(out.timingLines.map((l) => l.step)).toEqual([
      "persist_firing_setups",
      "display_only",
      "confluence_matrix",
      "signal_scorecard",
      "snapshot_history",
      "edge_slices",
      "confluence_slice",
      "track_record",
      "signal_scorecard_slice",
      "write_snapshot",
    ]);
    expect(out.timingLines.every((l) => l.outcome === "ok")).toBe(true);
  });

  it("a throwing step is timed as an error AND still handled by its existing fail-safe", async () => {
    const out = await drive({ confluenceThrows: true, withTiming: true });

    expect(out.timingLines.find((l) => l.step === "confluence_slice")?.outcome).toBe("error");
    expect(out.warnings).toEqual(["confluence_slice:confluence boom"]);
    expect(out.snapshot?.confluence).toEqual(EMPTY_CONFLUENCE); // run still publishes
  });

  it("timing changes nothing about the published snapshot", async () => {
    const timed = await drive({ confluenceThrows: false, withTiming: true });
    const untimed = await drive({ confluenceThrows: false, withTiming: false });

    expect(timed.snapshot).toEqual(untimed.snapshot);
  });
});
