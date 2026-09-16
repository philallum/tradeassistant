"""Placeholder hypothesis cross-check so the Python step runs deterministically.

Real statistical cross-checks (e.g. the confidence-shrinkage distribution in
task 5.8) replace this. `derandomize=True` keeps the step deterministic.
"""

from hypothesis import given, settings, strategies as st


@settings(max_examples=100, derandomize=True)
@given(st.integers())
def test_identity_is_stable(n: int) -> None:
    assert n + 0 == n
