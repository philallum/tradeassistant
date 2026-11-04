/**
 * Pure route helper for the explicitly opened evaluation detail view (Req 8.3).
 *
 * The single-window dashboard has no tab routes; the retained Gate/evaluation detail view is
 * reached only on demand via the `#/evaluation` hash. `routing/routes.ts` is intentionally
 * left unmodified. This module is PURE: no DOM, no clock, no I/O.
 */

/** Canonical hash for the evaluation detail view. */
export const EVALUATION_DETAIL_HASH = "#/evaluation";

/**
 * Is `hash` the evaluation detail route? Tolerates a missing leading `#`, and ignores any
 * trailing `/`, `?` or `#` suffix after the `evaluation` segment (selection lives in the query).
 */
export function isEvaluationDetailHash(hash: string): boolean {
  const withoutHash = hash.startsWith("#") ? hash.slice(1) : hash;
  const withoutSlash = withoutHash.startsWith("/") ? withoutHash.slice(1) : withoutHash;
  const segment = withoutSlash.split(/[/?#]/, 1)[0] ?? "";
  return segment === "evaluation";
}
