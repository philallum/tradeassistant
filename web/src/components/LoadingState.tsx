/**
 * Shared, mobile-friendly loading state (task 9.6; Req 2.3, 14.3, 17.4).
 *
 * Every in-flight Read_Proxy fetch — including a refresh (Req 17.4) — must show a loading
 * state rather than a blank screen (Req 2.3, 14.3). This is the single reusable, presentational
 * loading region the shell and tabs can mount so that behavior is consistent everywhere.
 *
 * It is a pure view component: it holds no fetch logic and recomputes nothing. It announces
 * itself to assistive technology with `role="status"` + `aria-live="polite"` and
 * `aria-busy="true"` so a screen reader hears the in-flight state, and it never collapses to
 * zero height (it always renders visible text), so the viewport is never blank while loading.
 */

import type { JSX } from "react";

import { theme } from "../theme/darkTheme";

export interface LoadingStateProps {
  /** The message to show while loading. Defaults to a generic "Loading…". */
  readonly label?: string;
}

export function LoadingState({ label = "Loading…" }: LoadingStateProps): JSX.Element {
  return (
    <p
      role="status"
      aria-live="polite"
      aria-busy="true"
      style={{
        margin: 0,
        padding: `${theme.spacing.lg}px ${theme.spacing.md}px`,
        color: theme.colors.textSecondary,
        fontSize: 15,
      }}
    >
      {label}
    </p>
  );
}
