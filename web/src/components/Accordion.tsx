/**
 * A generic disclosure primitive for the single-window Master_Card's Context_Drawers
 * (Requirements 7.2, 7.3, 7.4, 12.4, 12.5, 12.6).
 *
 * A header `<button>` carries `aria-expanded` and `aria-controls` over a collapsible panel
 * that is `hidden` when collapsed. It is COLLAPSED BY DEFAULT. Being a native `<button>`,
 * it is a Tab stop and toggles on Enter and Space with no extra key handling.
 *
 * Presentation only: it holds one boolean and knows nothing about the content it wraps.
 *
 * Focus indicator: a `confluence-focusable` `:focus-visible` outline rule, injected once per
 * document under a fixed style id.
 */

import { useEffect, useId, useState, type JSX, type ReactNode } from "react";

import { theme } from "../theme/darkTheme";

export interface AccordionProps {
  /** The header text shown on the toggle button. */
  readonly title: string;
  /** Optional supporting line under the title. */
  readonly subtitle?: string;
  /** Whether the panel starts expanded. Defaults to collapsed (Req 7.2). */
  readonly defaultOpen?: boolean;
  /** Heading level wrapping the header button. Defaults to 3 (never an `h1`, Req 12.1). */
  readonly headingLevel?: 2 | 3 | 4;
  /** The panel body. Only mounted while expanded. */
  readonly children: ReactNode;
}

/** Same id and rule as `ConfluencePanel` so the pattern is shared, not duplicated per use. */
const FOCUS_STYLE_ID = "confluence-panel-focus-style";
const FOCUS_CSS = `
.confluence-focusable:focus-visible {
  outline: 2px solid ${theme.colors.accent};
  outline-offset: 2px;
  border-radius: ${theme.radius.sm}px;
}
`;

/** Install the `:focus-visible` rule once per document (idempotent). */
function useFocusVisibleStyle(): void {
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (document.getElementById(FOCUS_STYLE_ID) !== null) return;
    const el = document.createElement("style");
    el.id = FOCUS_STYLE_ID;
    el.textContent = FOCUS_CSS;
    document.head.appendChild(el);
  }, []);
}

/** Minimum tap target in px, matching the controls in `PairSelector`, `DateSelector` etc. */
const MIN_TAP_TARGET_PX = 44;

/** A caret that conveys open/closed by shape, not colour alone. */
function Caret({ open }: { readonly open: boolean }): JSX.Element {
  return (
    <span aria-hidden="true" style={{ display: "inline-block", width: "1em" }}>
      {open ? "▾" : "▸"}
    </span>
  );
}

export function Accordion({
  title,
  subtitle,
  defaultOpen = false,
  headingLevel = 3,
  children,
}: AccordionProps): JSX.Element {
  useFocusVisibleStyle();

  const [open, setOpen] = useState<boolean>(defaultOpen);
  const baseId = useId();
  const headerId = `${baseId}-header`;
  const panelId = `${baseId}-panel`;

  const Heading = `h${headingLevel}` as const;

  return (
    <section
      style={{
        background: theme.colors.surface,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: theme.radius.md,
        marginBottom: theme.spacing.md,
        overflow: "hidden",
      }}
    >
      <Heading style={{ margin: 0 }}>
        <button
          type="button"
          id={headerId}
          className="confluence-focusable"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((prev) => !prev)}
          style={{
            appearance: "none",
            width: "100%",
            textAlign: "left",
            cursor: "pointer",
            background: "transparent",
            color: theme.colors.textPrimary,
            border: "none",
            padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
            minHeight: MIN_TAP_TARGET_PX,
            display: "flex",
            alignItems: "center",
            gap: theme.spacing.sm,
            font: "inherit",
            fontSize: 15,
            fontWeight: 600,
          }}
        >
          <Caret open={open} />
          <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span>{title}</span>
            {subtitle !== undefined && (
              <span style={{ fontSize: 12, fontWeight: 400, color: theme.colors.textMuted }}>
                {subtitle}
              </span>
            )}
          </span>
        </button>
      </Heading>
      <div
        id={panelId}
        role="region"
        aria-labelledby={headerId}
        hidden={!open}
        style={{
          padding: open ? theme.spacing.md : 0,
          paddingTop: open ? theme.spacing.md : 0,
          borderTop: open ? `1px solid ${theme.colors.border}` : "none",
        }}
      >
        {open ? children : null}
      </div>
    </section>
  );
}
