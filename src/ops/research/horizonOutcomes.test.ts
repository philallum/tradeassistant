import { describe, expect, it } from "vitest";

import type { Candle } from "../../guard/types.js";
import { XTB_STANDARD_MODEL } from "./costModel.js";
import {
  analogueCall,
  bracketOutcome,
  buildOutcomeTable,
  horizonMove,
  netPips,
  OUTCOME_SPAN,
  OUTCOMES,
} from "./horizonOutcomes.js";
import { scoreOutcome, type NeighbourRow } from "./horizonStudy.js";
import { mulberry32 } from "./researchStats.js";

const PIP = 0.0001;

function c(k: number, o: number, h: number, l: number, cl: number): Candle {
  const d = new Date(Date.UTC(2015, 0, 5) + k * 86_400_000).toISOString().slice(0, 10);
  return { asset: "EURUSD", date: d, open: o, high: h, low: l, close: cl };
}

function randomWalk(n: number, seed: number): Candle[] {
  const rand = mulberry32(seed);
  let p = 1.1;
  return Array.from({ length: n }, (_, k) => {
    const o = p;
    const cl = o + (rand() - 0.5) * 0.01;
    p = cl;
    return c(k, o, Math.max(o, cl) + rand() * 0.003, Math.min(o, cl) - rand() * 0.003, cl);
  });
}

describe("horizonMove", () => {
  it("enters at the open of i+1 and exits at the close of i+h", () => {
    const cs = [c(0, 1, 1, 1, 1), c(1, 1.1, 1.2, 1.0, 1.15), c(2, 1.15, 1.3, 1.1, 1.2), c(3, 1.2, 1.25, 1.1, 1.12)];
    const r = horizonMove(cs, 0, 3, PIP);
    expect(r?.upPips).toBeCloseTo((1.12 - 1.1) / PIP, 6);
    expect(r?.side).toBe("UP");
    expect(horizonMove(cs, 1, 3, PIP)).toBeNull();
  });
});

describe("bracketOutcome", () => {
  const base = c(0, 1, 1, 1, 1);
  it("target first", () => {
    const cs = [base, c(1, 1.0, 1.005, 0.999, 1.004), c(2, 1.004, 1.011, 1.0, 1.01), ...[3, 4, 5].map((k) => c(k, 1, 1, 1, 1))];
    const r = bracketOutcome(cs, 0, 0.01, PIP);
    expect(r?.kind).toBe("UP_FIRST");
    expect(r?.side).toBe("UP");
    expect(r?.atrPips).toBeCloseTo(100, 6);
  });

  it("stop first", () => {
    const cs = [base, c(1, 1.0, 1.002, 0.989, 0.99), ...[2, 3, 4, 5].map((k) => c(k, 1, 1, 1, 1))];
    expect(bracketOutcome(cs, 0, 0.01, PIP)?.kind).toBe("DOWN_FIRST");
  });

  it("one candle touching both sides is ambiguous and counted as a loss in net", () => {
    const cs = [base, c(1, 1.0, 1.02, 0.98, 1.0), ...[2, 3, 4, 5].map((k) => c(k, 1, 1, 1, 1))];
    const r = bracketOutcome(cs, 0, 0.01, PIP);
    expect(r?.kind).toBe("AMBIGUOUS");
    expect(r?.side).toBeNull();
    expect(netPips("UP", r as NonNullable<typeof r>, 1)).toBeCloseTo(-101, 6);
    expect(netPips("DOWN", r as NonNullable<typeof r>, 1)).toBeCloseTo(-101, 6);
  });

  it("expires at the close of the 5th session when neither side is touched", () => {
    const cs = [base, ...[1, 2, 3, 4].map((k) => c(k, 1, 1.001, 0.999, 1)), c(5, 1, 1.004, 0.999, 1.003)];
    const r = bracketOutcome(cs, 0, 0.01, PIP);
    expect(r?.kind).toBe("EXPIRED");
    expect(r?.side).toBeNull();
    expect(netPips("UP", r as NonNullable<typeof r>, 1)).toBeCloseTo(30 - 1, 6);
  });

  it("needs five sessions after the decision date and a positive ATR", () => {
    expect(bracketOutcome([base, c(1, 1, 1, 1, 1)], 0, 0.01, PIP)).toBeNull();
    expect(bracketOutcome(randomWalk(10, 1), 0, 0, PIP)).toBeNull();
  });
});

describe("analogueCall", () => {
  it("only analogues whose outcome window closed by candle i vote", () => {
    const cs = randomWalk(60, 2);
    const t = buildOutcomeTable(cs, PIP);
    const i = 40;
    const dates = [37, 38, 39, 35, 30].map((k) => (cs[k] as Candle).date);
    const h5 = analogueCall(t, i, dates, "H5");
    // only j + 5 < 40, i.e. j <= 34, can vote for H5: of the five dates only j = 30
    expect(h5.n).toBeLessThanOrEqual(1);
    const h1 = analogueCall(t, i, dates, "H1");
    expect(h1.n).toBeLessThanOrEqual(5);
  });

  it("an analogue whose window ends ON the decision date's own session does not vote; one session earlier does", () => {
    const cs = randomWalk(80, 21);
    const t = buildOutcomeTable(cs, PIP);
    const i = 60;
    for (const o of OUTCOMES) {
      const span = OUTCOME_SPAN[o];
      const late = (cs[i - span] as Candle).date; // window ends at candle i: unknown at run time
      const ok = (cs[i - span - 1] as Candle).date; // window ends at i-1: known
      const decisive = t.byOutcome[o][i - span - 1]?.side !== null;
      expect(analogueCall(t, i, [late], o).n).toBe(0);
      expect(analogueCall(t, i, [ok], o).n).toBe(decisive ? 1 : 0);
    }
  });

  it("is unchanged by the decision date's own candle or any later candle (no look-ahead)", () => {
    for (let s = 0; s < 20; s += 1) {
      const cs = randomWalk(300, 100 + s);
      const i = 200;
      const dates = Array.from({ length: 40 }, (_, k) => (cs[20 + k * 4] as Candle).date);
      const tamper = cs.map((x, k) => (k >= i ? ({ ...x, high: x.high + 1, low: x.low - 1, close: x.close + 0.5 }) : x));
      const a = buildOutcomeTable(cs, PIP);
      const b = buildOutcomeTable(tamper, PIP);
      for (const o of OUTCOMES) expect(analogueCall(a, i, dates, o)).toEqual(analogueCall(b, i, dates, o));
    }
  });

  it("uses the live shrinkage and returns no call on a tie", () => {
    const cs = randomWalk(80, 3);
    const t = buildOutcomeTable(cs, PIP);
    const ups = cs.map((_, k) => k).filter((k) => k < 60 && t.byOutcome.H1[k]?.side === "UP").slice(0, 3);
    const downs = cs.map((_, k) => k).filter((k) => k < 60 && t.byOutcome.H1[k]?.side === "DOWN").slice(0, 1);
    const call = analogueCall(t, 70, [...ups, ...downs].map((k) => (cs[k] as Candle).date), "H1");
    expect(call.direction).toBe("UP");
    expect(call.n).toBe(4);
    expect(call.confidence).toBeCloseTo((4 / 14) * 0.75 + (10 / 14) * 0.5, 12);
    const tie = analogueCall(t, 70, [ups[0] as number, downs[0] as number].map((k) => (cs[k] as Candle).date), "H1");
    expect(tie.direction).toBe("FLAT");
  });

  it("every outcome span is covered", () => {
    expect(OUTCOMES.map((o) => OUTCOME_SPAN[o])).toEqual([1, 3, 5, 5]);
  });
});

describe("scoreOutcome", () => {
  it("drops rows whose outcome window ends after the window end", () => {
    const cs = randomWalk(120, 4);
    const t = buildOutcomeTable(cs, PIP);
    const tables = new Map([["EURUSD" as const, t]]);
    const rows: NeighbourRow[] = [100, 110, 113, 114, 115].map((k) => ({
      pair: "EURUSD",
      date: (cs[k] as Candle).date,
      weeklyTrendSign: "UP",
      analogueDates: [10, 20, 30].map((j) => (cs[j] as Candle).date),
    }));
    const end = (cs[118] as Candle).date;
    const s = scoreOutcome(rows, tables, "H1", XTB_STANDARD_MODEL, end);
    // i + 5 must be <= 118 -> rows at 100, 110, 113 only
    expect(s.map((r) => r.date)).toEqual([100, 110, 113].map((k) => (cs[k] as Candle).date));
  });

  it("baseline is scored on the same realised outcome and charged the same cost", () => {
    const cs = randomWalk(80, 5);
    const t = buildOutcomeTable(cs, PIP);
    const rows: NeighbourRow[] = [{ pair: "EURUSD", date: (cs[60] as Candle).date, weeklyTrendSign: "DOWN", analogueDates: [] }];
    const [r] = scoreOutcome(rows, new Map([["EURUSD" as const, t]]), "H3", XTB_STANDARD_MODEL, (cs[79] as Candle).date);
    const real = t.byOutcome.H3[60];
    expect(r?.direction).toBe("FLAT");
    expect(r?.net).toBeNull();
    expect(r?.baselineNet).toBeCloseTo(-(real?.upPips ?? 0) - 1.0, 9);
  });
});
