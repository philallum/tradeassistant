// In-memory reference implementation of the swappable ExternalSignalProvider
// (Requirement 23.4). Deterministic and dependency-free — the reference
// behaviour a real vendor adapter (e.g. an FX signals API client) must match,
// and the provider used to exercise the cross-reference offline.
//
// The provider is display/research-only and sits outside the deterministic
// core; it hands back a `Result<ExternalReferenceSignal, ExternalSignalError>`
// and never touches a scoring path.

import { err, ok, type Result } from "../guard/types.js";
import type { TradingDate } from "../guard/types.js";
import type { Pair } from "../ingestion/types.js";
import type {
  ExternalReferenceSignal,
  ExternalSignalError,
  ExternalSignalFailureMode,
  ExternalSignalProvider,
  ReferenceDirection,
} from "./types.js";

/** A seeded reference for a pair, or a seeded failure to exercise the fail-safe. */
export type SeededReference =
  | { readonly direction: ReferenceDirection; readonly score?: number }
  | { readonly failure: ExternalSignalFailureMode; readonly message?: string };

function isFailure(
  value: SeededReference,
): value is { readonly failure: ExternalSignalFailureMode; readonly message?: string } {
  return "failure" in value;
}

/**
 * A deterministic, in-memory {@link ExternalSignalProvider}. Seed a
 * per-pair recommendation (or a per-pair failure mode to exercise the
 * fail-safe); pairs left unseeded return an `unavailable` failure. Swapping this
 * for a real vendor adapter requires implementing only `fetchReference`,
 * demonstrating the interface is thin and swappable (Requirement 23.4).
 */
export class InMemoryExternalSignalProvider implements ExternalSignalProvider {
  readonly #provider: string;
  readonly #seed: Map<Pair, SeededReference>;

  constructor(provider: string, seed: Readonly<Partial<Record<Pair, SeededReference>>> = {}) {
    this.#provider = provider;
    this.#seed = new Map(Object.entries(seed) as [Pair, SeededReference][]);
  }

  /** Seed or replace a pair's reference (or failure). Returns `this` for chaining. */
  set(pair: Pair, reference: SeededReference): this {
    this.#seed.set(pair, reference);
    return this;
  }

  fetchReference(
    pair: Pair,
    decisionDate: TradingDate,
  ): Promise<Result<ExternalReferenceSignal, ExternalSignalError>> {
    const seeded = this.#seed.get(pair);

    if (seeded === undefined) {
      return Promise.resolve(
        err<ExternalSignalError>({
          reason: "external_signal_error",
          mode: "unavailable",
          pair,
          message: `no external reference seeded for ${pair}`,
        }),
      );
    }

    if (isFailure(seeded)) {
      return Promise.resolve(
        err<ExternalSignalError>({
          reason: "external_signal_error",
          mode: seeded.failure,
          pair,
          message: seeded.message ?? `seeded ${seeded.failure} failure for ${pair}`,
        }),
      );
    }

    // `provider` and `fetchedAt` are re-stamped by the orchestrator; the values
    // here are placeholders the orchestrator overwrites.
    const signal: ExternalReferenceSignal = {
      pair,
      decisionDate,
      direction: seeded.direction,
      ...(seeded.score !== undefined ? { score: seeded.score } : {}),
      provider: this.#provider,
      fetchedAt: "1970-01-01T00:00:00.000Z",
    };
    return Promise.resolve(ok(signal));
  }
}
