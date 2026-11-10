// @vitest-environment jsdom
//
// SingleWindowShell load state machine: loading -> ready, error + retry (disabled while in
// flight), 10 s stall -> error, empty set, no-data-for-date, and no stack trace / raw payload.
// Loaders are injected fakes (no network); timers are fake. Assertions stay on load-state
// behaviour only (not on the ready-card internals).
// Validates: Requirements 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  EMPTY_CONFLUENCE,
  EMPTY_INTRADAY_VALIDATION,
  EMPTY_SIGNAL_SCORECARD,
  EMPTY_TRACK_RECORD,
} from "../api/snapshot";
import type { FiringSetupRow } from "../api/types";
import { SelectionProvider } from "../state/selection";
import { LOAD_TIMEOUT_MS, SingleWindowShell, type WindowEvidence } from "./SingleWindowShell";

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

const evidence: WindowEvidence = {
  analogueOutcomes: [],
  pairEvaluations: [],
  trackRecord: EMPTY_TRACK_RECORD,
  signalScorecard: EMPTY_SIGNAL_SCORECARD,
  intradayValidation: EMPTY_INTRADAY_VALIDATION,
};

type Rows = readonly FiringSetupRow[];

/** Fake loaders; `firingRows` is the only per-test variable. */
function loaders(firingRows: () => Promise<{ rows: Rows; lastUpdated: null }>) {
  return {
    loadFiringSetups: vi.fn(firingRows),
    loadConfluence: vi.fn(() => Promise.resolve(EMPTY_CONFLUENCE)),
    loadEvidence: vi.fn(() => Promise.resolve(evidence)),
    loadDailyCommentary: vi.fn(() =>
      Promise.resolve({ decision_date: "", note_text: "", generated: false }),
    ),
    loadEvaluationReports: vi.fn(() => Promise.resolve({ rows: [], lastUpdated: null })),
  };
}

function renderShell(
  props: ReturnType<typeof loaders>,
  decisionDate: string | null = DATE,
): void {
  render(
    <SelectionProvider initialState={{ pair: "EURUSD", date: null }}>
      <SingleWindowShell refreshNonce={0} decisionDate={decisionDate} {...props} />
    </SelectionProvider>,
  );
}

/** Flush pending promise microtasks inside act. */
async function flush(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

const readyMarker = () => screen.queryByRole("group", { name: "All pairs" });

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("SingleWindowShell load state machine", () => {
  it("renders the loading state synchronously, then the ready state (Req 11.1, 11.2)", async () => {
    renderShell(loaders(() => Promise.resolve({ rows: [firing], lastUpdated: null })));

    // Visible on first render, before any timer or promise has run.
    expect(screen.getByText(/Loading dashboard/i)).toBeTruthy();
    expect(readyMarker()).toBeNull();

    await flush();

    expect(screen.queryByText(/Loading dashboard/i)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(readyMarker()).not.toBeNull();
  });

  it("shows a non-secret error with a retry that recovers (Req 11.3, 11.4)", async () => {
    let calls = 0;
    const props = loaders(() => {
      calls += 1;
      return calls === 1
        ? Promise.reject(new Error("The dashboard data could not be loaded."))
        : Promise.resolve({ rows: [firing], lastUpdated: null });
    });
    renderShell(props);
    await flush();

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("The dashboard data could not be loaded.");
    expect(screen.queryByText(/Loading dashboard/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    await flush();

    expect(props.loadFiringSetups).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(readyMarker()).not.toBeNull();
  });

  it("disables the retry button while a retry is in flight (Req 11.6)", async () => {
    let calls = 0;
    let release: (v: { rows: Rows; lastUpdated: null }) => void = () => undefined;
    const props = loaders(() => {
      calls += 1;
      if (calls === 1) return Promise.reject(new Error("The dashboard data could not be loaded."));
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    renderShell(props);
    await flush();

    const button = screen.getByRole("button", { name: /try again/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);

    fireEvent.click(button);
    await flush();

    // Retry is pending: still the error region, button disabled, no second concurrent click.
    const inFlight = screen.getByRole("button", { name: /try again/i }) as HTMLButtonElement;
    expect(inFlight.disabled).toBe(true);
    fireEvent.click(inFlight);
    await flush();
    expect(props.loadFiringSetups).toHaveBeenCalledTimes(2);

    await act(async () => {
      release({ rows: [firing], lastUpdated: null });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(readyMarker()).not.toBeNull();
  });

  it("treats a 10 s stall as a failure and renders the error state (Req 11.5)", async () => {
    const props = loaders(() => new Promise(() => undefined));
    renderShell(props);
    await flush();
    expect(screen.getByText(/Loading dashboard/i)).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS - 1);
    });
    expect(screen.queryByRole("alert")).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("could not be loaded in time");
    expect(screen.queryByText(/Loading dashboard/i)).toBeNull();
    expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();
  });

  it("shows the explicit empty message when no run is persisted (Req 11.2)", async () => {
    const props = loaders(() => Promise.resolve({ rows: [], lastUpdated: null }));
    renderShell(props, null);
    await flush();

    expect(screen.getByText("No runs have been persisted yet.")).toBeTruthy();
    expect(screen.queryByText(/Loading dashboard/i)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(props.loadFiringSetups).not.toHaveBeenCalled();
  });

  it("shows a no-data-for-date message when the date has no rows (Req 11.2)", async () => {
    renderShell(loaders(() => Promise.resolve({ rows: [], lastUpdated: null })));
    await flush();

    expect(screen.getByText("No data for this date.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(readyMarker()).toBeNull();
  });

  it("never shows a stack trace or raw payload when a loader throws (Req 11.7)", async () => {
    const leaky = new Error("The dashboard data could not be loaded.");
    leaky.stack = "Error: boom\n    at loadSnapshot (/app/src/api/snapshot.ts:465:11)";
    const props = loaders(() => Promise.reject(leaky));
    renderShell(props);
    await flush();

    const text = document.body.textContent ?? "";
    expect(text).toContain("The dashboard data could not be loaded.");
    expect(text).not.toMatch(/\bat \w+ \(/);
    expect(text).not.toMatch(/\.tsx?:\d+/);
    expect(text).not.toContain("loadSnapshot");
  });

  it("falls back to a generic message for a non-Error rejection carrying a raw payload (Req 11.7)", async () => {
    const payload = '{"token":"s3cret","rows":[1,2,3]}';
    const props = loaders(() => Promise.reject({ body: payload }));
    renderShell(props);
    await flush();

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("The dashboard data could not be loaded.");
    const text = document.body.textContent ?? "";
    expect(text).not.toContain("s3cret");
    expect(text).not.toContain("{");
    expect(text).not.toContain("[object Object]");
  });
});

describe("SingleWindowShell data-health banner", () => {
  const provenance = (over: { dataComplete: boolean; staleReason: string | null }) => [
    {
      decision_date: DATE,
      pair: "EURUSD",
      lastCandleTimestamp: "2026-01-30T17:00:00-05:00",
      computedAt: "2026-02-01T17:30:00.000Z",
      earliestEntryRef: "2026-02-01T17:00:00-05:00",
      horizonStart: "2026-02-01T17:00:00-05:00",
      horizonEnd: "2026-02-01T17:00:00-05:00",
      ...over,
    },
  ];

  it("shows the non-blocking banner alongside the dashboard when a pair's candle is missing", async () => {
    const props = loaders(() => Promise.resolve({ rows: [firing], lastUpdated: null }));
    props.loadEvidence.mockImplementation(() =>
      Promise.resolve({
        ...evidence,
        provenance: provenance({ dataComplete: false, staleReason: "missing_candle" }),
      }),
    );
    renderShell(props);
    await flush();

    expect(readyMarker()).not.toBeNull(); // the dashboard still renders
    const banner = screen.getByTestId("data-health-banner");
    expect(banner.textContent).toContain("Data feed delayed");
    expect(banner.textContent).toContain("EURUSD: latest session candle missing");
  });

  it("shows no banner when provenance is complete", async () => {
    const props = loaders(() => Promise.resolve({ rows: [firing], lastUpdated: null }));
    props.loadEvidence.mockImplementation(() =>
      Promise.resolve({
        ...evidence,
        provenance: provenance({ dataComplete: true, staleReason: null }),
      }),
    );
    renderShell(props);
    await flush();

    expect(readyMarker()).not.toBeNull();
    expect(screen.queryByTestId("data-health-banner")).toBeNull();
  });
});
