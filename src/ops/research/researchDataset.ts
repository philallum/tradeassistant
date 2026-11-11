// Research dataset: one row per pair per decision date with every conditioning variable and the
// outcome. Built on the existing offline `collectDayRecords` (live convention, local in-memory
// stores, hosted untouched). Neighbourhood statistics are captured through the existing
// `neighbourhoodFilter` hook used as a read-only observer, so no existing code changes.
//
// LOOK-AHEAD: every feature uses data strictly before the decision date. Outcomes use the session
// AFTER the decision date (the live convention); the session labelled with the date is kept as a
// sensitivity outcome only.
import type { Confidence } from "../../confidence/types.js";
import type { Candle } from "../../guard/types.js";
import type { Pair } from "../../ingestion/types.js";
import { efficiencyRatio } from "../../dashboard/choppinessMetric.js";
import { eventsOn } from "../../event-calendar/eventCalendar.js";
import { totalCostPips, type ExecutionModel } from "../../trade-sim/executionModel.js";
import { pipSize } from "../../trade-sim/pip.js";
import {
  adaptCustomPattern,
  createBreakoutStrategy,
  createConfluenceEngine,
  createRangeStrategy,
  createReversalStrategy,
  createTrendStrategy,
  type ConfluenceEngine,
  type ConfluenceStatus,
  type Strategy,
  type StrategySignal,
} from "../../strategies/index.js";
import type { ProtocolWindow } from "../../walk-forward/evidenceProtocol.js";
import { collectDayRecords, type DayRecord } from "../local-eval/dayRecords.js";
import { buildLocalEvalStores } from "../local-eval/localStores.js";
import { computeChartFeatures, type ChartFeatures } from "./chartFeatures.js";
import { XTB_STANDARD_MODEL } from "./costModel.js";
import { assertExplorationWindow, RESEARCH_EXPLORATION_WINDOW } from "./researchProtocol.js";

export type Side = "UP" | "DOWN" | "FLAT";
export const RULE_STRATEGIES = ["trend", "breakout", "range", "reversal"] as const;
export type RuleStrategyId = (typeof RULE_STRATEGIES)[number];

/** First date the maintained event calendar can be relied on. */
export const EVENT_CALENDAR_START = "2021-01-01" as const;

export interface ResearchRow {
  readonly pair: Pair;
  readonly date: string;
  readonly weekday: number;
  /** The pattern call; FLAT when the neighbourhood gives no directional view. */
  readonly direction: Side;
  readonly fires: boolean;
  readonly confidence: number;
  readonly n: number;
  readonly nearestDistance: number | null;
  readonly medianDistance: number | null;
  readonly meanDistance: number | null;
  /** Share of the neighbourhood on the dominant side (null when direction is FLAT or n = 0). */
  readonly rawAgreement: number | null;
  /** Share of the closest 10 / 25 analogues on the called side (null when fewer analogues). */
  readonly closest10Agreement: number | null;
  readonly closest25Agreement: number | null;
  readonly atr14: number;
  readonly atrPips: number;
  readonly atrPercentile: number | null;
  readonly efficiencyRatio: number | null;
  readonly weeklyTrendSign: "UP" | "DOWN";
  readonly yesterdaySign: Side | null;
  /** Empirical stop / target pips (null below the 30-analogue floor). */
  readonly stopLossPips: number | null;
  readonly takeProfitPips: number | null;
  /** True when a USD-long thesis (UP on USDxxx, DOWN on xxxUSD); null when direction is FLAT. */
  readonly usdLong: boolean | null;
  /** FOMC / US jobs report on the target session date; null before the calendar is maintained. */
  readonly eventOnTargetSession: boolean | null;
  /** The four rule strategies' directions (null = strategy unavailable). */
  readonly strategies: Readonly<Record<RuleStrategyId, Side | null>>;
  readonly agreeCount: number | null;
  readonly opposeCount: number | null;
  readonly confluenceScore: number | null;
  readonly confluenceStatus: ConfluenceStatus | null;
  /** Date label and daily close of the target session (the candle after the decision date). */
  readonly targetDate: string | null;
  readonly targetClose: number | null;
  /** Target session (after the decision date): realised sign and signed pips. */
  readonly realizedSign: Side | null;
  readonly realizedPips: number | null;
  /** Model call correct (null when no call or realised sign FLAT / unavailable). */
  readonly hit: boolean | null;
  readonly baselineHit: boolean | null;
  /** Gross pips in the called direction minus execution-model cost (null when no call / no outcome). */
  readonly netPips: number | null;
  /** Sensitivity: same, using the session labelled with the decision date. */
  readonly hitOn: boolean | null;
  readonly netPipsOn: number | null;
  /** Cost deducted per trade for this pair (pips). */
  readonly costPips: number;
  /** Price-only chart features from candles strictly before the decision date (null with too little history). */
  readonly features: ChartFeatures | null;
}

interface NeighbourhoodSummary {
  readonly nearest: number | null;
  readonly median: number | null;
  readonly dirs: Readonly<{ up: number; down: number }>;
  readonly closest10: Readonly<{ up: number; down: number; size: number }>;
  readonly closest25: Readonly<{ up: number; down: number; size: number }>;
}

function median(sorted: readonly number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

function countSides(items: readonly { readonly direction: string }[]): { up: number; down: number; size: number } {
  let up = 0;
  let down = 0;
  for (const a of items) {
    if (a.direction === "UP") up += 1;
    else if (a.direction === "DOWN") down += 1;
  }
  return { up, down, size: items.length };
}

function summarise(
  nb: readonly { readonly direction: string; readonly cosineDistance?: number | undefined }[],
): NeighbourhoodSummary {
  // retrieve() returns the neighbourhood sorted by distance ascending.
  const distances = nb.map((a) => a.cosineDistance).filter((d): d is number => d !== undefined);
  const sorted = [...distances].sort((a, b) => a - b);
  const all = countSides(nb);
  return {
    nearest: sorted[0] ?? null,
    median: median(sorted),
    dirs: { up: all.up, down: all.down },
    closest10: countSides(nb.slice(0, 10)),
    closest25: countSides(nb.slice(0, 25)),
  };
}

function shareOnSide(c: { up: number; down: number; size: number }, side: "UP" | "DOWN", need: number): number | null {
  if (c.size < need) return null;
  return (side === "UP" ? c.up : c.down) / c.size;
}

function mustStrategy<C>(r: { ok: true; value: Strategy<C> } | { ok: false; error: unknown }): Strategy<C> {
  if (!r.ok) throw new Error("research dataset: default strategy configuration rejected");
  return r.value;
}

function weeklyBlockIndex(candles: readonly Candle[]): Map<string, number> {
  const m = new Map<string, number>();
  candles.forEach((c, i) => m.set(c.date, i));
  return m;
}

export interface BuildResearchOptions {
  readonly dataDir: string;
  readonly window?: ProtocolWindow;
  readonly executionModel?: ExecutionModel;
  readonly onProgress?: (pair: Pair, done: number, total: number) => void;
}

/** Build the research rows for the window. The window must not reach into the locked holdout. */
export async function buildResearchRows(options: BuildResearchOptions): Promise<readonly ResearchRow[]> {
  const window = assertExplorationWindow(options.window ?? RESEARCH_EXPLORATION_WINDOW);
  const model = options.executionModel ?? XTB_STANDARD_MODEL;
  const built = await buildLocalEvalStores({ dataDir: options.dataDir, log: () => undefined });

  const observed = new Map<string, NeighbourhoodSummary>();
  const records = await collectDayRecords(built.stores, {
    window,
    ...(options.onProgress !== undefined ? { onProgress: options.onProgress } : {}),
    neighbourhoodFilter: (nb, ctx) => {
      observed.set(`${ctx.pair}|${ctx.date}`, summarise(nb));
      return nb;
    },
  });

  const strategies: Readonly<Record<RuleStrategyId, Strategy<unknown>>> = {
    trend: mustStrategy(createTrendStrategy()),
    breakout: mustStrategy(createBreakoutStrategy()),
    range: mustStrategy(createRangeStrategy()),
    reversal: mustStrategy(createReversalStrategy()),
  };
  const engineResult = createConfluenceEngine();
  if (!engineResult.ok) throw new Error("research dataset: default confluence engine rejected");
  const engine: ConfluenceEngine = engineResult.value;

  const candlesByPair = new Map<Pair, readonly Candle[]>();
  const indexByPair = new Map<Pair, Map<string, number>>();
  for (const r of records) {
    if (candlesByPair.has(r.pair)) continue;
    const candles = await built.stores.candleStore.getCandles(r.pair);
    candlesByPair.set(r.pair, candles);
    indexByPair.set(r.pair, weeklyBlockIndex(candles));
  }

  const rows: ResearchRow[] = [];
  for (const rec of records) {
    const candles = candlesByPair.get(rec.pair) as readonly Candle[];
    const i = (indexByPair.get(rec.pair) as Map<string, number>).get(rec.date);
    if (i === undefined) continue;
    rows.push(toRow(rec, candles, i, observed.get(`${rec.pair}|${rec.date}`), strategies, engine, model));
  }
  return rows;
}

function toRow(
  rec: DayRecord,
  candles: readonly Candle[],
  i: number,
  nb: NeighbourhoodSummary | undefined,
  strategies: Readonly<Record<RuleStrategyId, Strategy<unknown>>>,
  engine: ConfluenceEngine,
  model: ExecutionModel,
): ResearchRow {
  const pip = pipSize(rec.pair);
  const cost = totalCostPips(model, rec.pair);
  const dir: Side = rec.direction;
  const called = dir === "UP" || dir === "DOWN" ? dir : null;

  // Look-ahead-safe inputs: candles strictly before the decision date.
  const past = candles.slice(Math.max(0, i - 120), i);
  const er = past.length >= 15 ? efficiencyRatio(past, rec.date, 14) : null;

  const sig: Record<RuleStrategyId, StrategySignal | null> = { trend: null, breakout: null, range: null, reversal: null };
  const sides: Record<RuleStrategyId, Side | null> = { trend: null, breakout: null, range: null, reversal: null };
  for (const id of RULE_STRATEGIES) {
    const res = strategies[id].evaluate(past, rec.date);
    if (res.ok) {
      sig[id] = res.value;
      sides[id] = res.value.direction;
    }
  }

  let agreeCount: number | null = null;
  let opposeCount: number | null = null;
  if (called !== null) {
    agreeCount = 0;
    opposeCount = 0;
    for (const id of RULE_STRATEGIES) {
      const s = sides[id];
      if (s === called) agreeCount += 1;
      else if (s !== null && s !== "FLAT") opposeCount += 1;
    }
  }

  let confluenceScore: number | null = null;
  let confluenceStatus: ConfluenceStatus | null = null;
  const signals: StrategySignal[] = RULE_STRATEGIES.flatMap((id) => (sig[id] === null ? [] : [sig[id]]));
  const custom = adaptCustomPattern({ direction: rec.direction, earnedConfidence: rec.confidence as Confidence });
  if (custom.kind === "signal") signals.push(custom.signal);
  if (signals.length > 0) {
    const agg = engine.aggregate(signals);
    if (agg.ok) {
      confluenceScore = agg.value.score;
      confluenceStatus = agg.value.status;
    }
  }

  const real = rec.realizedAfter;
  const realOn = rec.realizedOn;
  const scoreHit = (r: { sign: Side } | null): boolean | null =>
    called === null || r === null || r.sign === "FLAT" ? null : r.sign === called;
  const net = (r: { pips: number } | null): number | null =>
    called === null || r === null ? null : (called === "UP" ? r.pips : -r.pips) - cost;

  const nextDate = candles[i + 1]?.date;
  const eventOnTarget =
    nextDate === undefined || nextDate < EVENT_CALENDAR_START
      ? null
      : eventsOn(nextDate).some((e) => e.kind === "FOMC" || e.kind === "US_NFP");

  return {
    pair: rec.pair,
    date: rec.date,
    weekday: rec.weekday,
    direction: dir,
    fires: rec.fires,
    confidence: rec.confidence,
    n: rec.n,
    nearestDistance: nb?.nearest ?? null,
    medianDistance: nb?.median ?? null,
    meanDistance: rec.meanCosineDistance,
    rawAgreement:
      called === null || nb === undefined || nb.dirs.up + nb.dirs.down === 0 || rec.n === 0
        ? null
        : (called === "UP" ? nb.dirs.up : nb.dirs.down) / rec.n,
    closest10Agreement: called === null || nb === undefined ? null : shareOnSide(nb.closest10, called, 10),
    closest25Agreement: called === null || nb === undefined ? null : shareOnSide(nb.closest25, called, 25),
    atr14: rec.atr14,
    atrPips: rec.atr14 / pip,
    atrPercentile: rec.atrPercentile,
    efficiencyRatio: er,
    weeklyTrendSign: rec.weeklyTrendSign,
    yesterdaySign: rec.yesterdaySign,
    stopLossPips: rec.stopLossPips ?? null,
    takeProfitPips: rec.takeProfitPips ?? null,
    usdLong: called === null ? null : rec.pair.startsWith("USD") ? called === "UP" : called === "DOWN",
    eventOnTargetSession: eventOnTarget,
    strategies: sides,
    agreeCount,
    opposeCount,
    confluenceScore,
    confluenceStatus,
    targetDate: nextDate ?? null,
    targetClose: candles[i + 1]?.close ?? null,
    realizedSign: real?.sign ?? null,
    realizedPips: real?.pips ?? null,
    hit: scoreHit(real),
    baselineHit: real === null || real.sign === "FLAT" ? null : rec.weeklyTrendSign === real.sign,
    netPips: net(real),
    hitOn: scoreHit(realOn),
    netPipsOn: net(realOn),
    costPips: cost,
    features: computeChartFeatures(candles.slice(Math.max(0, i - 130), i)),
  };
}
