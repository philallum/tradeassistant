/**
 * Accessible expand/collapse Accordion_Section used WITHIN the Pattern & Outcomes tab to
 * disclose each chart as secondary detail rather than one long scrolling page (Req 16.3).
 *
 * Each section is a header `<button>` controlling a region: the button carries
 * `aria-expanded` and `aria-controls`, the region is labelled back by the header via
 * `aria-labelledby`, so the control is operable by keyboard and assistive technology with
 * correct roles and accessible labels (Req 16.5). The fuller a11y assertions land in task
 * 9.8; this provides the correct ARIA wiring they rely on.
 *
 * The component is uncontrolled by default (manages its own open state) but accepts an
 * optional `defaultOpen` so the first section can start expanded. It is placed inside
 * `tabs/PatternOutcomes/` deliberately to stay within this task's file scope.
 */

import { useId, useState, type JSX, type ReactNode } from "react";

import { theme } from "../../theme/darkTheme";

export interface AccordionProps {
  /** The section heading shown on the toggle button. */
  readonly title: string;
  /** Optional supporting line shown under the title (e.g. the source view). */
  readonly subtitle?: string;
  /** Whether the section starts expanded. Defaults to collapsed. */
  readonly defaultOpen?: boolean;
  /** The section body — a chart + its text/table equivalent. */
  readonly children: ReactNode;
}

/** A caret glyph that also conveys open/closed by shape, not color alone (Req 18.3). */
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
  children,
}: AccordionProps): JSX.Element {
  const [open, setOpen] = useState<boolean>(defaultOpen);
  const baseId = useId();
  const headerId = `${baseId}-header`;
  const regionId = `${baseId}-region`;

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
      <h3 style={{ margin: 0 }}>
        <button
          type="button"
          id={headerId}
          aria-expanded={open}
          aria-controls={regionId}
          onClick={() => setOpen((prev) => !prev)}
          style={{
            appearance: "none",
            width: "100%",
            textAlign: "left",
            cursor: "pointer",
            background: "transparent",
            color: theme.colors.textPrimary,
            border: "none",
            padding: theme.spacing.md,
            minHeight: 48, // comfortable mobile tap target (Req 18.5)
            display: "flex",
            alignItems: "center",
            gap: theme.spacing.sm,
            fontSize: 15,
            fontWeight: 600,
          }}
        >
          <Caret open={open} />
          <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span>{title}</span>
            {subtitle !== undefined && (
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 400,
                  color: theme.colors.textMuted,
                }}
              >
                {subtitle}
              </span>
            )}
          </span>
        </button>
      </h3>
      <div
        id={regionId}
        role="region"
        aria-labelledby={headerId}
        hidden={!open}
        style={{
          padding: open ? theme.spacing.md : 0,
          paddingTop: 0,
          borderTop: open ? `1px solid ${theme.colors.border}` : "none",
        }}
      >
        {open && children}
      </div>
    </section>
  );
}
