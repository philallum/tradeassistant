/**
 * Pure chart-series shapers (property-testable — Req 19.2/19.3).
 *
 * This module is PURE: it performs no `fetch`, touches no DOM, pulls in no Recharts, reads
 * no clock (`Date.now()`), and imports NOTHING from the deterministic core (`src/`). Every
 * function is a deterministic function of its arguments alone — the invariant task 7.12
 * enforces and the invariant that lets Properties 6–8 exercise these shapers exhaustively
 * with `fast-check` (see the design).
 *
 * Every charted value is drawn VERBATIM from a persisted row and is NEVER recomputed or
 * interpolated from another field (Req 9.10, 10.4, 20.1). Each shaper also emits an
 * accessibility table model — a plain `{ columns, rows }` tabular view of the exact same
 * verbatim values — so each chart has a text/table equivalent (Req 18.4).
 *
 * Decision_Dates and candle dates are ISO calendar-date strings (`"YYYY-MM-DD"`). In that
 * fixed form they sort chronologically under plain lexicographic string comparison, so
 * "ascending by date" needs no `Date` parsing. Ordering uses a stable sort so rows that
 * share a date keep their input order.
 */

import type {
  AnalogueOutcomeRow,
  CandleRow,
  Direction,
  FiringSetupRow,
  Horizon,
  Pair,
} from "../api/types.ts";

/**
 * A generic accessibility table model: the chart's text/table equivalent (Req 18.4).
 *
 * `columns` are the header cells (left-to-right); each entry in `rows` is one table row
 * whose cells align positionally with `columns`. Cells are the raw verbatim values (string
 * | number | boolean | null) — formatting for display is the renderer's concern, not this
 * pure shaper's.
 */
export interface A11yTable {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly (string | number | boolean | null)[])[];
}

/** One point of the Earned_Confidence trend: a Decision_Date and its verbatim confidence. */
export interface TrendPoint {
  readonly decisionDate: string;
  readonly earnedConfidence: number;
}

/**
 * Earned_Confidence trend series for a single pair (Req 9.5), plus its a11y table
 * equivalent (Req 18.4). `points` are ascending by `decisionDate`; every `earnedConfidence`
 * is the source row's value verbatim (Req 9.10, 20.1).
 */
export interface TrendSeries {
  readonly pair: Pair;
  readonly points: readonly TrendPoint[];
  readonly table: A11yTable;
}

/** One point of the MFE/MAE excursion profile: verbatim favorable/adverse movement. */
export interface ExcursionPoint {
  readonly decisionDate: string;
  readonly horizon: Horizon;
  readonly direction: Direction;
  readonly mfePips: number;
  readonly maePips: number;
}

/**
 * MFE/MAE excursion profile series (Req 9.6), plus its a11y table equivalent (Req 18.4).
 * `mfePips`/`maePips` are the `analogue_outcomes` values verbatim (Req 10.4, 20.1).
 */
export interface ExcursionSeries {
  readonly points: readonly ExcursionPoint[];
  readonly table: A11yTable;
}

/** One OHLC candle: date plus the four verbatim price values. */
export interface CandlePoint {
  readonly date: string;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
}

/**
 * Price (candlestick) series (Req 9.9), plus its a11y table equivalent (Req 18.4).
 * `points` are ordered by `date`; OHLC values are the `candles` values verbatim
 * (Req 9.10, 20.1).
 */
export interface CandleSeries {
  readonly points: readonly CandlePoint[];
  readonly table: A11yTable;
}

/**
 * Stable ascending sort by a string key extracted from each element.
 *
 * `Array.prototype.sort` is not guaranteed stable across every engine for all inputs; we
 * decorate with the original index and break ties on it so elements sharing a key keep
 * their input order. The input array is never mutated (it is copied first), keeping the
 * shaper pure for its `readonly` arguments.
 */
function stableSortByDate<T>(rows: readonly T[], key: (row: T) => string): T[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      if (a.row === b.row) return 0;
      const ka = key(a.row);
      const kb = key(b.row);
      if (ka < kb) return -1;
      if (ka > kb) return 1;
      return a.index - b.index;
    })
    .map((entry) => entry.row);
}

/**
 * Shape the Earned_Confidence trend for a single `pair` from `firing_setups` rows (Req 9.5).
 *
 * Keeps only rows for `pair`, emits one point per kept row carrying that row's
 * `earned_confidence` verbatim, and orders the points ascending by `decision_date`
 * (Req 9.10, 20.1). The companion a11y table lists the same date/confidence pairs in the
 * same order (Req 18.4).
 */
export function shapeConfidenceTrend(
  rows: readonly FiringSetupRow[],
  pair: Pair,
): TrendSeries {
  const forPair = rows.filter((row) => row.pair === pair);
  const ordered = stableSortByDate(forPair, (row) => row.decision_date);

  const points: TrendPoint[] = ordered.map((row) => ({
    decisionDate: row.decision_date,
    earnedConfidence: row.earned_confidence,
  }));

  const table: A11yTable = {
    columns: ["Decision date", "Earned confidence"],
    rows: points.map((point) => [point.decisionDate, point.earnedConfidence]),
  };

  return { pair, points, table };
}

/**
 * Shape the MFE/MAE excursion profile from `analogue_outcomes` rows (Req 9.6).
 *
 * Emits one point per row carrying `mfe_pips`/`mae_pips` (and the row's `horizon` and
 * `direction`) verbatim, ordered ascending by `decision_date` (Req 10.4, 20.1). The
 * companion a11y table lists the same values in the same order (Req 18.4).
 */
export function shapeExcursionProfile(
  rows: readonly AnalogueOutcomeRow[],
): ExcursionSeries {
  const ordered = stableSortByDate(rows, (row) => row.decision_date);

  const points: ExcursionPoint[] = ordered.map((row) => ({
    decisionDate: row.decision_date,
    horizon: row.horizon,
    direction: row.direction,
    mfePips: row.mfe_pips,
    maePips: row.mae_pips,
  }));

  const table: A11yTable = {
    columns: ["Decision date", "Horizon", "Direction", "MFE (pips)", "MAE (pips)"],
    rows: points.map((point) => [
      point.decisionDate,
      point.horizon,
      point.direction,
      point.mfePips,
      point.maePips,
    ]),
  };

  return { points, table };
}

/**
 * Shape the price (OHLC) series from `candles` rows (Req 9.9).
 *
 * Emits one point per row carrying open/high/low/close verbatim, ordered ascending by
 * `date` (Req 9.10, 20.1). The companion a11y table lists the same OHLC values in the same
 * order (Req 18.4).
 */
export function shapePriceSeries(rows: readonly CandleRow[]): CandleSeries {
  const ordered = stableSortByDate(rows, (row) => row.date);

  const points: CandlePoint[] = ordered.map((row) => ({
    date: row.date,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
  }));

  const table: A11yTable = {
    columns: ["Date", "Open", "High", "Low", "Close"],
    rows: points.map((point) => [
      point.date,
      point.open,
      point.high,
      point.low,
      point.close,
    ]),
  };

  return { points, table };
}
