import { describe, expect, it } from "vitest";
import fc from "fast-check";

import type { Candle } from "../guard/types.js";
import { type Pair } from "../ingestion/types.js";
import { fromPips } from "./pip.js";
import { simulateTrade } from "./tradeSimulation.js";
import type { IntraCandleResolver, TradeProposal } from "./types.js";

// Feature: trader-edge-validation, Property 3: path-aware Trade_Simulation
//
//   (a) R1.1/1.3 — a stop inside the first forward candle (target far away) ⇒ `stop_first`.
//   (b) R1.2     — a candle whose range contains BOTH levels ⇒ `ambiguous`, grossPips 0,
//                   never a win/loss (and never silently the favourable fill).
//   (c) R1       — determinism: identical inputs ⇒ identical TradeOutcome.
//   (d) R1.5     — Look_Ahead_Safety: candles beyond the Horizon window cannot change
//                   an earlier resolution.
//
// Validates: Requirements 1.1, 1.2, 1.3, 1.5

const PAIR: Pair = "EURUSD";
const ENTRY = 1.1000;

function c(date: string, high: number, low: number, close: number): Candle {
  return { asset: PAIR, date, open: (high + low) / 2, high, low, close };
}

function longProposal(stopPips: number, tpPips: number, horizon: 1 | 2 | 3): TradeProposal {
  return {
    pair: PAIR,
    decisionDate: "2024-03-04",
    direction: "UP",
    horizon,
    entryPrice: ENTRY,
    entryDate: "2024-03-04",
    stopLossPips: stopPips,
    takeProfitPips: tpPips,
  };
}

describe("trader-edge-validation Property 3: Trade_Simulation", () => {
  it("(a) a stop inside the first candle with a far target resolves stop_first", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 5, max: 50, noNaN: true }), // stop distance in pips
        (stopPips) => {
          const tpPips = stopPips + 1000; // target unreachable in the window
          const proposal = longProposal(stopPips, tpPips, 2);
          const stopPrice = ENTRY - fromPips(stopPips, PAIR);
          // First forward candle dips to the stop but nowhere near the target.
          const candles: Candle[] = [
            c("2024-03-05", ENTRY + fromPips(2, PAIR), stopPrice - fromPips(1, PAIR), ENTRY),
            c("2024-03-06", ENTRY + fromPips(3, PAIR), ENTRY - fromPips(1, PAIR), ENTRY),
          ];
          const out = simulateTrade(proposal, candles);
          expect(out.kind).toBe("stop_first");
          expect(out.resolvedOnDate).toBe("2024-03-05");
          expect(out.grossPips).toBe(-stopPips);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("(b) a candle containing BOTH levels is ambiguous: grossPips 0, never a win/loss", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 5, max: 40, noNaN: true }),
        fc.double({ min: 5, max: 40, noNaN: true }),
        (stopPips, tpPips) => {
          const proposal = longProposal(stopPips, tpPips, 2);
          const stopPrice = ENTRY - fromPips(stopPips, PAIR);
          const targetPrice = ENTRY + fromPips(tpPips, PAIR);
          // One candle whose range spans BOTH the stop and the target.
          const candles: Candle[] = [
            c("2024-03-05", targetPrice + fromPips(1, PAIR), stopPrice - fromPips(1, PAIR), ENTRY),
          ];
          const out = simulateTrade(proposal, candles);
          expect(out.kind).toBe("ambiguous");
          expect(out.grossPips).toBe(0);
          expect(out.resolvedOnDate).toBeNull();
          expect(out.ambiguousCandleDate).toBe("2024-03-05");
        },
      ),
      { numRuns: 200 },
    );
  });

  it("(b') an injected resolver disambiguates a both-touched candle", () => {
    const proposal = longProposal(20, 20, 2);
    const stopPrice = ENTRY - fromPips(20, PAIR);
    const targetPrice = ENTRY + fromPips(20, PAIR);
    const candles: Candle[] = [
      c("2024-03-05", targetPrice + fromPips(1, PAIR), stopPrice - fromPips(1, PAIR), ENTRY),
    ];
    const resolver: IntraCandleResolver = () => "target_first";
    const out = simulateTrade(proposal, candles, resolver);
    expect(out.kind).toBe("target_first");
    expect(out.grossPips).toBe(20);
  });

  it("(c) identical inputs produce identical outcomes (determinism)", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 5, max: 40, noNaN: true }),
        fc.double({ min: 5, max: 40, noNaN: true }),
        fc.integer({ min: 1, max: 3 }),
        (stopPips, tpPips, horizon) => {
          const proposal = longProposal(stopPips, tpPips, horizon as 1 | 2 | 3);
          const candles: Candle[] = [
            c("2024-03-05", ENTRY + fromPips(10, PAIR), ENTRY - fromPips(10, PAIR), ENTRY + fromPips(2, PAIR)),
            c("2024-03-06", ENTRY + fromPips(15, PAIR), ENTRY - fromPips(5, PAIR), ENTRY + fromPips(5, PAIR)),
            c("2024-03-07", ENTRY + fromPips(25, PAIR), ENTRY - fromPips(8, PAIR), ENTRY + fromPips(9, PAIR)),
          ];
          const a = simulateTrade(proposal, candles);
          const b = simulateTrade(proposal, candles);
          expect(JSON.stringify(a)).toBe(JSON.stringify(b));
        },
      ),
      { numRuns: 200 },
    );
  });

  it("(d) candles beyond the horizon window cannot change an earlier resolution", () => {
    fc.assert(
      fc.property(fc.double({ min: 5, max: 30, noNaN: true }), (tpPips) => {
        const proposal = longProposal(1000, tpPips, 1); // horizon 1: only the first forward candle counts
        const targetPrice = ENTRY + fromPips(tpPips, PAIR);
        // Candle 1 (in-window): neither level touched → should expire at its close.
        // Candle 2 (beyond horizon 1): would hit the target, but must be ignored.
        const inWindow = c("2024-03-05", ENTRY + fromPips(1, PAIR), ENTRY - fromPips(1, PAIR), ENTRY + fromPips(0.5, PAIR));
        const beyond = c("2024-03-06", targetPrice + fromPips(5, PAIR), ENTRY, targetPrice);
        const withBeyond = simulateTrade(proposal, [inWindow, beyond]);
        const withoutBeyond = simulateTrade(proposal, [inWindow]);
        // The out-of-window candle changes nothing: both expire identically.
        expect(withBeyond.kind).toBe("expired");
        expect(JSON.stringify(withBeyond)).toBe(JSON.stringify(withoutBeyond));
      }),
      { numRuns: 200 },
    );
  });
});
