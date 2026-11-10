// Operator entry: hourly-resolved trade simulation over the locally archived hourly bars.
// Local only; no hosted I/O. Run `hourly-backfill` first.
// Usage: EDGE_EVAL_DOCS_DIR=. node dist/ops/local-eval/hourlySimMain.js [--dir data] [--hourly-dir data/hourly]
//        [--start 2021-01-01 --end 2024-12-31]
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { FileHourlyBarStore } from "../../hourly-store/fileHourlyStore.js";
import { PAIRS, type Pair } from "../../ingestion/types.js";
import { FsDocStore } from "../../living-docs/fsDocStore.js";
import { LivingDocs } from "../../living-docs/livingDocs.js";
import { CONFIRMATION_HOLDOUT } from "../../walk-forward/evidenceProtocol.js";
import { collectDayRecords } from "./dayRecords.js";
import { renderHourlySimLines, runHourlySim } from "./hourlySim.js";
import { buildLocalEvalStores } from "./localStores.js";

async function main(): Promise<void> {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  let dir = join(root, "data");
  let hourlyDir = join(root, "data", "hourly");
  let start = "2021-01-01";
  let end = "2024-12-31";
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--dir") dir = argv[++i] ?? dir;
    else if (argv[i] === "--hourly-dir") hourlyDir = argv[++i] ?? hourlyDir;
    else if (argv[i] === "--start") start = argv[++i] ?? start;
    else if (argv[i] === "--end") end = argv[++i] ?? end;
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  if (end >= CONFIRMATION_HOLDOUT.start) throw new Error("hourly-sim: the window must not overlap the confirmation holdout");

  const built = await buildLocalEvalStores({ dataDir: dir, log: () => undefined });
  const records = await collectDayRecords(built.stores, { window: { start, end } });
  const hourly = new FileHourlyBarStore(hourlyDir);
  const candlesByPair = new Map<Pair, Awaited<ReturnType<typeof built.stores.candleStore.getCandles>>>();
  const barsByPair = new Map<Pair, Awaited<ReturnType<typeof hourly.getRange>>>();
  for (const pair of PAIRS) {
    candlesByPair.set(pair, await built.stores.candleStore.getCandles(pair));
    barsByPair.set(pair, await hourly.getRange(pair, 0, Number.MAX_SAFE_INTEGER));
  }
  const report = runHourlySim({ records, candlesByPair, barsByPair });
  const lines = renderHourlySimLines(report, { start, end });
  for (const l of lines) console.log(l);
  const configured = process.env.EDGE_EVAL_DOCS_DIR;
  const docs = new LivingDocs(new FsDocStore(configured !== undefined && configured.length > 0 ? configured : tmpdir()));
  await docs.appendEdgeEvaluation("hourly-resolved trade simulation vs close-out expectancy", lines);
}

const entry = process.argv[1];
if (entry !== undefined && (import.meta.url === `file://${entry}` || fileURLToPath(import.meta.url) === entry)) {
  main().catch((err: unknown) => {
    console.error(JSON.stringify({ event: "hourly_sim.error", message: err instanceof Error ? err.message : String(err) }));
    process.exitCode = 1;
  });
}
