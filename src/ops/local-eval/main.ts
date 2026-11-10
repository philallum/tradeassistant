// Local edge-evaluation runner (offline).
//
// Builds in-memory stores from the seed CSVs (`buildLocalEvalStores`) and runs the unchanged
// `runEdgeEval` against them. Nothing is read from or written to the hosted project, so the
// hosted heavy-operation guard is never involved and the egress quota is untouched. The
// measurement note is appended to RESEARCH-LOG.md under `EDGE_EVAL_DOCS_DIR` (default: the OS
// temp dir, so a bare run never edits the repo log; set it to the repo root to record).
//
// Usage: EDGE_EVAL_DOCS_DIR=. node dist/ops/local-eval/main.js [--dir data]
// SECRET-FREE: no credential is read; the synthetic config below carries no key.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { TradingDate } from "../../guard/types.js";
import type { ScheduledRunConfig } from "../../scheduled-run/config.js";
import { InMemoryTradeLedgerStore } from "../../trade-ledger/types.js";
import { InMemoryFrozenBaselineStore } from "../../walk-forward/frozenBaselineStore.js";
import { runEdgeEval, type EdgeEvalDeps, type EdgeEvalResult } from "../edge-eval/main.js";
import { buildLocalEvalStores } from "./localStores.js";

/** A config that targets nothing: `local` target, no credential, never used for I/O here. */
function syntheticConfig(decisionDate: TradingDate): ScheduledRunConfig {
  return {
    decisionDate,
    supabase: { target: "local", url: "http://127.0.0.1:0", key: "not-used" },
    gcpProject: undefined,
    gcpRegion: undefined,
    geminiModel: undefined,
    dashboardSnapshotBucket: undefined,
  };
}

export interface LocalEdgeEvalOptions {
  readonly dataDir: string;
  /** Extra edge-eval dependencies (windows, docs, regenerator ...); stores are fixed here. */
  readonly edgeEval?: Omit<EdgeEvalDeps, "config" | "stores" | "tradeLedgerStore" | "frozenBaselineStore">;
  readonly log?: (event: object) => void;
}

export async function runLocalEdgeEval(options: LocalEdgeEvalOptions): Promise<EdgeEvalResult> {
  const built = await buildLocalEvalStores({
    dataDir: options.dataDir,
    ...(options.log !== undefined ? { log: options.log } : {}),
  });
  return runEdgeEval({
    ...(options.edgeEval ?? {}),
    config: syntheticConfig(built.evalDate),
    stores: built.stores,
    tradeLedgerStore: new InMemoryTradeLedgerStore(),
    frozenBaselineStore: new InMemoryFrozenBaselineStore(),
  });
}

function defaultDataDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "data");
}

export function parseArgs(argv: readonly string[]): { dataDir: string } {
  let dataDir = defaultDataDir();
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--dir") dataDir = argv[++i] ?? dataDir;
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  return { dataDir };
}

function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  return import.meta.url === `file://${entry}` || fileURLToPath(import.meta.url) === entry;
}

if (invokedDirectly()) {
  runLocalEdgeEval(parseArgs(process.argv.slice(2)))
    .then((r) => {
      if (!r.completed) process.exitCode = 1;
    })
    .catch((err: unknown) => {
      console.error(JSON.stringify({ event: "local_eval.error", message: err instanceof Error ? err.message : String(err) }));
      process.exitCode = 1;
    });
}
