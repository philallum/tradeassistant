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

// Sovereign Yield Feed Ingestion (Requirement 13.8).
export * from "./yields/index.js";

// Pattern Vector Encoder (Requirement 8).
export * from "./encoder/index.js";

// Analogue Retrieval and Forward-Outcome Resolver (Requirements 9, 4.2, 20).
export * from "./retrieval/index.js";

// Weekly-Trend-Follow Baseline (Requirement 11.1).
export * from "./baseline/index.js";



