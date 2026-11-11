// Operator entry for Evidence Report 5 (volatility and structure context). Local only; no hosted
// I/O; the locked holdout is never read.
// Usage:
//   npm run build && node dist/ops/research/report5Main.js [--dir data]
//     [--out docs/research/EVIDENCE-REPORT-5.md] [--cache-dir /tmp/research-cache] [--append-log <docsDir>]
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PAIRS, type Pair } from "../../ingestion/types.js";
import { FsDocStore } from "../../living-docs/fsDocStore.js";
import { LivingDocs } from "../../living-docs/livingDocs.js";
import { pipSize } from "../../trade-sim/pip.js";
import { buildLocalEvalStores } from "../local-eval/localStores.js";
import { buildContextRows, buildContextTable, studyContext, type ContextTest, type PairContextTable } from "./contextStudy.js";
import { buildResearchRows, type ResearchRow } from "./researchDataset.js";
import { assertNoHoldoutRows, BOOTSTRAP_ITERATIONS, FDR_Q, RESEARCH_EXPLORATION_WINDOW, RESEARCH_HOLDOUT } from "./researchProtocol.js";

const f3 = (x: number): string => (Number.isFinite(x) ? x.toFixed(3) : "n/a");
const q = (x: number): string => (x < 0.001 ? "<0.001" : x.toFixed(3));

function testRow(t: ContextTest): string {
  const signOk = t.expected === "+" ? t.estimate > 0 : t.estimate < 0;
  const flag = t.usable ? "**USABLE**" : t.significant ? (signOk ? "significant; fails practical or stability bar" : "significant, OPPOSITE sign") : "-";
  return `| ${t.id} | ${t.description} | ${t.expected} | ${t.n} | ${f3(t.estimate)} [${f3(t.ci95.lo)}, ${f3(t.ci95.hi)}] | ${q(t.p)} | ${q(t.qValue)} | ${t.practical.label}: ${f3(t.practical.value)} (${t.practical.met ? "meets" : "below"} threshold) | ${t.yearsSame}/${t.yearsTotal} | ${t.pairsSame}/${t.pairsTotal} | ${flag} |`;
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
  let out = join(root, "docs", "research", "EVIDENCE-REPORT-5.md");
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
  const tables = new Map<Pair, PairContextTable>();
  for (const pair of PAIRS) tables.set(pair, buildContextTable(await base.stores.candleStore.getCandles(pair)));
  const ctx = buildContextRows(rows, tables, pipSize);
  const study = studyContext(ctx);

  const usable = study.tests.filter((t) => t.usable);
  const terc = study.tests
    .filter((t) => t.terciles.length > 0)
    .map(
      (t) =>
        `**${t.id}** (${t.description}):\n\n| Predictor tercile | Rows | Mean outcome |\n|---|---|---|\n${t.terciles.map((r) => `| ${r.label} | ${r.n} | ${f3(r.mean)} |`).join("\n")}`,
    )
    .join("\n\n");

  const report = `# Evidence Report 5: volatility and structure context

Generated ${new Date().toISOString().slice(0, 10)}. Exploration window ${RESEARCH_EXPLORATION_WINDOW.start}..${RESEARCH_EXPLORATION_WINDOW.end}; every outcome window closes inside it. The locked holdout ${RESEARCH_HOLDOUT.start}..${RESEARCH_HOLDOUT.end} was NOT read. No verdict is recorded. Nothing here changes the live system. Design: docs/research/PRE-REGISTRATION-5.md (written before any result).

## How to read this

- Predictors use candles strictly before the decision-date candle (the last candle known when the job runs). Outcomes use the five sessions after the decision date.
- **V1/V2 outcome:** ln(mean daily high-low over the next 5 sessions / ATR14); terciles show exp of the mean, i.e. the typical next-week range as a multiple of ATR14. **S outcome:** 5-session efficiency ratio (net move / path; 1 = straight line, near 0 = chop). **E1:** next-session range / ATR14 on FOMC / US jobs report sessions vs others (2021 onward). **Q1:** quantile (pinball, 0.75) loss of two stop rules in ATR units; positive = the ATR-scaled rule is better.
- One Benjamini-Hochberg family of 6 tests (q = ${FDR_Q}); month-block bootstrap (${BOOTSTRAP_ITERATIONS} resamples). **Usable** = significant in the expected direction, meets the pre-registered practical threshold, and same sign in at least 60% of years and pairs.

## Summary

Usable for the dashboard: ${usable.length === 0 ? "none" : usable.map((t) => `${t.id} (${t.practical.label} ${f3(t.practical.value)})`).join("; ")}.

## Tests

| Id | Test | Expected | n | Estimate [95% CI] | p | BH q | Practical size | Years same sign | Pairs same sign | Flag |
|---|---|---|---|---|---|---|---|---|---|---|
${study.tests.map(testRow).join("\n")}

## Terciles (for dashboard wording)

${terc}

## Event split (next-session range / ATR14, 2021 onward)

| Session | Rows | Mean range / ATR14 |
|---|---|---|
${study.eventSplit.map((e) => `| ${e.kind === "none" ? "ordinary" : e.kind} | ${e.n} | ${f3(e.meanRatio)} |`).join("\n")}

## Confluence status vs follow-through (mean 5-session efficiency ratio)

| Status | Rows | Mean ER5 |
|---|---|---|
${study.statusTable.map((s) => `| ${s.status} | ${s.n} | ${f3(s.meanEr5)} |`).join("\n")}

## Stop rules on directional days with an analogue stop (ATR units; target coverage 75%)

| Predictor | Rows | Coverage (share of sessions whose adverse move stayed inside) | Mean pinball loss | Mean stop distance (x ATR14) |
|---|---|---|---|---|
${study.stopTable.map((s) => `| ${s.predictor} | ${s.n} | ${(s.coverage * 100).toFixed(1)}% | ${f3(s.meanLoss)} | ${f3(s.meanStopAtr)} |`).join("\n")}

## Caveats

- Outcomes start one session after the one a trader acting on the card would trade; volatility forecasts one session closer would be slightly stronger, not weaker.
- The confluence status here is the offline engine (four rule strategies plus the pattern call, no third party).
- The event calendar covers FOMC decisions and US jobs reports from 2021; other events are not included.
- Usable means "a measured fact that can be shown with its number"; none of these is a directional edge.
`;
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, report, "utf8");

  const lines = [
    `Exploration window ${RESEARCH_EXPLORATION_WINDOW.start}..${RESEARCH_EXPLORATION_WINDOW.end}; locked holdout NOT read. Full report: ${out.replace(`${root}/`, "")}.`,
    `Tests (BH family of 6): ${study.tests.map((t) => `${t.id} est ${f3(t.estimate)} q ${q(t.qValue)} practical ${f3(t.practical.value)}${t.usable ? " USABLE" : ""}`).join("; ")}.`,
    `Stop rules (coverage, mean stop xATR): ${study.stopTable.map((s) => `${s.predictor.slice(0, 3)} ${(s.coverage * 100).toFixed(1)}% ${f3(s.meanStopAtr)}`).join("; ")}.`,
    "Note: evidence for human interpretation; no verdict is recorded. Usable statements are measured context, not a directional edge.",
  ];
  for (const l of lines) console.log(l);
  if (appendLog !== undefined) {
    await new LivingDocs(new FsDocStore(appendLog)).appendEdgeEvaluation("research evidence report 5 (volatility and structure context)", lines);
  }
}

const entry = process.argv[1];
if (entry !== undefined && (import.meta.url === `file://${entry}` || fileURLToPath(import.meta.url) === entry)) {
  main().catch((err: unknown) => {
    console.error(JSON.stringify({ event: "report5.error", message: err instanceof Error ? err.message : String(err) }));
    process.exitCode = 1;
  });
}
