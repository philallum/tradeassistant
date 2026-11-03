/**
 * The Confluence_Panel (task 23.1 — Requirements 12, 14).
 *
 * Renders the per-run Confluence_Matrix the pure {@link shapeConfluence} shaper produces: a
 * `summary` line (the Confluence_Summary counts, Req 12.17) above a `<table role="grid">`
 * with a `<caption>`, one `<th scope="col">` per Strategy_Id, one `<th scope="row">` per
 * Pair, and one `<button>` per cell. Every rendered value is drawn verbatim from the view
 * model; this component recomputes nothing (Req 9.10, 20.1) and shapes nothing (the shaper
 * is the single source of display truth — Req 12.13).
 *
 * Interaction model (Req 12.5, 12.10):
 *   - The grid is a single tab stop with ROVING `tabIndex`: exactly one cell button is
 *     `tabIndex={0}` at a time, every other is `tabIndex={-1}`. Tab/Shift+Tab enter and leave
 *     the grid as one unit.
 *   - Arrow keys / Home / End move FOCUS between cells via the pure {@link nextCell} helper
 *     WITHOUT selecting — exploring the grid never hides a pinned rationale.
 *   - Click / Enter / Space (native `<button>` activation) SELECT a cell and pin its
 *     rationale in the detail region, which renders synchronously (well within 200 ms).
 *   - Escape, the Dismiss button, dismiss the pinned rationale.
 *
 * Honest presentation (Req 14): the green / red / neutral / conflict colour treatment is
 * applied ONLY when `viewModel.validated` is true. While un-validated (the shipping state)
 * every status marker uses ONE neutral treatment; meaning is carried by `markerText` /
 * `statusLabel` and the distinct "Stay Flat" marker — suppressing colour never suppresses
 * meaning (Req 14.1, 14.2, 14.3).
 *
 * This is pure presentation: it imports NOTHING from the backend `src/`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { CellVM, ConfluenceViewModel, GaugeVM, RowVM } from "../../pure/shapeConfluence";
import { nextCell, type Pos } from "../../pure/confluenceNav";
import { theme } from "../../theme/darkTheme";

export interface ConfluencePanelProps {
  /** The display-only view model from the pure `shapeConfluence` shaper. */
  readonly viewModel: ConfluenceViewModel;
}

/** A single, injected-once stylesheet for the one thing inline styles cannot express: the
 * `:focus-visible` outline required on every focusable control (Req 12.10). */
const FOCUS_STYLE_ID = "confluence-panel-focus-style";
const FOCUS_CSS = `
.confluence-focusable:focus-visible {
  outline: 2px solid ${theme.colors.accent};
  outline-offset: 2px;
  border-radius: ${theme.radius.sm}px;
}
`;

/** Install the `:focus-visible` rule once per document (idempotent across every instance). */
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

/** The neutral marker treatment used for EVERY status while un-validated (Req 14.1). */
const NEUTRAL_MARKER_COLOR = theme.colors.textSecondary;

/** The colour per marker class, applied ONLY when the slice is validated (Req 12.3, 14.3). */
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

/** The validation label + the "Strength is not a probability" note. Rendered in BOTH the
 * panel header and the detail region — the two regions where strengths / scores appear
 * (Req 12.8). */
function ValidationNote({ viewModel }: { viewModel: ConfluenceViewModel }): JSX.Element {
  return (
    <p
      style={{
        margin: `${theme.spacing.xs}px 0`,
        fontSize: 12,
        color: theme.colors.textSecondary,
      }}
    >
      <span
        style={{
          display: "inline-block",
          padding: `1px ${theme.spacing.xs}px`,
          borderRadius: theme.radius.sm,
          border: `1px solid ${theme.colors.border}`,
          color: theme.semantic.warning,
          marginRight: theme.spacing.sm,
        }}
      >
        {viewModel.validationLabel}
      </span>
      {viewModel.strengthNote}
    </p>
  );
}

/**
 * A diverging score bar over the fixed `[-1, 1]` interval centred at 0, with BOTH alignment
 * thresholds ticked (Req 12.16). The gauge SUPPLEMENTS the numeric `scoreText`, which stays
 * beside it — it never replaces the number. Purely decorative, so it is `aria-hidden`; the
 * score is already exposed as text.
 */
function ScoreGauge({ gauge }: { gauge: GaugeVM }): JSX.Element {
  // Map a value in [-1, 1] to a 0–100% position across the track.
  const toPct = (v: number): number => ((v - gauge.min) / (gauge.max - gauge.min)) * 100;
  const zeroPct = toPct(0);
  const valuePct = toPct(gauge.value);
  const posTickPct = toPct(gauge.posThreshold);
  const negTickPct = toPct(gauge.negThreshold);

  // The filled segment runs from the centre (0) to the value, in whichever direction.
  const fillLeft = Math.min(zeroPct, valuePct);
  const fillWidth = Math.abs(valuePct - zeroPct);

  const tickStyle = (pct: number): React.CSSProperties => ({
    position: "absolute",
    left: `${pct}%`,
    top: -2,
    width: 1,
    height: 14,
    background: theme.colors.textMuted,
  });

  return (
    <div
      aria-hidden="true"
      style={{
        position: "relative",
        width: 96,
        height: 10,
        background: theme.colors.surfaceRaised,
        borderRadius: theme.radius.sm,
      }}
    >
      {/* Centre (zero) baseline. */}
      <div
        style={{
          position: "absolute",
          left: `${zeroPct}%`,
          top: 0,
          width: 1,
          height: "100%",
          background: theme.colors.border,
        }}
      />
      {/* The diverging fill from centre to value. */}
      <div
        style={{
          position: "absolute",
          left: `${fillLeft}%`,
          top: 0,
          width: `${fillWidth}%`,
          height: "100%",
          background: theme.colors.accent,
          borderRadius: theme.radius.sm,
        }}
      />
      {/* Both alignment-threshold ticks (positive and negative). */}
      <div style={tickStyle(posTickPct)} />
      <div style={tickStyle(negTickPct)} />
    </div>
  );
}

const cellBase: React.CSSProperties = {
  padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
  textAlign: "left",
  fontSize: 13,
  borderBottom: `1px solid ${theme.colors.border}`,
  verticalAlign: "top",
};

const headStyle: React.CSSProperties = {
  ...cellBase,
  fontSize: 12,
  fontWeight: 600,
  color: theme.colors.textSecondary,
  whiteSpace: "nowrap",
};

/** One grid cell: a `<button>` carrying the cell's accessible name + roving tabIndex. The
 * `muted` emphasis makes the cell visually quiet (Req 12.18) WITHOUT dropping any label. */
function GridCell({
  cell,
  isTabStop,
  isSelected,
  buttonRef,
  onSelect,
  onKeyNav,
}: {
  readonly cell: CellVM;
  readonly isTabStop: boolean;
  readonly isSelected: boolean;
  readonly buttonRef: (el: HTMLButtonElement | null) => void;
  readonly onSelect: () => void;
  readonly onKeyNav: (key: string) => void;
}): JSX.Element {
  const muted = cell.emphasis === "muted";
  return (
    <td style={cellBase} data-emphasis={cell.emphasis}>
      <button
        type="button"
        ref={buttonRef}
        className="confluence-focusable"
        aria-label={cell.accessibleName}
        aria-pressed={isSelected}
        data-emphasis={cell.emphasis}
        tabIndex={isTabStop ? 0 : -1}
        onClick={onSelect}
        onKeyDown={(e) => {
          // Let the native button handle Enter/Space (activation → select). Intercept only
          // the navigation keys so focus moves WITHOUT selecting (Req 12.10).
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
            onKeyNav(e.key);
          }
        }}
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: 2,
          width: "100%",
          cursor: "pointer",
          background: isSelected ? theme.colors.surfaceRaised : "transparent",
          border: isSelected
            ? `1px solid ${theme.colors.accent}`
            : `1px solid transparent`,
          borderRadius: theme.radius.sm,
          padding: theme.spacing.xs,
          font: "inherit",
          color: muted ? theme.colors.textMuted : theme.colors.textPrimary,
          opacity: muted ? 0.8 : 1,
          textAlign: "left",
        }}
      >
        <span style={{ fontFamily: theme.font.mono }}>
          <span aria-hidden="true">{cell.glyph}</span> {cell.directionLabel}
        </span>
        {cell.available ? (
          <span style={{ fontSize: 12, color: theme.colors.textSecondary, fontFamily: theme.font.mono }}>
            {cell.strengthText}
          </span>
        ) : null}
        {cell.highlightLabel !== null ? (
          <span style={{ fontSize: 11, color: theme.semantic.warning }}>{cell.highlightLabel}</span>
        ) : null}
      </button>
    </td>
  );
}

export function ConfluencePanel({ viewModel }: ConfluencePanelProps): JSX.Element {
  useFocusVisibleStyle();

  // Focus position (roving tabIndex) and the pinned selection, kept separate so arrow-key
  // navigation can move focus without changing the pinned rationale (Req 12.5, 12.10).
  const [focusPos, setFocusPos] = useState<Pos>({ row: 0, col: 0 });
  const [selected, setSelected] = useState<Pos | null>(null);

  const rowCount = viewModel.rows.length;
  const colCount = viewModel.columns.length;

  // Refs to every cell button so a navigation move can imperatively focus the target.
  const buttonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const cellKey = (row: number, col: number): string => `${row}:${col}`;
  const pendingFocus = useRef<Pos | null>(null);

  const setButtonRef = useCallback(
    (row: number, col: number) => (el: HTMLButtonElement | null) => {
      const key = cellKey(row, col);
      if (el === null) buttonRefs.current.delete(key);
      else buttonRefs.current.set(key, el);
    },
    [],
  );

  // After a navigation move, imperatively focus the newly targeted cell button.
  useEffect(() => {
    const target = pendingFocus.current;
    if (target === null) return;
    pendingFocus.current = null;
    const el = buttonRefs.current.get(cellKey(target.row, target.col));
    el?.focus();
  }, [focusPos]);

  const handleKeyNav = useCallback(
    (pos: Pos, key: string) => {
      const result = nextCell(pos, key, rowCount, colCount);
      if (result === null) return;
      if (result === "dismiss") {
        setSelected(null);
        return;
      }
      pendingFocus.current = result;
      setFocusPos(result);
    },
    [rowCount, colCount],
  );

  const selectCell = useCallback((pos: Pos) => {
    setFocusPos(pos);
    setSelected(pos);
  }, []);

  const selectedCell: CellVM | null = useMemo(() => {
    if (selected === null) return null;
    const row = viewModel.rows[selected.row];
    if (row === undefined) return null;
    return row.cells[selected.col] ?? null;
  }, [selected, viewModel.rows]);

  const selectedRow: RowVM | null =
    selected === null ? null : viewModel.rows[selected.row] ?? null;

  // Empty view model: heading + validation label + the empty-state text ONLY (Req 12.12).
  if (viewModel.empty) {
    return (
      <section
        aria-labelledby="confluence-heading"
        data-testid="confluence-panel"
        style={{ marginBottom: theme.spacing.lg }}
      >
        <h3
          id="confluence-heading"
          style={{
            fontSize: 16,
            fontWeight: 700,
            color: theme.colors.textPrimary,
            margin: `0 0 ${theme.spacing.sm}px 0`,
          }}
        >
          Strategy confluence
        </h3>
        <ValidationNote viewModel={viewModel} />
        <p style={{ margin: 0, fontSize: 14, color: theme.colors.textSecondary }}>
          {viewModel.emptyText}
        </p>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="confluence-heading"
      data-testid="confluence-panel"
      style={{ marginBottom: theme.spacing.lg }}
    >
      <h3
        id="confluence-heading"
        style={{
          fontSize: 16,
          fontWeight: 700,
          color: theme.colors.textPrimary,
          margin: `0 0 ${theme.spacing.sm}px 0`,
        }}
      >
        Strategy confluence
      </h3>

      {/* Header region: validation label + strength note (Req 12.8). */}
      <ValidationNote viewModel={viewModel} />

      {/* The Confluence_Summary counts (Req 12.17). */}
      <p
        data-testid="confluence-summary"
        style={{
          margin: `0 0 ${theme.spacing.sm}px 0`,
          fontSize: 14,
          color: theme.colors.textPrimary,
        }}
      >
        {viewModel.summary.text}
      </p>

      <table
        role="grid"
        style={{
          width: "100%",
          borderCollapse: "collapse",
          background: theme.colors.surface,
          border: `1px solid ${theme.colors.border}`,
          borderRadius: theme.radius.md,
        }}
      >
        <caption
          style={{
            captionSide: "top",
            textAlign: "left",
            fontSize: 12,
            color: theme.colors.textSecondary,
            padding: `0 0 ${theme.spacing.xs}px 0`,
          }}
        >
          Each strategy's direction and strength per pair. Use arrow keys to move between
          cells; Enter or Space shows the selected cell's rationale. Display-only.
        </caption>
        <thead>
          <tr>
            <th scope="col" style={headStyle}>
              Pair
            </th>
            <th scope="col" style={headStyle}>
              Score
            </th>
            <th scope="col" style={headStyle}>
              Status
            </th>
            {viewModel.columns.map((col) => (
              <th key={col.strategyId} scope="col" style={headStyle}>
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {viewModel.rows.map((row, rowIndex) => {
            // Colour the marker ONLY when validated; otherwise one neutral treatment (Req 14).
            const marker = viewModel.validated
              ? markerColor(row.marker)
              : NEUTRAL_MARKER_COLOR;
            return (
              <tr key={row.pair}>
                <th
                  scope="row"
                  style={{ ...headStyle, color: theme.colors.textPrimary, fontWeight: 700 }}
                >
                  {row.pair}
                </th>
                <td style={cellBase}>
                  <div style={{ display: "flex", alignItems: "center", gap: theme.spacing.sm }}>
                    <span style={{ fontFamily: theme.font.mono, color: theme.colors.textPrimary }}>
                      {row.scoreText}
                    </span>
                    <ScoreGauge gauge={row.gauge} />
                  </div>
                </td>
                <td style={cellBase}>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: theme.spacing.xs,
                      color: marker,
                      fontWeight: row.stayFlat ? 700 : 500,
                    }}
                  >
                    {row.stayFlat ? (
                      <span
                        data-testid="stay-flat-marker"
                        style={{
                          padding: `1px ${theme.spacing.xs}px`,
                          borderRadius: theme.radius.sm,
                          border: `1px solid ${marker}`,
                          fontSize: 11,
                        }}
                      >
                        {row.markerText}
                      </span>
                    ) : (
                      <span>{row.statusLabel}</span>
                    )}
                  </span>
                  {row.conflictSummary !== null ? (
                    <div
                      data-testid="conflict-summary"
                      style={{
                        marginTop: theme.spacing.xs,
                        fontSize: 12,
                        color: theme.colors.textSecondary,
                      }}
                    >
                      {row.conflictSummary}
                    </div>
                  ) : null}
                </td>
                {row.cells.map((cell, colIndex) => {
                  const isTabStop =
                    focusPos.row === rowIndex && focusPos.col === colIndex;
                  const isSelected =
                    selected !== null &&
                    selected.row === rowIndex &&
                    selected.col === colIndex;
                  return (
                    <GridCell
                      key={cell.strategyId}
                      cell={cell}
                      isTabStop={isTabStop}
                      isSelected={isSelected}
                      buttonRef={setButtonRef(rowIndex, colIndex)}
                      onSelect={() => selectCell({ row: rowIndex, col: colIndex })}
                      onKeyNav={(key) => handleKeyNav({ row: rowIndex, col: colIndex }, key)}
                    />
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Detail region: the pinned rationale + the validation label and strength note again,
          since this is the other region where a strength / score appears (Req 12.8). */}
      <section
        role="region"
        aria-live="polite"
        aria-label="Selected cell rationale"
        data-testid="confluence-detail"
        style={{
          marginTop: theme.spacing.md,
          padding: theme.spacing.md,
          minHeight: theme.spacing.xl,
          background: theme.colors.surface,
          border: `1px solid ${theme.colors.border}`,
          borderRadius: theme.radius.md,
        }}
      >
        <ValidationNote viewModel={viewModel} />
        {selectedCell !== null && selectedRow !== null ? (
          <>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: theme.spacing.sm,
              }}
            >
              <strong style={{ color: theme.colors.textPrimary, fontSize: 14 }}>
                {selectedRow.pair} · {selectedCell.strategyId}
              </strong>
              <button
                type="button"
                className="confluence-focusable"
                onClick={() => setSelected(null)}
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
            <p style={{ margin: `${theme.spacing.xs}px 0 0 0`, fontSize: 14, color: theme.colors.textPrimary }}>
              {selectedCell.detailText}
            </p>
          </>
        ) : (
          <p style={{ margin: 0, fontSize: 13, color: theme.colors.textSecondary }}>
            Select a cell to see its rationale.
          </p>
        )}
      </section>
    </section>
  );
}
