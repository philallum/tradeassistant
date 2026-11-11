// Markdown rendering for Evidence Report 3 (pure; no I/O). No verdict language.
import { PAIRS } from "../../ingestion/types.js";
import { totalCostPips } from "../../trade-sim/executionModel.js";
import type { ProtocolWindow } from "../../walk-forward/evidenceProtocol.js";
import { XTB_STANDARD_MODEL } from "./costModel.js";
import { BRACKET_ATR, BRACKET_MAX_BARS, OUTCOMES } from "./horizonOutcomes.js";
import type { CellSummary, HorizonStudy } from "./horizonStudy.js";
import { BOOTSTRAP_ITERATIONS, FDR_Q, MIN_REPORTABLE_SCORED, RESEARCH_HOLDOUT } from "./researchProtocol.js";

export interface Report3Input {
  readonly generatedOn: string;
  readonly window: ProtocolWindow;
  readonly study: HorizonStudy;
  readonly bracketKinds: Readonly<Record<string, number>>;
  readonly medianAtrPips: Readonly<Record<string, number>>;
}

const pct = (x: number): string => `${(x * 100).toFixed(2)}%`;
const pp = (x: number): string => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(2)}pp`;
const pips = (x: number): string => `${x >= 0 ? "+" : ""}${x.toFixed(2)}`;
const q = (x: number | null): string => (x === null ? "ref" : x < 0.001 ? "<0.001" : x.toFixed(3));

const HEAD =
  "| Source | Outcome | Scored | Mean n | Model hit | Weekly-trend hit | Uplift [95% CI] | BH q | Net pips/trade [95% CI] | Weekly-trend net | UP share | Call = weekly trend | Hit when differs | Years + | Pairs + | Confidence rho [95% CI] | BH q | Flags |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|";

function row(c: CellSummary): string {
  const flags = [
    c.scored < MIN_REPORTABLE_SCORED ? "exploratory (n<200)" : "",
    c.upliftSignificant ? `uplift q<=0.10 (${c.uplift > 0 ? "better" : "WORSE"})` : "",
    c.confSignificant ? `confidence q<=0.10 (${c.confRho > 0 ? "ranks" : "INVERTED"})` : "",
    c.promising ? "**PROMISING**" : "",
  ]
    .filter((s) => s.length > 0)
    .join("; ");
  return `| ${c.source} | ${c.outcome} | ${c.scored} | ${c.meanN.toFixed(1)} | ${pct(c.hit)} | ${pct(c.baselineHit)} | ${pp(c.uplift)} [${pp(c.upliftCi.lo)}, ${pp(c.upliftCi.hi)}] | ${q(c.upliftQ)} | ${pips(c.netMean)} [${pips(c.netCi.lo)}, ${pips(c.netCi.hi)}] | ${pips(c.baselineNetMean)} | ${pct(c.upShare)} | ${pct(c.equalsWeeklyTrend)} | ${pct(c.hitWhenDiffers.hit)} (n=${c.hitWhenDiffers.scored}) | ${c.yearsPositive}/${c.yearsTotal} | ${c.pairsPositive}/${c.pairsTotal} | ${c.confRho.toFixed(3)} [${c.confCi.lo.toFixed(3)}, ${c.confCi.hi.toFixed(3)}] | ${q(c.confQ)} | ${flags.length === 0 ? "-" : flags} |`;
}

export function renderReport3(input: Report3Input): string {
  const { study } = input;
  const costs = PAIRS.map((p) => `${p} ${totalCostPips(XTB_STANDARD_MODEL, p).toFixed(1)}`).join(", ");
  const sort = (cells: readonly CellSummary[]): CellSummary[] =>
    [...cells].sort((a, b) => OUTCOMES.indexOf(a.outcome) - OUTCOMES.indexOf(b.outcome) || a.source.localeCompare(b.source));
  const dir = sort(study.cells.filter((c) => c.subset === "directional"));
  const fire = sort(study.cells.filter((c) => c.subset === "firing"));
  const family = dir.filter((c) => c.upliftQ !== null);
  const sigU = family.filter((c) => c.upliftSignificant);
  const sigC = family.filter((c) => c.confSignificant);
  const kinds = Object.entries(input.bracketKinds)
    .map(([k, n]) => `${k} ${n}`)
    .join(", ");
  const atr = Object.entries(input.medianAtrPips)
    .map(([p, v]) => `${p} ${v.toFixed(1)}`)
    .join(", ");

  return `# Evidence Report 3: multi-day horizons and target-before-stop

Generated ${input.generatedOn}. Exploration window ${input.window.start}..${input.window.end}; every outcome window closes inside it. The locked holdout ${RESEARCH_HOLDOUT.start}..${RESEARCH_HOLDOUT.end} was NOT read. No verdict is recorded; an unfavourable result is a valid outcome. Nothing here changes the live system. Design: docs/research/PRE-REGISTRATION-3.md (written before any result).

## How to read this

- **Outcomes:** H1 = next session (reference), H3 / H5 = hold 3 / 5 sessions (open of the session after the decision date to the close of the 3rd / 5th session), BR = symmetric bracket ${BRACKET_ATR} x ATR14 either side of entry, at most ${BRACKET_MAX_BARS} sessions; hit = side touched first. One daily candle touching both sides is ambiguous and counted as a loss in net; expired brackets close at the 5th session.
- **The call for each outcome** is the majority of the analogues' own result for that same outcome, counting only analogues whose outcome window had closed by the decision date. Confidence uses the live shrinkage (prior weight 10).
- **Sources:** V0 live retrieval (k=200, epsilon 0.2); V0b live shape with fixed k=30; V1 live shape plus chart features with k=30. All keep the weekly-trend prefilter.
- **Baseline:** the weekly-trend sign as the call for every outcome, same days. **Weekly-trend net:** the baseline's net per trade on the same days.
- **Costs:** xtb-standard-v1, pips per trade: ${costs}. Paid once per trade. Overnight financing (swap) is NOT modelled.
- **Statistics:** block bootstrap over calendar MONTHS (${BOOTSTRAP_ITERATIONS} resamples). BH q within family U (uplift, 9 tests) and family C (confidence, 9 tests), level ${FDR_Q}; H1 rows are reference ("ref") and outside both.
- Median ATR14 in pips over scored days (bracket width): ${atr}. Bracket outcomes on directional V0 days: ${kinds}.

## Summary

- Family U (uplift over weekly trend, H3 / H5 / BR x 3 sources): significant ${sigU.length === 0 ? "none" : sigU.map((c) => `${c.source}/${c.outcome} (${pp(c.uplift)})`).join(", ")}.
- Family C (confidence ranks outcomes): significant ${sigC.length === 0 ? "none" : sigC.map((c) => `${c.source}/${c.outcome} (rho ${c.confRho.toFixed(3)})`).join(", ")}.
- Promising (significant positive uplift, net lower bound above zero, positive in at least 60% of years and pairs): ${study.promising.length === 0 ? "none" : study.promising.map((c) => `${c.source}/${c.outcome}`).join(", ")}.

## Directional days

${HEAD}
${dir.map(row).join("\n")}

## Firing days (confidence >= 0.55; descriptive, outside the families)

${HEAD}
${fire.map(row).join("\n")}

## Caveats

- Overnight financing is not modelled; over 3 to 5 sessions it can matter, in either direction.
- Neighbouring days' multi-day windows overlap; month blocks help but intervals remain optimistic.
- The bracket's ambiguous days are counted as losses (conservative). Hourly bars could resolve them but cover only 2021 to 2024.
- UP share shows the drift in each outcome. Over 2013 to 2025 the USD trends make multi-day hit rates partly a drift question; the weekly-trend baseline is the comparator for that reason.
- A promising cell is a candidate, not a finding; it must be frozen and taken to the locked holdout once.
`;
}
