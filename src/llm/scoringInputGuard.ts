// ScoringInputGuard — the runtime half of the AI / Deterministic boundary
// (Requirements 2.1, 2.2, 2.6; Design "The AI / Deterministic Boundary").
//
// The most important architectural invariant in the system is that NO LLM
// output ever reaches a directional-probability computation or the Kill_Gate
// verdict computation (Requirements 2.1, 2.2). That boundary is enforced three
// ways (Design): (a) type separation — scoring functions never accept an
// LLM-derived type; (b) this runtime `ScoringInputGuard`, which rejects any
// value carrying the LLM provenance brand and RECORDS the blocked attempt; and
// (c) an automated guardrail test (Property 4, owned by task 9.5).
//
// This module owns halves (a) and (b):
//   - a COMPILE-TIME utility (`Deterministic<T>` / `assertDeterministic`) that
//     lets a scoring / verdict parameter reject `LlmTagged<unknown>` at the
//     type level, so an LLM-tagged argument is not assignable to it;
//   - a RUNTIME guard (`ScoringInputGuard`) that keys off the unforgeable
//     `PROVENANCE_BRAND` symbol (via the shared `isLlmTagged` detector) to
//     reject any tagged value on a scoring path, recording the blocked attempt
//     through an injected recorder PORT BEFORE it surfaces the rejection
//     (Requirement 2.6).
//
// The guard is purely ADDITIVE: it does not touch the deterministic math. The
// confidence selector and kill-gate scoring remain exactly as they are; this
// guard sits in front of them as a boundary check. When it passes, the
// deterministic computation proceeds on its typed inputs unchanged.

import { err, ok, type Result } from "../guard/types.js";
import { isLlmTagged, type LlmTagged } from "./types.js";

// --- Compile-time exclusion of LLM-derived types --------------------------

/**
 * A value that is provably NOT LLM-tagged, for use as a scoring / verdict
 * function parameter type (Requirements 2.1, 2.2).
 *
 * `LlmTagged<T>` carries the branded {@link import("./types.js").PROVENANCE_BRAND}
 * symbol member, so a value that includes that brand is structurally an
 * `LlmTagged`. `Deterministic<T>` resolves to `never` for any such branded type
 * and to `T` otherwise, so declaring a scoring parameter as
 * `Deterministic<T>` makes an `LlmTagged<…>` argument non-assignable at compile
 * time — the compiler refuses to feed LLM output into deterministic math.
 *
 * @example
 * // A scoring entry point that structurally cannot accept LLM output:
 * function scoreDirection<T>(input: Deterministic<T>): number { … }
 * scoreDirection(rawNumericInputs); // ok
 * scoreDirection(llmTaggedValue);   // compile error: argument is `never`
 */
export type Deterministic<T> = T extends LlmTagged<unknown> ? never : T;

/**
 * The type-level complement used by {@link Deterministic}: `true` when `T` is
 * NOT an {@link LlmTagged} value, `false` when it is. Handy for `expectTypeOf`
 * assertions and for documenting a boundary constraint inline.
 */
export type NotLlmTagged<T> = T extends LlmTagged<unknown> ? false : true;

/**
 * Compile-time-only assertion that a value is not LLM-tagged (Requirements 2.1,
 * 2.2). This is an identity function at runtime — its sole purpose is to force
 * the compiler to reject an {@link LlmTagged} argument at a scoring boundary,
 * because `Deterministic<T>` collapses a tagged argument to `never`.
 *
 * Prefer typing the scoring parameter directly as `Deterministic<T>`; use this
 * helper when you want the exclusion at an explicit call site.
 */
export function assertDeterministic<T>(value: Deterministic<T>): Deterministic<T> {
  return value;
}

// --- Blocked-attempt record + recorder PORT -------------------------------

/**
 * A recorded attempt to pass an LLM-tagged value into a scoring / verdict path
 * (Requirement 2.6). Recorded BEFORE the guard surfaces the rejection so the
 * audit trail is written even if a caller swallows the error.
 */
export interface BlockedScoringInput {
  /** Where the blocked value tried to enter, e.g. `"earnedConfidence"`. */
  readonly scoringPath: string;
  /** The sanctioned role that produced the blocked value, if recoverable. */
  readonly producingRole: string | null;
  /** Human-readable explanation of why the value was blocked. */
  readonly reason: string;
  /** When the block occurred (ISO-8601); injectable for deterministic tests. */
  readonly at: string;
}

/**
 * Recorder PORT for blocked scoring inputs (Requirement 2.6; Design boundary
 * rules). The guard depends only on this port, never on storage directly —
 * mirroring the storage/recorder-port pattern used across the codebase (e.g.
 * `RoleRejectionRecorder`, `FeatureRegistryStore`). A real adapter can persist
 * to an audit sink; the in-memory reference implementation keeps the guard
 * testable offline.
 */
export interface BlockedScoringInputRecorder {
  /** Persist a single blocked-attempt record. */
  record(blocked: BlockedScoringInput): void;
  /** Read back all recorded blocked attempts in insertion order. */
  all(): readonly BlockedScoringInput[];
}

/**
 * In-memory reference implementation of {@link BlockedScoringInputRecorder}.
 * Deterministic and dependency-free; the reference behavior for any persistent
 * adapter and the recorder used to exercise the guard offline.
 */
export class InMemoryBlockedScoringInputRecorder implements BlockedScoringInputRecorder {
  readonly #records: BlockedScoringInput[] = [];

  record(blocked: BlockedScoringInput): void {
    this.#records.push(blocked);
  }

  all(): readonly BlockedScoringInput[] {
    return [...this.#records];
  }

  /** Test/inspection helper: number of recorded blocked attempts. */
  get size(): number {
    return this.#records.length;
  }

  clear(): void {
    this.#records.length = 0;
  }
}

// --- Runtime guard ---------------------------------------------------------

/**
 * Clock PORT so timestamps on blocked-attempt records are injectable and tests
 * stay deterministic. Defaults to the system clock in production.
 */
export interface Clock {
  now(): string;
}

const systemClock: Clock = { now: () => new Date().toISOString() };

/** Dependencies injected into {@link ScoringInputGuard}. */
export interface ScoringInputGuardDeps {
  /** Records blocked LLM-tagged values (Req 2.6). */
  readonly recorder: BlockedScoringInputRecorder;
  /** Injectable clock; defaults to the system clock. */
  readonly clock?: Clock;
}

/**
 * Error thrown by {@link ScoringInputGuard.assertClean} when an LLM-tagged value
 * reaches a scoring / verdict path (Requirement 2.6). The blocked attempt is
 * recorded BEFORE this is thrown, so the audit trail is written even if the
 * caller swallows the error. Carries the recorded attempt for callers that
 * prefer to inspect rather than catch.
 */
export class LlmOnScoringPathError extends Error {
  readonly blocked: BlockedScoringInput;

  constructor(blocked: BlockedScoringInput) {
    super(blocked.reason);
    this.name = "LlmOnScoringPathError";
    this.blocked = blocked;
  }
}

/**
 * The runtime boundary check that keeps LLM output off scoring paths
 * (Requirement 2.6; Design "The AI / Deterministic Boundary").
 *
 * Construct it with a {@link BlockedScoringInputRecorder}; call {@link guard} or
 * {@link assertClean} at any deterministic scoring / verdict entry point with
 * the value about to be consumed. If the value carries the LLM provenance brand
 * (detected via the shared {@link isLlmTagged}), the attempt is RECORDED and
 * then the value is REJECTED — the deterministic computation never sees it.
 * Otherwise the value passes through unchanged and scoring proceeds.
 *
 * The guard is additive and side-effect-free on clean inputs: it records only
 * on a block, and returns the input untouched on a pass.
 */
export class ScoringInputGuard {
  readonly #recorder: BlockedScoringInputRecorder;
  readonly #clock: Clock;

  constructor(deps: ScoringInputGuardDeps) {
    this.#recorder = deps.recorder;
    this.#clock = deps.clock ?? systemClock;
  }

  /**
   * Non-throwing boundary check (Requirement 2.6). Returns a typed
   * {@link Result}: `ok(value)` when the value is clean (not LLM-tagged) so the
   * caller can proceed with the deterministic computation, or
   * `err(blocked)` — AFTER recording the attempt — when the value is
   * LLM-tagged.
   *
   * This mirrors the `Result<T, LookAheadViolation>` convention used by the
   * LookAheadGuard: rejections are surfaced as typed values, never silent
   * drops.
   *
   * @param value The value about to enter a scoring / verdict computation.
   * @param scoringPath Label for the entry point, recorded on a block.
   */
  guard<T>(value: T, scoringPath: string): Result<T, BlockedScoringInput> {
    if (isLlmTagged(value)) {
      const blocked = this.#recordBlock(value, scoringPath);
      return err(blocked);
    }
    return ok(value);
  }

  /**
   * Throwing boundary check (Requirement 2.6). Returns the value unchanged when
   * it is clean; RECORDS the attempt and throws {@link LlmOnScoringPathError}
   * when the value is LLM-tagged. Use this at entry points that treat an LLM
   * value on a scoring path as a programming error (fail-loud), which is the
   * boundary's intent.
   *
   * @param value The value about to enter a scoring / verdict computation.
   * @param scoringPath Label for the entry point, recorded on a block.
   */
  assertClean<T>(value: T, scoringPath: string): T {
    if (isLlmTagged(value)) {
      const blocked = this.#recordBlock(value, scoringPath);
      throw new LlmOnScoringPathError(blocked);
    }
    return value;
  }

  /**
   * Record a blocked attempt and return the record. Kept private so recording
   * always happens through the single, consistent path — and always BEFORE the
   * rejection is surfaced.
   */
  #recordBlock(value: LlmTagged<unknown>, scoringPath: string): BlockedScoringInput {
    const producingRole = readProducingRole(value);
    const blocked: BlockedScoringInput = {
      scoringPath,
      producingRole,
      reason: `LLM-tagged value${
        producingRole ? ` (role "${producingRole}")` : ""
      } blocked before reaching scoring path "${scoringPath}"; deterministic computation proceeds on its own inputs unchanged.`,
      at: this.#clock.now(),
    };
    this.#recorder.record(blocked);
    return blocked;
  }
}

/**
 * Best-effort extraction of the producing role from a tagged value's readable
 * provenance record, for the audit trail. Defensive: the brand is what makes a
 * value "LLM-tagged", so the guard must not assume a well-formed `provenance`.
 */
function readProducingRole(value: LlmTagged<unknown>): string | null {
  const provenance = (value as { provenance?: { role?: unknown } }).provenance;
  return typeof provenance?.role === "string" ? provenance.role : null;
}
