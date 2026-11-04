/**
 * Zone 4 of the single-window Master_Card: exactly two collapsed-by-default Accordions
 * (Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 8.7).
 *
 *   - Daily AI note: verbatim `DailyNoteViewModel.text` when generated; an explicit
 *     placeholder when unavailable or absent; always labelled advisory and non-scoring.
 *   - Historical evidence: one `EvidenceVM` (the pair's own recent up/down base rate); an
 *     explicit placeholder when there is none. The header stays present and activatable.
 *
 * Raw sample counts live only inside the evidence drawer, which is collapsed by default, so
 * they never appear in the default view (Req 8.7). The drawer shows no stop-loss, take-profit
 * or expectancy figure. Each `Accordion` holds its own open state, so the two toggle
 * independently.
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
  /** The whole-day overview across all pairs (pair-independent) for the decision date. */
  readonly note: DailyNoteViewModel;
  /** The selected pair's own AI rationale, shown first. Omit to render the overview only. */
  readonly pairNote?: DailyNoteViewModel;
  /** The selected pair, used to label {@link pairNote}. */
  readonly pair?: string;
  /** The selected pair's evidence, or `null` when there is none. */
  readonly evidence: EvidenceVM | null;
}

const NOTE_UNAVAILABLE_TEXT = "AI commentary is unavailable for this run.";
const NO_EVIDENCE_TEXT = "No historical evidence is available for this pair.";

const bodyTextStyle = { margin: 0, fontSize: 14, color: theme.colors.textSecondary } as const;
const detailStyle = { color: theme.colors.textSecondary, marginTop: theme.spacing.xs } as const;

const sectionLabelStyle = {
  margin: `${theme.spacing.sm}px 0 ${theme.spacing.xs}px 0`,
  fontSize: 12,
  fontWeight: 600,
  color: theme.colors.textSecondary,
} as const;

function NoteText({
  note,
  unavailableText,
}: {
  readonly note: DailyNoteViewModel;
  readonly unavailableText: string;
}): JSX.Element {
  return note.status === "generated" && note.text !== null ? (
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
    <p style={bodyTextStyle}>{unavailableText}</p>
  );
}

function NoteBody({
  note,
  pairNote,
  pair,
}: {
  readonly note: DailyNoteViewModel;
  readonly pairNote?: DailyNoteViewModel;
  readonly pair?: string;
}): JSX.Element {
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
      {pairNote !== undefined && pair !== undefined ? (
        <>
          <p style={sectionLabelStyle} data-testid="pair-note-label">
            {pair}
          </p>
          <div data-testid="pair-note">
            <NoteText
              note={pairNote}
              unavailableText={`No AI note for ${pair} on this run (it only writes one for pairs that fired).`}
            />
          </div>
          <p style={sectionLabelStyle} data-testid="overview-note-label">
            All pairs, whole-day overview
          </p>
        </>
      ) : null}
      <NoteText note={note} unavailableText={NOTE_UNAVAILABLE_TEXT} />
    </div>
  );
}

const pct = (share: number): string => `${Math.round(share * 100)}%`;

function EvidenceBody({ evidence: e }: { readonly evidence: EvidenceVM | null }): JSX.Element {
  if (e === null || e.upShare === null || e.downShare === null) {
    return <p style={bodyTextStyle}>{NO_EVIDENCE_TEXT}</p>;
  }
  return (
    <div style={{ fontSize: 14, color: theme.colors.textPrimary }} data-testid="evidence-body">
      <strong>{e.pair}</strong>
      {" — "}
      {e.sampleCount} matured {e.horizon}-day outcome{e.sampleCount === 1 ? "" : "s"}: {pct(e.upShare)} went up,{" "}
      {pct(e.downShare)} went down.
      <div style={detailStyle}>
        This is the pair&apos;s own recent base rate, the coin-flip reference to hold any reading against.
      </div>
    </div>
  );
}

export function ContextDrawers({ note, pairNote, pair, evidence }: ContextDrawersProps): JSX.Element {
  return (
    <div data-testid="context-drawers">
      <Accordion title="Daily AI note" subtitle="Advisory">
        <NoteBody note={note} {...(pairNote !== undefined ? { pairNote } : {})} {...(pair !== undefined ? { pair } : {})} />
      </Accordion>
      <Accordion title="Historical evidence">
        <EvidenceBody evidence={evidence} />
      </Accordion>
    </div>
  );
}
