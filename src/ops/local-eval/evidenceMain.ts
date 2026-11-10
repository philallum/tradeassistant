// Operator entry for the local evidence run. Local only; no hosted I/O.
// Usage: EDGE_EVAL_DOCS_DIR=. node dist/ops/local-eval/evidenceMain.js [--dir data] [--confirm-holdout]
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { FsDocStore } from "../../living-docs/fsDocStore.js";
import { LivingDocs } from "../../living-docs/livingDocs.js";
import { DISCOVERY_WINDOW } from "../../walk-forward/evidenceProtocol.js";
import { runEvidence } from "./evidenceRun.js";

async function main(): Promise<void> {
  let dir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "data");
  let confirmHoldout = false;
  let start: string | undefined;
  let end: string | undefined;
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--dir") dir = argv[++i] ?? dir;
    else if (argv[i] === "--confirm-holdout") confirmHoldout = true;
    else if (argv[i] === "--start") start = argv[++i];
    else if (argv[i] === "--end") end = argv[++i];
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  const base = DISCOVERY_WINDOW;
  const discovery = { start: start ?? base.start, end: end ?? base.end };
  if (discovery.end > base.end) throw new Error(`--end must not pass the discovery window end ${base.end}`);
  const result = await runEvidence({ dataDir: dir, confirmHoldout, discovery });
  for (const l of result.lines) console.log(l);
  const configured = process.env.EDGE_EVAL_DOCS_DIR;
  const docs = new LivingDocs(new FsDocStore(configured !== undefined && configured.length > 0 ? configured : tmpdir()));
  await docs.appendEdgeEvaluation(
    `local evidence run ${discovery.start}..${discovery.end} (baselines, net expectancy, pre-registered slices, event-day split)${confirmHoldout ? " + holdout confirmation" : ""}`,
    result.lines,
  );
}

const entry = process.argv[1];
if (entry !== undefined && (import.meta.url === `file://${entry}` || fileURLToPath(import.meta.url) === entry)) {
  main().catch((err: unknown) => {
    console.error(JSON.stringify({ event: "evidence_run.error", message: err instanceof Error ? err.message : String(err) }));
    process.exitCode = 1;
  });
}
