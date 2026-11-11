// Pre-registered conditional-performance studies over {@link ResearchRow}s (pure; no I/O).
//
// Every cell reports the model against the weekly-trend baseline on the SAME days (hit-rate
// uplift), the net-of-cost expectancy per trade, block-bootstrap intervals, and stability across
// calendar years and pairs. Correlation hypotheses (H1-H10) and the pre-registered band cells are
// each corrected with Benjamini-Hochberg inside their own family. A cell with fewer than
// MIN_REPORTABLE_SCORED scored days is never called significant.
import type { Interval } from "../../performance/evidenceStats.js";
import {
  BOOTSTRAP_ITERATIONS,
  BOOTSTRAP_SEED,
  FDR_Q,
  MIN_REPORTABLE_SCORED,
  MIN_STABILITY_SCORED,
  RESEARCH_HYPOTHESES,
} from "./researchProtocol.js";
import {
  benjaminiHochberg,
  blockBootstrap,
  blockBootstrapSpearman,
  weekBlock,
} from "./researchStats.js";
import { RULE_STRATEGIES, type ResearchRow, type RuleStrategyId } from "./researchDataset.js";

export type SubsetName = "directional" | "firing";

export interface Cell {
  readonly family: "pre-registered" | "exploratory";
  readonly variable: string;
  readonly label: string;
  readonly days: number;
  readonly scored: number;
  readonly modelHit: number;
  readonly baselineHit: number;
  /** model hit rate - weekly-trend hit rate on the same days (fraction; 0.01 = 1pp). */
  readonly delta: number;
  readonly deltaCi: Interval;
  readonly deltaP: number;
  /** Mean net pips per trade after execution-model cost. */
  readonly netMean: number;
  readonly netCi: Interval;
  readonly netTrades: number;
  readonly yearsPositive: number;
  readonly yearsTotal: number;
  readonly pairsPositive: number;
  readonly pairsTotal: number;
  readonly reportable: boolean;
  qValue: number | null;
  significant: boolean;
}

export interface CorrelationResult {
  readonly hypothesis: string;
  readonly variable: string;
  readonly expectedSign: "+" | "-" | "either";
  readonly n: number;
  readonly rho: number;
  readonly ci95: Interval;
  readonly p: number;
  qValue: number;
  significant: boolean;
  /** True when significant AND the sign matches the pre-registered expectation. */
  matchesExpectation: boolean;
}

export interface VariableStudy {
  readonly id: string;
  readonly hypothesis: string | null;
  readonly correlation: CorrelationResult | null;
  readonly cells: readonly Cell[];
}

export interface StandaloneResult {
  readonly id: string;
  readonly scored: number;
  readonly hit: number;
  readonly ci95: Interval;
  readonly p: number;
  qValue: number;
  significant: boolean;
  /** Share of days where this strategy and the pattern call are both directional and agree. */
  readonly agreementWithPattern: number | null;
  readonly bothDirectionalDays: number;
}

export interface AgreeVsOpposeResult {
  readonly id: RuleStrategyId;
  readonly agreeScored: number;
  readonly opposeScored: number;
  readonly agreeHit: number;
  readonly opposeHit: number;
  readonly diff: number;
  readonly ci95: Interval;
  readonly p: number;
  qValue: number;
  significant: boolean;
}

export interface SubsetStudy {
  readonly subset: SubsetName;
  readonly overall: Cell;
  readonly variables: readonly VariableStudy[];
  readonly strategyCells: readonly Cell[];
  readonly standalone: readonly StandaloneResult[];
  readonly agreeVsOppose: readonly AgreeVsOpposeResult[];
  readonly exploratoryCells: readonly Cell[];
  readonly cellsInFamily: number;
}

interface BandSpec {
  readonly label: string;
  readonly test: (v: number) => boolean;
}

interface VarSpec {
  readonly id: string;
  readonly hypothesis: string;
  readonly expectedSign: "+" | "-" | "either";
  readonly get: (r: ResearchRow) => number | null;
  readonly bands?: readonly BandSpec[];
  readonly quantiles?: number;
}

const between = (lo: number, hi: number) => (v: number): boolean => v >= lo && v < hi;

const VARIABLES: readonly VarSpec[] = [
  {
    id: "n",
    hypothesis: "H1",
    expectedSign: "+",
    get: (r) => r.n,
    bands: [
      { label: "n<10", test: between(-Infinity, 10) },
      { label: "n10-19", test: between(10, 20) },
      { label: "n20-29", test: between(20, 30) },
      { label: "n30-49", test: between(30, 50) },
      { label: "n50-99", test: between(50, 100) },
      { label: "n100+", test: between(100, Infinity) },
    ],
  },
  { id: "nearestDistance", hypothesis: "H2", expectedSign: "-", get: (r) => r.nearestDistance, quantiles: 5 },
  { id: "meanDistance", hypothesis: "H3", expectedSign: "-", get: (r) => r.meanDistance, quantiles: 5 },
  {
    id: "confidence",
    hypothesis: "H4",
    expectedSign: "+",
    get: (r) => r.confidence,
    bands: [
      { label: "0.50-0.55", test: between(-Infinity, 0.55) },
      { label: "0.55-0.60", test: between(0.55, 0.6) },
      { label: "0.60-0.65", test: between(0.6, 0.65) },
      { label: "0.65-0.70", test: between(0.65, 0.7) },
      { label: "0.70+", test: between(0.7, Infinity) },
    ],
  },
  {
    id: "rawAgreement",
    hypothesis: "H5",
    expectedSign: "+",
    get: (r) => r.rawAgreement,
    bands: [
      { label: "<0.60", test: between(-Infinity, 0.6) },
      { label: "0.60-0.69", test: between(0.6, 0.7) },
      { label: "0.70-0.79", test: between(0.7, 0.8) },
      { label: "0.80-0.89", test: between(0.8, 0.9) },
      { label: "0.90+", test: between(0.9, Infinity) },
    ],
  },
  {
    id: "closest10Agreement",
    hypothesis: "H6",
    expectedSign: "+",
    get: (r) => r.closest10Agreement,
    bands: [
      { label: "<=0.6", test: between(-Infinity, 0.65) },
      { label: "0.7-0.8", test: between(0.65, 0.85) },
      { label: "0.9+", test: between(0.85, Infinity) },
    ],
  },
  {
    id: "agreeCount",
    hypothesis: "H7",
    expectedSign: "+",
    get: (r) => r.agreeCount,
    bands: [0, 1, 2, 3, 4].map((k) => ({ label: `agree=${k}`, test: (v: number) => v === k })),
  },
  {
    id: "opposeCount",
    hypothesis: "H8",
    expectedSign: "-",
    get: (r) => r.opposeCount,
    bands: [0, 1, 2, 3, 4].map((k) => ({ label: `oppose=${k}`, test: (v: number) => v === k })),
  },
  { id: "efficiencyRatio", hypothesis: "H9", expectedSign: "either", get: (r) => r.efficiencyRatio, quantiles: 3 },
  {
    id: "atrPercentile",
    hypothesis: "H10",
    expectedSign: "either",
    get: (r) => r.atrPercentile,
    bands: [
      { label: "atr-q1(low)", test: between(-Infinity, 0.25) },
      { label: "atr-q2", test: between(0.25, 0.5) },
      { label: "atr-q3", test: between(0.5, 0.75) },
      { label: "atr-q4(high)", test: between(0.75, Infinity) },
    ],
  },
];

/** Quantile bands built from the observed values (k roughly equal-sized groups). */
function quantileBands(values: readonly number[], k: number): BandSpec[] {
  if (values.length === 0) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const edges: number[] = [];
  for (let q = 1; q < k; q += 1) edges.push(sorted[Math.floor((q * sorted.length) / k)] as number);
  const fmt = (x: number): string => (Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(3));
  const bands: BandSpec[] = [];
  for (let b = 0; b < k; b += 1) {
    const lo = b === 0 ? -Infinity : (edges[b - 1] as number);
    const hi = b === k - 1 ? Infinity : (edges[b] as number);
    const name = b === 0 ? `q1 <${fmt(hi)}` : b === k - 1 ? `q${k} >=${fmt(lo)}` : `q${b + 1} ${fmt(lo)}-${fmt(hi)}`;
    bands.push({ label: name, test: between(lo, hi) });
  }
  return bands;
}

const isScored = (r: ResearchRow): boolean => r.hit !== null && r.baselineHit !== null;

function deltaStat(sample: readonly ResearchRow[]): number {
  let s = 0;
  let m = 0;
  let b = 0;
  for (const r of sample) {
    if (r.hit === null || r.baselineHit === null) continue;
    s += 1;
    if (r.hit) m += 1;
    if (r.baselineHit) b += 1;
  }
  return s === 0 ? Number.NaN : (m - b) / s;
}

function netStat(sample: readonly ResearchRow[]): number {
  let s = 0;
  let sum = 0;
  for (const r of sample) {
    if (r.netPips === null) continue;
    s += 1;
    sum += r.netPips;
  }
  return s === 0 ? Number.NaN : sum / s;
}

const blockOf = (r: ResearchRow): string => weekBlock(r.date);

function stabilityCounts(scoredRows: readonly ResearchRow[], keyOf: (r: ResearchRow) => string): { positive: number; total: number } {
  const groups = new Map<string, ResearchRow[]>();
  for (const r of scoredRows) {
    const k = keyOf(r);
    const g = groups.get(k);
    if (g === undefined) groups.set(k, [r]);
    else g.push(r);
  }
  let positive = 0;
  let total = 0;
  for (const g of groups.values()) {
    if (g.length < MIN_STABILITY_SCORED) continue;
    total += 1;
    if (deltaStat(g) > 0) positive += 1;
  }
  return { positive, total };
}

let cellSeedCounter = 0;

export function evaluateCell(
  rows: readonly ResearchRow[],
  variable: string,
  label: string,
  family: Cell["family"],
): Cell {
  const scoredRows = rows.filter(isScored);
  const netRows = rows.filter((r) => r.netPips !== null);
  const scored = scoredRows.length;
  const hitRows = scoredRows.filter((r) => r.hit === true).length;
  const baseRows = scoredRows.filter((r) => r.baselineHit === true).length;
  cellSeedCounter += 1;
  const seed = BOOTSTRAP_SEED + cellSeedCounter;
  const d = blockBootstrap(scoredRows, blockOf, deltaStat, BOOTSTRAP_ITERATIONS, seed);
  const n = blockBootstrap(netRows, blockOf, netStat, BOOTSTRAP_ITERATIONS, seed + 7919);
  const years = stabilityCounts(scoredRows, (r) => r.date.slice(0, 4));
  const pairs = stabilityCounts(scoredRows, (r) => r.pair);
  return {
    family,
    variable,
    label,
    days: rows.length,
    scored,
    modelHit: scored === 0 ? 0 : hitRows / scored,
    baselineHit: scored === 0 ? 0 : baseRows / scored,
    delta: scored === 0 ? 0 : (hitRows - baseRows) / scored,
    deltaCi: d.ci95,
    deltaP: d.p,
    netMean: Number.isFinite(n.estimate) ? n.estimate : 0,
    netCi: n.ci95,
    netTrades: netRows.length,
    yearsPositive: years.positive,
    yearsTotal: years.total,
    pairsPositive: pairs.positive,
    pairsTotal: pairs.total,
    reportable: scored >= MIN_REPORTABLE_SCORED,
    qValue: null,
    significant: false,
  };
}

function correlationFor(spec: VarSpec, rows: readonly ResearchRow[], seed: number): CorrelationResult | null {
  const xs: number[] = [];
  const ys: number[] = [];
  const blocks: string[] = [];
  for (const r of rows) {
    const v = spec.get(r);
    if (v === null || r.hit === null) continue;
    xs.push(v);
    ys.push(r.hit ? 1 : 0);
    blocks.push(weekBlock(r.date));
  }
  if (xs.length < 30) return null;
  const res = blockBootstrapSpearman(xs, ys, blocks, BOOTSTRAP_ITERATIONS, seed);
  return {
    hypothesis: spec.hypothesis,
    variable: spec.id,
    expectedSign: spec.expectedSign,
    n: res.n,
    rho: res.estimate,
    ci95: res.ci95,
    p: res.p,
    qValue: 1,
    significant: false,
    matchesExpectation: false,
  };
}

function variableCells(spec: VarSpec, rows: readonly ResearchRow[]): Cell[] {
  const available = rows.filter((r) => spec.get(r) !== null);
  const bands =
    spec.bands ??
    quantileBands(
      available.map((r) => spec.get(r) as number),
      spec.quantiles ?? 4,
    );
  const cells: Cell[] = [];
  for (const band of bands) {
    const inBand = available.filter((r) => band.test(spec.get(r) as number));
    if (inBand.length === 0) continue;
    cells.push(evaluateCell(inBand, spec.id, band.label, "pre-registered"));
  }
  return cells;
}

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function groupCells(
  rows: readonly ResearchRow[],
  variable: string,
  family: Cell["family"],
  labelOf: (r: ResearchRow) => string | null,
  order?: readonly string[],
): Cell[] {
  const groups = new Map<string, ResearchRow[]>();
  for (const r of rows) {
    const l = labelOf(r);
    if (l === null) continue;
    const g = groups.get(l);
    if (g === undefined) groups.set(l, [r]);
    else g.push(r);
  }
  const keys = order !== undefined ? order.filter((k) => groups.has(k)) : [...groups.keys()].sort();
  return keys.map((k) => evaluateCell(groups.get(k) as ResearchRow[], variable, k, family));
}

function ruleSide(r: ResearchRow, id: RuleStrategyId): "agree" | "oppose" | "flat" | "unavailable" {
  const s = r.strategies[id];
  if (s === null) return "unavailable";
  if (s === "FLAT") return "flat";
  return s === r.direction ? "agree" : "oppose";
}

function standaloneFor(
  id: string,
  rows: readonly ResearchRow[],
  sideOf: (r: ResearchRow) => "UP" | "DOWN" | "FLAT" | null,
  seed: number,
): StandaloneResult {
  const scoredRows = rows.filter((r) => {
    const s = sideOf(r);
    return (s === "UP" || s === "DOWN") && (r.realizedSign === "UP" || r.realizedSign === "DOWN");
  });
  const stat = (sample: readonly ResearchRow[]): number => {
    if (sample.length === 0) return Number.NaN;
    let h = 0;
    for (const r of sample) if (sideOf(r) === r.realizedSign) h += 1;
    return h / sample.length - 0.5;
  };
  const b = blockBootstrap(scoredRows, blockOf, stat, BOOTSTRAP_ITERATIONS, seed);
  let both = 0;
  let agree = 0;
  for (const r of rows) {
    const s = sideOf(r);
    if ((s === "UP" || s === "DOWN") && (r.direction === "UP" || r.direction === "DOWN")) {
      both += 1;
      if (s === r.direction) agree += 1;
    }
  }
  return {
    id,
    scored: scoredRows.length,
    hit: b.estimate + 0.5,
    ci95: { lo: b.ci95.lo + 0.5, hi: b.ci95.hi + 0.5 },
    p: b.p,
    qValue: 1,
    significant: false,
    agreementWithPattern: both === 0 ? null : agree / both,
    bothDirectionalDays: both,
  };
}

/**
 * Run the full conditional study for one subset. `allRows` is the full row set (all days, used for
 * the standalone strategy accuracy); the subset rows are derived from it.
 */
export function studySubset(allRows: readonly ResearchRow[], subset: SubsetName): SubsetStudy {
  const rows = allRows.filter((r) => r.direction !== "FLAT" && (subset === "directional" || r.fires));

  const overall = evaluateCell(rows, "all", subset === "directional" ? "all directional days" : "all firing days", "pre-registered");

  // --- Pre-registered variables: correlation (H1-H10) + band cells ---------------------------
  const variables: VariableStudy[] = [];
  let seed = BOOTSTRAP_SEED + 100;
  for (const spec of VARIABLES) {
    seed += 13;
    variables.push({
      id: spec.id,
      hypothesis: spec.hypothesis,
      correlation: correlationFor(spec, rows, seed),
      cells: variableCells(spec, rows),
    });
  }

  // Pair and weekday are pre-registered slice dimensions in the existing protocol.
  variables.push({
    id: "pair",
    hypothesis: null,
    correlation: null,
    cells: groupCells(rows, "pair", "pre-registered", (r) => r.pair),
  });
  variables.push({
    id: "weekday",
    hypothesis: null,
    correlation: null,
    cells: groupCells(rows, "weekday", "pre-registered", (r) => WEEKDAY[r.weekday] ?? null, WEEKDAY),
  });

  // --- Confluence: each rule strategy relative to the pattern call ---------------------------
  const strategyCells: Cell[] = [];
  for (const id of RULE_STRATEGIES) {
    strategyCells.push(
      ...groupCells(rows, `strategy:${id}`, "pre-registered", (r) => ruleSide(r, id), ["agree", "oppose", "flat", "unavailable"]),
    );
  }
  strategyCells.push(
    ...groupCells(rows, "confluenceStatus", "pre-registered", (r) => r.confluenceStatus),
  );

  // --- Standalone accuracy against a coin flip, and agree-vs-oppose differences ---------------
  const standalone: StandaloneResult[] = [];
  let sseed = BOOTSTRAP_SEED + 5000;
  for (const id of RULE_STRATEGIES) {
    sseed += 17;
    standalone.push(standaloneFor(id, allRows, (r) => r.strategies[id], sseed));
  }
  sseed += 17;
  standalone.push(standaloneFor("pattern (all directional days)", allRows, (r) => r.direction, sseed));

  const agreeVsOppose: AgreeVsOpposeResult[] = [];
  for (const id of RULE_STRATEGIES) {
    const scoredRows = rows.filter((r) => r.hit !== null);
    const agree = scoredRows.filter((r) => ruleSide(r, id) === "agree");
    const oppose = scoredRows.filter((r) => ruleSide(r, id) === "oppose");
    const stat = (sample: readonly ResearchRow[]): number => {
      let ah = 0;
      let an = 0;
      let oh = 0;
      let on = 0;
      for (const r of sample) {
        const side = ruleSide(r, id);
        if (side === "agree") {
          an += 1;
          if (r.hit === true) ah += 1;
        } else if (side === "oppose") {
          on += 1;
          if (r.hit === true) oh += 1;
        }
      }
      return an === 0 || on === 0 ? Number.NaN : ah / an - oh / on;
    };
    sseed += 17;
    const b = blockBootstrap([...agree, ...oppose], blockOf, stat, BOOTSTRAP_ITERATIONS, sseed);
    agreeVsOppose.push({
      id,
      agreeScored: agree.length,
      opposeScored: oppose.length,
      agreeHit: agree.length === 0 ? 0 : agree.filter((r) => r.hit === true).length / agree.length,
      opposeHit: oppose.length === 0 ? 0 : oppose.filter((r) => r.hit === true).length / oppose.length,
      diff: Number.isFinite(b.estimate) ? b.estimate : 0,
      ci95: b.ci95,
      p: b.p,
      qValue: 1,
      significant: false,
    });
  }

  // --- Exploratory (NOT pre-registered; excluded from the correction family) ------------------
  const exploratory: Cell[] = [
    // Added after the first report run showed model and baseline identical in several cells:
    // how often does the pattern call simply equal the weekly-trend sign? (exploratory)
    ...groupCells(rows, "patternVsWeeklyTrend", "exploratory", (r) =>
      r.direction === r.weeklyTrendSign ? "pattern = weekly trend" : "pattern differs from weekly trend",
    ),
    ...groupCells(rows, "usdExposure", "exploratory", (r) => (r.usdLong === null ? null : r.usdLong ? "USD long" : "USD short")),
    ...groupCells(rows, "eventOnTargetSession", "exploratory", (r) =>
      r.eventOnTargetSession === null ? null : r.eventOnTargetSession ? "FOMC/NFP session" : "ordinary session",
    ),
    ...groupCells(rows, "yesterday", "exploratory", (r) =>
      r.yesterdaySign === null ? null : r.yesterdaySign === "FLAT" ? "flat" : r.yesterdaySign === r.direction ? "call follows yesterday" : "call fades yesterday",
    ),
    ...groupCells(rows, "hasStopTarget", "exploratory", (r) => (r.stopLossPips !== null ? "stop/target derived (n>=30)" : "no stop/target (n<30)")),
    ...groupCells(
      rows.filter((r) => r.stopLossPips !== null && r.atrPips > 0),
      "stopOverAtr",
      "exploratory",
      (r) => {
        const ratio = (r.stopLossPips as number) / r.atrPips;
        return ratio < 0.5 ? "stop<0.5 ATR" : ratio < 0.8 ? "stop 0.5-0.8 ATR" : ratio < 1.2 ? "stop 0.8-1.2 ATR" : "stop>=1.2 ATR";
      },
      ["stop<0.5 ATR", "stop 0.5-0.8 ATR", "stop 0.8-1.2 ATR", "stop>=1.2 ATR"],
    ),
  ];

  // --- Multiple-comparison correction, family by family --------------------------------------
  const corr = variables.flatMap((v) => (v.correlation === null ? [] : [v.correlation]));
  const corrFdr = benjaminiHochberg(corr.map((c) => c.p), FDR_Q);
  corr.forEach((c, i) => {
    c.qValue = corrFdr.adjusted[i] as number;
    const reject = corrFdr.rejected[i] === true && c.n >= MIN_REPORTABLE_SCORED;
    c.significant = reject;
    c.matchesExpectation =
      reject && (c.expectedSign === "either" || (c.expectedSign === "+" ? c.rho > 0 : c.rho < 0));
  });

  const familyCells = [...variables.flatMap((v) => v.cells), ...strategyCells].filter((c) => c.reportable);
  const cellFdr = benjaminiHochberg(familyCells.map((c) => c.deltaP), FDR_Q);
  familyCells.forEach((c, i) => {
    c.qValue = cellFdr.adjusted[i] as number;
    c.significant = cellFdr.rejected[i] === true;
  });

  const sFdr = benjaminiHochberg(standalone.map((s) => s.p), FDR_Q);
  standalone.forEach((s, i) => {
    s.qValue = sFdr.adjusted[i] as number;
    s.significant = sFdr.rejected[i] === true && s.scored >= MIN_REPORTABLE_SCORED;
  });
  const aFdr = benjaminiHochberg(agreeVsOppose.map((s) => s.p), FDR_Q);
  agreeVsOppose.forEach((s, i) => {
    s.qValue = aFdr.adjusted[i] as number;
    s.significant = aFdr.rejected[i] === true && Math.min(s.agreeScored, s.opposeScored) >= MIN_REPORTABLE_SCORED / 2;
  });

  return {
    subset,
    overall,
    variables,
    strategyCells,
    standalone,
    agreeVsOppose,
    exploratoryCells: exploratory,
    cellsInFamily: familyCells.length,
  };
}

/** Pre-registered hypothesis statement lookup (for report rendering). */
export function hypothesisText(id: string): string {
  return RESEARCH_HYPOTHESES.find((h) => h.id === id)?.statement ?? id;
}
