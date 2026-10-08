// Unit/integration test — Evaluation_Run entry wiring over in-memory fixtures
// (simplify-to-cloud-minimal task 2 / 2.2; design C1 / C4).
//
// Validates: Requirements 2.1, 2.2, 2.3, 2.5, 2.6 — the Evaluation_Run entry
// composes the human-read EvaluationReport from the SHARED fold inputs over the
// FIXED out-of-sample split, PERSISTS it through the `EvaluationReportStore`,
// and appends it to RESEARCH-LOG.md with NO verdict (Requirement 2.4), using the
// determinism `composeEvaluationReport` already guarantees. When the matched
// sample is below the floor the report is still recorded and states the
// limitation rather than fabricating a result (Requirement 2.5).
//
// These are deterministic, EXAMPLE-BASED tests driven over in-memory stores
// seeded via the shared StagedRunner helpers — NO network, NO Supabase. The
// actual first LIVE evaluation against the hosted backfilled history is an
// OPERATOR action (the ☁️ step) and is NOT exercised here.

import { describe, it, expect, vi } from "vitest";

import {
  runEvaluation,
  SHAPE_ONLY_CONFIG_ID,
  SHAPE_ONLY_OOS_SPLIT,
} from "./main.js";
import { backfill } from "../../staged-runner/stagedRunner.js";
import * as killGateVerdict from "../../kill-gate/verdict.js";
import {
  InMemoryEvaluationReportStore,
  type EvaluationReportStore,
} from "../../kill-gate/types.js";
import { LivingDocs, InMemoryDocStore, LIVING_DOCS } from "../../living-docs/livingDocs.js";
import {
  makeTestDeps,
  buildCsvContent,
  seedVector,
  seedMaturedOutcome,
} from "../../staged-runner/testHelpers.js";

/**
 * A chronological run of trading dates long enough that `walkForwardFolds`
 * emits at least one full fold (so fold inputs are built over a real test
 * window). Mirrors the gate-run entry test's sizing.
 */
const DATES: readonly string[] = Array.from({ length: 1600 }, (_, i) =>
  new Date(Date.UTC(2015, 0, 1) + i * 86_400_000).toISOString().slice(0, 10),
);

/**
 * Build injected in-memory collaborators for the Evaluation_Run entry: in-memory
 * pipeline stores (seeded via the shared StagedRunner helpers so the backtest
 * prerequisite is satisfied), an in-memory report store, and an in-memory
 * Living-Docs writer. The `fetchImpl` is a throwing stub asserting NO network is
 * ever touched when stores are injected.
 *
 * `seedMatched` additionally seeds matured analogue outcomes + their pattern
 * vectors across the stored dates for EURUSD, so `buildFoldInputs` finds a
 * matched firing subset and the composed report has a non-zero sample size.
 */
async function makeInjectedDeps(options: { seedMatched?: boolean } = {}) {
  const base = makeTestDeps({ EURUSD: buildCsvContent([...DATES]) });
  await backfill(base, "backfill");

  if (options.seedMatched === true) {
    // Seed matured outcomes (and matching vectors) at every stored date for one
    // pair so a fold's test window contains a matched firing subset.
    for (const date of DATES) {
      await seedVector(base.vectorStore, "EURUSD", date, "UP");
      await seedMaturedOutcome(base.analogueStore, "EURUSD", date, "UP");
    }
  }

  const reportStore = new InMemoryEvaluationReportStore();
  const docStore = new InMemoryDocStore();
  const docs = new LivingDocs(docStore);

  const noNetworkFetch: typeof fetch = () => {
    throw new Error("Evaluation_Run test must not touch the network");
  };

  return {
    base,
    reportStore,
    docStore,
    docs,
    deps: {
      config: base.config,
      stores: {
        candleStore: base.candleStore,
        vectorStore: base.vectorStore,
        analogueStore: base.analogueStore,
      },
      reportStore,
      fetchImpl: noNetworkFetch,
      dataDir: base.dataDir,
      docs,
    },
  };
}

describe("Evaluation_Run entry composes + records the EvaluationReport (task 2.2)", () => {
  it("persists the composed report through the injected EvaluationReportStore (Req 2.1, 2.2)", async () => {
    const { reportStore, deps } = await makeInjectedDeps({ seedMatched: true });

    const result = await runEvaluation(deps);

    expect(result.recorded).toBe(true);
    if (!result.recorded) return;

    // The report is readable from the store under its generated id (the
    // in-memory store assigns ids from `report-1`).
    const persisted = await reportStore.getReport(result.reportId);
    expect(persisted).not.toBeNull();
    expect(persisted?.configId).toBe(SHAPE_ONLY_CONFIG_ID);
    expect(persisted).toEqual(result.report);
  });

  it("records the FIXED out-of-sample split on the report (Req 2.3)", async () => {
    const { deps } = await makeInjectedDeps({ seedMatched: true });

    const result = await runEvaluation(deps);
    expect(result.recorded).toBe(true);
    if (!result.recorded) return;

    expect(result.report.split).toEqual(SHAPE_ONLY_OOS_SPLIT);
  });

  it("routes recording solely through evaluateAndRecordReport with the fixed split (Req 2.3, 2.6)", async () => {
    const { deps } = await makeInjectedDeps({ seedMatched: true });
    const recordSpy = vi.spyOn(killGateVerdict, "evaluateAndRecordReport");

    const result = await runEvaluation(deps);
    expect(result.recorded).toBe(true);

    // evaluateAndRecordReport (which composes via the sole producer
    // composeEvaluationReport, then persists + appends) is the single record
    // path the entry routes through — called exactly once with the entry's
    // configId and the FIXED committed split.
    expect(recordSpy).toHaveBeenCalledTimes(1);
    expect(recordSpy.mock.calls[0]?.[0]?.configId).toBe(SHAPE_ONLY_CONFIG_ID);
    expect(recordSpy.mock.calls[0]?.[0]?.split).toEqual(SHAPE_ONLY_OOS_SPLIT);

    recordSpy.mockRestore();
  });

  it("appends an evaluation entry to RESEARCH-LOG with NO verdict (Req 2.2, 2.4)", async () => {
    const { docStore, docs, deps } = await makeInjectedDeps({ seedMatched: true });

    await runEvaluation(deps);

    const log = docStore.peek(LIVING_DOCS.researchLog) ?? "";
    const entry = log.match(
      /## \[EVALUATION\][\s\S]*?- Annotations \(non-binding\): .*/,
    )?.[0];
    expect(entry).toBeDefined();
    // The appended entry is structurally valid and carries no verdict.
    expect(docs.validateEvaluationLogEntry(entry!)).toBe(true);
    expect(/\bPASS\b/.test(entry!)).toBe(false);
    expect(/\bCUT\b/.test(entry!)).toBe(false);
    expect(/Verdict/i.test(entry!)).toBe(false);
    expect(entry).toContain(SHAPE_ONLY_CONFIG_ID);
  });

  it("is deterministic: two runs on identical inputs yield an identical report (Req 2.6, det.)", async () => {
    const first = await makeInjectedDeps({ seedMatched: true });
    const second = await makeInjectedDeps({ seedMatched: true });

    const a = await runEvaluation(first.deps);
    const b = await runEvaluation(second.deps);
    expect(a.recorded && b.recorded).toBe(true);
    if (!a.recorded || !b.recorded) return;

    expect(a.report).toEqual(b.report);
  });

  it("still records a report and states the LOW-N limitation when the matched subset is thin (Req 2.5)", async () => {
    // No matched seeding: the natural path yields an empty / below-floor matched
    // subset, so the report MUST still be recorded with a LOW-N caveat rather
    // than fabricated or withheld.
    const { docStore, deps } = await makeInjectedDeps({ seedMatched: false });

    const result = await runEvaluation(deps);
    expect(result.recorded).toBe(true);
    if (!result.recorded) return;

    expect(result.report.sampleSize).toBeLessThan(30);
    // The uncertainty note surfaces the sample-size limitation.
    expect(result.report.uncertainty.note.length).toBeGreaterThan(0);
    const log = docStore.peek(LIVING_DOCS.researchLog) ?? "";
    expect(log).toContain("## [EVALUATION]");
    // The recorded entry carries the uncertainty note (n=0 / LOW-N caveat).
    expect(log).toMatch(/note=.*(n=0|LOW-N|sample)/);
  });

  it("does NOT fabricate a report when the backtest prerequisite is absent (Req 2.5)", async () => {
    // Fresh stores with no candles/vectors stored: the entry must report the
    // missing prerequisite, not invent a report.
    const base = makeTestDeps();
    const reportStore: EvaluationReportStore = new InMemoryEvaluationReportStore();
    const docs = new LivingDocs(new InMemoryDocStore());

    const result = await runEvaluation({
      config: base.config,
      stores: {
        candleStore: base.candleStore,
        vectorStore: base.vectorStore,
        analogueStore: base.analogueStore,
      },
      reportStore,
      fetchImpl: () => {
        throw new Error("must not touch the network");
      },
      dataDir: base.dataDir,
      docs,
    });

    expect(result.recorded).toBe(false);
    if (result.recorded) return;
    expect(result.missingPrerequisite).toContain("evaluation");
  });
});
