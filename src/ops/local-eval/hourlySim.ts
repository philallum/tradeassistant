// Hourly-resolved trade simulation (offline measurement, Task 14).
//
// For every FIRING day that has an empirical stop and target (a neighbourhood of 30+ analogues),
// replay the trade three ways on the SAME days:
//   close-out        - enter at the target session's open, exit at its close, no stop/target;
//   daily-only       - the path-aware simulation on daily bars (both-touched candles stay ambiguous);
//   hourly-resolved  - the same simulation, with each ambiguous candle ordered from the hourly bars.
// All use the existing Execution_Model costs. Pure over in-memory inputs; the CLI wires the data.
import type { Candle, TradingDate } from "../../guard/types.js";
import type { HourlyBarRow } from "../../hourly-store/types.js";
import type { Pair } from "../../ingestion/types.js";
import { applyCosts, DEFAULT_EXECUTION_MODEL, resolveEntry, totalCostPips, type ExecutionModel } from "../../trade-sim/executionModel.js";
import { hourlyIntraCandleResolver } from "../../trade-sim/hourlyResolver.js";
import { simulateTrade } from "../../trade-sim/tradeSimulation.js";
import type { TradeOutcomeKind, TradeProposal } from "../../trade-sim/types.js";
import type { DayRecord } from "./dayRecords.js";

export interface SimArmSummary {
  readonly trades: number;
  readonly counts: Readonly<Record<TradeOutcomeKind, number>>;
  readonly ambiguousShare: number;
  readonly meanNetPips: number;
}

export interface HourlySimReport {
  readonly eligibleFiringDays: number;
  /** Trades simulated (a firing day with a stop/target, an entry candle and hourly coverage). */
  readonly simulated: number;
  readonly skippedNoBoundaries: number;
  readonly skippedNoEntry: number;
  readonly skippedNoHourlyCoverage: number;
  readonly closeOutMeanNetPips: number;
  readonly dailyOnly: SimArmSummary;
  readonly hourlyResolved: SimArmSummary;
  /** Days where the daily candle was ambiguous and the hourly bars decided the order. */
  readonly ambiguousResolved: number;
  readonly ambiguousStillOpen: number;
}

function summarize(outcomes: readonly { kind: TradeOutcomeKind; net: number }[]): SimArmSummary {
  const counts = { target_first: 0, stop_first: 0, expired: 0, ambiguous: 0 };
  let sum = 0;
  for (const o of outcomes) {
    counts[o.kind] += 1;
    sum += o.net;
  }
  const n = outcomes.length;
  return {
    trades: n,
    counts,
    ambiguousShare: n === 0 ? 0 : counts.ambiguous / n,
    meanNetPips: n === 0 ? 0 : sum / n,
  };
}

export interface HourlySimInputs {
  readonly records: readonly DayRecord[];
  readonly candlesByPair: ReadonlyMap<Pair, readonly Candle[]>;
  readonly barsByPair: ReadonlyMap<Pair, readonly HourlyBarRow[]>;
  readonly executionModel?: ExecutionModel;
}

/** Run the three-way comparison. Deterministic. */
export function runHourlySim(input: HourlySimInputs): HourlySimReport {
  const model = input.executionModel ?? DEFAULT_EXECUTION_MODEL;
  const firing = input.records.filter((r) => r.fires && r.direction !== "FLAT");
  let noBoundaries = 0;
  let noEntry = 0;
  let noCoverage = 0;
  let ambiguousResolved = 0;
  let ambiguousStillOpen = 0;
  const closeOut: number[] = [];
  const daily: { kind: TradeOutcomeKind; net: number }[] = [];
  const hourly: { kind: TradeOutcomeKind; net: number }[] = [];

  for (const r of firing) {
    if (r.direction === "FLAT") continue;
    if (r.stopLossPips == null || r.takeProfitPips == null) {
      noBoundaries += 1;
      continue;
    }
    const candles = input.candlesByPair.get(r.pair) ?? [];
    const entry = resolveEntry(r.pair, r.date, candles);
    if (entry === null || r.realizedAfter === null) {
      noEntry += 1;
      continue;
    }
    const bars = input.barsByPair.get(r.pair) ?? [];
    const entrySessionHasBars = bars.some((b) => b.openMs >= Date.parse(`${entry.entryDate}T00:00:00Z`) - 86_400_000 && b.openMs <= Date.parse(`${entry.entryDate}T00:00:00Z`) + 86_400_000);
    if (!entrySessionHasBars) {
      noCoverage += 1;
      continue;
    }
    const proposal: TradeProposal = {
      pair: r.pair,
      decisionDate: r.date,
      direction: r.direction,
      horizon: r.horizon,
      entryPrice: entry.entryPrice,
      entryDate: entry.entryDate,
      stopLossPips: r.stopLossPips,
      takeProfitPips: r.takeProfitPips,
    };
    const dailyOutcome = simulateTrade(proposal, candles);
    const hourlyOutcome = simulateTrade(
      proposal,
      candles,
      hourlyIntraCandleResolver(proposal, (_pair, from, to) => bars.filter((b) => b.openMs >= from && b.openMs < to)),
    );
    if (dailyOutcome.kind === "ambiguous") {
      if (hourlyOutcome.kind === "ambiguous") ambiguousStillOpen += 1;
      else ambiguousResolved += 1;
    }
    daily.push({ kind: dailyOutcome.kind, net: applyCosts(dailyOutcome, model, r.pair).netPips });
    hourly.push({ kind: hourlyOutcome.kind, net: applyCosts(hourlyOutcome, model, r.pair).netPips });
    const sign = r.direction === "UP" ? 1 : -1;
    closeOut.push(sign * r.realizedAfter.pips - totalCostPips(model, r.pair));
  }

  return {
    eligibleFiringDays: firing.length,
    simulated: daily.length,
    skippedNoBoundaries: noBoundaries,
    skippedNoEntry: noEntry,
    skippedNoHourlyCoverage: noCoverage,
    closeOutMeanNetPips: closeOut.length === 0 ? 0 : closeOut.reduce((a, b) => a + b, 0) / closeOut.length,
    dailyOnly: summarize(daily),
    hourlyResolved: summarize(hourly),
    ambiguousResolved,
    ambiguousStillOpen,
  };
}

const f = (x: number): string => `${x >= 0 ? "+" : ""}${x.toFixed(2)}`;
const p = (x: number): string => `${(x * 100).toFixed(1)}%`;

function armLine(label: string, a: SimArmSummary): string {
  const c = a.counts;
  return `${label}: trades=${a.trades} target_first=${c.target_first} stop_first=${c.stop_first} expired=${c.expired} ambiguous=${c.ambiguous} (${p(a.ambiguousShare)}) mean net ${f(a.meanNetPips)} pips/trade`;
}

/** Plain, verdict-free research-log lines. */
export function renderHourlySimLines(report: HourlySimReport, window: { start: TradingDate; end: TradingDate }): readonly string[] {
  return [
    `Window ${window.start}..${window.end} (inside the discovery period; confirmation holdout not consulted). Hourly bars: Twelve Data, archived to local files only. Entry = open of the first session after the decision date; stop = P75 of neighbourhood MAE, target = P50 of neighbourhood MFE (RISKS finding 1 may skew both); costs exec-v1. Live behaviour unchanged.`,
    `Firing days ${report.eligibleFiringDays}; simulated ${report.simulated}; skipped: no stop/target (fewer than 30 analogues) ${report.skippedNoBoundaries}, no entry candle ${report.skippedNoEntry}, no hourly coverage ${report.skippedNoHourlyCoverage}.`,
    armLine("Daily bars only", report.dailyOnly),
    armLine("Hourly-resolved", report.hourlyResolved),
    `Ambiguous daily candles: ${report.ambiguousResolved} ordered by the hourly bars, ${report.ambiguousStillOpen} still open (one hour touched both levels, or no usable bars).`,
    `Same days, no stop or target (enter open, exit close): mean net ${f(report.closeOutMeanNetPips)} pips/trade.`,
    "Note: evidence for human interpretation; a small simulated sample, no verdict recorded. An unfavourable result is a valid outcome.",
  ];
}
