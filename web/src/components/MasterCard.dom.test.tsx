// @vitest-environment jsdom
//
// MasterCard / StrategyCardGrid / PairSummary / SystemRecordFooter DOM tests.
//
// The Master_Card is: PairSummary -> 2 x 3 StrategyCardGrid -> ContextDrawers -> System record.
// It must show six clean cards (each with its own assessment), the conviction tier with its vote
// tally, the expected candle size, and the system record, and it must show NO stop-loss,
// take-profit, net expectancy, "Backtest edge" pill or "Neutral" label anywhere.

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { EMPTY_CONFLUENCE, EMPTY_INTRADAY_VALIDATION, EMPTY_TRACK_RECORD } from "../api/snapshot";
import type { Confluence, ConfluenceCell, FiringSetupRow, PairEvaluationRow, TrackRecord } from "../api/types";
import { shapeConviction } from "../pure/shapeConviction";
import { shapeInvalidation } from "../pure/shapeInvalidation";
import { shapeDailyNote } from "../pure/shapeDailyNote";
import { shapeIntradayValidation } from "../pure/shapeIntradayValidation";
import { shapePairSummary } from "../pure/shapePairSummary";
import type { SilenceVM } from "../pure/shapeSilence";
import { shapeStrategyCards } from "../pure/shapeStrategyCards";
import { shapeSystemRecord } from "../pure/shapeSystemRecord";
import { MasterCard } from "./MasterCard";

afterEach(() => {
  cleanup();
});

const DATE = "2026-09-16";
const ids = ["trend", "breakout", "range", "reversal", "custom_pattern", "third_party"] as const;
const cell = (id: (typeof ids)[number], d: "UP" | "DOWN" | "FLAT", s = 0.7): ConfluenceCell => ({
  strategyId: id,
  available: true,
  direction: d,
  strength: d === "FLAT" ? 0 : s,
  rationale: `${id} rationale`,
});

/** The EURUSD case from the audit: pattern UP (0.57) vs trend DOWN (0.9), the rest flat. */
const SPLIT_CONFLUENCE: Confluence = {
  ...EMPTY_CONFLUENCE,
  pairs: [
    {
      pair: "EURUSD",
      score: -0.07,
      status: "CONFLICT_FLAT",
      opposingStrategyIds: ["trend", "custom_pattern"],
      cells: ids.map((id) =>
        id === "trend" ? cell(id, "DOWN", 0.9) : id === "custom_pattern" ? cell(id, "UP", 0.57) : cell(id, "FLAT"),
      ),
    },
  ],
};

const EVAL: PairEvaluationRow = {
  decision_date: DATE,
  pair: "EURUSD",
  direction: "UP",
  horizon: 1,
  earned_confidence: 0.571,
  fired: true,
  choppiness: 0.4,
  expected_range: { bucket: "LARGE", horizon: 1, low_pips: 70.2, high_pips: 110.4, sample_size: 44 },
};
const FIRING: FiringSetupRow = {
  decision_date: DATE,
  pair: "EURUSD",
  strategy_id: "system",
  direction: "UP",
  horizon: 1,
  earned_confidence: 0.571,
  // The snapshot still carries these (backend research data); the UI must never show them.
  stop_loss_pips: 31.5,
  take_profit_pips: 47.5,
  surfaced: true,
  suppression_reason: null,
};
const TRACK: TrackRecord = {
  lookbackDays: 60,
  strategies: [
    { pair: "EURUSD", strategyId: "trend", calls: 31, correct: 12 },
    { pair: "EURUSD", strategyId: "custom_pattern", calls: 8, correct: 5 },
  ],
  rangeForecast: [{ pair: "EURUSD", forecasts: 18, correct: 11 }],
};
const REPORT = {
  config_id: "c",
  split_test_start: "2020-01-01",
  split_test_end: "2024-01-01",
  sample_size: 30000,
  predictions_count: 28470,
  model_accuracy: 0.4996,
  baseline_accuracy: 0.4871,
  delta_vs_baseline: 0.0125,
};

function renderCard(
  over: {
    confluence?: Confluence;
    firing?: FiringSetupRow[];
    track?: TrackRecord;
    withInvalidation?: boolean;
    silence?: SilenceVM | null;
  } = {},
): void {
  const confluence = over.confluence ?? SPLIT_CONFLUENCE;
  const track = over.track ?? TRACK;
  const row = confluence.pairs.find((p) => p.pair === "EURUSD") ?? null;
  render(
    <MasterCard
      pair="EURUSD"
      conviction={row === null ? null : shapeConviction(row, confluence.weights)}
      summary={shapePairSummary("EURUSD", [EVAL], over.firing ?? [FIRING], DATE, track)}
      cards={shapeStrategyCards(row, "EURUSD", confluence.weights, track)}
      lookbackDays={track.lookbackDays}
      note={shapeDailyNote({ decision_date: DATE, note_text: "Quiet session.", generated: true })}
      evidence={{ pair: "EURUSD", horizon: 1, sampleCount: 40, upShare: 0.5, downShare: 0.5 }}
      intradayValidation={shapeIntradayValidation(EMPTY_INTRADAY_VALIDATION, "EURUSD")}
      systemRecord={shapeSystemRecord(REPORT)}
      silence={over.silence ?? null}
      {...(over.withInvalidation === true
        ? { invalidation: shapeInvalidation("EURUSD", over.firing ?? [FIRING], DATE) }
        : {})}
    />,
  );
}

describe("MasterCard", () => {
  it("renders exactly six strategy cards, each with its own assessment", () => {
    renderCard();
    const grid = screen.getByTestId("strategy-card-grid");
    const cards = within(grid).getAllByRole("listitem");
    expect(cards).toHaveLength(6);
    expect(cards.map((c) => c.getAttribute("data-testid"))).toEqual(
      ids.map((id) => `strategy-card-${id}`),
    );
    // Each card states a direction, a meaning sentence and a track-record line.
    for (const id of ids) {
      expect(screen.getByTestId(`strategy-card-${id}-direction`).textContent).toMatch(/Up|Down|Flat|Unavailable/);
      expect(screen.getByTestId(`strategy-card-${id}-record`).textContent).not.toBe("");
    }
    expect(screen.getByTestId("strategy-card-trend").textContent).toContain(
      "Short-term average is below the long-term average and falling.",
    );
  });

  it("shows the Split tier with the tally that explains it (the EURUSD case)", () => {
    renderCard();
    expect(screen.getByTestId("pair-conviction").textContent).toContain("Split");
    expect(screen.getByTestId("pair-tally").textContent).toBe("1 up \u00B7 1 down \u00B7 3 flat");
    expect(screen.getByTestId("strategy-card-trend").getAttribute("data-conflicting")).toBe("true");
    expect(screen.getByTestId("strategy-card-custom_pattern").getAttribute("data-conflicting")).toBe("true");
    expect(screen.getByTestId("strategy-card-range").getAttribute("data-conflicting")).toBeNull();
  });

  it("marks the third party display-only with no track record", () => {
    renderCard();
    const third = screen.getByTestId("strategy-card-third_party");
    expect(third.getAttribute("data-display-only")).toBe("true");
    expect(third.textContent).toContain("Display-only");
    expect(screen.getByTestId("strategy-card-third_party-record").getAttribute("data-record-kind")).toBe("display-only");
  });

  it("states each strategy's recent record in words", () => {
    renderCard();
    expect(screen.getByTestId("strategy-card-trend-record").textContent).toBe("Right 12 of 31 recent calls.");
    expect(screen.getByTestId("strategy-card-custom_pattern-record").textContent).toContain("small sample");
    expect(screen.getByTestId("strategy-card-breakout-record").getAttribute("data-record-kind")).toBe("not-measured");
  });

  it("shows the expected candle size as a size and a pips range, with its record", () => {
    renderCard();
    const size = screen.getByTestId("candle-size");
    expect(size.textContent).toContain("Large candle");
    expect(size.textContent).toContain("About 70.2\u2013110.4 pips over the session after 2026-09-16.");
    expect(size.textContent).toContain("Forecast right 11 of 18 recent days.");
    expect(size.textContent).toMatch(/not direction/i);
  });

  it("shows the pattern engine's own call", () => {
    renderCard();
    expect(screen.getByTestId("pair-pattern").textContent).toBe(
      "Pattern engine fired: Up for the session after 2026-09-16. Historically, 57 of 100 similar setups moved this way (shrunk toward 50).",
    );
  });

  it("shows the labelled, unvalidated invalidation distance and still no take-profit", () => {
    renderCard({ withInvalidation: true });
    const line = screen.getByTestId("invalidation-line");
    expect(line.textContent).toContain(
      "If price falls 31.5 pips below the open of the session after 2026-09-16 before that session closes, this pattern thesis is invalidated.",
    );
    expect(screen.getByTestId("invalidation-tag").textContent).toBe("unvalidated");
    expect(line.textContent).toContain("Not a stop recommendation.");
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/stop.?loss|take.?profit|expectancy/i);
    expect(text).not.toContain("47.5");
  });

  it("shows no invalidation line when the card has no distance (too few analogues)", () => {
    renderCard({ withInvalidation: true, firing: [{ ...FIRING, stop_loss_pips: null }] });
    expect(screen.queryByTestId("invalidation-line")).toBeNull();
  });

  it("shows NO stop-loss, take-profit, net expectancy, backtest-edge pill or 'Neutral' label", () => {
    renderCard();
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/stop.?loss|take.?profit|expectancy/i);
    expect(text).not.toMatch(/backtest edge/i);
    expect(text).not.toMatch(/\bneutral\b/i);
    expect(text).not.toMatch(/un-validated/i);
    // The firing row's stored pip levels never leak into the DOM.
    expect(text).not.toContain("31.5");
    expect(text).not.toContain("47.5");
    expect(screen.queryByTestId("backtest-edge-pill")).toBeNull();
    expect(screen.queryByTestId("verdict-direction")).toBeNull();
  });

  it("has no repeated large panel: one summary, one grid, one footer, and no rationale drawer", () => {
    renderCard();
    expect(screen.getAllByTestId("pair-summary")).toHaveLength(1);
    expect(screen.getAllByTestId("strategy-card-grid")).toHaveLength(1);
    expect(screen.getAllByTestId("system-record")).toHaveLength(1);
    expect(screen.queryByTestId("rationale-drawer")).toBeNull();
    expect(screen.queryByTestId("pair-confluence-matrix")).toBeNull();
    expect(screen.queryAllByRole("heading", { level: 1 })).toHaveLength(0); // ControlBar owns the h1
  });

  it("puts the system record in the footer, and flags a lead within noise", () => {
    renderCard();
    const footer = screen.getByTestId("system-record");
    expect(footer.textContent).toContain("System record: 50.0% right vs 48.7% naive over 28,470 forecasts.");
    expect(footer.textContent).toMatch(/roughly level/);
  });

  it("collapses the technical rationale and the context drawers by default", () => {
    renderCard();
    const detail = screen.getByTestId("strategy-card-trend").querySelector("details");
    expect(detail).not.toBeNull();
    expect(detail!.hasAttribute("open")).toBe(false);
    expect(screen.getByRole("button", { name: /Daily AI note/ }).getAttribute("aria-expanded")).toBe("false");
  });

  it("degrades gracefully for a pair with no confluence row: six unavailable cards, no signal", () => {
    renderCard({ confluence: EMPTY_CONFLUENCE, firing: [], track: EMPTY_TRACK_RECORD });
    expect(screen.getAllByRole("listitem")).toHaveLength(6);
    expect(screen.getByTestId("pair-conviction").textContent).toContain("No signal");
    expect(screen.getByTestId("pair-pattern").textContent).toBe("Pattern engine did not fire for this pair.");
    expect(screen.getByTestId("strategy-card-grid").textContent).toMatch(/not available yet/i);
  });

  it("gives every card an accessible name that includes the meaning and the record", () => {
    renderCard();
    const label = screen.getByTestId("strategy-card-trend").getAttribute("aria-label") ?? "";
    expect(label).toContain("EURUSD Trend");
    expect(label).toContain("Down");
    expect(label).toContain("Right 12 of 31 recent calls.");
  });
});


describe("MasterCard silence reason (schema v9)", () => {
  it("shows why a silent pair is silent, framed as a result and not a fault", () => {
    renderCard({
      firing: [],
      silence: { reason: "THIN_NEIGHBOURHOOD", text: "Few similar past setups were found (12; 30 or more is more reliable)." },
    });
    const line = screen.getByTestId("pair-silence");
    expect(line.getAttribute("data-reason")).toBe("THIN_NEIGHBOURHOOD");
    expect(line.textContent).toContain("Staying silent is a result, not a fault.");
    expect(line.textContent).toContain("(12;");
  });

  it("shows no silence line when the pair fired", () => {
    renderCard();
    expect(screen.queryByTestId("pair-silence")).toBeNull();
  });
});

describe("MasterCard neighbourhood size", () => {
  it("shows how many similar past days a fired call rests on", () => {
    const row = SPLIT_CONFLUENCE.pairs.find((p) => p.pair === "EURUSD") ?? null;
    render(
      <MasterCard
        pair="EURUSD"
        conviction={row === null ? null : shapeConviction(row, SPLIT_CONFLUENCE.weights)}
        summary={shapePairSummary("EURUSD", [EVAL], [FIRING], DATE, TRACK, 7)}
        cards={shapeStrategyCards(row, "EURUSD", SPLIT_CONFLUENCE.weights, TRACK)}
        lookbackDays={TRACK.lookbackDays}
        note={shapeDailyNote({ decision_date: DATE, note_text: "x", generated: true })}
        evidence={null}
        intradayValidation={shapeIntradayValidation(EMPTY_INTRADAY_VALIDATION, "EURUSD")}
        systemRecord={shapeSystemRecord(REPORT)}
      />,
    );
    expect(screen.getByTestId("pair-basis").textContent).toBe("Based on 7 similar past days (a small sample; 30 or more is more reliable).");
  });
});
