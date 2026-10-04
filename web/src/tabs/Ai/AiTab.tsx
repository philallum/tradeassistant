/**
 * AI Category_Tab (task 9.5) — inert, clearly-labeled, display-only AI rationale.
 *
 * This tab renders a pair's persisted `v_signal_rationale` content: the Signal_Rationale
 * narrative, the qualitative pattern-description (`analogue_labels`), and the advisory
 * Research_Proposals (`proposals`). Every value is drawn VERBATIM from the persisted row
 * via the pure {@link shapeAi} shaper — this tab recomputes nothing and never synthesizes
 * advisory text (Req 11.1, 20.1).
 *
 * Labeling (Req 11.2, 11.3): the whole section is framed as AI-generated / advisory /
 * non-scoring, and each proposal carries its own advisory, AI-generated label.
 *
 * Omit-when-absent (Req 11.4): when no rationale, labels, or proposals are persisted, the
 * shaper returns `present: false` and this tab omits the AI section entirely rather than
 * fabricating advisory text.
 *
 * Per-pair scope (Req 8.2): the AI content is per-pair. When "All pairs" is selected, this
 * tab prompts the viewer to pick a specific pair rather than guessing one.
 *
 * INERT RENDERING (Req 5.8): the LlmTagged rationale text, labels, and proposal text are
 * rendered as React text CHILDREN (auto-escaped) only. There is NO `dangerouslySetInnerHTML`
 * anywhere in this tab — the AI text is inert content, never executable markup.
 */

import { useEffect, useRef, useState } from "react";

import { fetchEndpoint, type ApiResult } from "../../api/client";
import type { Pair, SignalRationaleRow } from "../../api/endpoints";
import { shapeAi, type AiViewModel } from "../../pure/shapeAi.ts";
import { ALL_PAIRS, useSelection } from "../../state/selection";
import { theme } from "../../theme/darkTheme";

/**
 * Loader for a pair's AI rationale rows. Injected for testability; defaults to the real
 * same-origin `/ai-rationale` fetch through the api client.
 */
export type AiRationaleLoader = (
  args: { readonly decisionDate: string; readonly pair: Pair },
  options?: { readonly bustCache?: boolean; readonly signal?: AbortSignal },
) => Promise<ApiResult<SignalRationaleRow>>;

const defaultLoader: AiRationaleLoader = ({ decisionDate, pair }, options) =>
  fetchEndpoint("/ai-rationale", { decisionDate, pair }, options);

export interface AiTabProps {
  /**
   * The effective Decision_Date to query (the browsed date, or the resolved latest). The
   * shell resolves "null means latest"; this tab queries only when a concrete date exists.
   */
  readonly decisionDate: string | null;
  /** Bumped by the shell's refresh control; re-fetches with a cache-bypassing request. */
  readonly refreshNonce?: number;
  /** AI-rationale loader; defaults to the real `/ai-rationale` fetch. */
  readonly loadAiRationale?: AiRationaleLoader;
}

/** The three disjoint load states this tab can be in. */
type LoadState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "loaded"; readonly view: AiViewModel };

const sectionTextStyle = {
  color: theme.colors.textSecondary,
  margin: 0,
} as const;

/**
 * The fixed advisory banner shown above all AI content (Req 11.2). Rendered as plain React
 * text so it is unmissable and never confused for a scoring input.
 */
function AdvisoryBanner(): JSX.Element {
  return (
    <p
      role="note"
      style={{
        margin: 0,
        marginBottom: theme.spacing.md,
        padding: theme.spacing.sm,
        borderRadius: theme.radius.sm,
        border: `1px solid ${theme.semantic.warning}`,
        color: theme.semantic.warning,
        fontSize: 13,
      }}
    >
      AI-generated · advisory only · non-scoring. This narrative is not an input to any
      decision.
    </p>
  );
}

/** The "pick a pair" prompt shown when the Pair_Selector is on "All pairs" (Req 8.2). */
function PickPairPrompt(): JSX.Element {
  return (
    <p style={sectionTextStyle}>
      Select a specific currency pair to view its AI-generated rationale. AI content is
      shown per pair.
    </p>
  );
}

export function AiTab({
  decisionDate,
  refreshNonce = 0,
  loadAiRationale = defaultLoader,
}: AiTabProps): JSX.Element {
  const { pair } = useSelection();
  const [state, setState] = useState<LoadState>({ kind: "idle" });

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // The AI tab is per-pair: only fetch when a concrete pair AND a concrete date are known.
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
        const result = await loadAiRationale(
          { decisionDate, pair: activePair },
          {
            signal: controller.signal,
            ...(refreshNonce > 0 ? { bustCache: true } : {}),
          },
        );
        if (!mounted.current) return;
        setState({ kind: "loaded", view: shapeAi(result.rows) });
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        if (!mounted.current) return;
        const message =
          cause instanceof Error
            ? cause.message
            : "The AI rationale could not be loaded.";
        setState({ kind: "error", message });
      }
    })();

    return () => {
      controller.abort();
    };
  }, [activePair, decisionDate, refreshNonce, loadAiRationale]);

  return (
    <section
      role="tabpanel"
      id="tabpanel-ai"
      aria-labelledby="tab-ai"
      tabIndex={0}
      style={{ padding: theme.spacing.lg, color: theme.colors.textPrimary }}
    >
      <h2 style={{ color: theme.colors.textPrimary, marginTop: 0 }}>AI</h2>

      {activePair === null ? (
        <PickPairPrompt />
      ) : decisionDate === null ? (
        <p style={sectionTextStyle}>
          No Decision_Date is selected yet, so there is no AI content to show.
        </p>
      ) : state.kind === "loading" || state.kind === "idle" ? (
        <p style={sectionTextStyle} aria-busy="true">
          Loading AI rationale…
        </p>
      ) : state.kind === "error" ? (
        <p role="alert" style={{ ...sectionTextStyle, color: theme.semantic.danger }}>
          {state.message}
        </p>
      ) : state.view.present ? (
        <AiContent view={state.view} pair={activePair} />
      ) : (
        // Omit-when-absent (Req 11.4): no fabricated advisory text.
        <p style={sectionTextStyle}>
          No AI rationale was persisted for {activePair} on this date.
        </p>
      )}
    </section>
  );
}

/**
 * Render the labeled AI content for a present view model. Every string below is a React
 * text child (auto-escaped). No `dangerouslySetInnerHTML` is used anywhere.
 */
function AiContent({
  view,
  pair,
}: {
  readonly view: AiViewModel;
  readonly pair: Pair;
}): JSX.Element {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing.lg }}>
      <AdvisoryBanner />

      {view.rationaleText !== null && (
        <section aria-label={`AI rationale for ${pair}`}>
          <h3 style={{ color: theme.colors.textPrimary, marginTop: 0 }}>Rationale</h3>
          {/* Inert React text child — auto-escaped (Req 5.8). */}
          <p style={{ color: theme.colors.textPrimary, margin: 0, whiteSpace: "pre-wrap" }}>
            {view.rationaleText}
          </p>
        </section>
      )}

      {view.analogueLabels.length > 0 && (
        <section aria-label={`Pattern-description labels for ${pair}`}>
          <h3 style={{ color: theme.colors.textPrimary, marginTop: 0 }}>
            Pattern description
          </h3>
          <ul
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: theme.spacing.sm,
              listStyle: "none",
              padding: 0,
              margin: 0,
            }}
          >
            {view.analogueLabels.map((label, index) => (
              <li
                key={`${index}:${label}`}
                style={{
                  padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
                  borderRadius: theme.radius.sm,
                  border: `1px solid ${theme.colors.border}`,
                  background: theme.colors.surfaceRaised,
                  color: theme.colors.textSecondary,
                  fontSize: 13,
                }}
              >
                {/* Inert React text child — auto-escaped (Req 5.8). */}
                {label}
              </li>
            ))}
          </ul>
        </section>
      )}

      {view.proposals.length > 0 && (
        <section aria-label={`Research proposals for ${pair}`}>
          <h3 style={{ color: theme.colors.textPrimary, marginTop: 0 }}>
            Research proposals
          </h3>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {view.proposals.map((proposal) => (
              <li
                key={proposal.proposalId}
                style={{
                  marginBottom: theme.spacing.sm,
                  padding: theme.spacing.md,
                  borderRadius: theme.radius.md,
                  border: `1px solid ${theme.colors.border}`,
                  background: theme.colors.surface,
                }}
              >
                <p
                  style={{
                    margin: 0,
                    marginBottom: theme.spacing.xs,
                    fontSize: 12,
                    color: theme.semantic.warning,
                  }}
                >
                  {/* Per-proposal advisory label (Req 11.3). Inert text child. */}
                  Advisory · AI-generated proposal · {proposal.kind}
                </p>
                {/* Inert React text child — auto-escaped (Req 5.8). */}
                <p
                  style={{
                    margin: 0,
                    color: theme.colors.textPrimary,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {proposal.proposalText}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
