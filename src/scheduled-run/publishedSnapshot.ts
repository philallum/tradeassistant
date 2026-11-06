// Read-back of the PUBLISHED daily snapshot — intraday-validation feature.
//
// The daily run publishes `dashboard.json` (to a public-read GCS bucket) carrying
// the immutable daily prediction for EVERY evaluated pair in `pairEvaluations`
// (fired or not). Per-pair evaluations are NOT stored in any database table, so
// the published snapshot is the authoritative record of the original prediction.
//
// The intraday Job uses this module to (a) read each pair's original direction and
// Earned_Confidence, and (b) obtain the BASE snapshot it republishes with ONLY the
// `intradayValidation` key replaced — so every daily slice stays byte-identical.
//
// READ-ONLY and FAIL-SAFE: it uses the built-in `fetch` against the public object
// URL (no credential), never throws, and returns `null` on any failure so the caller
// can degrade (and, crucially, SKIP the republish rather than publish a degraded file).

import type { TradingDate } from "../guard/types.js";
import type { DirectionClass } from "../retrieval/types.js";
import { isPair } from "../ingestion/types.js";
import type { OriginalPrediction } from "../intraday-validation/runValidation.js";
import { SNAPSHOT_FILE_NAME } from "./snapshot.js";

/** The published snapshot as an opaque JSON object (only the keys we need are read). */
export type PublishedSnapshot = Readonly<Record<string, unknown>>;

const GCS_PUBLIC_HOST = "https://storage.googleapis.com";
const FETCH_TIMEOUT_MS = 15_000;

/** The public object URL for the snapshot in `bucket`. */
export function publishedSnapshotUrl(bucket: string, fileName: string = SNAPSHOT_FILE_NAME): string {
  return `${GCS_PUBLIC_HOST}/${encodeURIComponent(bucket)}/${encodeURIComponent(fileName)}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Fetch and parse the published snapshot. Returns `null` (never throws) when the
 * bucket is unset, the request fails, the status is non-2xx, or the body is not a
 * JSON object. A cache-busting nonce guarantees the freshest object.
 */
export async function fetchPublishedSnapshot(
  bucket: string | undefined,
  fetchImpl: typeof fetch = fetch,
  nonce: () => string = () => String(Date.now()),
): Promise<PublishedSnapshot | null> {
  if (bucket === undefined || bucket.trim() === "") {
    return null;
  }
  try {
    const url = `${publishedSnapshotUrl(bucket)}?_r=${encodeURIComponent(nonce())}`;
    const res = await fetchImpl(url, {
      method: "GET",
      headers: { Accept: "application/json", "Cache-Control": "no-cache" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      return null;
    }
    const body: unknown = await res.json();
    return isObject(body) ? body : null;
  } catch {
    return null;
  }
}

/** Round to 2 decimal places (removes float noise from the ×100 conversion). */
function toPercentagePoints(fraction: number): number {
  return Math.round(fraction * 10_000) / 100;
}

const DIRECTIONS: ReadonlySet<string> = new Set<DirectionClass>(["UP", "DOWN", "FLAT"]);

/**
 * Extract the original daily prediction for EVERY pair evaluated on `decisionDate`
 * from the snapshot's `pairEvaluations` (fired or not, including FLAT). Confidence
 * is converted from the stored `[0,1]` fraction to percentage points `[0,100]`.
 * Malformed rows are skipped, never fabricated. Returns `[]` when none match.
 */
export function originalsFromPublished(
  snapshot: PublishedSnapshot | null,
  decisionDate: TradingDate,
): readonly OriginalPrediction[] {
  if (snapshot === null || !Array.isArray(snapshot.pairEvaluations)) {
    return [];
  }
  const out: OriginalPrediction[] = [];
  for (const row of snapshot.pairEvaluations as unknown[]) {
    if (
      !isObject(row) ||
      row.decision_date !== decisionDate ||
      typeof row.pair !== "string" ||
      !isPair(row.pair) ||
      typeof row.direction !== "string" ||
      !DIRECTIONS.has(row.direction) ||
      typeof row.earned_confidence !== "number" ||
      !Number.isFinite(row.earned_confidence)
    ) {
      continue;
    }
    out.push({
      pair: row.pair,
      direction: row.direction as DirectionClass,
      confidence: toPercentagePoints(row.earned_confidence),
    });
  }
  return out;
}
