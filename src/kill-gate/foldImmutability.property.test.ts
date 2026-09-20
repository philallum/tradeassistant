import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { PAIRS } from "../ingestion/types.js";
import type { Pair } from "../ingestion/types.js";
import type { TradingDate } from "../guard/types.js";
import { persistWalkForwardFolds } from "./walkForward.js";
import { InMemoryWalkForwardFoldStore } from "./types.js";
import type { WalkForwardFold } from "./types.js";

// Feature: fx-daily-pattern-assistant, Property 17: For all frozen Data_Splits, any attempt to change the recorded split dates is rejected and the originally recorded dates are retained.
//
// The walk-forward folds ARE the recorded Data_Split partition (Design
// Component 7, Requirements 11.4 / 19.2). Once a fold is recorded and frozen
// for a given (asset, fold_index), any later write with different boundary
// dates must be rejected (returning a `fold_change_rejected` outcome) and the
// originally recorded dates retained; an identical re-write is an idempotent
// no-op.
//
// Validates: Requirement 11.4.

/** Format a day offset from a fixed epoch into an ISO YYYY-MM-DD TradingDate. */
function dateFromOffset(dayOffset: number): TradingDate {
  const epoch = Date.UTC(2000, 0, 1);
  const dt = new Date(epoch + dayOffset * 86_400_000);
  const y = dt.getUTCFullYear().toString().padStart(4, "0");
  const m = (dt.getUTCMonth() + 1).toString().padStart(2, "0");
  const d = dt.getUTCDate().toString().padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * A fold whose four boundary dates are chronologically ordered
 * (trainStart < trainEnd < testStart < testEnd) and derived from a base offset.
 */
function foldFromBase(foldIndex: number, base: number): WalkForwardFold {
  return {
    foldIndex,
    trainStart: dateFromOffset(base),
    trainEnd: dateFromOffset(base + 100),
    testStart: dateFromOffset(base + 101),
    testEnd: dateFromOffset(base + 200),
    frozen: true,
  };
}

/** Generate a set of folds with distinct fold indices and ordered boundaries. */
const foldSetArb: fc.Arbitrary<{ asset: Pair; folds: WalkForwardFold[] }> = fc
  .tuple(
    fc.constantFrom(...PAIRS),
    // Distinct fold indices; 1..6 folds.
    fc.uniqueArray(fc.integer({ min: 0, max: 20 }), {
      minLength: 1,
      maxLength: 6,
    }),
  )
  .map(([asset, indices]) => {
    const folds = indices.map((foldIndex, i) =>
      // Space bases far enough apart that different folds never collide.
      foldFromBase(foldIndex, i * 1000),
    );
    return { asset, folds };
  });

describe("Property 17: immutable recorded split dates", () => {
  it("rejects any change to recorded fold dates and retains the original", async () => {
    await fc.assert(
      fc.asyncProperty(
        foldSetArb,
        // Non-zero delta guarantees the re-write genuinely changes the dates.
        fc.integer({ min: 1, max: 500 }),
        async ({ asset, folds }, delta) => {
          const store = new InMemoryWalkForwardFoldStore();

          // 1. Persist the folds once — all recorded fresh.
          const first = await persistWalkForwardFolds(store, asset, folds);
          expect(first.recorded).toBe(folds.length);
          expect(first.unchanged).toBe(0);
          expect(first.rejected).toHaveLength(0);

          const originals = await store.getFolds(asset);

          // 2. Attempt to persist the SAME (asset, foldIndex) with CHANGED
          //    boundary dates. Every write must be rejected and retained.
          const changed = folds.map((f) => ({
            ...f,
            trainStart: dateFromOffset(9000 + f.foldIndex * 10 + delta),
            trainEnd: dateFromOffset(9000 + f.foldIndex * 10 + delta + 100),
            testStart: dateFromOffset(9000 + f.foldIndex * 10 + delta + 101),
            testEnd: dateFromOffset(9000 + f.foldIndex * 10 + delta + 200),
          }));

          const rejWrite = await persistWalkForwardFolds(store, asset, changed);
          expect(rejWrite.recorded).toBe(0);
          expect(rejWrite.unchanged).toBe(0);
          expect(rejWrite.rejected).toHaveLength(folds.length);
          for (const r of rejWrite.rejected) {
            expect(r.reason).toBe("fold_change_rejected");
            expect(r.asset).toBe(asset);
          }

          // 3. The stored dates are unchanged from what was first recorded.
          const afterReject = await store.getFolds(asset);
          expect(afterReject).toEqual(originals);

          // 4. An identical re-write is an idempotent no-op (no rejection).
          const idempotent = await persistWalkForwardFolds(store, asset, folds);
          expect(idempotent.recorded).toBe(0);
          expect(idempotent.unchanged).toBe(folds.length);
          expect(idempotent.rejected).toHaveLength(0);

          const afterIdempotent = await store.getFolds(asset);
          expect(afterIdempotent).toEqual(originals);
        },
      ),
      { numRuns: 200 },
    );
  });
});
