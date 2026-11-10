// Candle history audit operator entry (READ-ONLY).
//
// Default source is the local seed CSVs (`data/*_D1.csv`): no network, no database, no secrets.
// `--source store` audits the configured candle store instead; against the hosted project that
// is a (small) READ and an operator choice - nothing is ever written by this tool.
//
// Usage: node dist/ops/candle-audit/main.js [--source csv|store] [--dir data] [--before YYYY-MM-DD]
//   --before limits the audit to dates strictly before that date (e.g. 2026-10-12, the start of
//   the already-repaired range).
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { csvFileNameFor, parseCsvCandles } from "../../csv-loader/csvLoader.js";
import { PAIRS, type Pair } from "../../ingestion/types.js";
import { loadScheduledRunConfig } from "../../scheduled-run/config.js";
import { errorMessage } from "../../scheduled-run/warn.js";
import { buildSupabaseStores } from "../../storage/supabase/index.js";
import { auditPair, type AuditCandle, type PairAuditReport } from "./candleAudit.js";

export interface CandleAuditOptions {
  readonly source: "csv" | "store";
  readonly dir: string;
  readonly before?: string;
}

export interface CandleAuditDeps {
  readonly readText?: (path: string) => Promise<string>;
  readonly loadFromStore?: (pair: Pair) => Promise<readonly AuditCandle[]>;
  readonly log?: (event: object) => void;
}

export async function runCandleAudit(
  options: CandleAuditOptions,
  deps: CandleAuditDeps = {},
): Promise<readonly PairAuditReport[]> {
  const log = deps.log ?? ((e: object) => console.log(JSON.stringify(e)));
  const readText = deps.readText ?? ((p: string) => readFile(p, "utf8"));
  log({ event: "candle_audit.start", source: options.source, before: options.before ?? null });

  const reports: PairAuditReport[] = [];
  for (const pair of PAIRS) {
    let candles: readonly AuditCandle[];
    if (options.source === "csv") {
      const file = csvFileNameFor(pair);
      const parsed = parseCsvCandles(file, await readText(join(options.dir, file)), pair);
      if (!parsed.ok) {
        log({ event: "candle_audit.pair_unreadable", pair, reason: parsed.error.reason });
        continue;
      }
      candles = parsed.candles.map((c) => ({
        date: String(c.timestamp ?? "").slice(0, 10),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }));
    } else {
      const load =
        deps.loadFromStore ??
        (async (p: Pair) => {
          const stores = buildSupabaseStores(loadScheduledRunConfig(process.env).supabase);
          return stores.candleStore.getCandles(p);
        });
      candles = await load(pair);
    }
    const scoped = options.before === undefined ? candles : candles.filter((c) => c.date < options.before!);
    const report = auditPair(pair, scoped);
    reports.push(report);
    log({
      event: "candle_audit.pair_summary",
      pair,
      candles: report.candles,
      firstDate: report.firstDate,
      lastDate: report.lastDate,
      findings: report.findings.length,
      byYear: report.byYear,
    });
    for (const f of report.findings) log({ event: "candle_audit.finding", ...f });
  }
  log({ event: "candle_audit.complete", pairs: reports.length, totalFindings: reports.reduce((n, r) => n + r.findings.length, 0) });
  return reports;
}

export function parseArgs(argv: readonly string[]): CandleAuditOptions {
  let source: "csv" | "store" = "csv";
  let dir = "data";
  let before: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--source") {
      const v = argv[++i];
      if (v !== "csv" && v !== "store") throw new Error("--source must be csv or store");
      source = v;
    } else if (a === "--dir") dir = argv[++i] ?? dir;
    else if (a === "--before") before = argv[++i];
    else throw new Error(`unknown argument: ${a}`);
  }
  if (before !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(before)) throw new Error("--before must be YYYY-MM-DD");
  return { source, dir, ...(before !== undefined ? { before } : {}) };
}

function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  return import.meta.url === `file://${entry}` || fileURLToPath(import.meta.url) === entry;
}

if (invokedDirectly()) {
  runCandleAudit(parseArgs(process.argv.slice(2))).catch((err: unknown) => {
    console.error(JSON.stringify({ event: "candle_audit.error", message: errorMessage(err) }));
    process.exitCode = 1;
  });
}
