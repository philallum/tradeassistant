// Heartbeat CLI: fetch the public dashboard snapshot and fail (exit 1) when the daily run is
// overdue. Run by .github/workflows/heartbeat.yml on a schedule; it can also be run by hand.
//
// Reads ONE public URL from DASHBOARD_SNAPSHOT_URL (non-secret: the same public object the SPA
// fetches). It sends nothing and writes nothing. A fetch failure is itself reported as a failure,
// because a dashboard nobody can read is also something an operator should hear about.
import { fileURLToPath } from "node:url";

import { checkHeartbeat, type HeartbeatResult } from "./heartbeat.js";

export async function runHeartbeat(
  url: string,
  nowMs: number,
  fetchImpl: typeof fetch = fetch,
): Promise<HeartbeatResult> {
  let body: unknown;
  try {
    const res = await fetchImpl(url, { headers: { "cache-control": "no-cache" } });
    if (!res.ok) {
      return { ok: false, expected: "", published: null, message: `Snapshot fetch returned HTTP ${res.status}.` };
    }
    body = await res.json();
  } catch (err) {
    return {
      ok: false,
      expected: "",
      published: null,
      message: `Snapshot could not be fetched or parsed (${err instanceof Error ? err.name : "unknown error"}).`,
    };
  }
  return checkHeartbeat(body, nowMs);
}

async function main(): Promise<void> {
  const url = process.env.DASHBOARD_SNAPSHOT_URL;
  if (url === undefined || url.trim() === "") {
    throw new Error("DASHBOARD_SNAPSHOT_URL is not set");
  }
  const result = await runHeartbeat(url.trim(), Date.now());
  console.log(JSON.stringify({ event: result.ok ? "heartbeat.ok" : "heartbeat.failed", ...result }));
  if (!result.ok) process.exitCode = 1;
}

const entry = process.argv[1];
if (entry !== undefined && (import.meta.url === `file://${entry}` || fileURLToPath(import.meta.url) === entry)) {
  main().catch((err: unknown) => {
    console.error(JSON.stringify({ event: "heartbeat.error", message: err instanceof Error ? err.message : String(err) }));
    process.exitCode = 1;
  });
}
