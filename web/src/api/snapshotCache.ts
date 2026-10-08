/**
 * Shared snapshot cache (simplify-to-cloud-minimal R5.1).
 *
 * The whole dashboard renders from ONE `dashboard.json` snapshot, so the five tabs plus the
 * shell must not each issue their own fetch. This module memoises a single in-flight
 * `loadSnapshot()` promise and hands the same resolved snapshot to every caller. A refresh
 * discards the cache and re-fetches with a cache-busting request.
 *
 * Each tab keeps its existing loader-injection seam for testability: a tab's DEFAULT loader
 * reads the cached snapshot and selects its own slice, while a test still injects a fake
 * slice loader directly and never touches this cache.
 *
 * This module is impure (it drives `fetch` through `loadSnapshot`) and therefore lives
 * outside `web/src/pure/`.
 */

import { loadSnapshot, type DashboardSnapshot, type SnapshotOptions } from "./snapshot";

/** The cached promise for the current generation, or `null` when none is in flight. */
let cached: Promise<DashboardSnapshot> | null = null;
/** The highest refresh generation seen; a strictly larger value invalidates the cache. */
let currentGeneration = 0;

/**
 * Get the shared snapshot. The first call (generation 0) issues one `loadSnapshot()`; every
 * later call reuses that single promise. A `generation` strictly greater than the current
 * one invalidates the cache and forces ONE fresh, cache-busting fetch; concurrent callers at
 * the same generation reuse it. This lets the shell's refresh (a bumped nonce) trigger
 * exactly one re-fetch that all tabs then share.
 *
 * A failed load clears the cache so the next call retries rather than replaying the error.
 *
 * @param generation The refresh generation (0 on initial load; the shell's refreshNonce after).
 * @param options    Extra per-call options (e.g. an abort `signal`).
 */
export function getSnapshot(
  generation = 0,
  options: SnapshotOptions = {},
): Promise<DashboardSnapshot> {
  const isNewer = generation > currentGeneration;
  if (cached === null || isNewer) {
    if (isNewer) currentGeneration = generation;
    const bust: SnapshotOptions =
      currentGeneration > 0 ? { ...options, bustCache: true } : options;
    const generationAtStart = currentGeneration;
    cached = loadSnapshot(bust).catch((err: unknown) => {
      // Clear the cache on failure so a retry (or a later generation) re-fetches.
      if (currentGeneration === generationAtStart) cached = null;
      throw err;
    });
  }
  return cached;
}

/** Reset the shared cache. Intended for tests so one spec's load never leaks into another. */
export function resetSnapshotCache(): void {
  cached = null;
  currentGeneration = 0;
}
