/**
 * Shared empty state (task 9.6; Req 7.4, 8.7, 14.1).
 *
 * A single reusable, presentational region for the "nothing to show, and that's fine"
 * cases — distinct from an error so the viewer can tell "no data yet" apart from
 * "something broke" (Req 14 user story). The exact copy is supplied by the caller so the
 * same component serves every empty case with the right wording:
 *
 *   - "No runs have been persisted yet." — empty Decision_Date set (Req 14.1)
 *   - "No data for this date."           — selected date has no rows (Req 7.4)
 *   - "No data for {pair} on this date." — a pair has nothing of its own (Req 8.7)
 *
 * This is a pure view component: it holds no fetch logic and recomputes nothing. It is NOT
 * an error (no `role="alert"`); it is ordinary informational text so assistive technology
 * does not announce it as a failure.
 */

import type { JSX } from "react";

import { theme } from "../theme/darkTheme";

export interface EmptyStateProps {
  /** The non-secret, human-readable message describing what is empty. */
  readonly message: string;
}

export function EmptyState({ message }: EmptyStateProps): JSX.Element {
  return (
    <p
      style={{
        margin: 0,
        padding: `${theme.spacing.lg}px ${theme.spacing.md}px`,
        color: theme.colors.textSecondary,
        fontSize: 15,
      }}
    >
      {message}
    </p>
  );
}
