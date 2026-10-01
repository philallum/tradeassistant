// Hosted Backfill Execution module (spec Req 7, design Component 8).
//
// Public API for task 10.1: the pure seeding-complete predicate
// (`isBackfillComplete`) and the thin, injectable entry seam
// (`runHostedBackfill`) that runs the EXISTING `StagedRunner.backfill("backfill")`
// against the hosted Supabase stores. This surface re-implements NO
// ingestion/encoding/storage logic. The LIVE run against hosted Supabase is
// task 10.3; the Property 25 test is task 10.2. No `Secret_Key` value is ever
// read into or emitted from any exported shape (spec Req 7.6).

export * from "./types.js";
export {
  isBackfillComplete,
  runHostedBackfill,
  type HostedBackfillDeps,
} from "./hostedBackfill.js";
