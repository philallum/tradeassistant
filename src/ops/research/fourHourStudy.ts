// 4H confirmation study (H11): does the forming-4H-candle state, read the way the live
// intraday-validation layer reads it, carry information about what happens NEXT?
//
// Live timing: the validation job reads the forming 4H bar (04:00-08:00 UTC) mid-bar, around
// 07:00 UTC, on the morning of the target session. This study rebuilds that read from the
// archived hourly bars (data/hourly, 2021-2024 only): open of the 04:00 hour, high/low over the
// 04:00-06:00 hours, close-so-far = close of the 06:00 hour.
//
// MECHANICAL-OVERLAP WARNING: those hours are INSIDE the target session. Scoring the 4H state
// against the full-session sign therefore partly measures the same move twice. The honest
// outcome is the move REMAINING after the read: from the 07:00 UTC price to the session close.
// Both are reported; the remaining-move result is the one H11 tests.
//
// Deterministic and offline: reads only local files.
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { Pair } from "../../ingestion/types.js";
import { computeCandleFeatures, isCandleComputable } from "../../intraday-validation/features.js";
import { classifyState } from "../../intraday-validation/classify.js";
import { pipSize } from "../../trade-sim/pip.js";
import { BOOTSTRAP_ITERATIONS, BOOTSTRAP_SEED, MIN_REPORTABLE_SCORED } from "./researchProtocol.js";
import { blockBootstrap, weekBlock } from "./researchStats.js";
import type { ResearchRow } from "./researchDataset.js";

interface HourBar {
  readonly openMs: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
}

export type FourHourGroup = "supports" | "neutral" | "contradicts";

export interface FourHourObservation {
  readonly row: ResearchRow;
  readonly group: FourHourGroup;
  /** Signed pips in the called direction from the 07:00 UTC price to the session close. */
  readonly remainingPips: number;
  /** Called direction agrees with the remaining move (null when the remaining move is exactly zero). */
  readonly remainingHit: boolean | null;
}

export interface FourHourGroupResult {
  readonly group: FourHourGroup;
  readonly days: number;
  readonly remainingScored: number;
  readonly remainingHit: number;
  readonly fullSessionScored: number;
  readonly fullSessionHit: number;
  readonly meanRemainingPips: number;
}

export interface FourHourResult {
  readonly subset: "directional" | "firing";
  readonly rowsInHourlyRange: number;
  readonly observed: number;
  readonly skippedNoBars: number;
  readonly groups: readonly FourHourGroupResult[];
  readonly diffRemaining: number;
  readonly diffCi95: { readonly lo: number; readonly hi: number };
  readonly diffP: number;
  readonly diffFullSession: number;
  readonly supportsScored: number;
  readonly contradictsScored: number;
  /** Adequate sample on both sides (each >= MIN_REPORTABLE_SCORED / 2). */
  readonly adequate: boolean;
}

async function loadHourly(dir: string, pair: Pair): Promise<Map<number, HourBar>> {
  const text = await readFile(join(dir, `${pair}_H1.jsonl`), "utf8");
  const map = new Map<number, HourBar>();
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) continue;
    const o = JSON.parse(line) as HourBar;
    map.set(o.openMs, o);
  }
  return map;
}

const HOUR_MS = 3_600_000;

/** Build the forming 4H bar (04:00-06:59 UTC) of a calendar date from hourly bars; null when incomplete. */
export function formingBar(bars: ReadonlyMap<number, HourBar>, date: string): {
  open: number;
  high: number;
  low: number;
  currentPrice: number;
} | null {
  const base = Date.parse(`${date}T04:00:00Z`);
  const hours = [0, 1, 2].map((k) => bars.get(base + k * HOUR_MS));
  if (hours.some((h) => h === undefined)) return null;
  const hs = hours as HourBar[];
  return {
    open: (hs[0] as HourBar).open,
    high: Math.max(...hs.map((h) => h.high)),
    low: Math.min(...hs.map((h) => h.low)),
    currentPrice: (hs[2] as HourBar).close,
  };
}

/** Observe the 4H state for each directional row inside the hourly archive's range. */
export async function observeFourHour(rows: readonly ResearchRow[], hourlyDir: string): Promise<{
  readonly observations: readonly FourHourObservation[];
  readonly inRange: number;
  readonly skipped: number;
}> {
  const pairs = [...new Set(rows.map((r) => r.pair))];
  const byPair = new Map<Pair, Map<number, HourBar>>();
  for (const p of pairs) byPair.set(p, await loadHourly(hourlyDir, p));

  const observations: FourHourObservation[] = [];
  let inRange = 0;
  let skipped = 0;
  for (const r of rows) {
    if (r.direction === "FLAT" || r.targetDate === null || r.targetClose === null) continue;
    const bars = byPair.get(r.pair) as Map<number, HourBar>;
    if (r.targetDate < "2021-01-04" || r.targetDate > "2024-12-30") continue;
    inRange += 1;
    const bar = formingBar(bars, r.targetDate);
    if (bar === null || !isCandleComputable(bar)) {
      skipped += 1;
      continue;
    }
    const state = classifyState(computeCandleFeatures(bar), r.direction);
    const group: FourHourGroup | null =
      state === "SUPPORTS" || state === "STRONGLY_SUPPORTS"
        ? "supports"
        : state === "CONTRADICTS" || state === "STRONGLY_CONTRADICTS"
          ? "contradicts"
          : state === "NEUTRAL"
            ? "neutral"
            : null;
    if (group === null) continue;
    const move = (r.targetClose - bar.currentPrice) / pipSize(r.pair);
    const signed = r.direction === "UP" ? move : -move;
    observations.push({
      row: r,
      group,
      remainingPips: signed,
      remainingHit: signed === 0 ? null : signed > 0,
    });
  }
  return { observations, inRange, skipped };
}

function rate(items: readonly { hit: boolean | null }[]): { scored: number; hit: number } {
  const scored = items.filter((i) => i.hit !== null);
  return { scored: scored.length, hit: scored.length === 0 ? 0 : scored.filter((i) => i.hit === true).length / scored.length };
}

/** Summarise the 4H study for a subset of the observations. */
export function summariseFourHour(
  observations: readonly FourHourObservation[],
  subset: "directional" | "firing",
  inRange: number,
  skipped: number,
): FourHourResult {
  const subsetObs = observations.filter((o) => subset === "directional" || o.row.fires);
  const groups: FourHourGroupResult[] = (["supports", "neutral", "contradicts"] as const).map((g) => {
    const items = subsetObs.filter((o) => o.group === g);
    const rem = rate(items.map((o) => ({ hit: o.remainingHit })));
    const full = rate(items.map((o) => ({ hit: o.row.hit })));
    return {
      group: g,
      days: items.length,
      remainingScored: rem.scored,
      remainingHit: rem.hit,
      fullSessionScored: full.scored,
      fullSessionHit: full.hit,
      meanRemainingPips: items.length === 0 ? 0 : items.reduce((a, o) => a + o.remainingPips, 0) / items.length,
    };
  });

  const sup = subsetObs.filter((o) => o.group === "supports" && o.remainingHit !== null);
  const con = subsetObs.filter((o) => o.group === "contradicts" && o.remainingHit !== null);
  const diffStat = (sample: readonly FourHourObservation[]): number => {
    const s = sample.filter((o) => o.group === "supports" && o.remainingHit !== null);
    const c = sample.filter((o) => o.group === "contradicts" && o.remainingHit !== null);
    if (s.length === 0 || c.length === 0) return Number.NaN;
    return s.filter((o) => o.remainingHit === true).length / s.length - c.filter((o) => o.remainingHit === true).length / c.length;
  };
  const boot = blockBootstrap([...sup, ...con], (o) => weekBlock(o.row.date), diffStat, BOOTSTRAP_ITERATIONS, BOOTSTRAP_SEED + 9000);

  const fullDiff = (() => {
    const s = subsetObs.filter((o) => o.group === "supports" && o.row.hit !== null);
    const c = subsetObs.filter((o) => o.group === "contradicts" && o.row.hit !== null);
    if (s.length === 0 || c.length === 0) return 0;
    return s.filter((o) => o.row.hit === true).length / s.length - c.filter((o) => o.row.hit === true).length / c.length;
  })();

  return {
    subset,
    rowsInHourlyRange: inRange,
    observed: subsetObs.length,
    skippedNoBars: skipped,
    groups,
    diffRemaining: Number.isFinite(boot.estimate) ? boot.estimate : 0,
    diffCi95: boot.ci95,
    diffP: boot.p,
    diffFullSession: fullDiff,
    supportsScored: sup.length,
    contradictsScored: con.length,
    adequate: Math.min(sup.length, con.length) >= MIN_REPORTABLE_SCORED / 2,
  };
}
