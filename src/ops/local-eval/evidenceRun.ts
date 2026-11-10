// Full local evidence run (Task 8): baselines, net expectancy and pre-registered slices.
//
// Builds the live-convention stores (legacy FLAT band, label after the decision date) from the
// seed CSVs, collects per-day records over the DISCOVERY window only, and renders plain,
// verdict-free lines. The confirmation holdout is NOT consulted unless `confirmHoldout` is set,
// and doing so is logged, because a holdout can be consulted once per written-down hypothesis.
import { DEFAULT_EXECUTION_MODEL } from "../../trade-sim/executionModel.js";
import {
  CONFIRMATION_HOLDOUT,
  DISCOVERY_WINDOW,
  PRE_REGISTERED_SLICE_DIMENSIONS,
  type ProtocolWindow,
} from "../../walk-forward/evidenceProtocol.js";
import { compareStrategies, type StrategySummary } from "./baselines.js";
import { collectDayRecords, type DayRecord, type TargetSession } from "./dayRecords.js";
import { buildLocalEvalStores } from "./localStores.js";
import { scoreAccuracy, type SubsetName } from "./scoring.js";
import { renderEventSplitLines, splitByEventDay } from "./eventSubset.js";
import { confirmPockets, sliceRecords, type SliceCell } from "./slices.js";

export interface EvidenceRunOptions {
  readonly dataDir: string;
  readonly discovery?: ProtocolWindow;
  /** Consult the untouched confirmation holdout for the discovered candidates. Logged loudly. */
  readonly confirmHoldout?: boolean;
  readonly log?: (event: object) => void;
}

export interface EvidenceRunResult {
  readonly lines: readonly string[];
  readonly records: readonly DayRecord[];
  readonly candidates: readonly SliceCell[];
  readonly slicesTested: number;
}

const pct = (x: number): string => (x * 100).toFixed(2);
const pp = (x: number): string => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(2)}pp`;
const pips = (x: number): string => `${x >= 0 ? "+" : ""}${x.toFixed(2)}`;

function comparatorLine(s: StrategySummary): string {
  return `    ${s.id}: trades=${s.trades} hit=${pct(s.hitRate.rate)}% [${pct(s.hitRate.ci95.lo)}, ${pct(s.hitRate.ci95.hi)}] (UP-calls ${pct(s.hitRateByDirection.UP.rate)}% n=${s.hitRateByDirection.UP.n}, DOWN-calls ${pct(s.hitRateByDirection.DOWN.rate)}% n=${s.hitRateByDirection.DOWN.n}) gross=${pips(s.meanGrossPips)} net=${pips(s.meanNetPips)} pips/trade [${pips(s.netPipsCi95.lo)}, ${pips(s.netPipsCi95.hi)}] (mean cost ${s.meanCostPips.toFixed(2)})`;
}

function sessionLabel(s: TargetSession): string {
  return s === "after_decision_date"
    ? "session AFTER the decision date (what the live labels and track record measure)"
    : "session labelled WITH the decision date (the next session a trader acting on the card would actually trade)";
}

export async function runEvidence(options: EvidenceRunOptions): Promise<EvidenceRunResult> {
  const log = options.log ?? ((e: object) => console.log(JSON.stringify(e)));
  const discovery = options.discovery ?? DISCOVERY_WINDOW;
  const built = await buildLocalEvalStores({ dataDir: options.dataDir, log: () => undefined });
  const records = await collectDayRecords(built.stores, { window: discovery });
  log({ event: "evidence_run.records", window: discovery, records: records.length });

  const lines: string[] = [
    `Discovery window ${discovery.start}..${discovery.end}; live convention (legacy FLAT band, label after the decision date); local in-memory stores from data/*_D1.csv; hosted untouched; confirmation holdout ${CONFIRMATION_HOLDOUT.start}..${CONFIRMATION_HOLDOUT.end} ${options.confirmHoldout === true ? "CONSULTED (see below)" : "NOT consulted"}. Execution model ${DEFAULT_EXECUTION_MODEL.id}; yardstick: sign of the target session's open-to-close move.`,
    `Records: ${records.length} pair-days; directional (model has a call) ${records.filter((r) => r.direction !== "FLAT").length}; firing (>=0.55) ${records.filter((r) => r.fires).length}.`,
  ];

  const sessions: readonly TargetSession[] = ["after_decision_date", "on_decision_date"];
  const subsets: readonly SubsetName[] = ["directional", "firing"];
  let candidates: SliceCell[] = [];
  let slicesTested = 0;

  for (const session of sessions) {
    lines.push(`Target = ${sessionLabel(session)}:`);
    for (const subset of subsets) {
      const acc = scoreAccuracy(records, subset, session);
      lines.push(
        `  [${subset}] scored=${acc.scored}: model ${pct(acc.model.rate)}% vs weekly-trend ${pct(acc.baseline.rate)}% (delta ${pp(acc.delta)}; raw95 [${pp(acc.deltaCiRaw.lo)}, ${pp(acc.deltaCiRaw.hi)}], discounted(/${acc.discountFactor}) [${pp(acc.deltaCiDiscounted.lo)}, ${pp(acc.deltaCiDiscounted.hi)}])`,
      );
      for (const s of compareStrategies(records, subset, session)) lines.push(comparatorLine(s));
    }
    // Stability across calendar years (directional subset).
    const years = [...new Set(records.map((r) => r.date.slice(0, 4)))].sort();
    const perYear = years
      .map((y) => {
        const a = scoreAccuracy(records.filter((r) => r.date.startsWith(y)), "directional", session);
        return `${y}:${pp(a.delta)}(n=${a.scored})`;
      })
      .join(" ");
    lines.push(`  Directional delta vs weekly-trend by year: ${perYear}`);
  }

  // Slices: the live-target session only (the pre-registered question), firing and directional.
  for (const subset of subsets) {
    const report = sliceRecords(records, subset, "after_decision_date");
    slicesTested += report.slicesTested;
    lines.push(
      `Slices [${subset}, target=after_decision_date]: dimensions ${PRE_REGISTERED_SLICE_DIMENSIONS.join(", ")}; cells examined=${report.slicesTested}; candidate pockets (scored>=100 and delta>0)=${report.candidates.length} (expect about half by chance alone).`,
    );
    for (const c of report.cells) {
      lines.push(
        `    ${c.dimension}=${c.label}: scored=${c.scored} model ${pct(c.model.rate)}% vs baseline ${pct(c.baseline.rate)}% delta ${pp(c.delta)} (discounted95 [${pp(c.deltaCiDiscounted.lo)}, ${pp(c.deltaCiDiscounted.hi)}]) net ${pips(c.meanNetPips)} pips/trade${c.candidate ? " CANDIDATE" : ""}`,
      );
    }
    if (subset === "directional") candidates = [...report.candidates];
  }

  // Event days vs ordinary days (calendar is a caution flag; this measures whether it is earned).
  for (const subset of subsets) {
    lines.push(...renderEventSplitLines(splitByEventDay(records, subset, "after_decision_date"), subset));
  }

  if (options.confirmHoldout === true) {
    log({ event: "evidence_run.holdout_consulted", window: CONFIRMATION_HOLDOUT, candidates: candidates.length });
    const holdoutRecords = await collectDayRecords(built.stores, { window: CONFIRMATION_HOLDOUT });
    const confirmations = confirmPockets(candidates, holdoutRecords, "directional", "after_decision_date");
    lines.push(
      `HOLDOUT CONSULTED for ${candidates.length} directional-subset candidates (cells examined in discovery: ${slicesTested}). Held: ${confirmations.filter((c) => c.holds).length} of ${confirmations.length}.`,
    );
    for (const c of confirmations) {
      lines.push(
        `    ${c.dimension}=${c.label}: discovery delta ${pp(c.discoveryDelta)} -> holdout scored=${c.holdoutScored} model ${pct(c.holdoutModel.rate)}% delta ${pp(c.holdoutDelta)} ${c.holds ? "HOLDS" : "does not hold"}`,
      );
    }
  }

  lines.push("Note: evidence for human interpretation; no verdict is recorded, an unfavourable result is a valid outcome, and a candidate pocket is not a finding until it holds on the confirmation holdout.");
  return { lines, records, candidates, slicesTested };
}
