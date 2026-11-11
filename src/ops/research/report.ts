// Markdown rendering for Evidence Report 1 (pure; no I/O). No verdict language: an unfavourable
// result is a valid outcome and nothing here claims an edge.
import { totalCostPips } from "../../trade-sim/executionModel.js";
import { XTB_STANDARD_MODEL } from "./costModel.js";
import { PAIRS } from "../../ingestion/types.js";
import type { ProtocolWindow } from "../../walk-forward/evidenceProtocol.js";
import type { FourHourResult } from "./fourHourStudy.js";
import type { ResearchRow } from "./researchDataset.js";
import {
  BOOTSTRAP_ITERATIONS,
  FDR_Q,
  MIN_REPORTABLE_SCORED,
  RESEARCH_HOLDOUT,
  RESEARCH_HYPOTHESES,
} from "./researchProtocol.js";
import type { AgreeVsOpposeResult, Cell, CorrelationResult, StandaloneResult, SubsetStudy } from "./studies.js";

export interface Reconciliation {
  readonly window: ProtocolWindow;
  readonly pairDays: number;
  readonly directional: number;
  readonly firing: number;
  readonly directionalScored: number;
  readonly modelRate: number;
  readonly recorded: { readonly pairDays: number; readonly directional: number; readonly firing: number; readonly directionalScored: number; readonly modelRate: number };
}

export interface ReportInput {
  readonly generatedOn: string;
  readonly window: ProtocolWindow;
  readonly rows: readonly ResearchRow[];
  readonly reconciliation: Reconciliation;
  readonly directional: SubsetStudy;
  readonly firing: SubsetStudy;
  readonly fourHour: readonly FourHourResult[];
}

const pct = (x: number, d = 2): string => `${(x * 100).toFixed(d)}%`;
const pp = (x: number): string => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(2)}pp`;
const pips = (x: number): string => `${x >= 0 ? "+" : ""}${x.toFixed(2)}`;
const num = (x: number, d = 3): string => x.toFixed(d);
const q = (x: number | null): string => (x === null ? "n/a" : x < 0.001 ? "<0.001" : x.toFixed(3));

function cellRow(c: Cell, labelled: boolean): string {
  const flag = !c.reportable ? "exploratory (n<200)" : c.significant ? "**q<=0.10**" : "-";
  return `| ${labelled ? `${c.variable}: ` : ""}${c.label} | ${c.scored} | ${pct(c.modelHit)} | ${pct(c.baselineHit)} | ${pp(c.delta)} [${pp(c.deltaCi.lo)}, ${pp(c.deltaCi.hi)}] | ${q(c.qValue)} | ${pips(c.netMean)} [${pips(c.netCi.lo)}, ${pips(c.netCi.hi)}] | ${c.yearsPositive}/${c.yearsTotal} | ${c.pairsPositive}/${c.pairsTotal} | ${flag} |`;
}

const CELL_HEAD =
  "| Cell | Scored | Model hit | Weekly-trend hit | Uplift vs baseline [95% CI] | BH q | Net pips/trade [95% CI] | Years + | Pairs + | Flag |\n|---|---|---|---|---|---|---|---|---|---|";

function cellsTable(cells: readonly Cell[], labelled = false): string {
  return cells.length === 0 ? "_No cells._" : `${CELL_HEAD}\n${cells.map((c) => cellRow(c, labelled)).join("\n")}`;
}

function corrRow(c: CorrelationResult): string {
  const flag = c.matchesExpectation ? "**significant, as expected**" : c.significant ? "significant, UNEXPECTED sign" : "-";
  return `| ${c.hypothesis} | ${c.variable} | ${c.expectedSign} | ${c.n} | ${num(c.rho)} [${num(c.ci95.lo)}, ${num(c.ci95.hi)}] | ${q(c.p)} | ${q(c.qValue)} | ${flag} |`;
}

function corrTable(study: SubsetStudy): string {
  const rows = study.variables.flatMap((v) => (v.correlation === null ? [] : [v.correlation]));
  return `| Hyp | Variable | Expected | n | Spearman rho vs hit [95% CI] | p | BH q | Result |\n|---|---|---|---|---|---|---|---|\n${rows.map(corrRow).join("\n")}`;
}

function standaloneTable(items: readonly StandaloneResult[]): string {
  const head = "| Signal | Scored | Hit rate [95% CI] | BH q (vs 50%) | Agrees with pattern when both call | Both-call days | Flag |\n|---|---|---|---|---|---|---|";
  const body = items
    .map(
      (s) =>
        `| ${s.id} | ${s.scored} | ${pct(s.hit)} [${pct(s.ci95.lo)}, ${pct(s.ci95.hi)}] | ${q(s.qValue)} | ${s.agreementWithPattern === null ? "n/a" : pct(s.agreementWithPattern)} | ${s.bothDirectionalDays} | ${s.significant ? "**q<=0.10**" : "-"} |`,
    )
    .join("\n");
  return `${head}\n${body}`;
}

function agreeTable(items: readonly AgreeVsOpposeResult[]): string {
  const head = "| Strategy | Agree n / hit | Oppose n / hit | Agree - Oppose [95% CI] | BH q | Flag |\n|---|---|---|---|---|---|";
  const body = items
    .map(
      (s) =>
        `| ${s.id} | ${s.agreeScored} / ${pct(s.agreeHit)} | ${s.opposeScored} / ${pct(s.opposeHit)} | ${pp(s.diff)} [${pp(s.ci95.lo)}, ${pp(s.ci95.hi)}] | ${q(s.qValue)} | ${s.significant ? "**q<=0.10**" : "-"} |`,
    )
    .join("\n");
  return `${head}\n${body}`;
}

function variableSections(study: SubsetStudy): string {
  return study.variables
    .map((v) => {
      const title = v.hypothesis === null ? `${v.id} (pre-registered slice dimension)` : `${v.id} (${v.hypothesis})`;
      return `#### ${title}\n\n${cellsTable(v.cells)}`;
    })
    .join("\n\n");
}

/** Cells that pass every bar: reportable, BH-significant, positive uplift, positive net, stable. */
export function candidateEdges(study: SubsetStudy): readonly Cell[] {
  const all = [...study.variables.flatMap((v) => v.cells), ...study.strategyCells];
  return all.filter(
    (c) =>
      c.reportable &&
      c.significant &&
      c.delta > 0 &&
      c.netMean > 0 &&
      c.netCi.lo > 0 &&
      c.yearsTotal > 0 &&
      c.yearsPositive / c.yearsTotal >= 0.6 &&
      c.pairsTotal > 0 &&
      c.pairsPositive / c.pairsTotal >= 0.6,
  );
}

function positiveNetCells(study: SubsetStudy): readonly Cell[] {
  const all = [...study.variables.flatMap((v) => v.cells), ...study.strategyCells];
  return all.filter((c) => c.reportable && c.netMean > 0);
}

function fourHourSection(results: readonly FourHourResult[]): string {
  return results
    .map((r) => {
      const head = "| 4H state | Days | Remaining-move hit | Full-session hit (overlaps the read) | Mean remaining pips |\n|---|---|---|---|---|";
      const body = r.groups
        .map(
          (g) =>
            `| ${g.group} | ${g.days} | ${pct(g.remainingHit)} (n=${g.remainingScored}) | ${pct(g.fullSessionHit)} (n=${g.fullSessionScored}) | ${pips(g.meanRemainingPips)} |`,
        )
        .join("\n");
      return `#### ${r.subset} days\n\nRows in hourly range ${r.rowsInHourlyRange}; observed ${r.observed}; skipped for missing hours ${r.skippedNoBars}.\n\n${head}\n${body}\n\nSupports minus contradicts, remaining move: ${pp(r.diffRemaining)} [${pp(r.diffCi95.lo)}, ${pp(r.diffCi95.hi)}], p=${q(r.diffP)} (n supports ${r.supportsScored}, contradicts ${r.contradictsScored}). Same difference on the full session (mechanically inflated): ${pp(r.diffFullSession)}. Sample ${r.adequate ? "adequate" : "THIN: treat as provisional"}.`;
    })
    .join("\n\n");
}

export function renderReport(input: ReportInput): string {
  const { directional: d, firing: f, reconciliation: rc } = input;
  const costs = PAIRS.map((p) => `${p} ${totalCostPips(XTB_STANDARD_MODEL, p).toFixed(1)}`).join(", ");
  const dEdges = candidateEdges(d);
  const fEdges = candidateEdges(f);
  const dPos = positiveNetCells(d);

  const edgeList = (edges: readonly Cell[]): string =>
    edges.length === 0 ? "None." : edges.map((c) => `- ${c.variable} = ${c.label}: scored ${c.scored}, uplift ${pp(c.delta)}, net ${pips(c.netMean)} pips/trade [${pips(c.netCi.lo)}, ${pips(c.netCi.hi)}], years ${c.yearsPositive}/${c.yearsTotal}, pairs ${c.pairsPositive}/${c.pairsTotal}`).join("\n");

  const sigCorr = [...d.variables, ...f.variables]
    .flatMap((v) => (v.correlation === null ? [] : [v.correlation]))
    .filter((c) => c.significant).length;

  return `# Evidence Report 1: where, if anywhere, does the pattern signal work?

Generated ${input.generatedOn}. Exploration window ${input.window.start}..${input.window.end}. The locked holdout ${RESEARCH_HOLDOUT.start}..${RESEARCH_HOLDOUT.end} was NOT read. No verdict is recorded here; an unfavourable result is a valid outcome. Nothing in this report changes the live system.

## How to read this

- **Rows:** one per pair per decision date, live convention (legacy FLAT band, label after the decision date), local in-memory stores built from data/*_D1.csv, hosted untouched.
- **Directional days:** the pattern has a UP/DOWN call. **Firing days:** the call also clears the 0.55 confidence line. Directional is the pre-registered primary subset for the evidence-quality studies because it has more days; firing is reported alongside.
- **Hit:** the call matches the sign of the session after the decision date (open to close); days whose realised sign is FLAT are excluded. **Baseline:** the weekly-trend rule on the same days. **Uplift:** model hit minus baseline hit on matched days.
- **Net pips/trade:** signed move in the called direction minus cost (xtb-standard-v1: XTB standard-account spreads from BrokerChooser averages, commission 0, exec-v1 slippage; pips per trade: ${costs}). Entry at the session open, exit at the session close, no stop or target.
- **Intervals and p-values:** block bootstrap (${BOOTSTRAP_ITERATIONS} resamples, calendar-week blocks, so the five pairs of a week and overlapping windows stay together). **BH q:** Benjamini-Hochberg false-discovery-rate adjusted value inside each pre-registered family (level ${FDR_Q}). A cell with fewer than ${MIN_REPORTABLE_SCORED} scored days is exploratory and is never called significant.
- **Years + / Pairs +:** in how many calendar years / pairs (with at least 100 scored days) the uplift is positive.
- Pre-registration: docs/research/PRE-REGISTRATION.md. Hypotheses: ${RESEARCH_HYPOTHESES.map((h) => h.id).join(", ")}.

## 1. Reconciliation with the recorded evaluation

Rows dated on or before ${rc.window.end} (the existing discovery window) must reproduce the recorded local evidence run, because each date is evaluated only on earlier information.

| Measure | This dataset | Recorded in RESEARCH-LOG.md |
|---|---|---|
| Pair-days | ${rc.pairDays} | ${rc.recorded.pairDays} |
| Directional (model has a call) | ${rc.directional} | ${rc.recorded.directional} |
| Firing (>= 0.55) | ${rc.firing} | ${rc.recorded.firing} |
| Directional scored | ${rc.directionalScored} | ${rc.recorded.directionalScored} |
| Directional model hit | ${pct(rc.modelRate)} | ${pct(rc.recorded.modelRate)} |

## 2. Headline

| Subset | Scored | Model hit | Weekly-trend hit | Uplift [95% CI] | Net pips/trade [95% CI] | Years + | Pairs + |
|---|---|---|---|---|---|---|---|
| Directional | ${d.overall.scored} | ${pct(d.overall.modelHit)} | ${pct(d.overall.baselineHit)} | ${pp(d.overall.delta)} [${pp(d.overall.deltaCi.lo)}, ${pp(d.overall.deltaCi.hi)}] | ${pips(d.overall.netMean)} [${pips(d.overall.netCi.lo)}, ${pips(d.overall.netCi.hi)}] | ${d.overall.yearsPositive}/${d.overall.yearsTotal} | ${d.overall.pairsPositive}/${d.overall.pairsTotal} |
| Firing | ${f.overall.scored} | ${pct(f.overall.modelHit)} | ${pct(f.overall.baselineHit)} | ${pp(f.overall.delta)} [${pp(f.overall.deltaCi.lo)}, ${pp(f.overall.deltaCi.hi)}] | ${pips(f.overall.netMean)} [${pips(f.overall.netCi.lo)}, ${pips(f.overall.netCi.hi)}] | ${f.overall.yearsPositive}/${f.overall.yearsTotal} | ${f.overall.pairsPositive}/${f.overall.pairsTotal} |

## 3. Where does the signal work? (summary)

Cells examined in the pre-registered correction family: directional ${d.cellsInFamily}, firing ${f.cellsInFamily}. Correlation hypotheses that are significant after correction (both subsets): ${sigCorr} of ${2 * 10}.

**Candidate edges** (reportable, BH-significant, positive uplift, positive net with the lower bound above zero, positive in at least 60% of years and pairs):

Directional:
${edgeList(dEdges)}

Firing:
${edgeList(fEdges)}

Reportable directional cells with a positive mean net (not necessarily significant, listed so nothing is hidden): ${dPos.length === 0 ? "none" : dPos.map((c) => `${c.variable}=${c.label} (${pips(c.netMean)})`).join("; ")}.

## 4. Evidence quality and calibration (H1-H6)

### 4.1 Correlations with hit rate

Directional days:

${corrTable(d)}

Firing days:

${corrTable(f)}

### 4.2 Bands, directional days

${variableSections(d)}

### 4.3 Bands, firing days

${variableSections(f)}

## 5. Confluence strategies (H7-H8)

Standalone accuracy against a coin flip (all days on which the strategy gives a direction, not only pattern days). \`third_party\` has no history and is excluded; \`custom_pattern\` is the pattern call itself.

${standaloneTable(d.standalone)}

Agreeing vs opposing the pattern call (directional days):

${agreeTable(d.agreeVsOppose)}

Cells relative to the pattern call (directional days):

${cellsTable(d.strategyCells, true)}

Cells relative to the pattern call (firing days):

${cellsTable(f.strategyCells, true)}

## 6. 4H confirmation (H11), provisional

${fourHourSection(input.fourHour)}

## 7. Exploratory conditions (NOT pre-registered; outside the correction family)

The \`patternVsWeeklyTrend\` split was added after the first run (it showed model and baseline identical in several cells), so it is exploratory by construction.

Directional days:

${cellsTable(d.exploratoryCells, true)}

Firing days:

${cellsTable(f.exploratoryCells, true)}

## 8. Caveats

- Five USD pairs and overlapping daily windows are not independent. The block bootstrap helps but does not remove this; treat intervals as optimistic.
- The correction covers only pre-registered cells. Exploratory cells are listed for orientation; any pattern found there needs its own hypothesis and the holdout.
- Spearman intervals reuse full-sample ranks across resamples (a standard shortcut).
- Costs are published average XTB standard-account spreads (USDCHF from a search snippet); real spreads widen in fast or off-peak markets. Net expectancy is sensitive to this. The first version of this report used exec-v1 costs; hit rates are unchanged, only net pips differ.
- The hourly archive covers 2021-2024 only, so the 4H study cannot use the 2025 data and has a short history.
- The target is the session after the decision date, the live convention; RESEARCH-LOG.md shows aligning to the session labelled with the decision date does not change accuracy.
`;
}
