// Unit tests for loadSnapshotHistory() + windowStartDate() (daily-run
// dashboard-data). These assert the history loader:
//   1. maps each persisted table's rows into the snapshot wire shapes;
//   2. derives decisionDates from the firing-setups slice (deduped, ascending);
//   3. bounds the candles/analogue queries by the window cutoff date;
//   4. is fail-safe PER SLICE — a slice whose GET fails degrades to [] and never
//      throws, so the run is never broken by a transient read error.
// A stub `fetch` is injected through SupabaseRestClient — no network, no secret.

import { describe, expect, it, vi } from "vitest";

import type { SupabaseConfig } from "../storage/supabaseConfig.js";
import { SupabaseRestClient } from "../storage/supabase/index.js";
import { loadSnapshotHistory, windowStartDate, HISTORY_WINDOW_DAYS } from "./snapshotHistory.js";

const CONFIG: SupabaseConfig = {
  target: "hosted",
  url: "https://proj.supabase.co",
  key: "scoped-write-jwt",
  apiKey: "sb_publishable_anon",
};

/** Which table a REST url targets (`/rest/v1/<table>?...`). */
function tableOf(url: string): string {
  const m = /\/rest\/v1\/([^?]+)/.exec(url);
  return m?.[1] ?? "";
}

/** A single-page PostgREST response: the rows plus a matching Content-Range. */
function ok(rows: unknown[]): Response {
  return new Response(JSON.stringify(rows), {
    status: 200,
    headers: { "Content-Range": `0-${Math.max(rows.length - 1, 0)}/${rows.length}` },
  });
}

/**
 * Build a fetch stub returning canned rows per table. A table mapped to the
 * sentinel `"THROW"` rejects, exercising the per-slice fail-safe path. Records
 * every requested URL so the window-cutoff filter can be asserted.
 */
function stubFetch(byTable: Record<string, unknown[] | "THROW">): {
  fetch: typeof fetch;
  urls: string[];
} {
  const urls: string[] = [];
  const fetchImpl = ((url: string | URL) => {
    const u = String(url);
    urls.push(u);
    const table = tableOf(u);
    const canned = byTable[table];
    if (canned === "THROW") {
      return Promise.reject(new Error(`boom:${table}`));
    }
    return Promise.resolve(ok(canned ?? []));
  }) as unknown as typeof fetch;
  return { fetch: fetchImpl, urls };
}

describe("windowStartDate", () => {
  it("subtracts whole days in UTC", () => {
    expect(windowStartDate("2026-10-09", 9)).toBe("2026-09-30");
    expect(windowStartDate("2026-01-01", 1)).toBe("2025-12-31");
  });
});

describe("loadSnapshotHistory", () => {
  const firingRows = [
    {
      decision_date: "2026-10-06",
      pair: "EURUSD",
      strategy_id: "system",
      direction: "DOWN",
      horizon: 1,
      earned_confidence: 0.57,
      stop_loss_pips: null,
      take_profit_pips: null,
      surfaced: true,
      suppression_reason: null,
    },
    {
      decision_date: "2026-09-14",
      pair: "USDJPY",
      strategy_id: "system",
      direction: "DOWN",
      horizon: 1,
      earned_confidence: 0.57,
      stop_loss_pips: null,
      take_profit_pips: null,
      surfaced: true,
      suppression_reason: null,
    },
  ];
  const candleRows = [
    { asset: "EURUSD", date: "2026-10-06", open: 1.1, high: 1.2, low: 1.0, close: 1.15 },
  ];
  const analogueRows = [
    { asset: "EURUSD", decision_date: "2026-10-01", horizon: 1, direction: "UP", mfe_pips: 30, mae_pips: 10, matured: true },
  ];
  const realizedRows = [
    {
      strategy_id: "system",
      pair: "EURUSD",
      decision_date: "2026-10-06",
      predicted_direction: "DOWN",
      horizon: 1,
      earned_confidence: 0.57,
      stop_loss_pips: null,
      take_profit_pips: null,
      realized_direction: null,
      realized_mfe_pips: null,
      realized_mae_pips: null,
      matured: false,
    },
  ];
  const reportRows = [
    {
      config_id: "shape-only",
      split_test_start: "2024-01-01",
      split_test_end: "2024-02-01",
      sample_size: 100,
      predictions_count: 100,
      model_accuracy: 0.5,
      baseline_accuracy: 0.48,
      delta_vs_baseline: 0.02,
    },
  ];

  it("maps every slice and derives deduped ascending decisionDates", async () => {
    const { fetch } = stubFetch({
      firing_setups: firingRows,
      candles: candleRows,
      analogue_outcomes: analogueRows,
      realized_outcomes: realizedRows,
      evaluation_reports: reportRows,
    });
    const history = await loadSnapshotHistory(new SupabaseRestClient(CONFIG, fetch), {
      decisionDate: "2026-10-09",
    });

    expect(history.firingSetups).toHaveLength(2);
    expect(history.candles).toHaveLength(1);
    expect(history.analogueOutcomes).toHaveLength(1);
    expect(history.realizedOutcomes).toHaveLength(1);
    expect(history.evaluationReports).toHaveLength(1);
    // Derived from firing rows, deduped + ascending.
    expect(history.decisionDates).toEqual(["2026-09-14", "2026-10-06"]);
    // Wire shape: candle carries verbatim OHLC.
    expect(history.candles?.[0]).toMatchObject({ asset: "EURUSD", close: 1.15 });
  });

  it("bounds candles + analogue_outcomes by the window cutoff date", async () => {
    const { fetch, urls } = stubFetch({ firing_setups: [], candles: [], analogue_outcomes: [] });
    await loadSnapshotHistory(new SupabaseRestClient(CONFIG, fetch), {
      decisionDate: "2026-10-09",
      windowDays: 30,
    });
    const cutoff = windowStartDate("2026-10-09", 30); // 2026-09-09
    const candleUrl = urls.find((u) => tableOf(u) === "candles") ?? "";
    const analogueUrl = urls.find((u) => tableOf(u) === "analogue_outcomes") ?? "";
    expect(candleUrl).toContain(`date=gte.${encodeURIComponent(cutoff)}`);
    expect(analogueUrl).toContain(`decision_date=gte.${encodeURIComponent(cutoff)}`);
    // analogue query also restricts to matured rows.
    expect(analogueUrl).toContain("matured=is.true");
  });

  it("is fail-safe per slice: a failing table yields [] and never throws", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { fetch } = stubFetch({
        firing_setups: firingRows,
        candles: "THROW", // this slice fails
        analogue_outcomes: analogueRows,
        realized_outcomes: realizedRows,
        evaluation_reports: reportRows,
      });
      const history = await loadSnapshotHistory(new SupabaseRestClient(CONFIG, fetch), {
        decisionDate: "2026-10-09",
      });
      // The failing slice is empty; every other slice still loaded.
      expect(history.candles).toEqual([]);
      expect(history.firingSetups).toHaveLength(2);
      expect(history.analogueOutcomes).toHaveLength(1);
      // A secret-free warning was logged for the failing slice.
      expect(warn).toHaveBeenCalled();
      const logged = warn.mock.calls.map((c) => String(c[0])).join("\n");
      expect(logged).toContain("snapshot_history_slice_failed");
      expect(logged).not.toContain("scoped-write-jwt");
    } finally {
      warn.mockRestore();
    }
  });

  it("defaults the window to HISTORY_WINDOW_DAYS when unspecified", async () => {
    const { fetch, urls } = stubFetch({ firing_setups: [], candles: [], analogue_outcomes: [] });
    await loadSnapshotHistory(new SupabaseRestClient(CONFIG, fetch), {
      decisionDate: "2026-10-09",
    });
    const cutoff = windowStartDate("2026-10-09", HISTORY_WINDOW_DAYS);
    const candleUrl = urls.find((u) => tableOf(u) === "candles") ?? "";
    expect(candleUrl).toContain(`date=gte.${encodeURIComponent(cutoff)}`);
  });
});
