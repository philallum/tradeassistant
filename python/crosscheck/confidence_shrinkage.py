"""Confidence sample-size shrinkage — Python cross-check of the TS core.

The TypeScript deterministic core is authoritative (Requirement 3.3, 3.4);
this module is an isolated, deterministic cross-check of the shrinkage formula
and never participates in the live compute path.

Mirrors src/confidence/confidenceSelector.ts:earnedConfidence and the
constants in src/confidence/types.ts:

    C_shrunk = (n / (n + k)) * C_raw + (k / (n + k)) * 0.5   with k = 10

clamped to [0, 1]. `k` (FIXED_PRIOR_WEIGHT) and the neutral prior 0.5
(NEUTRAL_PRIOR) are kept consistent with the TypeScript constants.
"""

# Consistent with src/confidence/types.ts: FIXED_PRIOR_WEIGHT.
FIXED_PRIOR_WEIGHT = 10
# Consistent with src/confidence/types.ts: NEUTRAL_PRIOR.
NEUTRAL_PRIOR = 0.5


def shrink(n: int, c_raw: float, k: int = FIXED_PRIOR_WEIGHT) -> float:
    """Fixed-prior shrinkage of ``c_raw`` toward the neutral prior 0.5.

    :param n: analogue count at the horizon (n >= 0).
    :param c_raw: raw resolution rate in [0, 1].
    :param k: fixed prior weight (default 10, matching the TS core).
    :returns: the shrunk confidence, clamped to [0, 1].
    """
    c_shrunk = (n / (n + k)) * c_raw + (k / (n + k)) * NEUTRAL_PRIOR
    # Clamp to [0, 1] (Requirement 10.2).
    if c_shrunk < 0.0:
        return 0.0
    if c_shrunk > 1.0:
        return 1.0
    return c_shrunk
