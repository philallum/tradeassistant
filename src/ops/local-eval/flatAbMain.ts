// Operator entry for the offline FLAT / label-alignment A/B (Task 5). Local only; no hosted I/O.
// Usage: EDGE_EVAL_DOCS_DIR=. node dist/ops/local-eval/flatAbMain.js [--dir data] [--start 2024-01-02 --end 2024-12-31]
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { FsDocStore } from "../../living-docs/fsDocStore.js";
import { LivingDocs } from "../../living-docs/livingDocs.js";
import { renderFlatAbLines, runFlatAb } from "./flatAb.js";

function parse(argv: readonly string[]): { dir: string; start: string; end: string } {
  let dir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "data");
  let start = "2024-01-02";
  let end = "2024-12-31";
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--dir") dir = argv[++i] ?? dir;
    else if (argv[i] === "--start") start = argv[++i] ?? start;
    else if (argv[i] === "--end") end = argv[++i] ?? end;
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  return { dir, start, end };
}

async function main(): Promise<void> {
  const a = parse(process.argv.slice(2));
  const window = { start: a.start, end: a.end };
  const results = await runFlatAb({ dataDir: a.dir, window });
  const lines = renderFlatAbLines(results, window);
  for (const l of lines) console.log(l);
  const configured = process.env.EDGE_EVAL_DOCS_DIR;
  const docs = new LivingDocs(new FsDocStore(configured !== undefined && configured.length > 0 ? configured : tmpdir()));
  await docs.appendEdgeEvaluation(`FLAT definition and label-alignment A/B ${window.start}..${window.end}`, lines);
}

const entry = process.argv[1];
if (entry !== undefined && (import.meta.url === `file://${entry}` || fileURLToPath(import.meta.url) === entry)) {
  main().catch((err: unknown) => {
    console.error(JSON.stringify({ event: "flat_ab.error", message: err instanceof Error ? err.message : String(err) }));
    process.exitCode = 1;
  });
}
