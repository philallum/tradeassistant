/**
 * All_Pairs_Strip — the dashboard's ONLY pair navigator.
 *
 * Renders the {@link shapeAllPairsStrip} view model as five native `<button>` controls
 * (keyboard-focusable and Enter/Space-activatable for free). Each shows the pair, its
 * conviction tier ("Aligned up", "Lean down", "Split", "No view") with a glyph, and the vote
 * tally behind it. Every value comes verbatim from the view model; nothing is recomputed.
 *
 * Honest presentation: the system is un-validated, so no direction colour is applied. The tier
 * is carried by its word plus a glyph, never by colour, and a Split gets a heavier border so it
 * stands out without implying a trade. The selected entry is shown by `aria-pressed`, a
 * "Selected" text cue and a thicker border; the focus indicator is an explicit outline. Layout
 * is a wrapping grid so five entries fit at 320 px with no horizontal scroll.
 */
import { useState } from "react";
import type { JSX } from "react";

import type { Pair } from "../api/types";
import { theme } from "../theme/darkTheme";
import type { AllPairsStripVM, StripEntryVM } from "../pure/shapeAllPairsStrip";

export interface AllPairsStripProps {
  readonly strip: AllPairsStripVM;
  readonly selectedPair: Pair;
  readonly onSelectPair: (pair: Pair) => void;
}

function StripButton(props: {
  readonly entry: StripEntryVM;
  readonly selected: boolean;
  readonly onSelectPair: (pair: Pair) => void;
}): JSX.Element {
  const { entry, selected, onSelectPair } = props;
  const [focused, setFocused] = useState(false);
  // For a no-data entry, `tallyText` already holds the no-signal marker text.
  const summary = entry.hasData ? `${entry.label}, ${entry.tallyText}` : entry.tallyText;
  const split = entry.tier === "SPLIT";

  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={`${entry.pair}: ${summary}${selected ? ", selected" : ""}`}
      onClick={() => onSelectPair(entry.pair)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      data-pair={entry.pair}
      data-tier={entry.tier}
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
        border: `${selected ? 3 : split ? 2 : 1}px ${selected ? "double" : "solid"} ${
          selected ? theme.colors.accent : split ? theme.colors.textMuted : theme.colors.border
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
      <span style={{ color: entry.hasData ? theme.colors.textPrimary : theme.colors.textMuted }}>
        <span aria-hidden="true">{entry.glyph} </span>
        {entry.hasData ? entry.label : null}
      </span>
      <span style={{ color: theme.colors.textSecondary, fontSize: 12 }}>{entry.tallyText}</span>
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
        gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
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
