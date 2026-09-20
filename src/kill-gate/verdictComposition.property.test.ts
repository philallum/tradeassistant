import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { DirectionClass, ForwardOutcome } from "../retrieval/types.js";
import type { Horizon } from "../confidence/types.js";
import type { Pair } from "../ingestion/types.js";
import { PAIRS } from "../ingestion/types.js";
import { composeGateVerdict, logGateVerdict, type FoldGateInput } from "./verdict.js";
import { GATE1_SAMPLE_SIZE_FLOOR, type Gate1FiringSample } from "./types.js";
import type { GateVerdictSummary, LivingDocs } from "../living-docs/livingDocs.js";

// Feature: fx-daily-pattern-assistant, Property 23: For all configurations, the Kill_Gate verdict is PASS if and only if both Gate_1 and Gate_2 pass; otherwise it is CUT, and the corresponding verdict and metrics are logged.
//
// Validates: Requirements 11.9, 11.10
//
// The composition rule (verdict.ts): a single qualifying fold's verdict — and,
// with exactly one qualifying fold, the aggregate verdict — is PASS iff BOTH
// Gate 1 and Gate 2 pass on that fold; otherwise CUT. Gate 2 is only evaluated
// after Gate 1 passes (Req 11.8), so when Gate 1 fails Gate 2.passed is false
// and the verdict is CUT — consistent with `(g1 && g2) ? PASS : CUT`.
//
// This test drives all combinations of (gate1.passed, gate2.passed) by
// constructing the firing subset (>= 30 samples so the fold qualifies) and the
// MFE/MAE excursions, then asserts the verdict equals `(g1 && g2) ? PASS : CUT`.
// It also drives `logGateVerdict` against an in-memory LivingDocs stub and
// asserts a PASS routes through `appendVerdict` and a CUT through `appendCut`,
// each carrying the accuracy-vs-baseline / risk-adjusted-vs-baseline metrics.

/** A LivingDocs stub that captures which routing method was called + payload. */
class RecordingDocs {
  readonly verdicts: GateVerdictSummary[] = [];
  readonly cuts: GateVerdictSummary[] = [];

  appendVerdict(summary: GateVerdictSummary): Promise<void> {
    this.verdicts.push(summary);
    return Promise.resolve();
  }

  appendCut(summary: GateVerdictSummary): Promise<void> {
    this.cuts.push(summary);
    return Promise.resolve();
  }
}

/**
 * Build a firing subset of `size` samples whose model-minus-baseline
 * directional accuracy either clears the +3pp Gate 1 margin (`gate1Pass`) or
 * clearly misses it.
 *
 * When passing: every sample has the model correct and the baseline wrong ⇒
 * model accuracy 1.0, baseline 0.0, delta = 1.0 >= 0.03.
 * When failing: model and baseline are identical and both wrong ⇒ delta = 0 <
 * 0.03, so Gate 1 fails on a qualifying (>= 30) subset.
 */
function buildFiringSubset(
  size: number,
  gate1Pass: boolean,
): Gate1FiringSample[] {
  const out: Gate1FiringSample[] = [];
  for (let i = 0; i < size; i += 1) {
    const decisionDate = `2020-01-${String((i % 28) + 1).padStart(2, "0")}`;
    if (gate1Pass) {
      // model correct (UP == UP), baseline wrong (DOWN != UP).
      out.push({
        decisionDate,
        modelPrediction: "UP",
        baselinePrediction: "DOWN",
        actual: "UP",
      });
    } else {
      // model and baseline both wrong and identical ⇒ delta 0.
      out.push({
        decisionDate,
        modelPrediction: "DOWN",
        baselinePrediction: "DOWN",
        actual: "UP",
      });
    }
  }
  return out;
}

/** A forward outcome carrying a chosen MFE/MAE on the selected horizon. */
function outcomeWith(mfePips: number, maePips: number): ForwardOutcome {
  const h = { direction: "FLAT" as DirectionClass, mfePips, maePips };
  return { perHorizon: { 1: h, 2: h, 3: h } };
}

/**
 * Build a single qualifying fold with independently controllable
 * (gate1Pass, gate2Pass).
 *
 * Gate 2's margin is `modelRiskAdj - baselineRiskAdj`, the difference of the
 * mean friction-adjusted net excursions. Giving the model a larger favorable
 * excursion (and smaller adverse) than the baseline makes margin > 0 (pass);
 * the reverse makes margin < 0 (fail). Excursions are inflated well beyond the
 * friction penalty (<= 2 pips) so the sign is unambiguous.
 */
function buildFold(
  pair: Pair,
  horizon: Horizon,
  size: number,
  gate1Pass: boolean,
  gate2Pass: boolean,
): FoldGateInput {
  const firingSubset = buildFiringSubset(size, gate1Pass);

  // Model vs baseline excursions. Large gaps dominate the friction penalty.
  const model = gate2Pass
    ? outcomeWith(50, 5) // favorable net excursion
    : outcomeWith(5, 50); // adverse net excursion
  const baseline = gate2Pass
    ? outcomeWith(5, 50) // baseline much worse than model ⇒ margin > 0
    : outcomeWith(50, 5); // baseline much better than model ⇒ margin < 0

  const modelOutcomes = firingSubset.map(() => model);
  const baselineOutcomes = firingSubset.map(() => baseline);

  return {
    foldIndex: 0,
    pair,
    horizon,
    firingSubset,
    modelOutcomes,
    baselineOutcomes,
  };
}

describe("Property 23: Kill_Gate verdict is PASS iff both Gate 1 and Gate 2 pass", () => {
  it("aggregate verdict of a single qualifying fold equals (gate1 && gate2) ? PASS : CUT", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...PAIRS),
        fc.constantFrom<Horizon>(1, 2, 3),
        fc.integer({
          min: GATE1_SAMPLE_SIZE_FLOOR,
          max: GATE1_SAMPLE_SIZE_FLOOR + 50,
        }),
        fc.boolean(), // intended gate1 pass
        fc.boolean(), // intended gate2 pass
        (pair, horizon, size, gate1Pass, gate2Pass) => {
          const fold = buildFold(pair, horizon, size, gate1Pass, gate2Pass);
          const verdict = composeGateVerdict("cfg-p23", [fold]);

          // The fold qualifies (>= 30), so it drives the aggregate verdict.
          expect(verdict.metrics.qualifyingFolds).toBe(1);
          expect(verdict.metrics.skippedFolds).toBe(0);

          const g1 = verdict.gate1.passed;
          const g2 = verdict.gate2.passed;

          // The intended construction actually produced the intended gate
          // results (sanity that our generators control the gates).
          expect(g1).toBe(gate1Pass);
          // Gate 2 is only evaluated after Gate 1 passes; when Gate 1 fails,
          // Gate 2.passed is false regardless of the intended value.
          expect(g2).toBe(gate1Pass ? gate2Pass : false);

          // Core property: PASS iff both gates passed; otherwise CUT.
          const expected = g1 && g2 ? "PASS" : "CUT";
          expect(verdict.verdict).toBe(expected);

          // Per-fold verdict agrees with the aggregate for the single fold.
          expect(verdict.foldVerdicts[0]?.verdict).toBe(expected);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("all four (gate1, gate2) combinations map to the correct verdict", () => {
    const cases: ReadonlyArray<[boolean, boolean, "PASS" | "CUT"]> = [
      [true, true, "PASS"],
      [true, false, "CUT"],
      [false, true, "CUT"],
      [false, false, "CUT"],
    ];
    for (const [g1, g2, expected] of cases) {
      const fold = buildFold("EURUSD", 1, GATE1_SAMPLE_SIZE_FLOOR, g1, g2);
      const verdict = composeGateVerdict("cfg-p23-matrix", [fold]);
      expect(verdict.verdict).toBe(expected);
    }
  });

  it("logs PASS through appendVerdict and CUT through appendCut, each carrying the metrics", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...PAIRS),
        fc.constantFrom<Horizon>(1, 2, 3),
        fc.integer({
          min: GATE1_SAMPLE_SIZE_FLOOR,
          max: GATE1_SAMPLE_SIZE_FLOOR + 50,
        }),
        fc.boolean(),
        fc.boolean(),
        async (pair, horizon, size, gate1Pass, gate2Pass) => {
          const fold = buildFold(pair, horizon, size, gate1Pass, gate2Pass);
          const verdict = composeGateVerdict("cfg-p23-log", [fold]);

          const docs = new RecordingDocs();
          // logGateVerdict only calls appendVerdict/appendCut; the stub covers
          // exactly that routing surface. LivingDocs carries private members
          // that a structural double cannot supply, so cast the double to it.
          await logGateVerdict(docs as unknown as LivingDocs, verdict);

          if (verdict.verdict === "PASS") {
            // Exactly one appendVerdict call, no appendCut.
            expect(docs.verdicts).toHaveLength(1);
            expect(docs.cuts).toHaveLength(0);
          } else {
            expect(docs.cuts).toHaveLength(1);
            expect(docs.verdicts).toHaveLength(0);
          }

          const logged = verdict.verdict === "PASS" ? docs.verdicts[0] : docs.cuts[0];
          expect(logged).toBeDefined();
          const summary = logged as GateVerdictSummary;

          // The logged summary carries the verdict and metrics line, and the
          // metrics line reports accuracy-vs-baseline and risk-adjusted-vs-baseline.
          expect(summary.verdict).toBe(verdict.verdict);
          expect(summary.metrics).toContain("accuracyVsBaseline=");
          expect(summary.metrics).toContain("riskAdjustedVsBaseline=");

          // The rendered metrics reflect the aggregate gate deltas exactly.
          const round = (v: number): number =>
            Number.isFinite(v) ? Math.round(v * 1e4) / 1e4 : v;
          expect(summary.metrics).toContain(
            `accuracyVsBaseline=${round(verdict.metrics.accuracyVsBaseline)}`,
          );
          expect(summary.metrics).toContain(
            `riskAdjustedVsBaseline=${round(verdict.metrics.riskAdjustedVsBaseline)}`,
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});
