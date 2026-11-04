// All_Pairs_Strip is a verbatim projection of the conviction shaper, always lists exactly the
// five pairs in canonical order, and never shows the retired bare "Neutral" label.
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { PAIRS } from "../api/types.ts";
import type { Confluence, ConfluenceCell, ConfluencePair, ConfluenceStatus, Direction } from "../api/types.ts";
import { EMPTY_CONFLUENCE } from "../api/snapshot.ts";
import { NO_SIGNAL_TEXT } from "./noSignalCopy.ts";
import { shapeAllPairsStrip } from "./shapeAllPairsStrip.ts";
import { shapeConviction, tierGlyph } from "./shapeConviction.ts";

const NUM_RUNS = 200;
const IDS = ["trend", "breakout", "range", "reversal", "custom_pattern", "third_party"] as const;
const STATUSES: ConfluenceStatus[] = ["ALIGNED_UP", "ALIGNED_DOWN", "NEUTRAL", "CONFLICT_FLAT", "INSUFFICIENT_DATA"];

const cellArb = (id: (typeof IDS)[number]): fc.Arbitrary<ConfluenceCell> =>
  fc.oneof(
    fc
      .tuple(fc.constantFrom<Direction>("UP", "DOWN", "FLAT"), fc.double({ min: 0, max: 1, noNaN: true }))
      .map(([direction, strength]): ConfluenceCell => ({
        strategyId: id,
        available: true,
        direction,
        strength: direction === "FLAT" ? 0 : strength,
        rationale: "r",
      })),
    fc.constant<ConfluenceCell>({ strategyId: id, available: false, reason: "insufficient_data" }),
  );

const pairArb = (pair: string): fc.Arbitrary<ConfluencePair> =>
  fc
    .tuple(fc.constantFrom(...STATUSES), fc.double({ min: -1, max: 1, noNaN: true }), ...IDS.map(cellArb))
    .map(([status, score, ...cells]) => ({
      pair,
      score,
      status,
      opposingStrategyIds: status === "CONFLICT_FLAT" ? (["trend", "custom_pattern"] as const) : [],
      cells,
    }));

/** A slice covering an arbitrary subset of the pairs in arbitrary order. */
const sliceArb: fc.Arbitrary<Confluence> = fc
  .shuffledSubarray([...PAIRS])
  .chain((pairs) => fc.tuple(...pairs.map((p) => pairArb(p))))
  .map((rows) => ({ ...EMPTY_CONFLUENCE, pairs: rows }));

describe("shapeAllPairsStrip", () => {
  it("always lists exactly the five pairs in canonical order (including the empty slice)", () => {
    fc.assert(
      fc.property(fc.oneof(fc.constant(EMPTY_CONFLUENCE), sliceArb), (slice) => {
        const { entries } = shapeAllPairsStrip(slice);
        expect(entries).toHaveLength(5);
        expect(entries.map((e) => e.pair)).toEqual([...PAIRS]);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("projects the conviction shaper verbatim when a row exists, else an explicit no-data entry", () => {
    fc.assert(
      fc.property(sliceArb, (slice) => {
        for (const entry of shapeAllPairsStrip(slice).entries) {
          const row = slice.pairs.find((p) => p.pair === entry.pair);
          if (row !== undefined) {
            const vm = shapeConviction(row, slice.weights);
            expect(entry).toMatchObject({
              hasData: true,
              label: vm.label,
              tier: vm.tier,
              glyph: tierGlyph(vm),
              tallyText: vm.tallyText,
            });
          } else {
            expect(entry).toMatchObject({ hasData: false, tier: "none", label: "", tallyText: NO_SIGNAL_TEXT });
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("never shows the retired bare 'Neutral' label", () => {
    fc.assert(
      fc.property(sliceArb, (slice) => {
        for (const entry of shapeAllPairsStrip(slice).entries) {
          expect(entry.label).not.toMatch(/neutral/i);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
