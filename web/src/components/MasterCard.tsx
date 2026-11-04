/**
 * Master_Card: the single-column composition for the selected pair, top to bottom:
 *
 *   PairSummary -> StrategyCardGrid (2 x 3) -> ContextDrawers -> SystemRecordFooter
 *
 * Props are already-shaped view models; nothing is recomputed here. There is no stop-loss,
 * take-profit or expectancy anywhere, no multi-pair table, and no raw sample-count dump (the
 * latter lives only inside the collapsed evidence drawer). No `<h1>` is rendered; the
 * ControlBar owns the document's single `<h1>`.
 */
import type { JSX } from "react";

import type { ConvictionVM } from "../pure/shapeConviction";
import type { DailyNoteViewModel } from "../pure/shapeDailyNote";
import type { EvidenceVM } from "../pure/shapeEvidence";
import type { PairSummaryVM } from "../pure/shapePairSummary";
import type { StrategyCardVM } from "../pure/shapeStrategyCards";
import type { SystemRecordVM } from "../pure/shapeSystemRecord";
import { theme } from "../theme/darkTheme";
import { ContextDrawers } from "./ContextDrawers";
import { PairSummary } from "./PairSummary";
import { StrategyCardGrid } from "./StrategyCardGrid";
import { SystemRecordFooter } from "./SystemRecordFooter";

export interface MasterCardProps {
  readonly pair: string;
  /** `null` when the pair has no confluence row. */
  readonly conviction: ConvictionVM | null;
  readonly summary: PairSummaryVM;
  readonly cards: readonly StrategyCardVM[];
  /** Trading-day window the strategy records cover (0 = none built). */
  readonly lookbackDays: number;
  readonly note: DailyNoteViewModel;
  readonly evidence: EvidenceVM | null;
  readonly systemRecord: SystemRecordVM;
}

export function MasterCard({
  pair,
  conviction,
  summary,
  cards,
  lookbackDays,
  note,
  evidence,
  systemRecord,
}: MasterCardProps): JSX.Element {
  return (
    <article
      aria-label={`${pair} master card`}
      data-testid="master-card"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: theme.spacing.md,
        minWidth: 0,
      }}
    >
      <PairSummary pair={pair} conviction={conviction} summary={summary} />
      <StrategyCardGrid pair={pair} cards={cards} lookbackDays={lookbackDays} />
      <ContextDrawers note={note} evidence={evidence} />
      <SystemRecordFooter record={systemRecord} />
    </article>
  );
}
