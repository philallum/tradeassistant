// Read-only measurements of the two unvalidated layers (Task 13).
//
// Both questions were pre-registered in `walk-forward/evidenceProtocol.ts`:
//   1. confluence-adds-information   - does classical agreement with the pattern call help?
//   2. intraday-delta-adds-information - do days the 4H bar "supports" resolve better than days
//      it "contradicts"?
//
// Pure functions over rows already recorded by the live system (`signal_predictions`,
// `intraday_validations`). Nothing is written back and nothing feeds firing. Until both groups
// have enough matured days the result says so plainly instead of reporting a difference.
import type { SignalPredictionRow } from "../../dashboard/signalScorecard.js";
import type { IntradayValidationRecord, ValidationState } from "../../intraday-validation/types.js";
import { summarizeRate, type RateSummary } from "../../performance/evidenceStats.js";

/** Both compared groups need at least this many matured days before a difference is reported. */
export const MIN_GROUP_DAYS = 30;

const CLASSICAL = ["trend", "breakout", "range", "reversal"] as const;

export interface GroupResult {
  readonly label: string;
  readonly rate: RateSummary;
}

export interface QuestionResult {
  readonly id: "confluence-adds-information" | "intraday-delta-adds-information";
  readonly groups: readonly GroupResult[];
  /** True when every compared group has at least {@link MIN_GROUP_DAYS} matured days. */
  readonly adequate: boolean;
  readonly summary: string;
}

const pct = (x: number): string => (x * 100).toFixed(1);

function describe(g: GroupResult): string {
  const ci = g.rate.ci95;
  return `${g.label}: ${pct(g.rate.rate)}% of ${g.rate.n} matured (95% ${pct(ci.lo)}-${pct(ci.hi)}%)`;
}

function conclude(
  id: QuestionResult["id"],
  groups: readonly GroupResult[],
  better: GroupResult,
  worse: GroupResult,
): QuestionResult {
  const adequate = better.rate.n >= MIN_GROUP_DAYS && worse.rate.n >= MIN_GROUP_DAYS;
  const lead = adequate
    ? `Difference ${((better.rate.rate - worse.rate.rate) * 100).toFixed(1)}pp (${better.label} minus ${worse.label}); intervals ${better.rate.ci95.lo > worse.rate.ci95.hi ? "do not overlap" : "overlap"}.`
    : `Not enough matured days yet (need ${MIN_GROUP_DAYS} in each compared group); no difference is reported.`;
  return { id, groups, adequate, summary: `${groups.map(describe).join("; ")}. ${lead}` };
}

/** Realised outcome of the system's own call per (date, pair), from the recorded ledger. */
function patternCalls(predictions: readonly SignalPredictionRow[]): Map<string, SignalPredictionRow> {
  const out = new Map<string, SignalPredictionRow>();
  for (const p of predictions) if (p.strategyId === "custom_pattern") out.set(`${p.decisionDate}:${p.pair}`, p);
  return out;
}

/** Pre-registered question 1: does classical agreement add information to the pattern call? */
export function evaluateConfluenceQuestion(predictions: readonly SignalPredictionRow[]): QuestionResult {
  const byKey = new Map<string, SignalPredictionRow[]>();
  for (const p of predictions) {
    const k = `${p.decisionDate}:${p.pair}`;
    const arr = byKey.get(k);
    if (arr === undefined) byKey.set(k, [p]);
    else arr.push(p);
  }
  const tally = { alone: { h: 0, n: 0 }, aligned: { h: 0, n: 0 }, opposed: { h: 0, n: 0 } };
  for (const [key, call] of patternCalls(predictions)) {
    if (call.predictedDirection === "FLAT") continue;
    if (call.realizedDirection === null || call.realizedDirection === "FLAT") continue;
    const hit = call.realizedDirection === call.predictedDirection;
    const classical = (byKey.get(key) ?? []).filter((r) => (CLASSICAL as readonly string[]).includes(r.strategyId));
    const agree = classical.filter((r) => r.predictedDirection === call.predictedDirection).length;
    const oppose = classical.filter(
      (r) => r.predictedDirection !== "FLAT" && r.predictedDirection !== call.predictedDirection,
    ).length;
    tally.alone.n += 1;
    if (hit) tally.alone.h += 1;
    if (agree >= 2 && oppose === 0) {
      tally.aligned.n += 1;
      if (hit) tally.aligned.h += 1;
    } else if (oppose >= 1) {
      tally.opposed.n += 1;
      if (hit) tally.opposed.h += 1;
    }
  }
  const g = (label: string, t: { h: number; n: number }): GroupResult => ({ label, rate: summarizeRate(t.h, t.n) });
  const alone = g("pattern call alone (all directional days)", tally.alone);
  const aligned = g("pattern call + classical agreement (>=2 agree, none oppose)", tally.aligned);
  const opposed = g("pattern call with a classical signal opposing", tally.opposed);
  const result = conclude("confluence-adds-information", [alone, aligned, opposed], aligned, alone);
  return {
    ...result,
    summary: `${result.summary} Approximation: the stored ledger has directions but not strengths, so "aligned" is a simple agreement count, not the engine's weighted ALIGNED_* status.`,
  };
}

const SUPPORT: readonly ValidationState[] = ["STRONGLY_SUPPORTS", "SUPPORTS"];
const CONTRADICT: readonly ValidationState[] = ["CONTRADICTS", "STRONGLY_CONTRADICTS"];

/** Pre-registered question 2: do supported days resolve better than contradicted days? */
export function evaluateIntradayQuestion(
  validations: readonly Pick<IntradayValidationRecord, "decisionDate" | "pair" | "originalDirection" | "result">[],
  predictions: readonly SignalPredictionRow[],
): QuestionResult {
  const calls = patternCalls(predictions);
  const tally = {
    support: { h: 0, n: 0 },
    neutral: { h: 0, n: 0 },
    contradict: { h: 0, n: 0 },
  };
  for (const v of validations) {
    if (v.originalDirection === "FLAT") continue;
    const call = calls.get(`${v.decisionDate}:${v.pair}`);
    if (call === undefined || call.realizedDirection === null || call.realizedDirection === "FLAT") continue;
    const hit = call.realizedDirection === v.originalDirection;
    const state = v.result.state;
    const bucket = SUPPORT.includes(state) ? tally.support : CONTRADICT.includes(state) ? tally.contradict : state === "NEUTRAL" ? tally.neutral : null;
    if (bucket === null) continue;
    bucket.n += 1;
    if (hit) bucket.h += 1;
  }
  const g = (label: string, t: { h: number; n: number }): GroupResult => ({ label, rate: summarizeRate(t.h, t.n) });
  const support = g("4H bar supports the daily call", tally.support);
  const neutral = g("4H bar neutral", tally.neutral);
  const contradict = g("4H bar contradicts the daily call", tally.contradict);
  return conclude("intraday-delta-adds-information", [support, neutral, contradict], support, contradict);
}
