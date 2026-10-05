// @vitest-environment jsdom
//
// dashboard-ui `web/` — Gate tab render example/unit tests (task 9.7).
//
// These are EXAMPLE/UNIT (not property) tests. They render the Gate tab with injected
// loaders — no real network — and assert the behavioral contract of the gate visuals:
//
//   - A PASS `gate_verdicts` row renders a PASS visual, a CUT row renders a CUT visual, and
//     the two are distinguishable by TEXT/SHAPE (label + ✓/✕ glyph), never by color alone
//     (Req 9.7, reinforced by Req 18.3).
//   - The walk-forward fold list shows each fold's SKIPPED status and its per-fold verdict,
//     for both a skipped fold and a non-skipped (ran) fold (Req 9.8).
//   - While the verdicts fetch is in-flight (a pending loader promise), a loading state is
//     shown rather than a blank screen (Req 2.3, 14.3).
//
// Validates: Requirements 9.7, 9.8, 2.3, 14.3

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { ApiResult } from "../../api/client";
import type { GateFoldVerdictRow, GateVerdictRow } from "../../api/endpoints";
import { GateTab } from "./GateTab";

afterEach(() => {
  cleanup();
});

/** A persisted PASS verdict fixture (every field verbatim, nothing recomputed). */
function passVerdict(overrides: Partial<GateVerdictRow> = {}): GateVerdictRow {
  return {
    id: "verdict-pass-1",
    config_id: "config-A",
    sample_size: 420,
    gate1_model_acc: 0.61,
    gate1_baseline_acc: 0.52,
    gate1_delta_pp: 9,
    gate1_passed: true,
    gate2_model_ra: 1.3,
    gate2_baseline_ra: 1.1,
    gate2_margin: 0.2,
    gate2_passed: true,
    verdict: "PASS",
    selected_horizon: 2,
    split_test_start: "2026-01-01",
    split_test_end: "2026-06-30",
    created_at: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

/** A persisted CUT verdict fixture. */
function cutVerdict(overrides: Partial<GateVerdictRow> = {}): GateVerdictRow {
  return {
    ...passVerdict(),
    id: "verdict-cut-1",
    verdict: "CUT",
    gate1_passed: false,
    gate2_passed: false,
    ...overrides,
  };
}

/** Wrap a value as a resolved ApiResult envelope. */
function result<Row>(rows: readonly Row[]): ApiResult<Row> {
  return { rows, lastUpdated: null };
}

describe("GateTab — PASS vs CUT gate_verdicts render (Req 9.7)", () => {
  it("renders a PASS verdict distinguishable by text + shape glyph (not color alone)", async () => {
    render(
      <GateTab
        loadGateVerdicts={() => Promise.resolve(result([passVerdict()]))}
        loadGateFoldVerdicts={() => Promise.resolve(result<GateFoldVerdictRow>([]))}
      />,
    );

    // The verdict badge exposes its meaning as an explicit text label via aria-label...
    const badge = await screen.findByRole("img", { name: /Gate verdict: PASS/i });
    // ...and the visible text/shape together name the verdict without relying on color.
    expect(badge.textContent).toContain("PASS");
    expect(badge.textContent).toContain("✓");
    expect(badge.textContent).not.toContain("CUT");
    expect(badge.textContent).not.toContain("✕");
  });

  it("renders a CUT verdict distinguishable by text + shape glyph (not color alone)", async () => {
    render(
      <GateTab
        loadGateVerdicts={() => Promise.resolve(result([cutVerdict()]))}
        loadGateFoldVerdicts={() => Promise.resolve(result<GateFoldVerdictRow>([]))}
      />,
    );

    const badge = await screen.findByRole("img", { name: /Gate verdict: CUT/i });
    expect(badge.textContent).toContain("CUT");
    expect(badge.textContent).toContain("✕");
    expect(badge.textContent).not.toContain("PASS");
    expect(badge.textContent).not.toContain("✓");
  });

  it("surfaces the most recent verdict when several are returned", async () => {
    const older = passVerdict({ id: "old", created_at: "2026-01-01T00:00:00.000Z" });
    const newer = cutVerdict({ id: "new", created_at: "2026-07-01T00:00:00.000Z" });
    render(
      <GateTab
        loadGateVerdicts={() => Promise.resolve(result([older, newer]))}
        loadGateFoldVerdicts={() => Promise.resolve(result<GateFoldVerdictRow>([]))}
      />,
    );

    // The newer (CUT) row wins the recency selection.
    const badge = await screen.findByRole("img", { name: /Gate verdict: CUT/i });
    expect(badge).toBeTruthy();
  });
});

describe("GateTab — walk-forward folds: skipped vs ran (Req 9.8)", () => {
  function fold(overrides: Partial<GateFoldVerdictRow>): GateFoldVerdictRow {
    return {
      verdict_id: "verdict-pass-1",
      fold_index: 0,
      sample_size: 100,
      skipped: false,
      gate1_passed: true,
      gate2_passed: true,
      verdict: "PASS",
      ...overrides,
    };
  }

  it("shows the skipped status and per-fold verdict for both a skipped and a ran fold", async () => {
    const ranFold = fold({
      fold_index: 1,
      skipped: false,
      verdict: "PASS",
      gate1_passed: true,
      gate2_passed: true,
    });
    // A skipped fold has no gate pass/fail outcome and a null verdict (shown as the
    // explicit not-evaluated marker, never a guessed value).
    const skippedFold = fold({
      fold_index: 2,
      skipped: true,
      verdict: null,
      gate1_passed: null,
      gate2_passed: null,
    });

    render(
      <GateTab
        loadGateVerdicts={() => Promise.resolve(result([passVerdict()]))}
        loadGateFoldVerdicts={() =>
          Promise.resolve(result<GateFoldVerdictRow>([ranFold, skippedFold]))
        }
      />,
    );

    const foldsRegion = await screen.findByRole("region", {
      name: /Walk-forward folds/i,
    });

    // The ran fold's row carries its "Ran" status and a PASS verdict.
    const ranRow = within(foldsRegion).getByRole("rowheader", { name: "1" }).closest("tr");
    expect(ranRow).not.toBeNull();
    const ranCells = within(ranRow as HTMLTableRowElement).getAllByRole("cell");
    const ranText = (ranRow as HTMLTableRowElement).textContent ?? "";
    expect(ranText).toContain("Ran");
    expect(ranText).toContain("PASS");
    // sanity: the status cell is the first data cell.
    expect(ranCells[0]?.textContent).toBe("Ran");

    // The skipped fold's row carries its "Skipped" status and the explicit not-evaluated
    // marker ("—") for its missing per-fold verdict (no fabricated value, Req 9.8).
    const skippedRow = within(foldsRegion)
      .getByRole("rowheader", { name: "2" })
      .closest("tr");
    expect(skippedRow).not.toBeNull();
    const skippedCells = within(skippedRow as HTMLTableRowElement).getAllByRole("cell");
    const skippedText = (skippedRow as HTMLTableRowElement).textContent ?? "";
    expect(skippedText).toContain("Skipped");
    expect(skippedCells[0]?.textContent).toBe("Skipped");
    // The verdict cell (last) is the explicit not-evaluated marker, not PASS/CUT.
    expect(skippedCells.at(-1)?.textContent).toBe("—");
  });
});

describe("GateTab — loading state during an in-flight fetch (Req 2.3, 14.3)", () => {
  it("shows a loading status rather than a blank screen while the fetch is pending", () => {
    // A loader whose promise never resolves keeps the tab in its in-flight state.
    const pending: Promise<ApiResult<GateVerdictRow>> = new Promise(() => {});
    render(
      <GateTab
        loadGateVerdicts={() => pending}
        loadGateFoldVerdicts={() => Promise.resolve(result<GateFoldVerdictRow>([]))}
      />,
    );

    // A visible, announced loading state is present (not a blank viewport).
    const status = screen.getByRole("status");
    expect(status.textContent).toMatch(/Loading gate verdicts/i);
    expect(status.getAttribute("aria-live")).toBe("polite");
  });

  it("replaces the loading state with content once the fetch resolves", async () => {
    render(
      <GateTab
        loadGateVerdicts={() => Promise.resolve(result([passVerdict()]))}
        loadGateFoldVerdicts={() => Promise.resolve(result<GateFoldVerdictRow>([]))}
      />,
    );

    await screen.findByRole("img", { name: /Gate verdict: PASS/i });
    await waitFor(() => {
      expect(screen.queryByText(/Loading gate verdicts/i)).toBeNull();
    });
  });
});
