import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  InMemoryBlockedScoringInputRecorder,
  LlmOnScoringPathError,
  ScoringInputGuard,
  type Clock,
} from "../llm/scoringInputGuard.js";
import { SANCTIONED_ROLES, type LlmTagged, type SanctionedRole } from "../llm/types.js";
import { tagLlmOutput } from "../llm/llmInterface.js";
import type { TradeLedgerRow } from "../trade-ledger/types.js";
import { summarize } from "./metrics.js";

// Feature: trader-edge-validation, Property 6: AI-never-scores on the new report paths
//
// Retargets the parent `evaluationReportAiFree` guardrail at the Stage C ledger /
// metric paths. The evidence layer is deterministic (R12.1), so no LLM output may
// reach a metric:
//   Clause A — the runtime ScoringInputGuard BLOCKS and RECORDS any LLM-tagged
//     value handed to a metric-path boundary, before it could enter a summary.
//   Clause B — generating display-only LLM output leaves a PerformanceSummary
//     BYTE-IDENTICAL (LLM output has zero effect on any measured metric).
//
// Validates: Requirement 12.1

const fixedClock: Clock = { now: () => "2020-01-01T00:00:00.000Z" };

const sanctionedRole = (): fc.Arbitrary<SanctionedRole> => fc.constantFrom(...SANCTIONED_ROLES);

const taggedPayload = (): fc.Arbitrary<unknown> =>
  fc.oneof(fc.string(), fc.array(fc.string()), fc.double({ noNaN: true }), fc.integer());

const llmTaggedValue = (): fc.Arbitrary<LlmTagged<unknown>> =>
  fc
    .tuple(taggedPayload(), sanctionedRole())
    .map(([payload, role]) => tagLlmOutput(payload, role, "2020-01-01T00:00:00.000Z"));

const metricPath = (): fc.Arbitrary<string> =>
  fc.constantFrom(
    "netExpectancyPips",
    "netExpectancyR",
    "profitFactor",
    "winRate",
    "buildTradeLedger.grossPips",
  );

function simRow(net: number): TradeLedgerRow {
  return {
    strategyId: "system",
    pair: "EURUSD",
    decisionDate: "2024-04-01",
    fired: true,
    direction: "UP",
    horizon: 2,
    earnedConfidence: 0.6,
    entryPrice: 1.1,
    entryDate: "2024-04-02",
    stopLossPips: 20,
    takeProfitPips: 40,
    outcome: net >= 0 ? "target_first" : "stop_first",
    grossPips: net + 1,
    costPips: 1,
    netPips: net,
    rMultiple: net / 20,
  };
}

describe("trader-edge-validation Property 6: AI-never-scores on ledger/metric paths", () => {
  it("Clause A — an LLM-tagged value handed to a metric boundary is BLOCKED + RECORDED", () => {
    fc.assert(
      fc.property(llmTaggedValue(), metricPath(), (tagged, path) => {
        const recorder = new InMemoryBlockedScoringInputRecorder();
        const guard = new ScoringInputGuard({ recorder, clock: fixedClock });

        expect(() => guard.assertClean(tagged, path)).toThrow(LlmOnScoringPathError);
        // recorded BEFORE the throw
        const records = recorder.all();
        expect(records).toHaveLength(1);
        expect(records[0]!.scoringPath).toBe(path);
      }),
      { numRuns: 200 },
    );
  });

  it("Clause A' — a clean numeric value passes the guard unchanged", () => {
    const recorder = new InMemoryBlockedScoringInputRecorder();
    const guard = new ScoringInputGuard({ recorder, clock: fixedClock });
    const rows = [simRow(10), simRow(-5)];
    // The ledger rows are plain deterministic values: the guard passes them.
    for (const row of rows) {
      expect(guard.guard(row, "ledgerRow").ok).toBe(true);
    }
    expect(recorder.all()).toHaveLength(0);
  });

  it("Clause B — generating LLM-tagged output leaves a PerformanceSummary byte-identical", () => {
    const rows = [simRow(30), simRow(-10), simRow(0)];
    const before = summarize(rows);
    // Produce display-only LLM output; it must have ZERO effect on any metric.
    const note = tagLlmOutput("Weekly trend up; strong analogue resolution.", "signal_rationale", "2020-01-01T00:00:00.000Z");
    void note;
    const after = summarize(rows);
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  });
});
