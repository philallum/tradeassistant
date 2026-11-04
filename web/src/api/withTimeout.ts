/**
 * Timeout-race helper (mobile-dashboard-single-window R10.7, R11.5).
 *
 * `getSnapshot` (see `api/snapshotCache.ts`) memoises ONE shared in-flight promise per
 * refresh generation, and forwards only the FIRST caller's `signal` into `loadSnapshot`
 * (see `api/snapshot.ts`, around the `fetchImpl` call). `AppShell` and every tab call
 * `getSnapshot` for the same generation and share that one promise. If a per-window timeout
 * owned its own `AbortController`/`AbortSignal` and aborted it, that would abort the single
 * shared `fetch` for every consumer, not just the window that timed out — and a failed load
 * clears the cache (see `snapshotCache.ts`), so one window's timeout could force every other
 * consumer to re-fetch too.
 *
 * `withTimeout` therefore never aborts the underlying promise. It only RACES the given
 * promise against a timer: if the timer wins, callers get a timeout rejection while the
 * original promise is left to settle on its own (still shared, still cached for others).
 */

/** Default timeout, in milliseconds, used when `ms` is not provided. */
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Race `promise` against a timer of `ms` milliseconds (default {@link DEFAULT_TIMEOUT_MS}).
 *
 * Resolves/rejects with whichever of `promise` or the timer settles first. On timeout,
 * rejects with a non-secret `Error("The dashboard data could not be loaded in time.")` —
 * no stack trace, cause, or payload detail is attached. The timer is always cleared once
 * either side settles, so it never keeps the process/test runner alive.
 *
 * This does NOT abort or cancel `promise`; see the module doc for why.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number = DEFAULT_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("The dashboard data could not be loaded in time."));
    }, ms);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
