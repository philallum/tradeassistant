/**
 * Zone 3 — Pair Confluence Matrix (Req 5, 6). A single-row rendering of the
 * `ConfluencePanel` grid semantics scoped to the selected pair's {@link RowVM}.
 *
 * Every displayed value (glyph, label, two-decimal strength, score, status, rationale) is
 * copied verbatim from the shaper output; nothing is recomputed here (Req 6.3, 6.4).
 *
 * Interaction model:
 *   - Roving tabindex: exactly one cell button is `tabIndex={0}` (Req 6.9).
 *   - Arrow / Home / End move FOCUS only via the pure `nextCell` (rowCount = 1,
 *     colCount = row.cells.length) and never change the pinned drawer (Req 6.8).
 *   - Click / Enter / Space pin a cell's rationale; re-activating it or using the dismiss
 *     control hides it; at most one drawer is open (Req 6.2, 6.5, 6.6). Escape dismisses
 *     (Req 6.10).
 *   - An unavailable cell stays focusable and activatable (it shows its reason).
 *
 * Honest presentation (Req 5.9): colour reinforcement only when `validated` is true;
 * otherwise a single neutral treatment, with meaning carried by text labels and glyphs.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type { CellVM, ColumnVM, RowVM } from "../pure/shapeConfluence";
import { nextCell } from "../pure/confluenceNav";
import { theme } from "../theme/darkTheme";

export interface PairConfluenceMatrixProps {
  /** The selected pair's row, or null when the pair has no confluence data. */
  readonly row: RowVM | null;
  /** The column headers (carry the `(display-only)` suffix for zero-weight strategies). */
  readonly columns: readonly ColumnVM[];
  /** The slice's `viewModel.validated`; colour is applied only when true. Defaults to false. */
  readonly validated?: boolean;
}

/** The neutral marker treatment used for every status while un-validated (Req 5.9). */
const NEUTRAL_MARKER_COLOR = theme.colors.textSecondary;

const FOCUS_STYLE_ID = "pair-confluence-matrix-focus-style";
const FOCUS_CSS = `
.pair-matrix-focusable:focus-visible {
  outline: 2px solid ${theme.colors.accent};
  outline-offset: 2px;
  border-radius: ${theme.radius.sm}px;
}
`;

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

function markerColor(marker: RowVM["marker"]): string {
  switch (marker) {
    case "green":
      return theme.direction.UP;
    case "red":
      return theme.direction.DOWN;
    case "conflict":
      return theme.semantic.warning;
    case "neutral":
      return theme.colors.textSecondary;
  }
}

export function PairConfluenceMatrix({
  row,
  columns,
  validated = false,
}: PairConfluenceMatrixProps): JSX.Element {
  useFocusVisibleStyle();

  const [focusIndex, setFocusIndex] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const buttonRefs = useRef<Map<number, HTMLButtonElement>>(new Map());
  const pendingFocus = useRef<number | null>(null);

  // A different pair is a different matrix: reset focus and any pinned drawer.
  const pair = row?.pair ?? null;
  useEffect(() => {
    setFocusIndex(0);
    setSelectedIndex(null);
  }, [pair]);

  useEffect(() => {
    const target = pendingFocus.current;
    if (target === null) return;
    pendingFocus.current = null;
    buttonRefs.current.get(target)?.focus();
  }, [focusIndex]);

  const colCount = row?.cells.length ?? 0;

  const handleKeyNav = useCallback(
    (index: number, key: string) => {
      const result = nextCell({ row: 0, col: index }, key, 1, colCount);
      if (result === null) return;
      if (result === "dismiss") {
        setSelectedIndex(null);
        return;
      }
      // Focus moves only; the pinned drawer is left unchanged (Req 6.8).
      pendingFocus.current = result.col;
      setFocusIndex(result.col);
    },
    [colCount],
  );

  const activate = useCallback((index: number) => {
    setFocusIndex(index);
    setSelectedIndex((prev) => (prev === index ? null : index));
  }, []);

  if (row === null) {
    return (
      <section
        aria-label="Strategy confluence"
        data-testid="pair-confluence-matrix"
        style={{ color: theme.colors.textSecondary, fontSize: 14 }}
      >
        <p style={{ margin: 0 }}>No confluence data for this pair.</p>
      </section>
    );
  }

  const headerFor = (cell: CellVM): ColumnVM | undefined =>
    columns.find((c) => c.strategyId === cell.strategyId);

  const statusColor = validated ? markerColor(row.marker) : NEUTRAL_MARKER_COLOR;
  const selectedCell = selectedIndex === null ? null : (row.cells[selectedIndex] ?? null);
  const selectedHeader = selectedCell === null ? undefined : headerFor(selectedCell);

  return (
    <section
      aria-label={`${row.pair} strategy confluence`}
      data-testid="pair-confluence-matrix"
      style={{
        background: theme.colors.surface,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: theme.radius.md,
        padding: theme.spacing.md,
        display: "flex",
        flexDirection: "column",
        gap: theme.spacing.sm,
        minWidth: 0,
        overflowX: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: theme.spacing.sm,
        }}
      >
        <span style={{ fontSize: 14, color: theme.colors.textSecondary }}>
          Confluence score{" "}
          <span
            data-testid="confluence-score"
            style={{ fontFamily: theme.font.mono, color: theme.colors.textPrimary, fontSize: 15 }}
          >
            {row.scoreText}
          </span>
        </span>
        <span
          data-testid="confluence-status"
          data-validated={validated ? "true" : "false"}
          style={{
            color: statusColor,
            fontWeight: row.stayFlat ? 700 : 500,
            fontSize: 14,
            ...(row.stayFlat
              ? {
                  border: `1px solid ${statusColor}`,
                  borderRadius: theme.radius.sm,
                  padding: `0 ${theme.spacing.xs}px`,
                }
              : {}),
          }}
        >
          {row.stayFlat ? row.markerText : row.statusLabel}
        </span>
      </div>

      <div
        role="group"
        aria-label={`${row.pair} strategy cells`}
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${row.cells.length}, minmax(0, 1fr))`,
          gap: theme.spacing.xs,
        }}
      >
        {row.cells.map((cell, index) => {
          const header = headerFor(cell);
          const isSelected = selectedIndex === index;
          const muted = cell.emphasis === "muted";
          return (
            <button
              key={cell.strategyId}
              type="button"
              ref={(el) => {
                if (el === null) buttonRefs.current.delete(index);
                else buttonRefs.current.set(index, el);
              }}
              className="pair-matrix-focusable"
              data-testid={`matrix-cell-${cell.strategyId}`}
              data-display-only={header?.displayOnly === true ? "true" : undefined}
              aria-label={cell.accessibleName}
              aria-pressed={isSelected}
              tabIndex={focusIndex === index ? 0 : -1}
              onClick={() => activate(index)}
              onKeyDown={(e) => {
                if (
                  e.key === "ArrowUp" ||
                  e.key === "ArrowDown" ||
                  e.key === "ArrowLeft" ||
                  e.key === "ArrowRight" ||
                  e.key === "Home" ||
                  e.key === "End" ||
                  e.key === "Escape"
                ) {
                  e.preventDefault();
                  handleKeyNav(index, e.key);
                }
              }}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 2,
                minWidth: 0,
                padding: theme.spacing.xs,
                cursor: "pointer",
                font: "inherit",
                fontSize: 11,
                textAlign: "center",
                overflowWrap: "anywhere",
                background: isSelected ? theme.colors.surfaceRaised : "transparent",
                border: isSelected
                  ? `1px solid ${theme.colors.accent}`
                  : `1px solid ${theme.colors.border}`,
                borderRadius: theme.radius.sm,
                color: muted ? theme.colors.textMuted : theme.colors.textPrimary,
              }}
            >
              <span style={{ color: theme.colors.textSecondary }}>
                {header?.header ?? cell.strategyId}
              </span>
              <span style={{ fontFamily: theme.font.mono, fontSize: 13 }}>
                <span aria-hidden="true">{cell.glyph}</span> {cell.directionLabel}
              </span>
              {cell.available ? (
                <span
                  data-testid={`matrix-strength-${cell.strategyId}`}
                  style={{ fontFamily: theme.font.mono, color: theme.colors.textSecondary }}
                >
                  {cell.strengthText}
                </span>
              ) : null}
              {cell.highlightLabel !== null ? (
                <span style={{ color: theme.semantic.warning }}>{cell.highlightLabel}</span>
              ) : null}
            </button>
          );
        })}
      </div>

      {/* Single pinned Rationale_Drawer, relocated under the cell row (Req 6.3–6.7). */}
      <section
        role="region"
        aria-live="polite"
        aria-label="Selected cell rationale"
        data-testid="rationale-drawer"
        style={{ minWidth: 0, overflowWrap: "anywhere" }}
      >
        {selectedCell !== null ? (
          <div
            data-testid="rationale-drawer-content"
            onKeyDown={(e) => {
              if (e.key === "Escape") setSelectedIndex(null);
            }}
            style={{
              padding: theme.spacing.sm,
              background: theme.colors.surfaceRaised,
              border: `1px solid ${theme.colors.border}`,
              borderRadius: theme.radius.sm,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: theme.spacing.sm,
              }}
            >
              <strong style={{ fontSize: 14, color: theme.colors.textPrimary }}>
                {row.pair} · {selectedHeader?.header ?? selectedCell.strategyId}
              </strong>
              <button
                type="button"
                className="pair-matrix-focusable"
                onClick={() => setSelectedIndex(null)}
                style={{
                  cursor: "pointer",
                  background: "transparent",
                  border: `1px solid ${theme.colors.border}`,
                  borderRadius: theme.radius.sm,
                  color: theme.colors.textSecondary,
                  fontSize: 12,
                  padding: `2px ${theme.spacing.sm}px`,
                }}
              >
                Dismiss
              </button>
            </div>
            <p
              style={{
                margin: `${theme.spacing.xs}px 0 0 0`,
                fontSize: 13,
                fontFamily: theme.font.mono,
                color: theme.colors.textPrimary,
              }}
            >
              <span aria-hidden="true">{selectedCell.glyph}</span> {selectedCell.directionLabel}
              {selectedCell.available ? ` ${selectedCell.strengthText}` : ""}
            </p>
            <p
              style={{
                margin: `${theme.spacing.xs}px 0 0 0`,
                fontSize: 14,
                color: theme.colors.textPrimary,
              }}
            >
              {selectedCell.detailText}
            </p>
          </div>
        ) : null}
      </section>
    </section>
  );
}
