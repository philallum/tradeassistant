// Property test for SupabaseEvaluationReportStore persist/read round-trip
// (simplify-to-cloud-minimal Task 2; design C4 / Data Models).
//
// **Validates: Requirements 1.3, 8.2**
//
// For any `EvaluationReport`, `persistReport` then `getReport(reportId)` yields
// a value-equal report. The test runs against a no-network stub `fetch` that
// models the slice of PostgREST the adapter uses: on an insert issued with
// `Prefer: return=representation` it mints a `gen_random_uuid()`-style id and
// echoes the row back, stores it, and serves it back on the GET select
// `getReport` issues (honoring `id=eq.<id>`, with a bounded `Content-Range` so
// the paginated select terminates after a single short page).
//
// The named columns carry the report's scalar fields and the `metrics` jsonb
// carries the richer sub-objects verbatim, so the round-trip is value-equal for
// any report shape the composer can produce. The report has NO verdict in any
// form — there is no verdict column to round-trip (Requirement 8.2 / 1.3).

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import type { EvaluationReport } from "../../kill-gate/types.js";
import type { SupabaseConfig } from "../supabaseConfig.js";
import { SupabaseRestClient } from "./client.js";
import { SupabaseEvaluationReportStore } from "./evaluationReportStore.js";

const CONFIG: SupabaseConfig = {
  target: "hosted",
  url: "https://proj.supabase.co",
  key: "scoped-write-jwt",
  apiKey: "sb_publishable_anon",
};

/**
 * An in-memory stub `fetch` modelling the PostgREST slice the adapter uses:
 *   - POST with `Prefer: return=representation`: inserts the posted row, minting
 *     a `gen_random_uuid()`-style id when absent (as the DB default would), and
 *     echoes the stored row back.
 *   - GET on `evaluation_reports?id=eq.<id>&limit=1`: returns the matching row.
 * Every GET replies with a bounded `Content-Range` (`0-last/total`) so the
 * client's paginated `select` terminates after a single short page.
 */
function makePostgrestStub(): typeof fetch {
  const reports: Record<string, unknown>[] = [];
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
    const match = new RegExp(`${key}=eq\\.([^&]*)`).exec(query);
    return match === null ? undefined : decodeURIComponent(match[1] ?? "");
  };

  return ((url: string | URL, init?: RequestInit) => {
    const u = new URL(String(url));
    const method = String(init?.method ?? "GET").toUpperCase();
    const query = u.search.startsWith("?") ? u.search.slice(1) : u.search;

    if (method === "POST") {
      const bodyText = typeof init?.body === "string" ? init.body : "[]";
      const parsed = JSON.parse(bodyText) as Record<string, unknown>[];
      const stored = parsed.map((row) => {
        const withId = { id: row.id ?? `gen-uuid-${(seq += 1)}`, ...row };
        reports.push(withId);
        return withId;
      });
      return Promise.resolve(
        new Response(JSON.stringify(stored), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }

    const id = parseEqValue(query, "id");
    const matched = reports.filter((row) => id === undefined || row.id === id);
    return Promise.resolve(jsonResponse(matched));
  }) as unknown as typeof fetch;
}

/** A `YYYY-MM-DD` date string generator for the split bounds (opaque to the adapter). */
const dateArb: fc.Arbitrary<string> = fc
  .integer({ min: 0, max: 13_000 })
  .map((offset) =>
    new Date(Date.UTC(2000, 0, 1) + offset * 86_400_000)
      .toISOString()
      .slice(0, 10),
  );

// Finite doubles with `-0` normalized to `0`: JSON serialization collapses `-0`
// to `0`, so a signed negative zero is not a value a stored metric can carry.
const finiteArb = (min: number, max: number): fc.Arbitrary<number> =>
  fc.double({ min, max, noNaN: true, noDefaultInfinity: true }).map((n) => n + 0);

const reportArb: fc.Arbitrary<EvaluationReport> = fc
  .record({
    configId: fc.string({ minLength: 1, maxLength: 24 }),
    trainEnd: dateArb,
    testStart: dateArb,
    testEnd: dateArb,
    sampleSize: fc.nat({ max: 500 }),
    predictionsCount: fc.nat({ max: 2000 }),
    modelAccuracy: finiteArb(0, 1),
    baselineAccuracy: finiteArb(0, 1),
    deltaVsBaseline: finiteArb(-1, 1),
    frictionAdjustedModel: finiteArb(-5, 5),
    frictionAdjustedBaseline: finiteArb(-5, 5),
    modelMfe: finiteArb(0, 100),
    modelMae: finiteArb(0, 100),
    baselineMfe: finiteArb(0, 100),
    baselineMae: finiteArb(0, 100),
    weak: fc.nat({ max: 500 }),
    moderate: fc.nat({ max: 500 }),
    strong: fc.nat({ max: 500 }),
    ciLo: finiteArb(-1, 1),
    ciHi: finiteArb(-1, 1),
    note: fc.string({ maxLength: 120 }),
    deltaExceeds3pp: fc.boolean(),
    riskAdjNonNegative: fc.boolean(),
  })
  .map((r) => ({
    configId: r.configId,
    split: { trainEnd: r.trainEnd, testStart: r.testStart, testEnd: r.testEnd },
    sampleSize: r.sampleSize,
    predictionsCount: r.predictionsCount,
    modelAccuracy: r.modelAccuracy,
    baselineAccuracy: r.baselineAccuracy,
    deltaVsBaseline: r.deltaVsBaseline,
    frictionAdjustedModel: r.frictionAdjustedModel,
    frictionAdjustedBaseline: r.frictionAdjustedBaseline,
    mfeMaeSummary: {
      modelMfe: r.modelMfe,
      modelMae: r.modelMae,
      baselineMfe: r.baselineMfe,
      baselineMae: r.baselineMae,
    },
    strengthBreakdown: { weak: r.weak, moderate: r.moderate, strong: r.strong },
    uncertainty: { accuracyDeltaCI: [r.ciLo, r.ciHi], note: r.note },
    annotations: {
      deltaExceeds3pp: r.deltaExceeds3pp,
      riskAdjNonNegative: r.riskAdjNonNegative,
    },
  }));

describe("Property: EvaluationReportStore persist/read round-trip", () => {
  it("persistReport then getReport yields a value-equal report", async () => {
    await fc.assert(
      fc.asyncProperty(reportArb, async (report) => {
        const store = new SupabaseEvaluationReportStore(
          new SupabaseRestClient(CONFIG, makePostgrestStub()),
        );

        const { reportId } = await store.persistReport(report);
        const read = await store.getReport(reportId);

        expect(read).not.toBeNull();
        expect(read).toEqual(report);
      }),
      { numRuns: 200 },
    );
  });

  it("getReport returns null for an unknown id", async () => {
    const store = new SupabaseEvaluationReportStore(
      new SupabaseRestClient(CONFIG, makePostgrestStub()),
    );
    expect(await store.getReport("no-such-id")).toBeNull();
  });
});
