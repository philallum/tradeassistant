// End-to-End Daily-Run Pipeline Types — task 11.1 (Requirement 17.2, and the
// end-to-end wiring of Requirements 7–22).
//
// The pipeline is the single deterministic path that turns STORED inputs
// (candles, pattern vectors, resolved analogue outcomes) into the per-pair
// `PairEvaluation[]` the dashboard's `dailyRun` consumes. It is the concrete
// `PairEvaluationLoader` the scheduled runner was designed around
// (see src/scheduled-run/scheduledRun.ts).
//
// It composes the existing modules in the design's data-flow order —
// ingestion → encoder → retrieval → resolver → confidence → risk boundaries →
// dashboard — WITHOUT re-implementing any of them. Each stage is invoked
// through its module's public API; storage is reached only through the existing
// PORTs (`CandleStore`, `PatternVectorStore`, `AnalogueStore`), so compute stays
// independent of any concrete Supabase client (Requirement 17.1).
//
// The AI / Deterministic boundary holds here (Requirement 2.1): the firing
// decision is derived entirely from typed numeric / enumerated values. The only
// LLM-derived values are the outward-only `rationale` / `analogueLabels`
// display strings, which enter through an injected resolver so the deterministic
// core never imports an LLM type, and by default they are empty (LLM-free).
// The former news suppressor has been removed (Requirements 3.4, 3.5), so no
// news decision crosses into the pipeline.

import type { Pair } from "../ingestion/types.js";
import type { CandleStore } from "../ingestion/types.js";
import type { TradingDate } from "../guard/types.js";
import type { PatternVectorStore } from "../encoder/types.js";
import type { AnalogueStore, RetrievalConfig } from "../retrieval/types.js";
import type { RiskBoundaryConfig } from "../risk-boundaries/types.js";

/**
 * The storage PORTs the pipeline reads from. All three already exist and have
 * in-memory reference implementations (used by the integration tests) and, in
 * production, Supabase-backed adapters. The pipeline depends only on the port
 * interfaces, never on a concrete backend (Requirement 17.1).
 */
export interface PipelineStores {
  /** Daily OHLC candles keyed by (asset, date) — the encoder / ATR window source. */
  readonly candleStore: CandleStore;
  /** Persisted pattern vectors keyed by (asset, decision_date) — the ANN source. */
  readonly vectorStore: PatternVectorStore;
  /** Resolved forward-outcome rows — the matured Analogue_Neighborhood source. */
  readonly analogueStore: AnalogueStore;
}

/**
 * The OUTWARD-ONLY display strings for a firing card (Requirement 15). Produced
 * by the `signal_rationale` / `pattern_description` LLM roles from the
 * deterministic numeric inputs, unwrapped from their `LlmTagged<…>` markers at
 * this render boundary. They are attached to the `PairEvaluation` but never
 * participate in any firing / suppression / scoring decision
 * (Requirements 15.2, 15.4).
 */
export interface CardNarrative {
  readonly rationale: string;
  readonly analogueLabels: readonly string[];
}

/**
 * Resolves the outward-only narrative for a pair (Requirement 15). Injected and
 * defaulting to empty strings so the deterministic pipeline is LLM-free unless
 * a caller opts in; because the narrative is display-only, omitting it leaves
 * every firing / suppression / scoring decision identical (Requirement 15.4).
 */
export type NarrativeResolver = (
  pair: Pair,
  decisionDate: TradingDate,
) => Promise<CardNarrative> | CardNarrative;

/**
 * Configuration for one end-to-end daily-run pipeline pass.
 */
export interface PipelineConfig {
  /** Retrieval knobs (neighborhood size `k` and Similarity_Radius `epsilon`). */
  readonly retrieval: RetrievalConfig;
  /**
   * The trailing candle-window length (in trading days) fed to the encoder and
   * the ATR_14 computation. Must be at least 40 to cover the widest scale slice;
   * defaults to 60 so ATR_14 and the 40-day slice both have full context.
   */
  readonly windowSize: number;
  /** Optional Stop_Loss / Take_Profit percentile overrides (Requirement 21.2). */
  readonly riskBoundaries?: RiskBoundaryConfig;
}

/** The default retrieval config: 200 nearest, epsilon cutoff 0.2. */
export const DEFAULT_RETRIEVAL_CONFIG: RetrievalConfig = {
  k: 200,
  epsilon: 0.2,
};

/** The default trailing window length fed to the encoder / ATR_14. */
export const DEFAULT_PIPELINE_WINDOW_SIZE = 60 as const;

/** The default end-to-end pipeline configuration. */
export const DEFAULT_PIPELINE_CONFIG: PipelineConfig = {
  retrieval: DEFAULT_RETRIEVAL_CONFIG,
  windowSize: DEFAULT_PIPELINE_WINDOW_SIZE,
};

/**
 * The injected collaborators the pipeline needs beyond the storage ports: the
 * outward-only narrative resolver. It has a safe, deterministic default (see
 * {@link resolveNarrativeEmptyDefault}), so a caller can run the pipeline with
 * storage alone and layer in the LLM narrative incrementally.
 */
export interface PipelineDeps extends PipelineStores {
  readonly narrative?: NarrativeResolver;
  readonly config?: PipelineConfig;
}
