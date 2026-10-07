// Property test for SupabaseGateVerdictStore persist/read round-trip
// (dashboard-data-activation Task 1.4; design Component 1).
//
// Feature: dashboard-data-activation, Property 1: GateVerdictStore persist/read round-trip
//
// **Validates: Requirements 1.3, 1.4**
//
// Property 1 — for any `GateVerdict` + `GateVerdictSplit`, `persistVerdict`
// then `getVerdict(verdictId)` yields an equivalent verdict and split, and
// `PersistVerdictReport.foldRows === verdict.foldVerdicts.length`. The test runs
// against a no-network stub `fetch` that models PostgREST: on an insert issued
// with `Prefer: return=representation` it mints a `gen_random_uuid()`-style id
// and echoes the row back, stores the inserted `gate_verdicts` /
// `gate_fold_verdicts` rows, and serves them back on the GET selects
// `getVerdict` issues (honoring `id=eq.<id>` and
// `verdict_id=eq.<id>&order=fold_index.asc`, with a bounded `Content-Range` so
// the paginated select terminates).
//
// The generated `GateVerdict`s are constrained to the invariants the adapter's
// `fromVerdictRow` reconstruction relies on so the round-trip is value-equal
// (the adapter rebuilds the aggregate gate1/gate2/metrics from the named columns
// plus the fold set, re-running no gate math):
//   - aggregate `gate1.sampleSize === verdict.sampleSize`
//   - `gate1.evaluated === (sampleSize >= GATE1_SAMPLE_SIZE_FLOOR)`
//   - Gate 2 is either evaluated (real metrics) or the all-zero not-evaluated
//     value — a not-evaluated Gate 2 serializes its columns to null and reads
//     back as the all-zero `GATE2_NOT_EVALUATED` constant
//   - `metrics.accuracyVsBaseline === gate1.deltaPp`,
//     `metrics.riskAdjustedVsBaseline === gate2.margin`, and the metrics counts
//     are derived from the fold rows (`skipped` flag)
// Each fold's full `Gate1Result` / `Gate2Result` are stored verbatim in the
// fold `metrics` jsonb, so fold values round-trip exactly for any shape.

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  GATE1_SAMPLE_SIZE_FLOOR,
  type FoldVerdict,
  type Gate1Result,
  type Gate2Result,
  type GateMetrics,
  type GateVerdict,
  type GateVerdictSplit,
} from "../../kill-gate/types.js";
import type { SupabaseConfig } from "../supabaseConfig.js";
import { SupabaseRestClient } from "./client.js";
import { SupabaseGateVerdictStore } from "./gateVerdictStore.js";

const CONFIG: SupabaseConfig = {
  target: "hosted",
  url: "https://proj.supabase.co",
  key: "scoped-write-jwt",
  apiKey: "sb_publishable_anon",
};

/**
 * The all-zero not-evaluated Gate 2 value the adapter reads back when a verdict
 * recorded Gate 2 as not-evaluated (its columns are null). Mirrors the
 * `GATE2_NOT_EVALUATED` constant the adapter reconstructs.
 */
const GATE2_NOT_EVALUATED: Gate2Result = {
  modelRiskAdj: 0,
  baselineRiskAdj: 0,
  margin: 0,
  passed: false,
  evaluated: false,
};

/**
 * An in-memory stub `fetch` modelling the slice of PostgREST the adapter uses:
 *   - POST with `Prefer: return=representation`: inserts the posted rows,
 *     minting a `gen_random_uuid()`-style id for any `gate_verdicts` row that
 *     lacks one (as the DB default would), echoes the stored rows back.
 *   - GET on `gate_verdicts?id=eq.<id>&limit=1`: returns the matching aggregate.
 *   - GET on `gate_fold_verdicts?verdict_id=eq.<id>&order=fold_index.asc`:
 *     returns that verdict's fold rows ordered by fold_index.
 * Every GET replies with a bounded `Content-Range` (`0-last/total`) so the
 * client's paginated `select` terminates after a single short page.
 */
function makePostgrestStub(): typeof fetch {
  const verdicts: Record<string, unknown>[] = [];
  const foldVerdicts: Record<string, unknown>[] = [];
  let seq = 0;

  const jsonResponse = (rows: readonly Record<string, unknown>[]): Response => {
    const last = rows.length === 0 ? 0 : rows.length - 1;
    return new Response(JSON.stringify(rows), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Range": `0-${last}/${rows.length}`,
      },
    });
  };

  const parseEqValue = (query: string, key: string): string | undefined => {
    // Match `key=eq.<url-encoded-value>` up to the next `&` or end-of-string.
    const match = new RegExp(`${key}=eq\\.([^&]*)`).exec(query);
    return match === null ? undefined : decodeURIComponent(match[1] ?? "");
  };

  return ((url: string | URL, init?: RequestInit) => {
    const u = new URL(String(url));
    const method = String(init?.method ?? "GET").toUpperCase();
    const query = u.search.startsWith("?") ? u.search.slice(1) : u.search;
    const table = u.pathname.split("/").pop() ?? "";

    if (method === "POST") {
      const bodyText = typeof init?.body === "string" ? init.body : "[]";
      const parsed = JSON.parse(bodyText) as Record<string, unknown>[];
      const stored = parsed.map((row) => {
        if (table === "gate_verdicts") {
          const withId = { id: row.id ?? `gen-uuid-${(seq += 1)}`, ...row };
          verdicts.push(withId);
          return withId;
        }
        foldVerdicts.push(row);
        return row;
      });
      return Promise.resolve(
        new Response(JSON.stringify(stored), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }

    // GET select.
    if (table === "gate_verdicts") {
      const id = parseEqValue(query, "id");
      const matched = verdicts.filter((row) => id === undefined || row.id === id);
      return Promise.resolve(jsonResponse(matched));
    }
    if (table === "gate_fold_verdicts") {
      const verdictId = parseEqValue(query, "verdict_id");
      const matched = foldVerdicts
        .filter((row) => verdictId === undefined || row.verdict_id === verdictId)
        .sort(
          (a, b) => (a.fold_index as number) - (b.fold_index as number),
        );
      return Promise.resolve(jsonResponse(matched));
    }

    return Promise.resolve(jsonResponse([]));
  }) as unknown as typeof fetch;
}

/**
 * A date-ish `YYYY-MM-DD` string generator for the Data_Split bounds. The
 * adapter stores these verbatim as opaque strings (`split_train_end` etc.) and
 * reads them back unchanged, so any well-formed date string exercises the
 * round-trip; built from day offsets to avoid any invalid-time edge.
 */
const dateArb: fc.Arbitrary<string> = fc
  .integer({ min: 0, max: 13_000 })
  .map((offset) =>
    new Date(Date.UTC(2000, 0, 1) + offset * 86_400_000)
      .toISOString()
      .slice(0, 10),
  );

// Finite doubles, with `-0` normalized to `0`. JSON serialization (the DB
// jsonb / numeric columns the adapter persists through) collapses `-0` to `0`
// — `JSON.stringify(-0) === "0"` — so a signed negative zero is not a value a
// recorded metric can distinctly carry. Normalizing here keeps the arbitrary in
// the space of values the storage layer can actually round-trip (adding `0`
// turns `-0` into `+0` and leaves every other value unchanged).
const finiteArb = (min: number, max: number): fc.Arbitrary<number> =>
  fc.double({ min, max, noNaN: true, noDefaultInfinity: true }).map((n) => n + 0);

/** An evaluated Gate 2 result (round-trips through the real columns). */
const evaluatedGate2Arb: fc.Arbitrary<Gate2Result> = fc
  .tuple(finiteArb(-5, 5), finiteArb(-5, 5), fc.boolean())
  .map(([modelRiskAdj, baselineRiskAdj, passed]) => ({
    modelRiskAdj,
    baselineRiskAdj,
    margin: modelRiskAdj - baselineRiskAdj,
    passed,
    evaluated: true,
  }));

/**
 * An aggregate Gate 2 result: either evaluated, or the all-zero not-evaluated
 * value (the only not-evaluated shape that round-trips, since not-evaluated
 * columns serialize to null and read back as `GATE2_NOT_EVALUATED`).
 */
const aggregateGate2Arb: fc.Arbitrary<Gate2Result> = fc.oneof(
  evaluatedGate2Arb,
  fc.constant(GATE2_NOT_EVALUATED),
);

/** A per-fold Gate 1 result. Stored verbatim in the fold `metrics` jsonb. */
const foldGate1Arb: fc.Arbitrary<Gate1Result> = fc
  .tuple(
    finiteArb(0, 1),
    finiteArb(0, 1),
    finiteArb(-1, 1),
    fc.nat({ max: 500 }),
    fc.boolean(),
    fc.boolean(),
  )
  .map(([modelAccuracy, baselineAccuracy, deltaPp, sampleSize, evaluated, passed]) => ({
    modelAccuracy,
    baselineAccuracy,
    deltaPp,
    sampleSize,
    evaluated,
    passed,
  }));

/** A per-fold Gate 2 result. Stored verbatim in the fold `metrics` jsonb. */
const foldGate2Arb: fc.Arbitrary<Gate2Result> = fc.oneof(
  evaluatedGate2Arb,
  fc.constant(GATE2_NOT_EVALUATED),
);

const foldVerdictArb = (foldIndex: number): fc.Arbitrary<FoldVerdict> =>
  fc
    .tuple(
      foldGate1Arb,
      foldGate2Arb,
      fc.nat({ max: 500 }),
      fc.boolean(),
      fc.constantFrom<"PASS" | "CUT">("PASS", "CUT"),
    )
    .map(([gate1, gate2, sampleSize, skipped, verdict]) => ({
      foldIndex,
      sampleSize,
      skipped,
      gate1,
      gate2,
      verdict,
    }));

/**
 * A full `GateVerdict` + `GateVerdictSplit` constrained to the invariants the
 * adapter's reconstruction relies on, so the persisted → read-back value is
 * equal to the original.
 */
const scenarioArb: fc.Arbitrary<{
  verdict: GateVerdict;
  split: GateVerdictSplit;
}> = fc
  .tuple(
    fc.string({ minLength: 1, maxLength: 24 }),
    fc.nat({ max: 500 }),
    finiteArb(0, 1),
    finiteArb(0, 1),
    finiteArb(-1, 1),
    fc.boolean(),
    aggregateGate2Arb,
    fc.constantFrom<"PASS" | "CUT">("PASS", "CUT"),
    fc.array(fc.integer({ min: 0, max: 999 }), {
      minLength: 0,
      maxLength: 8,
    }),
    dateArb,
    dateArb,
    dateArb,
    fc.option(fc.constantFrom<1 | 2 | 3>(1, 2, 3), { nil: undefined }),
  )
  .chain(
    ([
      configId,
      sampleSize,
      modelAccuracy,
      baselineAccuracy,
      deltaPp,
      gate1Passed,
      gate2,
      verdict,
      rawFoldIndices,
      trainEnd,
      testStart,
      testEnd,
      selectedHorizon,
    ]) => {
      // Unique, ordered fold indices (the adapter reads them back ordered asc).
      const foldIndices = [...new Set(rawFoldIndices)].sort((a, b) => a - b);
      const foldArbs = foldIndices.map((idx) => foldVerdictArb(idx));
      const foldsArb =
        foldArbs.length === 0
          ? fc.constant<FoldVerdict[]>([])
          : fc.tuple(...foldArbs).map((folds) => [...folds]);

      return foldsArb.map((foldVerdicts) => {
        // Aggregate gate1 obeys the adapter's reconstruction invariants:
        // sampleSize == aggregate sample_size, evaluated == sampleSize >= floor.
        const gate1: Gate1Result = {
          modelAccuracy,
          baselineAccuracy,
          deltaPp,
          sampleSize,
          evaluated: sampleSize >= GATE1_SAMPLE_SIZE_FLOOR,
          passed: gate1Passed,
        };

        const skippedFolds = foldVerdicts.filter((f) => f.skipped).length;
        const metrics: GateMetrics = {
          qualifyingFolds: foldVerdicts.length - skippedFolds,
          skippedFolds,
          totalFolds: foldVerdicts.length,
          // The adapter rebuilds these from the aggregate delta/margin columns.
          accuracyVsBaseline: deltaPp,
          riskAdjustedVsBaseline: gate2.margin,
        };

        const gateVerdict: GateVerdict = {
          configId,
          foldVerdicts,
          gate1,
          gate2,
          sampleSize,
          verdict,
          metrics,
        };

        const split: GateVerdictSplit =
          selectedHorizon === undefined
            ? { trainEnd, testStart, testEnd }
            : { trainEnd, testStart, testEnd, selectedHorizon };

        return { verdict: gateVerdict, split };
      });
    },
  );

describe("Property 1: GateVerdictStore persist/read round-trip", () => {
  it("persistVerdict then getVerdict yields an equivalent verdict + split; foldRows === foldVerdicts.length", async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async ({ verdict, split }) => {
        const store = new SupabaseGateVerdictStore(
          new SupabaseRestClient(CONFIG, makePostgrestStub()),
        );

        const report = await store.persistVerdict(verdict, split);

        // PersistVerdictReport.foldRows === verdict.foldVerdicts.length.
        expect(report.foldRows).toBe(verdict.foldVerdicts.length);

        const read = await store.getVerdict(report.verdictId);
        expect(read).not.toBeNull();
        expect(read?.verdictId).toBe(report.verdictId);

        // The read-back verdict and split are equivalent to the originals.
        expect(read?.verdict).toEqual(verdict);
        expect(read?.split).toEqual(split);
      }),
      { numRuns: 200 },
    );
  });
});
