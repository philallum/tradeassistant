// Silent-by-Default Dashboard module public API — Component 11
// (Requirements 16, 1, 12.3).
//
// `dailyRun()` evaluates all five pairs, firing a pair only when it is
// gate-passing AND its Earned_Confidence >= the configurable Confidence_Threshold
// AND news permits (16.2, 16.5, 16.6, 1.1). The Currency_Concentration_Guard has
// been removed as a suppressor (design Decision 1 / C2, Requirement 3.3): no
// dashboard-level suppressor remains. The firing decision is deterministic and
// takes no LLM input; rationale/labels flow outward only, onto the rendered card
// (15.2, 15.4).

export * from "./types.js";
export {
  efficiencyRatio,
  efficiencyRatioFromCloses,
} from "./choppinessMetric.js";
export {
  dailyRun,
  fires,
  type PairEvaluation,
} from "./dashboard.js";
export {
  renderFiringCard,
  RISK_BOUNDARY_NOT_ACTIONABLE,
  type RenderedCard,
} from "./renderFiringCard.js";
export {
  persistFiringSetups,
  InMemoryFiringSetupStore,
  type FiringSetupRow,
  type FiringSetupStore,
  type SuppressionReason,
  type PersistFiringSetupsOptions,
} from "./persistFiringSetups.js";
export {
  journalRealizedOutcomes,
  InMemoryRealizedOutcomeStore,
  type RealizedOutcomeEntry,
  type RealizedOutcomeStore,
  type FiredSetupPrediction,
  type JournalRealizedOutcomesOptions,
} from "./realizedOutcomeJournal.js";
