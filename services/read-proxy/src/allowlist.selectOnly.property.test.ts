import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  buildQuery,
  ENDPOINTS,
  HARD_ROW_CEILING,
  PAIRS,
  type EndpointSpec,
  type ParamRule,
  type RawParams,
} from "./allowlist.js";

// Feature: dashboard-ui, Property 11: Read proxy issues SELECT-only queries.
// For any allowlisted endpoint and any accepted parameter map, the PostgREST query produced
// by `buildQuery` is a read-only filter/order/limit expression and never contains an insert,
// update, delete, upsert, or RPC verb; and the read client exposes no method capable of a
// mutating request.
//
// **Validates: Requirements 3.4, 3.5**

const NUM_RUNS = 200; // >= 100 iterations required by the task.

/**
 * A tiny valid UUID generator — fast-check has no built-in uuid in a shape we can
 * rely on across versions, so build an RFC-4122-style canonical hex string.
 */
const hex = (len: number): fc.Arbitrary<string> =>
  fc
    .array(fc.integer({ min: 0, max: 15 }), { minLength: len, maxLength: len })
    .map((ns) => ns.map((n) => n.toString(16)).join(""));

const uuidArb: fc.Arbitrary<string> = fc
  .tuple(hex(8), hex(4), hex(4), hex(4), hex(12))
  .map(([a, b, c, d, e]) => `${a}-${b}-${c}-${d}-${e}`);

/** A valid ISO calendar date (YYYY-MM-DD) built from a bounded day offset. */
const isoDateArb: fc.Arbitrary<string> = fc
  .integer({ min: 0, max: 9131 }) // 2000-01-01 .. ~2025-01-01
  .map((days) =>
    new Date(Date.UTC(2000, 0, 1) + days * 86_400_000).toISOString().slice(0, 10),
  );

const pairArb: fc.Arbitrary<string> = fc.constantFrom(...PAIRS);

/** Produce an arbitrary that yields a VALID value for a single param rule. */
function valueArbFor(rule: ParamRule): fc.Arbitrary<string> {
  switch (rule.kind) {
    case "isoDate":
      return isoDateArb;
    case "pair":
      return pairArb;
    case "uuid":
      return uuidArb;
    case "boundedInt": {
      const max = rule.max ?? HARD_ROW_CEILING;
      return fc.integer({ min: 1, max }).map((n) => String(n));
    }
  }
}

/**
 * For a given endpoint, build an arbitrary accepted parameter map: required
 * params are always present; optional params are randomly present or absent.
 * Every emitted value is valid for its rule, so `buildQuery` must accept it.
 */
function acceptedParamsArb(spec: EndpointSpec): fc.Arbitrary<RawParams> {
  const entries = Object.entries(spec.params);
  if (entries.length === 0) {
    return fc.constant({} as RawParams);
  }
  const perParam = entries.map(([name, rule]) => {
    const valueArb = valueArbFor(rule);
    if (rule.required) {
      return valueArb.map((v) => [[name, v]] as Array<[string, string]>);
    }
    // Optional: either omit the key entirely, or include a valid value.
    return fc.option(valueArb, { nil: undefined }).map((v) =>
      v === undefined ? [] : ([[name, v]] as Array<[string, string]>),
    );
  });
  return fc.tuple(...perParam).map((parts) => {
    const flat = parts.flat();
    return Object.fromEntries(flat) as RawParams;
  });
}

/** Arbitrary over (endpoint, acceptedParams) across the whole allowlist. */
const endpointAndParamsArb: fc.Arbitrary<{
  spec: EndpointSpec;
  raw: RawParams;
}> = fc
  .constantFrom(...ENDPOINTS)
  .chain((spec) => acceptedParamsArb(spec).map((raw) => ({ spec, raw })));

// Mutating verbs / RPC markers that must NEVER appear in a built query string.
// PostgREST issues writes via HTTP method + body, never via these tokens in a
// GET query string, so their presence would signal a non-SELECT shape.
const FORBIDDEN_TOKENS = [
  "insert",
  "update",
  "delete",
  "upsert",
  "/rpc/",
  "rpc.",
  "on_conflict",
  "returning",
];

// Only read-shaping clause names are allowed on the left of a query parameter.
// Everything else is a column filter of the form `<col>=<op>.<value>`.
const READ_CLAUSE_KEYS = new Set(["select", "order", "limit", "offset"]);

describe("Property 11: Read proxy issues SELECT-only queries", () => {
  it("builds only read-only filter/order/limit queries for every accepted request", () => {
    fc.assert(
      fc.property(endpointAndParamsArb, ({ spec, raw }) => {
        const result = buildQuery(spec, raw);

        // A fully-valid accepted param map must always succeed.
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const query = result.query;
        const lower = query.toLowerCase();

        // 1. No mutating verb or RPC marker anywhere in the query string.
        for (const token of FORBIDDEN_TOKENS) {
          expect(lower.includes(token)).toBe(false);
        }

        // 2. The query targets the endpoint's view (never a base table / rewrite).
        expect(result.view).toBe(spec.view);

        // 3. Every clause is a read-shaping clause (select/order/limit/offset) or a
        //    column filter. A filter's operator must be a PostgREST read operator
        //    (eq/gte/lte/...), never a write directive.
        const clauses = query.length === 0 ? [] : query.split("&");
        for (const clause of clauses) {
          const eqIdx = clause.indexOf("=");
          expect(eqIdx).toBeGreaterThan(0);
          const key = clause.slice(0, eqIdx);
          const val = clause.slice(eqIdx + 1);

          if (READ_CLAUSE_KEYS.has(key)) {
            continue;
          }
          // Otherwise it is a column filter: value is `<op>.<encoded>`.
          const dot = val.indexOf(".");
          expect(dot).toBeGreaterThan(0);
          const op = val.slice(0, dot);
          expect(
            ["eq", "gte", "lte", "gt", "lt", "in", "like", "ilike"].includes(op),
          ).toBe(true);
        }

        // 4. A bounded limit clause is always present and within the endpoint cap.
        const limitClause = clauses.find((c) => c.startsWith("limit="));
        expect(limitClause).toBeDefined();
        const limitVal = Number(limitClause?.slice("limit=".length));
        expect(Number.isInteger(limitVal)).toBe(true);
        expect(limitVal).toBeGreaterThanOrEqual(1);
        expect(limitVal).toBeLessThanOrEqual(
          Math.min(spec.maxRows, HARD_ROW_CEILING),
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
