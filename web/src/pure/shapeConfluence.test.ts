// Pure Confluence view-model shaper unit tests — hand-constructed slices, no network/DOM.
// Covers one case per Confluence_Status, the unavailable-cell and empty states, and the
// folded-in presentation fields (conflict summary, gauge, summary counts, emphasis, and the
// colour-suppression `validated` hook).
//
// _Requirements: 12.1, 12.3, 12.6, 12.7, 12.9, 12.12, 12.14, 12.15, 12.16, 12.17, 12.18,
//                14.1, 14.2, 14.3, 14.4, 13.10, 13.10a_
import { describe, expect, it } from "vitest";
import type {
  Confluence,
  ConfluenceCell,
  ConfluencePair,
  ConfluenceStatus,
  ConfluenceStrategyId,
} from "../api/types.ts";
import { shapeConfluence, STRATEGY_IDS } from "./shapeConfluence.ts";

// --- Fixture helpers --------------------------------------------------------------------

/** All-unit weights (every Strategy_Id contributes) unless a test overrides one. */
const UNIT_WEIGHTS: Readonly<Record<ConfluenceStrategyId, number>> = {
  trend: 1,
  breakout: 1,
  range: 1,
  reversal: 1,
  custom_pattern: 1,
  third_party: 1,
};

/** An available cell with a verbatim direction, strength, and rationale. */
function available(
  strategyId: ConfluenceStrategyId,
  direction: "UP" | "DOWN" | "FLAT",
  strength: number,
  rationale = `${strategyId} rationale`,
): ConfluenceCell {
  return { strategyId, available: true, direction, strength, rationale };
}

/** An explicit unavailable cell carrying a non-empty reason. */
function unavailable(strategyId: ConfluenceStrategyId, reason: string): ConfluenceCell {
  return { strategyId, available: false, reason };
}

/**
 * Build a full six-cell set in STRATEGY_IDS order from a partial override map. Any
 * Strategy_Id not overridden defaults to an available FLAT cell with strength 0.
 */
function cells(
  overrides: Partial<Record<ConfluenceStrategyId, ConfluenceCell>>,
): readonly ConfluenceCell[] {
  return STRATEGY_IDS.map(
    (id) => overrides[id] ?? available(id, "FLAT", 0),
  );
}

/** One Pair row. */
function pairRow(
  pair: string,
  status: ConfluenceStatus,
  score: number,
  cellSet: readonly ConfluenceCell[],
  opposingStrategyIds: readonly ConfluenceStrategyId[] = [],
): ConfluencePair {
  return { pair, score, status, opposingStrategyIds, cells: cellSet };
}

/** A per-run slice. `validationLabel` is cast so tests can exercise non-default labels. */
function slice(
  pairs: readonly ConfluencePair[],
  opts: {
    readonly weights?: Readonly<Record<ConfluenceStrategyId, number>>;
    readonly alignmentThreshold?: number;
    readonly conflictThreshold?: number;
    readonly validationLabel?: string;
  } = {},
): Confluence {
  return {
    validationLabel: (opts.validationLabel ?? "unvalidated") as "unvalidated",
    weights: opts.weights ?? UNIT_WEIGHTS,
    conflictThreshold: opts.conflictThreshold ?? 0.6,
    alignmentThreshold: opts.alignmentThreshold ?? 0.4,
    pairs,
  };
}

// --- One case per Confluence_Status -----------------------------------------------------

describe("shapeConfluence — status marker / label / text (12.1, 12.3)", () => {
  it("ALIGNED_UP → green marker, 'Aligned up' label and marker text", () => {
    const vm = shapeConfluence(
      slice([pairRow("EURUSD", "ALIGNED_UP", 0.8, cells({ trend: available("trend", "UP", 0.8) }))]),
    );
    const row = vm.rows[0]!;
    expect(row.marker).toBe("green");
    expect(row.markerText).toBe("Aligned up");
    expect(row.statusLabel).toBe("Aligned up");
    expect(row.status).toBe("ALIGNED_UP");
    expect(row.stayFlat).toBe(false);
  });

  it("ALIGNED_DOWN → red marker, 'Aligned down' label and marker text", () => {
    const vm = shapeConfluence(
      slice([pairRow("EURUSD", "ALIGNED_DOWN", -0.8, cells({ trend: available("trend", "DOWN", 0.8) }))]),
    );
    const row = vm.rows[0]!;
    expect(row.marker).toBe("red");
    expect(row.markerText).toBe("Aligned down");
    expect(row.statusLabel).toBe("Aligned down");
    expect(row.status).toBe("ALIGNED_DOWN");
    expect(row.stayFlat).toBe(false);
  });

  it("NEUTRAL → neutral marker and 'Neutral' label/text", () => {
    const vm = shapeConfluence(slice([pairRow("EURUSD", "NEUTRAL", 0.1, cells({}))]));
    const row = vm.rows[0]!;
    expect(row.marker).toBe("neutral");
    expect(row.markerText).toBe("Neutral");
    expect(row.statusLabel).toBe("Neutral");
    expect(row.status).toBe("NEUTRAL");
    expect(row.stayFlat).toBe(false);
  });

  it("CONFLICT_FLAT → conflict marker and 'Stay Flat' label/text with stayFlat true", () => {
    const vm = shapeConfluence(
      slice([
        pairRow(
          "EURUSD",
          "CONFLICT_FLAT",
          0,
          cells({
            trend: available("trend", "UP", 0.9),
            reversal: available("reversal", "DOWN", 0.9),
          }),
          ["trend", "reversal"],
        ),
      ]),
    );
    const row = vm.rows[0]!;
    expect(row.marker).toBe("conflict");
    expect(row.markerText).toBe("Stay Flat");
    expect(row.statusLabel).toBe("Stay Flat");
    expect(row.status).toBe("CONFLICT_FLAT");
    expect(row.stayFlat).toBe(true);
  });

  it("INSUFFICIENT_DATA → neutral marker and 'Insufficient data' label/text", () => {
    const vm = shapeConfluence(
      slice([pairRow("EURUSD", "INSUFFICIENT_DATA", 0, cells({ trend: unavailable("trend", "insufficient_data") }))]),
    );
    const row = vm.rows[0]!;
    expect(row.marker).toBe("neutral");
    expect(row.markerText).toBe("Insufficient data");
    expect(row.statusLabel).toBe("Insufficient data");
    expect(row.status).toBe("INSUFFICIENT_DATA");
    expect(row.stayFlat).toBe(false);
  });
});

// --- Unavailable cell (11.2 / 12.18) ----------------------------------------------------

describe("shapeConfluence — unavailable cell (12.6)", () => {
  it("renders the explicit 'Unavailable' label, the reason as detail, null strength, muted emphasis", () => {
    const reason = "candles_unavailable";
    const vm = shapeConfluence(
      slice([pairRow("EURUSD", "INSUFFICIENT_DATA", 0, cells({ trend: unavailable("trend", reason) }))]),
    );
    const cell = vm.rows[0]!.cells.find((c) => c.strategyId === "trend")!;
    expect(cell.available).toBe(false);
    expect(cell.directionLabel).toBe("Unavailable");
    expect(cell.detailText).toBe(reason);
    expect(cell.strength).toBeNull();
    expect(cell.emphasis).toBe("muted");
    // The accessible name still carries the reason — nothing is dropped.
    expect(cell.accessibleName).toContain(reason);
  });
});

// --- Empty state (12.12) ----------------------------------------------------------------

describe("shapeConfluence — empty state (12.12)", () => {
  it("zero pairs → empty=true, emptyText present, no rows, yet label and strength note stay", () => {
    const vm = shapeConfluence(slice([]));
    expect(vm.empty).toBe(true);
    expect(vm.emptyText).toBe("no confluence data for this run");
    expect(vm.rows).toEqual([]);
    expect(vm.validationLabel).toBe("Un-validated");
    expect(vm.strengthNote).toBe("Strength is not a probability");
    // Summary counts are all zero and still partition the (empty) row set.
    expect(vm.summary.aligned + vm.summary.conflict + vm.summary.neutral).toBe(0);
  });
});

// --- Conflict summary (12.14, 12.15) ----------------------------------------------------

describe("shapeConfluence — conflictSummary (12.14, 12.15)", () => {
  it("a CONFLICT_FLAT row names an opposing UP id and an opposing DOWN id", () => {
    const vm = shapeConfluence(
      slice([
        pairRow(
          "EURUSD",
          "CONFLICT_FLAT",
          0,
          cells({
            trend: available("trend", "UP", 0.9),
            reversal: available("reversal", "DOWN", 0.85),
          }),
          ["trend", "reversal"],
        ),
      ]),
    );
    const summary = vm.rows[0]!.conflictSummary;
    expect(summary).not.toBeNull();
    expect(summary).toContain("trend");
    expect(summary).toContain("reversal");
    expect(summary).toContain("Up");
    expect(summary).toContain("Down");
  });

  it("a non-conflict row has conflictSummary === null", () => {
    const vm = shapeConfluence(
      slice([pairRow("EURUSD", "ALIGNED_UP", 0.8, cells({ trend: available("trend", "UP", 0.8) }))]),
    );
    expect(vm.rows[0]!.conflictSummary).toBeNull();
  });
});

// --- Gauge (12.16) ----------------------------------------------------------------------

describe("shapeConfluence — gauge (12.16)", () => {
  it("spans [-1,1], value===score, ±alignmentThreshold ticks, scoreText retained", () => {
    const alignmentThreshold = 0.4;
    const vm = shapeConfluence(
      slice([pairRow("EURUSD", "ALIGNED_UP", 0.72, cells({ trend: available("trend", "UP", 0.72) }))], {
        alignmentThreshold,
      }),
    );
    const row = vm.rows[0]!;
    expect(row.gauge.min).toBe(-1);
    expect(row.gauge.max).toBe(1);
    expect(row.gauge.value).toBe(row.score);
    expect(row.gauge.posThreshold).toBe(alignmentThreshold);
    expect(row.gauge.negThreshold).toBe(-alignmentThreshold);
    expect(row.scoreText).toBe("0.72");
  });
});

// --- Summary counts (12.17) -------------------------------------------------------------

describe("shapeConfluence — summary counts (12.17)", () => {
  it("partition the rows so aligned + conflict + neutral === rows.length", () => {
    const vm = shapeConfluence(
      slice([
        pairRow("EURUSD", "ALIGNED_UP", 0.8, cells({ trend: available("trend", "UP", 0.8) })),
        pairRow("GBPUSD", "ALIGNED_DOWN", -0.8, cells({ trend: available("trend", "DOWN", 0.8) })),
        pairRow(
          "USDJPY",
          "CONFLICT_FLAT",
          0,
          cells({
            trend: available("trend", "UP", 0.9),
            reversal: available("reversal", "DOWN", 0.9),
          }),
          ["trend", "reversal"],
        ),
        pairRow("USDCHF", "NEUTRAL", 0.1, cells({})),
        pairRow("USDCAD", "INSUFFICIENT_DATA", 0, cells({ trend: unavailable("trend", "insufficient_data") })),
      ]),
    );
    const { aligned, conflict, neutral } = vm.summary;
    expect(aligned).toBe(2);
    expect(conflict).toBe(1);
    expect(neutral).toBe(2); // NEUTRAL + INSUFFICIENT_DATA
    expect(aligned + conflict + neutral).toBe(vm.rows.length);
  });
});

// --- Cell emphasis (12.18) --------------------------------------------------------------

describe("shapeConfluence — cell emphasis (12.18)", () => {
  it("emphasis is 'signal' only for an available, non-FLAT, positive-weight cell; 'muted' otherwise", () => {
    const vm = shapeConfluence(
      slice(
        [
          pairRow(
            "EURUSD",
            "ALIGNED_UP",
            0.8,
            cells({
              trend: available("trend", "UP", 0.8), // available, non-FLAT, weight 1 → signal
              breakout: available("breakout", "FLAT", 0), // FLAT → muted
              range: available("range", "UP", 0.5), // positive but weight 0 → muted
              custom_pattern: unavailable("custom_pattern", "invalid_signal:direction"), // unavailable → muted
            }),
          ),
        ],
        { weights: { ...UNIT_WEIGHTS, range: 0 } },
      ),
    );
    const byId = new Map(vm.rows[0]!.cells.map((c) => [c.strategyId, c]));

    expect(byId.get("trend")!.emphasis).toBe("signal");
    expect(byId.get("breakout")!.emphasis).toBe("muted");
    expect(byId.get("range")!.emphasis).toBe("muted");
    expect(byId.get("custom_pattern")!.emphasis).toBe("muted");

    // Labels remain intact even when muted.
    expect(byId.get("trend")!.directionLabel).toBe("Up");
    expect(byId.get("breakout")!.directionLabel).toBe("Flat");
    expect(byId.get("range")!.directionLabel).toBe("Up");
    expect(byId.get("custom_pattern")!.directionLabel).toBe("Unavailable");
  });
});

// --- Validation / colour suppression (14.1-14.4) ----------------------------------------

describe("shapeConfluence — validated hook (14.1-14.4)", () => {
  it("validated === false for an 'unvalidated' slice, status text still present", () => {
    const vm = shapeConfluence(
      slice([pairRow("EURUSD", "ALIGNED_UP", 0.8, cells({ trend: available("trend", "UP", 0.8) }))], {
        validationLabel: "unvalidated",
      }),
    );
    expect(vm.validated).toBe(false);
    // Marker text / status label stay present regardless of validation state.
    expect(vm.rows[0]!.markerText).toBe("Aligned up");
    expect(vm.rows[0]!.statusLabel).toBe("Aligned up");
  });

  it("validated === true for any other validationLabel value", () => {
    const vm = shapeConfluence(
      slice([pairRow("EURUSD", "ALIGNED_UP", 0.8, cells({ trend: available("trend", "UP", 0.8) }))], {
        validationLabel: "validated",
      }),
    );
    expect(vm.validated).toBe(true);
    expect(vm.rows[0]!.markerText).toBe("Aligned up");
  });
});

// --- third_party display-only column (12.9) ---------------------------------------------

describe("shapeConfluence — third_party display-only column (12.9)", () => {
  it("is labelled 'display-only' exactly when weights.third_party === 0", () => {
    const zeroWeight = shapeConfluence(
      slice([], { weights: { ...UNIT_WEIGHTS, third_party: 0 } }),
    );
    const zeroCol = zeroWeight.columns.find((c) => c.strategyId === "third_party")!;
    expect(zeroCol.displayOnly).toBe(true);
    expect(zeroCol.header).toContain("display-only");

    const nonZeroWeight = shapeConfluence(
      slice([], { weights: { ...UNIT_WEIGHTS, third_party: 1 } }),
    );
    const nonZeroCol = nonZeroWeight.columns.find((c) => c.strategyId === "third_party")!;
    expect(nonZeroCol.displayOnly).toBe(false);
    expect(nonZeroCol.header).not.toContain("display-only");
  });
});
