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
  Calibration,
  CandleRow,
  Confluence,
  ConfluenceCell,
  ConfluencePair,
  ConfluenceStatus,
  ConfluenceStrategyId,
  DailyCommentary,
  Direction,
  EvaluationReportRow,
  Exposure,
  ExternalReferenceComparisonRow,
  FiringSetupRow,
  PairEvaluationRow,
  ProvenanceRow,
  RealizedOutcomeRow,
  SignalRationaleRow,
  SignalScorecard,
  TrackRecord,
  TradeLedgerSummary,
  ValidationStatusRow,
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

/**
 * The schema version the SPA understands. A mismatch is tolerated (best-effort render).
 * v2 added the `pairEvaluations` slice (the per-pair run-completion readout); v3 added the
 * pair-independent `dailyCommentary` object (the daily AI note); v4 added the evidence slices
 * `tradeLedgerSummary`, `calibration`, `exposure`, `provenance`, `validationStatus` (arrays default
 * to `[]`, objects to an explicit empty value); v5 added the `confluence` slice (the per-run
 * Confluence_Matrix). An older (v1–v4, or `schemaVersion`-less) snapshot simply lacks the
 * `confluence` slice and `parseSnapshot` defaults it to `EMPTY_CONFLUENCE` — the pre-v5 slices
 * stay lenient (`[]` for arrays, an explicit not-generated record for `dailyCommentary`). A
 * document that DECLARES v5 or newer, by contrast, must carry a well-formed `confluence` slice:
 * `parseSnapshot` validates it strictly and throws a {@link SnapshotError} on a missing or
 * defective slice rather than returning a partial snapshot (Requirements 11.11, 11.12). v6
 * added the optional per-pair `expected_range` on `pairEvaluations` rows and the `trackRecord`
 * slice; both are parsed leniently (an absent or malformed `trackRecord` becomes the empty
 * record, an absent `expected_range` means "not forecast"). v7 appends the `signalScorecard`
 * slice (the RECORDED per-signal direction ledger from the dated `signal_predictions` rows),
 * parsed leniently to `EMPTY_SIGNAL_SCORECARD` when absent or malformed.
 */
export const SNAPSHOT_SCHEMA_VERSION = 7;

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
  /** Every pair evaluated this run (fired or not) — the run-completion readout (schema v2). */
  readonly pairEvaluations: readonly PairEvaluationRow[];
  readonly analogueOutcomes: readonly AnalogueOutcomeRow[];
  readonly realizedOutcomes: readonly RealizedOutcomeRow[];
  readonly candles: readonly CandleRow[];
  readonly aiRationale: readonly SignalRationaleRow[];
  /** The pair-independent whole-day AI commentary (schema v3). Always present. */
  readonly dailyCommentary: DailyCommentary;
  readonly externalComparison: readonly ExternalReferenceComparisonRow[];
  readonly evaluationReports: readonly EvaluationReportRow[];
  /** v4: per-strategy net-of-cost summary + comparators. Empty by default. */
  readonly tradeLedgerSummary: TradeLedgerSummary;
  /** v4: OOS calibration by confidence band. Empty by default. */
  readonly calibration: Calibration;
  /** v4: aggregate currency exposure. Empty by default. */
  readonly exposure: Exposure;
  /** v4: per-forecast Signal_Provenance. Empty by default. */
  readonly provenance: readonly ProvenanceRow[];
  /** v4: per-forecast validated | unvalidated. Empty by default. */
  readonly validationStatus: readonly ValidationStatusRow[];
  /**
   * v5: the per-run Confluence_Matrix (six Strategy_Id cells per Pair plus the aggregated
   * score/status, the weights/thresholds the engine used, and the `unvalidated`
   * Validation_Label). `EMPTY_CONFLUENCE` by default (pre-v5 or `schemaVersion`-less
   * snapshots). Always present so the SPA renders an explicit state without guarding for a
   * missing key.
   */
  readonly confluence: Confluence;
  /**
   * v6: recent per-strategy hit counts and expected-candle-size hit counts, by look-ahead-safe
   * replay. `EMPTY_TRACK_RECORD` for older snapshots. Always present.
   */
  readonly trackRecord: TrackRecord;
  /**
   * v7: the RECORDED per-signal direction ledger from the dated `signal_predictions` rows
   * (all six signals, incl. the non-replayable third_party). `EMPTY_SIGNAL_SCORECARD` for
   * older snapshots. Always present.
   */
  readonly signalScorecard: SignalScorecard;
}

/** The fail-safe empty track record (pre-v6 snapshots, or a slice that failed to build). */
export const EMPTY_TRACK_RECORD: TrackRecord = { lookbackDays: 0, strategies: [], rangeForecast: [] };

/** The fail-safe empty recorded scorecard (pre-v7 snapshots, or a slice that failed to build). */
export const EMPTY_SIGNAL_SCORECARD: SignalScorecard = { totalRecorded: 0, rows: [] };

const EMPTY_TRADE_LEDGER_SUMMARY: TradeLedgerSummary = { window: null, strategies: [] };
const EMPTY_CALIBRATION: Calibration = { bands: [], monotonic: null, wellCalibrated: null };
const EMPTY_EXPOSURE: Exposure = { perCurrency: [], concentrated: false, strongestPair: null };

/**
 * The fail-safe empty `confluence` slice: the value the SPA renders for a pre-v5 (or
 * `schemaVersion`-less) snapshot that has no confluence slice at all. Mirrors the backend
 * producer's `EMPTY_CONFLUENCE` (`src/scheduled-run/snapshot.ts`) — `validationLabel`
 * `"unvalidated"`, the engine's default weights (`third_party` display-only at weight 0), the
 * default thresholds, and no Pairs. Kept in lockstep with the backend by hand.
 */
export const EMPTY_CONFLUENCE: Confluence = {
  validationLabel: "unvalidated",
  weights: { trend: 1, breakout: 1, range: 1, reversal: 1, custom_pattern: 1, third_party: 0 },
  conflictThreshold: 0.5,
  alignmentThreshold: 0.4,
  pairs: [],
};

/** The default (not-generated) daily-commentary record for an absent/empty slice. */
const EMPTY_DAILY_COMMENTARY: DailyCommentary = {
  decision_date: "",
  note_text: "",
  generated: false,
};

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
  pairEvaluations: [],
  analogueOutcomes: [],
  realizedOutcomes: [],
  candles: [],
  aiRationale: [],
  dailyCommentary: EMPTY_DAILY_COMMENTARY,
  externalComparison: [],
  evaluationReports: [],
  tradeLedgerSummary: EMPTY_TRADE_LEDGER_SUMMARY,
  calibration: EMPTY_CALIBRATION,
  exposure: EMPTY_EXPOSURE,
  provenance: [],
  validationStatus: [],
  confluence: EMPTY_CONFLUENCE,
  trackRecord: EMPTY_TRACK_RECORD,
  signalScorecard: EMPTY_SIGNAL_SCORECARD,
};

/** Narrow an untrusted `dailyCommentary` object, defaulting a missing/malformed one. */
function parseDailyCommentary(value: unknown): DailyCommentary {
  if (typeof value !== "object" || value === null) {
    return EMPTY_DAILY_COMMENTARY;
  }
  const c = value as Partial<Record<keyof DailyCommentary, unknown>>;
  return {
    decision_date: typeof c.decision_date === "string" ? c.decision_date : "",
    note_text: typeof c.note_text === "string" ? c.note_text : "",
    generated: c.generated === true,
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Narrow an untrusted `tradeLedgerSummary`, defaulting a missing/malformed one. */
function parseTradeLedgerSummary(value: unknown): TradeLedgerSummary {
  if (!isObj(value)) return EMPTY_TRADE_LEDGER_SUMMARY;
  const w = value.window;
  const window =
    isObj(w) && typeof w.from === "string" && typeof w.to === "string" ? { from: w.from, to: w.to } : null;
  return {
    window,
    strategies: Array.isArray(value.strategies) ? (value.strategies as TradeLedgerSummary["strategies"]) : [],
  };
}

/**
 * Narrow an untrusted `trackRecord`, defaulting a missing/malformed one. Lenient by design: it
 * is display-only, so a defective row is dropped (never fabricated) and a defective slice
 * becomes the empty record rather than failing the whole snapshot.
 */
export function parseTrackRecord(value: unknown): TrackRecord {
  if (!isObj(value)) return EMPTY_TRACK_RECORD;
  const count = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
  const strategies = (Array.isArray(value.strategies) ? value.strategies : []).filter(
    (r): r is TrackRecord["strategies"][number] =>
      isObj(r) &&
      typeof r.pair === "string" &&
      typeof r.strategyId === "string" &&
      CONFLUENCE_STRATEGY_ID_SET.has(r.strategyId) &&
      count(r.calls) &&
      count(r.correct) &&
      r.correct <= r.calls,
  );
  const rangeForecast = (Array.isArray(value.rangeForecast) ? value.rangeForecast : []).filter(
    (r): r is TrackRecord["rangeForecast"][number] =>
      isObj(r) &&
      typeof r.pair === "string" &&
      count(r.forecasts) &&
      count(r.correct) &&
      r.correct <= r.forecasts,
  );
  return {
    lookbackDays: count(value.lookbackDays) ? value.lookbackDays : 0,
    strategies,
    rangeForecast,
  };
}

/**
 * Narrow an untrusted `signalScorecard`, defaulting a missing/malformed one. Lenient by
 * design (display-only): a defective row is dropped, not fabricated, and a defective slice
 * becomes the empty record rather than failing the whole snapshot.
 */
export function parseSignalScorecard(value: unknown): SignalScorecard {
  if (!isObj(value)) return EMPTY_SIGNAL_SCORECARD;
  const count = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
  const rows = (Array.isArray(value.rows) ? value.rows : []).filter(
    (r): r is SignalScorecard["rows"][number] =>
      isObj(r) &&
      typeof r.pair === "string" &&
      typeof r.strategyId === "string" &&
      CONFLUENCE_STRATEGY_ID_SET.has(r.strategyId) &&
      count(r.calls) &&
      count(r.correct) &&
      count(r.flat) &&
      count(r.pending) &&
      r.correct <= r.calls,
  );
  return {
    totalRecorded: count(value.totalRecorded) ? value.totalRecorded : 0,
    rows,
  };
}

/** Narrow an untrusted `calibration`, defaulting a missing/malformed one. */
function parseCalibration(value: unknown): Calibration {
  if (!isObj(value)) return EMPTY_CALIBRATION;
  return {
    bands: Array.isArray(value.bands) ? (value.bands as Calibration["bands"]) : [],
    monotonic: typeof value.monotonic === "boolean" ? value.monotonic : null,
    wellCalibrated: typeof value.wellCalibrated === "boolean" ? value.wellCalibrated : null,
  };
}

/** Narrow an untrusted `exposure`, defaulting a missing/malformed one. */
function parseExposure(value: unknown): Exposure {
  if (!isObj(value)) return EMPTY_EXPOSURE;
  return {
    perCurrency: Array.isArray(value.perCurrency) ? (value.perCurrency as Exposure["perCurrency"]) : [],
    concentrated: value.concentrated === true,
    strongestPair: typeof value.strongestPair === "string" ? value.strongestPair : null,
  };
}

// ---------------------------------------------------------------------------------------
// v5 confluence slice: STRICT parsing. Unlike every pre-v5 slice (which defaults a
// missing/malformed value to its empty form), a snapshot that DECLARES schema v5+ MUST carry
// a well-formed `confluence` slice. A single defect — a missing field, a wrong type, an
// unknown Strategy_Id or Confluence_Status, the wrong cell count — throws the one fixed
// `SnapshotError` below and yields NO partial snapshot (Requirements 11.11, 11.12).
// ---------------------------------------------------------------------------------------

/** The single, fixed, non-secret message for any defect in a declared-v5 confluence slice. */
const CONFLUENCE_ERROR_MESSAGE = "The dashboard snapshot has an invalid confluence slice.";

/** The six Strategy_Ids in `STRATEGY_IDS` order — a declared-v5 Pair carries exactly these. */
const CONFLUENCE_STRATEGY_IDS: readonly ConfluenceStrategyId[] = [
  "trend",
  "breakout",
  "range",
  "reversal",
  "custom_pattern",
  "third_party",
];

const CONFLUENCE_STRATEGY_ID_SET: ReadonlySet<string> = new Set(CONFLUENCE_STRATEGY_IDS);

const CONFLUENCE_STATUSES: ReadonlySet<string> = new Set<ConfluenceStatus>([
  "ALIGNED_UP",
  "ALIGNED_DOWN",
  "NEUTRAL",
  "CONFLICT_FLAT",
  "INSUFFICIENT_DATA",
]);

const CELL_DIRECTIONS: ReadonlySet<string> = new Set<Direction>(["UP", "DOWN", "FLAT"]);

/** Fail strict parsing: every confluence defect surfaces as the one fixed, non-secret error. */
function failConfluence(): never {
  throw new SnapshotError(CONFLUENCE_ERROR_MESSAGE);
}

const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.length > 0;

/** Strictly validate one {@link ConfluenceCell}; any defect throws. */
function parseConfluenceCell(value: unknown, expectedId: ConfluenceStrategyId): ConfluenceCell {
  if (!isObj(value)) failConfluence();
  if (value.strategyId !== expectedId) failConfluence();
  if (value.available === true) {
    if (typeof value.direction !== "string" || !CELL_DIRECTIONS.has(value.direction)) failConfluence();
    if (!isFiniteNumber(value.strength)) failConfluence();
    if (typeof value.rationale !== "string") failConfluence();
    return {
      strategyId: expectedId,
      available: true,
      direction: value.direction as Direction,
      strength: value.strength,
      rationale: value.rationale,
    };
  }
  if (value.available === false) {
    if (!isNonEmptyString(value.reason)) failConfluence();
    return { strategyId: expectedId, available: false, reason: value.reason };
  }
  return failConfluence();
}

/** Strictly validate one {@link ConfluencePair}; any defect throws. */
function parseConfluencePair(value: unknown): ConfluencePair {
  if (!isObj(value)) failConfluence();
  if (typeof value.pair !== "string") failConfluence();
  if (!isFiniteNumber(value.score)) failConfluence();
  if (typeof value.status !== "string" || !CONFLUENCE_STATUSES.has(value.status)) failConfluence();
  if (!Array.isArray(value.opposingStrategyIds)) failConfluence();
  const opposingStrategyIds = value.opposingStrategyIds.map((id) => {
    if (typeof id !== "string" || !CONFLUENCE_STRATEGY_ID_SET.has(id)) failConfluence();
    return id as ConfluenceStrategyId;
  });
  const rawCells = value.cells;
  if (!Array.isArray(rawCells) || rawCells.length !== CONFLUENCE_STRATEGY_IDS.length) failConfluence();
  const cells = CONFLUENCE_STRATEGY_IDS.map((id, i) => parseConfluenceCell(rawCells[i], id));
  return {
    pair: value.pair,
    score: value.score,
    status: value.status as ConfluenceStatus,
    opposingStrategyIds,
    cells,
  };
}

/**
 * Strictly validate the `confluence` slice of a snapshot that DECLARES schema v5+. On ANY
 * defect — missing slice, wrong `validationLabel`, a weight missing or non-finite for any of
 * the six Strategy_Ids, a non-finite threshold, or a malformed Pair/cell — it throws the one
 * fixed {@link SnapshotError} and returns no partial value (Requirements 11.11, 11.12).
 * `pairs` must be either empty or well-formed; the writer only ever emits zero or five Pairs.
 */
export function parseConfluenceStrict(value: unknown): Confluence {
  if (!isObj(value)) failConfluence();
  if (value.validationLabel !== "unvalidated") failConfluence();
  if (!isObj(value.weights)) failConfluence();
  const rawWeights = value.weights;
  const weights = {} as Record<ConfluenceStrategyId, number>;
  for (const id of CONFLUENCE_STRATEGY_IDS) {
    const w = rawWeights[id];
    if (!isFiniteNumber(w)) failConfluence();
    weights[id] = w;
  }
  if (!isFiniteNumber(value.conflictThreshold)) failConfluence();
  if (!isFiniteNumber(value.alignmentThreshold)) failConfluence();
  if (!Array.isArray(value.pairs)) failConfluence();
  const pairs = value.pairs.map((p) => parseConfluencePair(p));
  return {
    validationLabel: "unvalidated",
    weights,
    conflictThreshold: value.conflictThreshold,
    alignmentThreshold: value.alignmentThreshold,
    pairs,
  };
}

/** Narrow an untrusted parsed body into a {@link DashboardSnapshot}, filling absent slices. */
export function parseSnapshot(body: unknown): DashboardSnapshot {
  if (typeof body !== "object" || body === null) {
    throw new SnapshotError("The dashboard snapshot was malformed.");
  }
  const b = body as Partial<Record<keyof DashboardSnapshot, unknown>>;
  const arr = <T>(value: unknown): readonly T[] => (Array.isArray(value) ? (value as T[]) : []);
  // The confluence slice is the sole strictly-parsed slice, gated on the DECLARED version. A
  // missing/non-numeric `schemaVersion` is treated as 0, so pre-v5 and version-less snapshots
  // default to EMPTY_CONFLUENCE (never an error); a declared v5+ must carry a valid slice.
  const declared = typeof b.schemaVersion === "number" ? b.schemaVersion : 0;
  const confluence = declared < 5 ? EMPTY_CONFLUENCE : parseConfluenceStrict(b.confluence);
  return {
    schemaVersion: typeof b.schemaVersion === "number" ? b.schemaVersion : SNAPSHOT_SCHEMA_VERSION,
    decisionDate: typeof b.decisionDate === "string" ? b.decisionDate : "",
    generatedAt: typeof b.generatedAt === "string" ? b.generatedAt : "",
    decisionDates: arr<string>(b.decisionDates),
    firingSetups: arr<FiringSetupRow>(b.firingSetups),
    pairEvaluations: arr<PairEvaluationRow>(b.pairEvaluations),
    analogueOutcomes: arr<AnalogueOutcomeRow>(b.analogueOutcomes),
    realizedOutcomes: arr<RealizedOutcomeRow>(b.realizedOutcomes),
    candles: arr<CandleRow>(b.candles),
    aiRationale: arr<SignalRationaleRow>(b.aiRationale),
    dailyCommentary: parseDailyCommentary(b.dailyCommentary),
    externalComparison: arr<ExternalReferenceComparisonRow>(b.externalComparison),
    evaluationReports: arr<EvaluationReportRow>(b.evaluationReports),
    tradeLedgerSummary: parseTradeLedgerSummary(b.tradeLedgerSummary),
    calibration: parseCalibration(b.calibration),
    exposure: parseExposure(b.exposure),
    provenance: arr<ProvenanceRow>(b.provenance),
    validationStatus: arr<ValidationStatusRow>(b.validationStatus),
    confluence,
    trackRecord: parseTrackRecord(b.trackRecord),
    signalScorecard: parseSignalScorecard(b.signalScorecard),
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
