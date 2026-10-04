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

import type { PipelineStores } from "../../pipeline/index.js";
import type { SupabaseConfig } from "../supabaseConfig.js";
import { SupabaseRestClient } from "./client.js";
import { SupabaseCandleStore } from "./candleStore.js";
import { SupabasePatternVectorStore } from "./patternVectorStore.js";
import { SupabaseAnalogueStore } from "./analogueStore.js";

export { SupabaseRestClient, SupabaseRestError } from "./client.js";
export { SupabaseCandleStore } from "./candleStore.js";
export { SupabasePatternVectorStore } from "./patternVectorStore.js";
export { SupabaseAnalogueStore } from "./analogueStore.js";
export {
  makeSupabaseViewPersister,
  firingSetupRows,
} from "./viewPersister.js";
export {
  makeDisplayDataPersister,
  type DisplayDataPersister,
  type DisplayOnlyWrite,
  type SignalRationaleWrite,
  type ReferenceComparisonWrite,
} from "./displayDataPersister.js";

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
  const client =
    fetchImpl === undefined
      ? new SupabaseRestClient(supabase)
      : new SupabaseRestClient(supabase, fetchImpl);
  return {
    candleStore: new SupabaseCandleStore(client),
    vectorStore: new SupabasePatternVectorStore(client),
    analogueStore: new SupabaseAnalogueStore(client),
  };
}
