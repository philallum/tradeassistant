// Unit + property tests for the dashboard JSON snapshot writer
// (simplify-to-cloud-minimal Requirements 5.1, 5.2, 5.5; design Decision 2 / C3).
//
// These cover the two guarantees of the Public_Read_Path producer:
//   1. `buildDashboardSnapshot` serialises the produced view + display-only
//      writes + history slices into the wire-format snapshot the SPA reads, with
//      every absent slice an empty array (never undefined) so the SPA renders an
//      explicit empty state (R5.5).
//   2. `writeDashboardSnapshot` is FAIL-SAFE: a sink that rejects (or is absent)
//      is logged and swallowed — it never throws — so a snapshot failure can
//      never corrupt the persisted rows nor fail the run (R5.2).

import { describe, expect, it, vi } from "vitest";
import fc from "fast-check";

import type { Confidence } from "../confidence/types.js";
import type { DashboardView } from "../dashboard/index.js";
import { dailyRun, type PairEvaluation } from "../dashboard/index.js";
import { tagLlmOutput } from "../llm/index.js";
import type {
  DisplayOnlyWrite,
  SignalRationaleWrite,
  ReferenceComparisonWrite,
} from "../storage/supabase/index.js";
import type { ExternalReferenceSignal } from "../external-signal/index.js";
import {
  buildDashboardSnapshot,
  pairEvaluationRows,
  serializeSnapshot,
  writeDashboardSnapshot,
  EMPTY_CONFLUENCE,
  SNAPSHOT_FILE_NAME,
  SNAPSHOT_SCHEMA_VERSION,
  type DashboardSnapshot,
  type SnapshotConfluenceSlice,
  type SnapshotSink,
} from "./snapshot.js";

const FIXED_NOW = new Date("2024-03-15T21:00:00.000Z");

/** A firing evaluation so `dailyRun` produces one card to serialise. */
function firingEvaluation(): PairEvaluation {
  return {
    pair: "EURUSD",
    earnedConfidence: 0.9 as Confidence,
    direction: "UP",
    horizon: 2,
    excursionProfile: { favorablePips: 40, adversePips: 15 },
    stopLossPips: 15,
    takeProfitPips: 40,
    choppiness: 0.8,
    rationale: "analogues resolved up",
    analogueLabels: ["trend-continuation"],
  };
}

function viewFor(decisionDate: string): DashboardView {
  return dailyRun(decisionDate, [firingEvaluation()]);
}

/** A display-only payload with one rationale and one comparison. */
function displayOnlyFor(decisionDate: string): DisplayOnlyWrite {
  const rationale: SignalRationaleWrite = {
    decisionDate,
    pair: "EURUSD",
    rationale: tagLlmOutput("A plain-language rationale.", "signal_rationale", FIXED_NOW.toISOString()),
    analogueLabels: tagLlmOutput(["trend", "continuation"], "pattern_description", FIXED_NOW.toISOString()),
  };
  const reference: ExternalReferenceSignal = {
    pair: "EURUSD",
    decisionDate,
    direction: "BUY",
    score: 0.7,
    provider: "FCS",
    fetchedAt: FIXED_NOW.toISOString(),
  };
  const comparison: ReferenceComparisonWrite = {
    decisionDate,
    pair: "EURUSD",
    ownDirection: "UP",
    reference,
    comparison: "agree",
  };
  return { rationales: [rationale], comparisons: [comparison] };
}

describe("buildDashboardSnapshot — serialises the view + display-only + history", () => {
  it("maps a firing card into a surfaced firing_setups wire row", () => {
    const snapshot = buildDashboardSnapshot(viewFor("2024-03-15"), undefined, {}, FIXED_NOW);

    expect(snapshot.schemaVersion).toBe(SNAPSHOT_SCHEMA_VERSION);
    expect(snapshot.decisionDate).toBe("2024-03-15");
    expect(snapshot.generatedAt).toBe(FIXED_NOW.toISOString());
    expect(snapshot.firingSetups).toHaveLength(1);
    const row = snapshot.firingSetups[0]!;
    expect(row).toMatchObject({
      decision_date: "2024-03-15",
      pair: "EURUSD",
      strategy_id: "system",
      direction: "UP",
      horizon: 2,
      earned_confidence: 0.9,
      stop_loss_pips: 15,
      take_profit_pips: 40,
      surfaced: true,
      suppression_reason: null,
    });
  });

  it("unwraps the LlmTagged display values into the AI rationale + external rows", () => {
    const snapshot = buildDashboardSnapshot(
      viewFor("2024-03-15"),
      displayOnlyFor("2024-03-15"),
      {},
      FIXED_NOW,
    );

    expect(snapshot.aiRationale).toEqual([
      {
        decision_date: "2024-03-15",
        pair: "EURUSD",
        rationale_text: "A plain-language rationale.",
        analogue_labels: ["trend", "continuation"],
        proposals: [],
      },
    ]);
    expect(snapshot.externalComparison).toEqual([
      {
        decision_date: "2024-03-15",
        pair: "EURUSD",
        own_direction: "UP",
        reference_direction: "BUY",
        reference_score: 0.7,
        provider: "FCS",
        comparison: "agree",
      },
    ]);
  });

  it("maps a generated daily note into the dailyCommentary record (unwrapped, generated:true)", () => {
    const dailyNote = {
      decisionDate: "2024-03-15",
      note: tagLlmOutput(
        "No setups cleared the 55% threshold today; conditions were choppy.",
        "signal_rationale",
        FIXED_NOW.toISOString(),
      ),
    };
    const snapshot = buildDashboardSnapshot(
      viewFor("2024-03-15"),
      { dailyNote },
      {},
      FIXED_NOW,
    );

    expect(snapshot.dailyCommentary).toEqual({
      decision_date: "2024-03-15",
      note_text: "No setups cleared the 55% threshold today; conditions were choppy.",
      generated: true,
    });
    // The unwrapped text is a plain string — the LlmTagged brand never serialises.
    expect(JSON.stringify(snapshot.dailyCommentary)).not.toContain("provenance");
  });

  it("emits an explicit generated:false dailyCommentary when no note was produced", () => {
    const snapshot = buildDashboardSnapshot(viewFor("2024-03-15"), undefined, {}, FIXED_NOW);
    expect(snapshot.dailyCommentary).toEqual({
      decision_date: "2024-03-15",
      note_text: "",
      generated: false,
    });
  });

  it("carries supplied history slices verbatim", () => {
    const snapshot = buildDashboardSnapshot(
      viewFor("2024-03-15"),
      undefined,
      {
        decisionDates: ["2024-03-14", "2024-03-15"],
        candles: [{ asset: "EURUSD", date: "2024-03-15", open: 1, high: 2, low: 0.5, close: 1.5 }],
        evaluationReports: [
          {
            config_id: "shape-only",
            split_test_start: "2024-01-01",
            split_test_end: "2024-02-01",
            sample_size: 42,
            predictions_count: 50,
            model_accuracy: 0.56,
            baseline_accuracy: 0.52,
            delta_vs_baseline: 0.04,
          },
        ],
      },
      FIXED_NOW,
    );

    expect(snapshot.decisionDates).toEqual(["2024-03-14", "2024-03-15"]);
    expect(snapshot.candles).toHaveLength(1);
    expect(snapshot.evaluationReports).toHaveLength(1);
    // No verdict field anywhere in the evaluation summary (R1.3).
    expect(JSON.stringify(snapshot.evaluationReports)).not.toContain("verdict");
  });

  it("defaults every absent slice to an empty array (never undefined), so the SPA renders an empty state (R5.5)", () => {
    const snapshot = buildDashboardSnapshot(dailyRun("2024-03-16", []), undefined, {}, FIXED_NOW);

    expect(snapshot.firingSetups).toEqual([]);
    expect(snapshot.pairEvaluations).toEqual([]);
    expect(snapshot.analogueOutcomes).toEqual([]);
    expect(snapshot.realizedOutcomes).toEqual([]);
    expect(snapshot.candles).toEqual([]);
    expect(snapshot.aiRationale).toEqual([]);
    expect(snapshot.externalComparison).toEqual([]);
    expect(snapshot.evaluationReports).toEqual([]);
    // The daily-commentary slice is ALWAYS present; with no note it carries an
    // explicit generated:false record for today's Decision_Date.
    expect(snapshot.dailyCommentary).toEqual({
      decision_date: "2024-03-16",
      note_text: "",
      generated: false,
    });
    // decisionDates always carries at least today's Decision_Date so it is
    // selectable in the browse control even with no history supplied.
    expect(snapshot.decisionDates).toEqual(["2024-03-16"]);
  });

  it("unions today's Decision_Date into decisionDates and sorts ascending (no duplicate)", () => {
    const snapshot = buildDashboardSnapshot(
      viewFor("2024-03-15"),
      undefined,
      { decisionDates: ["2024-03-10", "2024-03-15"] },
      FIXED_NOW,
    );
    // "2024-03-15" already present (not duplicated), order ascending.
    expect(snapshot.decisionDates).toEqual(["2024-03-10", "2024-03-15"]);
  });

  it("merges today's firing view on top of historical firing setups, deduping on the PK", () => {
    // History already contains today's EURUSD row (a re-run) plus a prior date.
    const history = {
      firingSetups: [
        {
          decision_date: "2024-03-14",
          pair: "GBPUSD",
          strategy_id: "system",
          direction: "UP" as const,
          horizon: 1 as const,
          earned_confidence: 0.6,
          stop_loss_pips: null,
          take_profit_pips: null,
          surfaced: true,
          suppression_reason: null,
        },
        {
          decision_date: "2024-03-15",
          pair: "EURUSD",
          strategy_id: "system",
          direction: "DOWN" as const,
          horizon: 2 as const,
          earned_confidence: 0.1,
          stop_loss_pips: null,
          take_profit_pips: null,
          surfaced: true,
          suppression_reason: null,
        },
      ],
    };
    // Today's view carries EURUSD @ 2024-03-15 (same PK) — must win over history.
    const snapshot = buildDashboardSnapshot(viewFor("2024-03-15"), undefined, history, FIXED_NOW);

    // The prior-date GBPUSD row survives; the colliding EURUSD row is today's, not history's.
    expect(snapshot.firingSetups).toHaveLength(2);
    const gbp = snapshot.firingSetups.find((r) => r.pair === "GBPUSD");
    const eur = snapshot.firingSetups.find((r) => r.pair === "EURUSD");
    expect(gbp?.decision_date).toBe("2024-03-14");
    expect(eur?.decision_date).toBe("2024-03-15");
    // Today's EURUSD confidence (from viewFor), not the history's 0.1.
    expect(eur?.earned_confidence).not.toBe(0.1);
    // decisionDates comes from history.decisionDates (not supplied here) unioned
    // with today — the firing-setups merge does not itself contribute dates.
    expect(snapshot.decisionDates).toEqual(["2024-03-15"]);
  });

  it("carries the per-pair run-completion readout (pairEvaluations) for every evaluated pair", () => {
    // Two pairs evaluated: one fires (UP, 0.9 ≥ 0.55), one does not (DOWN, 0.4 < 0.55).
    const evals: PairEvaluation[] = [
      firingEvaluation(), // EURUSD UP 0.9 → fired
      {
        pair: "GBPUSD",
        earnedConfidence: 0.4 as Confidence,
        direction: "DOWN",
        horizon: 1,
        excursionProfile: { favorablePips: 10, adversePips: 8 },
        stopLossPips: null,
        takeProfitPips: null,
        choppiness: 0.3,
        rationale: "",
        analogueLabels: [],
      },
    ];
    const rows = pairEvaluationRows("2024-03-15", evals);
    const snapshot = buildDashboardSnapshot(
      viewFor("2024-03-15"),
      undefined,
      {},
      FIXED_NOW,
      rows,
    );

    expect(snapshot.pairEvaluations).toHaveLength(2);
    const eur = snapshot.pairEvaluations.find((r) => r.pair === "EURUSD")!;
    const gbp = snapshot.pairEvaluations.find((r) => r.pair === "GBPUSD")!;
    // Verbatim deterministic values, plus the derived fired flag.
    expect(eur).toMatchObject({
      decision_date: "2024-03-15",
      direction: "UP",
      earned_confidence: 0.9,
      choppiness: 0.8,
      fired: true,
    });
    expect(gbp).toMatchObject({
      direction: "DOWN",
      earned_confidence: 0.4,
      choppiness: 0.3,
      fired: false,
    });
  });

  it("pairEvaluationRows: a FLAT pair never counts as fired even at high confidence", () => {
    const rows = pairEvaluationRows("2024-03-15", [
      {
        pair: "USDJPY",
        earnedConfidence: 0.99 as Confidence,
        direction: "FLAT",
        horizon: 1,
        excursionProfile: { favorablePips: 0, adversePips: 0 },
        stopLossPips: null,
        takeProfitPips: null,
        choppiness: 0.5,
        rationale: "",
        analogueLabels: [],
      },
    ]);
    expect(rows[0]!.fired).toBe(false);
  });

  it("pairEvaluationRows: respects a custom confidence threshold for the fired flag", () => {
    const ev: PairEvaluation = {
      pair: "USDCHF",
      earnedConfidence: 0.6 as Confidence,
      direction: "UP",
      horizon: 2,
      excursionProfile: { favorablePips: 20, adversePips: 10 },
      stopLossPips: 10,
      takeProfitPips: 20,
      choppiness: 0.7,
      rationale: "",
      analogueLabels: [],
    };
    expect(pairEvaluationRows("2024-03-15", [ev], 0.55)[0]!.fired).toBe(true);
    expect(pairEvaluationRows("2024-03-15", [ev], 0.7)[0]!.fired).toBe(false);
  });

  it("round-trips through serializeSnapshot → JSON.parse unchanged", () => {
    const snapshot = buildDashboardSnapshot(
      viewFor("2024-03-15"),
      displayOnlyFor("2024-03-15"),
      {},
      FIXED_NOW,
    );
    const parsed = JSON.parse(serializeSnapshot(snapshot)) as DashboardSnapshot;
    expect(parsed).toEqual(snapshot);
  });

  it("defaults the confluence slice to EMPTY_CONFLUENCE when the 7th arg is omitted (R11.1, R11.7)", () => {
    const snapshot = buildDashboardSnapshot(viewFor("2024-03-15"), undefined, {}, FIXED_NOW);
    expect(snapshot.confluence).toEqual(EMPTY_CONFLUENCE);
  });

  it("differs from a no-confluence snapshot ONLY by appending the confluence slice, every earlier key byte-identical (R11.8)", () => {
    // A supplied confluence slice (one aligned-up Pair) vs. the empty default.
    const confluence: SnapshotConfluenceSlice = {
      ...EMPTY_CONFLUENCE,
      pairs: [
        {
          pair: "EURUSD",
          score: 0.5,
          status: "ALIGNED_UP",
          opposingStrategyIds: [],
          cells: [
            { strategyId: "trend", available: true, direction: "UP", strength: 0.5, rationale: "up" },
          ],
        },
      ],
    };
    const withoutConfluence = buildDashboardSnapshot(viewFor("2024-03-15"), undefined, {}, FIXED_NOW);
    const withConfluence = buildDashboardSnapshot(
      viewFor("2024-03-15"),
      undefined,
      {},
      FIXED_NOW,
      [],
      {},
      confluence,
    );

    // schemaVersion is 5 in BOTH (R11.1), so the two envelopes differ in exactly
    // one key: `confluence`. Every other key is deep-equal.
    expect(withConfluence.schemaVersion).toBe(withoutConfluence.schemaVersion);
    const { confluence: aConf, ...aRest } = withConfluence;
    const { confluence: bConf, ...bRest } = withoutConfluence;
    expect(aRest).toEqual(bRest);
    expect(aConf).not.toEqual(bConf);

    // Byte-level: `confluence` is appended LAST, so the serialized prefix up to
    // the `"confluence":` key is byte-for-byte identical (R11.8) — every earlier
    // slice keeps its exact bytes; only the appended confluence value differs.
    const aJson = serializeSnapshot(withConfluence);
    const bJson = serializeSnapshot(withoutConfluence);
    const marker = '  "confluence":';
    const aPrefix = aJson.slice(0, aJson.indexOf(marker));
    const bPrefix = bJson.slice(0, bJson.indexOf(marker));
    expect(aPrefix).toBe(bPrefix);
  });
});

describe("writeDashboardSnapshot — fail-safe (R5.2)", () => {
  it("writes through the sink with the canonical file name and returns true on success", async () => {
    const captured: Array<{ name: string; body: string }> = [];
    const sink: SnapshotSink = (name, body) => {
      captured.push({ name, body });
      return Promise.resolve();
    };
    const snapshot = buildDashboardSnapshot(viewFor("2024-03-15"), undefined, {}, FIXED_NOW);

    const ok = await writeDashboardSnapshot(snapshot, sink);

    expect(ok).toBe(true);
    expect(captured).toHaveLength(1);
    expect(captured[0]!.name).toBe(SNAPSHOT_FILE_NAME);
    expect(JSON.parse(captured[0]!.body)).toEqual(snapshot);
  });

  it("SWALLOWS a sink rejection — logs a warning, never throws, returns false", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const sink: SnapshotSink = () => Promise.reject(new Error("hosting unreachable"));
      const snapshot = buildDashboardSnapshot(viewFor("2024-03-15"), undefined, {}, FIXED_NOW);

      const ok = await writeDashboardSnapshot(snapshot, sink);

      expect(ok).toBe(false);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("treats an absent sink as a logged no-op (returns false), so a run without a hosting target still completes", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const snapshot = buildDashboardSnapshot(viewFor("2024-03-15"), undefined, {}, FIXED_NOW);
      const ok = await writeDashboardSnapshot(snapshot, undefined);
      expect(ok).toBe(false);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("property: writeDashboardSnapshot never throws regardless of how the sink fails", async () => {
    const snapshot = buildDashboardSnapshot(viewFor("2024-03-15"), undefined, {}, FIXED_NOW);

    await fc.assert(
      fc.asyncProperty(
        fc.oneof(
          fc.constant<"resolve">("resolve"),
          fc.constant<"reject-error">("reject-error"),
          fc.constant<"throw-sync">("throw-sync"),
        ),
        async (mode) => {
          const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
          const log = vi.spyOn(console, "log").mockImplementation(() => {});
          try {
            const sink: SnapshotSink = () => {
              switch (mode) {
                case "resolve":
                  return Promise.resolve();
                case "reject-error":
                  return Promise.reject(new Error("boom"));
                case "throw-sync":
                  throw new Error("sync boom");
              }
            };
            // Must resolve to a boolean, never reject.
            const ok = await writeDashboardSnapshot(snapshot, sink);
            expect(typeof ok).toBe("boolean");
            expect(ok).toBe(mode === "resolve");
          } finally {
            warn.mockRestore();
            log.mockRestore();
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
