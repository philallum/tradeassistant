// @vitest-environment jsdom
//
// dashboard-ui `web/` — app-shell accessibility tests (task 9.8).
//
// These are EXAMPLE/accessibility (NOT property) tests. They render the real app shell and
// its chrome controls with injected loaders — no real network — and assert the structural
// accessibility contract the design promises, using Testing Library role/label/structure
// queries (an axe-style, assertion-driven approach that stays deterministic under jsdom —
// see the note at the bottom of this file for the toolchain choice).
//
// Covered here (the chrome):
//   - No tab bar: the rendered tree has no `tablist` / `tab` roles and no bottom-navigation
//     landmark (Req 1.1, 1.5).
//   - Selectors + refresh: the Pair_Selector, the Decision_Date (Historical_Browse) selector,
//     and the refresh control all expose accessible names/labels (Req 12.1, 12.6).
//   - Semantic document structure: exactly ONE top-level `<h1>` inside the `banner` header
//     (Req 12.1).
//   - Tap-target sizing: the selector controls, the refresh button and the error-state retry
//     button carry an explicit minimum tap-target height (Req 12.4).
//
// Validates: Requirements 1.1, 1.5, 12.1, 12.4, 12.6

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiResult } from "../api/snapshot";
import type { DecisionDateRow } from "../api/types";
import { SelectionProvider, type SelectionState } from "../state/selection";
import { AppShell, type DecisionDatesLoader } from "./AppShell";

// The single-window body reads the shared snapshot over `fetch`; keep it pending so these
// chrome tests never touch the network and the shell body stays in its loading state.
beforeEach(() => {
  vi.stubGlobal("fetch", () => new Promise<Response>(() => {}));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** A `/decision-dates` loader returning a fixed, resolved set of dates (no network). */
function datesLoader(dates: readonly string[]): DecisionDatesLoader {
  const rows: readonly DecisionDateRow[] = dates.map((d) => ({ decision_date: d }));
  const result: ApiResult<DecisionDateRow> = { rows, lastUpdated: "2026-09-16T00:00:00.000Z" };
  return () => Promise.resolve(result);
}

/** Render the shell inside a SelectionProvider seeded with a concrete selection. */
async function renderShell(
  initialState: SelectionState,
  dates: readonly string[] = ["2026-09-14", "2026-09-15", "2026-09-16"],
): Promise<void> {
  render(
    <SelectionProvider initialState={initialState}>
      <AppShell loadDecisionDates={datesLoader(dates)} />
    </SelectionProvider>,
  );
  // Wait past the shell's initial dates fetch (the refresh control is disabled while it is
  // in flight) so the chrome is settled before asserting.
  await waitFor(() =>
    expect((screen.getByRole("button", { name: /Refresh data/i }) as HTMLButtonElement).disabled).toBe(
      false,
    ),
  );
}

/** Parse the numeric pixel value of a style property (e.g. "44px" → 44). */
function pxValue(el: HTMLElement, prop: "minHeight" | "minWidth"): number {
  const raw = el.style[prop];
  return raw === "" ? 0 : Number.parseFloat(raw);
}

/** The minimum comfortable tap-target edge the components commit to (Req 12.4). */
const MIN_TAP_TARGET_PX = 44;

describe("AppShell a11y — no tab bar (Req 1.1, 1.5)", () => {
  it("renders no tablist, tab, or bottom-navigation landmark", async () => {
    await renderShell({ pair: "ALL", date: "2026-09-16" });

    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.queryByRole("tabpanel")).toBeNull();
    expect(screen.queryByRole("navigation", { name: /Dashboard categories/i })).toBeNull();
    expect(document.querySelector('[role="tablist"], [role="tab"], [role="tabpanel"]')).toBeNull();
  });
});

describe("AppShell a11y — selectors + refresh accessible names (Req 12.1, 12.6)", () => {
  it("labels the Pair_Selector, the Decision_Date selector, and the refresh control", async () => {
    // Narrow viewport is the default jsdom media state → the Pair_Selector renders as a
    // native <select> with the "Currency pair" accessible name.
    await renderShell({ pair: "ALL", date: "2026-09-16" });

    // Pair selector (combobox on narrow viewports) carries an accessible name.
    expect(screen.getByRole("combobox", { name: /Currency pair/i })).toBeTruthy();
    // Decision_Date (Historical_Browse) selector carries an accessible name.
    expect(
      screen.getByRole("combobox", { name: /Decision date \(historical browse\)/i }),
    ).toBeTruthy();
    // Refresh control carries an accessible name.
    expect(screen.getByRole("button", { name: /Refresh data/i })).toBeTruthy();
  });
});

describe("AppShell a11y — semantic document structure (Req 12.1)", () => {
  it("renders exactly one top-level heading (h1)", async () => {
    await renderShell({ pair: "ALL", date: "2026-09-16" });

    const h1s = screen.getAllByRole("heading", { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0]?.textContent).toMatch(/Dashboard/i);
  });

  it("exposes a banner header that contains the single h1", async () => {
    await renderShell({ pair: "ALL", date: "2026-09-16" });

    const banner = screen.getByRole("banner");
    expect(within(banner).getByRole("heading", { level: 1 })).toBeTruthy();
  });
});

describe("AppShell a11y — tap-target sizing (Req 12.4)", () => {
  it("sizes the selector controls and the refresh button to at least the minimum tap target", async () => {
    await renderShell({ pair: "ALL", date: "2026-09-16" });

    const pair = screen.getByRole("combobox", { name: /Currency pair/i });
    const date = screen.getByRole("combobox", {
      name: /Decision date \(historical browse\)/i,
    });
    const refresh = screen.getByRole("button", { name: /Refresh data/i });

    expect(pxValue(pair as HTMLElement, "minHeight")).toBeGreaterThanOrEqual(MIN_TAP_TARGET_PX);
    expect(pxValue(date as HTMLElement, "minHeight")).toBeGreaterThanOrEqual(MIN_TAP_TARGET_PX);
    expect(pxValue(refresh, "minHeight")).toBeGreaterThanOrEqual(MIN_TAP_TARGET_PX);
  });

  it("sizes the error-state retry button to at least the minimum tap target (Req 12.4)", async () => {
    // Drive the shell into its error state with a rejecting loader, then assert the retry
    // affordance is both accessible and comfortably sized.
    const failing: DecisionDatesLoader = () =>
      Promise.reject(new Error("The dashboard data could not be loaded."));
    render(
      <SelectionProvider initialState={{ pair: "ALL", date: "2026-09-16" }}>
        <AppShell loadDecisionDates={failing} />
      </SelectionProvider>,
    );

    const retry = await screen.findByRole("button", { name: /Try again/i });
    expect(pxValue(retry, "minHeight")).toBeGreaterThanOrEqual(MIN_TAP_TARGET_PX);
    // The failure surfaces as an alert, never a blank screen.
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
  });
});

// ---------------------------------------------------------------------------------------
// Toolchain note (task 9.8): these accessibility assertions are written with explicit
// Testing Library role/label/structure + heading-level + tap-target queries rather than an
// axe-core/jest-axe automated scan. axe-core's richer rules (color-contrast, region layout)
// are layout-dependent and known to be unreliable under jsdom, which renders no layout and
// computes no color contrast — running them here would produce non-deterministic noise and
// risk destabilizing the existing node-env pure/property suite. The explicit queries assert
// exactly the a11y contract the requirements call out (roles, accessible names, single-h1
// semantic structure, text/shape-not-color, chart text equivalents, tap-target sizing) and
// stay deterministic. This is the documented fallback the task permits.
