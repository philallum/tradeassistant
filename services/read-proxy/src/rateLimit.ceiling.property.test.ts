import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  DEFAULT_LIMITER_CONFIG,
  RateLimiterStore,
  WINDOW_MS,
  decideAdmission,
  type LimiterConfig,
} from "./rateLimit.js";

// Feature: dashboard-ui, Property 13: Rate limiter never admits above the ceiling.
// For any sequence of request timestamps under a fixed limiter configuration, the limiter
// admits no more than the configured per-window request count (and no more than the global
// ceiling), rejecting the remainder.
//
// **Validates: Requirements 5.1, 5.3**

const NUM_RUNS = 300; // >= 100 iterations required by the task.

/**
 * Count how many timestamps fall strictly inside the window `(now - windowMs, now]`.
 * Mirrors the module's internal window arithmetic without importing a private helper.
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
 * A single simulated request: the IP it came from and the clock time (ms) at which
 * it arrived. Times are non-decreasing in the sequence (a real monotonic clock).
 */
interface Request {
  readonly ip: string;
  readonly dt: number; // non-negative inter-arrival gap from the previous request
}

/**
 * Arbitrary over a bounded set of IPs. A small IP pool (so collisions are frequent)
 * is what actually exercises the per-IP cap; a huge pool would almost never re-hit
 * the same IP and only ever stress the global ceiling.
 */
const ipArb: fc.Arbitrary<string> = fc.constantFrom("a", "b", "c", "d");

/**
 * A request: an IP plus a non-negative gap since the previous request. Gaps range
 * from 0 (bursts arriving at the same millisecond) up to >WINDOW_MS (so earlier
 * entries fully expire), covering both the saturated and the recovered regimes.
 */
const requestArb: fc.Arbitrary<Request> = fc.record({
  ip: ipArb,
  dt: fc.integer({ min: 0, max: WINDOW_MS + 250 }),
});

const requestsArb: fc.Arbitrary<readonly Request[]> = fc.array(requestArb, {
  minLength: 0,
  maxLength: 400,
});

/**
 * Arbitrary over small-but-nontrivial limiter configurations, including the shipped
 * default. The invariant must hold for ANY fixed configuration, not just the default,
 * so we vary the caps while keeping `perIpBurst <= globalCeiling` (the design's shape:
 * the global ceiling backstops the aggregate of all per-IP bursts).
 */
const configArb: fc.Arbitrary<LimiterConfig> = fc.oneof(
  fc.constant(DEFAULT_LIMITER_CONFIG),
  fc
    .record({
      perIpBurst: fc.integer({ min: 1, max: 8 }),
      globalCeiling: fc.integer({ min: 1, max: 20 }),
    })
    .map(({ perIpBurst, globalCeiling }) => ({
      perIpSustained: Math.min(perIpBurst, Math.max(1, perIpBurst - 1)),
      perIpBurst,
      globalCeiling: Math.max(perIpBurst, globalCeiling),
      windowMs: WINDOW_MS,
    })),
);

describe("Property 13: Rate limiter never admits above the ceiling", () => {
  it("never admits more than the per-IP burst or global ceiling in any sliding window (pure policy)", () => {
    fc.assert(
      fc.property(configArb, requestsArb, (config, requests) => {
        // Replay the sequence through the PURE policy, tracking admitted timestamps
        // per IP and globally exactly as the store would.
        const perIp = new Map<string, number[]>();
        const global: number[] = [];
        let now = 0;

        for (const req of requests) {
          now += req.dt;
          const ipSeries = perIp.get(req.ip) ?? [];
          const decision = decideAdmission(now, ipSeries, global, config);

          if (decision.admit) {
            ipSeries.push(now);
            perIp.set(req.ip, ipSeries);
            global.push(now);

            // Core safety invariant: counting the just-admitted request, the number
            // of admitted requests inside the window ending at `now` must not exceed
            // the configured ceilings for either scope.
            const ipInWindow = countInWindow(ipSeries, now, config.windowMs);
            const globalInWindow = countInWindow(global, now, config.windowMs);
            expect(ipInWindow).toBeLessThanOrEqual(config.perIpBurst);
            expect(globalInWindow).toBeLessThanOrEqual(config.globalCeiling);
          } else {
            // A rejection must cite a real reason: at least one scope was saturated.
            const ipInWindow = countInWindow(ipSeries, now, config.windowMs);
            const globalInWindow = countInWindow(global, now, config.windowMs);
            const saturated =
              ipInWindow >= config.perIpBurst ||
              globalInWindow >= config.globalCeiling;
            expect(saturated).toBe(true);
            // Retry hints are never a zero-wait no-op.
            expect(decision.retryAfterMs).toBeGreaterThanOrEqual(1);
          }
        }

        // Final sweep: at the last observed instant, neither scope exceeds its cap.
        const globalFinal = countInWindow(global, now, config.windowMs);
        expect(globalFinal).toBeLessThanOrEqual(config.globalCeiling);
        for (const [, series] of perIp) {
          const ipFinal = countInWindow(series, now, config.windowMs);
          expect(ipFinal).toBeLessThanOrEqual(config.perIpBurst);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("never admits above the ceiling when driven through the impure RateLimiterStore with an injected clock", () => {
    fc.assert(
      fc.property(configArb, requestsArb, (config, requests) => {
        let now = 0;
        const store = new RateLimiterStore(config, () => now);

        // Track admitted timestamps independently to assert the window invariant.
        const admittedPerIp = new Map<string, number[]>();
        const admittedGlobal: number[] = [];

        for (const req of requests) {
          now += req.dt;
          const decision = store.admit(req.ip);

          if (decision.admit) {
            const series = admittedPerIp.get(req.ip) ?? [];
            series.push(now);
            admittedPerIp.set(req.ip, series);
            admittedGlobal.push(now);

            const ipInWindow = countInWindow(series, now, config.windowMs);
            const globalInWindow = countInWindow(
              admittedGlobal,
              now,
              config.windowMs,
            );
            expect(ipInWindow).toBeLessThanOrEqual(config.perIpBurst);
            expect(globalInWindow).toBeLessThanOrEqual(config.globalCeiling);
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
