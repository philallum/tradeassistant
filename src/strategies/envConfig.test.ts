// Unit tests for the Confluence_Engine environment reader (Requirements 8.4,
// 8.5, 8.6, 8.9, 9.6, 9.7; Design "8. Environment configuration").
//
// `confluenceConfigFromEnv` is the single boundary that turns three optional
// environment variables into a `Partial` config suitable to hand to
// `createConfluenceEngine`. It parses/guards shapes (valid JSON, known
// Strategy_Ids, finite numbers); the engine does the AUTHORITATIVE range
// validation. These deterministic tests pin:
//   - valid parsing into the expected partial (Requirements 8.4, 8.5, 9.6);
//   - invalid JSON -> ConfigError naming CONFLUENCE_WEIGHTS (Requirement 8.6);
//   - unknown weight key -> ConfigError naming the offending key (Req 8.6);
//   - non-finite threshold string -> ConfigError naming the parameter, and a
//     parsed out-of-range threshold rejected by the engine (Requirement 9.7);
//   - absent env vars -> omitted fields, so engine defaults apply (Req 8.4, 9.6).

import { describe, expect, it } from "vitest";
import {
  CONFLUENCE_WEIGHTS_ENV,
  CONFLUENCE_CONFLICT_THRESHOLD_ENV,
  CONFLUENCE_ALIGNMENT_THRESHOLD_ENV,
  confluenceConfigFromEnv,
  type ConfluenceConfigPartial,
} from "./config.js";
import {
  DEFAULT_CONFLUENCE_CONFIG,
  createConfluenceEngine,
} from "./confluenceEngine.js";
import type { ConfigError } from "./types.js";

// --- Helpers ----------------------------------------------------------------

/** Unwrap a parsed partial, failing the test loudly on a ConfigError. */
function expectPartial(
  result: ReturnType<typeof confluenceConfigFromEnv>,
): ConfluenceConfigPartial {
  if (!result.ok) {
    throw new Error(`expected a partial, got config error: ${result.error.message}`);
  }
  return result.value;
}

/** Unwrap a ConfigError, failing the test loudly on success. */
function expectError(
  result: ReturnType<typeof confluenceConfigFromEnv>,
): ConfigError {
  if (result.ok) {
    throw new Error(`expected a config error, got partial: ${JSON.stringify(result.value)}`);
  }
  return result.error;
}

// --- Valid parsing ----------------------------------------------------------

describe("confluenceConfigFromEnv - valid parsing", () => {
  it("parses well-formed weights and thresholds into the expected partial", () => {
    const partial = expectPartial(
      confluenceConfigFromEnv({
        [CONFLUENCE_WEIGHTS_ENV]: JSON.stringify({ trend: 2, third_party: 0.5 }),
        [CONFLUENCE_CONFLICT_THRESHOLD_ENV]: "0.7",
        [CONFLUENCE_ALIGNMENT_THRESHOLD_ENV]: "0.3",
      }),
    );
    expect(partial).toEqual({
      weights: { trend: 2, third_party: 0.5 },
      conflictThreshold: 0.7,
      alignmentThreshold: 0.3,
    });
  });

  it("feeds a valid partial through to a usable engine config", () => {
    const partial = expectPartial(
      confluenceConfigFromEnv({
        [CONFLUENCE_WEIGHTS_ENV]: JSON.stringify({ third_party: 1 }),
        [CONFLUENCE_CONFLICT_THRESHOLD_ENV]: "0.5",
      }),
    );
    const engine = createConfluenceEngine(partial);
    expect(engine.ok).toBe(true);
    if (!engine.ok) return;
    // The overridden weight merges over the defaults; untouched keys stay default.
    expect(engine.value.config.weights.third_party).toBe(1);
    expect(engine.value.config.weights.trend).toBe(1);
    expect(engine.value.config.conflictThreshold).toBe(0.5);
    // alignmentThreshold was absent => engine default.
    expect(engine.value.config.alignmentThreshold).toBe(
      DEFAULT_CONFLUENCE_CONFIG.alignmentThreshold,
    );
  });
});

// --- Invalid JSON -----------------------------------------------------------

describe("confluenceConfigFromEnv - invalid weights JSON", () => {
  it("rejects malformed JSON, naming CONFLUENCE_WEIGHTS", () => {
    const error = expectError(
      confluenceConfigFromEnv({ [CONFLUENCE_WEIGHTS_ENV]: "{not valid json" }),
    );
    expect(error.reason).toBe("invalid_config");
    expect(error.parameter).toBe(CONFLUENCE_WEIGHTS_ENV);
    expect(error.message).toContain(CONFLUENCE_WEIGHTS_ENV);
  });

  it("rejects a non-object top level, naming CONFLUENCE_WEIGHTS", () => {
    const error = expectError(
      confluenceConfigFromEnv({ [CONFLUENCE_WEIGHTS_ENV]: "[1, 2, 3]" }),
    );
    expect(error.parameter).toBe(CONFLUENCE_WEIGHTS_ENV);
  });
});

// --- Unknown key ------------------------------------------------------------

describe("confluenceConfigFromEnv - unknown weight key", () => {
  it("rejects an unknown Strategy_Id, naming the offending key", () => {
    const error = expectError(
      confluenceConfigFromEnv({
        [CONFLUENCE_WEIGHTS_ENV]: JSON.stringify({ trend: 1, bogus: 2 }),
      }),
    );
    expect(error.reason).toBe("invalid_config");
    expect(error.parameter).toBe("bogus");
    expect(error.message).toContain("bogus");
  });
});

// --- Thresholds -------------------------------------------------------------

describe("confluenceConfigFromEnv - threshold validation", () => {
  it("rejects a non-finite conflict threshold string, naming the parameter", () => {
    const error = expectError(
      confluenceConfigFromEnv({
        [CONFLUENCE_CONFLICT_THRESHOLD_ENV]: "not-a-number",
      }),
    );
    expect(error.reason).toBe("invalid_config");
    expect(error.parameter).toBe(CONFLUENCE_CONFLICT_THRESHOLD_ENV);
    expect(error.message).toContain(CONFLUENCE_CONFLICT_THRESHOLD_ENV);
  });

  it("rejects a non-finite alignment threshold string, naming the parameter", () => {
    const error = expectError(
      confluenceConfigFromEnv({
        [CONFLUENCE_ALIGNMENT_THRESHOLD_ENV]: "Infinity",
      }),
    );
    expect(error.parameter).toBe(CONFLUENCE_ALIGNMENT_THRESHOLD_ENV);
  });

  it("parses an out-of-range (but finite) threshold, then the engine rejects it", () => {
    // config.ts only guards finiteness; a value of 1.5 parses here but the
    // engine's authoritative [0, 1] range check rejects it (Requirement 9.7).
    const partial = expectPartial(
      confluenceConfigFromEnv({
        [CONFLUENCE_CONFLICT_THRESHOLD_ENV]: "1.5",
      }),
    );
    expect(partial.conflictThreshold).toBe(1.5);

    const engine = createConfluenceEngine(partial);
    expect(engine.ok).toBe(false);
    if (engine.ok) return;
    expect(engine.error.reason).toBe("invalid_config");
    expect(engine.error.parameter).toBe("conflictThreshold");
  });
});

// --- Fallback to defaults ---------------------------------------------------

describe("confluenceConfigFromEnv - fallback to defaults", () => {
  it("omits every field when no env vars are set", () => {
    const partial = expectPartial(confluenceConfigFromEnv({}));
    expect(partial).toEqual({});
    expect("weights" in partial).toBe(false);
    expect("conflictThreshold" in partial).toBe(false);
    expect("alignmentThreshold" in partial).toBe(false);
  });

  it("yields the engine defaults when the empty partial is applied", () => {
    const partial = expectPartial(confluenceConfigFromEnv({}));
    const engine = createConfluenceEngine(partial);
    expect(engine.ok).toBe(true);
    if (!engine.ok) return;
    expect(engine.value.config.weights).toEqual(DEFAULT_CONFLUENCE_CONFIG.weights);
    expect(engine.value.config.conflictThreshold).toBe(
      DEFAULT_CONFLUENCE_CONFIG.conflictThreshold,
    );
    expect(engine.value.config.alignmentThreshold).toBe(
      DEFAULT_CONFLUENCE_CONFIG.alignmentThreshold,
    );
  });

  it("omits only the absent fields while keeping the present one", () => {
    const partial = expectPartial(
      confluenceConfigFromEnv({ [CONFLUENCE_CONFLICT_THRESHOLD_ENV]: "0.8" }),
    );
    expect(partial).toEqual({ conflictThreshold: 0.8 });
    expect("weights" in partial).toBe(false);
    expect("alignmentThreshold" in partial).toBe(false);
  });
});
