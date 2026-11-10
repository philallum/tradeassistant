// @vitest-environment jsdom
//
// TrackRecordHistory DOM test: loading, error, empty (pending only) and ready states render
// the shaped record with its "not a probability" label.

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { RealizedOutcomeRow } from "../../api/types";
import { TrackRecordHistory } from "./TrackRecordHistory";

afterEach(() => {
  cleanup();
});

function row(over: Partial<RealizedOutcomeRow> = {}): RealizedOutcomeRow {
  return {
    strategy_id: "system",
    pair: "EURUSD",
    decision_date: "2026-11-02",
    predicted_direction: "UP",
    horizon: 1,
    earned_confidence: 0.57,
    stop_loss_pips: null,
    take_profit_pips: null,
    realized_direction: "UP",
    realized_mfe_pips: 10,
    realized_mae_pips: 4,
    matured: true,
    ...over,
  };
}

describe("TrackRecordHistory", () => {
  it("renders the record, tables and the not-a-probability label", async () => {
    render(
      <TrackRecordHistory
        loadRealizedOutcomes={() =>
          Promise.resolve([row(), row({ decision_date: "2026-11-03", realized_direction: "DOWN" })])
        }
      />,
    );
    await waitFor(() => expect(screen.getByText(/Right 50.0% of 2 decided setups/)).toBeTruthy());
    expect(screen.getByText("Historical record of fired setups. Not a probability.")).toBeTruthy();
    expect(screen.getByText("By pair")).toBeTruthy();
    expect(screen.getByText("By confidence band")).toBeTruthy();
    expect(screen.getByText("Most recent decided setups")).toBeTruthy();
  });

  it("says nothing has matured when only pending rows exist", async () => {
    render(
      <TrackRecordHistory
        loadRealizedOutcomes={() => Promise.resolve([row({ matured: false, realized_direction: null })])}
      />,
    );
    await waitFor(() => expect(screen.getByText(/No fired setups have matured yet/)).toBeTruthy());
  });

  it("shows a fixed non-secret message when the load fails", async () => {
    render(<TrackRecordHistory loadRealizedOutcomes={() => Promise.reject(new Error("boom"))} />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("The track record could not be loaded."));
  });
});
