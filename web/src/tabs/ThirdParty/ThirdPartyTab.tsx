/**
 * Third-party Category_Tab (task 9.5) — inert, research-only external-provider comparison.
 *
 * This tab renders a pair's persisted `v_external_reference_comparison` content: the
 * system's own Direction_Class shown next to the provider's reference direction, and the
 * Reference_Comparison (`agree` / `diverge` / `neutral` / `unavailable`). Every value is
 * drawn VERBATIM from the persisted row via the pure {@link shapeExternal} shaper — this
 * tab recomputes nothing and never fabricates a reference (Req 12.1, 20.1).
 *
 * Labeling (Req 12.2): the whole section is framed as research-only — explicitly never an
 * input to any decision.
 *
 * Reference-unavailable (Req 12.3): when the persisted comparison is `unavailable` the
 * shaper sets `referenceUnavailable`, and this tab shows an explicit "reference
 * unavailable" marker as a NON-error display state rather than an error or a made-up
 * reference direction.
 *
 * Per-pair scope (Req 8.2): the comparison is per-pair. When "All pairs" is selected, this
 * tab prompts the viewer to pick a specific pair rather than guessing one.
 *
 * INERT RENDERING (Req 5.8): the provider name and all third-party-sourced text are
 * rendered as React text CHILDREN (auto-escaped) only. There is NO `dangerouslySetInnerHTML`
 * anywhere in this tab — the third-party text is inert content, never executable markup.
 */

import { useEffect, useRef, useState } from "react";

import { fetchEndpoint, type ApiResult } from "../../api/client";
import type { ExternalReferenceComparisonRow, Pair } from "../../api/endpoints";
import {
  shapeExternal,
  type Comparison,
  type ExternalViewModel,
  type OwnDirection,
  type ReferenceDirection,
} from "../../pure/shapeExternal.ts";
import { ALL_PAIRS, useSelection } from "../../state/selection";
import { theme } from "../../theme/darkTheme";

/**
 * Loader for a pair's external-comparison rows. Injected for testability; defaults to the
 * real same-origin `/external-comparison` fetch through the api client.
 */
export type ExternalComparisonLoader = (
  args: { readonly decisionDate: string; readonly pair: Pair },
  options?: { readonly bustCache?: boolean; readonly signal?: AbortSignal },
) => Promise<ApiResult<ExternalReferenceComparisonRow>>;

const defaultLoader: ExternalComparisonLoader = ({ decisionDate, pair }, options) =>
  fetchEndpoint("/external-comparison", { decisionDate, pair }, options);

export interface ThirdPartyTabProps {
  /** The effective Decision_Date to query (the browsed date, or the resolved latest). */
  readonly decisionDate: string | null;
  /** Bumped by the shell's refresh control; re-fetches with a cache-bypassing request. */
  readonly refreshNonce?: number;
  /** External-comparison loader; defaults to the real `/external-comparison` fetch. */
  readonly loadExternalComparison?: ExternalComparisonLoader;
}

type LoadState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "loaded"; readonly view: ExternalViewModel };

const sectionTextStyle = {
  color: theme.colors.textSecondary,
  margin: 0,
} as const;

/** Map the system's own Direction_Class to a human label (display only, verbatim mapping). */
function ownDirectionLabel(direction: OwnDirection | null): string {
  if (direction === null) return "—";
  switch (direction) {
    case "UP":
      return "Up";
    case "DOWN":
      return "Down";
    case "FLAT":
      return "Flat";
  }
}

/** Map the provider's reference direction to a human label (display only, verbatim). */
function referenceDirectionLabel(direction: ReferenceDirection | null): string {
  if (direction === null) return "—";
  switch (direction) {
    case "BUY":
      return "Buy";
    case "SELL":
      return "Sell";
    case "HOLD":
      return "Hold";
  }
}

/** Map the Reference_Comparison enum to a human label (display only, verbatim). */
function comparisonLabel(comparison: Comparison | null): string {
  if (comparison === null) return "—";
  switch (comparison) {
    case "agree":
      return "Agree";
    case "diverge":
      return "Diverge";
    case "neutral":
      return "Neutral";
    case "unavailable":
      return "Reference unavailable";
  }
}

/** The fixed research-only banner shown above the comparison (Req 12.2). */
function ResearchOnlyBanner(): JSX.Element {
  return (
    <p
      role="note"
      style={{
        margin: 0,
        marginBottom: theme.spacing.md,
        padding: theme.spacing.sm,
        borderRadius: theme.radius.sm,
        border: `1px solid ${theme.semantic.info}`,
        color: theme.semantic.info,
        fontSize: 13,
      }}
    >
      Research-only context. The third-party comparison is never an input to any decision.
    </p>
  );
}

/** The "pick a pair" prompt shown when the Pair_Selector is on "All pairs" (Req 8.2). */
function PickPairPrompt(): JSX.Element {
  return (
    <p style={sectionTextStyle}>
      Select a specific currency pair to view its third-party comparison. The comparison is
      shown per pair.
    </p>
  );
}

export function ThirdPartyTab({
  decisionDate,
  refreshNonce = 0,
  loadExternalComparison = defaultLoader,
}: ThirdPartyTabProps): JSX.Element {
  const { pair } = useSelection();
  const [state, setState] = useState<LoadState>({ kind: "idle" });

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const activePair: Pair | null = pair === ALL_PAIRS ? null : pair;

  useEffect(() => {
    if (activePair === null || decisionDate === null) {
      setState({ kind: "idle" });
      return;
    }

    const controller = new AbortController();
    setState({ kind: "loading" });

    void (async () => {
      try {
        const result = await loadExternalComparison(
          { decisionDate, pair: activePair },
          {
            signal: controller.signal,
            ...(refreshNonce > 0 ? { bustCache: true } : {}),
          },
        );
        if (!mounted.current) return;
        setState({ kind: "loaded", view: shapeExternal(result.rows) });
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        if (!mounted.current) return;
        const message =
          cause instanceof Error
            ? cause.message
            : "The third-party comparison could not be loaded.";
        setState({ kind: "error", message });
      }
    })();

    return () => {
      controller.abort();
    };
  }, [activePair, decisionDate, refreshNonce, loadExternalComparison]);

  return (
    <section
      role="tabpanel"
      id="tabpanel-third-party"
      aria-labelledby="tab-third-party"
      tabIndex={0}
      style={{ padding: theme.spacing.lg, color: theme.colors.textPrimary }}
    >
      <h2 style={{ color: theme.colors.textPrimary, marginTop: 0 }}>Third-party</h2>

      {activePair === null ? (
        <PickPairPrompt />
      ) : decisionDate === null ? (
        <p style={sectionTextStyle}>
          No Decision_Date is selected yet, so there is no comparison to show.
        </p>
      ) : state.kind === "loading" || state.kind === "idle" ? (
        <p style={sectionTextStyle} aria-busy="true">
          Loading third-party comparison…
        </p>
      ) : state.kind === "error" ? (
        <p role="alert" style={{ ...sectionTextStyle, color: theme.semantic.danger }}>
          {state.message}
        </p>
      ) : state.view.present ? (
        <ThirdPartyContent view={state.view} pair={activePair} />
      ) : (
        <p style={sectionTextStyle}>
          No third-party comparison was persisted for {activePair} on this date.
        </p>
      )}
    </section>
  );
}

/**
 * Render the labeled, research-only comparison for a present view model. All provider text
 * is rendered as React text children (auto-escaped). No `dangerouslySetInnerHTML` is used.
 */
function ThirdPartyContent({
  view,
  pair,
}: {
  readonly view: ExternalViewModel;
  readonly pair: Pair;
}): JSX.Element {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing.lg }}>
      <ResearchOnlyBanner />

      <section aria-label={`Direction comparison for ${pair}`}>
        <dl
          style={{
            display: "grid",
            gridTemplateColumns: "auto 1fr",
            gap: `${theme.spacing.xs}px ${theme.spacing.md}px`,
            margin: 0,
          }}
        >
          <dt style={{ color: theme.colors.textSecondary }}>Our direction</dt>
          <dd style={{ margin: 0, color: theme.colors.textPrimary }}>
            {ownDirectionLabel(view.ownDirection)}
          </dd>

          <dt style={{ color: theme.colors.textSecondary }}>
            Provider reference
          </dt>
          <dd style={{ margin: 0, color: theme.colors.textPrimary }}>
            {view.referenceUnavailable
              ? "—"
              : referenceDirectionLabel(view.referenceDirection)}
          </dd>

          {view.provider !== null && (
            <>
              <dt style={{ color: theme.colors.textSecondary }}>Provider</dt>
              {/* Inert React text child — auto-escaped (Req 5.8). */}
              <dd style={{ margin: 0, color: theme.colors.textPrimary }}>
                {view.provider}
              </dd>
            </>
          )}

          {view.referenceScore !== null && !view.referenceUnavailable && (
            <>
              <dt style={{ color: theme.colors.textSecondary }}>Reference score</dt>
              <dd style={{ margin: 0, color: theme.colors.textPrimary }}>
                {view.referenceScore}
              </dd>
            </>
          )}

          <dt style={{ color: theme.colors.textSecondary }}>Comparison</dt>
          <dd style={{ margin: 0, color: theme.colors.textPrimary }}>
            {comparisonLabel(view.comparison)}
          </dd>
        </dl>
      </section>

      {view.referenceUnavailable && (
        // Explicit non-error "reference unavailable" marker (Req 12.3).
        <p
          role="note"
          style={{
            margin: 0,
            padding: theme.spacing.sm,
            borderRadius: theme.radius.sm,
            border: `1px solid ${theme.colors.border}`,
            background: theme.colors.surface,
            color: theme.colors.textSecondary,
          }}
        >
          Reference unavailable — the provider did not supply a reference direction for{" "}
          {pair} on this date. This is a normal state, not an error.
        </p>
      )}
    </div>
  );
}
