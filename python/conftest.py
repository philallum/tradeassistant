"""Pytest bootstrap for the isolated Python cross-check suite.

Placing this conftest at the `python/` root puts that directory on `sys.path`
during collection, so cross-check modules import as `crosscheck.<module>`
regardless of the working directory pytest is invoked from (e.g. the repo-root
`make py-check` target: `python3 -m pytest python/tests`).
"""
