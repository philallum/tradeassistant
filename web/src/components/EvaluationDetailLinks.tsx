/**
 * Unobtrusive explicit-demand affordances for the evaluation detail view (Req 8.3).
 * Plain anchors: hash-only navigation, keyboard accessible, no layout opinions
 * (final placement is decided by the shell).
 */

import { EVALUATION_DETAIL_HASH } from "../routing/evaluationDetail";

/** Opens the evaluation detail view. */
export function EvaluationDetailLink() {
  return (
    <a href={EVALUATION_DETAIL_HASH} data-testid="evaluation-detail-link">
      Evaluation detail
    </a>
  );
}

/** Returns from the evaluation detail view to the single window (clears the hash route). */
export function BackLink() {
  return (
    <a href="#/" data-testid="evaluation-back-link">
      Back
    </a>
  );
}
