// Per-step timing for the daily run.
//
// The run is a sequence of fail-safe steps (candle freshness, the pipeline, display-only
// producers, the Signal Scorecard, each snapshot slice, the snapshot write). Which of them
// dominates the Job's duration is currently unknown - the track-record replay carries a
// deadline precisely because it was suspected to be slow, and candle history is read by several
// steps. Measuring first is what lets any later optimisation (e.g. a shared candle store) be
// decided on evidence instead of guesswork.
//
// `timed` wraps one step and logs ONE structured line: `{ event, step, durationMs, outcome }`.
// It is observation only:
//   - the step's value is returned unchanged;
//   - a throw is logged (outcome "error") and RE-THROWN as the identical error object, so every
//     existing fail-safe `try/catch` around the step behaves exactly as before;
//   - it logs only the step name, the elapsed time and ok/error - never an error message,
//     argument or value - so it cannot leak a secret.

/** Where a timing line goes. Defaults to `console.log(JSON.stringify(event))`. */
export type TimingLogger = (event: object) => void;

/** A monotonic clock in milliseconds. Defaults to `performance.now()`. */
export type TimingClock = () => number;

export interface TimedOptions {
  readonly log?: TimingLogger;
  readonly now?: TimingClock;
}

const defaultLog: TimingLogger = (event) => {
  console.log(JSON.stringify(event));
};

const defaultNow: TimingClock = () => performance.now();

/** The stable event name carried by every timing line (log-based metrics can filter on it). */
export const STEP_TIMING_EVENT = "scheduled_run.step_timing" as const;

/**
 * Run `work`, then log how long it took. Returns its value; re-throws its error unchanged.
 *
 * @param step  A short, stable, NON-SECRET step name (e.g. `track_record`).
 * @param work  The step to run.
 */
export async function timed<T>(
  step: string,
  work: () => Promise<T>,
  options: TimedOptions = {},
): Promise<T> {
  const log = options.log ?? defaultLog;
  const now = options.now ?? defaultNow;
  const started = now();
  try {
    const value = await work();
    log({
      event: STEP_TIMING_EVENT,
      step,
      durationMs: Math.round(now() - started),
      outcome: "ok",
    });
    return value;
  } catch (err) {
    log({
      event: STEP_TIMING_EVENT,
      step,
      durationMs: Math.round(now() - started),
      outcome: "error",
    });
    throw err;
  }
}
