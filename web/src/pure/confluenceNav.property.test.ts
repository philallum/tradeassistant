import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { nextCell, type Pos } from "./confluenceNav.js";

// Feature: multi-strategy-confluence-engine, Property 29: Grid navigation stays inside the grid
//
// For any grid (rowCount >= 1, colCount >= 1) and any starting position inside that grid,
// applying any sequence of Arrow/Home/End keys through `nextCell` always yields a position
// inside the grid (0 <= row < rowCount, 0 <= col < colCount). `Escape` always yields
// `"dismiss"` and any unknown key yields `null`. Additionally every cell is reachable from
// any other cell using only arrow keys (clamped movement never strands focus).
//
// **Validates: Requirements 12.10**

const NUM_RUNS = 300; // >= 100 iterations required by the task.

/** Movement keys that must always keep focus inside the grid. */
const MOVE_KEYS = [
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
] as const;

/** Keys treated as "unknown" by `nextCell` (anything outside the handled set). */
const UNKNOWN_KEYS = ["Tab", "Enter", " ", "a", "PageUp", "F1", ""] as const;

/**
 * A grid together with a start position strictly inside it, plus a sequence of movement
 * keys. `rowCount`/`colCount` are drawn from 1..10 so the grid always has at least one
 * cell, and the start row/col are clamped into range after generation so the start is
 * always a real cell.
 */
interface NavCase {
  readonly rowCount: number;
  readonly colCount: number;
  readonly start: Pos;
  readonly keys: readonly string[];
}

const navCaseArb: fc.Arbitrary<NavCase> = fc
  .record({
    rowCount: fc.integer({ min: 1, max: 10 }),
    colCount: fc.integer({ min: 1, max: 10 }),
    startRow: fc.integer({ min: 0, max: 9 }),
    startCol: fc.integer({ min: 0, max: 9 }),
    keys: fc.array(fc.constantFrom(...MOVE_KEYS), {
      minLength: 0,
      maxLength: 40,
    }),
  })
  .map(({ rowCount, colCount, startRow, startCol, keys }) => ({
    rowCount,
    colCount,
    start: {
      row: Math.min(startRow, rowCount - 1),
      col: Math.min(startCol, colCount - 1),
    },
    keys,
  }));

/** True iff `pos` lies inside a `rowCount x colCount` grid. */
function inGrid(pos: Pos, rowCount: number, colCount: number): boolean {
  return (
    Number.isInteger(pos.row) &&
    Number.isInteger(pos.col) &&
    pos.row >= 0 &&
    pos.row < rowCount &&
    pos.col >= 0 &&
    pos.col < colCount
  );
}

describe("Property 29: Grid navigation stays inside the grid", () => {
  it("every Arrow/Home/End step keeps focus inside the grid", () => {
    fc.assert(
      fc.property(navCaseArb, ({ rowCount, colCount, start, keys }) => {
        // Precondition: the generated start is a real cell.
        expect(inGrid(start, rowCount, colCount)).toBe(true);

        let pos: Pos = start;
        for (const key of keys) {
          const result = nextCell(pos, key, rowCount, colCount);
          // Every movement key returns a Pos (never "dismiss" / null).
          expect(result).not.toBeNull();
          expect(result).not.toBe("dismiss");
          const nextPos = result as Pos;
          // The whole point of the property: focus never leaves the grid.
          expect(inGrid(nextPos, rowCount, colCount)).toBe(true);
          pos = nextPos;
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("Escape always yields \"dismiss\" from any in-grid cell", () => {
    fc.assert(
      fc.property(navCaseArb, ({ rowCount, colCount, start }) => {
        expect(nextCell(start, "Escape", rowCount, colCount)).toBe("dismiss");
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("any unknown key yields null (no movement)", () => {
    fc.assert(
      fc.property(
        navCaseArb,
        fc.constantFrom(...UNKNOWN_KEYS),
        ({ rowCount, colCount, start }, key) => {
          expect(nextCell(start, key, rowCount, colCount)).toBeNull();
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("every cell is reachable from any other cell using only arrow keys", () => {
    // Reachability: from any start, move row-wise then column-wise with clamped
    // arrows to land exactly on any target cell. This is the structural guarantee
    // that clamped navigation never strands focus in an unreachable region.
    const reachCaseArb = fc
      .record({
        rowCount: fc.integer({ min: 1, max: 10 }),
        colCount: fc.integer({ min: 1, max: 10 }),
        startRow: fc.integer({ min: 0, max: 9 }),
        startCol: fc.integer({ min: 0, max: 9 }),
        targetRow: fc.integer({ min: 0, max: 9 }),
        targetCol: fc.integer({ min: 0, max: 9 }),
      })
      .map((g) => {
        const start: Pos = {
          row: Math.min(g.startRow, g.rowCount - 1),
          col: Math.min(g.startCol, g.colCount - 1),
        };
        const target: Pos = {
          row: Math.min(g.targetRow, g.rowCount - 1),
          col: Math.min(g.targetCol, g.colCount - 1),
        };
        return { rowCount: g.rowCount, colCount: g.colCount, start, target };
      });

    fc.assert(
      fc.property(reachCaseArb, ({ rowCount, colCount, start, target }) => {
        let pos: Pos = start;

        // Walk rows toward the target, one clamped arrow at a time.
        const rowKey = target.row > start.row ? "ArrowDown" : "ArrowUp";
        for (let i = 0; i < rowCount && pos.row !== target.row; i += 1) {
          pos = nextCell(pos, rowKey, rowCount, colCount) as Pos;
          expect(inGrid(pos, rowCount, colCount)).toBe(true);
        }

        // Walk columns toward the target, one clamped arrow at a time.
        const colKey = target.col > start.col ? "ArrowRight" : "ArrowLeft";
        for (let i = 0; i < colCount && pos.col !== target.col; i += 1) {
          pos = nextCell(pos, colKey, rowCount, colCount) as Pos;
          expect(inGrid(pos, rowCount, colCount)).toBe(true);
        }

        // The target cell is reached exactly.
        expect(pos).toEqual(target);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
