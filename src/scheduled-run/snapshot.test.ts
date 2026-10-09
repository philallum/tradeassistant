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
  serializeSnapshot,
  writeDashboardSnapshot,
  SNAPSHOT_FILE_NAME,
  SNAPSHOT_SCHEMA_VERSION,
  type DashboardSnapshot,
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
    expect(snapshot.analogueOutcomes).toEqual([]);
    expect(snapshot.realizedOutcomes).toEqual([]);
    expect(snapshot.candles).toEqual([]);
    expect(snapshot.aiRationale).toEqual([]);
    expect(snapshot.externalComparison).toEqual([]);
    expect(snapshot.evaluationReports).toEqual([]);
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
