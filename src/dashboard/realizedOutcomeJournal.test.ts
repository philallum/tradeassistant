// Tests for the Realized-Outcome Journal — Design Component 19
// (Requirements 25.2, 25.3, 25.4, 25.7).
//
// The Strategy_Source multi-strategy abstraction has been removed
// (Requirement 7.4): the journal keys on (pair, decisionDate) alone and there
// is no `strategyId` in the domain model. These tests cover three behaviours:
//
//   1. The realized side is populated ONLY from matured forward outcomes
//      (candles strictly after the Decision_Date, gated by the shared
//      Look-Ahead Guard); before maturation an entry is predicted-only with
//      `matured=false` and no realized fields.
//   2. Journaling is idempotent per (pair, decision_date): re-running a day
//      never duplicates, and a re-run on a later evalDate updates the same
//      entry in place.
//   3. Boundary: recording journal entries leaves the directional probability /
//      Earned_Confidence / Kill_Gate verdict byte-for-byte identical — the
//      journal never feeds scoring.

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  InMemoryRealizedOutcomeStore,
  journalRealizedOutcomes,
  type FiredSetupPrediction,
} from "./realizedOutcomeJournal.js";
import { dailyRun, type PairEvaluation } from "./dashboard.js";
import {
  InMemoryFiringSetupStore,
  persistFiringSetups,
} from "./persistFiringSetups.js";
import { PAIRS, type Pair } from "../ingestion/types.js";
import type { TradingDate } from "../guard/types.js";
import { isMatured } from "../guard/lookAheadGuard.js";
import { addTradingDays } from "../guard/tradingDate.js";
import type {
  AnalogueRecord,
  DirectionClass,
  ForwardOutcome,
} from "../retrieval/types.js";
import { earnedConfidence, classify, selectHorizon } from "../confidence/index.js";
import type { Horizon } from "../confidence/types.js";
import { composeGateVerdict, type FoldGateInput } from "../kill-gate/index.js";
import type { Gate1FiringSample } from "../kill-gate/index.js";

const DECISION_DATE = "2024-03-15" as TradingDate;

// ---------------------------------------------------------------------------
// Fixtures / helpers
// ---------------------------------------------------------------------------

function prediction(
  pair: Pair,
  o: Partial<FiredSetupPrediction> = {},
): FiredSetupPrediction {
  return {
    pair,
    predictedDirection: o.predictedDirection ?? "UP",
    horizon: o.horizon ?? 2,
    earnedConfidence: o.earnedConfidence ?? 0.82,
    stopLossPips: "stopLossPips" in o ? (o.stopLossPips ?? null) : 15,
    takeProfitPips: "takeProfitPips" in o ? (o.takeProfitPips ?? null) : 40,
  };
}

function forwardOutcome(o: {
  d1?: DirectionClass;
  d2?: DirectionClass;
  d3?: DirectionClass;
}): ForwardOutcome {
  const mk = (direction: DirectionClass) => ({
    direction,
    mfePips: 30,
    maePips: 12,
  });
  return {
    perHorizon: {
      1: mk(o.d1 ?? "UP"),
      2: mk(o.d2 ?? "UP"),
      3: mk(o.d3 ?? "UP"),
    },
  };
}

// ---------------------------------------------------------------------------
// 1. Realized side populated only from matured, strictly-after-date candles
// ---------------------------------------------------------------------------

describe("realized side is matured-only (Requirements 25.2, 25.3)", () => {
  it("before maturation the entry is predicted-only (matured=false, no realized fields)", async () => {
    const store = new InMemoryRealizedOutcomeStore();
    const horizon: Horizon = 2;
    // evalDate == decisionDate ⇒ window not closed (isMatured is false).
    const evalDate = DECISION_DATE;
    expect(isMatured(DECISION_DATE, horizon, evalDate)).toBe(false);

    const [entry] = await journalRealizedOutcomes(
      store,
      DECISION_DATE,
      evalDate,
      [prediction("EURUSD", { horizon })],
      { forwardOutcomes: new Map([["EURUSD", forwardOutcome({ d2: "UP" })]]) },
    );

    expect(entry?.matured).toBe(false);
    expect(entry?.realizedDirection).toBeUndefined();
    expect(entry?.realizedMfePips).toBeUndefined();
    expect(entry?.realizedMaePips).toBeUndefined();
    // The predicted side is still fully recorded.
    expect(entry?.predictedDirection).toBe("UP");
    expect(entry?.horizon).toBe(2);

    // Keyed by (pair, decisionDate) — no strategy dimension.
    const stored = await store.get("EURUSD", DECISION_DATE);
    expect(stored?.pair).toBe("EURUSD");
    expect(store.size()).toBe(1);
  });

  it("once the horizon window has closed the realized side is populated from the resolved outcome", async () => {
    const store = new InMemoryRealizedOutcomeStore();
    const horizon: Horizon = 2;
    // A date well after the 2-day window has closed.
    const evalDate = addTradingDays(DECISION_DATE, 5);
    expect(isMatured(DECISION_DATE, horizon, evalDate)).toBe(true);

    const outcome = forwardOutcome({ d2: "DOWN" });
    const [entry] = await journalRealizedOutcomes(
      store,
      DECISION_DATE,
      evalDate,
      [prediction("EURUSD", { horizon, predictedDirection: "UP" })],
      { forwardOutcomes: new Map([["EURUSD", outcome]]) },
    );

    expect(entry?.matured).toBe(true);
    // Realized side comes from the SELECTED horizon of the resolved outcome.
    expect(entry?.realizedDirection).toBe("DOWN");
    expect(entry?.realizedMfePips).toBe(outcome.perHorizon[2].mfePips);
    expect(entry?.realizedMaePips).toBe(outcome.perHorizon[2].maePips);
    // Prediction is preserved unchanged alongside the realized result.
    expect(entry?.predictedDirection).toBe("UP");
  });

  it("a matured window with no resolved outcome supplied stays predicted-only", async () => {
    const store = new InMemoryRealizedOutcomeStore();
    const horizon: Horizon = 1;
    const evalDate = addTradingDays(DECISION_DATE, 5);
    expect(isMatured(DECISION_DATE, horizon, evalDate)).toBe(true);

    // No forwardOutcomes map ⇒ nothing to pair with; realized side withheld.
    const [entry] = await journalRealizedOutcomes(store, DECISION_DATE, evalDate, [
      prediction("EURUSD", { horizon }),
    ]);

    expect(entry?.matured).toBe(false);
    expect(entry?.realizedDirection).toBeUndefined();
  });

  it("property: the realized side is present iff the selected horizon has matured as of evalDate", async () => {
    const horizonArb = fc.constantFrom<Horizon>(1, 2, 3);
    // evalDate offsets span before, at, and after each horizon window.
    const offsetArb = fc.integer({ min: 0, max: 8 });
    const dirArb = fc.constantFrom<DirectionClass>("UP", "DOWN", "FLAT");

    await fc.assert(
      fc.asyncProperty(horizonArb, offsetArb, dirArb, async (horizon, offset, realizedDir) => {
        const store = new InMemoryRealizedOutcomeStore();
        const evalDate = addTradingDays(DECISION_DATE, offset);
        const matured = isMatured(DECISION_DATE, horizon, evalDate);
        const outcome = forwardOutcome({ d1: realizedDir, d2: realizedDir, d3: realizedDir });

        const [entry] = await journalRealizedOutcomes(
          store,
          DECISION_DATE,
          evalDate,
          [prediction("EURUSD", { horizon })],
          { forwardOutcomes: new Map([["EURUSD", outcome]]) },
        );

        expect(entry?.matured).toBe(matured);
        if (matured) {
          expect(entry?.realizedDirection).toBe(realizedDir);
          expect(entry?.realizedMfePips).toBe(outcome.perHorizon[horizon].mfePips);
          expect(entry?.realizedMaePips).toBe(outcome.perHorizon[horizon].maePips);
        } else {
          expect(entry?.realizedDirection).toBeUndefined();
          expect(entry?.realizedMfePips).toBeUndefined();
          expect(entry?.realizedMaePips).toBeUndefined();
        }
      }),
      { numRuns: 200 },
    );
  });
});

// ---------------------------------------------------------------------------
// 2. Idempotency per (pair, decision_date) (Requirement 25.7)
// ---------------------------------------------------------------------------

describe("journaling idempotency (Requirement 25.7)", () => {
  it("re-running the same day does not duplicate entries", async () => {
    const store = new InMemoryRealizedOutcomeStore();
    const predictions = PAIRS.map((p) => prediction(p));

    await journalRealizedOutcomes(store, DECISION_DATE, DECISION_DATE, predictions);
    await journalRealizedOutcomes(store, DECISION_DATE, DECISION_DATE, predictions);
    await journalRealizedOutcomes(store, DECISION_DATE, DECISION_DATE, predictions);

    // One entry per pair regardless of how many times the day is re-run.
    expect(store.size()).toBe(PAIRS.length);
    const byDate = await store.getByDecisionDate(DECISION_DATE);
    expect(byDate).toHaveLength(PAIRS.length);
  });

  it("a later re-run once the window matures UPDATES the same entry in place (predicted-only → realized)", async () => {
    const store = new InMemoryRealizedOutcomeStore();
    const horizon: Horizon = 2;
    const outcome = forwardOutcome({ d2: "DOWN" });

    // Day of firing: window not yet closed ⇒ predicted-only.
    await journalRealizedOutcomes(
      store,
      DECISION_DATE,
      DECISION_DATE,
      [prediction("EURUSD", { horizon })],
      { forwardOutcomes: new Map([["EURUSD", outcome]]) },
    );
    const before = await store.get("EURUSD", DECISION_DATE);
    expect(before?.matured).toBe(false);
    expect(store.size()).toBe(1);

    // Later evalDate once the window has closed ⇒ same key updated in place.
    const laterEval = addTradingDays(DECISION_DATE, 5);
    await journalRealizedOutcomes(
      store,
      DECISION_DATE,
      laterEval,
      [prediction("EURUSD", { horizon })],
      { forwardOutcomes: new Map([["EURUSD", outcome]]) },
    );

    // Still exactly one entry — updated, not duplicated.
    expect(store.size()).toBe(1);
    const after = await store.get("EURUSD", DECISION_DATE);
    expect(after?.matured).toBe(true);
    expect(after?.realizedDirection).toBe("DOWN");
  });

  it("property: N re-runs on the same (pair, date) leave exactly one entry with the last-written value", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.constantFrom<DirectionClass>("UP", "DOWN", "FLAT"), {
          minLength: 1,
          maxLength: 6,
        }),
        async (directions) => {
          const store = new InMemoryRealizedOutcomeStore();
          let last: DirectionClass = "UP";
          for (const dir of directions) {
            last = dir;
            await journalRealizedOutcomes(store, DECISION_DATE, DECISION_DATE, [
              prediction("EURUSD", { predictedDirection: dir }),
            ]);
          }
          // Same key each time ⇒ exactly one entry, holding the last write.
          expect(store.size()).toBe(1);
          const e = await store.get("EURUSD", DECISION_DATE);
          expect(e?.predictedDirection).toBe(last);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// 3. Boundary: journaling never changes scoring (Requirement 25.4)
// ---------------------------------------------------------------------------

// A neighborhood large enough to be actionable, with a clear directional
// resolution so Earned_Confidence and horizon selection are meaningful.
function neighborhood(): AnalogueRecord[] {
  const records: AnalogueRecord[] = [];
  for (let i = 0; i < 40; i++) {
    for (const horizon of [1, 2, 3] as const) {
      records.push({
        asset: "EURUSD",
        decisionDate: `2020-01-${String((i % 27) + 1).padStart(2, "0")}`,
        horizon,
        // A strong UP majority at every horizon (35/40 UP, 5 DOWN).
        direction: i < 35 ? "UP" : "DOWN",
        mfePips: 30,
        maePips: 10,
        atr14: 12,
        matured: true,
      });
    }
  }
  return records;
}

function gate1Sample(
  decisionDate: string,
  model: DirectionClass,
  baseline: DirectionClass,
  actual: DirectionClass,
): Gate1FiringSample {
  return {
    decisionDate,
    modelPrediction: model,
    baselinePrediction: baseline,
    actual,
  };
}

// A qualifying fold (>=30 firing samples) where the model beats the baseline
// by more than 3pp and its risk-adjusted excursions clear the baseline's —
// enough to make the aggregate verdict deterministic and non-trivial.
function foldInput(): FoldGateInput {
  const firingSubset: Gate1FiringSample[] = [];
  const modelOutcomes: ForwardOutcome[] = [];
  const baselineOutcomes: ForwardOutcome[] = [];
  for (let i = 0; i < 40; i++) {
    // Gate 1 scores model and baseline against the SAME actual outcome, so we
    // vary each side's prediction: model correct 90% of the time, baseline 60%.
    const modelCorrect = i % 10 !== 0;
    const baselineCorrect = i % 10 < 6;
    firingSubset.push(
      gate1Sample(
        `2023-02-${String((i % 27) + 1).padStart(2, "0")}`,
        modelCorrect ? "UP" : "DOWN",
        baselineCorrect ? "UP" : "DOWN",
        "UP",
      ),
    );
    modelOutcomes.push(forwardOutcome({ d2: "UP" }));
    // Baseline has weaker excursions (smaller MFE) so the model clears Gate 2.
    baselineOutcomes.push({
      perHorizon: {
        1: { direction: "UP", mfePips: 5, maePips: 20 },
        2: { direction: "UP", mfePips: 5, maePips: 20 },
        3: { direction: "UP", mfePips: 5, maePips: 20 },
      },
    });
  }
  return { foldIndex: 0, pair: "EURUSD", horizon: 2, firingSubset, modelOutcomes, baselineOutcomes };
}

describe("scoring boundary: journal never feeds scoring (Requirement 25.4)", () => {
  it("Earned_Confidence, Direction_Class, and horizon are byte-for-byte identical with and without journaling", async () => {
    const nb = neighborhood();

    // Baseline scoring, computed BEFORE any journaling.
    const horizonBefore = selectHorizon(nb);
    const confidenceBefore = earnedConfidence(nb, horizonBefore);
    const classBefore = classify(20, 12);

    // Record a firing row AND a journal entry.
    const firingStore = new InMemoryFiringSetupStore();
    const journalStore = new InMemoryRealizedOutcomeStore();
    const evaluations: PairEvaluation[] = [
      {
        pair: "EURUSD",
        earnedConfidence: confidenceBefore,
        direction: "UP",
        horizon: horizonBefore,
        excursionProfile: { favorablePips: 40, adversePips: 15 },
        stopLossPips: 15,
        takeProfitPips: 40,
        choppiness: 0.8,
        rationale: "up",
        analogueLabels: ["trend"],
      },
    ];
    const view = dailyRun(DECISION_DATE, evaluations);
    await persistFiringSetups(firingStore, view, evaluations);
    await journalRealizedOutcomes(
      journalStore,
      DECISION_DATE,
      addTradingDays(DECISION_DATE, 5),
      [prediction("EURUSD", { horizon: horizonBefore, earnedConfidence: confidenceBefore })],
      { forwardOutcomes: new Map([["EURUSD", forwardOutcome({ d2: "UP" })]]) },
    );

    // Re-compute scoring AFTER journaling on the SAME inputs.
    const horizonAfter = selectHorizon(nb);
    const confidenceAfter = earnedConfidence(nb, horizonAfter);
    const classAfter = classify(20, 12);

    // Identical to the last bit — the journal never touches scoring.
    expect(horizonAfter).toBe(horizonBefore);
    expect(confidenceAfter).toBe(confidenceBefore);
    expect(Object.is(confidenceAfter, confidenceBefore)).toBe(true);
    expect(classAfter).toBe(classBefore);

    // Sanity: something was actually recorded.
    expect(firingStore.size()).toBe(5);
    expect(journalStore.size()).toBe(1);
  });

  it("the Kill_Gate verdict is byte-for-byte identical with and without journaling", async () => {
    const fold = foldInput();

    // Verdict computed BEFORE journaling.
    const verdictBefore = composeGateVerdict("cfg-eurusd", [fold]);

    // Record a journal entry.
    const journalStore = new InMemoryRealizedOutcomeStore();
    await journalRealizedOutcomes(
      journalStore,
      DECISION_DATE,
      addTradingDays(DECISION_DATE, 5),
      [prediction("EURUSD")],
      { forwardOutcomes: new Map([["EURUSD", forwardOutcome({ d2: "UP" })]]) },
    );

    // Verdict computed AFTER, on the SAME fold inputs.
    const verdictAfter = composeGateVerdict("cfg-eurusd", [fold]);

    // Deep equality: verdict, gate metrics, and per-fold results all identical.
    expect(verdictAfter).toEqual(verdictBefore);
    expect(journalStore.size()).toBe(1);
  });

  it("property: for any recorded prediction, scoring on fixed inputs is unchanged", async () => {
    const nb = neighborhood();
    const horizon = selectHorizon(nb);
    const confidenceRef = earnedConfidence(nb, horizon);
    const verdictRef = composeGateVerdict("cfg", [foldInput()]);

    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<DirectionClass>("UP", "DOWN", "FLAT"),
        async (predictedDir) => {
          const store = new InMemoryRealizedOutcomeStore();
          await journalRealizedOutcomes(
            store,
            DECISION_DATE,
            addTradingDays(DECISION_DATE, 5),
            [prediction("EURUSD", { predictedDirection: predictedDir })],
            { forwardOutcomes: new Map([["EURUSD", forwardOutcome({})]]) },
          );

          // Recording a prediction leaves scoring identical.
          expect(earnedConfidence(nb, horizon)).toBe(confidenceRef);
          expect(composeGateVerdict("cfg", [foldInput()])).toEqual(verdictRef);
        },
      ),
      { numRuns: 100 },
    );
  });
});
