/**
 * Pure Confluence_Matrix → panel view-model shaper (property-testable — Req 19, Req 12.13).
 *
 * This module is PURE: it performs no `fetch`, touches no DOM, reads no clock (`Date.now()`),
 * imports no charting library, and imports NOTHING from the deterministic core (`src/`). It is
 * a deterministic function of its single `slice` argument alone — identical input yields
 * identical output (Requirement 12.13) — which is what lets the property suite exercise it
 * exhaustively without a browser, a network, or a clock.
 *
 * It turns the snapshot's per-run {@link Confluence} slice into the inert, display-only view
 * model the Setups tab's Confluence panel renders. Every rendered value is drawn from the
 * slice; the shaper recomputes nothing and fabricates nothing beyond deterministic display
 * labels and presentation metadata (Requirement 11.10, 12.14). Colour is NEVER the only cue:
 * each direction carries a word plus a glyph, and the per-status label/marker text stay present
 * whatever the validation state (Requirements 12.4, 14.1, 14.2).
 */

import type {
  Confluence,
  ConfluenceCell,
  ConfluencePair,
  ConfluenceStatus,
  ConfluenceStrategyId,
  Direction,
  Pair,
} from "../api/types";
import { PAIRS } from "../api/types";
import { formatDirection } from "./format";

/** A Strategy_Id as rendered in the panel (the wire `ConfluenceStrategyId`). */
export type StrategyId = ConfluenceStrategyId;

/**
 * The six Strategy_Ids in canonical column order. The web app has no shared constant, so
 * this mirrors the backend engine order and the strict parser's `CONFLUENCE_STRATEGY_IDS`
 * in `../api/snapshot.ts`; kept in lockstep by hand.
 */
export const STRATEGY_IDS: readonly StrategyId[] = [
  "trend",
  "breakout",
  "range",
  "reversal",
  "custom_pattern",
  "third_party",
];

/** Fixed display copy — referenced in the panel header and the detail region (Req 12.8). */
const EMPTY_TEXT = "no confluence data for this run";
const VALIDATION_LABEL = "Un-validated";
const STRENGTH_NOTE = "Strength is not a probability";

/** Direction glyphs. Colour is never the only cue — every direction pairs a word with a glyph. */
const GLYPH_UP = "▲";
const GLYPH_DOWN = "▼";
const GLYPH_FLAT = "–";
const GLYPH_UNAVAILABLE = "–";

/** The human header per Strategy_Id column. `third_party` gains a display-only suffix below. */
const STRATEGY_HEADERS: Readonly<Record<StrategyId, string>> = {
  trend: "Trend",
  breakout: "Breakout",
  range: "Range",
  reversal: "Reversal",
  custom_pattern: "Custom pattern",
  third_party: "Third party",
};

/** The complete, display-only view model for the Confluence panel. */
export interface ConfluenceViewModel {
  readonly empty: boolean;
  readonly emptyText: string;
  readonly validationLabel: string;
  readonly validated: boolean;
  readonly strengthNote: string;
  readonly summary: SummaryVM;
  readonly columns: readonly ColumnVM[];
  readonly rows: readonly RowVM[];
}

/** The Confluence_Summary counts over the rendered rows (Requirement 12.17). */
export interface SummaryVM {
  readonly aligned: number;
  readonly conflict: number;
  readonly neutral: number;
  readonly text: string;
}

/** One column header. `displayOnly` is true for a zero-weight Strategy_Id (Requirement 12.9). */
export interface ColumnVM {
  readonly strategyId: StrategyId;
  readonly header: string;
  readonly displayOnly: boolean;
}

/** Diverging-gauge presentation metadata over the fixed `[-1, 1]` interval (Requirement 12.16). */
export interface GaugeVM {
  readonly min: -1;
  readonly max: 1;
  readonly value: number;
  readonly posThreshold: number;
  readonly negThreshold: number;
}

/** One Pair row of the matrix. */
export interface RowVM {
  readonly pair: Pair;
  readonly scoreText: string;
  readonly score: number;
  readonly gauge: GaugeVM;
  readonly status: ConfluenceStatus;
  readonly statusLabel: string;
  readonly marker: "green" | "red" | "neutral" | "conflict";
  readonly markerText: string;
  readonly stayFlat: boolean;
  readonly conflictSummary: string | null;
  readonly cells: readonly CellVM[];
}

/** One Strategy_Id cell of a row. Every label stays present whatever the emphasis (Req 12.18). */
export interface CellVM {
  readonly strategyId: StrategyId;
  readonly available: boolean;
  readonly directionLabel: string;
  readonly glyph: string;
  readonly strengthText: string;
  readonly strength: number | null;
  readonly emphasis: "signal" | "muted";
  readonly detailText: string;
  readonly highlighted: boolean;
  readonly highlightLabel: string | null;
  readonly accessibleName: string;
}

/** The marker colour-class + human text per Confluence_Status (Requirement 12.3). */
interface StatusDisplay {
  readonly marker: RowVM["marker"];
  readonly markerText: string;
  readonly statusLabel: string;
  readonly stayFlat: boolean;
}

function statusDisplay(status: ConfluenceStatus): StatusDisplay {
  switch (status) {
    case "ALIGNED_UP":
      return { marker: "green", markerText: "Aligned up", statusLabel: "Aligned up", stayFlat: false };
    case "ALIGNED_DOWN":
      return { marker: "red", markerText: "Aligned down", statusLabel: "Aligned down", stayFlat: false };
    case "NEUTRAL":
      return { marker: "neutral", markerText: "Neutral", statusLabel: "Neutral", stayFlat: false };
    case "INSUFFICIENT_DATA":
      return {
        marker: "neutral",
        markerText: "Insufficient data",
        statusLabel: "Insufficient data",
        stayFlat: false,
      };
    case "CONFLICT_FLAT":
      return { marker: "conflict", markerText: "Stay Flat", statusLabel: "Stay Flat", stayFlat: true };
  }
}

/** Clamp a value into the fixed `[-1, 1]` gauge interval. */
function clampUnitSigned(value: number): number {
  if (value < -1) return -1;
  if (value > 1) return 1;
  return value;
}

/** Fixed two-decimal display of a bounded score/strength (e.g. `0.72`), deterministic. */
function formatScore(value: number): string {
  return value.toFixed(2);
}

/** The glyph for a cell's direction (or the unavailable glyph). */
function directionGlyph(direction: Direction): string {
  switch (direction) {
    case "UP":
      return GLYPH_UP;
    case "DOWN":
      return GLYPH_DOWN;
    case "FLAT":
      return GLYPH_FLAT;
  }
}

/**
 * Shape one Strategy_Id cell. An available cell copies its direction, strength, and rationale
 * verbatim; an unavailable cell renders the explicit "Unavailable" label and its reason as the
 * detail (Requirement 11.2). `emphasis` is "signal" only for an available, non-FLAT cell whose
 * Strategy_Id weight is > 0 (Requirement 12.18); it is a presentation hint only and removes no
 * label. `highlighted` marks a cell whose Strategy_Id opposes in a CONFLICT_FLAT row (Req 12.7).
 */
function shapeCell(
  cell: ConfluenceCell,
  pair: string,
  weight: number,
  opposing: ReadonlySet<StrategyId>,
): CellVM {
  const highlighted = opposing.has(cell.strategyId);
  const highlightLabel = highlighted ? "Conflicting" : null;

  if (!cell.available) {
    return {
      strategyId: cell.strategyId,
      available: false,
      directionLabel: "Unavailable",
      glyph: GLYPH_UNAVAILABLE,
      strengthText: "",
      strength: null,
      emphasis: "muted",
      detailText: cell.reason,
      highlighted,
      highlightLabel,
      accessibleName: `${pair}, ${cell.strategyId}, unavailable: ${cell.reason}`,
    };
  }

  const directionLabel = formatDirection(cell.direction);
  const strengthText = formatScore(cell.strength);
  const emphasis: CellVM["emphasis"] =
    cell.direction !== "FLAT" && weight > 0 ? "signal" : "muted";

  return {
    strategyId: cell.strategyId,
    available: true,
    directionLabel,
    glyph: directionGlyph(cell.direction),
    strengthText,
    strength: cell.strength,
    emphasis,
    detailText: cell.rationale,
    highlighted,
    highlightLabel,
    accessibleName: `${pair}, ${cell.strategyId}, ${directionLabel}, strength ${strengthText}`,
  };
}

/**
 * Build the deterministic `conflictSummary` sentence for a CONFLICT_FLAT row (Req 12.14,
 * 12.15). It names at least one opposing UP and one opposing DOWN Strategy_Id, drawing every
 * value from the row's opposing ids and cells — it introduces nothing absent from the slice.
 * Returns `null` for any non-CONFLICT_FLAT row.
 */
function conflictSummary(
  pair: ConfluencePair,
  cellsById: ReadonlyMap<StrategyId, CellVM>,
): string | null {
  if (pair.status !== "CONFLICT_FLAT") {
    return null;
  }

  const opposing = pair.opposingStrategyIds;
  const describe = (predicate: (c: CellVM) => boolean): string | null => {
    for (const id of opposing) {
      const cell = cellsById.get(id);
      if (cell !== undefined && cell.available && predicate(cell)) {
        return `${id} ${cell.glyph} ${cell.directionLabel} (${cell.strengthText})`;
      }
    }
    return null;
  };

  const up = describe((c) => c.directionLabel === "Up");
  const down = describe((c) => c.directionLabel === "Down");

  if (up === null || down === null) {
    // Defensive: a well-formed CONFLICT_FLAT row always has an opposing UP and DOWN cell.
    // Fall back to a stable sentence rather than fabricate missing detail.
    return "Stay flat: opposing strategies conflict.";
  }

  return `Stay flat: ${up} opposes ${down}.`;
}

/** Shape one Pair row. */
function shapeRow(pair: ConfluencePair, weights: Confluence["weights"], alignmentThreshold: number): RowVM {
  const display = statusDisplay(pair.status);
  const opposing: ReadonlySet<StrategyId> =
    pair.status === "CONFLICT_FLAT" ? new Set(pair.opposingStrategyIds) : new Set();

  // Index the cells by Strategy_Id so columns render in canonical order regardless of the
  // slice's cell order, and so the conflict summary can look opposing ids up directly.
  const byId = new Map<StrategyId, ConfluenceCell>();
  for (const cell of pair.cells) {
    byId.set(cell.strategyId, cell);
  }

  const cells: CellVM[] = [];
  const cellVmById = new Map<StrategyId, CellVM>();
  for (const id of STRATEGY_IDS) {
    const cell = byId.get(id);
    if (cell === undefined) continue;
    const vm = shapeCell(cell, pair.pair, weights[id], opposing);
    cells.push(vm);
    cellVmById.set(id, vm);
  }

  const score = pair.score;
  const gauge: GaugeVM = {
    min: -1,
    max: 1,
    value: clampUnitSigned(score),
    posThreshold: alignmentThreshold,
    negThreshold: -alignmentThreshold,
  };

  return {
    pair: pair.pair as Pair,
    scoreText: formatScore(score),
    score,
    gauge,
    status: pair.status,
    statusLabel: display.statusLabel,
    marker: display.marker,
    markerText: display.markerText,
    stayFlat: display.stayFlat,
    conflictSummary: conflictSummary(pair, cellVmById),
    cells,
  };
}

/** Order the slice's pairs into canonical `PAIRS` order, keeping only known pairs. */
function orderedPairs(pairs: readonly ConfluencePair[]): ConfluencePair[] {
  const byPair = new Map<string, ConfluencePair>();
  for (const p of pairs) {
    byPair.set(p.pair, p);
  }
  const ordered: ConfluencePair[] = [];
  for (const pair of PAIRS) {
    const found = byPair.get(pair);
    if (found !== undefined) ordered.push(found);
  }
  return ordered;
}

/** Build the Confluence_Summary counts, partitioning rows so the three sum to `rows.length`. */
function summarize(rows: readonly RowVM[]): SummaryVM {
  let aligned = 0;
  let conflict = 0;
  let neutral = 0;
  for (const row of rows) {
    if (row.status === "ALIGNED_UP" || row.status === "ALIGNED_DOWN") {
      aligned += 1;
    } else if (row.status === "CONFLICT_FLAT") {
      conflict += 1;
    } else {
      neutral += 1;
    }
  }
  return {
    aligned,
    conflict,
    neutral,
    text: `${aligned} aligned, ${conflict} conflict, ${neutral} neutral`,
  };
}

/** Build the column headers in canonical `STRATEGY_IDS` order (Requirement 12.9). */
function buildColumns(weights: Confluence["weights"]): ColumnVM[] {
  return STRATEGY_IDS.map((strategyId) => {
    const displayOnly = weights[strategyId] === 0;
    const base = STRATEGY_HEADERS[strategyId];
    return {
      strategyId,
      header: displayOnly ? `${base} (display-only)` : base,
      displayOnly,
    };
  });
}

/**
 * Shape the per-run {@link Confluence} slice into the display-only {@link ConfluenceViewModel}.
 *
 * Pure and total: a slice with no Pairs yields the explicit empty state (`empty: true`,
 * `emptyText`, no rows) while still carrying the validation label and strength note
 * (Requirement 12.12). Otherwise it builds columns in `STRATEGY_IDS` order, rows in `PAIRS`
 * order, the Confluence_Summary counts, and — for every status — the marker/marker-text so the
 * data stays testable whatever the validation state (Requirement 14). `validated` is the honest
 * hook the panel reads to decide whether to apply colour (Requirement 14.4).
 */
export function shapeConfluence(slice: Confluence): ConfluenceViewModel {
  const validated = slice.validationLabel !== "unvalidated";
  const columns = buildColumns(slice.weights);

  const pairs = orderedPairs(slice.pairs);
  const rows = pairs.map((pair) => shapeRow(pair, slice.weights, slice.alignmentThreshold));

  return {
    empty: rows.length === 0,
    emptyText: EMPTY_TEXT,
    validationLabel: VALIDATION_LABEL,
    validated,
    strengthNote: STRENGTH_NOTE,
    summary: summarize(rows),
    columns,
    rows,
  };
}
