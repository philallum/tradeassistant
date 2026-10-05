/**
 * Persistent Pair_Selector (Req 8.1, 8.4, 8.6).
 *
 * Offers the five {@link PAIRS} plus the cross-pair "All pairs" option, defaulting to
 * "All pairs" (Req 8.1, 8.4). The value is read from and written to the shared
 * {@link useSelection} store, so the choice persists across Category_Tab navigation and is
 * mirrored into the URL query for deep-linking (Req 8.6, 1.6) — this component holds no
 * state of its own.
 *
 * Responsive affordance (Req 1.3, design "Selectors and persistence"): a **segmented
 * control** on wide viewports and a **dropdown** on narrow ones. Which to show is decided
 * by the injected `wide` flag (the parent computes it from a media query), so this
 * component stays a pure function of its props + the store and renders both forms without
 * reading the viewport itself.
 */

import { ALL_PAIRS, useSelection, type PairSelection } from "../state/selection";
import { PAIRS } from "../api/endpoints";
import { theme } from "../theme/darkTheme";

/** The ordered option list: the cross-pair overview first, then the five pairs. */
const OPTIONS: readonly { value: PairSelection; label: string }[] = [
  { value: ALL_PAIRS, label: "All pairs" },
  ...PAIRS.map((p) => ({ value: p as PairSelection, label: p })),
];

export interface PairSelectorProps {
  /** True on wide viewports → segmented control; false → dropdown (Req 1.3). */
  readonly wide: boolean;
}

export function PairSelector({ wide }: PairSelectorProps): JSX.Element {
  const { pair, setPair } = useSelection();

  if (!wide) {
    // Narrow viewport: a native <select> dropdown — compact and touch-friendly.
    return (
      <label style={{ display: "flex", flexDirection: "column", gap: theme.spacing.xs }}>
        <span style={{ fontSize: 12, color: theme.colors.textSecondary }}>Pair</span>
        <select
          aria-label="Currency pair"
          value={pair}
          onChange={(e) => setPair(e.target.value as PairSelection)}
          style={{
            background: theme.colors.surfaceRaised,
            color: theme.colors.textPrimary,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: theme.radius.sm,
            padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
            minHeight: 44, // tap-target sizing (Req 18.5)
            fontSize: 15,
          }}
        >
          {OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>
    );
  }

  // Wide viewport: a segmented control exposed as a radiogroup for assistive tech.
  return (
    <div
      role="radiogroup"
      aria-label="Currency pair"
      style={{
        display: "inline-flex",
        gap: 2,
        background: theme.colors.surface,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: theme.radius.md,
        padding: 2,
        overflow: "hidden",
      }}
    >
      {OPTIONS.map((opt) => {
        const selected = opt.value === pair;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => setPair(opt.value)}
            style={{
              appearance: "none",
              border: "none",
              cursor: "pointer",
              background: selected ? theme.colors.accent : "transparent",
              color: selected ? theme.colors.onAccent : theme.colors.textSecondary,
              borderRadius: theme.radius.sm,
              padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
              minHeight: 44, // tap-target sizing (Req 18.5)
              fontSize: 14,
              fontWeight: selected ? 600 : 500,
              whiteSpace: "nowrap",
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
