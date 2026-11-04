/**
 * Master_Card (Req 1.2, 1.3, 1.7, 8.1, 8.2, 8.4, 12.1): the single-column composition for the
 * selected pair, top to bottom:
 *
 *   VerdictBanner -> BacktestEdgePill (exactly one) -> PairConfluenceMatrix -> ContextDrawers
 *
 * Props are already-shaped view models; nothing is recomputed here. The default view has no
 * multi-pair table, no year-long backtest table and no raw sample-count dump (the latter
 * lives only inside the collapsed evidence drawer). No `<h1>` is rendered; the ControlBar
 * owns the document's single `<h1>`.
 */
import type { JSX } from "react";

import type { BacktestEdgePillVM } from "../pure/shapeBacktestEdge";
import type { ColumnVM, RowVM } from "../pure/shapeConfluence";
import type { DailyNoteViewModel } from "../pure/shapeDailyNote";
import type { EvidenceVM } from "../pure/shapeEvidence";
import type { SetupTradeVM } from "../pure/shapeSetupTrades";
import { theme } from "../theme/darkTheme";
import { BacktestEdgePill } from "./BacktestEdgePill";
import { ContextDrawers } from "./ContextDrawers";
import { PairConfluenceMatrix } from "./PairConfluenceMatrix";
import { VerdictBanner } from "./VerdictBanner";

export interface MasterCardProps {
  /** `null` when the selected pair did not fire. */
  readonly setup: SetupTradeVM | null;
  /** Selected pair; used for labelling when `setup` is `null`. */
  readonly pair?: string;
  readonly edge: BacktestEdgePillVM;
  readonly row: RowVM | null;
  readonly columns: readonly ColumnVM[];
  /** The confluence view model's `validated` flag, passed through to the matrix. */
  readonly validated: boolean;
  readonly note: DailyNoteViewModel;
  readonly evidence: EvidenceVM | null;
}

export function MasterCard({
  setup,
  pair,
  edge,
  row,
  columns,
  validated,
  note,
  evidence,
}: MasterCardProps): JSX.Element {
  const label = setup?.pair ?? pair ?? "Pair";
  return (
    <article
      aria-label={`${label} master card`}
      data-testid="master-card"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: theme.spacing.md,
        minWidth: 0,
      }}
    >
      <VerdictBanner vm={setup} pair={label} />
      <BacktestEdgePill vm={edge} />
      <PairConfluenceMatrix row={row} columns={columns} validated={validated} />
      <ContextDrawers note={note} evidence={evidence} />
    </article>
  );
}
