// Feature: multi-strategy-confluence-engine, Property 27: Snapshot parsing is backward compatible and strict for v5
//
// The confluence slice is the sole STRICTLY-parsed slice of `parseSnapshot` and is gated on
// the DECLARED `schemaVersion`:
//   - a pre-v5 document (any version < 5, or a `schemaVersion`-less document → treated as 0)
//     is parsed leniently: whatever (even a defective) `confluence` value it carries is
//     ignored and the slice DEFAULTS to `EMPTY_CONFLUENCE` — `parseSnapshot` NEVER throws on
//     account of confluence, and
//   - a document that DECLARES v5+ MUST carry a well-formed confluence slice: a well-formed
//     slice round-trips verbatim, while a single defect throws the one fixed, non-secret
//     `SnapshotError` and yields NO partial snapshot.
//
// This property exercises that gate across many generated inputs with two arbitraries defined
// in this file: `arbConfluenceSlice` (a well-formed slice) and `arbBrokenSlice` (a well-formed
// slice with EXACTLY ONE defect introduced).
//
// **Validates: Requirements 11.11, 11.12**

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { EMPTY_CONFLUENCE, parseSnapshot, SnapshotError } from "./snapshot";
import type { Confluence, ConfluencePair, ConfluenceCell, ConfluenceStrategyId, ConfluenceStatus, Direction } from "./types";

const NUM_RUNS = 300; // >= 100 iterations required by the task.

/** The fixed, non-secret message every declared-v5 confluence defect surfaces as. */
const CONFLUENCE_ERROR_MESSAGE = "The dashboard snapshot has an invalid confluence slice.";

/** The six Strategy_Ids in `STRATEGY_IDS` order — a declared-v5 Pair carries exactly these. */
const STRATEGY_IDS: readonly ConfluenceStrategyId[] = [
  "trend",
  "breakout",
  "range",
  "reversal",
  "custom_pattern",
  "third_party",
];

const STATUSES: readonly ConfluenceStatus[] = [
  "ALIGNED_UP",
  "ALIGNED_DOWN",
  "NEUTRAL",
  "CONFLICT_FLAT",
  "INSUFFICIENT_DATA",
];

const DIRECTIONS: readonly Direction[] = ["UP", "DOWN", "FLAT"];

/** A finite number (never NaN / ±Infinity) — the shape every weight/threshold/score/strength must have. */
const finiteArb: fc.Arbitrary<number> = fc.double({ min: -1000, max: 1000, noNaN: true });

/**
 * A well-formed cell for a given Strategy_Id. Either `available: true`
 * (direction UP|DOWN|FLAT, finite strength, string rationale) or `available: false`
 * (a non-empty reason). The `strategyId` is fixed to `id` so the parent `cells` array keeps
 * the exact `STRATEGY_IDS` order the strict parser requires.
 */
function arbCell(id: ConfluenceStrategyId): fc.Arbitrary<ConfluenceCell> {
  const available: fc.Arbitrary<ConfluenceCell> = fc
    .record({
      direction: fc.constantFrom(...DIRECTIONS),
      strength: finiteArb,
      rationale: fc.string({ maxLength: 40 }),
    })
    .map((r): ConfluenceCell => ({ strategyId: id, available: true, ...r }));
  const unavailable: fc.Arbitrary<ConfluenceCell> = fc
    .string({ minLength: 1, maxLength: 40 })
    .map((reason): ConfluenceCell => ({ strategyId: id, available: false, reason }));
  return fc.oneof(available, unavailable);
}

/** A well-formed Pair: string `pair`, finite `score`, a valid `status`, valid opposing ids, six ordered cells. */
const arbPair: fc.Arbitrary<ConfluencePair> = fc
  .record({
    pair: fc.string({ minLength: 1, maxLength: 8 }),
    score: finiteArb,
    status: fc.constantFrom(...STATUSES),
    opposingStrategyIds: fc.array(fc.constantFrom(...STRATEGY_IDS), { maxLength: 6 }),
    cells: fc.tuple(...STRATEGY_IDS.map((id) => arbCell(id))) as fc.Arbitrary<ConfluenceCell[]>,
  })
  .map(
    (r): ConfluencePair => ({
      pair: r.pair,
      score: r.score,
      status: r.status,
      opposingStrategyIds: r.opposingStrategyIds,
      cells: r.cells,
    }),
  );

/**
 * A well-formed confluence slice: `validationLabel` "unvalidated", a finite weight for all six
 * Strategy_Ids, finite thresholds, and `pairs` either empty OR a well-formed list.
 */
const arbConfluenceSlice: fc.Arbitrary<Confluence> = fc
  .record({
    weights: fc.record({
      trend: finiteArb,
      breakout: finiteArb,
      range: finiteArb,
      reversal: finiteArb,
      custom_pattern: finiteArb,
      third_party: finiteArb,
    }),
    conflictThreshold: finiteArb,
    alignmentThreshold: finiteArb,
    pairs: fc.array(arbPair, { maxLength: 5 }),
  })
  .map(
    (r): Confluence => ({
      validationLabel: "unvalidated",
      weights: r.weights,
      conflictThreshold: r.conflictThreshold,
      alignmentThreshold: r.alignmentThreshold,
      pairs: r.pairs,
    }),
  );

/**
 * A plain, mutable deep clone of a slice (JSON round-trip). The strict parser only reads, but
 * a defect mutation needs a mutable copy that does not alias the original well-formed value.
 */
function mutableClone(slice: Confluence): Record<string, unknown> {
  return JSON.parse(JSON.stringify(slice)) as Record<string, unknown>;
}

/**
 * Each defect takes a mutable clone of a well-formed slice and introduces EXACTLY ONE defect,
 * returning the now-broken value. Every mutation targets a distinct strict-parse invariant so
 * the set spans the parser's rejection surface. Defects that touch a Pair/cell are guarded to
 * only apply when `pairs` is non-empty; `pickDefect` retries until it finds an applicable one,
 * guaranteeing exactly one defect is present in each generated case.
 */
type Defect = (clone: Record<string, unknown>) => Record<string, unknown> | null;

/** The first Pair record of a clone, or `null` when `pairs` is empty (defect not applicable). */
function firstPair(c: Record<string, unknown>): Record<string, unknown> | null {
  const pairs = c.pairs as Record<string, unknown>[];
  const head = pairs[0];
  return head === undefined ? null : head;
}

/** The first cell record of a Pair, or `null` when the cells array is empty. */
function firstCell(p: Record<string, unknown>): Record<string, unknown> | null {
  const cells = p.cells as Record<string, unknown>[];
  const head = cells[0];
  return head === undefined ? null : head;
}

const DEFECTS: readonly Defect[] = [
  // Wrong validationLabel (the parser demands the literal "unvalidated").
  (c) => {
    c.validationLabel = "validated";
    return c;
  },
  // A missing weight for one Strategy_Id.
  (c) => {
    delete (c.weights as Record<string, unknown>).trend;
    return c;
  },
  // A non-finite weight for one Strategy_Id.
  (c) => {
    (c.weights as Record<string, unknown>).breakout = "not-a-number";
    return c;
  },
  // A non-finite conflictThreshold.
  (c) => {
    c.conflictThreshold = null;
    return c;
  },
  // A non-finite alignmentThreshold.
  (c) => {
    c.alignmentThreshold = "0.4";
    return c;
  },
  // A non-string `pair` on the first Pair.
  (c) => {
    const p = firstPair(c);
    if (p === null) return null;
    p.pair = 123;
    return c;
  },
  // A bad/unknown `status` on the first Pair.
  (c) => {
    const p = firstPair(c);
    if (p === null) return null;
    p.status = "NOT_A_STATUS";
    return c;
  },
  // An unknown Strategy_Id in `opposingStrategyIds`.
  (c) => {
    const p = firstPair(c);
    if (p === null) return null;
    p.opposingStrategyIds = ["nope"];
    return c;
  },
  // Wrong cell count (drop one cell → 5 instead of 6).
  (c) => {
    const p = firstPair(c);
    if (p === null) return null;
    (p.cells as unknown[]).pop();
    return c;
  },
  // An unknown Strategy_Id on a cell (breaks the positional `STRATEGY_IDS` order).
  (c) => {
    const p = firstPair(c);
    if (p === null) return null;
    const cell = firstCell(p);
    if (cell === null) return null;
    cell.strategyId = "unknown_strategy";
    return c;
  },
  // available:false with an empty reason.
  (c) => {
    const p = firstPair(c);
    if (p === null) return null;
    const cells = p.cells as Record<string, unknown>[];
    if (cells.length === 0) return null;
    cells[0] = { strategyId: "trend", available: false, reason: "" };
    return c;
  },
];

/**
 * Pick the FIRST defect (from a shuffled order) that applies to this clone and introduce it,
 * returning the broken value. The validationLabel/weight/threshold defects always apply, so a
 * pick always succeeds even when `pairs` is empty.
 */
function applyFirstApplicable(clone: Record<string, unknown>, order: readonly number[]): Record<string, unknown> {
  for (const i of order) {
    const defect = DEFECTS[i];
    if (defect === undefined) continue;
    const broken = defect(mutableClone(clone as unknown as Confluence));
    if (broken !== null) return broken;
  }
  // Unreachable: the first defect (validationLabel) is always applicable.
  const first = DEFECTS[0];
  if (first === undefined) throw new Error("no defects defined");
  return first(clone) as Record<string, unknown>;
}

/**
 * `arbBrokenSlice`: a well-formed slice carrying EXACTLY ONE defect. Generates a well-formed
 * slice plus a shuffled defect order, then applies the first applicable defect.
 */
const arbBrokenSlice: fc.Arbitrary<Record<string, unknown>> = fc
  .record({
    slice: arbConfluenceSlice,
    order: fc.shuffledSubarray(
      DEFECTS.map((_, i) => i),
      { minLength: DEFECTS.length, maxLength: DEFECTS.length },
    ),
  })
  .map(({ slice, order }) => applyFirstApplicable(mutableClone(slice), order));

/** A minimal snapshot body carrying the given schemaVersion + confluence value. */
function body(schemaVersion: number | undefined, confluence: unknown): Record<string, unknown> {
  const base: Record<string, unknown> = { decisionDate: "2024-03-15", generatedAt: "t", confluence };
  if (schemaVersion !== undefined) base.schemaVersion = schemaVersion;
  return base;
}

describe("Property 27 — parseSnapshot confluence gate is backward compatible and strict for v5", () => {
  it("1. backward compatible: pre-v5 (and schemaVersion-less) NEVER throws on confluence, yields EMPTY_CONFLUENCE", () => {
    fc.assert(
      fc.property(
        // Any version strictly below 5, plus the missing-version case (undefined → treated as 0).
        fc.oneof(fc.integer({ min: -5, max: 4 }), fc.constant(undefined)),
        // Whatever confluence value is present — well-formed, broken, or junk — must be ignored.
        fc.oneof(
          arbConfluenceSlice as fc.Arbitrary<unknown>,
          arbBrokenSlice as fc.Arbitrary<unknown>,
          fc.anything(),
        ),
        (version, confluence) => {
          const parsed = parseSnapshot(body(version, confluence));
          expect(parsed.confluence).toEqual(EMPTY_CONFLUENCE);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("2. strict accept: declared v5+ with a well-formed slice parses and carries it through verbatim", () => {
    fc.assert(
      fc.property(fc.integer({ min: 5, max: 20 }), arbConfluenceSlice, (version, slice) => {
        // Round-trip the slice through JSON to mirror a real snapshot body on the wire. The
        // round-tripped value IS the input the parser sees, so the deep-equality target is the
        // wire value (JSON collapses `-0` to `0`, so comparing against the pre-serialized slice
        // would spuriously differ — the wire form is the authoritative input here).
        const wire = JSON.parse(JSON.stringify(slice)) as unknown;
        const parsed = parseSnapshot(body(version, wire));
        expect(parsed.confluence).toEqual(wire);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("3. strict reject: declared v5+ with a single-defect slice throws the one fixed SnapshotError", () => {
    fc.assert(
      fc.property(fc.integer({ min: 5, max: 20 }), arbBrokenSlice, (version, broken) => {
        let thrown: unknown;
        try {
          parseSnapshot(body(version, broken));
        } catch (error) {
          thrown = error;
        }
        expect(thrown).toBeInstanceOf(SnapshotError);
        expect((thrown as SnapshotError).message).toBe(CONFLUENCE_ERROR_MESSAGE);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
