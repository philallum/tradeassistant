// FX Daily Pattern Trading Assistant.
//
// Deterministic TypeScript core (authoritative) with isolated Python
// statistical cross-checks. This entry point is intentionally minimal at the
// scaffold stage; feature modules are added in later tasks under src/.
//
// Compute / storage / serving separation (Requirement 17): the module layout
// below keeps compute and storage independent of any serving layer.

/** Placeholder scaffold marker. Replaced by real modules in later tasks. */
export const SCAFFOLD_READY = true;

// Look-Ahead Safety Guard Primitive (Requirement 4).
export * from "./guard/index.js";

// OHLC Ingestion and Session Boundary Normalization (Requirement 7).
export * from "./ingestion/index.js";

// Pattern Vector Encoder (Requirement 8).
export * from "./encoder/index.js";

// Analogue Retrieval and Forward-Outcome Resolver (Requirements 9, 4.2, 20).
export * from "./retrieval/index.js";

// Weekly-Trend-Follow Baseline (Requirement 11.1).
export * from "./baseline/index.js";

// LLM_Interface — role-gated, provenance-tagged AI gateway (Requirement 2).
export * from "./llm/index.js";

// News Filter — calendar ingestion, LLM risk flag, deterministic suppression,
// and the feed fail-safe (Requirement 14).
export * from "./news-filter/index.js";

// Signal Rationale & Pattern Description (Requirement 15). Display-only,
// outward edge of the AI / Deterministic boundary.
export * from "./rationale/index.js";

// Silent-by-Default Dashboard — the daily-run entry point and per-pair firing
// decision. No dashboard-level suppressor remains: the Choppiness_Guard
// (Requirement 3.1) and the Currency_Concentration_Guard (Requirement 3.3) have
// been removed (Requirements 16, 1, 12.3).
export * from "./dashboard/index.js";

// Empirical Analogue-Derived Risk Boundaries (Requirement 21).
export * from "./risk-boundaries/index.js";

// External Signal Cross-Reference — display/research-only, entirely outside the
// deterministic core; never feeds scoring or the Kill_Gate (Requirement 23).
export * from "./external-signal/index.js";

// Scheduled daily-run entry point — the GCP-scheduled unattended refresh reuses
// the same deterministic `dailyRun` path as the local dashboard (Requirement 16.7).
export * from "./scheduled-run/index.js";

// End-to-End Daily-Run Pipeline — the single deterministic path wiring
// ingestion → encoder → retrieval → resolver → confidence → kill-gate →
// news filter → risk boundaries → dashboard (task 11.1;
// Requirements 16.1, 16.7, 17.1, 3.1).
export * from "./pipeline/index.js";



