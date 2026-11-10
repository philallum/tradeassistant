// Missed-run heartbeat (pure).
//
// A missed daily run looks identical to a silent day: the dashboard still renders, it just shows
// an old date. Cloud Monitoring cannot express "the job did not run today" for a once-per-weekday
// job (its absence window tops out near 24 hours and has no weekend awareness), so this check
// compares the Decision_Date of the PUBLISHED snapshot with the date the most recent due run
// should have published. It uses the Decision_Date, not the file's timestamp, so the intraday
// republish (which rewrites the file) cannot mask a missed daily run.
//
// The schedule model mirrors web/src/pure/shapeDataHealth.ts (`expectedLatestDecisionDate`); a
// test pins the two together.
const RUN_HOUR_UTC = 22.5; // 17:30 America/New_York in winter; summer runs an hour earlier.
const RUN_GRACE_HOURS = 2;

function isWeekdayUtc(d: Date): boolean {
  const day = d.getUTCDay();
  return day !== 0 && day !== 6;
}

/** The Decision_Date the most recent DUE daily run should have published (weekday calendar). */
export function expectedLatestDecisionDate(nowMs: number): string {
  const cursor = new Date(nowMs);
  cursor.setUTCHours(0, 0, 0, 0);
  for (let i = 0; i < 8; i += 1) {
    const dueMs =
      Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate()) +
      (RUN_HOUR_UTC + RUN_GRACE_HOURS) * 3_600_000;
    if (isWeekdayUtc(cursor) && dueMs <= nowMs) break;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  const next = new Date(cursor);
  do {
    next.setUTCDate(next.getUTCDate() + 1);
  } while (!isWeekdayUtc(next));
  return next.toISOString().slice(0, 10);
}

export type HeartbeatResult =
  | { readonly ok: true; readonly expected: string; readonly published: string }
  | { readonly ok: false; readonly expected: string; readonly published: string | null; readonly message: string };

/** Judge a fetched snapshot body against the clock. Never throws on a malformed body. */
export function checkHeartbeat(snapshot: unknown, nowMs: number): HeartbeatResult {
  const expected = expectedLatestDecisionDate(nowMs);
  const published =
    typeof snapshot === "object" && snapshot !== null && typeof (snapshot as { decisionDate?: unknown }).decisionDate === "string"
      ? (snapshot as { decisionDate: string }).decisionDate
      : null;
  if (published === null || published === "") {
    return { ok: false, expected, published: null, message: "The published snapshot has no Decision_Date." };
  }
  if (published < expected) {
    return {
      ok: false,
      expected,
      published,
      message: `Missed daily run: the published snapshot is for ${published} but the run for ${expected} was due. A quiet dashboard may be a missed run, not a quiet market.`,
    };
  }
  return { ok: true, expected, published };
}
