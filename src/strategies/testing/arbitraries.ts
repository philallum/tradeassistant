// Shared fast-check generators for the Multi-Strategy Confluence Engine
// property tests (Requirements 13.2, 13.3, 13.4, 13.5; Design "Shared test
// generators"). Backend fast-check 4.10.0.
//
// TEST-SUPPORT ONLY. This module lives under `src/strategies/testing/` and is
// deliberately exempt from the runtime import-boundary scan (task 13.2): it may
// import `tagLlmOutput` from `../../llm/llmInterface.js` so that
// `arbLlmTagged` produces values carrying the genuine, unforgeable LLM
// provenance brand rather than a hand-rolled fake. NO runtime module may import
// from this file.
//
// Every generator is a pure function of fast-check's seed — none of them read
// `Date.now`, `Math.random`, or `process.env`. Date math goes exclusively
// through the shared `addTradingDays` / `compareTradingDates` helpers so the
// produced dates are always valid ascending weekday TradingDates.

import fc from "fast-check";

import type { Candle, TradingDate } from "../../guard/types.js";
import {
  addTradingDays,
  compareTradingDates,
} from "../../guard/tradingDate.js";
import { tagLlmOutput } from "../../llm/llmInterface.js";
import type { LlmTagged, SanctionedRole } from "../../llm/types.js";
import { SANCTIONED_ROLES } from "../../llm/types.js";
import {
  STRATEGY_IDS,
  SIGNAL_DIRECTIONS,
  RATIONALE_MAX_LENGTH,
  buildSignal,
} from "../types.js";
import type {
  StrategyId,
  SignalDirection,
  StrategySignal,
} from "../types.js";

/**
 * A valid confluence weighting: a finite, non-negative weight for every
 * Strategy_Id. This mirrors the `ConfluenceWeights` the Confluence_Engine
 * defines (Design "ConfluenceWeights = Readonly<Record<StrategyId, number>>").
 * It is declared locally here because the engine module (task 12) does not
 * exist yet in Stage A; the two definitions are structurally identical.
 */
export type ConfluenceWeights = Readonly<Record<StrategyId, number>>;

// ---------------------------------------------------------------------------
// Primitive building blocks
// ---------------------------------------------------------------------------

/** A finite OHLC price in a realistic FX range (no NaN / Infinity). */
const priceArb: fc.Arbitrary<number> = fc.double({
  min: 0.1,
  max: 1000,
  noNaN: true,
  noDefaultInfinity: true,
});

/** A non-empty, non-whitespace rationale within the 1..500 bound. */
const rationaleArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: RATIONALE_MAX_LENGTH })
  // Ensure at least one non-whitespace character and stay within bounds.
  .map((s) => {
    const trimmed = s.trim();
    const base = trimmed.length > 0 ? s : `r${s}`;
    return base.slice(0, RATIONALE_MAX_LENGTH);
  })
  .filter((s) => s.length >= 1 && s.trim().length >= 1);

/** An arbitrary Strategy_Id drawn from the six canonical ids. */
export const arbStrategyId: fc.Arbitrary<StrategyId> = fc.constantFrom(
  ...STRATEGY_IDS,
);

/** An arbitrary Signal_Direction (`UP` / `DOWN` / `FLAT`). */
export const arbSignalDirection: fc.Arbitrary<SignalDirection> =
  fc.constantFrom(...SIGNAL_DIRECTIONS);

/** An arbitrary sanctioned LLM role — the only roles `tagLlmOutput` accepts. */
const sanctionedRoleArb: fc.Arbitrary<SanctionedRole> = fc.constantFrom(
  ...SANCTIONED_ROLES,
);

// ---------------------------------------------------------------------------
// Candle series
// ---------------------------------------------------------------------------

/**
 * Build one candle from a price path step. The random walk produces a `close`;
 * `open` is the previous close (or the same value for the first candle). The
 * high / low are stretched outward by non-negative wick sizes so the invariant
 * `low <= open`, `low <= close`, `open <= high`, `close <= high` always holds.
 */
function makeCandle(
  asset: string,
  date: TradingDate,
  open: number,
  close: number,
  upperWick: number,
  lowerWick: number,
): Candle {
  const high = Math.max(open, close) + upperWick;
  const low = Math.min(open, close) - lowerWick;
  return { asset, date, open, high, low, close };
}

/**
 * A `Candle[]` of length in `[min, max]` with:
 *   - strictly ascending weekday (Mon-Fri) TradingDates (via `addTradingDays`),
 *   - `low <= open`, `low <= close`, `open <= high`, `close <= high` per candle,
 *   - a random-walk close path with optional flat segments (a step delta of 0),
 *     so zero-volatility runs can occur.
 *
 * Every produced series passes `prepareCandles` finiteness and ascending-date
 * expectations (Requirements 13.3, 13.4).
 */
export function arbCandleSeries(opts: {
  min: number;
  max: number;
}): fc.Arbitrary<Candle[]> {
  const min = Math.max(0, Math.floor(opts.min));
  const max = Math.max(min, Math.floor(opts.max));

  return fc
    .record({
      asset: fc.constantFrom(
        "EURUSD",
        "GBPUSD",
        "USDJPY",
        "USDCHF",
        "USDCAD",
      ),
      // A weekday start date, then candles advance one trading day each.
      startDate: fc
        .integer({ min: 0, max: 5000 })
        .map((offset) => addTradingDays("2015-01-01", offset)),
      open0: priceArb,
      steps: fc.array(
        fc.record({
          // A signed walk delta; `flat` zeroes it to create flat segments.
          delta: fc.double({
            min: -5,
            max: 5,
            noNaN: true,
            noDefaultInfinity: true,
          }),
          flat: fc.boolean(),
          upperWick: fc.double({
            min: 0,
            max: 5,
            noNaN: true,
            noDefaultInfinity: true,
          }),
          lowerWick: fc.double({
            min: 0,
            max: 5,
            noNaN: true,
            noDefaultInfinity: true,
          }),
        }),
        { minLength: min, maxLength: max },
      ),
    })
    .map(({ asset, startDate, open0, steps }) => {
      const candles: Candle[] = [];
      let prevClose = open0;
      let date = startDate;
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i]!;
        const open = prevClose;
        const rawClose = step.flat ? open : open + step.delta;
        // Keep prices strictly positive and finite.
        const close = Math.max(0.0001, rawClose);
        candles.push(
          makeCandle(asset, date, open, close, step.upperWick, step.lowerWick),
        );
        prevClose = close;
        date = addTradingDays(date, 1);
      }
      return candles;
    });
}

/**
 * A TradingDate strictly after the last candle's date, so the whole series is
 * past-only relative to the returned Decision_Date. If the series is empty, any
 * weekday date is returned.
 */
export function arbDecisionDateAfter(
  candles: readonly Candle[],
): fc.Arbitrary<TradingDate> {
  const lastDate =
    candles.length > 0 ? candles[candles.length - 1]!.date : undefined;
  return fc
    .integer({ min: 1, max: 30 })
    .map((gap) =>
      lastDate === undefined
        ? addTradingDays("2015-01-01", gap)
        : addTradingDays(lastDate, gap),
    )
    .filter((d) =>
      lastDate === undefined ? true : compareTradingDates(d, lastDate) > 0,
    );
}

/**
 * Candles dated AT OR AFTER `decisionDate`, for look-ahead property tests.
 * These deliberately VIOLATE past-only expectations — the first candle is dated
 * exactly on `decisionDate` and subsequent ones advance forward — so a strategy
 * must reject them via `prepareCandles` (Requirement 13.4).
 */
export function arbFutureCandles(
  decisionDate: TradingDate,
  opts: { min: number; max: number },
): fc.Arbitrary<Candle[]> {
  return arbCandleSeries(opts).map((series) => {
    // Re-date the series so the first candle sits on `decisionDate` and the
    // rest advance by trading days, keeping dates ascending and at/after it.
    let date: TradingDate = decisionDate;
    return series.map((candle, index) => {
      const dated: Candle = { ...candle, date };
      date = addTradingDays(date, 1);
      return index === 0 ? { ...dated, date: decisionDate } : dated;
    });
  });
}

// ---------------------------------------------------------------------------
// Signals
// ---------------------------------------------------------------------------

/**
 * An arbitrary VALID {@link StrategySignal}. Built through {@link buildSignal}
 * so the contract always holds: FLAT has strength exactly 0; UP/DOWN carry a
 * finite strength in `[0, 1]`; the rationale is 1..500 non-whitespace
 * characters. An optional `strategyId` pins the id (used by `arbSignalSet`).
 */
export function arbSignal(strategyId?: StrategyId): fc.Arbitrary<StrategySignal> {
  const idArb = strategyId === undefined ? arbStrategyId : fc.constant(strategyId);
  return fc
    .record({
      strategyId: idArb,
      direction: arbSignalDirection,
      strength: fc.double({
        min: 0,
        max: 1,
        noNaN: true,
        noDefaultInfinity: true,
      }),
      rationale: rationaleArb,
    })
    .map(({ strategyId: id, direction, strength, rationale }) => {
      const result = buildSignal(id, direction, strength, rationale);
      if (!result.ok) {
        // Should be unreachable given the constrained generators above.
        throw new Error(
          `arbSignal produced an invalid signal: ${result.error.message}`,
        );
      }
      return result.value;
    });
}

/**
 * A set of valid signals with AT MOST ONE per {@link StrategyId} (no duplicate
 * strategyIds), length 0..6. A subset of the six ids is chosen, then one valid
 * signal is generated per chosen id (Requirement 13.5).
 */
export const arbSignalSet: fc.Arbitrary<StrategySignal[]> = fc
  .subarray([...STRATEGY_IDS], { minLength: 0, maxLength: STRATEGY_IDS.length })
  .chain((ids) =>
    ids.length === 0
      ? fc.constant<StrategySignal[]>([])
      : fc.tuple(...ids.map((id) => arbSignal(id))),
  );

// ---------------------------------------------------------------------------
// Weights and thresholds
// ---------------------------------------------------------------------------

/**
 * An arbitrary valid {@link ConfluenceWeights}: a finite, `>= 0` weight for
 * every Strategy_Id.
 */
export const arbWeights: fc.Arbitrary<ConfluenceWeights> = fc
  .record(
    Object.fromEntries(
      STRATEGY_IDS.map((id) => [
        id,
        fc.double({ min: 0, max: 10, noNaN: true, noDefaultInfinity: true }),
      ]),
    ) as Record<StrategyId, fc.Arbitrary<number>>,
  )
  .map((w) => w as ConfluenceWeights);

/**
 * Arbitrary valid confluence thresholds: `conflictThreshold` and
 * `alignmentThreshold` each in `[0, 1]`.
 */
export const arbThresholds: fc.Arbitrary<{
  conflictThreshold: number;
  alignmentThreshold: number;
}> = fc.record({
  conflictThreshold: fc.double({
    min: 0,
    max: 1,
    noNaN: true,
    noDefaultInfinity: true,
  }),
  alignmentThreshold: fc.double({
    min: 0,
    max: 1,
    noNaN: true,
    noDefaultInfinity: true,
  }),
});

// ---------------------------------------------------------------------------
// Invalid signals (for rejection property tests)
// ---------------------------------------------------------------------------

/**
 * A signal-shaped value that violates EXACTLY ONE contract rule, for rejection
 * property tests. Each case starts from an otherwise-valid signal and breaks a
 * single field:
 *   - `strength_out_of_range`  — strength just outside `[0, 1]`.
 *   - `strength_non_finite`    — strength is NaN / Infinity.
 *   - `rationale_empty`        — rationale is empty or all whitespace.
 *   - `flat_nonzero_strength`  — FLAT direction with non-zero strength.
 *   - `bad_strategy_id`        — strategyId outside {@link STRATEGY_IDS}.
 *   - `bad_direction`          — direction outside {@link SIGNAL_DIRECTIONS}.
 *
 * The returned value is typed `unknown` because it intentionally breaks the
 * `StrategySignal` type.
 */
export const arbInvalidSignal: fc.Arbitrary<unknown> = fc
  .record({
    base: arbSignal(),
    kind: fc.constantFrom(
      "strength_out_of_range",
      "strength_non_finite",
      "rationale_empty",
      "flat_nonzero_strength",
      "bad_strategy_id",
      "bad_direction",
    ),
    overRange: fc.oneof(
      fc.double({ min: 1.0000001, max: 100, noNaN: true, noDefaultInfinity: true }),
      fc.double({ min: -100, max: -0.0000001, noNaN: true, noDefaultInfinity: true }),
    ),
    nonFinite: fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY),
    whitespace: fc.constantFrom("", " ", "   ", "\t", "\n  \t"),
    nonzero: fc.double({ min: 0.0001, max: 1, noNaN: true, noDefaultInfinity: true }),
  })
  .map(({ base, kind, overRange, nonFinite, whitespace, nonzero }) => {
    switch (kind) {
      case "strength_out_of_range":
        return {
          ...base,
          direction: base.direction === "FLAT" ? "UP" : base.direction,
          strength: overRange,
        };
      case "strength_non_finite":
        return {
          ...base,
          direction: base.direction === "FLAT" ? "UP" : base.direction,
          strength: nonFinite,
        };
      case "rationale_empty":
        return { ...base, rationale: whitespace };
      case "flat_nonzero_strength":
        return { ...base, direction: "FLAT", strength: nonzero };
      case "bad_strategy_id":
        return { ...base, strategyId: "not_a_strategy" };
      case "bad_direction":
        return { ...base, direction: "SIDEWAYS" };
      default:
        return base;
    }
  });

// ---------------------------------------------------------------------------
// LLM-tagged values
// ---------------------------------------------------------------------------

/**
 * A value wrapped with the GENUINE LLM provenance brand via the real
 * {@link tagLlmOutput} helper — not a hand-rolled fake. Used by guardrail tests
 * to prove LLM-tagged values are rejected on strategy / adapter / engine paths
 * (Requirement 13.8). The payload spans the shapes LLM roles emit plus a valid
 * signal, so a tagged value can masquerade as a signal and still be caught by
 * the provenance brand.
 */
export const arbLlmTagged: fc.Arbitrary<LlmTagged<unknown>> = fc
  .tuple(
    fc.oneof(
      fc.string(),
      fc.array(fc.string()),
      fc.record({
        level: fc.constantFrom("none", "elevated", "high"),
        reason: fc.string(),
      }),
      fc.double({ noNaN: true }),
      arbSignal(),
    ),
    sanctionedRoleArb,
  )
  .map(([payload, role]) =>
    tagLlmOutput(payload, role, "2020-01-01T00:00:00.000Z"),
  );
