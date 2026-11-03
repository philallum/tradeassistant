/**
 * Pure grid keyboard-navigation model for the Confluence_Panel (Requirement 12.10).
 *
 * This module is PURE: it performs no `fetch`, touches no DOM / browser global, reads no
 * clock (`Date.now()`), and imports NOTHING from the deterministic core (`src/`). Every
 * function is a deterministic function of its arguments alone. That purity invariant
 * (enforced by `purity.structural.test.ts`) is what lets the keyboard model be exercised
 * exhaustively by `fast-check` without a browser (Property 29 — Grid navigation stays
 * inside the grid).
 *
 * The panel renders a `<table role="grid">` with roving `tabIndex`: arrow keys move focus
 * between cells, Home/End jump within a row, and Escape dismisses the pinned rationale.
 * `nextCell` is the whole movement policy, stated independently of the DOM so it can be
 * tested directly on `(pos, key, rowCount, colCount)` tuples.
 */

/** A zero-based cell position within the grid. */
export interface Pos {
  readonly row: number;
  readonly col: number;
}

/** The keyboard keys `nextCell` acts on. Any other key value yields `null`. */
export type NavKey =
  | "ArrowUp"
  | "ArrowDown"
  | "ArrowLeft"
  | "ArrowRight"
  | "Home"
  | "End"
  | "Escape";

/**
 * Clamp `value` into the inclusive range `[0, max]`. `max` is the last valid index
 * (`count - 1`). For a degenerate grid dimension (`count <= 0`, so `max < 0`) the result
 * is clamped up to `0` by the `Math.max(0, …)`, keeping the output a non-negative integer.
 */
function clamp(value: number, max: number): number {
  if (value < 0) return 0;
  if (value > max) return max < 0 ? 0 : max;
  return value;
}

/**
 * Map a key press at cell `pos` in a `rowCount × colCount` grid to the next focus target.
 *
 * - `ArrowUp` / `ArrowDown` move one row and `ArrowLeft` / `ArrowRight` move one column,
 *   each CLAMPED to the grid so focus never leaves it: `row ∈ [0, rowCount - 1]` and
 *   `col ∈ [0, colCount - 1]`.
 * - `Home` moves to the first column of the current row (`col = 0`); `End` moves to the
 *   last column of the current row (`col = colCount - 1`).
 * - `Escape` returns the literal `"dismiss"` (close the pinned rationale).
 * - Any other key returns `null` (no movement).
 *
 * The result is a deterministic function of the arguments, and for every input the
 * returned `Pos` is inside the grid (the invariant Property 29 locks).
 */
export function nextCell(
  pos: Pos,
  key: string,
  rowCount: number,
  colCount: number,
): Pos | "dismiss" | null {
  const lastRow = rowCount - 1;
  const lastCol = colCount - 1;

  switch (key) {
    case "ArrowUp":
      return { row: clamp(pos.row - 1, lastRow), col: clamp(pos.col, lastCol) };
    case "ArrowDown":
      return { row: clamp(pos.row + 1, lastRow), col: clamp(pos.col, lastCol) };
    case "ArrowLeft":
      return { row: clamp(pos.row, lastRow), col: clamp(pos.col - 1, lastCol) };
    case "ArrowRight":
      return { row: clamp(pos.row, lastRow), col: clamp(pos.col + 1, lastCol) };
    case "Home":
      return { row: clamp(pos.row, lastRow), col: clamp(0, lastCol) };
    case "End":
      return { row: clamp(pos.row, lastRow), col: clamp(lastCol, lastCol) };
    case "Escape":
      return "dismiss";
    default:
      return null;
  }
}
