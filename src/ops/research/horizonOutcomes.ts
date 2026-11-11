// Multi-day and target-before-stop outcomes, and the analogue vote for each (pure; no I/O).
// Definitions are fixed in docs/research/PRE-REGISTRATION-3.md.
//
// Index convention (the live one): `i` is the candle labelled with the decision date; the trade
// enters at the OPEN of candle i+1. An analogue at candle j votes only if its whole outcome window
// has closed by candle i, so nothing after the decision date reaches the call.
import { computeAtr14 } from "../../confidence/atr.js";
import type { Candle } from "../../guard/types.js";

export const OUTCOMES = ["H1", "H3", "H5", "BR"] as const;
export type OutcomeId = (typeof OUTCOMES)[number];

/** Candles after entry that each outcome needs (its window is i+1 .. i+span). */
export const OUTCOME_SPAN: Readonly<Record<OutcomeId, number>> = { H1: 1, H3: 3, H5: 5, BR: 5 };

/** Bracket width in ATR and maximum holding sessions. */
export const BRACKET_ATR = 1;
export const BRACKET_MAX_BARS = 5;

export type BracketKind = "UP_FIRST" | "DOWN_FIRST" | "AMBIGUOUS" | "EXPIRED";

export interface RealisedOutcome {
  /** Winning side for scoring (null = not scoreable: zero move, ambiguous or expired bracket). */
  readonly side: "UP" | "DOWN" | null;
  /** Pips earned by an UP position (before cost); a DOWN position earns the negative, except ambiguous. */
  readonly upPips: number;
  /** Bracket only: kind, and the bracket width in pips. */
  readonly kind?: BracketKind;
  readonly atrPips?: number;
}

/** ATR14 for each candle index, from the 60 candles before it (0 when undefined). */
export function atrByIndex(candles: readonly Candle[]): number[] {
  const out = new Array<number>(candles.length).fill(0);
  for (let i = 0; i < candles.length; i += 1) out[i] = computeAtr14(candles.slice(Math.max(0, i - 60), i));
  return out;
}

/** Close of i+h vs open of i+1, in pips. Null when the window runs past the data. */
export function horizonMove(candles: readonly Candle[], i: number, h: number, pip: number): RealisedOutcome | null {
  const entry = candles[i + 1];
  const exit = candles[i + h];
  if (entry === undefined || exit === undefined) return null;
  const upPips = (exit.close - entry.open) / pip;
  return { side: upPips > 0 ? "UP" : upPips < 0 ? "DOWN" : null, upPips };
}

/** Symmetric bracket of BRACKET_ATR x atr around the open of i+1, at most BRACKET_MAX_BARS sessions. */
export function bracketOutcome(candles: readonly Candle[], i: number, atr: number, pip: number): RealisedOutcome | null {
  const entryCandle = candles[i + 1];
  if (entryCandle === undefined || candles[i + BRACKET_MAX_BARS] === undefined || !(atr > 0)) return null;
  const entry = entryCandle.open;
  const width = BRACKET_ATR * atr;
  const upper = entry + width;
  const lower = entry - width;
  const atrPips = width / pip;
  for (let k = i + 1; k <= i + BRACKET_MAX_BARS; k += 1) {
    const c = candles[k] as Candle;
    const up = c.high >= upper;
    const down = c.low <= lower;
    if (up && down) return { side: null, upPips: 0, kind: "AMBIGUOUS", atrPips };
    if (up) return { side: "UP", upPips: atrPips, kind: "UP_FIRST", atrPips };
    if (down) return { side: "DOWN", upPips: -atrPips, kind: "DOWN_FIRST", atrPips };
  }
  const last = candles[i + BRACKET_MAX_BARS] as Candle;
  return { side: null, upPips: (last.close - entry) / pip, kind: "EXPIRED", atrPips };
}

/** The realised outcome of one type at candle i. */
export function realise(
  outcome: OutcomeId,
  candles: readonly Candle[],
  i: number,
  atr: readonly number[],
  pip: number,
): RealisedOutcome | null {
  if (outcome === "BR") return bracketOutcome(candles, i, atr[i] ?? 0, pip);
  return horizonMove(candles, i, OUTCOME_SPAN[outcome], pip);
}

/** Net pips for a position on `call` given the realised outcome (cost paid once). Ambiguous = loss. */
export function netPips(call: "UP" | "DOWN", r: RealisedOutcome, cost: number): number {
  if (r.kind === "AMBIGUOUS") return -(r.atrPips ?? 0) - cost;
  return (call === "UP" ? r.upPips : -r.upPips) - cost;
}

/** Precomputed per-index outcomes for a pair, so analogue votes are O(1) lookups. */
export interface PairOutcomeTable {
  readonly candles: readonly Candle[];
  readonly indexByDate: ReadonlyMap<string, number>;
  readonly byOutcome: Readonly<Record<OutcomeId, readonly (RealisedOutcome | null)[]>>;
}

export function buildOutcomeTable(candles: readonly Candle[], pip: number): PairOutcomeTable {
  const atr = atrByIndex(candles);
  const indexByDate = new Map<string, number>();
  candles.forEach((c, k) => indexByDate.set(c.date, k));
  const byOutcome = {} as Record<OutcomeId, (RealisedOutcome | null)[]>;
  for (const o of OUTCOMES) byOutcome[o] = candles.map((_, k) => realise(o, candles, k, atr, pip));
  return { candles, indexByDate, byOutcome };
}

export const SHRINKAGE_WEIGHT = 10;

export interface AnalogueCall {
  readonly direction: "UP" | "DOWN" | "FLAT";
  readonly confidence: number;
  /** Analogues that voted (matured and with a decisive result). */
  readonly n: number;
}

/**
 * The pattern's call for an outcome at candle i: majority of the analogues' own results for the
 * same outcome. An analogue at j votes only if j + span < i: its window j+1..j+span must have closed
 * by candle i-1, the last candle known when the job runs (candle i is the decision date's own session).
 */
export function analogueCall(
  table: PairOutcomeTable,
  i: number,
  analogueDates: readonly string[],
  outcome: OutcomeId,
): AnalogueCall {
  const span = OUTCOME_SPAN[outcome];
  let up = 0;
  let down = 0;
  for (const a of analogueDates) {
    const j = table.indexByDate.get(a);
    // Candle i (the decision date's own session) has NOT traded when the job runs, so the
    // analogue's window j+1..j+span must end at i-1 at the latest (matches the live isMatured).
    if (j === undefined || j + span >= i) continue;
    const r = table.byOutcome[outcome][j];
    if (r === null || r === undefined || r.side === null) continue;
    if (r.side === "UP") up += 1;
    else down += 1;
  }
  const n = up + down;
  if (n === 0 || up === down) return { direction: "FLAT", confidence: 0.5, n };
  const share = Math.max(up, down) / n;
  const confidence = (n / (n + SHRINKAGE_WEIGHT)) * share + (SHRINKAGE_WEIGHT / (n + SHRINKAGE_WEIGHT)) * 0.5;
  return { direction: up > down ? "UP" : "DOWN", confidence, n };
}
