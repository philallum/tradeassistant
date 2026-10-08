// @vitest-environment jsdom
//
// dashboard-ui `web/` — Evaluation (Gate) tab render example/unit tests.
//
// These are EXAMPLE/UNIT (not property) tests. They render the Evaluation tab with an
// injected reports loader — no real network — and assert the behavioral contract of the
// reframed evaluation visual (R1):
//
//   - An evaluation-report row renders the model-vs-baseline directional accuracy and the
//     delta between them, read verbatim from the persisted report (R1.2).
//   - NO PASS/CUT verdict is rendered anywhere (R1.3) — the tab presents metrics for human
//     interpretation, not an automated decision (R2.4).
//   - The most recent report (by test-window end) is surfaced when several are returned.
//   - An empty report set shows an explicit "no reports yet" state, not a blank screen.
//   - While the fetch is in-flight, a loading state is shown rather than a blank screen.
//
// Validates: Requirements 1.2, 1.3, 2.4, 2.3, 14.3

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { ApiResult } from "../../api/snapshot";
import type { EvaluationReportRow } from "../../api/types";
import { GateTab } from "./GateTab";

afterEach(() => {
  cleanup();
});

/** A persisted evaluation-report fixture (every field verbatim, nothing recomputed). */
function report(overrides: Partial<EvaluationReportRow> = {}): EvaluationReportRow {
  return {
    config_id: "config-A",
    split_test_start: "2026-01-01",
    split_test_end: "2026-06-30",
    sample_size: 420,
    predictions_count: 500,
    model_accuracy: 0.61,
    baseline_accuracy: 0.52,
    delta_vs_baseline: 0.09,
    ...overrides,
  };
}

/** Wrap a value as a resolved ApiResult envelope. */
function result<Row>(rows: readonly Row[]): ApiResult<Row> {
  return { rows, lastUpdated: null };
}

describe("GateTab — evaluation report renders metrics, no verdict (R1.2, R1.3)", () => {
  it("renders the model + baseline accuracy and the delta, and NO PASS/CUT verdict", async () => {
    render(
      <GateTab loadEvaluationReports={() => Promise.resolve(result([report()]))} />,
    );

    // The report card is present (its region names the model-vs-baseline report).
    const region = await screen.findByRole("region", {
      name: /Model versus baseline evaluation report/i,
    });
    const text = region.textContent ?? "";

    // Model-vs-baseline accuracy, shown verbatim (scaled to %).
    expect(text).toContain("61%");
    expect(text).toContain("52%");
    // Delta vs baseline, signed, in pp.
    expect(text).toMatch(/\+9 pp/);
    // The config + sample size are surfaced.
    expect(text).toContain("config-A");
    expect(text).toContain("420");

    // No automated verdict anywhere (R1.3).
    expect(text).not.toMatch(/\bPASS\b/);
    expect(text).not.toMatch(/\bCUT\b/);
    expect(screen.queryByText(/verdict/i)).toBeNull();
  });

  it("surfaces the most recent report (by test-window end) when several are returned", async () => {
    const older = report({ config_id: "old", split_test_end: "2026-03-31", model_accuracy: 0.5 });
    const newer = report({ config_id: "new", split_test_end: "2026-09-30", model_accuracy: 0.7 });
    render(
      <GateTab loadEvaluationReports={() => Promise.resolve(result([older, newer]))} />,
    );

    const region = await screen.findByRole("region", {
      name: /Model versus baseline evaluation report/i,
    });
    // The newer report wins the recency selection.
    expect(region.textContent).toContain("new");
    expect(region.textContent).toContain("70%");
  });
});

describe("GateTab — empty + loading states (R2.3, 14.3)", () => {
  it("shows an explicit 'no reports yet' state for an empty set, not a blank screen", async () => {
    render(
      <GateTab
        loadEvaluationReports={() => Promise.resolve(result<EvaluationReportRow>([]))}
      />,
    );

    expect(
      await screen.findByText(/No evaluation reports have been recorded yet/i),
    ).toBeTruthy();
  });

  it("shows a loading status rather than a blank screen while the fetch is pending", () => {
    // A loader whose promise never resolves keeps the tab in its in-flight state.
    const pending: Promise<ApiResult<EvaluationReportRow>> = new Promise(() => {});
    render(<GateTab loadEvaluationReports={() => pending} />);

    const status = screen.getByRole("status");
    expect(status.textContent).toMatch(/Loading evaluation report/i);
    expect(status.getAttribute("aria-live")).toBe("polite");
  });

  it("replaces the loading state with content once the fetch resolves", async () => {
    render(
      <GateTab loadEvaluationReports={() => Promise.resolve(result([report()]))} />,
    );

    await screen.findByRole("region", { name: /Model versus baseline evaluation report/i });
    await waitFor(() => {
      expect(screen.queryByText(/Loading evaluation report/i)).toBeNull();
    });
  });
});
