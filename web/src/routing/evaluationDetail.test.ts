import { describe, expect, it } from "vitest";
import { EVALUATION_DETAIL_HASH, isEvaluationDetailHash } from "./evaluationDetail";

describe("isEvaluationDetailHash", () => {
  it("matches the canonical hash and tolerant variants", () => {
    expect(isEvaluationDetailHash(EVALUATION_DETAIL_HASH)).toBe(true);
    expect(isEvaluationDetailHash("/evaluation")).toBe(true);
    expect(isEvaluationDetailHash("#/evaluation/")).toBe(true);
    expect(isEvaluationDetailHash("#/evaluation?pair=EURUSD")).toBe(true);
  });

  it("rejects other hashes", () => {
    for (const h of ["#", "#/", "#/gate", "#/evaluations", "#/x/evaluation"]) {
      expect(isEvaluationDetailHash(h)).toBe(false);
    }
  });

  it("rejects the empty hash", () => {
    expect(isEvaluationDetailHash("")).toBe(false);
  });
});
