// LLM_Interface Types — the AI / Deterministic boundary vocabulary
// (Requirements 2.3, 2.4, 2.5; Design "The AI / Deterministic Boundary" and
// Component 9 — LLM_Interface).
//
// This file defines the shared type vocabulary the whole AI layer is built on:
//   - the four sanctioned LLM roles (and nothing else may be invoked),
//   - the per-role input/output maps,
//   - the `LlmTagged<T>` provenance marker that structurally brands every
//     LLM-derived value so a runtime guard (the ScoringInputGuard, task 9.2)
//     can reliably reject it on any scoring / verdict path (Requirement 2.6),
//   - the rejection-record type recorded when a non-sanctioned role is refused
//     (Requirement 2.5).
//
// The provenance marker is deliberately a NON-ENUMERABLE, symbol-keyed brand
// PLUS an ordinary `provenance` field. The symbol brand makes the tag
// unforgeable and invisible to `JSON.stringify` / `Object.keys` (so it does not
// leak into serialized payloads), while the `provenance` field records the
// producing role for auditing. Task 9.2 keys off the symbol at runtime; scoring
// function signatures reject the branded type at compile time.

import type { TradingDate } from "../guard/types.js";

/**
 * The four — and only four — sanctioned LLM roles (Requirement 2.3):
 *   - `news_filter`         — news/event no-trade filter → structured RiskFlag.
 *   - `signal_rationale`    — plain-language rationale derived from the signal.
 *   - `pattern_description` — qualitative labels for matched analogues.
 *   - `research_assistant`  — feature-hypothesis / interpretation proposals
 *                             (advisory only; never auto-accepted).
 *
 * Any role outside this set is rejected BEFORE the provider is invoked and the
 * rejected role is recorded (Requirement 2.5).
 */
export const SANCTIONED_ROLES = [
  "news_filter",
  "signal_rationale",
  "pattern_description",
  "research_assistant",
] as const;

/** A sanctioned LLM role (Requirement 2.3). */
export type SanctionedRole = (typeof SANCTIONED_ROLES)[number];

/**
 * Runtime type guard for {@link SanctionedRole}. The single source of truth for
 * "is this role allowed?" — used by the LLM_Interface to gate every call
 * (Requirement 2.3, 2.5).
 */
export function isSanctionedRole(role: string): role is SanctionedRole {
  return (SANCTIONED_ROLES as readonly string[]).includes(role);
}

// --- Per-role input / output vocabulary -----------------------------------
//
// The concrete shapes for the news filter (task 9.3) and rationale/labels
// (task 9.4) are owned by those subtasks. Task 9.1 only needs the role→input
// and role→output MAPS to type `invoke<R>()`, so the leaf shapes are declared
// minimally/structurally here and refined by later subtasks.

/**
 * Structured risk flag emitted by the `news_filter` role (Requirement 14.2).
 * Declared here so `invoke("news_filter", …)` is typed; the News Filter
 * (task 9.3) consumes only the `{ level, reason }` data, never a direction.
 */
export interface RiskFlag {
  readonly level: "none" | "elevated" | "high";
  readonly reason: string;
}

/**
 * Input to the `news_filter` role: the calendar events relevant to a
 * Decision_Date. Declared structurally; task 9.3 supplies the concrete
 * `CalendarEvent` shape.
 */
export interface NewsFilterInput {
  readonly decisionDate: TradingDate;
  readonly events: readonly Readonly<Record<string, unknown>>[];
}

/** Numeric, deterministic signal inputs handed to `signal_rationale` (Req 15.1). */
export interface SignalRationaleInput {
  readonly [key: string]: unknown;
}

/** Analogue records handed to `pattern_description` for qualitative labels (Req 15.3). */
export interface PatternDescriptionInput {
  readonly [key: string]: unknown;
}

/** A research-assistant prompt: a hypothesis or interpretation to consider (Req 2.8). */
export interface ResearchAssistantInput {
  readonly [key: string]: unknown;
}

/**
 * Map from each sanctioned role to its input type. Task 9.1 fixes the role keys;
 * later subtasks refine the leaf shapes as needed.
 */
export interface RoleInput {
  readonly news_filter: NewsFilterInput;
  readonly signal_rationale: SignalRationaleInput;
  readonly pattern_description: PatternDescriptionInput;
  readonly research_assistant: ResearchAssistantInput;
}

/**
 * Map from each sanctioned role to its (untagged) output type. The
 * LLM_Interface wraps each of these in an {@link LlmTagged} before returning it.
 */
export interface RoleOutput {
  readonly news_filter: RiskFlag;
  readonly signal_rationale: string;
  readonly pattern_description: readonly string[];
  readonly research_assistant: string;
}

// --- Provenance marker -----------------------------------------------------

/**
 * The provenance brand key. A unique, module-private symbol used as a
 * non-enumerable property key on every {@link LlmTagged} value. Because it is a
 * `Symbol`, it cannot be produced by JSON parsing or forged by ordinary object
 * literals, and it does not appear in `Object.keys` / `JSON.stringify` output.
 *
 * Exposed (read-only) so the ScoringInputGuard (task 9.2) and tests can detect
 * the brand at runtime via `PROVENANCE_BRAND in value`.
 */
export const PROVENANCE_BRAND: unique symbol = Symbol("fx.llm.provenance");

/**
 * The provenance record attached to every LLM-derived value: which sanctioned
 * role produced it and the constant marker string. Recorded so an audit can
 * attribute any tagged value back to its producing role (Requirement 2.6).
 */
export interface LlmProvenance {
  /** The sanctioned role that produced the value. */
  readonly role: SanctionedRole;
  /** Constant marker string identifying LLM origin. */
  readonly marker: "llm";
  /** When the value was produced (ISO-8601); injectable for deterministic tests. */
  readonly at: string;
}

/**
 * A value produced by the LLM, wrapped with an unforgeable provenance marker.
 *
 * `LlmTagged<T>` is the ONLY type the LLM_Interface returns. It carries:
 *   - the underlying `value: T`,
 *   - a readable `provenance` record (role + marker + timestamp), and
 *   - a non-enumerable symbol brand ({@link PROVENANCE_BRAND}) that a runtime
 *     guard keys off to reliably identify any LLM-derived value regardless of
 *     how it was passed around (Requirement 2.6).
 *
 * Scoring / verdict function signatures must be written to EXCLUDE this type so
 * the compiler rejects any attempt to feed LLM output into deterministic math
 * (task 9.2 enforces this). To make that exclusion mechanical, the branded
 * symbol member is part of the type: a plain `T` is not assignable to
 * `LlmTagged<T>`, and a scoring function typed to reject `LlmTagged<unknown>`
 * will refuse a tagged argument at compile time.
 */
export type LlmTagged<T> = {
  readonly value: T;
  readonly provenance: LlmProvenance;
} & { readonly [PROVENANCE_BRAND]: true };

/**
 * The deterministic (non-LLM) type projection, re-exported here so consumers at
 * the AI / Deterministic boundary can pull both {@link isLlmTagged} and
 * `Deterministic<T>` from this single vocabulary module. The canonical
 * definition lives with the ScoringInputGuard; this is a type-only re-export.
 */
export type { Deterministic } from "./scoringInputGuard.js";

/**
 * Runtime detector for the provenance brand. Returns true for any value carrying
 * the non-enumerable {@link PROVENANCE_BRAND} symbol — i.e. anything the
 * LLM_Interface produced. The ScoringInputGuard (task 9.2) uses this to reject
 * LLM-derived values on scoring paths (Requirement 2.6); it is defined here
 * because task 9.1 owns the provenance marker itself.
 */
export function isLlmTagged(value: unknown): value is LlmTagged<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<PropertyKey, unknown>)[PROVENANCE_BRAND] === true
  );
}

// --- Role-rejection record -------------------------------------------------

/**
 * A recorded rejection of a non-sanctioned LLM role (Requirement 2.5). When
 * `invoke()` is called with any role outside {@link SANCTIONED_ROLES}, the call
 * is refused BEFORE the provider is invoked and one of these is recorded via a
 * {@link RoleRejectionRecorder}.
 */
export interface RoleRejection {
  /** The rejected (non-sanctioned) role string, exactly as requested. */
  readonly requestedRole: string;
  /** Human-readable explanation of why it was rejected. */
  readonly reason: string;
  /** When the rejection occurred (ISO-8601); injectable for deterministic tests. */
  readonly at: string;
}

/**
 * Recorder PORT for role rejections (Requirement 2.5, 17.1). The LLM_Interface
 * depends only on this port, never on storage directly — mirroring the
 * storage-port pattern used across the codebase (e.g. `EvaluationReportStore`,
 * `DocStore`). A real adapter can persist to the `role_rejections` audit sink;
 * the in-memory reference implementation keeps the interface testable offline.
 */
export interface RoleRejectionRecorder {
  /** Persist a single rejection record. */
  record(rejection: RoleRejection): void;
  /** Read back all recorded rejections in insertion order. */
  all(): readonly RoleRejection[];
}

/**
 * In-memory reference implementation of {@link RoleRejectionRecorder}.
 * Deterministic and dependency-free; the reference behavior for any persistent
 * adapter and the recorder used to exercise the interface offline.
 */
export class InMemoryRoleRejectionRecorder implements RoleRejectionRecorder {
  readonly #records: RoleRejection[] = [];

  record(rejection: RoleRejection): void {
    this.#records.push(rejection);
  }

  all(): readonly RoleRejection[] {
    return [...this.#records];
  }

  /** Test/inspection helper: number of recorded rejections. */
  get size(): number {
    return this.#records.length;
  }

  clear(): void {
    this.#records.length = 0;
  }
}
