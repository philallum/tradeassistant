/**
 * All_Pairs_Strip (Req 4.1–4.5, 4.7, 4.8, 12.6).
 *
 * Renders the {@link shapeAllPairsStrip} view model as five native `<button>` controls
 * (keyboard-focusable and Enter/Space-activatable for free). Every displayed value comes
 * verbatim from the view model; nothing is recomputed. The direction/status is conveyed by
 * a text label plus a glyph (never colour alone), the selected entry by `aria-pressed`, a
 * "Selected" text cue and a thicker border, and the focus indicator is an explicit outline.
 * Layout is a wrapping grid so five entries fit at 320 px with no horizontal scroll.
 */
import { useState } from "react";
import type { Pair } from "../api/types";
import { theme } from "../theme/darkTheme";
import type { AllPairsStripVM, StripEntryVM } from "../pure/shapeAllPairsStrip";

export interface AllPairsStripProps {
  readonly strip: AllPairsStripVM;
  readonly selectedPair: Pair;
  readonly onSelectPair: (pair: Pair) => void;
}

/** Non-colour cue per marker class (presentation only). */
const MARKER_GLYPH: Record<StripEntryVM["marker"], string> = {
  green: "\u25B2", // ▲
  red: "\u25BC", // ▼
  neutral: "\u25C6", // ◆
  conflict: "\u26A0", // ⚠
  none: "\u2205", // ∅
};

function markerColor(marker: StripEntryVM["marker"]): string {
  switch (marker) {
    case "green":
      return theme.semantic.success;
    case "red":
      return theme.semantic.danger;
    case "conflict":
      return theme.semantic.warning;
    default:
      return theme.semantic.neutral;
  }
}

function StripButton(props: {
  readonly entry: StripEntryVM;
  readonly selected: boolean;
  readonly onSelectPair: (pair: Pair) => void;
}): JSX.Element {
  const { entry, selected, onSelectPair } = props;
  const [focused, setFocused] = useState(false);
  const glyph = MARKER_GLYPH[entry.marker];
  // For a no-data entry, `scoreText` already holds the no-signal marker text.
  const summary = entry.hasData ? `${entry.statusLabel}, score ${entry.scoreText}` : entry.scoreText;

  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={`${entry.pair}: ${summary}${selected ? ", selected" : ""}`}
      onClick={() => onSelectPair(entry.pair)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      data-pair={entry.pair}
      data-has-data={entry.hasData ? "true" : "false"}
      style={{
        appearance: "none",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 2,
        minWidth: 0,
        minHeight: 44, // tap-target sizing
        padding: `${theme.spacing.sm}px`,
        textAlign: "left",
        background: selected ? theme.colors.surfaceRaised : theme.colors.surface,
        color: theme.colors.textPrimary,
        border: `${selected ? 3 : 1}px ${selected ? "double" : "solid"} ${
          selected ? theme.colors.accent : theme.colors.border
        }`,
        borderRadius: theme.radius.sm,
        outline: focused ? `3px solid ${theme.colors.accent}` : "none",
        outlineOffset: 2,
        fontSize: 13,
        overflowWrap: "anywhere",
      }}
    >
      <span style={{ fontWeight: 600 }}>
        {entry.pair}
        {selected ? " \u2713 Selected" : ""}
      </span>
      <span style={{ color: entry.hasData ? markerColor(entry.marker) : theme.colors.textMuted }}>
        <span aria-hidden="true">{glyph} </span>
        {entry.hasData ? entry.statusLabel : null}
      </span>
      <span style={{ color: theme.colors.textSecondary }}>{entry.scoreText}</span>
    </button>
  );
}

export function AllPairsStrip({ strip, selectedPair, onSelectPair }: AllPairsStripProps): JSX.Element {
  return (
    <div
      role="group"
      aria-label="All pairs"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(96px, 1fr))",
        gap: theme.spacing.sm,
        width: "100%",
        boxSizing: "border-box",
      }}
    >
      {strip.entries.map((entry) => (
        <StripButton
          key={entry.pair}
          entry={entry}
          selected={entry.pair === selectedPair}
          onSelectPair={onSelectPair}
        />
      ))}
    </div>
  );
}
