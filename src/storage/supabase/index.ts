// Supabase Storage Adapters — the shared seam (design Component 3).
//
// The concrete implementations of the three existing storage PORTs
// (`CandleStore`, `PatternVectorStore`, `AnalogueStore`) bound to the
// IPv4-reachable pooler/REST endpoint (Cloud Run has no IPv6 egress). Wiring
// these adapters replaces ONLY the two throwing stubs in
// `src/scheduled-run/main.ts` (`buildSupabaseStores`, `persistView`); the
// pipeline, the scheduled runner, and the shared `dailyRun` entry point are
// unchanged (parent Req 17.1).
//
// The adapters implement the SAME method signatures as their in-memory
// references, so `PipelineStores` and every downstream caller are untouched —
// the only substitution is the concrete backend.

import type {
  EvaluationReportStore,
  GateVerdictStore,
} from "../../kill-gate/types.js";
import type { PipelineStores } from "../../pipeline/index.js";
import type { SupabaseConfig } from "../supabaseConfig.js";
import { SupabaseRestClient } from "./client.js";
import { SupabaseCandleStore } from "./candleStore.js";
import { SupabasePatternVectorStore } from "./patternVectorStore.js";
import { SupabaseAnalogueStore } from "./analogueStore.js";
import { SupabaseGateVerdictStore } from "./gateVerdictStore.js";
import { SupabaseEvaluationReportStore } from "./evaluationReportStore.js";

export { SupabaseRestClient, SupabaseRestError } from "./client.js";
export { SupabaseCandleStore } from "./candleStore.js";
export { SupabasePatternVectorStore } from "./patternVectorStore.js";
export { SupabaseAnalogueStore } from "./analogueStore.js";
export { SupabaseGateVerdictStore } from "./gateVerdictStore.js";
export { SupabaseEvaluationReportStore } from "./evaluationReportStore.js";
export {
  SupabaseFrozenBaselineStore,
  type FrozenBaselineLogger,
} from "./frozenBaselineStore.js";
export {
  SupabaseSignalPredictionStore,
  type SignalPredictionLogger,
} from "./signalPredictionStore.js";
export {
  makeSupabaseViewPersister,
  firingSetupRows,
} from "./viewPersister.js";
export {
  type DisplayOnlyWrite,
  type SignalRationaleWrite,
  type ReferenceComparisonWrite,
  type DailyNoteWrite,
} from "./displayOnlyTypes.js";

/**
 * Build the three PORT implementations from a resolved {@link SupabaseConfig}.
 * This is the exact shape `buildSupabaseStores(supabase): PipelineStores` in
 * `src/scheduled-run/main.ts` expects; wiring these adapters replaces ONLY that
 * throwing stub. All three share one {@link SupabaseRestClient} so they reuse
 * the same connection configuration (URL + secret key). The key is never
 * logged.
 *
 * @param supabase  The resolved connection (IPv4 pooler/REST URL + key).
 * @param fetchImpl Injectable fetch (defaults to the global); tests inject a
 *                  stub so no network is required.
 */
export function buildSupabaseStores(
  supabase: SupabaseConfig,
  fetchImpl?: typeof fetch,
): PipelineStores {
  const client = makeClient(supabase, fetchImpl);
  return {
    candleStore: new SupabaseCandleStore(client),
    vectorStore: new SupabasePatternVectorStore(client),
    analogueStore: new SupabaseAnalogueStore(client),
  };
}

/** The gate-verdict PORT implementation. */
export interface SupabaseGateStores {
  readonly gateVerdictStore: GateVerdictStore;
}

/**
 * Build the gate-verdict adapter (design Component 3) from a resolved
 * {@link SupabaseConfig} or an existing shared {@link SupabaseRestClient}.
 *
 * This is an ADDITIVE sibling to {@link buildSupabaseStores}: it deliberately
 * does NOT widen {@link PipelineStores} — the pipeline's candle/vector/analogue
 * triple shape is unchanged — so the Gate_Run can wire the gate-verdict store
 * alongside the pipeline stores without disturbing any pipeline caller.
 *
 * A caller that already holds a `SupabaseRestClient` (e.g. the Gate_Run sharing
 * one client with `buildSupabaseStores`) may pass it directly; otherwise one is
 * built from `supabase` using the SAME construction as `buildSupabaseStores`.
 * The key is never logged.
 *
 * @param supabase  The resolved connection, OR an existing shared client to reuse.
 * @param fetchImpl Injectable fetch (defaults to the global); tests inject a
 *                  stub so no network is required. Ignored when `supabase` is
 *                  already a `SupabaseRestClient`.
 */
export function buildSupabaseGateStores(
  supabase: SupabaseConfig | SupabaseRestClient,
  fetchImpl?: typeof fetch,
): SupabaseGateStores {
  const client =
    supabase instanceof SupabaseRestClient
      ? supabase
      : makeClient(supabase, fetchImpl);
  return {
    gateVerdictStore: new SupabaseGateVerdictStore(client),
  };
}

/**
 * Build the {@link EvaluationReportStore} adapter — the successor to the
 * gate-verdict store on the evaluation write path (simplify-to-cloud-minimal
 * Requirement 1.3, 8.2) — from a resolved {@link SupabaseConfig} or an existing
 * shared {@link SupabaseRestClient}.
 *
 * Additive sibling to {@link buildSupabaseGateStores}: a caller that already
 * holds a client (e.g. the evaluation flow sharing one client with
 * {@link buildSupabaseStores}) passes it directly; otherwise one is built from
 * `supabase` using the SAME construction as the other builders. The key is
 * never logged.
 *
 * @param supabase  The resolved connection, OR an existing shared client to reuse.
 * @param fetchImpl Injectable fetch (defaults to the global); tests inject a
 *                  stub so no network is required. Ignored when `supabase` is
 *                  already a `SupabaseRestClient`.
 */
export function buildSupabaseEvaluationReportStore(
  supabase: SupabaseConfig | SupabaseRestClient,
  fetchImpl?: typeof fetch,
): EvaluationReportStore {
  const client =
    supabase instanceof SupabaseRestClient
      ? supabase
      : makeClient(supabase, fetchImpl);
  return new SupabaseEvaluationReportStore(client);
}

/**
 * Construct the shared {@link SupabaseRestClient} the builders use. Omitting
 * `fetchImpl` lets the client default to the Node 22 built-in `fetch`; a stub
 * can be injected in tests so no network is required.
 */
function makeClient(
  supabase: SupabaseConfig,
  fetchImpl?: typeof fetch,
): SupabaseRestClient {
  return fetchImpl === undefined
    ? new SupabaseRestClient(supabase)
    : new SupabaseRestClient(supabase, fetchImpl);
}
