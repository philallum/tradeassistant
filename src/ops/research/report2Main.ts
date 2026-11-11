// Operator entry for Evidence Report 2 (setup families + encoding variants). Local only; no hosted
// I/O; the locked holdout is never read.
// Usage:
//   npm run build && node dist/ops/research/report2Main.js [--dir data] [--out docs/research/EVIDENCE-REPORT-2.md]
//     [--cache-dir /tmp/research-cache] [--append-log <docsDir>]
// The cache holds exploration rows only; delete the directory to force a rebuild (about 4 minutes
// for the base rows plus about 4 minutes per variant).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { FsDocStore } from "../../living-docs/fsDocStore.js";
import { LivingDocs } from "../../living-docs/livingDocs.js";
import { collectDayRecords } from "../local-eval/dayRecords.js";
import { buildLocalEvalStores } from "../local-eval/localStores.js";
import { XTB_STANDARD_MODEL } from "./costModel.js";
import { buildVariantStores, VARIANT_RETRIEVAL, VARIANTS } from "./encodingVariants.js";
import { studyFamilies } from "./familyStudy.js";
import { buildResearchRows, type ResearchRow } from "./researchDataset.js";
import { assertExplorationWindow, assertNoHoldoutRows, RESEARCH_EXPLORATION_WINDOW } from "./researchProtocol.js";
import { renderReport2 } from "./report2.js";
import { rowsFromRecords, rowsFromResearch, studyVariants, type VariantLabel, type VariantRow } from "./variantStudy.js";

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
  let out = join(root, "docs", "research", "EVIDENCE-REPORT-2.md");
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
  const window = assertExplorationWindow(RESEARCH_EXPLORATION_WINDOW);

  // --- Base rows (live pipeline) -------------------------------------------------------------
  const rowsFile = join(cacheDir, "rows.json");
  let rows = await readCache<ResearchRow[]>(rowsFile);
  if (rows === undefined) {
    rows = [...(await buildResearchRows({ dataDir: dir }))];
    await writeFile(rowsFile, JSON.stringify(rows), "utf8");
  }
  assertNoHoldoutRows(rows);
  log({ event: "report2.rows", rows: rows.length });

  const families = studyFamilies(rows);
  log({ event: "report2.families_done" });

  // --- Variants ------------------------------------------------------------------------------
  const rowsById: Partial<Record<VariantLabel, readonly VariantRow[]>> = { V0: rowsFromResearch(rows) };
  let base: Awaited<ReturnType<typeof buildLocalEvalStores>> | undefined;
  for (const spec of VARIANTS) {
    const file = join(cacheDir, `variant-${spec.id}.json`);
    let vr = await readCache<VariantRow[]>(file);
    if (vr === undefined) {
      base ??= await buildLocalEvalStores({ dataDir: dir, log: () => undefined });
      const stores = await buildVariantStores(base.stores, spec);
      const records = await collectDayRecords(stores, { window, retrieval: VARIANT_RETRIEVAL });
      vr = rowsFromRecords(records, XTB_STANDARD_MODEL);
      await writeFile(file, JSON.stringify(vr), "utf8");
    }
    assertNoHoldoutRows(vr);
    rowsById[spec.id] = vr;
    log({ event: "report2.variant_done", variant: spec.id, rows: vr.length });
  }

  const variants = studyVariants(rowsById);
  const variantRowCounts: Record<string, number> = {};
  for (const [id, r] of Object.entries(rowsById)) variantRowCounts[id] = (r).length;

  const report = renderReport2({
    generatedOn: new Date().toISOString().slice(0, 10),
    window,
    families,
    variants,
    variantRowCounts,
  });
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, report, "utf8");

  const sig = families.flatMap((f) => f.features).filter((f) => f.significant);
  const lines = [
    `Exploration window ${window.start}..${window.end}; locked holdout NOT read. Costs xtb-standard-v1. Full report: ${out.replace(`${root}/`, "")}.`,
    `Setup families: ${families.map((f) => `${f.family} scored=${f.scored} hit ${(f.hit * 100).toFixed(2)}% net ${f.netMean.toFixed(2)}`).join("; ")}.`,
    `Feature tests significant after Benjamini-Hochberg (20 tests): ${sig.length === 0 ? "none" : sig.map((f) => `${f.family}/${f.feature}`).join(", ")}.`,
    `Encoding variants promising (significant over control, uplift > 0, net lower bound > 0): ${variants.promising.length === 0 ? "none" : variants.promising.join(", ")}.`,
    "Note: evidence for human interpretation; no verdict is recorded and an unfavourable result is a valid outcome. Candidates are not findings until they hold on the locked holdout.",
  ];
  for (const l of lines) console.log(l);
  if (appendLog !== undefined) {
    const docs = new LivingDocs(new FsDocStore(appendLog));
    await docs.appendEdgeEvaluation("research evidence report 2 (setup families, chart features, encoding variants; xtb-standard-v1 costs)", lines);
  }
  log({ event: "report2.done", out });
}

const entry = process.argv[1];
if (entry !== undefined && (import.meta.url === `file://${entry}` || fileURLToPath(import.meta.url) === entry)) {
  main().catch((err: unknown) => {
    console.error(JSON.stringify({ event: "report2.error", message: err instanceof Error ? err.message : String(err) }));
    process.exitCode = 1;
  });
}
