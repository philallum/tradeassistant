// Markdown rendering for Evidence Report 2 (pure; no I/O). No verdict language.
import { PAIRS } from "../../ingestion/types.js";
import { totalCostPips } from "../../trade-sim/executionModel.js";
import type { ProtocolWindow } from "../../walk-forward/evidenceProtocol.js";
import { XTB_STANDARD_MODEL } from "./costModel.js";
import { VARIANTS } from "./encodingVariants.js";
import type { FamilySummary, FeatureResult } from "./familyStudy.js";
import { BOOTSTRAP_ITERATIONS, FDR_Q, MIN_REPORTABLE_SCORED, RESEARCH_HOLDOUT } from "./researchProtocol.js";
import type { Comparison, VariantStudy, VariantSummary } from "./variantStudy.js";

export interface Report2Input {
  readonly generatedOn: string;
  readonly window: ProtocolWindow;
  readonly families: readonly FamilySummary[];
  readonly variants: VariantStudy;
  readonly variantRowCounts: Readonly<Record<string, number>>;
}

const pct = (x: number): string => `${(x * 100).toFixed(2)}%`;
const pp = (x: number): string => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(2)}pp`;
const pips = (x: number): string => `${x >= 0 ? "+" : ""}${x.toFixed(2)}`;
const num = (x: number): string => x.toFixed(3);
const q = (x: number): string => (x < 0.001 ? "<0.001" : x.toFixed(3));

function featureRows(f: FeatureResult): string {
  const flag = f.significant ? "**q<=0.10**" : f.n < MIN_REPORTABLE_SCORED ? "exploratory (n<200)" : "-";
  const terc = f.terciles.map((t) => `${t.label.split(" ")[0]}: ${pct(t.hit)} (n=${t.scored}, net ${pips(t.netMean)})`).join("; ");
  return `| ${f.family} | ${f.feature} | ${f.n} | ${num(f.rho)} [${num(f.ci95.lo)}, ${num(f.ci95.hi)}] | ${q(f.p)} | ${q(f.qValue)} | ${flag} | ${terc} |`;
}

function summaryRow(s: VariantSummary): string {
  return `| ${s.id} | ${s.scored} | ${s.meanN.toFixed(1)} | ${pct(s.hit)} | ${pct(s.baselineHit)} | ${pp(s.uplift)} [${pp(s.upliftCi.lo)}, ${pp(s.upliftCi.hi)}] | ${pips(s.netMean)} [${pips(s.netCi.lo)}, ${pips(s.netCi.hi)}] | ${pct(s.equalsWeeklyTrend)} | ${pct(s.hitWhenDiffers.hit)} (n=${s.hitWhenDiffers.scored}) | ${pct(s.hitWhenEquals.hit)} (n=${s.hitWhenEquals.scored}) |`;
}

const SUMMARY_HEAD =
  "| Variant | Scored | Mean n | Hit | Weekly-trend hit | Uplift [95% CI] | Net pips/trade [95% CI] | Call = weekly trend | Hit when it differs | Hit when it equals |\n|---|---|---|---|---|---|---|---|---|---|";

function comparisonRow(c: Comparison): string {
  const flag = c.significant ? "**q<=0.10**" : "-";
  return `| ${c.variant} - ${c.control} | ${c.matchedScored} | ${pct(c.variantHit)} | ${pct(c.controlHit)} | ${pp(c.diff)} [${pp(c.ci95.lo)}, ${pp(c.ci95.hi)}] | ${q(c.p)} | ${q(c.qValue)} | ${flag} |`;
}

const COMPARISON_HEAD =
  "| Comparison | Matched scored days | Variant hit | Control hit | Difference [95% CI] | p | BH q | Flag |\n|---|---|---|---|---|---|---|---|";

export function renderReport2(input: Report2Input): string {
  const { families, variants } = input;
  const costs = PAIRS.map((p) => `${p} ${totalCostPips(XTB_STANDARD_MODEL, p).toFixed(1)}`).join(", ");
  const featureTests = families.flatMap((f) => f.features);
  const sig = featureTests.filter((f) => f.significant);

  const familyTable =
    "| Family | Setups | Scored | Hit [95% CI] | p vs 50% | Net pips/trade [95% CI] | Agrees with pattern: hit (n) | Opposes pattern: hit (n) |\n|---|---|---|---|---|---|---|---|\n" +
    families
      .map((f) => {
        const a = f.relation.find((r) => r.label === "agree");
        const o = f.relation.find((r) => r.label === "oppose");
        return `| ${f.family} | ${f.setups} | ${f.scored} | ${pct(f.hit)} [${pct(f.hitCi95.lo)}, ${pct(f.hitCi95.hi)}] | ${q(f.hitP)} | ${pips(f.netMean)} [${pips(f.netCi95.lo)}, ${pips(f.netCi95.hi)}] | ${a === undefined ? "n/a" : `${pct(a.hit)} (${a.scored})`} | ${o === undefined ? "n/a" : `${pct(o.hit)} (${o.scored})`} |`;
      })
      .join("\n");

  const featureTable =
    "| Family | Feature (oriented to setup) | n | Spearman rho vs hit [95% CI] | p | BH q (20 tests) | Flag | Terciles low / mid / high: hit |\n|---|---|---|---|---|---|---|---|\n" +
    featureTests.map(featureRows).join("\n");

  const dirSummaries = variants.summaries.filter((s) => s.subset === "directional");
  const fireSummaries = variants.summaries.filter((s) => s.subset === "firing");
  const dirCmp = variants.comparisons.filter((c) => c.subset === "directional");
  const fireCmp = variants.comparisons.filter((c) => c.subset === "firing");

  return `# Evidence Report 2: setup families and trader's-eye encodings

Generated ${input.generatedOn}. Exploration window ${input.window.start}..${input.window.end}. The locked holdout ${RESEARCH_HOLDOUT.start}..${RESEARCH_HOLDOUT.end} was NOT read. No verdict is recorded; an unfavourable result is a valid outcome. Nothing here changes the live system. Design: docs/research/PRE-REGISTRATION-2.md (written before any result).

## How to read this

- **Costs:** \`xtb-standard-v1\`, pips per trade: ${costs}. XTB standard-account spreads from BrokerChooser averages plus the exec-v1 slippage; commission 0. Real costs rise in fast or off-peak markets. Evidence Report 1 was re-run with these costs.
- **Hit:** the direction equals the sign of the session after the decision date (open to close); days whose realised sign is FLAT are excluded. **Net:** signed pips in that direction minus cost, entry at the session open, exit at the close, no stop or target.
- **Intervals / p-values:** week-block bootstrap, ${BOOTSTRAP_ITERATIONS} resamples. **BH q:** Benjamini-Hochberg false-discovery-rate value inside each pre-registered family, level ${FDR_Q}. Fewer than ${MIN_REPORTABLE_SCORED} scored days is exploratory and never called significant.

## Part A: setup families

A setup is a day on which one rule strategy gives UP or DOWN (or, for "pattern", the analogue pattern gives a call). Features are oriented so that positive means "in the setup's favour". Spearman rho is against the hit indicator.

### A1. Family results

${familyTable}

### A2. Pre-registered feature tests (20 tests, one correction family)

Significant after correction: ${sig.length === 0 ? "none" : sig.map((f) => `${f.family}/${f.feature}`).join(", ")}.

${featureTable}

## Part B: encoding variants

${VARIANTS.map((v) => `- **${v.id}:** ${v.description}${v.control === null ? "" : ` (compared with ${v.control})`}`).join("\n")}
- **V0:** the live pipeline (k=200, epsilon 0.2, prefilter), from Evidence Report 1, for reference only.

Variant row counts: ${Object.entries(input.variantRowCounts).map(([k, n]) => `${k} ${n}`).join(", ")}.

### B1. Directional days

${SUMMARY_HEAD}
${dirSummaries.map(summaryRow).join("\n")}

### B2. Firing days (confidence >= 0.55)

${SUMMARY_HEAD}
${fireSummaries.map(summaryRow).join("\n")}

### B3. Pre-registered paired comparisons (BH across four), directional days

${COMPARISON_HEAD}
${dirCmp.map(comparisonRow).join("\n")}

Firing days (descriptive; separate correction):

${COMPARISON_HEAD}
${fireCmp.map(comparisonRow).join("\n")}

**Promising variants** (significant improvement over its control, uplift over the weekly-trend baseline above zero, net lower bound above zero): ${variants.promising.length === 0 ? "none" : variants.promising.join(", ")}.

## Caveats

- Rare setups (breakout, range, reversal) give wide intervals; only large effects are detectable.
- Five USD pairs and overlapping windows are not independent; intervals are optimistic.
- The live pipeline skips the candle labelled with the decision date, so features and signals describe the day before the decision date and the outcome is the session after it (RISKS finding 3). Variants share that gap.
- Variants that use chart features have no vectors for roughly the first 121 candles of each pair, so their analogue pool starts a little later.
- A promising variant is a candidate, not a finding. It must be frozen and taken to the locked holdout once.
`;
}
