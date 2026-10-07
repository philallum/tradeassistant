// LLM_Interface module public API — Component 9.
// Requirements 2.3, 2.4, 2.5, 2.6.
//
// The single, thin, swappable gateway to any LLM: role gating (only the four
// sanctioned roles) plus provenance tagging (every output wrapped in
// `LlmTagged<T>` so the ScoringInputGuard can keep LLM output off scoring
// paths). The model backend lives behind the injectable `LlmProvider` port.

export * from "./types.js";
export {
  LlmInterface,
  RoleRejectedError,
  tagLlmOutput,
  type LlmProvider,
  type LlmInterfaceDeps,
  type Clock,
} from "./llmInterface.js";

// The v1 production backend: Google Gemini via the Gemini API in Vertex AI over
// REST (no SDK). src/llm is the single sanctioned SDK-aware layer; this adapter
// reaches the model with the global `fetch` behind GCP IAM/ADC.
export {
  GeminiLlmProvider,
  GeminiProviderError,
  type GeminiProviderConfig,
  type AccessTokenProvider,
} from "./geminiProvider.js";

// ScoringInputGuard — the runtime + compile-time AI/deterministic boundary
// (Requirements 2.1, 2.2, 2.6). Keeps any LLM-tagged value off scoring/verdict
// paths and records the blocked attempt.
export {
  ScoringInputGuard,
  LlmOnScoringPathError,
  InMemoryBlockedScoringInputRecorder,
  assertDeterministic,
  type BlockedScoringInput,
  type BlockedScoringInputRecorder,
  type ScoringInputGuardDeps,
  type Deterministic,
  type NotLlmTagged,
} from "./scoringInputGuard.js";
