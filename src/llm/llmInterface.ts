// LLM_Interface — the single, thin, swappable gateway to any LLM
// (Requirements 2.3, 2.4, 2.5; Design Component 9).
//
// Every LLM call in the system routes through this interface (Requirement 2.4).
// It does two things and nothing else:
//   1. ROLE GATING (Requirements 2.3, 2.5): only the four sanctioned roles may
//      be invoked. Any other role is REJECTED BEFORE the provider is invoked
//      and the rejected role is recorded via a RoleRejectionRecorder PORT.
//   2. PROVENANCE TAGGING (Requirement 2.6): every provider output is wrapped in
//      an `LlmTagged<T>` marker so the ScoringInputGuard (task 9.2) can reject
//      any LLM-derived value that reaches a scoring / verdict path.
//
// The actual model backend lives behind a thin, injectable `LlmProvider` PORT,
// keeping the interface provider-agnostic (Design: v1 = Google Gemini via the
// Google Gen AI SDK with GCP IAM/ADC, no standalone API key — swappable without
// changing callers). Task 9.1 deliberately adds NO real network dependency and
// NO Google SDK: the backend is exercised offline through a fake provider so
// tests stay deterministic.

import {
  isSanctionedRole,
  PROVENANCE_BRAND,
  type LlmProvenance,
  type LlmTagged,
  type RoleInput,
  type RoleOutput,
  type RoleRejection,
  type RoleRejectionRecorder,
  type SanctionedRole,
} from "./types.js";

/**
 * The swappable model backend PORT. The LLM_Interface depends only on this;
 * the v1 Google Gemini adapter (added in a later subtask, behind IAM/ADC) and
 * any test fake both implement it. `complete` is invoked ONLY after the role
 * has already been validated as sanctioned, so the provider never needs to
 * re-check the role.
 */
export interface LlmProvider {
  /**
   * Produce the raw (untagged) output for an already-sanctioned role. The
   * interface wraps the returned value in an {@link LlmTagged} before handing it
   * to callers.
   */
  complete<R extends SanctionedRole>(role: R, input: RoleInput[R]): Promise<RoleOutput[R]>;
}

/**
 * Clock PORT so timestamps on provenance/rejection records are injectable and
 * tests stay deterministic. Defaults to the system clock in production.
 */
export interface Clock {
  now(): string;
}

const systemClock: Clock = { now: () => new Date().toISOString() };

/** Dependencies injected into {@link LlmInterface}. */
export interface LlmInterfaceDeps {
  /** The model backend. Swappable and provider-agnostic (Req 2.4). */
  readonly provider: LlmProvider;
  /** Records rejected non-sanctioned roles (Req 2.5). */
  readonly rejectionRecorder: RoleRejectionRecorder;
  /** Injectable clock; defaults to the system clock. */
  readonly clock?: Clock;
}

/**
 * Error thrown when a non-sanctioned role is requested. The rejection is
 * recorded (Requirement 2.5) BEFORE this is thrown, so the audit trail is
 * written even if the caller swallows the error. Carries the recorded rejection
 * for callers that prefer to inspect rather than catch.
 */
export class RoleRejectedError extends Error {
  readonly rejection: RoleRejection;

  constructor(rejection: RoleRejection) {
    super(rejection.reason);
    this.name = "RoleRejectedError";
    this.rejection = rejection;
  }
}

/**
 * Wrap a raw provider output in an unforgeable {@link LlmTagged} marker.
 *
 * The symbol brand ({@link PROVENANCE_BRAND}) is attached as a NON-ENUMERABLE
 * property so it never leaks into `JSON.stringify` / `Object.keys`, yet is
 * detectable at runtime via `PROVENANCE_BRAND in value` — the hook the
 * ScoringInputGuard relies on (Requirement 2.6). The readable `provenance`
 * record attributes the value to its producing role for auditing.
 */
export function tagLlmOutput<T>(value: T, role: SanctionedRole, at: string): LlmTagged<T> {
  const provenance: LlmProvenance = { role, marker: "llm", at };
  const tagged = { value, provenance } as {
    value: T;
    provenance: LlmProvenance;
    [PROVENANCE_BRAND]?: true;
  };
  Object.defineProperty(tagged, PROVENANCE_BRAND, {
    value: true,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return tagged as LlmTagged<T>;
}

/**
 * The LLM_Interface (Design Component 9). Construct it with a provider and a
 * rejection recorder; call {@link invoke} for every LLM interaction in the
 * system (Requirement 2.4).
 */
export class LlmInterface {
  readonly #provider: LlmProvider;
  readonly #rejectionRecorder: RoleRejectionRecorder;
  readonly #clock: Clock;

  constructor(deps: LlmInterfaceDeps) {
    this.#provider = deps.provider;
    this.#rejectionRecorder = deps.rejectionRecorder;
    this.#clock = deps.clock ?? systemClock;
  }

  /**
   * Invoke the LLM for a single sanctioned role, returning its provenance-tagged
   * output (Requirements 2.3, 2.4, 2.5, 2.6).
   *
   * Role gating happens FIRST: if `role` is not one of the four sanctioned
   * roles, the provider is NEVER touched — the rejection is recorded and a
   * {@link RoleRejectedError} is thrown. Only a sanctioned role reaches the
   * provider, and its output is wrapped in an {@link LlmTagged} before return.
   *
   * The `R extends SanctionedRole` bound rejects unknown roles at compile time;
   * the runtime `isSanctionedRole` check defends the same invariant against
   * untyped / dynamic callers, which is where Requirement 2.5 bites.
   */
  async invoke<R extends SanctionedRole>(
    role: R,
    input: RoleInput[R],
  ): Promise<LlmTagged<RoleOutput[R]>> {
    if (!isSanctionedRole(role)) {
      // `role` narrows to `never` here (it is typed as a SanctionedRole), but a
      // dynamic/untyped caller can still pass an unknown string at runtime —
      // that is exactly the case Requirement 2.5 defends. Read it as a string.
      const requestedRole = role as string;
      const rejection: RoleRejection = {
        requestedRole,
        reason: `Non-sanctioned LLM role "${requestedRole}" rejected before invocation; allowed roles are news_filter, signal_rationale, pattern_description, research_assistant.`,
        at: this.#clock.now(),
      };
      this.#rejectionRecorder.record(rejection);
      throw new RoleRejectedError(rejection);
    }

    const output = await this.#provider.complete(role, input);
    return tagLlmOutput(output, role, this.#clock.now());
  }
}
