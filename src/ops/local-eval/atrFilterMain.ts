// Operator entry for the offline ATR post-filter experiment. Local only; no hosted I/O.
// Usage: EDGE_EVAL_DOCS_DIR=. node dist/ops/local-eval/atrFilterMain.js [--dir data]
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { FsDocStore } from "../../living-docs/fsDocStore.js";
import { LivingDocs } from "../../living-docs/livingDocs.js";
import { DISCOVERY_WINDOW } from "../../walk-forward/evidenceProtocol.js";
import { renderAtrLines, runAtrFilterExperiment } from "./atrFilterExperiment.js";

async function main(): Promise<void> {
  let dir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "data");
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--dir") dir = argv[++i] ?? dir;
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  const results = await runAtrFilterExperiment({ dataDir: dir });
  const lines = renderAtrLines(results, DISCOVERY_WINDOW);
  for (const l of lines) console.log(l);
  const configured = process.env.EDGE_EVAL_DOCS_DIR;
  const docs = new LivingDocs(new FsDocStore(configured !== undefined && configured.length > 0 ? configured : tmpdir()));
  await docs.appendEdgeEvaluation("offline ATR post-filter experiment (regime-aware neighbours)", lines);
}

const entry = process.argv[1];
if (entry !== undefined && (import.meta.url === `file://${entry}` || fileURLToPath(import.meta.url) === entry)) {
  main().catch((err: unknown) => {
    console.error(JSON.stringify({ event: "atr_experiment.error", message: err instanceof Error ? err.message : String(err) }));
    process.exitCode = 1;
  });
}
