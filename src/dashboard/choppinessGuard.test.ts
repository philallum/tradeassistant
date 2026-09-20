// Smoke tests for the Choppiness Volatility Silence Guard — Component 18
// (Requirement 24). The exhaustive boundary/determinism property test is
// task 11.6 (Property 41); this file covers the core deterministic behaviour.

import { describe, expect, it } from "vitest";

import {
  applyChoppinessGuard,
  assessChoppiness,
  efficiencyRatio,
  efficiencyRatioFromCloses,
} from "./choppinessGuard.js";
import { dailyRun, type PairEvaluation } from "./dashboard.js";
import {
  DEFAULT_DASHBOARD_CONFIG,
  type ChoppinessConfig,
  type FiringSetup,
} from "./types.js";
import type { Candle, TradingDate } from "../guard/types.js";
import type { Confidence, Horizon } from "../confidence/types.js";
import type { DirectionClass } from "../retrieval/types.js";
import type { Pair } from "../ingestion/types.js";

const DECISION_DATE: TradingDate = "2024-03-15";

const DIRECTION_UP: DirectionClass = "UP";
const HORIZON_2: Horizon = 2;
const CONFIDENCE_09 = 0.9 as Confidence;

/** Build a chronological candle series from close prices, dates before the date. */
function candlesFromCloses(pair: Pair, closes: readonly number[]): Candle[] {
  return closes.map((close, i) => {
    const day = String(i + 1).padStart(2, "0");
    const date: TradingDate = `2024-03-${day}`;
    return {
      asset: pair,
      date,
      open: close,
      high: close,
      low: close,
      close,
    };
  });
}

function firingSetup(pair: Pair, o: Partial<FiringSetup> = {}): FiringSetup {
  return {
    pair,
    direction: o.direction ?? DIRECTION_UP,
    horizon: o.horizon ?? HORIZON_2,
    earnedConfidence: o.earnedConfidence ?? CONFIDENCE_09,
    excursionProfile: o.excursionProfile ?? { favorablePips: 40, adversePips: 15 },
    stopLossPips: o.stopLossPips ?? 15,
    takeProfitPips: o.takeProfitPips ?? 40,
  };
}

function evaluation(pair: Pair, o: Partial<PairEvaluation> = {}): PairEvaluation {
  return {
    pair,
    gatePassing: o.gatePassing ?? true,
    earnedConfidence: o.earnedConfidence ?? CONFIDENCE_09,
    direction: o.direction ?? DIRECTION_UP,
    horizon: o.horizon ?? HORIZON_2,
    excursionProfile: o.excursionProfile ?? { favorablePips: 40, adversePips: 15 },
    stopLossPips: o.stopLossPips ?? 15,
    takeProfitPips: o.takeProfitPips ?? 40,
    newsSuppressed: o.newsSuppressed ?? false,
    rationale: "analogues resolved up",
    analogueLabels: ["trend-continuation"],
  };
}

describe("efficiencyRatioFromCloses", () => {
  it("returns 1 for a perfectly straight-line move", () => {
    expect(efficiencyRatioFromCloses([1, 2, 3, 4, 5], 4)).toBeCloseTo(1, 10);
  });

  it("returns 0 for a path that returns to its origin (pure chop)", () => {
    // net move 0, path length > 0 ⇒ ER = 0.
    expect(efficiencyRatioFromCloses([1, 2, 1, 2, 1], 4)).toBe(0);
  });

  it("returns a value strictly between 0 and 1 for a noisy uptrend", () => {
    const er = efficiencyRatioFromCloses([1, 3, 2, 4, 3, 5], 5);
    expect(er).toBeGreaterThan(0);
    expect(er).toBeLessThan(1);
  });

  it("returns 0 for degenerate inputs (empty, single close, non-positive window)", () => {
    expect(efficiencyRatioFromCloses([], 14)).toBe(0);
    expect(efficiencyRatioFromCloses([42], 14)).toBe(0);
    expect(efficiencyRatioFromCloses([1, 2, 3], 0)).toBe(0);
  });

  it("is deterministic for identical inputs (Requirement 24.7)", () => {
    const closes = [1, 3, 2, 5, 4, 6];
    expect(efficiencyRatioFromCloses(closes, 5)).toBe(
      efficiencyRatioFromCloses(closes, 5),
    );
  });
});

describe("efficiencyRatio (look-ahead-safe)", () => {
  it("ignores candles dated on or after the Decision_Date (Requirement 24.1)", () => {
    const closes = [1, 2, 3, 4, 5];
    const candles = candlesFromCloses("EURUSD", closes);
    // Add a future candle that, if included, would change the ratio.
    const withFuture: Candle[] = [
      ...candles,
      { asset: "EURUSD", date: "2024-03-20", open: 1, high: 1, low: 1, close: 1 },
    ];
    const clean = efficiencyRatio(candles, DECISION_DATE, 4);
    const guarded = efficiencyRatio(withFuture, DECISION_DATE, 4);
    expect(guarded).toBe(clean);
  });
});

describe("assessChoppiness", () => {
  const config: ChoppinessConfig = { window: 4, minEfficiency: 0.3 };

  it("suppresses when efficiency is below the threshold (too choppy)", () => {
    const candles = candlesFromCloses("EURUSD", [1, 2, 1, 2, 1]);
    const a = assessChoppiness(candles, DECISION_DATE, config);
    expect(a.suppressed).toBe(true);
    expect(a.reason).toBe("too_choppy");
    expect(a.efficiency).toBeLessThan(config.minEfficiency);
  });

  it("keeps a clean trend above the threshold", () => {
    const candles = candlesFromCloses("EURUSD", [1, 2, 3, 4, 5]);
    const a = assessChoppiness(candles, DECISION_DATE, config);
    expect(a.suppressed).toBe(false);
    expect(a.reason).toBeUndefined();
    expect(a.efficiency).toBeGreaterThanOrEqual(config.minEfficiency);
  });
});

describe("applyChoppinessGuard", () => {
  const config: ChoppinessConfig = { window: 4, minEfficiency: 0.3 };

  it("hard-vetoes a firing pair that is too choppy and keeps a clean one", () => {
    const firing = [firingSetup("EURUSD"), firingSetup("GBPUSD")];
    const candlesByPair = new Map<Pair, readonly Candle[]>([
      ["EURUSD", candlesFromCloses("EURUSD", [1, 2, 1, 2, 1])], // chop
      ["GBPUSD", candlesFromCloses("GBPUSD", [1, 2, 3, 4, 5])], // trend
    ]);

    const { kept, suppressed } = applyChoppinessGuard(
      firing,
      candlesByPair,
      DECISION_DATE,
      config,
    );

    expect(kept.map((s) => s.pair)).toEqual(["GBPUSD"]);
    expect(suppressed).toHaveLength(1);
    expect(suppressed[0]?.pair).toBe("EURUSD");
    expect(suppressed[0]?.reason).toBe("too_choppy");
  });

  it("keeps a pair with no candle history (nothing to assess)", () => {
    const firing = [firingSetup("USDJPY")];
    const { kept, suppressed } = applyChoppinessGuard(
      firing,
      new Map(),
      DECISION_DATE,
      config,
    );
    expect(kept.map((s) => s.pair)).toEqual(["USDJPY"]);
    expect(suppressed).toHaveLength(0);
  });
});

describe("dailyRun composition with the Choppiness Guard", () => {
  it("silences an otherwise-firing pair that is too choppy, recording too_choppy", () => {
    const config = {
      ...DEFAULT_DASHBOARD_CONFIG,
      choppiness: { window: 4, minEfficiency: 0.3 },
    };
    const evaluations = [evaluation("EURUSD")];
    const candlesByPair = new Map<Pair, readonly Candle[]>([
      ["EURUSD", candlesFromCloses("EURUSD", [1, 2, 1, 2, 1])], // chop
    ]);

    const view = dailyRun(DECISION_DATE, evaluations, config, candlesByPair);

    // The pair does not render; a too_choppy suppression is recorded.
    expect(view.cards).toHaveLength(0);
    const choppy = view.suppressed.filter((s) => s.reason === "too_choppy");
    expect(choppy.map((s) => s.pair)).toEqual(["EURUSD"]);
  });

  it("renders a clean-trend pair and composes with other suppressors", () => {
    const config = {
      ...DEFAULT_DASHBOARD_CONFIG,
      choppiness: { window: 4, minEfficiency: 0.3 },
    };
    const evaluations = [evaluation("EURUSD")];
    const candlesByPair = new Map<Pair, readonly Candle[]>([
      ["EURUSD", candlesFromCloses("EURUSD", [1, 2, 3, 4, 5])], // trend
    ]);

    const view = dailyRun(DECISION_DATE, evaluations, config, candlesByPair);

    expect(view.cards.map((c) => c.pair)).toEqual(["EURUSD"]);
    expect(view.suppressed).toHaveLength(0);
  });

  it("leaves firing untouched when no candles are supplied (no basis to silence)", () => {
    const evaluations = [evaluation("EURUSD")];
    const view = dailyRun(DECISION_DATE, evaluations);
    expect(view.cards.map((c) => c.pair)).toEqual(["EURUSD"]);
  });
});
