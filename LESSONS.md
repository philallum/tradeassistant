# LESSONS.md — Hard-Won Lessons (read first)

> Captures PROJECT-PLAN section 0. These lessons are *constraints*, not
> suggestions — every task in the plan exists to honor one of them. This file
> is maintained by the Living-Docs Writer (Requirement 5.3) so the "why"
> survives context resets.

This is a greenfield personal trading assistant for 5 major FX pairs. It is the
successor to a prior FX forecasting system that failed in instructive ways.

- **A point-in-time "fingerprint" cannot predict short-horizon direction.** The
  prior system encoded market state as a 62-dimensional snapshot vector and tried
  to predict the next 4-hour candle. It reached ~52.15% directional accuracy —
  statistically a coin flip. Two compounding errors: a *static snapshot* (no
  path/sequence information) and the *4-hour horizon* (noisiest, most
  microstructure-driven timeframe).
- **High dimensionality diluted the signal.** 62 dimensions in one distance
  metric caused distance concentration (curse of dimensionality) — everything
  looked equidistant. Lesson: **ruthless dimensional minimalism.** Start at 1
  feature; each new one must *earn* inclusion. Hard ceiling ~12.
- **The most promising idea was never measured.** A candle-*trajectory*
  representation (sequence of shape/%B/RSI) was built but never wired into a live
  measurement — it stayed a hopeful intuition. Lesson: **measure before
  believing. Nothing drives a displayed signal until it beats a baseline
  out-of-sample.**
- **News is a filter, not a signal.** Attempts to predict *from* news failed. The
  only robust finding: don't trade into elevated event risk. Lesson: **event risk
  suppresses signals; it never generates them.**
- **The engineering discipline was the real success.** Strict code quality,
  pure/deterministic computation, look-ahead guards, spec-driven development, and
  living documentation are carried forward as non-negotiable.
- **AI division of labor (hard rule):** **AI explains and filters; deterministic
  code decides and scores.** An LLM may read news, write plain-language rationale,
  describe analogues qualitatively, and help interpret results. An LLM must
  **never** compute the directional probability or the kill-gate verdict — those
  must be pure, reproducible, backtestable math, or the system becomes
  unfalsifiable (the exact trap that sank the prior project).
