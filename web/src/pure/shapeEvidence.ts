/**
 * Pure shaper for the "historical evidence" block shown BEFORE any AI commentary
 * (trader-edge-validation R10.4, R10.7).
 *
 * Per firing card it tallies the matured analogues for the pair+horizon and classifies each
 * by what its excursion profile reached relative to the card's own SL/TP: target only, stop
 * only, both (order not resolvable from MFE/MAE alone, reported honestly as ambiguous),
 * or neither. It also carries the system's measured, path-resolved ledger line (win rate,
 * ambiguous/expired share, trade count) when the v4 ledger summary exists.
 *
 * Pure and presentation-only: no fetch, DOM, clock, or core import; recomputes no firing or
 * scoring — simple tallies of snapshot rows.
 */
import type { AnalogueOutcomeRow, PerformanceSummaryRow, TradeLedgerSummary } from "../api/types";
import type { CardVM } from "./shapeDashboard";

export interface EvidenceVM {
  readonly pair: string;
  readonly horizon: number;
  readonly analogueCount: number;
  /** Analogues whose excursion reached the take-profit distance but not the stop. */
  readonly targetOnly: number;
  /** Analogues whose excursion reached the stop distance but not the target. */
  readonly stopOnly: number;
  /** Reached both levels; the order is unresolved from MFE/MAE, so reported as ambiguous. */
  readonly ambiguous: number;
  /** Reached neither level within the horizon. */
  readonly neither: number;
  /** False when the card has no SL/TP, so outcomes cannot be classified. */
  readonly classifiable: boolean;
  /** The system's path-resolved ledger line, or null when not measured. */
  readonly ledger: PerformanceSummaryRow | null;
}

export interface EvidenceInput {
  readonly cards: readonly CardVM[];
  readonly analogueOutcomes: readonly AnalogueOutcomeRow[];
  readonly tradeLedgerSummary: TradeLedgerSummary;
}

export function shapeEvidence(input: EvidenceInput): readonly EvidenceVM[] {
  const system = input.tradeLedgerSummary.strategies.find((s) => s.role === "system");
  const ledger = system !== undefined && system.summary.tradeCount > 0 ? system.summary : null;

  return input.cards.map((card) => {
    const analogues = input.analogueOutcomes.filter(
      (a) => a.asset === card.pair && a.horizon === card.horizon && a.matured,
    );
    const sl = card.stopLossPips;
    const tp = card.takeProfitPips;
    const classifiable = sl !== null && tp !== null;
    let targetOnly = 0;
    let stopOnly = 0;
    let ambiguous = 0;
    let neither = 0;
    if (classifiable) {
      for (const a of analogues) {
        const hitTp = a.mfe_pips >= tp;
        const hitSl = a.mae_pips >= sl;
        if (hitTp && hitSl) ambiguous += 1;
        else if (hitTp) targetOnly += 1;
        else if (hitSl) stopOnly += 1;
        else neither += 1;
      }
    }
    return {
      pair: card.pair,
      horizon: card.horizon,
      analogueCount: analogues.length,
      targetOnly,
      stopOnly,
      ambiguous,
      neither,
      classifiable,
      ledger,
    };
  });
}
