// dashboard-ui Read_Proxy — endpoint allowlist + pure query building.
//
// This module is PURE: it performs no I/O. No fetch, no http, no Date.now, no DB
// client, no environment reads. It maps each allowlisted endpoint to exactly one
// Read_Only_View, validates every incoming parameter against a fixed schema, and
// produces a SELECT-only PostgREST query string whose `limit` never exceeds the
// endpoint's configured row cap. Rate limiting, caching, the SELECT-only client,
// and the HTTP server are built in later tasks and MUST NOT appear here.
//
// _Requirements: 5.4 (bounded response size), 5.5 (fixed allowlist; reject else)_

/** The five supported currency pairs (asset scope for the serving layer). */
export const PAIRS = [
  "EURUSD",
  "GBPUSD",
  "USDJPY",
  "USDCHF",
  "USDCAD",
] as const;

export type Pair = (typeof PAIRS)[number];

/**
 * Global hard ceiling on rows for any single response. No endpoint cap may
 * exceed this, and every built query carries a `limit` no greater than this.
 */
export const HARD_ROW_CEILING = 1000;

/** Raw, untrusted query parameters as received from the request line. */
export type RawParams = Readonly<Record<string, string>>;

/** Kind of validator applied to a single parameter value. */
export type ParamKind = "isoDate" | "pair" | "uuid" | "boundedInt";

/**
 * A single parameter's validation + query-shaping rule.
 *
 * - `required`   — a missing value is a 400 rejection.
 * - `kind`       — which validator the value must pass.
 * - `column`     — the view column this param filters on (for filtered params).
 *                  Absent for params that only shape paging (e.g. `limit`).
 * - `max`        — upper bound for a `boundedInt` param (inclusive).
 * - `default`    — default applied for an absent optional `boundedInt`.
 */
export interface ParamRule {
  readonly required: boolean;
  readonly kind: ParamKind;
  readonly column?: string;
  readonly max?: number;
  readonly default?: number;
}

/** The accepted-parameter schema for an endpoint (name -> rule). */
export type ParamSchema = Readonly<Record<string, ParamRule>>;

export interface EndpointSpec {
  readonly path: string;
  readonly view: string;
  readonly params: ParamSchema; // required/optional param validators
  readonly maxRows: number; // response-size cap (Req 5.4)
  readonly cacheTtlMs: number; // short TTL (Req 5.2)
}

/** Short-TTL cache windows (Req 5.2). Exact numbers are a design detail. */
const TTL_DEFAULT_MS = 120_000; // 120 s — data changes ~once/day
const TTL_DECISION_DATES_MS = 300_000; // 300 s — changes only on a new run

/**
 * The fixed endpoint allowlist. Each endpoint maps to exactly one view, a
 * validated param schema, and a bounded row cap. This list is the ONLY set of
 * accepted endpoints; anything else is a 404 (Req 5.5).
 */
export const ENDPOINTS: readonly EndpointSpec[] = [
  {
    path: "/decision-dates",
    view: "v_decision_dates",
    params: {},
    maxRows: 1000,
    cacheTtlMs: TTL_DECISION_DATES_MS,
  },
  {
    path: "/firing-setups",
    view: "v_firing_setups",
    params: {
      decisionDate: { required: true, kind: "isoDate", column: "decision_date" },
      pair: { required: false, kind: "pair", column: "pair" },
    },
    maxRows: 5,
    cacheTtlMs: TTL_DEFAULT_MS,
  },
  {
    path: "/confidence-trend",
    view: "v_firing_setups",
    params: {
      pair: { required: true, kind: "pair", column: "pair" },
      limit: { required: false, kind: "boundedInt", max: 500, default: 180 },
    },
    maxRows: 500,
    cacheTtlMs: TTL_DEFAULT_MS,
  },
  {
    path: "/analogue-outcomes",
    view: "v_analogue_outcomes",
    params: {
      // `v_analogue_outcomes` projects the pair column as `asset` (not `pair`),
      // so the public `pair` param must filter on the `asset` column.
      pair: { required: true, kind: "pair", column: "asset" },
      decisionDate: { required: false, kind: "isoDate", column: "decision_date" },
    },
    maxRows: 300,
    cacheTtlMs: TTL_DEFAULT_MS,
  },
  {
    path: "/realized-outcomes",
    view: "v_realized_outcomes",
    params: {
      pair: { required: true, kind: "pair", column: "pair" },
      decisionDate: { required: false, kind: "isoDate", column: "decision_date" },
    },
    maxRows: 300,
    cacheTtlMs: TTL_DEFAULT_MS,
  },
  {
    path: "/gate-verdicts",
    view: "v_gate_verdicts",
    params: {
      limit: { required: false, kind: "boundedInt", max: 50, default: 50 },
    },
    maxRows: 50,
    cacheTtlMs: TTL_DEFAULT_MS,
  },
  {
    path: "/gate-fold-verdicts",
    view: "v_gate_fold_verdicts",
    params: {
      verdictId: { required: true, kind: "uuid", column: "verdict_id" },
    },
    maxRows: 50,
    cacheTtlMs: TTL_DEFAULT_MS,
  },
  {
    path: "/candles",
    view: "v_candles",
    params: {
      // `v_candles` projects the pair column as `asset` (not `pair`), so the
      // public `pair` param must filter on the `asset` column.
      pair: { required: true, kind: "pair", column: "asset" },
      from: { required: false, kind: "isoDate", column: "date" },
      to: { required: false, kind: "isoDate", column: "date" },
    },
    maxRows: 400,
    cacheTtlMs: TTL_DEFAULT_MS,
  },
  {
    path: "/ai-rationale",
    view: "v_signal_rationale",
    params: {
      decisionDate: { required: true, kind: "isoDate", column: "decision_date" },
      pair: { required: true, kind: "pair", column: "pair" },
    },
    maxRows: 10,
    cacheTtlMs: TTL_DEFAULT_MS,
  },
  {
    path: "/external-comparison",
    view: "v_external_reference_comparison",
    params: {
      decisionDate: { required: true, kind: "isoDate", column: "decision_date" },
      pair: { required: true, kind: "pair", column: "pair" },
    },
    maxRows: 10,
    cacheTtlMs: TTL_DEFAULT_MS,
  },
] as const;

/** Result of a successful query build. */
export interface BuildOk {
  readonly ok: true;
  readonly view: string;
  readonly query: string;
}

/** Result of a rejected request. 404 = unknown path, 400 = bad/absent param. */
export interface BuildErr {
  readonly ok: false;
  readonly status: 400 | 404;
  readonly message: string;
}

export type BuildResult = BuildOk | BuildErr;

/** ISO calendar-date validator: strict `YYYY-MM-DD` (also range-checks the date). */
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(value: string): boolean {
  const m = ISO_DATE_RE.exec(value);
  if (m === null) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  // Reject impossible days per month (incl. leap-year Feb) without touching a clock.
  const daysInMonth = [
    31,
    isLeapYear(year) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  const limit = daysInMonth[month - 1];
  return limit !== undefined && day <= limit;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Pair validator: exactly one of the five supported PAIRS. */
export function isPair(value: string): value is Pair {
  return (PAIRS as readonly string[]).includes(value);
}

/** RFC 4122 canonical UUID validator (any version/variant hex form). */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/**
 * Bounded-int validator: a non-negative integer in `[1, max]`. Returns the
 * parsed value, or `null` if the string is not a clean in-range integer.
 */
export function parseBoundedInt(value: string, max: number): number | null {
  if (!/^\d+$/.test(value)) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > max) return null;
  return n;
}

/** PostgREST filter-value encoder (`col=eq.<v>`), mirroring the core client. */
function eq(value: string): string {
  return `eq.${encodeURIComponent(value)}`;
}

/**
 * Build a SELECT-only PostgREST query for an allowlisted endpoint, or reject.
 *
 * PURE. The returned `query` contains only filter / order / limit clauses — never
 * an insert, update, delete, upsert, or RPC verb — and always carries a `limit`
 * no greater than `spec.maxRows` (and no greater than HARD_ROW_CEILING). No query
 * is built on rejection.
 */
export function buildQuery(spec: EndpointSpec, raw: RawParams): BuildResult {
  const filters: string[] = [];

  // The effective row cap: the endpoint cap, clamped to the global hard ceiling.
  const cap = Math.min(spec.maxRows, HARD_ROW_CEILING);
  // Row limit actually emitted; a boundedInt `limit` param may lower it.
  let rowLimit = cap;

  // Reject any param the endpoint does not accept (unknown param -> 400).
  for (const name of Object.keys(raw)) {
    if (!Object.prototype.hasOwnProperty.call(spec.params, name)) {
      return {
        ok: false,
        status: 400,
        message: `Unknown parameter: ${safeName(name)}`,
      };
    }
  }

  // Validate each accepted param (required/optional) and shape the query.
  for (const [name, rule] of Object.entries(spec.params)) {
    const present = Object.prototype.hasOwnProperty.call(raw, name);
    const value = present ? raw[name] : undefined;

    if (!present || value === undefined || value === "") {
      if (rule.required) {
        return {
          ok: false,
          status: 400,
          message: `Missing required parameter: ${safeName(name)}`,
        };
      }
      // Optional boundedInt with a default still constrains the row limit.
      if (rule.kind === "boundedInt" && rule.default !== undefined) {
        rowLimit = Math.min(rowLimit, rule.default);
      }
      continue;
    }

    switch (rule.kind) {
      case "isoDate": {
        if (!isIsoDate(value)) {
          return {
            ok: false,
            status: 400,
            message: `Invalid date for parameter: ${safeName(name)}`,
          };
        }
        if (rule.column !== undefined) {
          filters.push(`${rule.column}=${eq(value)}`);
        }
        break;
      }
      case "pair": {
        if (!isPair(value)) {
          return {
            ok: false,
            status: 400,
            message: `Invalid pair for parameter: ${safeName(name)}`,
          };
        }
        if (rule.column !== undefined) {
          filters.push(`${rule.column}=${eq(value)}`);
        }
        break;
      }
      case "uuid": {
        if (!isUuid(value)) {
          return {
            ok: false,
            status: 400,
            message: `Invalid identifier for parameter: ${safeName(name)}`,
          };
        }
        if (rule.column !== undefined) {
          filters.push(`${rule.column}=${eq(value)}`);
        }
        break;
      }
      case "boundedInt": {
        const max = rule.max ?? cap;
        const n = parseBoundedInt(value, max);
        if (n === null) {
          return {
            ok: false,
            status: 400,
            message: `Out-of-range value for parameter: ${safeName(name)}`,
          };
        }
        rowLimit = Math.min(rowLimit, n);
        break;
      }
    }
  }

  // Final clamp — defense in depth so the limit can never exceed the cap.
  rowLimit = Math.min(rowLimit, cap, HARD_ROW_CEILING);

  filters.push(`limit=${rowLimit}`);

  return { ok: true, view: spec.view, query: filters.join("&") };
}

/**
 * Resolve a request path to its endpoint spec, then build its query. A path not
 * in the allowlist is a 404 and never reaches the database (Req 5.5).
 */
export function buildQueryForPath(path: string, raw: RawParams): BuildResult {
  const spec = ENDPOINTS.find((e) => e.path === path);
  if (spec === undefined) {
    return { ok: false, status: 404, message: "Unknown endpoint" };
  }
  return buildQuery(spec, raw);
}

/**
 * Credential-free, client-safe rendering of a parameter name for an error
 * message. Only the fixed allowlist param names ever reach a success path, but a
 * rejected unknown param name is attacker-controlled, so it is length-bounded and
 * restricted to a safe character class before being echoed.
 */
function safeName(name: string): string {
  const trimmed = name.slice(0, 40);
  return /^[A-Za-z0-9_]+$/.test(trimmed) ? trimmed : "<invalid>";
}
