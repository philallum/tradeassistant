// Operator entry for Evidence Report 3 (multi-day horizons and target-before-stop). Local only; no
// hosted I/O; the locked holdout is never read.
// Usage:
//   npm run build && node dist/ops/research/report3Main.js [--dir data]
//     [--out docs/research/EVIDENCE-REPORT-3.md] [--cache-dir /tmp/research-cache] [--append-log <docsDir>]
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PAIRS, type Pair } from "../../ingestion/types.js";
import { FsDocStore } from "../../living-docs/fsDocStore.js";
import { LivingDocs } from "../../living-docs/livingDocs.js";
import type { PipelineStores } from "../../pipeline/types.js";
import type { RetrievalConfig } from "../../retrieval/types.js";
import { pipSize } from "../../trade-sim/pip.js";
import { collectDayRecords } from "../local-eval/dayRecords.js";
import { buildLocalEvalStores } from "../local-eval/localStores.js";
import { XTB_STANDARD_MODEL } from "./costModel.js";
import { buildVariantStores, VARIANT_RETRIEVAL, VARIANTS } from "./encodingVariants.js";
import { atrByIndex, buildOutcomeTable, OUTCOMES, type OutcomeId, type PairOutcomeTable } from "./horizonOutcomes.js";
import { scoreOutcome, SOURCES, studyHorizons, type NeighbourRow, type ScoredRow, type SourceId } from "./horizonStudy.js";
import { renderReport3 } from "./report3.js";
import { assertExplorationWindow, assertNoHoldoutRows, RESEARCH_EXPLORATION_WINDOW } from "./researchProtocol.js";

async function collectNeighbours(stores: PipelineStores, retrieval: RetrievalConfig | undefined): Promise<NeighbourRow[]> {
  const window = assertExplorationWindow(RESEARCH_EXPLORATION_WINDOW);
  const seen = new Map<string, string[]>();
  const records = await collectDayRecords(stores, {
    window,
    ...(retrieval !== undefined ? { retrieval } : {}),
    neighbourhoodFilter: (nb, ctx) => {
      seen.set(`${ctx.pair}|${ctx.date}`, nb.map((a) => a.decisionDate));
      return nb;
    },
  });
  return records.map((r) => ({
    pair: r.pair,
    date: r.date,
    weeklyTrendSign: r.weeklyTrendSign,
    analogueDates: seen.get(`${r.pair}|${r.date}`) ?? [],
  }));
}

async function readCache<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return undefined;
  }
}

async function main(): Promise<void> {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  let dir = join(root, "data");
  let out = join(root, "docs", "research", "EVIDENCE-REPORT-3.md");
  let cacheDir = "/tmp/research-cache";
  let appendLog: string | undefined;
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--dir") dir = resolve(argv[++i] ?? dir);
    else if (argv[i] === "--out") out = resolve(argv[++i] ?? out);
    else if (argv[i] === "--cache-dir") cacheDir = resolve(argv[++i] ?? cacheDir);
    else if (argv[i] === "--append-log") appendLog = resolve(argv[++i] ?? ".");
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  await mkdir(cacheDir, { recursive: true });
  const started = Date.now();
  const log = (event: object): void => console.error(JSON.stringify({ ...event, seconds: Math.round((Date.now() - started) / 1000) }));

  const base = await buildLocalEvalStores({ dataDir: dir, log: () => undefined });
  const tables = new Map<Pair, PairOutcomeTable>();
  const medianAtrPips: Record<string, number> = {};
  for (const pair of PAIRS) {
    const candles = await base.stores.candleStore.getCandles(pair);
    tables.set(pair, buildOutcomeTable(candles, pipSize(pair)));
    const atr = atrByIndex(candles)
      .filter((x) => x > 0)
      .map((x) => x / pipSize(pair))
      .sort((a, b) => a - b);
    medianAtrPips[pair] = atr[Math.floor(atr.length / 2)] ?? 0;
  }

  const neighbours: Partial<Record<SourceId, NeighbourRow[]>> = {};
  for (const source of SOURCES) {
    const file = join(cacheDir, `neighbours-${source}.json`);
    let rows = await readCache<NeighbourRow[]>(file);
    if (rows === undefined) {
      if (source === "V0") rows = await collectNeighbours(base.stores, undefined);
      else {
        const spec = VARIANTS.find((v) => v.id === source);
        if (spec === undefined) throw new Error(`unknown source ${source}`);
        rows = await collectNeighbours(await buildVariantStores(base.stores, spec), VARIANT_RETRIEVAL);
      }
      await writeFile(file, JSON.stringify(rows), "utf8");
    }
    assertNoHoldoutRows(rows);
    neighbours[source] = rows;
    log({ event: "report3.neighbours", source, rows: rows.length });
  }

  const scored = {} as Record<SourceId, Record<OutcomeId, ScoredRow[]>>;
  for (const source of SOURCES) {
    scored[source] = {} as Record<OutcomeId, ScoredRow[]>;
    for (const o of OUTCOMES) scored[source][o] = scoreOutcome(neighbours[source] as NeighbourRow[], tables, o, XTB_STANDARD_MODEL);
  }
  const study = studyHorizons(scored);

  const bracketKinds: Record<string, number> = {};
  for (const r of scored.V0.BR) {
    if (r.direction === "FLAT") continue;
    const t = tables.get(r.pair) as PairOutcomeTable;
    const k = t.byOutcome.BR[t.indexByDate.get(r.date) as number]?.kind ?? "none";
    bracketKinds[k] = (bracketKinds[k] ?? 0) + 1;
  }

  await mkdir(dirname(out), { recursive: true });
  await writeFile(
    out,
    renderReport3({ generatedOn: new Date().toISOString().slice(0, 10), window: RESEARCH_EXPLORATION_WINDOW, study, bracketKinds, medianAtrPips }),
    "utf8",
  );

  const family = study.cells.filter((c) => c.subset === "directional" && c.upliftQ !== null);
  const fmt = (x: number): string => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(2)}pp`;
  const lines = [
    `Exploration window ${RESEARCH_EXPLORATION_WINDOW.start}..${RESEARCH_EXPLORATION_WINDOW.end} (every outcome window closes inside it); locked holdout NOT read. Costs xtb-standard-v1, swap not modelled. Full report: ${out.replace(`${root}/`, "")}.`,
    `Directional uplift over weekly trend (H3/H5/BR x V0/V0b/V1): ${family.map((c) => `${c.source}/${c.outcome} ${fmt(c.uplift)} net ${c.netMean.toFixed(2)}`).join("; ")}.`,
    `Family U significant: ${family.filter((c) => c.upliftSignificant).map((c) => `${c.source}/${c.outcome}`).join(", ") || "none"}; family C (confidence ranks) significant: ${family.filter((c) => c.confSignificant).map((c) => `${c.source}/${c.outcome}`).join(", ") || "none"}; promising: ${study.promising.map((c) => `${c.source}/${c.outcome}`).join(", ") || "none"}.`,
    "Note: evidence for human interpretation; no verdict is recorded and an unfavourable result is a valid outcome. Candidates are not findings until they hold on the locked holdout.",
  ];
  for (const l of lines) console.log(l);
  if (appendLog !== undefined) {
    const docs = new LivingDocs(new FsDocStore(appendLog));
    await docs.appendEdgeEvaluation("research evidence report 3 (multi-day horizons and target-before-stop; xtb-standard-v1 costs)", lines);
  }
  log({ event: "report3.done", out });
}

const entry = process.argv[1];
if (entry !== undefined && (import.meta.url === `file://${entry}` || fileURLToPath(import.meta.url) === entry)) {
  main().catch((err: unknown) => {
    console.error(JSON.stringify({ event: "report3.error", message: err instanceof Error ? err.message : String(err) }));
    process.exitCode = 1;
  });
}
