/**
 * Shared non-secret error state (task 9.6; Req 14.2, 17.5).
 *
 * When a Read_Proxy request (including a refresh) fails, the dashboard must show a
 * non-secret error message — never a stack trace, raw payload, or blank screen (Req 14.2,
 * 17.5). This is the single reusable, presentational error region the shell and tabs mount
 * for that case.
 *
 * The caller passes an already-sanitized message. The api client (`api/client.ts`) only ever
 * throws fixed, credential-free {@link ApiError} strings, so the message reaching this
 * component carries no credential, no response body, and no stack trace. As a defensive
 * backstop this component falls back to a generic message if an empty string is passed, so a
 * blank screen is impossible even on an unexpected input.
 *
 * It announces itself with `role="alert"` so assistive technology surfaces the failure
 * promptly, and (when `onRetry` is supplied) offers an inline retry affordance so a transient
 * failure can be recovered without a full page reload (supports Req 17.5's "recover on
 * failure" posture).
 */

import type { JSX } from "react";

import { theme } from "../theme/darkTheme";

export interface ErrorStateProps {
  /** The non-secret, human-readable error message to display. */
  readonly message: string;
  /** Optional retry handler; when provided an inline "Try again" button is shown. */
  readonly onRetry?: () => void;
}

/** The fixed fallback shown if an empty message is ever passed, so the screen is never blank. */
const FALLBACK_MESSAGE = "Something went wrong while loading the data.";

export function ErrorState({ message, onRetry }: ErrorStateProps): JSX.Element {
  const text = message.length > 0 ? message : FALLBACK_MESSAGE;
  return (
    <div
      role="alert"
      style={{
        margin: 0,
        padding: `${theme.spacing.lg}px ${theme.spacing.md}px`,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: theme.spacing.md,
      }}
    >
      <p style={{ margin: 0, color: theme.semantic.danger, fontSize: 15 }}>{text}</p>
      {onRetry !== undefined && (
        <button
          type="button"
          onClick={onRetry}
          style={{
            appearance: "none",
            cursor: "pointer",
            background: theme.colors.surfaceRaised,
            color: theme.colors.textPrimary,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: theme.radius.sm,
            padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
            minHeight: 44, // tap-target sizing (Req 18.5)
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          Try again
        </button>
      )}
    </div>
  );
}
