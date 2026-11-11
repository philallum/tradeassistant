// Operator entry for Evidence Report 1. Local only; no hosted I/O; the locked holdout is never read.
// Usage:
//   npm run build && node dist/ops/research/researchMain.js [--dir data] [--hourly data/hourly]
//     [--out docs/research/EVIDENCE-REPORT-1.md] [--append-log <docsDir>]
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { FsDocStore } from "../../living-docs/fsDocStore.js";
import { LivingDocs } from "../../living-docs/livingDocs.js";
import { DISCOVERY_WINDOW } from "../../walk-forward/evidenceProtocol.js";
import { observeFourHour, summariseFourHour, type FourHourResult } from "./fourHourStudy.js";
import { buildResearchRows, type ResearchRow } from "./researchDataset.js";
import { assertNoHoldoutRows, RESEARCH_EXPLORATION_WINDOW } from "./researchProtocol.js";
import { candidateEdges, renderReport, type Reconciliation } from "./report.js";
import { studySubset } from "./studies.js";

/** Figures recorded in RESEARCH-LOG.md for the local evidence run over the existing discovery window. */
const RECORDED = { pairDays: 15095, directional: 8746, firing: 3796, directionalScored: 8739, modelRate: 0.501 } as const;

export function reconcile(rows: readonly ResearchRow[]): Reconciliation {
  const upTo = rows.filter((r) => r.date <= DISCOVERY_WINDOW.end);
  const directional = upTo.filter((r) => r.direction !== "FLAT");
  const scored = directional.filter((r) => r.hit !== null);
  return {
    window: DISCOVERY_WINDOW,
    pairDays: upTo.length,
    directional: directional.length,
    firing: upTo.filter((r) => r.fires && r.direction !== "FLAT").length,
    directionalScored: scored.length,
    modelRate: scored.length === 0 ? 0 : scored.filter((r) => r.hit === true).length / scored.length,
    recorded: RECORDED,
  };
}

async function main(): Promise<void> {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  let dir = join(root, "data");
  let hourly = join(root, "data", "hourly");
  let out = join(root, "docs", "research", "EVIDENCE-REPORT-1.md");
  let appendLog: string | undefined;
  let rowsCache: string | undefined;
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--dir") dir = resolve(argv[++i] ?? dir);
    else if (argv[i] === "--hourly") hourly = resolve(argv[++i] ?? hourly);
    else if (argv[i] === "--out") out = resolve(argv[++i] ?? out);
    else if (argv[i] === "--append-log") appendLog = resolve(argv[++i] ?? ".");
    else if (argv[i] === "--rows-cache") rowsCache = resolve(argv[++i] ?? "research-rows.json");
    else throw new Error(`unknown argument: ${argv[i]}`);
  }

  const started = Date.now();
  // Optional cache of the (slow, ~4 minute) dataset build. The cache holds exploration rows only,
  // and is re-checked against the holdout guard on load.
  let loaded: readonly ResearchRow[] | undefined;
  if (rowsCache !== undefined) {
    try {
      loaded = JSON.parse(await readFile(rowsCache, "utf8")) as ResearchRow[];
      console.error(JSON.stringify({ event: "research.rows_cache_hit", rows: loaded.length }));
    } catch {
      loaded = undefined;
    }
  }
  const rows = assertNoHoldoutRows(
    loaded ??
      (await buildResearchRows({
        dataDir: dir,
        onProgress: (pair, done, total) => {
          if (done === total) console.error(JSON.stringify({ event: "research.pair_done", pair, days: total, seconds: Math.round((Date.now() - started) / 1000) }));
        },
      })),
  );
  if (rowsCache !== undefined && loaded === undefined) await writeFile(rowsCache, JSON.stringify(rows), "utf8");
  console.error(JSON.stringify({ event: "research.rows", rows: rows.length }));

  const reconciliation = reconcile(rows);
  const directional = studySubset(rows, "directional");
  const firing = studySubset(rows, "firing");

  const { observations, inRange, skipped } = await observeFourHour(rows, hourly);
  const fourHour: FourHourResult[] = [
    summariseFourHour(observations, "directional", inRange, skipped),
    summariseFourHour(observations, "firing", inRange, skipped),
  ];

  const report = renderReport({
    generatedOn: new Date().toISOString().slice(0, 10),
    window: RESEARCH_EXPLORATION_WINDOW,
    rows,
    reconciliation,
    directional,
    firing,
    fourHour,
  });
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, report, "utf8");

  const dEdges = candidateEdges(directional);
  const fEdges = candidateEdges(firing);
  const summaryLines = [
    `Exploration window ${RESEARCH_EXPLORATION_WINDOW.start}..${RESEARCH_EXPLORATION_WINDOW.end}; locked holdout NOT read. Full report: ${out.replace(`${root}/`, "")}.`,
    `Directional: scored=${directional.overall.scored} model ${(directional.overall.modelHit * 100).toFixed(2)}% vs weekly-trend ${(directional.overall.baselineHit * 100).toFixed(2)}% (uplift ${(directional.overall.delta * 100).toFixed(2)}pp), net ${directional.overall.netMean.toFixed(2)} pips/trade after xtb-standard-v1 costs.`,
    `Firing: scored=${firing.overall.scored} model ${(firing.overall.modelHit * 100).toFixed(2)}% vs weekly-trend ${(firing.overall.baselineHit * 100).toFixed(2)}% (uplift ${(firing.overall.delta * 100).toFixed(2)}pp), net ${firing.overall.netMean.toFixed(2)} pips/trade after xtb-standard-v1 costs.`,
    `Cells examined in the pre-registered family: directional ${directional.cellsInFamily}, firing ${firing.cellsInFamily}. Candidate edges passing every bar (BH-significant, net > 0 with lower bound > 0, stable): directional ${dEdges.length}, firing ${fEdges.length}.`,
    "Note: evidence for human interpretation; no verdict is recorded and an unfavourable result is a valid outcome. Candidates are not findings until they hold on the locked holdout.",
  ];
  for (const l of summaryLines) console.log(l);

  if (appendLog !== undefined) {
    const docs = new LivingDocs(new FsDocStore(appendLog));
    await docs.appendEdgeEvaluation(
      `research evidence report 1 (conditional performance, exploration ${RESEARCH_EXPLORATION_WINDOW.start}..${RESEARCH_EXPLORATION_WINDOW.end})`,
      summaryLines,
    );
  }
  console.error(JSON.stringify({ event: "research.done", seconds: Math.round((Date.now() - started) / 1000), out }));
}

const entry = process.argv[1];
if (entry !== undefined && (import.meta.url === `file://${entry}` || fileURLToPath(import.meta.url) === entry)) {
  main().catch((err: unknown) => {
    console.error(JSON.stringify({ event: "research.error", message: err instanceof Error ? err.message : String(err) }));
    process.exitCode = 1;
  });
}
