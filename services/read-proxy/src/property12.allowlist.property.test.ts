import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  ENDPOINTS,
  HARD_ROW_CEILING,
  PAIRS,
  buildQueryForPath,
  type EndpointSpec,
  type RawParams,
} from "./allowlist.js";

// Feature: dashboard-ui, Property 12: Allowlist rejects invalid requests and bounds response size
//
// *For any* request path and raw parameter map, `buildQuery` returns a rejection (no query is
// built) when the path is not in the allowlist, a required parameter is missing, a parameter
// fails its validator, or a value exceeds its bound; and whenever it returns a query, that
// query carries a `limit` no greater than the endpoint's configured maximum row cap.
//
// Validates: Requirements 5.4, 5.5

const NUM_RUNS = 200; // >= 100 iterations per spec convention.

const ALLOWED_PATHS: readonly string[] = ENDPOINTS.map((e) => e.path);

/** A path that is guaranteed NOT to be in the allowlist. */
const unknownPathArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 24 })
  .map((s) => `/${s.replace(/[^A-Za-z0-9-]/g, "x")}`)
  .filter((p) => !ALLOWED_PATHS.includes(p));

/** A syntactically valid value for a param of the given kind. */
function validValueArb(
  kind: "isoDate" | "pair" | "uuid" | "boundedInt",
  max: number | undefined,
): fc.Arbitrary<string> {
  switch (kind) {
    case "isoDate":
      // Days from 2000-01-01 through ~2025, formatted as YYYY-MM-DD.
      return fc.integer({ min: 0, max: 9131 }).map((days) => {
        const d = new Date(Date.UTC(2000, 0, 1) + days * 86_400_000);
        return d.toISOString().slice(0, 10);
      });
    case "pair":
      return fc.constantFrom(...PAIRS);
    case "uuid":
      return fc.uuid();
    case "boundedInt": {
      const upper = max ?? HARD_ROW_CEILING;
      return fc.integer({ min: 1, max: upper }).map((n) => String(n));
    }
  }
}

/** Build a fully-valid raw param map for an endpoint (all required + optional). */
function validRawArb(spec: EndpointSpec): fc.Arbitrary<RawParams> {
  const entries = Object.entries(spec.params);
  if (entries.length === 0) return fc.constant({} as RawParams);
  const recordShape: Record<string, fc.Arbitrary<string>> = {};
  for (const [name, rule] of entries) {
    recordShape[name] = validValueArb(rule.kind, rule.max);
  }
  // Optionally omit non-required params so we exercise defaults too.
  const requiredKeys = entries
    .filter(([, r]) => r.required)
    .map(([n]) => n);
  const optionalKeys = entries
    .filter(([, r]) => !r.required)
    .map(([n]) => n);
  return fc
    .record(recordShape)
    .chain((full) =>
      fc
        .subarray(optionalKeys)
        .map((keepOptional) => {
          const out: Record<string, string> = {};
          for (const k of requiredKeys) {
            const v = full[k];
            if (v !== undefined) out[k] = v;
          }
          for (const k of keepOptional) {
            const v = full[k];
            if (v !== undefined) out[k] = v;
          }
          return out as RawParams;
        }),
    );
}

/** Extract the numeric `limit=` emitted in a built query string. */
function limitOf(query: string): number {
  const m = /(?:^|&)limit=(\d+)(?:&|$)/.exec(query);
  expect(m).not.toBeNull();
  return Number(m![1]);
}

describe("Property 12: allowlist rejects invalid requests and bounds response size", () => {
  it("rejects any path that is not in the allowlist with 404 and builds no query", () => {
    fc.assert(
      fc.property(unknownPathArb, fc.dictionary(fc.string(), fc.string()), (path, raw) => {
        const result = buildQueryForPath(path, raw as RawParams);
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.status).toBe(404);
          expect(result).not.toHaveProperty("query");
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("rejects with 400 (no query) when a required parameter is missing", () => {
    const specsWithRequired = ENDPOINTS.filter((e) =>
      Object.values(e.params).some((r) => r.required),
    );
    fc.assert(
      fc.property(
        fc.constantFrom(...specsWithRequired).chain((spec) =>
          validRawArb(spec).map((raw) => ({ spec, raw })),
        ),
        ({ spec, raw }) => {
          const requiredNames = Object.entries(spec.params)
            .filter(([, r]) => r.required)
            .map(([n]) => n);
          // Drop one required param. The spec set is pre-filtered to have >= 1.
          const toDrop = requiredNames[0];
          expect(toDrop).toBeDefined();
          const dropped = { ...raw };
          delete dropped[toDrop!];
          const result = buildQueryForPath(spec.path, dropped as RawParams);
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.status).toBe(400);
            expect(result).not.toHaveProperty("query");
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("rejects with 400 (no query) when a parameter is unknown to the endpoint", () => {
    fc.assert(
      fc.property(
        fc
          .constantFrom(...ENDPOINTS)
          .chain((spec) =>
            validRawArb(spec).map((raw) => ({ spec, raw })),
          ),
        fc.string({ minLength: 1, maxLength: 12 }),
        ({ spec, raw }, junkName) => {
          const name = junkName.replace(/[^A-Za-z0-9_]/g, "z") || "z";
          // Ensure the injected name is genuinely unknown to this endpoint.
          fc.pre(
            !Object.prototype.hasOwnProperty.call(spec.params, name),
          );
          const polluted = { ...raw, [name]: "x" };
          const result = buildQueryForPath(spec.path, polluted as RawParams);
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.status).toBe(400);
            expect(result).not.toHaveProperty("query");
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("rejects with 400 (no query) when a boundedInt value exceeds its bound", () => {
    const specsWithBounded = ENDPOINTS.filter((e) =>
      Object.values(e.params).some((r) => r.kind === "boundedInt"),
    );
    fc.assert(
      fc.property(
        fc
          .constantFrom(...specsWithBounded)
          .chain((spec) => validRawArb(spec).map((raw) => ({ spec, raw }))),
        fc.integer({ min: 1, max: 1_000_000 }),
        ({ spec, raw }, over) => {
          const bounded = Object.entries(spec.params).find(
            ([, r]) => r.kind === "boundedInt",
          )!;
          const [name, rule] = bounded;
          const max = rule.max ?? HARD_ROW_CEILING;
          const outOfRange = { ...raw, [name]: String(max + over) };
          const result = buildQueryForPath(spec.path, outOfRange as RawParams);
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.status).toBe(400);
            expect(result).not.toHaveProperty("query");
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("rejects with 400 (no query) when a typed parameter fails its validator", () => {
    fc.assert(
      fc.property(
        fc
          .constantFrom(...ENDPOINTS)
          .filter((e) => Object.keys(e.params).length > 0)
          .chain((spec) => validRawArb(spec).map((raw) => ({ spec, raw }))),
        ({ spec, raw }) => {
          const paramNames = Object.keys(spec.params);
          // Corrupt the first param with a value its validator must reject. The
          // arbitrary is pre-filtered to endpoints with >= 1 param, so this is set.
          const name = paramNames[0];
          expect(name).toBeDefined();
          const rule = spec.params[name!]!;
          let badValue: string;
          switch (rule.kind) {
            case "isoDate":
              badValue = "2024-13-99"; // impossible month/day
              break;
            case "pair":
              badValue = "ZZZZZZ"; // not one of PAIRS
              break;
            case "uuid":
              badValue = "not-a-uuid"; // malformed
              break;
            case "boundedInt":
              badValue = "0"; // below the [1, max] range
              break;
            default: {
              // Exhaustiveness guard: every ParamKind is handled above.
              const _never: never = rule.kind;
              badValue = _never;
            }
          }
          const corrupted = { ...raw, [name!]: badValue };
          const result = buildQueryForPath(spec.path, corrupted as RawParams);
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.status).toBe(400);
            expect(result).not.toHaveProperty("query");
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("builds a query whose limit never exceeds the endpoint cap for accepted requests", () => {
    fc.assert(
      fc.property(
        fc
          .constantFrom(...ENDPOINTS)
          .chain((spec) => validRawArb(spec).map((raw) => ({ spec, raw }))),
        ({ spec, raw }) => {
          const result = buildQueryForPath(spec.path, raw);
          expect(result.ok).toBe(true);
          if (result.ok) {
            const limit = limitOf(result.query);
            expect(limit).toBeLessThanOrEqual(spec.maxRows);
            expect(limit).toBeLessThanOrEqual(HARD_ROW_CEILING);
            expect(limit).toBeGreaterThanOrEqual(1);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
