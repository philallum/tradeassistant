/**
 * Pure shaper for the six strategy cards of the selected pair. Each card carries the
 * strategy's direction and strength, a plain-English meaning of that reading, the technical
 * rationale (secondary), and the strategy's recent track record.
 *
 * Pure: no fetch, DOM, clock, or core import. Every number is copied from the snapshot's
 * confluence cell, the replay track-record row, or the recorded signal-scorecard row; nothing
 * is recomputed or fabricated. A missing record is stated as such, never filled with a default.
 * Each card carries TWO histories: `record` (replay-based, classical strategies + pattern) and
 * `recorded` (the dated scorecard, covering all six signals incl. the non-replayable third_party).
 */
import type {
  Confluence,
  ConfluenceCell,
  ConfluencePair,
  ConfluenceStrategyId,
  Direction,
  SignalScorecard,
  TrackRecord,
} from "../api/types";
import { formatDirection } from "./format";

/**
 * The six Strategy_Ids in canonical card order. Mirrors the backend engine order and the
 * strict parser's `CONFLUENCE_STRATEGY_IDS` in `../api/snapshot.ts`; kept in lockstep by hand.
 */
export const STRATEGY_IDS: readonly ConfluenceStrategyId[] = [
  "trend",
  "breakout",
  "range",
  "reversal",
  "custom_pattern",
  "third_party",
];

/** A record with fewer directional calls than this is flagged as a small sample. */
export const SMALL_SAMPLE_CALLS = 20;

/** Local empty recorded-scorecard default so the shaper needs no non-type import. */
const EMPTY_SIGNAL_SCORECARD: SignalScorecard = { totalRecorded: 0, rows: [] };

export type RecordKind = "measured" | "no-calls" | "display-only" | "not-measured";

export interface RecordVM {
  readonly kind: RecordKind;
  readonly calls: number;
  readonly correct: number;
  /** True when `calls` is below {@link SMALL_SAMPLE_CALLS}. */
  readonly smallSample: boolean;
  /** e.g. "Right 12 of 31 recent calls" or "Display-only, not scored". */
  readonly text: string;
}

/** The recorded (dated, not replayed) direction tally for one signal on one pair. */
export interface RecordedVM {
  /** "measured" = ≥1 matured call; "pending-only" = recorded but none matured yet; "none" = nothing recorded. */
  readonly kind: "measured" | "pending-only" | "none";
  readonly calls: number;
  readonly correct: number;
  readonly pending: number;
  /** e.g. "Recorded: right 3 of 5 (2 pending)." or "Recorded: 4 pending, none scored yet." */
  readonly text: string;
}

export interface StrategyCardVM {
  readonly strategyId: ConfluenceStrategyId;
  readonly title: string;
  readonly displayOnly: boolean;
  readonly available: boolean;
  readonly direction: Direction | null;
  readonly glyph: string;
  readonly directionLabel: string;
  readonly strengthText: string;
  /** Plain-English reading of the signal, e.g. "Fast average above slow average and rising". */
  readonly meaning: string;
  /** The strategy's own technical rationale, or the unavailable reason. */
  readonly detail: string;
  readonly record: RecordVM;
  /** The RECORDED direction tally (dated `signal_predictions`), covering all six signals. */
  readonly recorded: RecordedVM;
  /** True when this card is one side of a strong disagreement (a Split pair). */
  readonly conflicting: boolean;
  readonly accessibleName: string;
}

const TITLES: Readonly<Record<ConfluenceStrategyId, string>> = {
  trend: "Trend",
  breakout: "Breakout",
  range: "Range",
  reversal: "Reversal",
  custom_pattern: "Pattern",
  third_party: "Third party",
};

/** What each strategy's reading means, in words a trader would use. */
const MEANING: Readonly<Record<ConfluenceStrategyId, Readonly<Record<Direction, string>>>> = {
  trend: {
    UP: "Short-term average is above the long-term average and rising.",
    DOWN: "Short-term average is below the long-term average and falling.",
    FLAT: "No clear trend.",
  },
  breakout: {
    UP: "Price closed above its recent high.",
    DOWN: "Price closed below its recent low.",
    FLAT: "Price is still inside its recent range.",
  },
  range: {
    UP: "Price is stretched low and oversold. A bounce is possible.",
    DOWN: "Price is stretched high and overbought. A pullback is possible.",
    FLAT: "Price is not at a range extreme.",
  },
  reversal: {
    UP: "A sell-off looks exhausted. A turn up is possible.",
    DOWN: "A rally looks exhausted. A turn down is possible.",
    FLAT: "No exhausted move to fade.",
  },
  custom_pattern: {
    UP: "Past charts of this shape mostly rose next.",
    DOWN: "Past charts of this shape mostly fell next.",
    FLAT: "Past charts of this shape gave no clear direction.",
  },
  third_party: {
    UP: "An outside provider leans buy.",
    DOWN: "An outside provider leans sell.",
    FLAT: "An outside provider says hold.",
  },
};

const GLYPH: Readonly<Record<Direction, string>> = { UP: "\u25B2", DOWN: "\u25BC", FLAT: "\u2013" };

function shapeRecord(
  id: ConfluenceStrategyId,
  displayOnly: boolean,
  pair: string,
  track: TrackRecord,
): RecordVM {
  if (displayOnly) {
    return { kind: "display-only", calls: 0, correct: 0, smallSample: false, text: "Display-only, not scored." };
  }
  const row = track.strategies.find((r) => r.pair === pair && r.strategyId === id);
  if (row === undefined) {
    return { kind: "not-measured", calls: 0, correct: 0, smallSample: false, text: "Track record not measured." };
  }
  if (row.calls === 0) {
    return { kind: "no-calls", calls: 0, correct: 0, smallSample: true, text: "No recent calls." };
  }
  const smallSample = row.calls < SMALL_SAMPLE_CALLS;
  return {
    kind: "measured",
    calls: row.calls,
    correct: row.correct,
    smallSample,
    text: `Right ${row.correct} of ${row.calls} recent calls${smallSample ? " (small sample)" : ""}.`,
  };
}

/**
 * Shape the RECORDED tally for one signal on one pair from the dated scorecard. Unlike the
 * replay `record`, this applies to ALL six signals (including the display-only `third_party`,
 * which cannot be replayed) — recording it is the whole point of the scorecard.
 */
function shapeRecorded(
  id: ConfluenceStrategyId,
  pair: string,
  scorecard: SignalScorecard,
): RecordedVM {
  const row = scorecard.rows.find((r) => r.pair === pair && r.strategyId === id);
  if (row === undefined || (row.calls === 0 && row.pending === 0)) {
    return { kind: "none", calls: 0, correct: 0, pending: 0, text: "Recorded: nothing yet." };
  }
  if (row.calls === 0) {
    return {
      kind: "pending-only",
      calls: 0,
      correct: 0,
      pending: row.pending,
      text: `Recorded: ${row.pending} pending, none scored yet.`,
    };
  }
  const pendingText = row.pending > 0 ? ` (${row.pending} pending)` : "";
  return {
    kind: "measured",
    calls: row.calls,
    correct: row.correct,
    pending: row.pending,
    text: `Recorded: right ${row.correct} of ${row.calls}${pendingText}.`,
  };
}

function shapeCard(
  cell: ConfluenceCell,
  pair: string,
  displayOnly: boolean,
  conflicting: boolean,
  track: TrackRecord,
  scorecard: SignalScorecard,
): StrategyCardVM {
  const title = TITLES[cell.strategyId];
  const record = shapeRecord(cell.strategyId, displayOnly, pair, track);
  const recorded = shapeRecorded(cell.strategyId, pair, scorecard);
  const suffix = displayOnly ? " (display-only)" : "";
  if (!cell.available) {
    return {
      strategyId: cell.strategyId,
      title,
      displayOnly,
      available: false,
      direction: null,
      glyph: GLYPH.FLAT,
      directionLabel: "Unavailable",
      strengthText: "",
      meaning: "No reading today.",
      detail: cell.reason,
      record,
      recorded,
      conflicting,
      accessibleName: `${pair} ${title}${suffix}: unavailable. ${cell.reason}. ${record.text} ${recorded.text}`,
    };
  }
  const directionLabel = formatDirection(cell.direction);
  const strengthText = cell.direction === "FLAT" ? "" : `Strength ${cell.strength.toFixed(2)}`;
  return {
    strategyId: cell.strategyId,
    title,
    displayOnly,
    available: true,
    direction: cell.direction,
    glyph: GLYPH[cell.direction],
    directionLabel,
    strengthText,
    meaning: MEANING[cell.strategyId][cell.direction],
    detail: cell.rationale,
    record,
    recorded,
    conflicting,
    accessibleName:
      `${pair} ${title}${suffix}: ${directionLabel}${strengthText ? `, ${strengthText.toLowerCase()}` : ""}. ` +
      `${MEANING[cell.strategyId][cell.direction]} ${record.text} ${recorded.text}`,
  };
}

/**
 * Shape the six cards for one pair, always in the fixed order Trend, Breakout, Range,
 * Reversal, Pattern, Third party. A pair with no confluence row yields six unavailable cards
 * so the grid never changes shape.
 */
export function shapeStrategyCards(
  pairRow: ConfluencePair | null,
  pair: string,
  weights: Confluence["weights"],
  track: TrackRecord,
  scorecard: SignalScorecard = EMPTY_SIGNAL_SCORECARD,
): readonly StrategyCardVM[] {
  const opposing = new Set<ConfluenceStrategyId>(
    pairRow?.status === "CONFLICT_FLAT" ? pairRow.opposingStrategyIds : [],
  );
  return STRATEGY_IDS.map((id) => {
    const displayOnly = weights[id] === 0;
    const cell: ConfluenceCell =
      pairRow?.cells.find((c) => c.strategyId === id) ?? {
        strategyId: id,
        available: false,
        reason: "no data for this pair",
      };
    return shapeCard(cell, pair, displayOnly, opposing.has(id), track, scorecard);
  });
}
