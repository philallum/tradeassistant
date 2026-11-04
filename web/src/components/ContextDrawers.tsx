/**
 * Zone 4 of the single-window Master_Card: exactly two collapsed-by-default Accordions
 * (Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 8.7).
 *
 *   - Daily AI note: verbatim `DailyNoteViewModel.text` when generated; an explicit
 *     placeholder when unavailable or absent; always labelled advisory and non-scoring.
 *   - Historical evidence: one `EvidenceVM`, the same fields `EvidencePanel` renders; an
 *     explicit placeholder when there is none. The header stays present and activatable.
 *
 * Raw sample counts (analogue tallies, simulated-trade counts) live only inside the
 * evidence drawer, which is collapsed by default, so they never appear in the default view
 * (Req 8.7). Each `Accordion` holds its own open state, so the two toggle independently.
 *
 * Presentation only: values are rendered as given by the pure shapers; nothing is
 * recomputed. The note is a React text child (auto-escaped); no `dangerouslySetInnerHTML`.
 */

import type { JSX } from "react";

import type { DailyNoteViewModel } from "../pure/shapeDailyNote";
import type { EvidenceVM } from "../pure/shapeEvidence";
import { theme } from "../theme/darkTheme";
import { Accordion } from "./Accordion";

export interface ContextDrawersProps {
  /** The shaped daily note for the selected pair's decision date. */
  readonly note: DailyNoteViewModel;
  /** The selected pair's evidence, or `null` when there is none. */
  readonly evidence: EvidenceVM | null;
}

const NOTE_UNAVAILABLE_TEXT = "AI commentary is unavailable for this run.";
const NO_EVIDENCE_TEXT = "No historical evidence is available for this pair.";

const bodyTextStyle = { margin: 0, fontSize: 14, color: theme.colors.textSecondary } as const;
const detailStyle = { color: theme.colors.textSecondary, marginTop: theme.spacing.xs } as const;

function NoteBody({ note }: { readonly note: DailyNoteViewModel }): JSX.Element {
  return (
    <div>
      <p
        role="note"
        style={{
          margin: `0 0 ${theme.spacing.sm}px 0`,
          fontSize: 12,
          color: theme.semantic.warning,
        }}
      >
        AI-generated · advisory and non-scoring.
      </p>
      {note.status === "generated" && note.text !== null ? (
        <p
          style={{
            margin: 0,
            fontSize: 15,
            color: theme.colors.textPrimary,
            whiteSpace: "pre-wrap",
          }}
        >
          {note.text}
        </p>
      ) : (
        <p style={bodyTextStyle}>{NOTE_UNAVAILABLE_TEXT}</p>
      )}
    </div>
  );
}

function EvidenceBody({ evidence: e }: { readonly evidence: EvidenceVM | null }): JSX.Element {
  if (e === null) {
    return <p style={bodyTextStyle}>{NO_EVIDENCE_TEXT}</p>;
  }
  return (
    <div style={{ fontSize: 14, color: theme.colors.textPrimary }} data-testid="evidence-body">
      <strong>{e.pair}</strong>
      {" — "}
      {e.analogueCount} matured analogue{e.analogueCount === 1 ? "" : "s"} ({e.horizon}d horizon)
      {e.analogueCount > 0 && e.classifiable ? (
        <div style={detailStyle}>
          Reached target only: {e.targetOnly} · stop only: {e.stopOnly} · both (order
          unresolved): {e.ambiguous} · neither: {e.neither}
        </div>
      ) : null}
      {e.analogueCount > 0 && !e.classifiable ? (
        <div style={detailStyle}>
          No stop/target on this setup, so outcomes are not classified.
        </div>
      ) : null}
      {e.ledger !== null ? (
        <div style={detailStyle}>
          Simulated trades: {e.ledger.tradeCount} · win rate {Math.round(e.ledger.winRate * 100)}%
          · ambiguous {Math.round(e.ledger.ambiguousShare * 100)}% · expired{" "}
          {Math.round(e.ledger.expiredShare * 100)}%
        </div>
      ) : (
        <div style={detailStyle}>Simulated trade outcomes not yet measured.</div>
      )}
    </div>
  );
}

export function ContextDrawers({ note, evidence }: ContextDrawersProps): JSX.Element {
  return (
    <div data-testid="context-drawers">
      <Accordion title="Daily AI note" subtitle="Advisory">
        <NoteBody note={note} />
      </Accordion>
      <Accordion title="Historical evidence">
        <EvidenceBody evidence={evidence} />
      </Accordion>
    </div>
  );
}
