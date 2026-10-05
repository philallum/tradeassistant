// dashboard-ui Read_Proxy — rate-limit policy (pure decision) + counter store (impure).
//
// The admission POLICY is a PURE function over a sequence of request timestamps:
// given the timestamps already seen for a scope (a single IP, or the global
// aggregate) plus a new candidate timestamp, it decides admit / reject using a
// sliding one-second window. It performs no I/O, reads no clock, and holds no
// state — which makes it exhaustively property-testable (task 3.5).
//
// The counter STORE is the impure companion: it holds the recent-timestamp state
// per IP and globally, prunes expired entries, and calls the pure policy to make
// each decision. The clock is injected (never `Date.now()` inside the policy), so
// the store stays testable too.
//
// Defaults (design "Public-API hardening"): per-IP 5 req/s with burst 10; global
// ceiling 50 req/s. All limits are evaluated over a 1000 ms sliding window.
//
// _Requirements: 5.1 (aggressive per-IP rate limit), 5.3 (global ceiling backstop)_

/** Length of the sliding window over which request counts are evaluated. */
export const WINDOW_MS = 1000;

/**
 * Limiter configuration. All counts are evaluated over `windowMs`.
 *
 * - `perIpSustained` — steady-state per-IP request budget per window (Req 5.1).
 * - `perIpBurst`     — the larger short-burst per-IP allowance per window; a
 *                      single page load fans out to ~10 endpoints, so the burst
 *                      ceiling (not the sustained rate) governs admission within
 *                      one window. It is the effective per-IP cap per window.
 * - `globalCeiling`  — hard aggregate cap across all IPs per window (Req 5.3).
 * - `windowMs`       — sliding-window length in milliseconds.
 */
export interface LimiterConfig {
  readonly perIpSustained: number;
  readonly perIpBurst: number;
  readonly globalCeiling: number;
  readonly windowMs: number;
}

/** The design defaults: per-IP 5 req/s burst 10, global ceiling 50 req/s. */
export const DEFAULT_LIMITER_CONFIG: LimiterConfig = {
  perIpSustained: 5,
  perIpBurst: 10,
  globalCeiling: 50,
  windowMs: WINDOW_MS,
};

/** Why a request was rejected (for a credential-free `429` message / `Retry-After`). */
export type RejectScope = "per-ip" | "global";

/** Outcome of a pure admission decision. */
export type AdmissionDecision =
  | { readonly admit: true }
  | { readonly admit: false; readonly scope: RejectScope; readonly retryAfterMs: number };

/**
 * Count how many of `timestamps` fall inside the window ending at `now`
 * (i.e. strictly newer than `now - windowMs`). Timestamps at or before the
 * window start have expired and do not count. Order-independent.
 */
function countInWindow(
  timestamps: readonly number[],
  now: number,
  windowMs: number,
): number {
  const windowStart = now - windowMs;
  let count = 0;
  for (const t of timestamps) {
    if (t > windowStart && t <= now) count += 1;
  }
  return count;
}

/**
 * The oldest timestamp still inside the window, or `null` if none. Used to
 * compute how long until the window frees a slot (for `Retry-After`).
 */
function oldestInWindow(
  timestamps: readonly number[],
  now: number,
  windowMs: number,
): number | null {
  const windowStart = now - windowMs;
  let oldest: number | null = null;
  for (const t of timestamps) {
    if (t > windowStart && t <= now && (oldest === null || t < oldest)) {
      oldest = t;
    }
  }
  return oldest;
}

/**
 * PURE admission decision.
 *
 * Decide whether a request arriving at `now` is admitted, given the request
 * timestamps already recorded for this IP (`ipTimestamps`) and across all IPs
 * (`globalTimestamps`), under `config`. The candidate `now` is NOT assumed to be
 * present in either array; the caller records it only on admission.
 *
 * Admission requires BOTH:
 *   - the per-IP in-window count is below the per-IP burst cap, AND
 *   - the global in-window count is below the global ceiling.
 * The per-IP cap is checked first, so a per-IP flood is attributed to `per-ip`
 * rather than masking the global backstop.
 *
 * On rejection, `retryAfterMs` is the time until the oldest in-window request of
 * the offending scope exits the window (always ≥ 1 ms, so a client never gets a
 * zero-wait retry hint).
 *
 * This function performs no I/O and reads no clock; `now` is supplied by the
 * caller. It is the single source of truth for "never admit above the ceiling"
 * (Req 5.1, 5.3).
 */
export function decideAdmission(
  now: number,
  ipTimestamps: readonly number[],
  globalTimestamps: readonly number[],
  config: LimiterConfig,
): AdmissionDecision {
  const { perIpBurst, globalCeiling, windowMs } = config;

  const ipCount = countInWindow(ipTimestamps, now, windowMs);
  if (ipCount >= perIpBurst) {
    const oldest = oldestInWindow(ipTimestamps, now, windowMs);
    return {
      admit: false,
      scope: "per-ip",
      retryAfterMs: retryAfterFrom(oldest, now, windowMs),
    };
  }

  const globalCount = countInWindow(globalTimestamps, now, windowMs);
  if (globalCount >= globalCeiling) {
    const oldest = oldestInWindow(globalTimestamps, now, windowMs);
    return {
      admit: false,
      scope: "global",
      retryAfterMs: retryAfterFrom(oldest, now, windowMs),
    };
  }

  return { admit: true };
}

/** Milliseconds until the oldest in-window request exits the window (≥ 1 ms). */
function retryAfterFrom(oldest: number | null, now: number, windowMs: number): number {
  if (oldest === null) return windowMs;
  const freeAt = oldest + windowMs;
  return Math.max(1, freeAt - now);
}

/**
 * The impure counter store. It holds recent request timestamps per IP and in a
 * global aggregate, delegates every admit/reject choice to the pure
 * `decideAdmission`, and records a timestamp only when a request is admitted.
 *
 * The clock is injected via the constructor so the store never calls
 * `Date.now()` directly; tests drive it with a controllable clock.
 */
export class RateLimiterStore {
  private readonly config: LimiterConfig;
  private readonly now: () => number;
  private readonly perIp = new Map<string, number[]>();
  private global: number[] = [];

  constructor(config: LimiterConfig = DEFAULT_LIMITER_CONFIG, now: () => number = Date.now) {
    this.config = config;
    this.now = now;
  }

  /**
   * Admit or reject a request from `ip` at the current (injected) clock time.
   * On admission, the timestamp is recorded in both the per-IP and global
   * series; on rejection, nothing is recorded. Expired entries are pruned on
   * every call so memory stays bounded by the in-window request count.
   */
  admit(ip: string): AdmissionDecision {
    const now = this.now();
    const windowStart = now - this.config.windowMs;

    const ipSeries = prune(this.perIp.get(ip) ?? [], windowStart);
    this.global = prune(this.global, windowStart);

    const decision = decideAdmission(now, ipSeries, this.global, this.config);

    if (decision.admit) {
      ipSeries.push(now);
      this.global.push(now);
    }
    // Store the pruned (and possibly appended) series back so the map does not
    // grow without bound and empty series are dropped.
    if (ipSeries.length > 0) {
      this.perIp.set(ip, ipSeries);
    } else {
      this.perIp.delete(ip);
    }

    return decision;
  }
}

/** Drop timestamps at or before `windowStart`; returns a new in-window array. */
function prune(timestamps: readonly number[], windowStart: number): number[] {
  return timestamps.filter((t) => t > windowStart);
}
