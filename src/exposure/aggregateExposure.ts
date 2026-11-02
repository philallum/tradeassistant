// Aggregate_Exposure (Requirement 8). Pure, deterministic, LLM-free and
// information-only: it never sizes positions and never feeds back into the
// firing or scoring decision (R8.4, R8.5).
import type { FiringSetupRow } from "../dashboard/persistFiringSetups.js";
import { PAIRS, type Pair } from "../ingestion/types.js";

export interface CurrencyExposure {
  readonly currency: string;
  readonly net: number;
}

export interface ExposureSummary {
  readonly perCurrency: readonly CurrencyExposure[];
  /** One effective directional currency bet (R8.2). */
  readonly concentrated: boolean;
  /** Strongest firing pair, distinguishable from the alternatives (R8.3). */
  readonly strongestPair: Pair | null;
}

/**
 * Sum base/quote legs across the firing set (EURUSD UP = +EUR, -USD).
 * Only surfaced, directional rows count. `concentrated` is true when at least
 * two setups fire and a single currency carries every one of them on the same
 * side (|net| equals the firing count). `strongestPair` is the highest
 * earnedConfidence, ties broken by PAIRS order.
 */
export function aggregateExposure(
  firing: readonly FiringSetupRow[],
): ExposureSummary {
  const active = firing.filter((r) => r.surfaced && r.direction !== "FLAT");
  const nets = new Map<string, number>();
  for (const row of active) {
    const sign = row.direction === "UP" ? 1 : -1;
    const base = row.pair.slice(0, 3);
    const quote = row.pair.slice(3, 6);
    nets.set(base, (nets.get(base) ?? 0) + sign);
    nets.set(quote, (nets.get(quote) ?? 0) - sign);
  }
  const perCurrency = [...nets.entries()]
    .map(([currency, net]) => ({ currency, net }))
    .sort((a, b) => (a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0));

  const concentrated =
    active.length >= 2 &&
    perCurrency.some((c) => Math.abs(c.net) === active.length);

  let strongest: FiringSetupRow | null = null;
  for (const row of active) {
    if (
      strongest === null ||
      row.earnedConfidence > strongest.earnedConfidence ||
      (row.earnedConfidence === strongest.earnedConfidence &&
        PAIRS.indexOf(row.pair) < PAIRS.indexOf(strongest.pair))
    ) {
      strongest = row;
    }
  }

  return { perCurrency, concentrated, strongestPair: strongest?.pair ?? null };
}
