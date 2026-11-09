// Candle repair operator entry - replaces stored daily candles with CANONICAL ones.
//
// WHY (docs/state/RISKS.md, "DAILY CANDLE DATA INTEGRITY"): until the 2026-11 fix the daily job
// stored provider "daily" bars that did not match the system's 17:00 America/New_York session
// (part-formed bars, wrong-day labels, a missing Friday). This tool rebuilds each date in a range
// from HOURLY bars through the provider chain (same aggregator as the live job) and, only with
// `--apply`, writes the differences and refreshes everything derived from them:
//   1. upsert the canonical candles (through `OhlcIngestion`, the single validated write path),
//   2. re-encode pattern vectors from the earliest repaired date through the latest stored date,
//   3. re-resolve forward outcomes from (earliest repaired date - 5 calendar days).
// The daily Job must then be re-run to republish `dashboard.json`.
//
// DRY RUN BY DEFAULT: without `--apply` it reads and reports, and writes NOTHING.
// NEVER DELETES: a stored date with no canonical counterpart is listed, not removed.
//
// Usage:   node dist/ops/candle-repair/main.js --from 2026-10-12 [--to 2026-11-06] [--apply]
// SECRET-FREE: logs names, dates, counts and pip differences only.
//
// ☁️ Running with `--apply` against the hosted DB is a LIVE WRITE - an OPERATOR action.

import { fileURLToPath } from "node:url";

import { encodeDatesIntoVectors } from "../../encoder/encodeStoredCandles.js";
import type { TradingDate } from "../../guard/types.js";
import {
  buildProviderChain,
  isResolved,
  ohlcFeedConfigFromEnv,
  type ProviderChain,
} from "../../ingestion/ohlcFeed/index.js";
import { OhlcIngestion } from "../../ingestion/ohlcIngestion.js";
import { PAIRS, type Pair } from "../../ingestion/types.js";
import type { PipelineStores } from "../../pipeline/types.js";
import { loadScheduledRunConfig, type ScheduledRunConfig } from "../../scheduled-run/config.js";
import { errorMessage } from "../../scheduled-run/warn.js";
import { buildSupabaseStores } from "../../storage/supabase/index.js";
import { resolveHistoricalOutcomes } from "../outcome-resolution/outcomeResolution.js";
import { changes, planRepair, type RepairPlan } from "./candleRepairPlan.js";

/** Calendar days before the earliest repaired date from which outcomes are re-resolved. */
const OUTCOME_LOOKBACK_DAYS = 5;

export interface CandleRepairOptions {
  readonly from: TradingDate;
  /** Defaults to the day before the config's Decision_Date. */
  readonly to?: TradingDate;
  /** Default false: a dry run that writes nothing. */
  readonly apply?: boolean;
}

export interface CandleRepairDeps {
  readonly config?: ScheduledRunConfig;
  readonly stores?: PipelineStores;
  readonly chain?: ProviderChain;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly fetchImpl?: typeof fetch;
  readonly log?: (event: object) => void;
}

export interface CandleRepairResult {
  readonly applied: boolean;
  readonly plans: readonly RepairPlan[];
  readonly pairsFailed: readonly Pair[];
  readonly datesWritten: number;
}

function addDays(date: TradingDate, days: number): TradingDate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function runCandleRepair(
  options: CandleRepairOptions,
  deps: CandleRepairDeps = {},
): Promise<CandleRepairResult> {
  const log = deps.log ?? ((e: object) => console.log(JSON.stringify(e)));
  const env = deps.env ?? process.env;
  const config = deps.config ?? loadScheduledRunConfig(env);
  const to = options.to ?? addDays(config.decisionDate, -1);
  if (options.from > to) throw new Error(`--from ${options.from} is after --to ${to}`);
  if (to >= config.decisionDate) {
    throw new Error(`--to ${to} must be before the Decision_Date ${config.decisionDate}`);
  }

  const stores = deps.stores ?? buildSupabaseStores(config.supabase, deps.fetchImpl);
  const chain = deps.chain ?? buildProviderChain(ohlcFeedConfigFromEnv(env), deps.fetchImpl);
  if (chain.providerNames.length === 0) throw new Error("no OHLC feed provider configured");

  log({ event: "candle_repair.start", from: options.from, to, apply: options.apply === true, providers: chain.providerNames });

  const plans: RepairPlan[] = [];
  const pairsFailed: Pair[] = [];
  const providerByPair = new Map<Pair, string>();
  for (const pair of PAIRS) {
    const outcome = await chain.resolveRange(pair, options.from, to);
    if (!isResolved(outcome)) {
      // No canonical data for this pair: change nothing for it.
      pairsFailed.push(pair);
      log({ event: "candle_repair.pair_unavailable", pair, mode: outcome.mode, message: outcome.message });
      continue;
    }
    providerByPair.set(pair, outcome.provider);
    const stored = await stores.candleStore.getCandles(pair, options.from, to);
    const plan = planRepair(pair, stored, outcome.candles);
    plans.push(plan);
    for (const e of plan.entries) {
      if (e.action === "same") continue;
      log({
        event: "candle_repair.diff",
        pair,
        date: e.date,
        action: e.action,
        maxDiffPips: Number(e.maxDiffPips.toFixed(1)),
        rangeRatio: e.rangeRatio === null ? null : Number(e.rangeRatio.toFixed(2)),
        material: e.material,
      });
    }
    log({
      event: "candle_repair.pair_summary",
      pair,
      provider: outcome.provider,
      canonical: plan.entries.length,
      same: plan.entries.filter((e) => e.action === "same").length,
      replace: plan.entries.filter((e) => e.action === "replace").length,
      insert: plan.entries.filter((e) => e.action === "insert").length,
      material: plan.entries.filter((e) => e.material).length,
      unverifiedStoredDates: plan.unverifiedStoredDates,
    });
  }

  if (options.apply !== true) {
    log({ event: "candle_repair.dry_run_complete", note: "nothing written; re-run with --apply" });
    return { applied: false, plans, pairsFailed, datesWritten: 0 };
  }

  const ingestion = new OhlcIngestion(stores.candleStore);
  let datesWritten = 0;
  let earliest: TradingDate | undefined;
  for (const plan of plans) {
    const todo = changes(plan);
    if (todo.length === 0) continue;
    const report = await ingestion.ingest(plan.pair, todo.map((e) => e.canonical), config.decisionDate);
    datesWritten += report.accepted;
    const first = todo[0]!.date;
    if (earliest === undefined || first < earliest) earliest = first;

    // Vectors encode a trailing window, so every date from the first repaired one onward changes.
    const stored = await stores.candleStore.getCandles(plan.pair, first);
    await encodeDatesIntoVectors(
      stores.candleStore,
      stores.vectorStore,
      plan.pair,
      stored.map((c) => c.date),
      undefined,
      (date, err) => log({ event: "candle_repair.encode_skipped", pair: plan.pair, date, message: errorMessage(err) }),
    );
    log({ event: "candle_repair.pair_applied", pair: plan.pair, written: report.accepted, rejected: report.rejected });
  }

  if (earliest !== undefined) {
    const result = await resolveHistoricalOutcomes({
      stores,
      evalDate: config.decisionDate,
      fromDate: addDays(earliest, -OUTCOME_LOOKBACK_DAYS),
    });
    log({ event: "candle_repair.outcomes_resolved", fromDate: addDays(earliest, -OUTCOME_LOOKBACK_DAYS), outcomesWritten: result.totalOutcomesWritten });
  }
  log({ event: "candle_repair.applied", datesWritten, note: "re-run the daily Job to republish dashboard.json" });
  return { applied: true, plans, pairsFailed, datesWritten };
}

/** Parse `--from`, `--to`, `--apply` (strict: unknown flags are an error). */
export function parseArgs(argv: readonly string[]): CandleRepairOptions {
  let from: string | undefined;
  let to: string | undefined;
  let apply = false;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--apply") apply = true;
    else if (a === "--from") from = argv[++i];
    else if (a === "--to") to = argv[++i];
    else throw new Error(`unknown argument: ${a}`);
  }
  const date = /^\d{4}-\d{2}-\d{2}$/;
  if (from === undefined || !date.test(from)) throw new Error("--from YYYY-MM-DD is required");
  if (to !== undefined && !date.test(to)) throw new Error("--to must be YYYY-MM-DD");
  return { from, ...(to !== undefined ? { to } : {}), apply };
}

export async function main(): Promise<void> {
  await runCandleRepair(parseArgs(process.argv.slice(2)));
}

function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  return import.meta.url === `file://${entry}` || fileURLToPath(import.meta.url) === entry;
}

if (invokedDirectly()) {
  main().catch((err: unknown) => {
    console.error(JSON.stringify({ event: "candle_repair.error", message: errorMessage(err) }));
    process.exitCode = 1;
  });
}
