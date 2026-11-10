// Offline A/B of the FLAT dead-band definition and the label alignment (Task 5).
//
// Builds one local store set per arm from the SAME candles, collects the SAME per-day records,
// and scores each arm against the SAME yardstick: the sign of the realised session's
// open-to-close move. Nothing here touches the live path; the resolver's default (legacy band,
// outcome measured on the session after the decision date) is unchanged.
//
// Arms:
//   live_legacy   - what is live and stored today.
//   atr_band      - FLAT band converted to pips (the originally intended 0.5 x ATR), label as live.
//   aligned_label - live FLAT band, but the label is the session labelled with the date itself
//                   (features end the day before; label is the very next session).
//   atr_band_aligned - both changes.
import type { FlatBandMode, LabelAlignment } from "../../retrieval/resolver.js";
import type { TradingDate } from "../../guard/types.js";
import { PAIRS } from "../../ingestion/types.js";
import { collectDayRecords, type DayRecord, type TargetSession } from "./dayRecords.js";
import { buildLocalEvalStores } from "./localStores.js";
import { scoreAccuracy, type AccuracyReport } from "./scoring.js";

export interface FlatAbArm {
  readonly id: string;
  readonly flatBandMode: FlatBandMode;
  readonly labelAlignment: LabelAlignment;
}

export const FLAT_AB_ARMS: readonly FlatAbArm[] = [
  { id: "live_legacy", flatBandMode: "legacy", labelAlignment: "after_decision_date" },
  { id: "atr_band", flatBandMode: "atr_pips", labelAlignment: "after_decision_date" },
  { id: "aligned_label", flatBandMode: "legacy", labelAlignment: "on_decision_date" },
  { id: "atr_band_aligned", flatBandMode: "atr_pips", labelAlignment: "on_decision_date" },
] as const;

export interface ArmResult {
  readonly arm: FlatAbArm;
  /** Share of analogue outcomes (horizon 1, within the window) in each class, for this arm. */
  readonly analogueClassBalance: { readonly UP: number; readonly DOWN: number; readonly FLAT: number; readonly n: number };
  /** The arm's own target session (the one its labels measure). */
  readonly ownSession: TargetSession;
  readonly directional: AccuracyReport;
  readonly firing: AccuracyReport;
  /** Directional accuracy against the OTHER session, to expose a misaligned label. */
  readonly directionalOtherSession: AccuracyReport;
  readonly directionalDays: number;
  readonly firingDays: number;
  readonly totalDays: number;
}

export interface FlatAbOptions {
  readonly dataDir: string;
  readonly window: { readonly start: TradingDate; readonly end: TradingDate };
  readonly arms?: readonly FlatAbArm[];
  readonly log?: (event: object) => void;
}

function sessionOf(alignment: LabelAlignment): TargetSession {
  return alignment;
}

export async function runFlatAb(options: FlatAbOptions): Promise<readonly ArmResult[]> {
  const log = options.log ?? ((e: object) => console.log(JSON.stringify(e)));
  const results: ArmResult[] = [];
  for (const arm of options.arms ?? FLAT_AB_ARMS) {
    log({ event: "flat_ab.arm_start", arm: arm.id });
    const built = await buildLocalEvalStores({
      dataDir: options.dataDir,
      flatBandMode: arm.flatBandMode,
      labelAlignment: arm.labelAlignment,
      log: () => undefined,
    });

    // Analogue class balance inside the window (what the neighbourhoods are made of).
    const balance = { UP: 0, DOWN: 0, FLAT: 0 };
    let n = 0;
    for (const pair of PAIRS) {
      const rows = await built.stores.analogueStore.getMaturedOutcomes(pair, "9999-12-31");
      for (const r of rows) {
        if (r.horizon !== 1 || r.decisionDate < options.window.start || r.decisionDate > options.window.end) continue;
        balance[r.direction] += 1;
        n += 1;
      }
    }

    const records: readonly DayRecord[] = await collectDayRecords(built.stores, { window: options.window });
    const own = sessionOf(arm.labelAlignment);
    const other: TargetSession = own === "after_decision_date" ? "on_decision_date" : "after_decision_date";
    const result: ArmResult = {
      arm,
      analogueClassBalance:
        n === 0 ? { UP: 0, DOWN: 0, FLAT: 0, n } : { UP: balance.UP / n, DOWN: balance.DOWN / n, FLAT: balance.FLAT / n, n },
      ownSession: own,
      directional: scoreAccuracy(records, "directional", own),
      firing: scoreAccuracy(records, "firing", own),
      directionalOtherSession: scoreAccuracy(records, "directional", other),
      directionalDays: records.filter((r) => r.direction !== "FLAT").length,
      firingDays: records.filter((r) => r.fires).length,
      totalDays: records.length,
    };
    results.push(result);
    log({ event: "flat_ab.arm_done", arm: arm.id, totalDays: result.totalDays, directionalDays: result.directionalDays, firingDays: result.firingDays });
  }
  return results;
}

const pct = (x: number): string => (x * 100).toFixed(2);
const ci = (i: { lo: number; hi: number }): string => `[${(i.lo * 100).toFixed(2)}, ${(i.hi * 100).toFixed(2)}]pp`;

/** Plain, verdict-free research-log lines for one A/B run. */
export function renderFlatAbLines(
  results: readonly ArmResult[],
  window: { start: string; end: string },
): readonly string[] {
  const lines: string[] = [
    `Window: ${window.start}..${window.end} (local in-memory stores built from data/*_D1.csv; hosted untouched). Yardstick: sign of the realised session's open-to-close move (FLAT/unavailable days excluded). Live behaviour unchanged.`,
  ];
  for (const r of results) {
    const d = r.directional;
    const f = r.firing;
    const b = r.analogueClassBalance;
    lines.push(
      `Arm ${r.arm.id} (flatBand=${r.arm.flatBandMode}, label=${r.arm.labelAlignment}): analogue classes UP ${pct(b.UP)}% DOWN ${pct(b.DOWN)}% FLAT ${pct(b.FLAT)}% (n=${b.n}); days=${r.totalDays} directional=${r.directionalDays} firing(>=0.55)=${r.firingDays}`,
    );
    lines.push(
      `  directional days vs own session: scored=${d.scored} model=${pct(d.model.rate)}% baseline=${pct(d.baseline.rate)}% delta=${pct(d.delta)}pp raw95=${ci(d.deltaCiRaw)} discounted(/${d.discountFactor})95=${ci(d.deltaCiDiscounted)}; UP-calls ${pct(d.byDirection.UP.rate)}% (n=${d.byDirection.UP.n}) DOWN-calls ${pct(d.byDirection.DOWN.rate)}% (n=${d.byDirection.DOWN.n})`,
    );
    lines.push(
      `  firing days vs own session: scored=${f.scored} model=${pct(f.model.rate)}% [${pct(f.model.ci95.lo)}, ${pct(f.model.ci95.hi)}] baseline=${pct(f.baseline.rate)}% delta=${pct(f.delta)}pp discounted95=${ci(f.deltaCiDiscounted)}`,
    );
    const o = r.directionalOtherSession;
    lines.push(
      `  directional days vs the OTHER session (${o.session}): scored=${o.scored} model=${pct(o.model.rate)}% baseline=${pct(o.baseline.rate)}% delta=${pct(o.delta)}pp`,
    );
  }
  lines.push("Note: evidence for human interpretation; the operator decides whether any live definition changes.");
  return lines;
}
