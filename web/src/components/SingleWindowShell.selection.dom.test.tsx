// @vitest-environment jsdom
//
// SingleWindowShell selection defaulting and last-good-card retention (injected loaders, no
// network). Refresh is modelled by rerendering with a changed `refreshNonce`.
// Validates: Requirements 2.6, 2.8, 10.1, 10.2, 10.3, 10.5, 10.7, 10.8

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EMPTY_CONFLUENCE } from "../api/snapshot";
import type { FiringSetupRow, Pair } from "../api/types";
import { SelectionProvider, type SelectionState } from "../state/selection";
import type { SetupsEvidence } from "../tabs/Setups/SetupsTab";
import { SingleWindowShell } from "./SingleWindowShell";

const DATE = "2026-02-01";

function firing(pair: Pair): FiringSetupRow {
  return {
    decision_date: DATE,
    pair,
    strategy_id: "s1",
    direction: "UP",
    horizon: 2,
    earned_confidence: 0.6,
    stop_loss_pips: 30,
    take_profit_pips: 45,
    surfaced: true,
    suppression_reason: null,
  };
}

const ROWS = [firing("EURUSD"), firing("GBPUSD")];
const EVIDENCE: SetupsEvidence = {
  analogueOutcomes: [],
  tradeLedgerSummary: { window: null, strategies: [] },
  provenance: [],
  validationStatus: [],
};

interface Loaders {
  loadFiringSetups: ReturnType<typeof vi.fn>;
  loadConfluence: ReturnType<typeof vi.fn>;
  loadEvidence: ReturnType<typeof vi.fn>;
  loadDailyCommentary: ReturnType<typeof vi.fn>;
  loadEvaluationReports: ReturnType<typeof vi.fn>;
}

function makeLoaders(): Loaders {
  return {
    loadFiringSetups: vi.fn(() => Promise.resolve({ rows: ROWS, lastUpdated: null })),
    loadConfluence: vi.fn(() => Promise.resolve(EMPTY_CONFLUENCE)),
    loadEvidence: vi.fn(() => Promise.resolve(EVIDENCE)),
    loadDailyCommentary: vi.fn(() =>
      Promise.resolve({ decision_date: "", note_text: "", generated: false }),
    ),
    loadEvaluationReports: vi.fn(() => Promise.resolve({ rows: [], lastUpdated: null })),
  };
}

function shell(loaders: Loaders, refreshNonce: number): ReactElement {
  return (
    <SingleWindowShell
      refreshNonce={refreshNonce}
      decisionDate={DATE}
      loadFiringSetups={loaders.loadFiringSetups as never}
      loadConfluence={loaders.loadConfluence as never}
      loadEvidence={loaders.loadEvidence as never}
      loadDailyCommentary={loaders.loadDailyCommentary as never}
      loadEvaluationReports={loaders.loadEvaluationReports as never}
    />
  );
}

function wrap(el: ReactElement, initialState?: SelectionState): ReactElement {
  return initialState === undefined ? (
    <SelectionProvider>{el}</SelectionProvider>
  ) : (
    <SelectionProvider initialState={initialState}>{el}</SelectionProvider>
  );
}

function setUrl(search: string): void {
  window.history.replaceState(null, "", `/${search}`);
}

function stripButton(pair: Pair): HTMLElement {
  const el = document.querySelector<HTMLElement>(`button[data-pair="${pair}"]`);
  if (el === null) throw new Error(`strip entry for ${pair} not found`);
  return el;
}

function selectedPair(): string | null {
  const pressed = document.querySelector<HTMLElement>('button[data-pair][aria-pressed="true"]');
  return pressed === null ? null : pressed.getAttribute("data-pair");
}

async function waitReady(): Promise<void> {
  await screen.findByRole("group", { name: "All pairs" });
}

beforeEach(() => setUrl(""));
afterEach(() => {
  cleanup();
  setUrl("");
});

describe("SingleWindowShell selection defaulting (Req 2.6, 10.3)", () => {
  it("maps the ALL sentinel to EURUSD", async () => {
    render(wrap(shell(makeLoaders(), 0), { pair: "ALL", date: DATE }));
    await waitReady();
    expect(selectedPair()).toBe("EURUSD");
    expect(screen.getByTestId("master-card").getAttribute("aria-label")).toContain("EURUSD");
  });

  it("defaults an invalid pair to EURUSD while retaining the valid date", async () => {
    setUrl(`?pair=XXXXXX&date=${DATE}`);
    render(wrap(shell(makeLoaders(), 0)));
    await waitReady();
    expect(selectedPair()).toBe("EURUSD");
    expect(screen.getByText(/requested selection was unavailable/i)).toBeTruthy();
    await waitFor(() => expect(window.location.search).toContain(`date=${DATE}`));
  });

  it("defaults an invalid date while retaining the valid pair", async () => {
    setUrl("?pair=GBPUSD&date=2020-01-01");
    const loaders = makeLoaders();
    render(wrap(shell(loaders, 0)));
    await waitReady();
    expect(selectedPair()).toBe("GBPUSD");
    expect(screen.getByText(/requested selection was unavailable/i)).toBeTruthy();
    // The data is loaded for the effective (latest) date, not the rejected one.
    expect(loaders.loadFiringSetups.mock.calls[0]?.[0]).toBe(DATE);
  });
});

describe("SingleWindowShell deep link and URL mirroring (Req 10.1, 10.2, 10.5)", () => {
  it("restores a deep link carrying both a valid pair and date", async () => {
    setUrl(`?pair=GBPUSD&date=${DATE}`);
    render(wrap(shell(makeLoaders(), 0)));
    await waitReady();
    expect(selectedPair()).toBe("GBPUSD");
    expect(screen.getByTestId("master-card").getAttribute("aria-label")).toContain("GBPUSD");
    expect(screen.queryByText(/requested selection was unavailable/i)).toBeNull();
  });

  it("mirrors the pair and date into the URL, updating on strip activation", async () => {
    render(wrap(shell(makeLoaders(), 0), { pair: "EURUSD", date: DATE }));
    await waitReady();
    await waitFor(() => {
      expect(window.location.search).toContain("pair=EURUSD");
      expect(window.location.search).toContain(`date=${DATE}`);
    });

    fireEvent.click(stripButton("GBPUSD"));
    await waitFor(() => expect(window.location.search).toContain("pair=GBPUSD"));
    expect(window.location.search).toContain(`date=${DATE}`);
    expect(selectedPair()).toBe("GBPUSD");
  });
});

describe("SingleWindowShell last-good-card retention (Req 2.8, 10.7, 10.8)", () => {
  it("keeps the previous card and shows an inline message when a refresh fails", async () => {
    const loaders = makeLoaders();
    const view = render(wrap(shell(loaders, 0), { pair: "EURUSD", date: DATE }));
    await waitReady();
    expect(screen.getByTestId("master-card")).toBeTruthy();

    loaders.loadFiringSetups.mockImplementation(() =>
      Promise.reject(new Error("The dashboard data could not be loaded.")),
    );
    view.rerender(wrap(shell(loaders, 1), { pair: "EURUSD", date: DATE }));

    expect(await screen.findByText(/refresh did not complete/i)).toBeTruthy();
    expect(screen.getByTestId("master-card")).toBeTruthy();
    expect(screen.queryByText(/Loading dashboard/i)).toBeNull();
  });

  it("keeps the card visible while a refresh is in flight", async () => {
    const loaders = makeLoaders();
    const view = render(wrap(shell(loaders, 0), { pair: "EURUSD", date: DATE }));
    await waitReady();

    loaders.loadFiringSetups.mockImplementation(() => new Promise(() => undefined));
    view.rerender(wrap(shell(loaders, 1), { pair: "EURUSD", date: DATE }));

    await waitFor(() => expect(loaders.loadFiringSetups).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId("master-card")).toBeTruthy();
    expect(screen.queryByText(/Loading dashboard/i)).toBeNull();
    expect(screen.queryByText(/refresh did not complete/i)).toBeNull();
  });
});
