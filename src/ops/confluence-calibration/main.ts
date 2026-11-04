// Read-only confluence threshold calibration — operator research script.
//
// Replays the four classical strategies day by day over the local CSV history in
// `data/`, using ONLY candles strictly before each day (the strategies' own
// look-ahead guard still applies), pairs each day's signals with the direction the
// NEXT session actually took (resolver convention: first candle after the day;
// FLAT inside 0.5 x ATR_14), and prints
//   - each strategy's strength distribution,
//   - the pattern matcher's reachable strength band (analytic, from the shrinkage
//     formula; it cannot be replayed without the vector store), and
//   - a threshold sweep: status frequencies and aligned hit-rate.
//
// It touches no database, no network and no secret, and writes nothing except
// stdout. Run:  npm run build && node dist/ops/confluence-calibration/main.js
//
// The output informs a human threshold decision recorded in RESEARCH-LOG.md and
// docs/state/DECISIONS.md; the script itself changes nothing.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Candle } from "../../guard/types.js";
import { PAIRS, type Pair } from "../../ingestion/types.js";
import { buildStrategyBundle } from "../../scheduled-run/confluenceSlice.js";
import {
  patternStrength,
  strengthDistribution,
  sweep,
  type CalibrationSample,
} from "../../strategies/calibration.js";
import { realizedDirectionAfter } from "../../track-record/strategyRecord.js";

const REPLAY_DAYS = 1500; // about six years of trading days per pair
const WINDOW = 250; // trailing candles handed to each strategy
const CLASSICAL = ["trend", "breakout", "range", "reversal"] as const;

/** Parse a tab-separated `data/<PAIR>_D1.csv` into ascending candles. */
export function parseCandles(pair: Pair, contents: string): Candle[] {
  const lines = contents.split("\n").map((l) => l.replace(/\r$/, ""));
  const out: Candle[] = [];
  for (const line of lines.slice(1)) {
    if (line === "") continue;
    const c = line.split("\t");
    const [time, o, h, l, cl] = [c[0], Number(c[1]), Number(c[2]), Number(c[3]), Number(c[4])];
    if (time === undefined || ![o, h, l, cl].every(Number.isFinite)) continue;
    out.push({ asset: pair, date: time.slice(0, 10), open: o, high: h, low: l, close: cl });
  }
  return out;
}

export async function buildSamples(dataDir: string): Promise<CalibrationSample[]> {
  const strategies = buildStrategyBundle();
  if (strategies === null) throw new Error("strategy bundle construction failed");
  const samples: CalibrationSample[] = [];
  for (const pair of PAIRS) {
    const candles = parseCandles(pair, await readFile(join(dataDir, `${pair}_D1.csv`), "utf8"));
    const start = Math.max(WINDOW, candles.length - REPLAY_DAYS - 1);
    for (let i = start; i < candles.length - 1; i++) {
      const date = candles[i]!.date;
      const realized = realizedDirectionAfter(candles, date);
      if (realized === null) continue;
      const past = candles.slice(Math.max(0, i - WINDOW), i); // strictly before `date`
      const signals = CLASSICAL.flatMap((id) => {
        const r = strategies[id].evaluate(past, date);
        return r.ok ? [r.value] : [];
      });
      samples.push({ pair, date, signals, realized });
    }
  }
  return samples;
}

const f = (x: number, d = 3): string => x.toFixed(d);

export async function main(dataDir = join(process.cwd(), "data")): Promise<void> {
  const samples = await buildSamples(dataDir);
  const baseUp = samples.filter((s) => s.realized === "UP").length / samples.length;
  const baseDown = samples.filter((s) => s.realized === "DOWN").length / samples.length;
  console.log(`Samples: ${samples.length} pair-days (${PAIRS.length} pairs, last ~${REPLAY_DAYS} trading days each)`);
  console.log(`Realized next-session base rates: UP ${f(baseUp)}  DOWN ${f(baseDown)}  FLAT ${f(1 - baseUp - baseDown)}`);

  console.log("\nStrength of directional calls (classical strategies):");
  for (const s of strengthDistribution(samples)) {
    console.log(`  ${s.strategyId.padEnd(9)} n=${s.n}  p25=${f(s.p25)} p50=${f(s.p50)} p75=${f(s.p75)} p90=${f(s.p90)} max=${f(s.max)}`);
  }

  console.log("\nPattern matcher strength = shrink(raw dominant-direction share, n analogues) (analytic):");
  for (const n of [30, 60, 100, 200]) {
    console.log(`  n=${String(n).padEnd(3)} ` + [0.5, 0.55, 0.6, 0.65, 0.7, 0.8].map((raw) => `raw ${raw}->${f(patternStrength(n, raw), 2)}`).join("  "));
  }

  console.log("\nThreshold sweep (classical strategies only; weights 1/1/1/1):");
  console.log("  conflict align | ALIGNED_UP ALIGNED_DOWN NEUTRAL CONFLICT | conflict% aligned-hit%");
  for (const r of sweep(samples, [0.3, 0.4, 0.5, 0.6], [0.2, 0.3, 0.4])) {
    const hit = r.alignedHitRate === null ? "  n/a" : `${f(r.alignedHitRate * 100, 1)}%`;
    console.log(
      `  ${f(r.conflictThreshold, 2)}     ${f(r.alignmentThreshold, 2)}  | ` +
        `${String(r.counts.ALIGNED_UP).padStart(9)} ${String(r.counts.ALIGNED_DOWN).padStart(12)} ${String(r.counts.NEUTRAL).padStart(7)} ${String(r.counts.CONFLICT_FLAT).padStart(8)} | ` +
        `${f(r.conflictRate * 100, 1).padStart(6)}%  ${hit} (n=${r.alignedCalls})`,
    );
  }
}

function invokedDirectly(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && fileURLToPath(import.meta.url) === entry;
}

if (invokedDirectly()) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
