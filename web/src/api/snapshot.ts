/**
 * The Public_Read_Path snapshot loader (simplify-to-cloud-minimal R5.1, R5.3, R5.4).
 *
 * This replaces the former ten-endpoint read-proxy client. Under the public-data decision
 * (Option A) the SPA no longer talks to a proxy through a `/api` rewrite; it fetches ONE
 * static JSON asset — `dashboard.json` — that the Cloud Run Job writes at the end of each
 * daily run (design Decision 2 / C3). This module is the SPA's ONLY data-fetch surface.
 *
 * The snapshot lives in a PUBLIC-READ GCS bucket, so the SPA fetches it CROSS-ORIGIN from
 * the bucket's public URL (injected at build time via `VITE_SNAPSHOT_URL`), falling back to
 * the same-origin `/dashboard.json` when that var is unset (dev / preview). The Hosting CSP
 * `connect-src` is widened to allow the GCS origin for exactly this fetch.
 *
 * It is deliberately IMPURE (it calls the platform `fetch`) and therefore lives OUTSIDE
 * `web/src/pure/` so the purity guard never covers it. It imports NOTHING from the
 * deterministic core (`src/`) and holds NO credential of any kind: the request is a plain
 * `GET` of a public static file (R4.4 — no auth gate). The SPA stays strictly read-only
 * (R5.3): there is nothing to write to.
 *
 * The snapshot is fetched ONCE and cached in-module so the five tabs + the shell share a
 * single read; a refresh re-fetches with a cache-busting request.
 */

import type {
  AnalogueOutcomeRow,
  CandleRow,
  EvaluationReportRow,
  ExternalReferenceComparisonRow,
  FiringSetupRow,
  RealizedOutcomeRow,
  SignalRationaleRow,
} from "./types";

/**
 * The URL the SPA fetches the snapshot from.
 *
 * Under the public-data decision (Option A) the Cloud Run Job writes
 * `dashboard.json` to a PUBLIC-READ GCS bucket and the SPA fetches that object's
 * public URL cross-origin. The URL is injected at build time via the
 * `VITE_SNAPSHOT_URL` env var (e.g.
 * `https://storage.googleapis.com/<bucket>/dashboard.json`). It falls back to the
 * same-origin `/dashboard.json` when the var is unset, so local dev / preview
 * (and any same-origin hosting) still work unchanged.
 */
export const SNAPSHOT_PATH: string = resolveSnapshotPath();

/**
 * Resolve the snapshot URL from the build-time env, defaulting to same-origin.
 * Exported for testability so the env override + fallback can be asserted
 * without rebuilding the bundle.
 */
export function resolveSnapshotPath(): string {
  const configured = import.meta.env.VITE_SNAPSHOT_URL;
  return typeof configured === "string" && configured.trim() !== ""
    ? configured.trim()
    : "/dashboard.json";
}

/** The schema version the SPA understands. A mismatch is tolerated (best-effort render). */
export const SNAPSHOT_SCHEMA_VERSION = 1;

/**
 * The complete `dashboard.json` envelope. Mirrors the writer's wire shape in
 * `src/scheduled-run/snapshot.ts` (kept in lockstep by hand). Every collection is a
 * read-only array; an absent slice is an empty array, so a consumer never guards for
 * `undefined`.
 */
export interface DashboardSnapshot {
  readonly schemaVersion: number;
  readonly decisionDate: string;
  readonly generatedAt: string;
  readonly decisionDates: readonly string[];
  readonly firingSetups: readonly FiringSetupRow[];
  readonly analogueOutcomes: readonly AnalogueOutcomeRow[];
  readonly realizedOutcomes: readonly RealizedOutcomeRow[];
  readonly candles: readonly CandleRow[];
  readonly aiRationale: readonly SignalRationaleRow[];
  readonly externalComparison: readonly ExternalReferenceComparisonRow[];
  readonly evaluationReports: readonly EvaluationReportRow[];
}

/**
 * Non-secret, client-safe error raised when the snapshot cannot be loaded. Its `message` is
 * always a fixed, human-readable string that excludes any raw payload or stack trace. The
 * numeric `status` (when known) lets the UI distinguish "no snapshot yet" from "something
 * broke" without exposing details.
 */
export class SnapshotError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "SnapshotError";
    this.status = status;
  }
}

/**
 * A slice of snapshot rows handed to a tab, in the `{ rows, lastUpdated }` envelope the tabs
 * consume. `lastUpdated` is the snapshot's `generatedAt` freshness marker (or `null`).
 */
export interface ApiResult<Row> {
  readonly rows: readonly Row[];
  readonly lastUpdated: string | null;
}

/** Per-call options. `bustCache` drives the refresh control's cache-bypassing fetch. */
export interface SnapshotOptions {
  /** When `true`, append a `_r=<nonce>` query param and send `Cache-Control: no-cache`. */
  readonly bustCache?: boolean;
  /** Abort signal, so an in-flight request can be cancelled by the caller. */
  readonly signal?: AbortSignal;
}

/** Dependencies injected for testability: the fetch impl and the cache-bust nonce source. */
export interface SnapshotDeps {
  /** The `fetch` implementation. Defaults to the global `fetch`. */
  readonly fetchImpl?: typeof fetch;
  /** Nonce source for the cache-bust param. Defaults to a time+random nonce. */
  readonly nonce?: () => string;
}

/** Default cache-bust nonce: monotonic-ish time plus randomness, URL-safe. */
function defaultNonce(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** An empty, well-formed snapshot — the value the SPA renders as "unavailable" (R5.5). */
export const EMPTY_SNAPSHOT: DashboardSnapshot = {
  schemaVersion: SNAPSHOT_SCHEMA_VERSION,
  decisionDate: "",
  generatedAt: "",
  decisionDates: [],
  firingSetups: [],
  analogueOutcomes: [],
  realizedOutcomes: [],
  candles: [],
  aiRationale: [],
  externalComparison: [],
  evaluationReports: [],
};

/** Narrow an untrusted parsed body into a {@link DashboardSnapshot}, filling absent slices. */
function parseSnapshot(body: unknown): DashboardSnapshot {
  if (typeof body !== "object" || body === null) {
    throw new SnapshotError("The dashboard snapshot was malformed.");
  }
  const b = body as Partial<Record<keyof DashboardSnapshot, unknown>>;
  const arr = <T>(value: unknown): readonly T[] => (Array.isArray(value) ? (value as T[]) : []);
  return {
    schemaVersion: typeof b.schemaVersion === "number" ? b.schemaVersion : SNAPSHOT_SCHEMA_VERSION,
    decisionDate: typeof b.decisionDate === "string" ? b.decisionDate : "",
    generatedAt: typeof b.generatedAt === "string" ? b.generatedAt : "",
    decisionDates: arr<string>(b.decisionDates),
    firingSetups: arr<FiringSetupRow>(b.firingSetups),
    analogueOutcomes: arr<AnalogueOutcomeRow>(b.analogueOutcomes),
    realizedOutcomes: arr<RealizedOutcomeRow>(b.realizedOutcomes),
    candles: arr<CandleRow>(b.candles),
    aiRationale: arr<SignalRationaleRow>(b.aiRationale),
    externalComparison: arr<ExternalReferenceComparisonRow>(b.externalComparison),
    evaluationReports: arr<EvaluationReportRow>(b.evaluationReports),
  };
}

/**
 * Build the request URL, appending a cache-bust nonce when requested. Uses the
 * correct separator (`?` or `&`) so the nonce works whether `SNAPSHOT_PATH` is
 * the same-origin `/dashboard.json` or a cross-origin bucket URL that may
 * already carry a query string.
 */
function buildUrl(bustCache: boolean, nonce: () => string): string {
  if (!bustCache) {
    return SNAPSHOT_PATH;
  }
  const separator = SNAPSHOT_PATH.includes("?") ? "&" : "?";
  return `${SNAPSHOT_PATH}${separator}_r=${encodeURIComponent(nonce())}`;
}

/**
 * Fetch the dashboard snapshot `dashboard.json`.
 *
 * On any transport/HTTP/parse failure a NON-SECRET {@link SnapshotError} is thrown — the raw
 * body and stack traces are never surfaced. A 404 (snapshot not yet written) is surfaced as
 * a `SnapshotError` with status 404 so the caller can show the explicit empty/unavailable
 * state (R5.5) rather than a generic error.
 */
export async function loadSnapshot(
  options: SnapshotOptions = {},
  deps: SnapshotDeps = {},
): Promise<DashboardSnapshot> {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const nonce = deps.nonce ?? defaultNonce;
  const bustCache = options.bustCache === true;

  const url = buildUrl(bustCache, nonce);
  const headers: Record<string, string> = { Accept: "application/json" };
  if (bustCache) {
    headers["Cache-Control"] = "no-cache";
  }

  const requestInit: RequestInit = {
    method: "GET",
    headers,
    cache: bustCache ? "no-store" : "default",
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  };

  let response: Response;
  try {
    response = await fetchImpl(url, requestInit);
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") {
      throw cause;
    }
    throw new SnapshotError("Could not reach the dashboard data.");
  }

  if (!response.ok) {
    if (response.status === 404) {
      throw new SnapshotError("The dashboard snapshot is not available yet.", 404);
    }
    throw new SnapshotError("The dashboard data could not be loaded.", response.status);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new SnapshotError("The dashboard snapshot was malformed.", response.status);
  }

  return parseSnapshot(body);
}
