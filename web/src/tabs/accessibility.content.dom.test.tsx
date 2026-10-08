// @vitest-environment jsdom
//
// dashboard-ui `web/` — content accessibility tests (task 9.8).
//
// These are EXAMPLE/accessibility (NOT property) tests. They render the Setups and
// Pattern & Outcomes content with injected loaders — no real network — wrapped in a
// `SelectionProvider` set to a concrete pair, mirroring the 9.7 render-test pattern, and
// assert the per-content accessibility contract with Testing Library role/label/structure
// queries:
//
//   - Accordions (Pattern & Outcomes): each Accordion_Section's trigger is a `button` with
//     `aria-expanded` and `aria-controls`, and the disclosed region is a labeled `region`
//     (role="region" + aria-labelledby back to the trigger) (Req 16.5).
//   - Direction_Class (firing cards): a FiringCard conveys UP/DOWN/FLAT via a TEXT label
//     ("Up"/"Down"/"Flat") AND a non-color SHAPE glyph (▲/▼/■) plus a self-describing
//     aria-label — never color alone (Req 18.3).
//   - Surfaced-vs-suppressed: a SuppressionList entry conveys suppression via the TEXT
//     "Suppressed" + reason phrase and a non-color SHAPE glyph (⦸) plus a self-describing
//     aria-label — never color alone (Req 18.3). The dashboard-level suppressors are removed,
//     so only `below_floor` / `not_fired` reasons remain.
//   - Chart text/table equivalents: the Pattern & Outcomes tab renders a real `<table>`
//     equivalent for each chart (confidence trend, excursion profile, price) so charted
//     values are available without interpreting the visualization (Req 18.4).
//
// Validates: Requirements 16.5, 18.3, 18.4

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";

import type { ApiResult } from "../api/snapshot";
import type {
  AnalogueOutcomeRow,
  CandleRow,
  FiringSetupRow,
  RealizedOutcomeRow,
} from "../api/types";
import { SelectionProvider, type PairSelection } from "../state/selection";
import { FiringCard } from "./Setups/FiringCard";

// Recharts' <ResponsiveContainer> observes its box via ResizeObserver, which jsdom does not
// implement. These a11y tests mount the real Pattern & Outcomes tab (charts + their text/
// table equivalents) only to assert the TEXT/TABLE equivalent (Req 18.4), not the chart
// pixels — so a minimal no-op ResizeObserver stub lets Recharts mount without a real layout
// engine. This is a test-only shim scoped to this DOM file; it does not touch app code.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
if (!("ResizeObserver" in globalThis)) {
  (globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
    ResizeObserverStub;
}
import { SuppressionList } from "./Setups/SuppressionList";
import {
  PatternOutcomesTab,
  type PatternOutcomesLoaders,
} from "./PatternOutcomes/PatternOutcomesTab";
import type { CardVM, SuppressionVM } from "../pure/shapeDashboard";

afterEach(() => {
  cleanup();
});

/** Render inside a SelectionProvider fixed to `pair` (per-pair scope, Req 8.2). */
function renderWith(pair: PairSelection, element: ReactElement): ReturnType<typeof render> {
  return render(
    <SelectionProvider initialState={{ pair, date: "2026-09-16" }}>
      {element}
    </SelectionProvider>,
  );
}

/** Wrap rows as a resolved ApiResult envelope. */
function result<Row>(rows: readonly Row[]): ApiResult<Row> {
  return { rows, lastUpdated: null };
}

// ---------------------------------------------------------------------------------------
// Direction_Class — text + shape, not color alone (Req 18.3)
// ---------------------------------------------------------------------------------------

function card(overrides: Partial<CardVM> = {}): CardVM {
  return {
    pair: "EURUSD",
    strategyId: "strat-1",
    direction: "UP",
    horizon: 2,
    earnedConfidence: 0.72,
    stopLossPips: 20,
    takeProfitPips: 40,
    ...overrides,
  };
}

describe("FiringCard a11y — Direction_Class via text + shape, not color alone (Req 18.3)", () => {
  it("conveys UP with the 'Up' text label and the ▲ shape glyph", () => {
    renderWith("EURUSD", <FiringCard card={card({ direction: "UP" })} />);

    const item = screen.getByRole("listitem");
    const text = item.textContent ?? "";
    // Direction is distinguishable by TEXT...
    expect(text).toMatch(/Up/);
    // ...and by a non-color SHAPE glyph.
    expect(text).toContain("\u25B2"); // ▲
    // The card self-describes the direction in its accessible label (not color alone).
    expect(item.getAttribute("aria-label")).toMatch(/Direction Up/i);
  });

  it("conveys DOWN with the 'Down' text label and the ▼ shape glyph", () => {
    renderWith("EURUSD", <FiringCard card={card({ direction: "DOWN" })} />);
    const item = screen.getByRole("listitem");
    const text = item.textContent ?? "";
    expect(text).toMatch(/Down/);
    expect(text).toContain("\u25BC"); // ▼
    expect(item.getAttribute("aria-label")).toMatch(/Direction Down/i);
  });

  it("conveys FLAT with the 'Flat' text label and the ■ shape glyph", () => {
    renderWith("EURUSD", <FiringCard card={card({ direction: "FLAT" })} />);
    const item = screen.getByRole("listitem");
    const text = item.textContent ?? "";
    expect(text).toMatch(/Flat/);
    expect(text).toContain("\u25A0"); // ■
    expect(item.getAttribute("aria-label")).toMatch(/Direction Flat/i);
  });
});

// ---------------------------------------------------------------------------------------
// Surfaced-vs-suppressed — text + shape, not color alone (Req 18.3, 8.5, 9.3)
// ---------------------------------------------------------------------------------------

describe("SuppressionList a11y — suppressed status via text + shape, not color alone (Req 18.3)", () => {
  it("conveys suppression with the 'Suppressed' text + reason phrase and the ⦸ shape glyph", () => {
    const suppression: SuppressionVM = {
      pair: "USDCHF",
      reason: "below_floor",
    };
    renderWith("EURUSD", <SuppressionList suppressions={[suppression]} />);

    const item = screen.getByRole("listitem");
    const text = item.textContent ?? "";
    // Suppressed status is conveyed by TEXT...
    expect(text).toMatch(/Suppressed/);
    expect(text).toMatch(/Below confidence floor/);
    // ...and by a non-color SHAPE glyph.
    expect(text).toContain("\u29B8"); // ⦸
    // The self-describing aria-label names the suppression and its reason.
    const label = item.getAttribute("aria-label") ?? "";
    expect(label).toMatch(/USDCHF suppressed/i);
    expect(label).toMatch(/Below confidence floor/i);
  });

  it("labels the suppressions section with a heading (labeled section, Req 18.1/18.3)", () => {
    const suppression: SuppressionVM = {
      pair: "USDJPY",
      reason: "not_fired",
    };
    renderWith("EURUSD", <SuppressionList suppressions={[suppression]} />);

    const section = screen.getByRole("region", { name: /Suppressions/i });
    expect(section).toBeTruthy();
    expect(within(section).getByText(/Did not fire/i)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------------------
// Accordions + chart text/table equivalents (Req 16.5, 18.4)
// ---------------------------------------------------------------------------------------

function firingRow(overrides: Partial<FiringSetupRow> = {}): FiringSetupRow {
  return {
    decision_date: "2026-09-16",
    pair: "EURUSD",
    strategy_id: "strat-1",
    direction: "UP",
    horizon: 2,
    earned_confidence: 0.7,
    stop_loss_pips: 20,
    take_profit_pips: 40,
    surfaced: true,
    suppression_reason: null,
    ...overrides,
  };
}

function analogueRow(overrides: Partial<AnalogueOutcomeRow> = {}): AnalogueOutcomeRow {
  return {
    asset: "EURUSD",
    decision_date: "2026-09-16",
    horizon: 2,
    direction: "UP",
    mfe_pips: 30,
    mae_pips: 12,
    matured: true,
    ...overrides,
  };
}

function realizedRow(overrides: Partial<RealizedOutcomeRow> = {}): RealizedOutcomeRow {
  return {
    strategy_id: "strat-1",
    pair: "EURUSD",
    decision_date: "2026-09-16",
    predicted_direction: "UP",
    horizon: 2,
    earned_confidence: 0.7,
    stop_loss_pips: 20,
    take_profit_pips: 40,
    realized_direction: "UP",
    realized_mfe_pips: 28,
    realized_mae_pips: 10,
    matured: true,
    ...overrides,
  };
}

function candleRow(overrides: Partial<CandleRow> = {}): CandleRow {
  return {
    asset: "EURUSD",
    date: "2026-09-16",
    open: 1.1,
    high: 1.12,
    low: 1.09,
    close: 1.115,
    ...overrides,
  };
}

/** Loaders that resolve a concrete, non-empty data set for every per-pair read. */
function readyLoaders(): PatternOutcomesLoaders {
  return {
    loadConfidenceTrend: () => Promise.resolve(result<FiringSetupRow>([firingRow()])),
    loadExcursions: () => Promise.resolve(result<AnalogueOutcomeRow>([analogueRow()])),
    loadRealized: () => Promise.resolve(result<RealizedOutcomeRow>([realizedRow()])),
    loadCandles: () => Promise.resolve(result<CandleRow>([candleRow()])),
  };
}

describe("PatternOutcomesTab a11y — accordion roles/labels (Req 16.5)", () => {
  it("renders each Accordion_Section as a button trigger with aria-expanded + aria-controls over a labeled region", async () => {
    renderWith(
      "EURUSD",
      <PatternOutcomesTab loaders={readyLoaders()} />,
    );

    // Wait for the four sections to mount (data resolved).
    const confTrigger = await screen.findByRole("button", {
      name: /Earned confidence trend/i,
    });

    // Each trigger is a <button> carrying aria-expanded and aria-controls.
    for (const name of [
      /Earned confidence trend/i,
      /Excursion profile/i,
      /Prediction versus actual/i,
      /Price chart/i,
    ]) {
      const trigger = screen.getByRole("button", { name });
      expect(trigger.tagName).toBe("BUTTON");
      expect(["true", "false"]).toContain(trigger.getAttribute("aria-expanded"));
      const regionId = trigger.getAttribute("aria-controls");
      expect(regionId).toBeTruthy();

      // The controlled region exists, is a region landmark, and is labeled back by the
      // trigger (aria-labelledby → trigger id), closing the accordion ARIA loop (Req 16.5).
      const region = document.getElementById(regionId as string);
      expect(region).not.toBeNull();
      expect((region as HTMLElement).getAttribute("role")).toBe("region");
      expect((region as HTMLElement).getAttribute("aria-labelledby")).toBe(trigger.id);
    }

    // The first section defaults open (aria-expanded="true"); the collapsed ones are false.
    expect(confTrigger.getAttribute("aria-expanded")).toBe("true");
  });
});

describe("PatternOutcomesTab a11y — chart text/table equivalents (Req 18.4)", () => {
  it("renders a <table> text equivalent for the confidence trend, excursion, and price charts", async () => {
    renderWith(
      "EURUSD",
      <PatternOutcomesTab loaders={readyLoaders()} />,
    );

    // Each chart's accompanying A11yDataTable renders a real <table> with a caption that
    // names it as the screen-reader equivalent (Req 18.4). The Accordion discloses a
    // section's body (chart + its table) only while expanded, so each section is opened to
    // assert its text/table equivalent is present. Assert by accessible table name (caption).
    await screen.findByRole("button", { name: /Earned confidence trend/i });

    // Open each chart section (the confidence section defaults open; the others start
    // collapsed) and locate the chart's text/table equivalent by its caption name. The
    // captions below are matched specifically against the A11yDataTable's "(screen-reader
    // table)" caption so they do not also match Recharts' own internal accessibility table.
    const sections: { readonly trigger: RegExp; readonly caption: RegExp }[] = [
      {
        trigger: /Earned confidence trend/i,
        caption: /Earned confidence by decision date for EURUSD \(screen-reader table\)/i,
      },
      {
        trigger: /Excursion profile/i,
        caption:
          /Favorable \(MFE\) and adverse \(MAE\) excursion in pips by decision date \(screen-reader table\)/i,
      },
      {
        trigger: /Price chart/i,
        caption:
          /Open, high, low, and close prices by date \(screen-reader table\)/i,
      },
    ];

    for (const { trigger, caption } of sections) {
      const triggerEl = screen.getByRole("button", { name: trigger });
      if (triggerEl.getAttribute("aria-expanded") !== "true") {
        act(() => {
          fireEvent.click(triggerEl);
        });
      }
      const table = await screen.findByRole("table", { name: caption });
      expect(table.tagName).toBe("TABLE");
      // Each table has header cells (<th scope="col">) — a real tabular equivalent, not a
      // decorative grid.
      expect(within(table).getAllByRole("columnheader").length).toBeGreaterThan(0);
    }

    // The confidence table carries the verbatim charted value (0.7) somewhere in its cells.
    const confidenceTable = screen.getByRole("table", {
      name: /Earned confidence by decision date for EURUSD \(screen-reader table\)/i,
    });
    expect(within(confidenceTable).getByText(/0\.7/)).toBeTruthy();
  });
});
