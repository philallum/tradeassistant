/**
 * Pure shaper for the "currency exposure" card.
 *
 * Several firing setups on USD majors can be one trade: EURUSD short + GBPUSD short + USDCHF
 * long is a single USD-long bet. The backend's `exposure` slice already nets each currency's
 * legs across the day's firing setups; this shaper states that plainly. It is information only:
 * it never sizes anything and never feeds back into a decision.
 *
 * The slice describes the LATEST run's firing set, so the card is hidden when a different
 * (older) Decision_Date is being browsed.
 */
import type { Exposure } from "../api/types";

export interface ExposureLeg {
  readonly currency: string;
  readonly net: number;
  /** "Long USD x3" / "Short EUR x1". */
  readonly text: string;
}

export interface ExposureVM {
  /** Number of firing setups the legs are netted from. */
  readonly firingCount: number;
  /** Non-zero legs, largest absolute exposure first, then alphabetical. */
  readonly legs: readonly ExposureLeg[];
  /** True when one currency carries every setup on the same side. */
  readonly concentrated: boolean;
  readonly headline: string;
  /** Plain-language reading, or null when there is nothing to say. */
  readonly note: string | null;
}

export const CONCENTRATED_NOTE =
  "These setups lean the same way on one currency, so they behave like a single bet rather than separate ideas.";

/** Null when there is nothing to show (fewer than two setups, or not the latest run). */
export function shapeExposure(
  exposure: Exposure,
  firingCount: number,
  viewingLatestRun: boolean,
): ExposureVM | null {
  if (!viewingLatestRun || firingCount < 2) return null;
  const legs = exposure.perCurrency
    .filter((c) => c.net !== 0)
    .map((c) => ({
      currency: c.currency,
      net: c.net,
      text: `${c.net > 0 ? "Long" : "Short"} ${c.currency} x${Math.abs(c.net)}`,
    }))
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net) || a.currency.localeCompare(b.currency));
  if (legs.length === 0) return null;
  return {
    firingCount,
    legs,
    concentrated: exposure.concentrated,
    headline: exposure.concentrated
      ? `${firingCount} setups, one effective currency bet`
      : `${firingCount} setups, combined currency exposure`,
    note: exposure.concentrated ? CONCENTRATED_NOTE : null,
  };
}
