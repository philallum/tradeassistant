// fx_writer scoped-write check (spec simplify-to-cloud-minimal task 5.2a.4;
// Req 4.5, 4.6, 8.4).
//
// Proves the replacement Write_Credential works through the SAME REST path the
// Cloud_Run_Job uses — the project's `SupabaseRestClient` carrying the
// `fx_writer` JWT from the `supabase-key` secret (resolved via `SUPABASE_HOSTED_KEY`)
// plus the publishable `apikey`. It writes a synthetic probe row into the
// `candles` table (sentinel asset that cannot collide with the five real PAIRS),
// updates it, then attempts a DELETE that MUST be refused because `fx_writer`
// holds SELECT/INSERT/UPDATE but no DELETE grant.
//
// Split for testability: `classifyVerdict` is a PURE function of the three op
// outcomes (unit-/property-testable with no network); `runFxWriterCheck` is the
// thin live seam that performs the REST calls and feeds their outcomes to it.
// No secret value is logged, echoed, or returned (design Component 3; Req 6.2).

import { SupabaseRestClient, SupabaseRestError, eq } from "../../storage/supabase/client.js";
import { loadSupabaseConfig, type SupabaseConfig } from "../../storage/supabaseConfig.js";
import type { FxWriterCheckVerdict, OpOutcome } from "./types.js";

/** The probe table and a sentinel asset that can never be a real pair. */
const PROBE_TABLE = "candles";
const PROBE_ASSET = "__fx_writer_probe__";
const PROBE_DATE = "1900-01-01";

/**
 * Pure verdict classifier (design Property; task 5.2a.4). GREEN iff INSERT and
 * UPDATE both succeeded and DELETE was refused by a permission denial
 * (PostgREST returns 401/403/405 for a role lacking the DELETE grant). A DELETE
 * that SUCCEEDED is a hard failure — it means the no-DELETE invariant is broken.
 */
export function classifyVerdict(outcomes: readonly OpOutcome[]): FxWriterCheckVerdict {
  const find = (op: OpOutcome["op"]) => outcomes.find((o) => o.op === op);
  const insert = find("insert");
  const update = find("update");
  const del = find("delete");

  const insertSucceeded = insert?.ok === true;
  const updateSucceeded = update?.ok === true;
  // Refused == the call did NOT succeed AND reported a denial-class status.
  const deleteRefused =
    del !== undefined &&
    del.ok === false &&
    (del.status === 401 || del.status === 403 || del.status === 405);

  const reasons: string[] = [];
  reasons.push(insertSucceeded ? "INSERT succeeded" : `INSERT did NOT succeed${insert?.status !== undefined ? ` (status ${insert.status})` : ""}`);
  reasons.push(updateSucceeded ? "UPDATE succeeded" : `UPDATE did NOT succeed${update?.status !== undefined ? ` (status ${update.status})` : ""}`);
  if (del?.ok === true) {
    reasons.push("DELETE SUCCEEDED — no-DELETE invariant BROKEN (fx_writer must not hold DELETE)");
  } else if (deleteRefused) {
    reasons.push(`DELETE correctly refused (status ${del?.status ?? "?"})`);
  } else {
    reasons.push(`DELETE neither succeeded nor cleanly refused${del?.status !== undefined ? ` (status ${del.status})` : " (transport error)"}`);
  }

  const green = insertSucceeded && updateSucceeded && deleteRefused;
  return { insertSucceeded, updateSucceeded, deleteRefused, green, reasons };
}

/** Map a REST call into an {@link OpOutcome} without leaking secrets. */
async function probe(op: OpOutcome["op"], call: () => Promise<unknown>): Promise<OpOutcome> {
  try {
    await call();
    return { op, ok: true };
  } catch (err) {
    if (err instanceof SupabaseRestError) {
      return { op, ok: false, status: err.status };
    }
    // Transport / unexpected error: ok=false, no status.
    return { op, ok: false };
  }
}

export interface FxWriterCheckDeps {
  readonly config?: SupabaseConfig;
  readonly fetchImpl?: typeof fetch;
}

/**
 * Run the live fx_writer write-check against the configured (hosted) target
 * using the real REST client. Returns the classified verdict; the caller
 * decides exit status. The probe row uses a sentinel asset and is UPDATE-probed
 * in place; because fx_writer cannot DELETE, the row is left for owner-side
 * cleanup (the runner script handles that out-of-band).
 */
export async function runFxWriterCheck(deps: FxWriterCheckDeps = {}): Promise<FxWriterCheckVerdict> {
  const config = deps.config ?? loadSupabaseConfig();
  const client = new SupabaseRestClient(config, deps.fetchImpl);

  // OHLC-valid probe values: the `candles.ohlc_valid` CHECK requires
  // low <= open,close <= high. Use a range [1,3] so BOTH the initial insert
  // (close=1) and the update (close=2) stay valid; a flat 1/1/1/1 row would make
  // the close->2 update violate the constraint and mask the permission result.
  const baseRow = {
    asset: PROBE_ASSET,
    date: PROBE_DATE,
    open: 1,
    high: 3,
    low: 1,
    close: 1,
    source: "fx_writer_check",
  };

  const outcomes: OpOutcome[] = [];
  // INSERT (idempotent upsert on the PK so a re-run is safe).
  outcomes.push(await probe("insert", () => client.upsert(PROBE_TABLE, [baseRow], "asset,date")));
  // UPDATE (change close via a second upsert on the same PK).
  outcomes.push(await probe("update", () => client.upsert(PROBE_TABLE, [{ ...baseRow, close: 2 }], "asset,date")));
  // DELETE — MUST be refused (no DELETE grant for fx_writer).
  const filter = `asset=${eq(PROBE_ASSET)}&date=${eq(PROBE_DATE)}`;
  outcomes.push(await probe("delete", () => client.delete(PROBE_TABLE, filter)));

  return classifyVerdict(outcomes);
}
