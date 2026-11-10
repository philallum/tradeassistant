// Hourly bar backfill (operator tool; LOCAL FILES ONLY).
//
// Fetches HOURLY bars from Twelve Data and archives them to JSON-lines files under a local
// directory (default `data/hourly`, git-ignored). It exists so the offline simulation can resolve
// the order in which a stop and a target were touched inside a session. Nothing is written to
// the database and the daily Job is untouched.
//
// Outbound network: ONLY the Twelve Data time-series endpoint, with the symbol and date range and
// the key from TWELVE_DATA_API_KEY (read from the environment by NAME; never logged). No project
// data is sent. The free plan limits requests per minute and history depth, so the tool paces
// itself, fetches in chunks, and reports exactly what coverage it obtained per pair.
//
// Usage: node --env-file=.env dist/ops/hourly-backfill/main.js --from 2024-01-01 --to 2024-12-31 \
//          [--pairs EURUSD,GBPUSD] [--dir data/hourly] [--chunk-days 150] [--pause-seconds 9]
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { FileHourlyBarStore } from "../../hourly-store/fileHourlyStore.js";
import { hourlyArchiver } from "../../hourly-store/archiver.js";
import type { HourlyBarStore } from "../../hourly-store/types.js";
import type { TradingDate } from "../../guard/types.js";
import type { HourlyBar } from "../../ingestion/sessionAggregation.js";
import { ohlcFeedConfigFromEnv } from "../../ingestion/ohlcFeed/types.js";
import { TwelveDataOhlcFeedProvider } from "../../ingestion/ohlcFeed/twelveDataOhlcProvider.js";
import { PAIRS, isPair, type Pair } from "../../ingestion/types.js";

export interface HourlyBackfillOptions {
  readonly from: TradingDate;
  readonly to: TradingDate;
  readonly pairs: readonly Pair[];
  readonly dir: string;
  readonly chunkDays: number;
  readonly pauseSeconds: number;
}

export interface HourlyFetcherPort {
  fetchHourlyBars(pair: Pair, from: TradingDate, to: TradingDate): Promise<
    { readonly ok: true; readonly value: readonly HourlyBar[] } | { readonly ok: false; readonly error: { readonly mode: string; readonly message: string } }
  >;
}

export interface PairBackfillResult {
  readonly pair: Pair;
  readonly chunks: number;
  readonly failedChunks: number;
  readonly bars: number;
  readonly firstChunkError: string | null;
}

function addDays(date: TradingDate, days: number): TradingDate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Fetch every chunk for every pair into `store`. Failures are counted and reported, never thrown. */
export async function runHourlyBackfill(
  options: HourlyBackfillOptions,
  deps: {
    readonly fetcher: HourlyFetcherPort;
    readonly store: HourlyBarStore;
    readonly sleep?: (ms: number) => Promise<void>;
    readonly log?: (event: object) => void;
  },
): Promise<readonly PairBackfillResult[]> {
  const log = deps.log ?? ((e: object) => console.log(JSON.stringify(e)));
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const archive = hourlyArchiver(deps.store, "twelvedata");
  const results: PairBackfillResult[] = [];
  let first = true;
  for (const pair of options.pairs) {
    let chunks = 0;
    let failed = 0;
    let bars = 0;
    let firstError: string | null = null;
    for (let start = options.from; start <= options.to; start = addDays(start, options.chunkDays + 1)) {
      const end = addDays(start, options.chunkDays) > options.to ? options.to : addDays(start, options.chunkDays);
      if (!first) await sleep(options.pauseSeconds * 1000);
      first = false;
      chunks += 1;
      const res = await deps.fetcher.fetchHourlyBars(pair, start, end);
      if (!res.ok) {
        failed += 1;
        firstError ??= `${res.error.mode}: ${res.error.message}`;
        log({ event: "hourly_backfill.chunk_failed", pair, start, end, mode: res.error.mode });
        continue;
      }
      await archive(pair, res.value);
      bars += res.value.length;
      log({ event: "hourly_backfill.chunk_ok", pair, start, end, bars: res.value.length });
    }
    results.push({ pair, chunks, failedChunks: failed, bars, firstChunkError: firstError });
  }
  return results;
}

export function parseArgs(argv: readonly string[]): HourlyBackfillOptions {
  let from: string | undefined;
  let to: string | undefined;
  let pairs: Pair[] = [...PAIRS];
  let dir = join("data", "hourly");
  let chunkDays = 150;
  let pauseSeconds = 9;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--from") from = argv[++i];
    else if (a === "--to") to = argv[++i];
    else if (a === "--dir") dir = argv[++i] ?? dir;
    else if (a === "--chunk-days") chunkDays = Number(argv[++i]);
    else if (a === "--pause-seconds") pauseSeconds = Number(argv[++i]);
    else if (a === "--pairs") {
      const list = (argv[++i] ?? "").split(",").filter((p) => p !== "");
      const bad = list.filter((p) => !isPair(p));
      if (bad.length > 0) throw new Error(`unknown pair(s): ${bad.join(", ")}`);
      pairs = list as Pair[];
    } else throw new Error(`unknown argument: ${a}`);
  }
  const date = /^\d{4}-\d{2}-\d{2}$/;
  if (from === undefined || !date.test(from)) throw new Error("--from YYYY-MM-DD is required");
  if (to === undefined || !date.test(to)) throw new Error("--to YYYY-MM-DD is required");
  if (from > to) throw new Error("--from is after --to");
  if (!(chunkDays >= 1 && chunkDays <= 200)) throw new Error("--chunk-days must be 1..200 (provider page limit)");
  if (!(pauseSeconds >= 0)) throw new Error("--pause-seconds must be >= 0");
  return { from, to, pairs, dir, chunkDays, pauseSeconds };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const cfg = ohlcFeedConfigFromEnv(process.env).providers.find((p) => p.provider === "TwelveData");
  if (cfg === undefined) throw new Error("TWELVE_DATA_API_KEY is not set (run with node --env-file=.env)");
  const store = new FileHourlyBarStore(options.dir);
  const results = await runHourlyBackfill(options, { fetcher: new TwelveDataOhlcFeedProvider(cfg), store });
  console.log(JSON.stringify({ event: "hourly_backfill.complete", results }));
  console.log(JSON.stringify({ event: "hourly_backfill.coverage", coverage: await store.coverage() }));
}

const entry = process.argv[1];
if (entry !== undefined && (import.meta.url === `file://${entry}` || fileURLToPath(import.meta.url) === entry)) {
  main().catch((err: unknown) => {
    // The message never contains the key: it is not part of any error text we build.
    console.error(JSON.stringify({ event: "hourly_backfill.error", message: err instanceof Error ? err.message : String(err) }));
    process.exitCode = 1;
  });
}
