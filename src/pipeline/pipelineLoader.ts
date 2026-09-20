// Pipeline → scheduled-runner adapter — task 11.1.
//
// The scheduled runner (src/scheduled-run/scheduledRun.ts) was built around a
// `PairEvaluationLoader` seam: `(decisionDate, supabase) => PairEvaluation[]`.
// This adapter binds the end-to-end pipeline (its storage ports + injected gate
// / news / narrative resolvers) into exactly that shape, so the SAME
// deterministic `dailyRun` path runs unattended (Cloud Run Job) and locally
// with no forked logic (Requirement 16.7).
//
// `SupabaseConfig` is passed through to the loader for symmetry with the seam,
// but the pipeline reaches storage only through its already-bound PORTs — the
// production adapter builds those ports from the Supabase connection before
// calling this factory, keeping compute independent of the concrete client
// (Requirement 17.1).

import type { PairEvaluationLoader } from "../scheduled-run/scheduledRun.js";
import { runDailyPipeline } from "./dailyPipeline.js";
import type { PipelineDeps } from "./types.js";

/**
 * Build a {@link PairEvaluationLoader} from the pipeline dependencies. The
 * returned loader runs the full end-to-end pipeline for the Decision_Date and
 * returns the per-pair evaluations; the `supabase` argument is accepted to match
 * the seam signature (the concrete storage ports in `deps` are the storage
 * connection the caller already resolved).
 */
export function makePipelineLoader(deps: PipelineDeps): PairEvaluationLoader {
  // The seam's `supabase` argument is intentionally unused here: the storage
  // ports in `deps` ARE the resolved storage connection (the production adapter
  // builds them from the Supabase config before calling this factory).
  return (decisionDate) => runDailyPipeline(decisionDate, deps);
}
