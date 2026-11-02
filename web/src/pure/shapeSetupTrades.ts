/**
 * Pure shaper for the re-organised Setups landing tab (trader-edge-validation R10.1, R10.3,
 * R1.7).
 *
 * Groups, per firing pair: the FORECAST (direction, horizon, analogue count, historical
 * agreement, confidence) and the TRADE plan (entry assumption, SL, TP, horizon expiry,
 * estimated Net_Expectancy), each explicitly labelled so a directional forecast is never
 * mistaken for a validated trade. Anything not yet validated out-of-sample, net of costs is
 * flagged `validated: false` so the UI renders an explicit "un-validated" marker.
 *
 * Pure: no fetch, DOM, clock, or core import. Presentation only; recomputes no scoring —
 * analogue count / agreement are simple tallies of the snapshot's matured analogue rows.
 *
 * R1.7: the independently-derived SL/TP is un-validated until a Trade_Simulation establishes
 * order, i.e. until the per-forecast validation status is `validated` AND the system has a
 * non-empty ledger summary. Absent v4 slices (a v3 snapshot) therefore yield un-validated.
 */
import type {
  AnalogueOutcomeRow,
  Direction,
  Horizon,
  ProvenanceRow,
  TradeLedgerSummary,
  ValidationStatusRow,
} from "../api/types";
import type { CardVM } from "./shapeDashboard";

/** A value plus whether it has been validated OOS (net of costs). */
export interface MaybeValidated<T> {
  readonly value: T;
  readonly validated: boolean;
}

/** One firing pair's grouped FORECAST + TRADE view. */
export interface SetupTradeVM {
  readonly pair: string;
  readonly strategyId: string;
  readonly forecast: {
    readonly label: "FORECAST";
    readonly direction: Direction;
    readonly horizon: Horizon;
    readonly confidence: MaybeValidated<number>;
    /** Matured analogues for this pair+horizon. */
    readonly analogueCount: number;
    /** Share (0..1) of those analogues whose direction matches; null when there are none. */
    readonly historicalAgreement: number | null;
  };
  readonly trade: {
    readonly label: "TRADE";
    /** Entry assumption (earliest entry reference) or null when provenance is absent. */
    readonly entryAssumption: string | null;
    readonly stopLossPips: MaybeValidated<number | null>;
    readonly takeProfitPips: MaybeValidated<number | null>;
    /** Horizon expiry date or null when provenance is absent. */
    readonly horizonExpiry: string | null;
    /** System net expectancy in pips, or null when not measured. */
    readonly netExpectancyPips: MaybeValidated<number | null>;
  };
  /** True when anything above is un-validated. */
  readonly anyUnvalidated: boolean;
}

export interface SetupTradesInput {
  readonly cards: readonly CardVM[];
  readonly decisionDate: string;
  readonly analogueOutcomes: readonly AnalogueOutcomeRow[];
  readonly tradeLedgerSummary: TradeLedgerSummary;
  readonly provenance: readonly ProvenanceRow[];
  readonly validationStatus: readonly ValidationStatusRow[];
}

/** Shape the surfaced cards into grouped FORECAST/TRADE view models. */
export function shapeSetupTrades(input: SetupTradesInput): readonly SetupTradeVM[] {
  const system = input.tradeLedgerSummary.strategies.find((s) => s.role === "system");
  const systemMeasured = system !== undefined && system.summary.tradeCount > 0;

  return input.cards.map((card) => {
    const status = input.validationStatus.find(
      (v) => v.pair === card.pair && v.decision_date === input.decisionDate,
    );
    const prov = input.provenance.find(
      (p) => p.pair === card.pair && p.decision_date === input.decisionDate,
    );
    const validated = status?.status === "validated";
    // R1.7: SL/TP/expectancy need an established Trade_Simulation order (non-empty ledger).
    const tradeValidated = validated && systemMeasured;

    const analogues = input.analogueOutcomes.filter(
      (a) => a.asset === card.pair && a.horizon === card.horizon && a.matured,
    );
    const agreeing = analogues.filter((a) => a.direction === card.direction).length;

    const stopLossPips = { value: card.stopLossPips, validated: tradeValidated };
    const takeProfitPips = { value: card.takeProfitPips, validated: tradeValidated };
    const netExpectancyPips = {
      value: systemMeasured ? system.summary.netExpectancyPips : null,
      validated: tradeValidated && systemMeasured,
    };
    const confidence = { value: card.earnedConfidence, validated };

    return {
      pair: card.pair,
      strategyId: card.strategyId,
      forecast: {
        label: "FORECAST" as const,
        direction: card.direction,
        horizon: card.horizon,
        confidence,
        analogueCount: analogues.length,
        historicalAgreement: analogues.length === 0 ? null : agreeing / analogues.length,
      },
      trade: {
        label: "TRADE" as const,
        entryAssumption: prov?.earliestEntryRef ?? null,
        stopLossPips,
        takeProfitPips,
        horizonExpiry: prov?.horizonEnd ?? null,
        netExpectancyPips,
      },
      anyUnvalidated: !(
        confidence.validated &&
        stopLossPips.validated &&
        takeProfitPips.validated &&
        netExpectancyPips.validated
      ),
    };
  });
}
