// Timezone-aware 4H forming-bar selection — Task 2 (intraday-validation feature).
//
// 4H FX bars sit on FIXED UTC boundaries: 00:00, 04:00, 08:00, 12:00, 16:00,
// 20:00 UTC. The "currently-forming" bar at an instant `now` is the one whose
// open satisfies `open ≤ now < open + 4h`. Deriving the window from these UTC
// boundaries makes UK/NY daylight-saving irrelevant: the arithmetic below picks
// the correct forming bar for any instant without any fixed-offset assumption.
//
// CAUTION - WHEN the Job runs matters, not just how the bar is chosen. The bar
// must already EXIST at the provider, and a provider publishes a bar only once it
// has ticks. A run that fires exactly on a boundary (e.g. 08:00 London, which is
// 08:00 UTC in winter) finds no forming bar and every pair is "unavailable" - the
// 2026-11-09 incident. The trigger is therefore kept mid-bar in both seasons
// (07:00 London = 07:00 UTC in winter, 06:00 UTC in summer), and
// src/scheduled-run/intradaySchedule.test.ts enforces it.
//
// DETERMINISTIC + PURE: `now` is injected (never read from a hidden clock), so
// the selection is fully reproducible and property-testable.
//
// STALENESS GUARD: a provider can lag and return only older closed bars. The
// selector returns the provider bar whose `openTimeUtc` EQUALS the expected
// forming-bar open; if the provider has not yet published that bar, it returns
// `null` so the caller marks the pair "validation unavailable" rather than
// validating a stale bar.

import type { Intraday4hBar } from "./types.js";

/** The 4H bar length in milliseconds. */
export const BAR_LENGTH_MS = 4 * 60 * 60 * 1000;

/**
 * The UTC instant at which the 4H bar containing `now` opened, as an ISO-8601
 * string with millisecond precision (e.g. `2026-11-06T04:00:00.000Z`).
 *
 * Computed by flooring the epoch-ms to a multiple of {@link BAR_LENGTH_MS}.
 * Because the UTC epoch origin (1970-01-01T00:00:00Z) is itself a 4H boundary,
 * flooring to a 4H multiple lands exactly on 00/04/08/12/16/20 UTC.
 */
export function expectedBarOpenUtc(now: Date): string {
  const ms = now.getTime();
  const openMs = Math.floor(ms / BAR_LENGTH_MS) * BAR_LENGTH_MS;
  return new Date(openMs).toISOString();
}

/** Normalize an ISO timestamp to canonical UTC ISO (so string compares are safe). */
function toUtcIso(value: string): string | null {
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/**
 * Select the currently-forming 4H bar from a provider's returned bars.
 *
 * Returns the bar whose open instant equals the expected forming-bar open for
 * `now` (derived from the fixed UTC 4H boundaries). Returns `null` — i.e.
 * "validation unavailable" — when:
 *   - `bars` is empty;
 *   - no bar matches the expected forming-bar open (provider lag / stale data);
 *   - the matching bar carries an unparseable `openTimeUtc`.
 *
 * @param bars The provider's 4H bars (any order; typically newest-first).
 * @param now  The current instant (UTC). Injected for determinism.
 */
export function selectFormingBar(
  bars: readonly Intraday4hBar[],
  now: Date,
): Intraday4hBar | null {
  if (bars.length === 0) {
    return null;
  }
  const expectedOpen = expectedBarOpenUtc(now);
  for (const bar of bars) {
    const open = toUtcIso(bar.openTimeUtc);
    if (open !== null && open === expectedOpen) {
      return bar;
    }
  }
  return null;
}
