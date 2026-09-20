"""Hypothesis cross-check of the confidence shrinkage formula.

Cross-checks the TypeScript-authoritative shrinkage formula
(src/confidence/confidenceSelector.ts:earnedConfidence) for:

  * determinism: identical inputs -> identical output (Requirement 3.1, 10.7),
  * boundedness: the result stays within [0, 1] (Requirement 10.2),
  * closed form: it matches C_shrunk = (n/(n+k))*C_raw + (k/(n+k))*0.5, k=10.

`derandomize=True` keeps the isolated cross-check step deterministic
(Requirement 3.4), consistent with the existing scaffold test.
"""

from hypothesis import given, settings, strategies as st

from crosscheck.confidence_shrinkage import (
    FIXED_PRIOR_WEIGHT,
    NEUTRAL_PRIOR,
    shrink,
)

# Non-negative analogue counts, including 0 (empty neighborhood).
n_strategy = st.integers(min_value=0, max_value=100_000)
# Raw resolution rate in [0, 1].
c_raw_strategy = st.floats(
    min_value=0.0,
    max_value=1.0,
    allow_nan=False,
    allow_infinity=False,
)


@settings(max_examples=200, derandomize=True)
@given(n=n_strategy, c_raw=c_raw_strategy)
def test_shrink_is_deterministic(n: int, c_raw: float) -> None:
    assert shrink(n, c_raw) == shrink(n, c_raw)


@settings(max_examples=200, derandomize=True)
@given(n=n_strategy, c_raw=c_raw_strategy)
def test_shrink_is_bounded(n: int, c_raw: float) -> None:
    result = shrink(n, c_raw)
    assert 0.0 <= result <= 1.0


@settings(max_examples=200, derandomize=True)
@given(n=n_strategy, c_raw=c_raw_strategy)
def test_shrink_matches_closed_form(n: int, c_raw: float) -> None:
    k = FIXED_PRIOR_WEIGHT
    expected = (n / (n + k)) * c_raw + (k / (n + k)) * NEUTRAL_PRIOR
    assert shrink(n, c_raw) == expected


@settings(max_examples=200, derandomize=True)
@given(c_raw=c_raw_strategy)
def test_empty_neighborhood_is_neutral_prior(c_raw: float) -> None:
    # With n = 0 the whole weight lands on the neutral prior, regardless of C_raw.
    assert shrink(0, c_raw) == NEUTRAL_PRIOR
