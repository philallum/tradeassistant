"""Isolated, deterministic Python statistical cross-checks.

The TypeScript deterministic core is authoritative (Requirement 3.3, 3.4).
Modules here are invoked only as discrete, deterministic verification steps
(e.g. shrinkage-distribution checks) and never participate in the live
compute path.
"""
