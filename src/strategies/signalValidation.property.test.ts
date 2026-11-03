import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  RATIONALE_MAX_LENGTH,
  SIGNAL_DIRECTIONS,
  STRATEGY_IDS,
  validateStrategySignal,
  type SignalViolation,
} from "./types.js";
import { tagLlmOutput } from "../llm/llmInterface.js";

// Feature: multi-strategy-confluence-engine, Property 2: Signal validation rejects exactly the invalid signals
//
// validateStrategySignal accepts exactly the valid StrategySignals and rejects
// exactly the invalid ones, naming the first-failing field. An INDEPENDENT
// oracle below re-derives the expected verdict (and field) from the same
// acceptance criteria, in the same fixed check order, so the property checks the
// validator against a spec rather than against itself.
//
// Validates: Requirements 1.1, 1.8, 1.9

// ---------------------------------------------------------------------------
// Independent oracle — a from-scratch restatement of the acceptance criteria.
//
// Check order (first failure wins), per Requirement 1.8:
//   1. llm_tagged  — value carries the real LLM provenance brand (Req 1.7).
//   2. shape       — plain non-array object with EXACTLY the four signal keys.
//   3. strategyId  — one of STRATEGY_IDS (Req 1.2).
//   4. direction   — one of SIGNAL_DIRECTIONS (Req 1.3).
//   5. strength    — finite number in [0, 1]; exactly 0 when FLAT (Req 1.4, 1.5).
//                    UP/DOWN with strength 0 are ACCEPTED (Req 1.9).
//   6. rationale   — string of length 1..500 with a non-whitespace char (Req 1.6).
// Returns null when the value is a valid signal, else the expected field.
// ---------------------------------------------------------------------------

type ViolationField = SignalViolation["field"];

const SIGNAL_KEYS = ["strategyId", "direction", "strength", "rationale"] as const;

/** Mirror of the production brand check, written independently for the oracle. */
function carriesLlmBrand(v: unknown): boolean {
  if (typeof v !== "object" || v === null) return false;
  // tagLlmOutput brands with a non-enumerable symbol; detect any symbol-keyed
  // provenance marker the interface could have attached.
  return Object.getOwnPropertySymbols(v).some(
    (s) => (v as Record<PropertyKey, unknown>)[s] === true,
  );
}

function oracleField(v: unknown): ViolationField | null {
  // 1. LLM brand.
  if (carriesLlmBrand(v)) return "llm_tagged";

  // 2. Shape: plain, non-array object with exactly the four keys.
  if (typeof v !== "object" || v === null || Array.isArray(v)) return "shape";
  const ownKeys = Object.keys(v);
  const hasExactKeys =
    ownKeys.length === SIGNAL_KEYS.length &&
    SIGNAL_KEYS.every((k) => Object.prototype.hasOwnProperty.call(v, k));
  if (!hasExactKeys) return "shape";

  const o = v as Record<(typeof SIGNAL_KEYS)[number], unknown>;

  // 3. strategyId membership.
  if (!(STRATEGY_IDS as readonly unknown[]).includes(o.strategyId)) {
    return "strategyId";
  }

  // 4. direction membership.
  if (!(SIGNAL_DIRECTIONS as readonly unknown[]).includes(o.direction)) {
    return "direction";
  }

  // 5. strength.
  const strength = o.strength;
  if (typeof strength !== "number" || !Number.isFinite(strength)) {
    return "strength";
  }
  if (strength < 0 || strength > 1) return "strength";
  if (o.direction === "FLAT" && strength !== 0) return "strength";

  // 6. rationale.
  const rationale = o.rationale;
  if (typeof rationale !== "string") return "rationale";
  if (rationale.length < 1 || rationale.length > RATIONALE_MAX_LENGTH) {
    return "rationale";
  }
  if (rationale.trim().length === 0) return "rationale";

  return null;
}

// ---------------------------------------------------------------------------
// Generators.
// ---------------------------------------------------------------------------

/** A rationale that is always valid: 1..500 chars with a non-whitespace char. */
const validRationale = (): fc.Arbitrary<string> =>
  fc
    .string({ minLength: 1, maxLength: RATIONALE_MAX_LENGTH })
    .filter((s) => s.trim().length > 0);

/** A strength that is always valid for UP/DOWN: finite, in [0, 1] (0 allowed). */
const validStrength = (): fc.Arbitrary<number> =>
  fc.double({ min: 0, max: 1, noNaN: true });

/**
 * A VALID signal. For FLAT, strength is forced to 0 (Req 1.5). For UP/DOWN,
 * strength may be 0 (Req 1.9) through 1. Includes the UP/DOWN-strength-0 case
 * explicitly so the "accepted" branch is exercised.
 */
const arbValidSignal = (): fc.Arbitrary<Record<string, unknown>> =>
  fc
    .record({
      strategyId: fc.constantFrom(...STRATEGY_IDS),
      direction: fc.constantFrom(...SIGNAL_DIRECTIONS),
      strength: fc.oneof(validStrength(), fc.constant(0)),
      rationale: validRationale(),
    })
    .map((s) => ({
      ...s,
      strength: s.direction === "FLAT" ? 0 : s.strength,
    }));

/** Any JSON-ish scalar/compound value for defect injection. */
const arbAnyValue = (): fc.Arbitrary<unknown> =>
  fc.oneof(
    fc.constant(null),
    fc.constant(undefined),
    fc.boolean(),
    fc.integer(),
    fc.double(),
    fc.string(),
    fc.array(fc.anything(), { maxLength: 3 }),
  );

/** A non-StrategyId string/value for the strategyId defect. */
const arbBadStrategyId = (): fc.Arbitrary<unknown> =>
  fc.oneof(
    fc
      .string()
      .filter((s) => !(STRATEGY_IDS as readonly string[]).includes(s)),
    fc.integer(),
    fc.constant(null),
    fc.constant(""),
  );

/** A non-SignalDirection value for the direction defect. */
const arbBadDirection = (): fc.Arbitrary<unknown> =>
  fc.oneof(
    fc
      .string()
      .filter((s) => !(SIGNAL_DIRECTIONS as readonly string[]).includes(s)),
    fc.integer(),
    fc.constant(null),
    fc.constant("up"), // case-sensitive: lowercase is invalid
  );

/** A non-finite or out-of-range strength for the strength defect. */
const arbBadStrength = (): fc.Arbitrary<unknown> =>
  fc.oneof(
    fc.double({ min: 1 + 1e-9, max: 1e6, noNaN: true }), // > 1
    fc.double({ min: -1e6, max: -1e-9, noNaN: true }), // < 0
    fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY),
    fc.string(),
    fc.constant(null),
  );

/** A bad rationale for the rationale defect. */
const arbBadRationale = (): fc.Arbitrary<unknown> =>
  fc.oneof(
    fc.constant(""), // empty
    fc.constantFrom(" ", "\t", "\n", "   ", "\t \n"), // whitespace only
    // Over-length: non-whitespace chars beyond the 500-char cap.
    fc
      .integer({ min: 1, max: 50 })
      .map((n) => "x".repeat(RATIONALE_MAX_LENGTH + n)),
    fc.integer(), // non-string
    fc.constant(null),
  );

/** A single valid field-value for each key, used to build near-valid defects. */
const arbValidField = {
  strategyId: () => fc.constantFrom(...STRATEGY_IDS),
  direction: () => fc.constantFrom("UP", "DOWN"), // non-FLAT so strength 0..1 is free
  strength: () => validStrength(),
  rationale: () => validRationale(),
};

/**
 * An INVALID signal with a single injected defect, chosen so the FIRST failing
 * field is deterministic. The oracle independently decides the expected field.
 */
const arbInvalidSignal = (): fc.Arbitrary<unknown> =>
  fc.oneof(
    // --- shape defects -----------------------------------------------------
    // Not an object (or an array).
    fc.oneof(
      fc.constant(null),
      fc.string(),
      fc.integer(),
      fc.boolean(),
      fc.array(fc.anything(), { maxLength: 3 }),
    ),
    // Missing a key.
    fc
      .record({
        strategyId: arbValidField.strategyId(),
        direction: arbValidField.direction(),
        strength: arbValidField.strength(),
        rationale: arbValidField.rationale(),
      })
      .chain((s) =>
        fc.constantFrom(...SIGNAL_KEYS).map((drop) => {
          const copy: Record<string, unknown> = { ...s };
          delete copy[drop];
          return copy;
        }),
      ),
    // Extra key.
    fc.record({
      strategyId: arbValidField.strategyId(),
      direction: arbValidField.direction(),
      strength: arbValidField.strength(),
      rationale: arbValidField.rationale(),
      extra: arbAnyValue(),
    }),

    // --- strategyId defect -------------------------------------------------
    fc.record({
      strategyId: arbBadStrategyId(),
      direction: arbValidField.direction(),
      strength: arbValidField.strength(),
      rationale: arbValidField.rationale(),
    }),

    // --- direction defect (valid strategyId, bad direction) ----------------
    fc.record({
      strategyId: arbValidField.strategyId(),
      direction: arbBadDirection(),
      strength: fc.constant(0), // 0 is valid for any eventual direction
      rationale: arbValidField.rationale(),
    }),

    // --- strength defect: out-of-range / non-finite for UP/DOWN ------------
    fc.record({
      strategyId: arbValidField.strategyId(),
      direction: fc.constantFrom("UP", "DOWN"),
      strength: arbBadStrength(),
      rationale: arbValidField.rationale(),
    }),

    // --- strength defect: FLAT with non-zero strength (Req 1.5) ------------
    fc.record({
      strategyId: arbValidField.strategyId(),
      direction: fc.constant("FLAT"),
      strength: fc.oneof(
        fc.double({ min: 1e-9, max: 1, noNaN: true }),
        fc.constant(0.5),
      ),
      rationale: arbValidField.rationale(),
    }),

    // --- rationale defect (everything else valid) --------------------------
    fc.record({
      strategyId: arbValidField.strategyId(),
      direction: arbValidField.direction(),
      strength: arbValidField.strength(),
      rationale: arbBadRationale(),
    }),
  );

/** An LLM-tagged value carrying the real, unforgeable provenance brand. */
const arbLlmTagged = (): fc.Arbitrary<unknown> =>
  fc
    .oneof(
      arbValidSignal(), // a tagged value that is otherwise a perfect signal
      arbAnyValue(),
    )
    .map((payload) =>
      tagLlmOutput(payload, "signal_rationale", "2020-01-01T00:00:00.000Z"),
    );

// ---------------------------------------------------------------------------
// Properties.
// ---------------------------------------------------------------------------

describe("Property 2: Signal validation rejects exactly the invalid signals", () => {
  it("accepts exactly the valid signals and rejects exactly the invalid ones, naming the first field", () => {
    fc.assert(
      fc.property(
        fc.oneof(arbValidSignal(), arbInvalidSignal(), arbLlmTagged()),
        (candidate) => {
          const expectedField = oracleField(candidate);
          const result = validateStrategySignal(candidate);

          if (expectedField === null) {
            // The oracle says valid -> validator must accept with the same value.
            expect(result.ok).toBe(true);
            if (result.ok) {
              expect(result.value).toEqual(candidate);
            }
          } else {
            // The oracle says invalid -> validator must reject, naming the
            // first-failing field (Requirement 1.8).
            expect(result.ok).toBe(false);
            if (!result.ok) {
              expect(result.error.reason).toBe("invalid_signal");
              expect(result.error.field).toBe(expectedField);
            }
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it("accepts UP/DOWN signals with strength 0 (Requirement 1.9)", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("UP", "DOWN"),
        fc.constantFrom(...STRATEGY_IDS),
        validRationale(),
        (direction, strategyId, rationale) => {
          const result = validateStrategySignal({
            strategyId,
            direction,
            strength: 0,
            rationale,
          });
          expect(result.ok).toBe(true);
          if (result.ok) {
            expect(result.value.direction).toBe(direction);
            expect(result.value.strength).toBe(0);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("rejects every LLM-tagged value on the llm_tagged field before any other check (Requirement 1.7)", () => {
    fc.assert(
      fc.property(arbLlmTagged(), (tagged) => {
        const result = validateStrategySignal(tagged);
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.field).toBe("llm_tagged");
        }
      }),
      { numRuns: 100 },
    );
  });
});
