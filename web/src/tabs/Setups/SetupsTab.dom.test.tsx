// @vitest-environment jsdom
//
// Setups re-org render tests: loading / empty / content / un-validated states from injected
// loaders (no network). Validates: Requirements 10.1, 10.3
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { FiringSetupRow } from "../../api/types";
import { SelectionProvider } from "../../state/selection";
import { SetupsTab, type SetupsEvidence } from "./SetupsTab";

afterEach(cleanup);

const DATE = "2026-02-01";
const firing: FiringSetupRow = {
  decision_date: DATE,
  pair: "EURUSD",
  strategy_id: "s1",
  direction: "UP",
  horizon: 2,
  earned_confidence: 0.6,
  stop_loss_pips: 30,
  take_profit_pips: 45,
  surfaced: true,
  suppression_reason: null,
};
const empty = { rows: [] as never[], lastUpdated: null };
const evidence: SetupsEvidence = {
  analogueOutcomes: [],
  tradeLedgerSummary: { window: null, strategies: [] },
  provenance: [],
  validationStatus: [],
};

function renderTab(opts: {
  dates?: string[];
  rows?: FiringSetupRow[];
  ev?: SetupsEvidence;
  pending?: boolean;
}): void {
  render(
    <SelectionProvider initialState={{ pair: "ALL", date: null }}>
      <SetupsTab
        loadDecisionDates={() =>
          opts.pending === true
            ? new Promise(() => undefined)
            : Promise.resolve({
                rows: (opts.dates ?? [DATE]).map((decision_date) => ({ decision_date })),
                lastUpdated: null,
              })
        }
        loadFiringSetups={() => Promise.resolve({ rows: opts.rows ?? [], lastUpdated: null })}
        loadPairEvaluations={() => Promise.resolve(empty)}
        loadDailyCommentary={() =>
          Promise.resolve({ decision_date: "", note_text: "", generated: false })
        }
        loadEvidence={() => Promise.resolve(opts.ev ?? evidence)}
      />
    </SelectionProvider>,
  );
}

describe("SetupsTab re-org", () => {
  it("shows a loading state", () => {
    renderTab({ pending: true });
    expect(screen.getByText(/Loading setups/i)).toBeTruthy();
  });

  it("shows the empty state when no dates exist", async () => {
    renderTab({ dates: [] });
    expect(await screen.findByText(/No data for this date/i)).toBeTruthy();
  });

  it("renders FORECAST and TRADE groups with un-validated markers on SL/TP", async () => {
    renderTab({ rows: [firing] });
    expect(await screen.findByText("FORECAST")).toBeTruthy();
    expect(screen.getByText("TRADE")).toBeTruthy();
    expect(screen.getByText(/30 pips/)).toBeTruthy();
    // confidence, SL, TP, net expectancy are all un-validated on an empty v4 snapshot.
    expect(screen.getAllByTestId("unvalidated-marker").length).toBe(4);
    expect(screen.getAllByText(/un-validated/).length).toBeGreaterThanOrEqual(4);
  });

  it("renders historical evidence before the advisory AI note and drops choppiness", async () => {
    const analogue = (mfe: number, mae: number) => ({
      asset: "EURUSD",
      decision_date: "2025-01-01",
      horizon: 2 as const,
      direction: "UP" as const,
      mfe_pips: mfe,
      mae_pips: mae,
      matured: true,
    });
    render(
      <SelectionProvider initialState={{ pair: "ALL", date: null }}>
        <SetupsTab
          loadDecisionDates={() =>
            Promise.resolve({ rows: [{ decision_date: DATE }], lastUpdated: null })
          }
          loadFiringSetups={() => Promise.resolve({ rows: [firing], lastUpdated: null })}
          loadPairEvaluations={() => Promise.resolve(empty)}
          loadDailyCommentary={() =>
            Promise.resolve({ decision_date: DATE, note_text: "AI says hi", generated: true })
          }
          loadEvidence={() =>
            Promise.resolve({
              ...evidence,
              analogueOutcomes: [analogue(50, 5), analogue(5, 40), analogue(50, 40), analogue(1, 1)],
            })
          }
        />
      </SelectionProvider>,
    );
    const panel = await screen.findByTestId("evidence-panel");
    expect(panel.textContent).toMatch(/4 matured analogues/);
    expect(panel.textContent).toMatch(/target only: 1/);
    expect(panel.textContent).toMatch(/stop only: 1/);
    expect(panel.textContent).toMatch(/order\s*unresolved\): 1/);
    const note = screen.getByText("AI says hi");
    expect(
      panel.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.queryByText(/Choppiness/i)).toBeNull();
  });

  it("degrades cleanly on a v3 snapshot (no evidence slices)", async () => {
    renderTab({ rows: [firing] });
    await screen.findByText("FORECAST");
    expect(screen.getByText(/0 matured analogues/)).toBeTruthy();
    expect(screen.getByText(/not yet measured/)).toBeTruthy();
  });

  it("shows no markers when everything is validated", async () => {
    renderTab({
      rows: [firing],
      ev: {
        analogueOutcomes: [],
        provenance: [],
        validationStatus: [{ decision_date: DATE, pair: "EURUSD", status: "validated" }],
        tradeLedgerSummary: {
          window: { from: "a", to: "b" },
          strategies: [
            {
              role: "system",
              summary: {
                strategyId: "s1",
                netExpectancyPips: 2,
                netExpectancyR: 0.1,
                grossExpectancyPips: 3,
                winRate: 0.5,
                avgWinPips: 1,
                avgLossPips: 1,
                profitFactor: 1,
                maxDrawdownPips: 1,
                longestLosingStreak: 1,
                tradeCount: 10,
                timeInMarketDays: 1,
                ambiguousShare: 0,
                expiredShare: 0,
              },
            },
          ],
        },
      },
    });
    await screen.findByText("FORECAST");
    expect(screen.queryAllByTestId("unvalidated-marker").length).toBe(0);
  });
});
