/**
 * The daily AI commentary note for the Setups tab (schema v3).
 *
 * A short, pair-independent plain-language summary of the day's scan, produced every trading
 * day (fired or not). It doubles as an LLM-path LIVENESS SIGNAL: a generated note confirms
 * the AI layer actually ran, so a silent day no longer looks identical to a broken/absent
 * run. The text is drawn VERBATIM from the pure {@link shapeDailyNote} view model — this
 * component recomputes nothing and never fabricates advisory text.
 *
 * States:
 *   - "generated"   → render the note under the advisory banner.
 *   - "unavailable" → render an explicit "AI commentary unavailable for this run" marker
 *                     (the run completed but the AI layer produced no note), never fabricated.
 *   - "absent"      → render nothing (older snapshot with no commentary slice).
 *
 * Labeling (mirrors the AI tab, Req 11.2): the whole block is framed AI-generated / advisory
 * / non-scoring. INERT rendering (Req 5.8): the note is a React text child (auto-escaped);
 * there is NO `dangerouslySetInnerHTML`.
 */

import type { DailyNoteViewModel } from "../../pure/shapeDailyNote";
import { theme } from "../../theme/darkTheme";

export interface DailyNoteProps {
  /** The shaped daily-note view model (verbatim text or an explicit non-generated state). */
  readonly note: DailyNoteViewModel;
}

export function DailyNote({ note }: DailyNoteProps): JSX.Element | null {
  if (note.status === "absent") {
    return null;
  }

  return (
    <section
      aria-labelledby="daily-note-heading"
      style={{
        marginBottom: theme.spacing.lg,
        padding: theme.spacing.md,
        borderRadius: theme.radius.md,
        border: `1px solid ${theme.colors.border}`,
        background: theme.colors.surface,
      }}
    >
      <h3
        id="daily-note-heading"
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: theme.colors.textPrimary,
          margin: `0 0 ${theme.spacing.sm}px 0`,
        }}
      >
        Daily AI note
      </h3>

      {/* Advisory label (mirrors the AI tab banner): AI-generated, non-scoring. */}
      <p
        role="note"
        style={{
          margin: `0 0 ${theme.spacing.sm}px 0`,
          fontSize: 12,
          color: theme.semantic.warning,
        }}
      >
        AI-generated · advisory only · non-scoring.
      </p>

      {note.status === "generated" ? (
        // Inert React text child — auto-escaped (Req 5.8). Live region so a refresh is announced.
        <p
          role="status"
          aria-live="polite"
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
        // "unavailable": the run completed but the AI layer produced no note this run.
        <p style={{ margin: 0, fontSize: 14, color: theme.colors.textSecondary }}>
          AI commentary is unavailable for this run.
        </p>
      )}
    </section>
  );
}
