// Operator entry for Evidence Report 4 (the four rule strategies on H1 / H3 / H5 / BR). Local only;
// no hosted I/O; the locked holdout is never read.
// Usage:
//   npm run build && node dist/ops/research/report4Main.js [--dir data]
//     [--out docs/research/EVIDENCE-REPORT-4.md] [--cache-dir /tmp/research-cache] [--append-log <docsDir>]
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PAIRS, type Pair } from "../../ingestion/types.js";
import { FsDocStore } from "../../living-docs/fsDocStore.js";
import { LivingDocs } from "../../living-docs/livingDocs.js";
import { totalCostPips } from "../../trade-sim/executionModel.js";
import { pipSize } from "../../trade-sim/pip.js";
import { buildLocalEvalStores } from "../local-eval/localStores.js";
import { XTB_STANDARD_MODEL } from "./costModel.js";
import { buildOutcomeTable, OUTCOMES, type OutcomeId, type PairOutcomeTable } from "./horizonOutcomes.js";
import { buildResearchRows, RULE_STRATEGIES, type ResearchRow, type RuleStrategyId } from "./researchDataset.js";
import { assertNoHoldoutRows, BOOTSTRAP_ITERATIONS, FDR_Q, RESEARCH_EXPLORATION_WINDOW, RESEARCH_HOLDOUT } from "./researchProtocol.js";
import { strategyTrades, studyStrategyHorizons, type StrategyCell, type StrategyTrade } from "./strategyHorizonStudy.js";

const pct = (x: number): string => `${(x * 100).toFixed(2)}%`;
const pp = (x: number): string => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(2)}pp`;
const pips = (x: number): string => `${x >= 0 ? "+" : ""}${x.toFixed(2)}`;
const q = (x: number | null): string => (x === null ? "ref" : x < 0.001 ? "<0.001" : x.toFixed(3));

function row(c: StrategyCell): string {
  const flags = [
    c.scored < 200 ? "exploratory (n<200)" : "",
    c.significant ? `excess q<=0.10 (${c.excess > 0 ? "skill" : "ANTI-skill"})` : "",
    c.promising ? "**PROMISING**" : "",
  ]
    .filter((s) => s.length > 0)
    .join("; ");
  return `| ${c.strategy} | ${c.outcome} | ${c.trades} | ${c.scored} | ${pct(c.hit)} [${pct(c.hitCi.lo)}, ${pct(c.hitCi.hi)}] | ${pct(c.expected)} | ${pp(c.excess)} [${pp(c.excessCi.lo)}, ${pp(c.excessCi.hi)}] | ${q(c.excessQ)} | ${pp(c.uplift)} | ${pips(c.netMean)} [${pips(c.netCi.lo)}, ${pips(c.netCi.hi)}] | ${pct(c.upCallShare)} / ${pct(c.upOutcomeShare)} | ${c.yearsPositive}/${c.yearsTotal} | ${c.pairsPositive}/${c.pairsTotal} | ${flags.length === 0 ? "-" : flags} |`;
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
  let out = join(root, "docs", "research", "EVIDENCE-REPORT-4.md");
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

  const rowsFile = join(cacheDir, "rows.json");
  let rows = await readCache<ResearchRow[]>(rowsFile);
  if (rows === undefined) {
    rows = [...(await buildResearchRows({ dataDir: dir }))];
    await writeFile(rowsFile, JSON.stringify(rows), "utf8");
  }
  assertNoHoldoutRows(rows);

  const base = await buildLocalEvalStores({ dataDir: dir, log: () => undefined });
  const tables = new Map<Pair, PairOutcomeTable>();
  for (const pair of PAIRS) tables.set(pair, buildOutcomeTable(await base.stores.candleStore.getCandles(pair), pipSize(pair)));

  const trades = {} as Record<RuleStrategyId, Record<OutcomeId, StrategyTrade[]>>;
  for (const s of RULE_STRATEGIES) {
    trades[s] = {} as Record<OutcomeId, StrategyTrade[]>;
    for (const o of OUTCOMES) trades[s][o] = strategyTrades(rows, tables, s, o, XTB_STANDARD_MODEL);
  }
  const study = studyStrategyHorizons(trades);
  const costs = PAIRS.map((p) => `${p} ${totalCostPips(XTB_STANDARD_MODEL, p).toFixed(1)}`).join(", ");
  const sig = study.cells.filter((c) => c.significant);
  const head =
    "| Strategy | Outcome | Trades | Scored | Hit [95% CI] | Expected from long/short mix | Excess [95% CI] | BH q (12) | Uplift vs weekly trend | Net pips/trade [95% CI] | UP calls / UP outcomes | Years + | Pairs + | Flags |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|";

  const report = `# Evidence Report 4: the four rule strategies held 3 and 5 sessions, and with a bracket

Generated ${new Date().toISOString().slice(0, 10)}. Exploration window ${RESEARCH_EXPLORATION_WINDOW.start}..${RESEARCH_EXPLORATION_WINDOW.end}; every outcome window closes inside it. The locked holdout ${RESEARCH_HOLDOUT.start}..${RESEARCH_HOLDOUT.end} was NOT read. No verdict is recorded; an unfavourable result is a valid outcome. Nothing here changes the live system. Design: docs/research/PRE-REGISTRATION-4.md (written before any result).

## How to read this

- **Trade:** any day the strategy (live default configuration) says UP or DOWN; entry at the next session's open. Outcomes as in Report 3: H1 next session (reference), H3 / H5 hold 3 / 5 sessions, BR 1 x ATR target and stop within 5 sessions (ambiguous = loss).
- **Expected from long/short mix:** the hit rate a call with no timing skill would get, given how often the strategy was long and how often the market went up on those same days. **Excess** = hit minus that. This is the pre-registered test (family of 12, BH at q = ${FDR_Q}), because a strategy can beat 50% just by leaning with a trend.
- **Costs:** xtb-standard-v1 (${costs} pips per trade); swap not modelled. Signals on consecutive days give overlapping trades; intervals use month blocks (${BOOTSTRAP_ITERATIONS} resamples).

## Summary

- Significant excess (family of 12): ${sig.length === 0 ? "none" : sig.map((c) => `${c.strategy}/${c.outcome} ${pp(c.excess)}`).join(", ")}.
- Promising (significant positive excess, net lower bound above zero, positive in at least 60% of years and pairs): ${study.promising.length === 0 ? "none" : study.promising.map((c) => `${c.strategy}/${c.outcome}`).join(", ")}.

## Results

${head}
${study.cells.map(row).join("\n")}

## Caveats

- Range and reversal signal rarely, so only large effects are detectable for them.
- The strategies are tested with their live settings and fixed exits; nothing was tuned.
- Swap is not modelled; over 3 to 5 sessions it can add or subtract a little.
- Overlapping trades mean the per-trade numbers are a per-signal edge, not a portfolio return.
`;
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, report, "utf8");

  const lines = [
    `Exploration window ${RESEARCH_EXPLORATION_WINDOW.start}..${RESEARCH_EXPLORATION_WINDOW.end} (every outcome window closes inside it); locked holdout NOT read. Costs xtb-standard-v1, swap not modelled. Full report: ${out.replace(`${root}/`, "")}.`,
    `Excess hit over long/short-mix expectation (H3/H5/BR): ${study.cells.filter((c) => c.excessQ !== null).map((c) => `${c.strategy}/${c.outcome} ${pp(c.excess)} net ${c.netMean.toFixed(2)}`).join("; ")}.`,
    `Significant (BH, 12 tests): ${sig.map((c) => `${c.strategy}/${c.outcome}`).join(", ") || "none"}; promising: ${study.promising.map((c) => `${c.strategy}/${c.outcome}`).join(", ") || "none"}.`,
    "Note: evidence for human interpretation; no verdict is recorded and an unfavourable result is a valid outcome. Candidates are not findings until they hold on the locked holdout.",
  ];
  for (const l of lines) console.log(l);
  if (appendLog !== undefined) {
    await new LivingDocs(new FsDocStore(appendLog)).appendEdgeEvaluation(
      "research evidence report 4 (rule strategies on 3/5-session and bracket outcomes; xtb-standard-v1 costs)",
      lines,
    );
  }
}

const entry = process.argv[1];
if (entry !== undefined && (import.meta.url === `file://${entry}` || fileURLToPath(import.meta.url) === entry)) {
  main().catch((err: unknown) => {
    console.error(JSON.stringify({ event: "report4.error", message: err instanceof Error ? err.message : String(err) }));
    process.exitCode = 1;
  });
}
