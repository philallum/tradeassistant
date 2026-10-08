// End-to-End Daily-Run Pipeline module public API — task 11.1.
//
// The single deterministic path that composes ingestion → encoder → retrieval
// → resolver → confidence → risk boundaries → dashboard into the
// `PairEvaluation[]` the dashboard's `dailyRun` consumes, plus the adapter that
// binds it to the scheduled runner's `PairEvaluationLoader` seam
// (Requirements 16.1, 16.7, 17.1, 3.1).

export * from "./types.js";
export {
  runDailyPipeline,
  evaluatePair,
  dominantDirection,
  excursionProfileAt,
  resolveNarrativeEmptyDefault,
} from "./dailyPipeline.js";
export { makePipelineLoader } from "./pipelineLoader.js";
