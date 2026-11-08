// Shared, secret-free structured warning for fail-safe daily-run steps.
//
// Every fail-safe collaborator in the scheduled run (slices, display-only producers,
// the scorecard step, ...) degrades to an empty/unavailable result on error and logs
// ONE structured warning line. They all used to carry their own copy of the same
// three lines; this is the single implementation.
//
// SECRET-FREE: only the `event` name, the caller's short identifying `fields` (a slice
// or step name, a pair) and the error MESSAGE are logged - never the error object, a
// stack, a URL, a key or an environment value. Callers must pass non-secret `fields`.
//
// The emitted JSON key order is `event`, then `fields` in insertion order, then
// `message`, so a line is byte-identical to what each per-module copy printed before.

/** The message of an error-like value, without a stack or any wrapped cause. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Log one structured warning line: `{ event, ...fields, message }`.
 *
 * @param event   A stable, searchable event name, e.g. `scheduled_run.edge_slice_failed`.
 * @param fields  Short NON-SECRET identifiers (e.g. `{ slice: "calibration" }`).
 * @param err     The caught error; only its message is logged.
 */
export function warnEvent(
  event: string,
  fields: Readonly<Record<string, string>>,
  err: unknown,
): void {
  console.warn(JSON.stringify({ event, ...fields, message: errorMessage(err) }));
}
