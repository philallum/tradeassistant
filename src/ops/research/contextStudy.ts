// Pre-registration 5: volatility and structure context (pure; no I/O).
//
// Predictors use only candles strictly before the decision-date candle i (candle i has not traded
// when the job runs). Outcomes use the sessions i+1..i+5, the convention of the earlier reports.
import type { Interval } from "../../performance/evidenceStats.js";
import type { Candle } from "../../guard/types.js";
import type { Pair } from "../../ingestion/types.js";
import { eventsOn } from "../../event-calendar/eventCalendar.js";
import { atrByIndex } from "./horizonOutcomes.js";
import type { ResearchRow } from "./researchDataset.js";
import {
  BOOTSTRAP_ITERATIONS,
  BOOTSTRAP_SEED,
  FDR_Q,
  MIN_REPORTABLE_SCORED,
  MIN_STABILITY_SCORED,
  RESEARCH_EXPLORATION_WINDOW,
} from "./researchProtocol.js";
import { benjaminiHochberg, blockBootstrap, blockBootstrapSpearman, spearman } from "./researchStats.js";

export const EVENT_START = "2021-01-01" as const;
export const STOP_QUANTILE = 0.75;
export const MIN_STOP_HISTORY = 250;

/** Realised outcomes after candle i (null fields when the data runs out or is degenerate). */
export interface ContextOutcome {
  /** ln(mean(high-low) over i+1..i+5 / ATR14). */
  readonly logRangeRatio: number | null;
  /** 5-session efficiency ratio from the open of i+1 to the close of i+5. */
  readonly er5: number | null;
  /** (high-low of candle i+1) / ATR14. */
  readonly nextRangeRatio: number | null;
}

export function contextOutcome(candles: readonly Candle[], i: number, atr: number): ContextOutcome {
  const w = [1, 2, 3, 4, 5].map((k) => candles[i + k]);
  if (w.some((c) => c === undefined) || !(atr > 0)) return { logRangeRatio: null, er5: null, nextRangeRatio: null };
  const cs = w as Candle[];
  const meanRange = cs.reduce((a, c) => a + (c.high - c.low), 0) / 5;
  const first = cs[0] as Candle;
  let path = Math.abs(first.close - first.open);
  for (let k = 1; k < 5; k += 1) path += Math.abs((cs[k] as Candle).close - (cs[k - 1] as Candle).close);
  const net = Math.abs((cs[4] as Candle).close - first.open);
  return {
    logRangeRatio: meanRange > 0 ? Math.log(meanRange / atr) : null,
    er5: path > 0 ? net / path : null,
    nextRangeRatio: (first.high - first.low) / atr,
  };
}

/** Adverse excursion of one session against a direction, in price units. */
export function adverse(c: Candle, side: "UP" | "DOWN"): number {
  return side === "UP" ? c.open - c.low : c.high - c.open;
}

/** Quantile of a sorted array (linear interpolation). */
export function quantileSorted(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return Number.NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = sorted[lo] as number;
  const b = sorted[hi] as number;
  return a + (b - a) * (pos - lo);
}

/** Pinball (quantile) loss at level q. */
export function pinball(y: number, pred: number, q: number): number {
  return y >= pred ? q * (y - pred) : (1 - q) * (pred - y);
}

function insertSorted(arr: number[], v: number): void {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((arr[mid] as number) < v) lo = mid + 1;
    else hi = mid;
  }
  arr.splice(lo, 0, v);
}

/**
 * For each candle index i: the P75 (STOP_QUANTILE) of the pair's historical ratio
 * adverse(k) / ATR14(before k-1), both sides pooled, over sessions k <= i-1, and the unconditional
 * P75 adverse in price units. Null with fewer than MIN_STOP_HISTORY sessions.
 * The two-session lag (ATR known at k-2) mirrors forecasting session i+1 with ATR before i.
 */
export function historicalStopQuantiles(candles: readonly Candle[]): { ratioQ: (number | null)[]; priceQ: (number | null)[] } {
  const atr = atrByIndex(candles);
  const ratios: number[] = [];
  const prices: number[] = [];
  const ratioQ: (number | null)[] = new Array<number | null>(candles.length).fill(null);
  const priceQ: (number | null)[] = new Array<number | null>(candles.length).fill(null);
  for (let i = 0; i < candles.length; i += 1) {
    // Add session k = i-1 (known at run time for decision i) before computing i's quantile.
    const k = i - 1;
    if (k >= 1) {
      const c = candles[k] as Candle;
      const a = atr[k - 1] ?? 0;
      for (const side of ["UP", "DOWN"] as const) {
        const ad = adverse(c, side);
        insertSorted(prices, ad);
        if (a > 0) insertSorted(ratios, ad / a);
      }
    }
    if (prices.length >= 2 * MIN_STOP_HISTORY) priceQ[i] = quantileSorted(prices, STOP_QUANTILE);
    if (ratios.length >= 2 * MIN_STOP_HISTORY) ratioQ[i] = quantileSorted(ratios, STOP_QUANTILE);
  }
  return { ratioQ, priceQ };
}

export interface PairContextTable {
  readonly candles: readonly Candle[];
  readonly indexByDate: ReadonlyMap<string, number>;
  readonly atr: readonly number[];
  readonly ratioQ: readonly (number | null)[];
  readonly priceQ: readonly (number | null)[];
}

export function buildContextTable(candles: readonly Candle[]): PairContextTable {
  const indexByDate = new Map<string, number>();
  candles.forEach((c, k) => indexByDate.set(c.date, k));
  const { ratioQ, priceQ } = historicalStopQuantiles(candles);
  return { candles, indexByDate, atr: atrByIndex(candles), ratioQ, priceQ };
}

/** One pair-day with predictors and outcomes. */
export interface ContextRow {
  readonly pair: Pair;
  readonly date: string;
  readonly compression: number | null;
  readonly atrPercentile: number | null;
  readonly er14: number | null;
  readonly confluenceStatus: string | null;
  readonly eventKinds: readonly string[] | null;
  readonly logRangeRatio: number | null;
  readonly er5: number | null;
  readonly nextRangeRatio: number | null;
  /** Q1 inputs (directional days with an analogue stop only), all in ATR units. */
  readonly stop: { readonly y: number; readonly analogue: number; readonly atrScaled: number | null; readonly priceUncond: number | null } | null;
}

export function buildContextRows(
  rows: readonly ResearchRow[],
  tables: ReadonlyMap<Pair, PairContextTable>,
  pipOf: (p: Pair) => number,
  windowEnd: string = RESEARCH_EXPLORATION_WINDOW.end,
): ContextRow[] {
  const out: ContextRow[] = [];
  for (const r of rows) {
    const t = tables.get(r.pair);
    const i = t?.indexByDate.get(r.date);
    if (t === undefined || i === undefined) continue;
    const last = t.candles[i + 5];
    if (last === undefined || last.date > windowEnd) continue;
    const atr = t.atr[i] ?? 0;
    const o = contextOutcome(t.candles, i, atr);
    const target = t.candles[i + 1] as Candle;
    let stop: ContextRow["stop"] = null;
    if ((r.direction === "UP" || r.direction === "DOWN") && r.stopLossPips !== null && atr > 0) {
      const pip = pipOf(r.pair);
      const rq = t.ratioQ[i];
      const pq = t.priceQ[i];
      stop = {
        y: adverse(target, r.direction) / atr,
        analogue: (r.stopLossPips * pip) / atr,
        atrScaled: rq === null || rq === undefined ? null : rq,
        priceUncond: pq === null || pq === undefined ? null : pq / atr,
      };
    }
    out.push({
      pair: r.pair,
      date: r.date,
      compression: r.features?.compression ?? null,
      atrPercentile: r.atrPercentile,
      er14: r.efficiencyRatio,
      confluenceStatus: r.confluenceStatus,
      eventKinds: target.date < EVENT_START ? null : eventsOn(target.date).map((e) => e.kind).filter((k) => k === "FOMC" || k === "US_NFP"),
      logRangeRatio: o.logRangeRatio,
      er5: o.er5,
      nextRangeRatio: o.nextRangeRatio,
      stop,
    });
  }
  return out;
}

// ------------------------------- statistics -------------------------------------------------

const monthBlock = (r: { date: string }): string => r.date.slice(0, 7);

export type TestId = "V1" | "V2" | "S1" | "S2" | "E1" | "Q1";

export interface TercileRow {
  readonly label: string;
  readonly n: number;
  readonly mean: number;
}

export interface ContextTest {
  readonly id: TestId;
  readonly description: string;
  readonly expected: "+" | "-";
  readonly n: number;
  readonly estimate: number;
  readonly ci95: Interval;
  readonly p: number;
  qValue: number;
  significant: boolean;
  /** The practical-size measure and whether it meets the pre-registered threshold. */
  readonly practical: { readonly label: string; readonly value: number; readonly met: boolean };
  readonly yearsSame: number;
  readonly yearsTotal: number;
  readonly pairsSame: number;
  readonly pairsTotal: number;
  readonly terciles: readonly TercileRow[];
  usable: boolean;
}

function terciles<T>(items: readonly T[], x: (t: T) => number, y: (t: T) => number, transform: (m: number) => number = (m) => m): TercileRow[] {
  const sorted = [...items].sort((a, b) => x(a) - x(b));
  const n = sorted.length;
  if (n < 3) return [];
  const cut = [0, Math.floor(n / 3), Math.floor((2 * n) / 3), n];
  const names = ["low", "mid", "high"];
  return names.map((name, k) => {
    const part = sorted.slice(cut[k], cut[k + 1]);
    const lo = x(part[0] as T);
    const hi = x(part[part.length - 1] as T);
    return {
      label: `${name} (${lo.toFixed(3)} to ${hi.toFixed(3)})`,
      n: part.length,
      mean: transform(part.reduce((a, t) => a + y(t), 0) / part.length),
    };
  });
}

/** Sign consistency of a statistic across groups with at least MIN_STABILITY_SCORED rows. */
function consistency<T extends { pair: string; date: string }>(
  items: readonly T[],
  stat: (s: readonly T[]) => number,
  expected: "+" | "-",
  keyOf: (t: T) => string,
): { same: number; total: number } {
  const g = new Map<string, T[]>();
  for (const t of items) {
    const k = keyOf(t);
    const x = g.get(k);
    if (x === undefined) g.set(k, [t]);
    else x.push(t);
  }
  let same = 0;
  let total = 0;
  for (const x of g.values()) {
    if (x.length < MIN_STABILITY_SCORED) continue;
    const v = stat(x);
    if (!Number.isFinite(v)) continue;
    total += 1;
    if (expected === "+" ? v > 0 : v < 0) same += 1;
  }
  return { same, total };
}

type WithXY = { pair: string; date: string; x: number; y: number };

function spearmanTest(
  id: TestId,
  description: string,
  expected: "+" | "-",
  items: readonly WithXY[],
  seed: number,
  practical: (t: readonly TercileRow[]) => { label: string; value: number; met: boolean },
  transform?: (m: number) => number,
): ContextTest {
  const res = blockBootstrapSpearman(
    items.map((t) => t.x),
    items.map((t) => t.y),
    items.map(monthBlock),
    BOOTSTRAP_ITERATIONS,
    seed,
  );
  const stat = (s: readonly WithXY[]): number => (s.length < 3 ? Number.NaN : spearman(s.map((t) => t.x), s.map((t) => t.y)));
  const years = consistency(items, stat, expected, (t) => t.date.slice(0, 4));
  const pairs = consistency(items, stat, expected, (t) => t.pair);
  const terc = terciles(items, (t) => t.x, (t) => t.y, transform);
  return {
    id,
    description,
    expected,
    n: res.n,
    estimate: res.estimate,
    ci95: res.ci95,
    p: res.p,
    qValue: 1,
    significant: false,
    practical: practical(terc),
    yearsSame: years.same,
    yearsTotal: years.total,
    pairsSame: pairs.same,
    pairsTotal: pairs.total,
    terciles: terc,
    usable: false,
  };
}

export interface ContextStudy {
  readonly tests: readonly ContextTest[];
  readonly eventSplit: readonly { readonly kind: string; readonly n: number; readonly meanRatio: number }[];
  readonly statusTable: readonly { readonly status: string; readonly n: number; readonly meanEr5: number }[];
  readonly stopTable: readonly { readonly predictor: string; readonly n: number; readonly coverage: number; readonly meanLoss: number; readonly meanStopAtr: number }[];
}

export function studyContext(rows: readonly ContextRow[]): ContextStudy {
  let seed = BOOTSTRAP_SEED + 60000;
  const tests: ContextTest[] = [];
  const ratioPractical = (t: readonly TercileRow[]): { label: string; value: number; met: boolean } => {
    const lo = t[0]?.mean ?? Number.NaN;
    const hi = t[2]?.mean ?? Number.NaN;
    const v = lo / hi;
    return { label: "range multiple, low tercile / high tercile", value: v, met: Math.abs(v - 1) >= 0.1 };
  };

  // V1, V2: ln(next-week range / ATR) against compression and ATR percentile.
  const v1 = rows.flatMap((r) => (r.compression === null || r.logRangeRatio === null ? [] : [{ pair: r.pair, date: r.date, x: r.compression, y: r.logRangeRatio }]));
  tests.push(spearmanTest("V1", "compression vs next 5 sessions' range / ATR14", "-", v1, (seed += 7), ratioPractical, Math.exp));
  const v2 = rows.flatMap((r) => (r.atrPercentile === null || r.logRangeRatio === null ? [] : [{ pair: r.pair, date: r.date, x: r.atrPercentile, y: r.logRangeRatio }]));
  tests.push(spearmanTest("V2", "ATR percentile vs next 5 sessions' range / ATR14", "-", v2, (seed += 7), ratioPractical, Math.exp));

  // S1: CONFLICT_FLAT vs other statuses, mean ER5 difference.
  const s1 = rows.filter((r) => r.er5 !== null && r.confluenceStatus !== null && r.confluenceStatus !== "INSUFFICIENT_DATA");
  const s1Stat = (s: readonly ContextRow[]): number => {
    let cn = 0;
    let cs = 0;
    let on = 0;
    let os = 0;
    for (const r of s) {
      if (r.confluenceStatus === "CONFLICT_FLAT") {
        cn += 1;
        cs += r.er5 as number;
      } else {
        on += 1;
        os += r.er5 as number;
      }
    }
    return cn === 0 || on === 0 ? Number.NaN : cs / cn - os / on;
  };
  {
    const b = blockBootstrap(s1, monthBlock, s1Stat, BOOTSTRAP_ITERATIONS, (seed += 7));
    const y = consistency(s1, s1Stat, "-", (r) => r.date.slice(0, 4));
    const pr = consistency(s1, s1Stat, "-", (r) => r.pair);
    tests.push({
      id: "S1",
      description: "CONFLICT_FLAT minus other days, mean 5-session efficiency ratio",
      expected: "-",
      n: s1.length,
      estimate: b.estimate,
      ci95: b.ci95,
      p: b.p,
      qValue: 1,
      significant: false,
      practical: { label: "absolute ER5 difference", value: b.estimate, met: Math.abs(b.estimate) >= 0.02 },
      yearsSame: y.same,
      yearsTotal: y.total,
      pairsSame: pr.same,
      pairsTotal: pr.total,
      terciles: [],
      usable: false,
    });
  }

  // S2: ER14 vs ER5.
  const s2 = rows.flatMap((r) => (r.er14 === null || r.er5 === null ? [] : [{ pair: r.pair, date: r.date, x: r.er14, y: r.er5 }]));
  tests.push(
    spearmanTest("S2", "14-day efficiency ratio vs next 5 sessions' efficiency ratio", "+", s2, (seed += 7), (t) => {
      const v = (t[2]?.mean ?? Number.NaN) - (t[0]?.mean ?? Number.NaN);
      return { label: "ER5, high tercile minus low tercile", value: v, met: Math.abs(v) >= 0.02 };
    }),
  );

  // E1: event sessions vs ordinary sessions, log ratio of mean next-session range / ATR.
  const e1 = rows.filter((r) => r.eventKinds !== null && r.nextRangeRatio !== null);
  const e1Stat = (s: readonly ContextRow[]): number => {
    let en = 0;
    let es = 0;
    let on = 0;
    let os = 0;
    for (const r of s) {
      if ((r.eventKinds as readonly string[]).length > 0) {
        en += 1;
        es += r.nextRangeRatio as number;
      } else {
        on += 1;
        os += r.nextRangeRatio as number;
      }
    }
    return en === 0 || on === 0 ? Number.NaN : Math.log(es / en / (os / on));
  };
  {
    const b = blockBootstrap(e1, monthBlock, e1Stat, BOOTSTRAP_ITERATIONS, (seed += 7));
    const y = consistency(e1, e1Stat, "+", (r) => r.date.slice(0, 4));
    const pr = consistency(e1, e1Stat, "+", (r) => r.pair);
    const eventN = e1.filter((r) => (r.eventKinds as readonly string[]).length > 0).length;
    tests.push({
      id: "E1",
      description: "FOMC / US jobs report sessions vs ordinary sessions, range / ATR14 (from 2021)",
      expected: "+",
      n: eventN,
      estimate: b.estimate,
      ci95: b.ci95,
      p: b.p,
      qValue: 1,
      significant: false,
      practical: { label: "range multiple, event / ordinary", value: Math.exp(b.estimate), met: Math.exp(b.estimate) >= 1.15 },
      yearsSame: y.same,
      yearsTotal: y.total,
      pairsSame: pr.same,
      pairsTotal: pr.total,
      terciles: [],
      usable: false,
    });
  }

  // Q1: pinball loss of the analogue stop minus the ATR-scaled stop (positive = ATR-scaled better).
  const q1 = rows.filter((r) => r.stop !== null && r.stop.atrScaled !== null);
  const lossDiff = (r: ContextRow): number => {
    const s = r.stop as NonNullable<ContextRow["stop"]>;
    return pinball(s.y, s.analogue, STOP_QUANTILE) - pinball(s.y, s.atrScaled as number, STOP_QUANTILE);
  };
  const q1Stat = (s: readonly ContextRow[]): number => (s.length === 0 ? Number.NaN : s.reduce((a, r) => a + lossDiff(r), 0) / s.length);
  {
    const b = blockBootstrap(q1, monthBlock, q1Stat, BOOTSTRAP_ITERATIONS, (seed += 7));
    const y = consistency(q1, q1Stat, "+", (r) => r.date.slice(0, 4));
    const pr = consistency(q1, q1Stat, "+", (r) => r.pair);
    const meanAnalogueLoss = q1.length === 0 ? 0 : q1.reduce((a, r) => a + pinball((r.stop as NonNullable<ContextRow["stop"]>).y, (r.stop as NonNullable<ContextRow["stop"]>).analogue, STOP_QUANTILE), 0) / q1.length;
    tests.push({
      id: "Q1",
      description: "stop quality: analogue P75 MAE loss minus ATR-scaled P75 loss (pinball 0.75, ATR units)",
      expected: "+",
      n: q1.length,
      estimate: b.estimate,
      ci95: b.ci95,
      p: b.p,
      qValue: 1,
      significant: false,
      practical: { label: "relative loss reduction vs analogue stop", value: meanAnalogueLoss === 0 ? 0 : b.estimate / meanAnalogueLoss, met: true },
      yearsSame: y.same,
      yearsTotal: y.total,
      pairsSame: pr.same,
      pairsTotal: pr.total,
      terciles: [],
      usable: false,
    });
  }

  const fdr = benjaminiHochberg(tests.map((t) => t.p), FDR_Q);
  tests.forEach((t, k) => {
    t.qValue = fdr.adjusted[k] as number;
    const signOk = t.expected === "+" ? t.estimate > 0 : t.estimate < 0;
    t.significant = fdr.rejected[k] === true && t.n >= MIN_REPORTABLE_SCORED;
    t.usable =
      t.significant &&
      signOk &&
      t.practical.met &&
      t.yearsTotal > 0 &&
      t.yearsSame / t.yearsTotal >= 0.6 &&
      t.pairsTotal > 0 &&
      t.pairsSame / t.pairsTotal >= 0.6;
  });

  // Descriptive tables.
  const eventSplit = (["FOMC", "US_NFP", "none"] as const).map((kind) => {
    const g = e1.filter((r) => (kind === "none" ? (r.eventKinds as readonly string[]).length === 0 : (r.eventKinds as readonly string[]).includes(kind)));
    return { kind, n: g.length, meanRatio: g.length === 0 ? 0 : g.reduce((a, r) => a + (r.nextRangeRatio as number), 0) / g.length };
  });
  const statuses = [...new Set(s1.map((r) => r.confluenceStatus as string))].sort();
  const statusTable = statuses.map((status) => {
    const g = s1.filter((r) => r.confluenceStatus === status);
    return { status, n: g.length, meanEr5: g.reduce((a, r) => a + (r.er5 as number), 0) / g.length };
  });
  const stopRows = rows.filter((r) => r.stop !== null);
  const pick = (name: string, get: (s: NonNullable<ContextRow["stop"]>) => number | null): { predictor: string; n: number; coverage: number; meanLoss: number; meanStopAtr: number } => {
    const xs = stopRows.flatMap((r) => {
      const s = r.stop as NonNullable<ContextRow["stop"]>;
      const v = get(s);
      return v === null ? [] : [{ y: s.y, v }];
    });
    return {
      predictor: name,
      n: xs.length,
      coverage: xs.length === 0 ? 0 : xs.filter((x) => x.y <= x.v).length / xs.length,
      meanLoss: xs.length === 0 ? 0 : xs.reduce((a, x) => a + pinball(x.y, x.v, STOP_QUANTILE), 0) / xs.length,
      meanStopAtr: xs.length === 0 ? 0 : xs.reduce((a, x) => a + x.v, 0) / xs.length,
    };
  };
  const stopTable = [
    pick("(a) analogue P75 MAE (live stopLossPips)", (s) => s.analogue),
    pick("(b) ATR-scaled historical P75", (s) => s.atrScaled),
    pick("(c) unconditional historical P75 (pips)", (s) => s.priceUncond),
  ];
  return { tests, eventSplit, statusTable, stopTable };
}
