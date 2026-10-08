// Scheduled daily-run module public API (Requirement 16.7).
//
// The GCP-scheduled unattended run and the local dashboard invoke the SAME
// deterministic `dailyRun` entry point via `runScheduledDaily`; this module
// only adds environment-config resolution and the pipeline/persistence seam.
// The runnable container entry point lives in `./main.ts` (not re-exported —
// it has top-level side effects).

export {
  SCHEDULED_RUN_ENV,
  ScheduledRunConfigError,
  loadScheduledRunConfig,
  resolveDecisionDate,
  resolveSupabaseOverIpv4,
  type ScheduledRunConfig,
} from "./config.js";
export {
  runScheduledDaily,
  type PairEvaluationLoader,
  type DashboardViewPersister,
  type ScheduledRunDeps,
  type ScheduledRunResult,
} from "./scheduledRun.js";
export {
  SNAPSHOT_SCHEMA_VERSION,
  SNAPSHOT_FILE_NAME,
  buildDashboardSnapshot,
  serializeSnapshot,
  writeDashboardSnapshot,
  type DashboardSnapshot,
  type SnapshotHistory,
  type SnapshotSink,
  type SnapshotDirection,
  type SnapshotHorizon,
  type SnapshotSuppressionReason,
  type SnapshotFiringSetupRow,
  type SnapshotAnalogueOutcomeRow,
  type SnapshotRealizedOutcomeRow,
  type SnapshotCandleRow,
  type SnapshotProposal,
  type SnapshotAiRationaleRow,
  type SnapshotExternalComparisonRow,
  type SnapshotEvaluationReportRow,
} from "./snapshot.js";
