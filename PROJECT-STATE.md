<!-- LIVING-DOCS:PROJECT-STATE -->
# PROJECT-STATE.md — Comprehensive Project Reference

> **Purpose.** This is the single document that gives anyone — a new teammate, a
> reviewer, or Kiro picking the project up cold — a complete, accurate picture of
> the FX Daily Pattern Trading Assistant: what it is, the technology stack, the
> architecture, how the calculations actually work (with the real formulas and
> constants), the data model, the cloud/ops setup, and how to extend it safely.
> Read this top to bottom and you understand the system well enough to plan and
> scope enhancements.
>
> **How this document stays accurate.** The fast-moving detail lives in
> auto-updated satellite docs under `docs/state/` so this reference stays stable:
> - [`docs/state/CODE-MAP.md`](docs/state/CODE-MAP.md) — per-module descriptions, updated as code lands.
> - [`docs/state/DECISIONS.md`](docs/state/DECISIONS.md) — append-only architecture/design decision log.
> - [`docs/state/RISKS.md`](docs/state/RISKS.md) — open risks, obstacles, dependency triage.
> - [`docs/state/NEXT-STEPS.md`](docs/state/NEXT-STEPS.md) — the live to-do / what-comes-next list.
> - [`docs/state/CHANGELOG.md`](docs/state/CHANGELOG.md) — the per-turn session journal (newest-first).
>
> The one-line "where we are right now" lives in the machine-managed STATE block
> below (rewritten in place by `LivingDocs.updateState()` and the
> `update-living-docs` hook — do not hand-edit its three lines except to correct
> a factual error; its BEGIN/END markers must each appear exactly once in this
> file). Everything outside that block is durable, human/agent-authored reference
> and is preserved verbatim across machine updates. Kill-gate verdicts belong in
> `RESEARCH-LOG.md`; hand-authored hard constraints belong in `LESSONS.md`. Never
> write a secret value into any doc — reference credentials by name only.

<!-- BEGIN STATE -->
- **Phase:** v1 feature-complete and LIVE. `multi-strategy-confluence-engine`, Signal Scorecard and `intraday-validation` (snapshot schema v8) are all LIVE; the intraday republish bug is fixed, deployed and live-verified. An evidence-first hardening pass (snapshot v9, offline evidence tools) is implemented locally and NOT deployed. Delivery cadence: operator merges dev->main to deploy; agent builds/verifies locally.
- **Updated:** 2026-11-10
- **Summary:** Evidence-first hardening and the lightweight upgrades are committed on `dev` and merged to `main` (PR #73; live deployment not re-verified here). The offline research code (`src/ops/research/`) is local only: gitignored, never pushed or deployed (backup branch `research/edge-bench`); its reports are in `docs/research/`. Research Evidence Reports 1 to 4 (XTB costs) found no proven edge for the pattern or the four rule strategies; reversal held 5 sessions is an unconfirmed lead; the locked holdout 2025-09-16..2026-09-15 is unread. Pattern research is stopped and kept local as a backtest bench; nothing from it goes to production (NEXT-STEPS 0n, 0m).
<!-- END STATE -->

---

## 1. What this project is

A personal, local-first **FX Daily Pattern Trading Assistant** for the five major
pairs (EURUSD, GBPUSD, USDJPY, USDCHF, USDCAD). Once per trading day it surfaces a
small number of high-conviction, forward-looking directional setups — "a pattern
is emerging; over the session after the Decision_Date, direction X, earned confidence C%" — and
stays **silent** otherwise. It is the successor to a prior forecasting system that
failed instructively; the lessons from that failure are hard constraints that live
in `LESSONS.md`.

**Two non-negotiable principles govern every design choice:**

1. **Measure before believing.** The system is judged out-of-sample against a
   defined baseline - a naive weekly-trend-follow rule - through a two-stage
   measurement (Gate 1 directional, Gate 2 risk-adjusted; §5.8). In the *live* path
   that measurement is a **human-read evaluation report with no PASS/CUT verdict**:
   it does not block firing (the firing rule is the single predicate in §5.7), and
   numbers that have not earned their keep are labelled "unvalidated" rather than
   hidden. The measured edge is small (§5.8), and the documents say so.
2. **AI explains and filters; deterministic code decides and scores.** An LLM may
   read news, write display rationale, label analogues, and help interpret
   results. It must **never** compute the directional probability, the confidence,
   or the kill-gate verdict. This boundary is enforced in the type system
   (`Deterministic<T>` vs `LlmTagged<T>`) and by a standing guard test.

A promoted third principle (from `trader-edge-validation`): **nothing is presented
as more certain than the evidence supports** — un-validated numbers are labelled
as such in the UI, and "strength is not a probability."

`PROJECT-PLAN.md` is the original plan and is partly superseded (see the banner at its
top); `.kiro/specs/` holds the specs still in the repository - several older specs these
docs cite by name are no longer in the working tree, so their requirement numbers cannot
be re-verified from the repo. This document tracks the *system as built*.

---

## 2. Technology stack

- **Core language:** TypeScript on Node `>=22 <23` (`.nvmrc` pins the line), ESM
  (`"type": "module"`). The deterministic core has **no runtime dependencies** —
  it uses Node 22 built-in `fetch`/`http` only. No vendor SDKs (not even for
  Supabase, GCP, or the LLM — all are reached over `fetch`).
- **TypeScript config:** ES2022 / NodeNext, `strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `isolatedModules`.
  Deliberately strict.
- **Testing:** Vitest + fast-check (property-based testing) — the sole authority.
  Run `npm test` and `cd web && npm test` for the current test counts (they are deliberately not recorded here; they go stale on every change). Property tests encode
  the mathematical invariants (shrinkage monotonicity, scale-invariance of the
  encoder, UP/DOWN symmetry of confluence, look-ahead safety, etc.).
- **Tooling:** ESLint 9 + typescript-eslint. All dependencies exact-pinned (no
  ranges). A custom `version-policy` audit (`scripts/version-policy.mjs`) guards
  version drift and enforces supported major-version ceilings.
- **Storage:** Supabase Postgres + **pgvector** for pattern-vector ANN retrieval.
  Local vs hosted target selected via `SUPABASE_TARGET`. Schema is managed by SQL
  migrations under `supabase/migrations/`.
- **Cloud (GCP, project `trade-assistant-508806`, region `europe-west1`):** a
  Cloud Run **Job** runs the scheduled daily refresh; Cloud Scheduler triggers it
  (`30 17 * * 1-5` America/New_York as observed live 2026-11-06 — see RISKS re: the
  close-time publication-lag issue). A SECOND, separate Cloud Run Job
  (`intraday-validation-run`, same image, `intradayMain` entrypoint) is triggered by
  its own Scheduler job at `0 7 * * 1-5` Europe/London (§5.11); Secret Manager holds
  all runtime secrets; Cloud Build + Artifact
  Registry build SHA-pinned images; CI authenticates keylessly via Workload
  Identity Federation / OIDC (no stored SA key).
- **Serving / UI:** a React + Vite + TypeScript SPA (`web/`) on Firebase Hosting,
  strictly read-only. It fetches ONE static `dashboard.json` snapshot that the
  Cloud Run Job writes to a public-read GCS bucket at the end of each run (CORS
  allows the custom domain). There is no API server and no live DB access from the
  browser — the former read-proxy was deleted.
- **External providers (keys in Secret Manager, read at runtime):** OHLC market
  data (FCS, Twelve Data, Massive — a fallback chain), a third-party reference
  signal (FCS), Twelve Data `interval=4h` for the intraday validation layer (a
  separate isolated client, not part of the chain), and Google Vertex AI (Gemini)
  for the display-only LLM layer. All are **data/LLM inputs only** — never scoring
  inputs.

---

## 3. Architecture at a glance

The system is a **deterministic compute core** wrapped by **I/O adapters** and a
**read-only serving path**. Data flows one direction: candles in → deterministic
evaluation → persisted rows → a published JSON snapshot → the SPA.

```
                          ┌─────────────────────── Cloud Run Job (daily) ───────────────────────┐
  OHLC providers ──fetch──▶ Candle_Freshness_Stage ──▶ runDailyPipeline (×5 pairs) ──▶ dailyRun  │
  (TwelveData→Massive, hourly)        │ idempotent upsert        │ deterministic core     │ firing   │
                                  ▼                          ▼                        ▼ decision │
                           Supabase: candles          Supabase: pattern_vectors   firing_setups  │
                                                        analogue_outcomes         realized_out…  │
                                                                                  signal_pred…   │
  Vertex AI (Gemini) ─fetch─▶ display-only rationale/daily-note (LLM-tagged, never scored)       │
  FCS reference ─────fetch─▶ third-party signal (display + confluence input, never scored)       │
                                  │                                                              │
                                  ▼  end of run                                                  │
                           buildDashboardSnapshot → dashboard.json → GCS (public-read)           │
                          └──────────────────────────────────────────────────────────┬──────────┘
                                                                                       ▼
                                                             Firebase-hosted React SPA (read-only)
                                                             fetch dashboard.json → pure shapers → UI
```

**Layering and boundaries that matter:**

- **Deterministic core** (`src/pipeline`, `encoder`, `retrieval`, `confidence`,
  `baseline`, `risk-boundaries`, `kill-gate`, `dashboard`, `strategies`, `guard`):
  pure functions of their inputs — no clock, randomness, network, or storage. This
  is what makes the whole system property-testable and reproducible.
- **Storage ports** (`src/storage`, and the `*Store` interfaces throughout):
  every persistent collection is behind a PORT with an in-memory reference
  implementation and a Supabase adapter. Compute never touches Supabase directly.
  Adapters read **fail-safe** (a missing table or transient error degrades to an
  empty result, never a crash) so additive migrations and torn deploys are
  harmless.
- **AI/Deterministic boundary:** LLM output is branded `LlmTagged<T>`; scoring
  inputs are `Deterministic<T>`. (`ScoringInputGuard` is a runtime guard exercised by
  tests; production relies on the compile-time types plus the import-boundary test,
  not a runtime call.) A `ScoringInputGuard` + a standing import-boundary
  test prevent any LLM value from reaching the probability/confidence/kill-gate
  paths.
- **Look-ahead safety:** the `guard` module (`assertPastOnly`, `isMatured`,
  `maturedPreDateOnly`) is threaded through every feature computation so no candle
  dated on or after the Decision_Date can ever influence a decision for that date,
  and no forward outcome counts until its full horizon window has closed.
- **Read/serve separation:** the daily Job is the sole writer; the SPA only ever
  reads a static snapshot. A compute/storage/serving separation guard enforces it.

---

## 4. The daily run, end to end

Entry point: `src/scheduled-run/main.ts` (the Cloud Run Job). One run does the
following, in order:

1. **Resolve config & Decision_Date** (`src/scheduled-run/config.ts`). The
   Decision_Date is derived from the America/New_York clock: a run at or after the
   17:00 NY session close is labelled the **next** trading day (so the run uses the
   candle that just closed while the "candles strictly before the Decision_Date"
   rule stays intact). `RUN_DECISION_DATE` overrides verbatim. Weekends are skipped.
2. **Candle_Freshness_Stage** (`src/scheduled-run/candleFreshness.ts`). Before the
   pipeline reads history, bring every pair's candles up to the most recent
   completed trading day via the provider fallback chain
   **Twelve Data → Massive** (`src/ingestion/ohlcFeed/`; each daily candle is built from HOURLY bars on the 17:00 NY close by `src/ingestion/sessionAggregation.ts`, closed + complete sessions only; FCS is no longer a candle source), writing through the
   idempotent, Look_Ahead_Safe `OhlcIngestion` path. A one-day top-up uses
   `fetchLatest` (the single newest closed session); a multi-day gap uses `fetchRange`. Fail-safe with a bounded retry (default 3×120s); if pairs are
   still behind it logs a high-severity `candle_freshness.degraded` event and
   proceeds on existing history (the run never crashes on a provider hiccup).
3. **`runDailyPipeline`** (`src/pipeline/dailyPipeline.ts`) evaluates all five
   pairs (see §5) → `PairEvaluation[]`.
4. **`dailyRun`** (`src/dashboard/dashboard.ts`) applies the firing rule and
   produces the `DashboardView` (the firing cards). Persisted to `firing_setups`.
5. **Realized-outcome journal** + **signal scorecard**: reconcile prior
   predictions whose horizon has now matured, and record today's per-signal
   directions (see §5.10, §6). The per-run Confluence_Matrix is built ONCE
   (`buildRunMatrix`) and shared by the scorecard and the `confluence` snapshot slice.
6. **Display-only producers** (fail-safe, never block the run): Gemini rationale
   per firing pair, a whole-day AI note, and the third-party reference comparison.
7. **Snapshot publish**: `buildDashboardSnapshot` assembles `dashboard.json`
   (today's view merged on top of history read back from the source-of-truth
   rows) and the GCS `SnapshotSink` uploads it to the public bucket. A failed
   snapshot write is logged and swallowed — it can never corrupt the DB rows.

The **same deterministic path** runs locally for the dashboard, so an unattended
run reproduces an equivalent local run.

---

## 5. How the calculations work (the deterministic core)

This is the heart of the system. Every formula below is the real one in the code;
file and function references are given so you can verify or extend them.

### 5.1 Per-pair evaluation pipeline — `src/pipeline/dailyPipeline.ts`

`evaluatePair(pair, decisionDate, deps, config)` runs these stages for one pair:

1. **Trailing window.** Read candles strictly before the Decision_Date; keep the
   last `windowSize` (default **60**) trading days.
2. **Encode** the window into a Pattern_Vector (§5.2).
3. **Retrieve** the Analogue_Neighborhood by vector similarity (§5.3).
4. **Select horizon**, compute **Earned_Confidence**, and read the neighborhood's
   **dominant Direction_Class** (§5.4).
5. **Derive empirical Stop_Loss / Take_Profit** from the neighborhood (§5.5).
6. **(Display-only)** choppiness metric and expected candle-size forecast.

Output: a `PairEvaluation { pair, direction, horizon, earnedConfidence,
excursionProfile, stopLossPips|null, takeProfitPips|null, choppiness, … }`.

Config: `DEFAULT_PIPELINE_CONFIG = { retrieval: { k: 200, epsilon: 0.2 },
windowSize: 60 }` (`src/pipeline/types.ts`).

### 5.2 Pattern-vector encoder — `src/encoder/`

A candle window becomes a fixed **70-dimensional, shape-only** vector
(`encodePatternVector`):

- Take the most recent **10, 20, and 40** closes (left-pad if short).
- **Normalize each scale independently** with a population Z-score
  (`normalizeShapeSlice`): `z_i = (p_i − mean) / stdDev`. A zero-variance slice
  returns zeros. This makes the vector **scale-invariant** — only the *shape* of
  the recent price path matters, not its absolute level or volatility.
- Concatenate: `embedding = [...scale10, ...scale20, ...scale40]` → `dim = 70`.
- Attach `weeklyTrendSign`: `UP` if `Close_T − Close_{T−5} ≥ 0` else `DOWN`
  (a scale-invariant 5-trading-day rolling ROC sign; used as a retrieval
  pre-filter and as the baseline).

### 5.3 Analogue retrieval — `src/retrieval/`

`retrieve(...)` finds historical days whose recent shape resembles today's:

1. **ANN query** (`vectorStore.queryNearest`) pre-filtered to the same
   `weeklyTrendSign` and excluding today's date (self-exclusion). Over-fetches
   `max(10k, 200)` candidates.
2. **Strictly pre-date + similarity cutoff:** keep candidates with
   `decisionDate < today` and `cosineDistance ≤ epsilon` (default **0.2**).
3. **Matured-only:** keep only dates with a matured forward outcome
   (`maturedPreDateOnly` — the horizon window must have fully closed). This is the
   look-ahead firewall.
4. **Stable sort** by cosine distance, then date, then asset; take top-`k`
   (default **200**).

**Cosine distance** (`computeCosineDistance`, `src/encoder/types.ts`):
`distance = 1 − dot(a,b)/(‖a‖·‖b‖)`, range `[0, 2]`. It is computed **client-side**
(in Node) rather than via server-side pgvector `<=>` because float4 `<=>` differs
from this computation by up to ~3.8e-8, which could change near-tie ordering; the
client-side computation keeps retrieval byte-identical regardless of backend.

**Forward-outcome resolver** (`resolve`, `resolver.ts`) runs OFFLINE at
ingestion/backfill time (never in the daily path) and populates
`analogue_outcomes`. For each analogue and horizon `h ∈ {1,2,3}` it computes, from
candles strictly after the analogue date:

- `direction` via the ATR-scaled FLAT band (see the unit-mismatch note in RISKS),
- `MFE` (max favorable excursion) and `MAE` (max adverse excursion) in pips.

### 5.4 Confidence, direction, and horizon — `src/confidence/`

**Earned_Confidence** via fixed-prior shrinkage (`earnedConfidence`):

```
C_raw    = dominant directional count / n     (fraction resolving to the dominant UP/DOWN at the horizon; FLAT counts against)
C_shrunk = (n / (n + k)) · C_raw + (k / (n + k)) · 0.5        with k = FIXED_PRIOR_WEIGHT = 10
result   = clamp(C_shrunk, 0, 1)
```

Because `k` is fixed, a thin neighborhood (small `n`) is pulled toward the neutral
prior 0.5, but only moderately: **a unanimous neighborhood of 5 earns 0.667, above the
0.55 firing line.** The 30-analogue figure is NOT enforced for firing (it only gates the
empirical SL/TP). Measured 2013-2024: 79% of firing days had fewer than 30 analogues
(RISKS, RESEARCH-LOG 2026-11-10).

**Direction** (`dominantDirection`): tally UP vs DOWN at the selected horizon; ties
and all-FLAT resolve to **FLAT** (so the pair does not fire).

**Horizon selection** (`selectHorizon`): pick the horizon (1, 2, or 3) with the
highest raw resolution rate; ties break toward the **shorter** horizon.

> **In practice the system is horizon-1 only (decision R1, 2026-11-08).** The stores
> hold matured outcomes for all three horizons, but `retrieve()` collapses them to ONE
> representative record per analogue date - the smallest horizon - so every
> horizon-aware consumer sees `n = 0` at horizons 2 and 3. Consequently a firing pair
> always reports horizon 1, and when the horizon-1 rate is below 0.5 `selectHorizon`
> lands on an empty horizon whose Earned_Confidence is exactly the 0.5 prior and whose
> direction is FLAT - so that pair cannot fire. SL/TP and the excursion profile are
> horizon-1 numbers. This is the documented, tested contract
> (`src/retrieval/horizonContract.test.ts`); making 1/2/3 real would change
> confidence, firing and the headline result and is a separate future spec.

**ATR_14** (`computeAtr14`): the simple mean of True Range over the last 14 days
(`TR = max(high−low, |high−prevClose|, |low−prevClose|)`). Note: a *simple* mean,
not Wilder smoothing.

**FLAT dead-band** (`classify`): a net move is FLAT iff `|move| ≤ |ATR_14| · 0.5`,
else UP/DOWN by sign — ATR-scaled, never a fixed pip constant.

### 5.5 Empirical risk boundaries — `src/risk-boundaries/`

From the firing neighborhood's excursion distribution at the selected horizon
(`derive`):

- **Stop_Loss = 75th percentile of the neighborhood MAE** distribution (pips).
- **Take_Profit = 50th percentile (median) of the neighborhood MFE** distribution.
- Returns `null` (not actionable) when fewer than **30** analogues at the horizon
  (`RISK_BOUNDARY_FLOOR`). Percentiles use linear interpolation between ranks
  (numpy/Excel `PERCENTILE.INC`).

### 5.6 The baseline (null hypothesis) — `src/baseline/`

`predictBaseline` is simply `weeklyTrendSign` — `UP` if the 5-day ROC ≥ 0 else
`DOWN`, never FLAT. The system must beat this matched, conditional baseline.

### 5.7 The firing decision — `src/dashboard/`

```
fires(evaluation) ≡ evaluation.direction !== "FLAT"
                 && evaluation.earnedConfidence >= DEFAULT_CONFIDENCE_THRESHOLD   (= 0.55)
```

`dailyRun` iterates the five pairs in canonical order and renders each firing pair
as a `FiringCard { pair, direction, horizon, earnedConfidence, excursionProfile,
stopLossPips|null, takeProfitPips|null, rationale, analogueLabels }`. There is **no
suppressor** (the old choppiness and currency-concentration guards were removed);
empty cards ⇒ a silent day.

### 5.8 The kill-gate / evaluation — `src/kill-gate/`

Measures (out-of-sample) whether the pattern signal beats the baseline. Two
stages, evaluated over walk-forward folds (a fold with < 30 firing dates is
skipped). The thresholds below are the *former* pass/fail rules; they now survive only
as the non-binding annotations on the report:

- **Gate 1 (directional):** on the matched firing subset, `deltaPp =
  modelAccuracy − baselineAccuracy`; passes iff `≥ 30` samples **and** `deltaPp ≥
  0.03` (3 percentage points).
- **Gate 2 (risk-adjusted):** only if Gate 1 passed. Deduct a pair-specific
  Friction_Penalty (1.5 pips majors / 2.0 pips JPY-CHF-CAD) symmetrically from
  MFE/MAE, reduce each side to a mean net-excursion "hit" metric, and pass iff
  `modelRiskAdj − baselineRiskAdj ≥ 0`.

The **active** write path is `composeEvaluationReport`, which reuses the exact gate
math but emits a human-read `EvaluationReport` with **no PASS/CUT verdict** — the
thresholds survive only as non-binding `annotations`, plus a deterministic 95%
Wald CI on the accuracy delta (`z = 1.959963984540054`, conservative single-
proportion SE at p=0.5, widening as n shrinks, LOW-N caveat below 30). Reports
persist to `evaluation_reports`; a matching entry is appended to `RESEARCH-LOG.md`.

The earlier PASS/CUT path (`composeGateVerdict`, the `gate_verdicts` tables, `ops/gate-run`
and the staged-runner `backtest` stage) was **removed** in the codebase-housekeeping spec.
Nothing in the live firing path ever consulted it; the report path shares its gate math.

*(As a measured finding: the first OOS evaluation recorded model accuracy 0.4996 vs
baseline 0.4871 — delta +1.24pp, CI excludes zero but below the 3pp bar — i.e. the
shape-only pattern beats the naive baseline by a small, statistically-positive but
practically-marginal margin. Recorded as a finding, no verdict.)*

### 5.9 The six strategies + Confluence_Engine — `src/strategies/`

Six signal producers share one `StrategySignal { strategyId, direction, strength
∈ [0,1], rationale }` contract. Four are classical and computed from candles; two
are adapters over existing producers:

| Signal | Rule (direction) | Strength |
| --- | --- | --- |
| **trend** | EMA(20) vs EMA(50) gap AND slope agree | `clamp01(|gap| / ATR)` |
| **breakout** | close breaks a 20-day Donchian channel (channel excludes the breakout candle) | `clamp01(distance / ATR)` |
| **range** | close pierces a Bollinger band (20, 2σ) AND RSI14 agrees (<30 / >70) | mean of band-penetration + RSI-distance scores |
| **reversal** | price extended > 2·ATR from SMA(20) AND momentum fading (contrarian) | `clamp01((|extension| − 2) / 2)` |
| **custom_pattern** | the analogue pattern-matcher's Direction_Class (§5.4) | its Earned_Confidence |
| **third_party** | an external provider's BUY/SELL/HOLD (FCS) | normalized score, display-only |

The **Confluence_Engine** (`confluenceEngine.ts`) combines them into one read:

```
score = clamp( Σ w_i · sign(direction_i) · strength_i / Σ w_i , −1, 1 )
```

Default weights are 1 for the five computed signals and **0 for third_party**
(display-only until validated). Classification: a strongly-opposing UP and DOWN set
(both `strength ≥ conflictThreshold = 0.5`) forces **CONFLICT_FLAT** ("stay flat on
conflict"); otherwise with ≥2 contributors, `score == 0 ⇒ NEUTRAL`,
`score ≥ alignmentThreshold (0.4) ⇒ ALIGNED_UP`, `≤ −0.4 ⇒ ALIGNED_DOWN`, else
NEUTRAL. The explicit `score==0 ⇒ NEUTRAL` rule preserves UP/DOWN symmetry.

**The confluence read is advisory/parallel — it never changes the firing decision,
the Earned_Confidence, or the 0.55 threshold.** It is surfaced on the dashboard and
labelled `unvalidated`.

### 5.10 Signal scorecard (predicted-vs-actual ledger) — `src/dashboard/signalScorecard.ts`

Records each of the six signals' daily UP/DOWN/FLAT call per pair
(`recordPredictions`, from the confluence matrix), then on a later run fills the
realized next-session direction and whether the call was right
(`reconcileOutcomes`, using the shared "sign of the next session's open-to-close"
rule; FLAT is an unscored abstention). Persisted to `signal_predictions`, surfaced
in the v7 snapshot `signalScorecard` slice and the SPA's per-strategy "Recorded:
right X of Y (N pending)" line. It captures the non-replayable third_party signal
that the replay-based `trackRecord` cannot.

**Replay guard.** `third_party` is a LIVE external read (the provider's "latest"
endpoint) and cannot be reconstructed for a past date. When the run's Decision_Date is
not the live trading date (an explicit `RUN_DECISION_DATE` replay, see
`isLiveDecisionDate`), the recorder omits ONLY that signal and logs
`signal_scorecard.third_party_skipped`. The other five signals are pure functions of
stored candles and replay correctly. The normal scheduled run is unaffected.

### 5.11 Intraday 4H validation (read-only enrichment) — `src/intraday-validation/`

A small layer AROUND the immutable daily forecast, not a second forecasting system.
The next morning (07:00 Europe/London, roughly 12 hours after the 17:30 NY daily
run), a SEPARATE Job answers one narrow question: "does
the currently-forming 4H candle support or contradict the original daily direction?"
It never reruns the pipeline, never writes a daily-path table, and never changes the
original direction, Earned_Confidence, firing, or kill-gate. Any failure degrades to
"validation unavailable" with the daily forecast untouched.

- **Flow** (`src/scheduled-run/intradayMain.ts`, Cloud Run Job `intraday-validation-run`,
  Scheduler `0 7 * * 1-5` Europe/London): read the PUBLISHED `dashboard.json`
  (`publishedSnapshot.ts`, public GCS read) → take every evaluated pair's original
  direction + confidence from its `pairEvaluations` (fired or not; falls back to fired
  `firing_setups` only if unreadable) → fetch the forming 4H bar per pair → classify →
  persist to `intraday_validations` → republish the SAME snapshot with ONLY the
  `intradayValidation` key (+ schemaVersion) replaced. It SKIPS the republish if there is
  no readable snapshot for the Decision_Date, so it can never publish a degraded file.
- **4H data:** `src/ingestion/intradayFeed/twelveDataIntraday.ts` calls Twelve Data
  `/time_series?interval=4h&timezone=UTC` (key `TWELVE_DATA_API_KEY`), keeping the full
  intraday timestamp (the daily adapters floor to a UTC day and cannot serve 4H). It is
  fail-safe (typed secret-free errors) and sits OUTSIDE `OhlcFeedProvider` / the chain.
- **Forming bar** (`formingBar.ts`): 4H bars sit on fixed UTC boundaries
  (00/04/08/12/16/20). The forming bar at `now` is the one with `open ≤ now < open+4h`;
  a provider bar that does not match is treated as stale → unavailable. No fixed UTC
  offset, so UK/NY daylight saving is automatic.
- **Features** (`features.ts`, pip-agnostic ratios): `range = high−low`,
  `body = current−open`, `bodyToRange = |body|/range`, `upperWick`, `lowerWick`,
  `pricePositionInRange = (current−low)/range`. Zero range / non-finite OHLC degrade
  safely (never NaN).
- **Classification** (`classify.ts`, provisional UNVALIDATED `THRESHOLDS`): body
  direction vs the original direction D; `bodyToRange < 0.25` → NEUTRAL; same direction
  → SUPPORTS, or STRONGLY_SUPPORTS when `bodyToRange ≥ 0.5` AND price near the favourable
  extreme (`≥0.66` for UP, `≤0.34` for DOWN) AND a favourable-side rejection wick;
  opposite direction → CONTRADICTS / STRONGLY_CONTRADICTS symmetrically; FLAT original →
  NOT_APPLICABLE. Each result carries a plain-language reason.
- **Confidence delta:** STRONGLY_SUPPORTS +10, SUPPORTS +5, NEUTRAL 0, CONTRADICTS −5,
  STRONGLY_CONTRADICTS −10 percentage points (bounded, symmetric);
  `currentConfidence = clamp(original + delta, 0, 100)`. The original confidence is
  stored untouched and the delta/current are separate fields. This is a deterministic
  display adjustment, NOT a calibrated probability ("strength is not a probability"); the
  slice and UI label it `unvalidated`. Whether it adds value is to be MEASURED from the
  stored features/outcomes before any claim.
- **Dashboard:** `web/src/pure/shapeIntradayValidation.ts` + `IntradayValidationCard`
  render a compact block beside the original forecast (observed time, status, current
  confidence labelled "unvalidated adjustment", change in pp) or "Intraday validation
  unavailable". Note the daily run republishes with an empty `intradayValidation`, so the
  slice clears at each daily run and refills at ~07:00 next morning (history persists in
  `intraday_validations`).

---

## 6. Data model (Supabase Postgres + pgvector)

Schema is in `supabase/migrations/` (timestamp-ordered). Every retained table is
public-read (the SPA reads none of them directly now, but the posture is public-
data) with INSERT/UPDATE restricted to the single `fx_writer` write role. The
**source-of-truth** tables the daily run reads/writes:

| Table | Purpose |
| --- | --- |
| `candles` | Daily OHLC per pair — the raw input. Idempotent `(asset, date)` upsert. |
| `pattern_vectors` | 70-dim shape vectors per `(asset, decision_date)` + pgvector index for ANN. |
| `analogue_outcomes` | Resolved forward MFE/MAE + Direction_Class per `(asset, decision_date, horizon)`, with a `matured` flag. The retrieval corpus. |
| `firing_setups` | One row per pair per Decision_Date: the firing decision (direction, horizon, confidence, SL/TP, surfaced flag). |
| `realized_outcomes` | Predicted-vs-actual journal for fired setups, filled once the horizon matures. |
| `signal_predictions` | The six-signal daily direction scorecard (predicted today, reconciled next session). |
| `intraday_validations` | Written ONLY by the separate intraday Job: per `(decision_date, pair)` a snapshot of the original direction/confidence, the forming 4H OHLC + derived features, and the validation state / bounded delta / current confidence / reason. Migration `20260916000010`. Not read by the daily run. |
| `evaluation_reports` | Human-read kill-gate evaluation reports (no verdict column). |

Additive, offline/ops-only tables (code-complete, fail-safe adapters, not yet
driving anything live): `trade_ledger` (path-aware trade simulation ledger),
`frozen_baselines` (walk-forward frozen Parameter_Sets). Legacy/dormant tables from
earlier phases (`gate_verdicts`, `signal_rationale`, `external_reference_comparison`,
etc.) survive in migration history but are superseded — treat the list above as the
live set and check `docs/state/CODE-MAP.md` before relying on any other.

**The published artifact** is `dashboard.json` (schema **v9**), assembled by
`src/scheduled-run/snapshot.ts` from today's view plus history read back from the
rows above. Slices: `firingSetups`, `pairEvaluations`, `realizedOutcomes`,
`analogueOutcomes`, `candles`, `aiRationale`, `dailyCommentary`,
`externalComparison`, `evaluationReports`, `confluence` (v5), `trackRecord` (v6),
`signalScorecard` (v7), `intradayValidation` (v8, filled by the separate intraday Job), `runHealth` and `eventFlags` (v9, local only until deployed),
plus the offline-evidence slices (`tradeLedgerSummary`,
`calibration`, `exposure`, `provenance`, `validationStatus`). The web side parses
it leniently (`web/src/api/snapshot.ts`): an absent/malformed slice degrades to its
empty value, so schema bumps are backward/forward compatible.

---

## 7. Repository / code map

Full per-module descriptions live in **[`docs/state/CODE-MAP.md`](docs/state/CODE-MAP.md)** (kept current as
code lands). High-level layout:

**Backend (`src/`):**
- *Deterministic core:* `pipeline/`, `encoder/`, `retrieval/`, `confidence/`,
  `baseline/`, `risk-boundaries/`, `kill-gate/`, `dashboard/`, `strategies/`,
  `guard/`.
- *Evidence layer (offline, trader-edge-validation):* `trade-sim/`,
  `trade-ledger/`, `performance/`, `walk-forward/`, `exposure/`, `provenance/`,
  `range-forecast/`, `track-record/`.
- *Intraday validation (read-only enrichment, §5.11):* `intraday-validation/`
  (pure features / classify / formingBar / store port / runValidation),
  `ingestion/intradayFeed/` (isolated Twelve Data 4H client), and in `scheduled-run/`:
  `intradayMain.ts` (Job entry), `publishedSnapshot.ts`, `intradayValidationSlice.ts`.
- *I/O & orchestration:* `ingestion/` (+ `ingestion/ohlcFeed/` provider chain),
  `scheduled-run/` (the Job entry + snapshot + slices), `storage/` (Supabase
  adapters), `csv-loader/`, `staged-runner/` (the `backfill` stage and the
  fold-building the evaluation report uses; its `backtest`/`forwardLook`/`runAll`
  stages were removed with the verdict path).
- *AI (sole SDK-free LLM layer):* `llm/`, `rationale/`, `external-signal/`.
- *Ops entries (`src/ops/*`):* `candle-backfill/`, `freshness-verify/`,
  `edge-eval/`, `evaluation-run/`, `outcome-resolution/`,
  `secret-manager/`, `deploy-verify/`, `scheduler/`, `safety/`,
  `fx-writer-check/`, `confluence-calibration/`.
- *Guards & meta:* `version-policy/`, `living-docs/`.

**Frontend (`web/src/`):** `api/` (snapshot fetch + parse), `pure/` (the shapers —
pure view-model builders, the only place display values are derived),
`components/` (the single-window Master_Card UI), `state/`, `routing/`, `tabs/`,
`theme/`, `guards/` (structural purity + data-invariance tests).

**Other roots:** `supabase/migrations/` (schema), `ops/` + `ops.config.json`
(operational config + monitoring policies), `data/` (seed CSV candles; repo-only, not shipped in the runtime image),
`.github/workflows/` (CI + deploy), `scripts/` (version-policy).

---

## 8. Build, test, and CI/CD

- **Local gate:** `make check` ≡ `npm run check` ≡ `eslint . && tsc --noEmit &&
  vitest run`. The web app has its own gate: `make check-web` ≡
  `cd web && npm run build && npm test` (`build` is `tsc --noEmit && vite build`).
  There is no `check` script or linter in `web/`.
- **CI** (`.github/workflows/ci.yml`): a `quality` job (backend lint / typecheck /
  tests / version-policy as distinct stages) and a `web` job (SPA build + tests),
  on every push/PR, no `continue-on-error`.
- **Version-policy stage:** audits BOTH package trees for exact non-prerelease
  pins and enforces supported major ceilings (`typescript<=6`, `@types/node<=22`,
  React/recharts caps) — fails CI on drift. Kept consistent with Dependabot
  ignores.
- **Deploy** (`.github/workflows/deploy.yml`, on push to `main`): path-filtered
  two-target pipeline. **Backend** → full gate → keyless WIF auth → Cloud Build
  SHA-tagged image → Artifact Registry → `gcloud run jobs deploy` to the Cloud Run
  Job (least-privilege runtime SA; non-secret config via `--set-env-vars`, every
  secret via `--set-secrets <name>:latest`). The seven secrets:
  `external-signal-api-key`, `twelve-data-api-key`, `massive-api-key`,
  `supabase-key` (= the `fx_writer` credential), `supabase-publishable-key`,
  `supabase-url`, `supabase-pooler-url`. The same workflow then also runs
  `gcloud run jobs deploy` for `intraday-validation-run` (same SHA-pinned image, entrypoint
  `dist/scheduled-run/intradayMain.js`, only the Twelve Data + Supabase secrets, fail-fast on
  an empty `DASHBOARD_SNAPSHOT_BUCKET`) so it cannot go stale — written and validated
  locally, not yet exercised by a real run. **Frontend** → web gate →
  `firebase deploy --only hosting` (same keyless WIF identity, ADC — no stored
  token). **Delivery cadence:** the operator merges `dev` → `main` to deploy; the
  agent builds and verifies locally but does not deploy.
- **Migrations:** applied out-of-band (SQL editor / operator), NOT via
  `supabase db push` — the remote CLI migration-history table is untracked, so a
  push would try to replay everything (see RISKS). Additive migrations + fail-safe
  adapters make a torn deploy harmless.

---

## 9. Operational model & live cloud

- **Cadence:** one Cloud Run Job execution per trading day, triggered by Cloud
  Scheduler at 17:30 NY (30 minutes after the 17:00 candle close). Each run is idempotent by Decision_Date (keyed upserts),
  so re-running a date overwrites rather than duplicates.
- **Intraday cadence:** a second Cloud Run Job `intraday-validation-run` fires once per
  weekday at 07:00 Europe/London (Scheduler `intraday-validation-run-0800-uk`, name historical) and logs
  `intraday_validation.start|complete` (`validated`, `unavailable`, `republished`). Manual
  run: `gcloud run jobs execute intraday-validation-run --region europe-west1 --wait`.
  Hazard: it republishes `dashboard.json`, so run it only on an image that key-replaces
  `intradayValidation` (the first version clobbered the daily slices; fixed 2026-11-06).
- **Observability:** structured JSON logs (`scheduled_run.start`,
  `candle_freshness.*`, `scheduled_run.snapshot_written`, `scheduled_run.complete`).
  Every step logs its duration as `scheduled_run.step_timing {step, durationMs,
  outcome}` (observation only), and each fail-safe step that degrades logs a named
  warning (`scheduled_run.*_failed`, `scheduled_run.pipeline_warning`,
  `candle_freshness.encode_skipped`) so a degraded run is distinguishable from an empty
  one.
  A log-based Cloud Monitoring alert fires on `candle_freshness.degraded`
  (`ops/monitoring/`).
- **Manual run:** `gcloud run jobs execute scheduled-daily-run --region
  europe-west1 --wait` runs the deployed image to completion (operator-gated;
  used to self-heal a candle gap or verify end to end).
- **Operational-safety protocol:** live-cloud actions (manual Job runs, migrations,
  IAM/secret changes, backfills) are operator-approved, never autonomous. Secrets
  are referenced by name only and never logged.
- **CORRECTED 2026-11-09 - the 17:30 shift did NOT fix the candle problem, and the cause was
  not timing.** It was recorded here as resolved on 2026-11-06; Friday's first run on the new
  schedule still ended with all five pairs behind, and a read-only investigation found the real
  defect: the daily-candle providers' "latest" bars are mis-dated and, for FCS, are the *forming*
  bar of the next session, so partial bars have been stored as completed candles (e.g. EURUSD
  2026-11-04 has a 2.4-pip range). See RISKS "DAILY CANDLE DATA INTEGRITY" and DECISIONS
  2026-11-09. Fixed in the repo 2026-11-09 (see CHANGELOG); deploy + history repair pending operator approval.

---

## 10. How to extend the project safely

Patterns to follow when adding a feature (they are why the codebase stays
testable and deploy-safe):

1. **New persisted data → a storage PORT + in-memory reference + Supabase
   adapter.** Make the Supabase read **fail-safe** (empty on missing table/error).
   Add an **additive** migration (`create table if not exists`, guarded grants,
   RLS disabled, public select + `fx_writer` write) — never alter/drop an existing
   table in the same change.
2. **New computation → the deterministic core**, pure and property-tested. No
   clock/network/randomness. If it must not influence firing, make it a **separate
   read-only consumer** (like `realizedOutcomeJournal` or the signal scorecard) and
   add a guard test that firing/confidence/kill-gate output is byte-identical with
   and without it.
3. **New output on the dashboard → a snapshot slice**, appended LAST in
   `buildDashboardSnapshot` (preserving earlier keys' byte order), with a lenient
   web parser defaulting to an empty value, and a pure shaper + component. Bump
   `SNAPSHOT_SCHEMA_VERSION` on both sides.
4. **Anything LLM → `src/llm` only**, returning `LlmTagged<T>`, display-only. Never
   let it reach a scoring input; the standing guard test will fail if it does.
5. **Respect look-ahead safety:** run candles through `assertPastOnly`; gate
   outcomes on `isMatured`. New property tests should assert no future leak.
6. **Deploy in self-contained increments** (the spec "stages" model): each one
   keeps `make check` + the web build green, leaves the live decision byte-
   identical until intentionally changed, and never half-exposes a contract.

Before planning, skim `docs/state/DECISIONS.md` (why things are the way they are),
`docs/state/RISKS.md` (open issues and gotchas — e.g. the analogue FLAT dead-band
unit mismatch, the egress-quota history, the schedule timing issue), and
`docs/state/NEXT-STEPS.md` (what is already queued). `LESSONS.md` holds the
hard-won constraints from the predecessor system — treat them as non-negotiable.

---

## 11. Spec / feature status

Summarised; the authoritative, moving detail is in `docs/state/CHANGELOG.md`
(newest-first journal) and the per-module notes in `docs/state/CODE-MAP.md`.

| Spec / feature | Status |
| --- | --- |
| `fx-daily-pattern-assistant` (the core v1 system) | Complete, LIVE |
| `operational-wiring`, `dashboard-ui`, `dashboard-data-activation` | Complete / reconciled (superseded parts noted in satellites) |
| `simplify-to-cloud-minimal` (cloud-minimal, public-read snapshot, fx_writer) | Complete, LIVE |
| `daily-candle-freshness-and-cleanup` (freshness stage + provider chain) | Phases 1–5 done/merged; Phase 6–7 cleanup partly open |
| `multi-strategy-confluence-engine` (6 signals + confluence, schema v5) | Complete, LIVE |
| `mobile-dashboard-single-window` (SPA single-window refactor) | Complete locally |
| `trader-edge-validation` (evidence layer: trade-sim/ledger/walk-forward/exposure) | Code-complete (Stages A–H), NOT deployed; its hosted `edge-eval` has not been run, but the offline research programme (§12.4) has measured the edge locally |
| Signal Scorecard (per-signal predicted-vs-actual, schema v7) | DEPLOYED + live-verified |
| `intraday-validation` (read-only 4H candle validation, schema v8) | DEPLOYED; manual runs live-verified (5 pairs, other slices byte-identical); its first scheduled fire (08:00 London, Mon 2026-11-09) validated 0 of 5 pairs because 08:00 London is a 4H boundary in winter; trigger moved to 07:00 (see DECISIONS 2026-11-09) |
| Evidence-first hardening (pre-registered protocol, offline evidence tools, snapshot v9 `runHealth`/`eventFlags`, event calendar, hourly archive, heartbeat) | Implemented locally, NOT deployed; behaviour-preserving for the live decision (guard tests); the only changes to existing behaviour are web copy and a dormant trade-sim fix |
| Edge research programme (`src/ops/research/`, `docs/research/`; four pre-registered evidence reports) | Offline only; code is local only (gitignored, not on GitHub; backup branch `research/edge-bench`); reports in `docs/research/`; never deployed; no proven edge; stopped by the operator; kept as a backtest bench (§12.4) |
| `codebase-housekeeping` (peer-review remediation: single `fires()`, verdict-path removal, redaction, docs) | Implemented locally, NOT deployed; behaviour-preserving except two intended, tested changes (replay guard, shared matrix) |

**Open threads right now** (see NEXT-STEPS for detail): the daily-candle fix (hourly-derived
17:00-NY candles) and the 07:00 London intraday trigger were deployed and verified live on
2026-11-10 (candles canonical on all 5 pairs, intraday validated 5/5); history 2026-10-12..11-06
was repaired and older history is unaudited. Still open: confirm the first signal-scorecard
reconciliation; the analogue FLAT dead-band decision (measured offline, no gain); whether the
dashboard keeps showing the pattern call given §12.4; whether to forward-test the reversal
lead (§12.4).

---

## 12. Reading the numbers, known limitations and non-goals

### 12.1 What Earned_Confidence means - and what it does not

**It is** a shrunk historical resolution rate: among the (up to 200) most similar past
chart shapes - within cosine distance 0.2, strictly earlier than the Decision_Date, with a
fully matured outcome - the share that went on to move in the dominant direction at the
selected horizon (a FLAT outcome counts against), pulled toward 0.5 by a fixed prior worth
10 observations: `C = n/(n+10)·C_raw + 10/(n+10)·0.5`. The shrinkage damps a small sample
but does not stop it clearing the firing line (0.55): a unanimous neighbourhood of 5 earns
0.667, and about 79% of measured firing days (2013-2024) had fewer than 30 analogues.

**It is not** (all deliberate, and why):
- A calibrated probability that a trade wins. Measured offline in the research programme
  (§12.4): higher Earned_Confidence does not go with a higher hit rate (0.50-0.55 hits 50.2%,
  0.60-0.65 hits 49.3%), so it does not even rank outcomes.
- A profit expectancy. SL/TP and net expectancy were removed from every UI surface because
  daily bars cannot say which level is hit first; after-cost expectancy is near zero on the
  measured edge.
- Evidence of a large edge. The one out-of-sample evaluation recorded is model 0.4996 vs
  baseline 0.4871 (+1.24pp, 95% CI [+0.66, +1.82]pp, n=28,470): a small, statistically
  positive, practically marginal lead, recorded with no verdict (`RESEARCH-LOG.md`). A local
  re-run (2026-11-10) reproduces it at +1.04pp but shows the lead comes from the weekly-trend
  baseline scoring 49.1%; the model itself scores 50.1% (a coin flip), the interval includes
  zero once overlapping days and correlated pairs are discounted, and net expectancy is
  about -1.2 pips/trade after friction.
- Information about news, regime, or costs. The vector is shape only (70 dimensions of
  z-scored closes over 10/20/40 days).
- A multi-day forecast with a chosen horizon. In practice it is horizon 1 (§5.4, R1).

The 0.55 line is a *display gate*, not a trading signal. Two further unvalidated numbers
exist and are always labelled so: the Confluence score ("strength is not a probability") and
the intraday validation delta (a bounded, provisional adjustment).

The analogue FLAT dead-band unit mismatch (`docs/state/RISKS.md`, finding 1) was measured
offline (2026-11-10): the originally intended 0.5xATR band (about 60% FLAT) does not beat the
live sign-based behaviour, so the live definition is unchanged and the decision stays with
the operator.

### 12.2 What the daily schedule means

The Decision_Date is the label of the session being decided. The FX daily candle for day D
closes at 17:00 America/New_York; the Job runs at 17:30 NY on weekdays, so it has just seen
D's close and labels itself the **next** trading day (Friday -> Monday). Every feature uses
only candles strictly BEFORE the label, so a stored row labelled X never used data from X
or later. The stored outcome for a Decision_Date X, however, measures the first session
strictly AFTER X (X's own session is in neither the features nor the label); this is consistent
across analogues and the journal and was measured to change nothing (RISKS). Providers sometimes publish the bar a little after the close, so the candle stage
retries (default 3 x 120 s) and then proceeds on stored history, logging
`candle_freshness.degraded`. The intraday Job runs at 07:00 Europe/London the next morning
and uses fixed UTC 4H boundaries (00/04/08/12/16/20), so DST needs no special handling.

### 12.3 Known limitations (intentional or accepted)

- **A stale run still publishes, but a stale pair is withheld (local, undeployed).** If
  providers fail, the run publishes normally (exit 0), yet any pair whose candles are still
  behind the latest completed session makes no call and shows "data behind" (silence reason
  DATA_BEHIND); the data-delay banner and the `candle_freshness.degraded` ERROR alert remain.
- **The third-party reference is a live read.** The scheduled run reads FCS "latest" at
  17:30 NY; a replay cannot reproduce it, so replays withhold it from the scorecard (§5.10).
- **LLM rationale inputs are approximations.** `toNumericInputs` / `toAnalogueSummaries`
  (`src/scheduled-run/displayOnly.ts`) derive `trendContext` from the direction and
  synthesise a single "analogue" from the card's mean excursion, so the explanatory text
  describes approximated values. Display-only; it can never affect a decision.
- **One key, two roles.** `EXTERNAL_SIGNAL_API_KEY` is both the primary daily-candle source
  (drives firing) and the display-only reference.
- **The scorecard's `custom_pattern` row is the system's own call**, so the "six signals" are
  not independent evidence.
- **Conviction tiers are computed in the browser** (`web/src/pure/shapeConviction.ts`:
  Lean, and an exact UP/DOWN tie -> Split) from the engine's status and weights; the
  backend produces no such tiers.
- **Dormant offline code remains** (trade-sim, ledger, performance, walk-forward,
  exposure, provenance): the daily Job publishes their slices empty until an operator runs
  `edge-eval`.

### 12.4 Evidence so far: the edge research programme (2026-11-10, offline)

**Why it was run.** The live signal measured about 50% directional accuracy, and its only
recorded lead (+1.24pp) is over a weak baseline. Instead of adding indicators, the question
became: does the existing machinery have an edge under any condition, outcome or encoding?

**How.** Everything is offline (code in `src/ops/research/`, kept local only and gitignored, so
it is not in the GitHub repository; local CSVs; hosted data untouched; live system unchanged). Each stage was written down before it was run (`docs/research/
PRE-REGISTRATION*.md`). Exploration window 2013-06-01..2025-09-15; the last 12 months
(2025-09-16..2026-09-15) are a locked holdout that has not been read (2025-09-16 was read once
as an outcome; treat it as seen). Every result reports both hit rate and net pips after
XTB standard-account costs (EURUSD 1.0, GBPUSD 1.2, USDJPY 1.3, USDCHF 2.1, USDCAD 1.9 pips
per trade; BrokerChooser averages plus slippage; overnight swap not modelled). Statistics:
block bootstrap by calendar week or month (five correlated USD pairs and overlapping windows),
Benjamini-Hochberg false-discovery control at q = 0.10 within each pre-registered family,
200 scored days minimum. The dataset reproduces the earlier recorded run exactly (15,095
pair-days, 8,739 scored, 50.10%).

| Stage | Question | Result |
|---|---|---|
| 1 | Does the pattern work under any condition (analogue count, similarity, confidence, agreement, rule-strategy agreement, regime, volatility, pair, weekday, 4H confirmation)? | No. 0 of 10 correlation tests and 0 of about 60 band cells significant in either subset. Confidence does not rank outcomes (0.50-0.55 hits 50.2%, 0.60-0.65 hits 49.3%). The pattern call equals the weekly-trend sign on half of days. 4H "confirmation" looks strong (+17.9pp) only because its hours are inside the scored session; on the move remaining after the read it adds +0.8pp (p = 0.72). |
| 2 | Do trader's-eye chart features (range position, distance from averages, swing structure, candle shape, compression, channel break) improve the rule strategies' setups, or the analogue encoding? | No. 0 of 20 feature tests significant. Shape plus features vs shape alone +0.7pp (not significant); features alone significantly worse. Dropping the weekly-trend prefilter does not help. |
| 3 | Does the pattern work over 3 or 5 sessions, or as a 1 x ATR target-before-stop bracket (calls made from the analogues' own result for that outcome)? | No. All hit rates 49.7% to 50.9%; 0 of 18 tests significant; net negative in all 9 pre-registered cells. |
| 4 | Do the four rule strategies have timing skill when held 3 or 5 sessions or bracketed (scored as excess over what their own long/short mix would get by chance)? | No pre-registered cell passes. Trend and breakout: none (breakout slightly negative). Range: too rare to tell. **Reversal held 5 sessions is a lead**: excess +5.0pp (95% CI +0.9 to +9.4), net +17.3 pips/trade (CI +3.4 to +31.9), positive on 5 of 5 pairs, but q = 0.23 after correction, only 4 years with 100+ trades (2 positive), and about 95 signals a year. |

**What this does and does not show.** At daily frequency on these five pairs, neither the
analogue pattern nor the four rule strategies shows a demonstrable, cost-surviving edge in
the forms tested. Not tested: intraday entries or exits, other markets or crosses, carry and
swap, non-price inputs (rates, positioning, news), position sizing, and any tuning of the
strategies' parameters. Per-stage figures are in `RESEARCH-LOG.md`; full tables are in
`docs/research/EVIDENCE-REPORT-1..4.md`.

**Operator decisions so far.** Pattern research is stopped and nothing from it goes to
production. The research code is kept locally as a backtest bench for future ideas, and the
holdout stays unread for that use. Still open: whether the live dashboard should keep showing
the pattern call; whether to start a forward paper record of the single reversal rule (the
12-month holdout holds only about 95 such trades, too few to confirm a 5pp effect); and what
the product should be if it is not a directional signal (for example a chart-context and
journaling aid).

### 12.5 Non-goals

Automated or continuous trading; intraday forecasting (the 4H layer only validates the daily
call); an LLM-computed probability, confidence or verdict; news as a signal; a server API
or authenticated read path (the SPA reads one static JSON file); multi-user features; and
any claim of validated profitability.

