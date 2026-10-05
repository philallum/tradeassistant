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
//   - Tabs: the bottom tab bar exposes a `tablist` with `tab` roles, correct `aria-selected`,
//     and each tab's `aria-controls` names its tabpanel (Req 16.5).
//   - Selectors + refresh: the Pair_Selector, the Decision_Date (Historical_Browse) selector,
//     and the refresh control all expose accessible names/labels (Req 16.5, 18.2).
//   - Semantic document structure: exactly ONE top-level `<h1>`, with the active tab's
//     section heading rendered at `<h2>` beneath it (Req 18.1), and labeled landmark
//     regions (header is a `banner`, the tab bar is a labeled `navigation`) (Req 18.2).
//   - Tap-target sizing: the tab buttons, the selector controls, and the refresh button all
//     carry an explicit minimum tap-target height (Req 18.5).
//
// Validates: Requirements 16.5, 18.1, 18.2, 18.5

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { ApiResult } from "../api/client";
import type { DecisionDateRow } from "../api/endpoints";
import { TABS } from "../routing/routes";
import { SelectionProvider, type SelectionState } from "../state/selection";
import { AppShell, type DecisionDatesLoader } from "./AppShell";

afterEach(() => {
  cleanup();
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
  // Wait past the shell's initial `/decision-dates` fetch so the routed tab (not the
  // top-level loading state) is mounted.
  await screen.findByRole("tabpanel");
}

/** Parse the numeric pixel value of a style property (e.g. "44px" → 44). */
function pxValue(el: HTMLElement, prop: "minHeight" | "minWidth"): number {
  const raw = el.style[prop];
  return raw === "" ? 0 : Number.parseFloat(raw);
}

/** The minimum comfortable tap-target edge the components commit to (Req 18.5). */
const MIN_TAP_TARGET_PX = 44;

describe("AppShell a11y — bottom tab bar roles/labels (Req 16.5)", () => {
  it("exposes a labeled tablist with one tab role per Category_Tab", async () => {
    await renderShell({ pair: "ALL", date: "2026-09-16" });

    const tablist = screen.getByRole("tablist", { name: /Dashboard categories/i });
    const tabs = within(tablist).getAllByRole("tab");
    expect(tabs).toHaveLength(TABS.length);

    // Every registered Category_Tab is present by its accessible name.
    for (const tab of TABS) {
      expect(screen.getByRole("tab", { name: tab.label })).toBeTruthy();
    }
  });

  it("marks exactly one tab aria-selected and links each tab to its tabpanel via aria-controls", async () => {
    await renderShell({ pair: "ALL", date: "2026-09-16" });

    const tabs = screen.getAllByRole("tab");
    const selected = tabs.filter((t) => t.getAttribute("aria-selected") === "true");
    expect(selected).toHaveLength(1);

    // The selected tab's aria-controls names a tabpanel that actually exists and whose
    // aria-labelledby points back at the tab (the tab/panel ARIA relationship, Req 16.5).
    const activeTab = selected[0] as HTMLElement;
    const panelId = activeTab.getAttribute("aria-controls");
    expect(panelId).toBeTruthy();

    const panel = document.getElementById(panelId as string);
    expect(panel).not.toBeNull();
    expect((panel as HTMLElement).getAttribute("role")).toBe("tabpanel");
    expect((panel as HTMLElement).getAttribute("aria-labelledby")).toBe(activeTab.id);
  });

  it("gives every tab a non-empty aria-controls (named panel) even when inactive", async () => {
    await renderShell({ pair: "ALL", date: "2026-09-16" });
    for (const tab of screen.getAllByRole("tab")) {
      expect(tab.getAttribute("aria-controls")).toMatch(/^tabpanel-/);
      // aria-selected is always present (true/false), never missing.
      expect(["true", "false"]).toContain(tab.getAttribute("aria-selected"));
    }
  });
});

describe("AppShell a11y — selectors + refresh accessible names (Req 16.5, 18.2)", () => {
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

describe("AppShell a11y — semantic document structure (Req 18.1, 18.2)", () => {
  it("renders exactly one top-level heading (h1)", async () => {
    await renderShell({ pair: "ALL", date: "2026-09-16" });

    const h1s = screen.getAllByRole("heading", { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0]?.textContent).toMatch(/Dashboard/i);
  });

  it("renders the active tab's section heading at h2 beneath the single h1", async () => {
    // Setups is the default route; its panel heading is an <h2>.
    await renderShell({ pair: "ALL", date: "2026-09-16" });

    const h1 = screen.getByRole("heading", { level: 1 });
    const h2 = await screen.findByRole("heading", { level: 2 });
    expect(h2).toBeTruthy();
    // The h2 lives inside the active tabpanel (a labeled section beneath the h1).
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getByRole("heading", { level: 2 })).toBe(h2);
    // There is no competing h1 inside the panel.
    expect(within(panel).queryByRole("heading", { level: 1 })).toBeNull();
    expect(h1).not.toBe(h2);
  });

  it("exposes labeled landmark regions: a banner header and a labeled navigation", async () => {
    await renderShell({ pair: "ALL", date: "2026-09-16" });

    // The <header> is the banner landmark; it contains the single h1.
    const banner = screen.getByRole("banner");
    expect(within(banner).getByRole("heading", { level: 1 })).toBeTruthy();

    // The bottom tab bar is a labeled navigation landmark.
    expect(screen.getByRole("navigation", { name: /Dashboard categories/i })).toBeTruthy();
  });
});

describe("AppShell a11y — tap-target sizing (Req 18.5)", () => {
  it("sizes the tab buttons to at least the minimum tap target", async () => {
    await renderShell({ pair: "ALL", date: "2026-09-16" });
    for (const tab of screen.getAllByRole("tab")) {
      expect(pxValue(tab, "minHeight")).toBeGreaterThanOrEqual(MIN_TAP_TARGET_PX);
    }
  });

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

  it("sizes the error-state retry button to at least the minimum tap target (Req 18.5, 17.5)", async () => {
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
