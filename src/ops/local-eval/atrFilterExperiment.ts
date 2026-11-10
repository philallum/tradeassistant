// Offline ATR (volatility-regime) post-filter experiment (Task 9).
//
// Question: do analogues that occurred in a similar volatility regime to today predict better
// than the shape-only neighbourhood? The filter keeps a retrieved neighbour only when its stored
// ATR_14 (price units, already persisted on every analogue row) is within a ratio band of
// today's ATR_14 (computed from candles strictly before the date). It runs ONLY here: it is an
// optional hook on the offline record collector, defaults to OFF, never touches the live
// pipeline, and changes no stored row. Looser/tighter ratios are all reported, and any apparent
// gain is a candidate to be confirmed on the untouched holdout, not a finding.
import type { AnalogueRecord } from "../../retrieval/types.js";
import { CONFIRMATION_HOLDOUT, DISCOVERY_WINDOW, type ProtocolWindow } from "../../walk-forward/evidenceProtocol.js";
import { compareStrategies } from "./baselines.js";
import { collectDayRecords, type DayRecord, type DayRecordOptions } from "./dayRecords.js";
import { buildLocalEvalStores } from "./localStores.js";
import { scoreAccuracy } from "./scoring.js";

/** The post-filter: keep neighbours whose ATR is within `maxRatio` x of today's, either way. */
export function atrSimilarityFilter(maxRatio: number): NonNullable<DayRecordOptions["neighbourhoodFilter"]> {
  if (!(maxRatio >= 1)) throw new Error("maxRatio must be >= 1");
  return (neighbourhood: readonly AnalogueRecord[], context) => {
    if (!(context.atr14 > 0)) return neighbourhood; // no regime information: leave untouched
    return neighbourhood.filter((a) => {
      if (!(a.atr14 > 0)) return false;
      const ratio = a.atr14 / context.atr14;
      return ratio <= maxRatio && ratio >= 1 / maxRatio;
    });
  };
}

export interface AtrArmResult {
  readonly id: string;
  readonly maxRatio: number | null;
  readonly records: number;
  readonly directionalDays: number;
  readonly firingDays: number;
  readonly meanNeighbourhood: number;
  readonly directionalDelta: number;
  readonly directionalModelRate: number;
  readonly directionalScored: number;
  readonly firingDelta: number;
  readonly firingModelRate: number;
  readonly firingScored: number;
  readonly netPipsDirectional: number;
  readonly netPipsFiring: number;
}

export interface AtrExperimentOptions {
  readonly dataDir: string;
  readonly window?: ProtocolWindow;
  readonly ratios?: readonly number[];
  readonly log?: (event: object) => void;
}

function summarizeArm(id: string, maxRatio: number | null, records: readonly DayRecord[]): AtrArmResult {
  const session = "after_decision_date" as const;
  const dir = scoreAccuracy(records, "directional", session);
  const fir = scoreAccuracy(records, "firing", session);
  const model = (subset: "directional" | "firing"): number =>
    compareStrategies(records, subset, session).find((s) => s.id === "model")?.meanNetPips ?? 0;
  const n = records.reduce((a, r) => a + r.n, 0);
  return {
    id,
    maxRatio,
    records: records.length,
    directionalDays: dir.days,
    firingDays: fir.days,
    meanNeighbourhood: records.length === 0 ? 0 : n / records.length,
    directionalDelta: dir.delta,
    directionalModelRate: dir.model.rate,
    directionalScored: dir.scored,
    firingDelta: fir.delta,
    firingModelRate: fir.model.rate,
    firingScored: fir.scored,
    netPipsDirectional: model("directional"),
    netPipsFiring: model("firing"),
  };
}

export async function runAtrFilterExperiment(options: AtrExperimentOptions): Promise<readonly AtrArmResult[]> {
  const log = options.log ?? ((e: object) => console.log(JSON.stringify(e)));
  const window = options.window ?? DISCOVERY_WINDOW;
  if (window.end >= CONFIRMATION_HOLDOUT.start) {
    throw new Error("atr-filter experiment: the window must not overlap the confirmation holdout");
  }
  const built = await buildLocalEvalStores({ dataDir: options.dataDir, log: () => undefined });
  const arms: { id: string; ratio: number | null }[] = [
    { id: "off", ratio: null },
    ...(options.ratios ?? [2, 1.5, 1.25]).map((r) => ({ id: `atr_within_${r}x`, ratio: r })),
  ];
  const out: AtrArmResult[] = [];
  for (const arm of arms) {
    log({ event: "atr_experiment.arm_start", arm: arm.id });
    const records = await collectDayRecords(built.stores, {
      window,
      ...(arm.ratio !== null ? { neighbourhoodFilter: atrSimilarityFilter(arm.ratio) } : {}),
    });
    out.push(summarizeArm(arm.id, arm.ratio, records));
  }
  return out;
}

const pp = (x: number): string => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(2)}pp`;
const pct = (x: number): string => (x * 100).toFixed(2);

/** Plain, verdict-free research-log lines. */
export function renderAtrLines(results: readonly AtrArmResult[], window: ProtocolWindow): readonly string[] {
  const lines = [
    `Window ${window.start}..${window.end} (discovery only; confirmation holdout not consulted). Local in-memory stores; hosted untouched; live behaviour unchanged. Post-filter keeps neighbours whose stored ATR_14 is within the ratio of today's. Yardstick: sign of the session after the decision date, model vs weekly-trend on the same days.`,
  ];
  for (const r of results) {
    lines.push(
      `Arm ${r.id}: mean n=${r.meanNeighbourhood.toFixed(1)}; directional days=${r.directionalDays} (scored ${r.directionalScored}) model ${pct(r.directionalModelRate)}% delta ${pp(r.directionalDelta)} net ${r.netPipsDirectional.toFixed(2)} pips/trade; firing days=${r.firingDays} (scored ${r.firingScored}) model ${pct(r.firingModelRate)}% delta ${pp(r.firingDelta)} net ${r.netPipsFiring.toFixed(2)} pips/trade`,
    );
  }
  lines.push("Note: evidence for human interpretation; a gain here is a candidate for confirmation on the untouched holdout, not a finding. Nothing is applied to the live system.");
  return lines;
}
