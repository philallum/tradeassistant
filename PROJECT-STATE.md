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
- **Phase:** v1 feature-complete and LIVE. `multi-strategy-confluence-engine` + Signal Scorecard confirmed LIVE (schema v7 in prod). `intraday-validation` (read-only 4H enrichment) IMPLEMENTED locally (schema bumped to v8), NOT committed/deployed; additive migration `…0010` not yet applied in hosted. Delivery cadence: operator merges dev->main to deploy; agent builds/verifies locally.
- **Updated:** 2026-11-06
- **Summary:** Built the `intraday-validation` feature end-to-end LOCALLY (full gate green: backend eslint+tsc+1308 tests+version-policy, web build+288 tests). It adds a SEPARATE ~08:00-UK Cloud Run Job (`intradayMain.ts`) that reads back the immutable daily prediction, fetches the forming 4H candle (new isolated Twelve Data `interval=4h` client), classifies Support/Neutral/Contradict with a bounded ±10pp UNVALIDATED confidence delta, persists to a new `intraday_validations` table, and republishes `dashboard.json` with a new v8 `intradayValidation` slice + compact per-pair card. The daily engine is byte-identical (isolation regression test green). Open: operator review + dev->main deploy, apply migration `…0010` out-of-band, and provision the second Cloud Scheduler trigger.
<!-- END STATE -->

---

## 1. What this project is

A personal, local-first **FX Daily Pattern Trading Assistant** for the five major
pairs (EURUSD, GBPUSD, USDJPY, USDCHF, USDCAD). Once per trading day it surfaces a
small number of high-conviction, forward-looking directional setups — "a pattern
is emerging; over the next 1–3 days, direction X, earned confidence C%" — and
stays **silent** otherwise. It is the successor to a prior forecasting system that
failed instructively; the lessons from that failure are hard constraints that live
in `LESSONS.md`.

**Two non-negotiable principles govern every design choice:**

1. **Measure before believing.** Nothing drives a displayed signal until it beats
   a defined baseline out-of-sample through a two-stage kill-gate. The baseline is
   a naive weekly-trend-follow rule; the system must earn its keep against it.
2. **AI explains and filters; deterministic code decides and scores.** An LLM may
   read news, write display rationale, label analogues, and help interpret
   results. It must **never** compute the directional probability, the confidence,
   or the kill-gate verdict. This boundary is enforced in the type system
   (`Deterministic<T>` vs `LlmTagged<T>`) and by a standing guard test.

A promoted third principle (from `trader-edge-validation`): **nothing is presented
as more certain than the evidence supports** — un-validated numbers are labelled
as such in the UI, and "strength is not a probability."

The authoritative design and task breakdowns live in `PROJECT-PLAN.md` and under
`.kiro/specs/`. This document tracks the *system as built*.

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
  The backend suite is ~1,200+ tests; the web suite ~270. Property tests encode
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
  (`0 17 * * *` America/New_York — see RISKS re: the close-time publication-lag
  issue); Secret Manager holds all runtime secrets; Cloud Build + Artifact
  Registry build SHA-pinned images; CI authenticates keylessly via Workload
  Identity Federation / OIDC (no stored SA key).
- **Serving / UI:** a React + Vite + TypeScript SPA (`web/`) on Firebase Hosting,
  strictly read-only. It fetches ONE static `dashboard.json` snapshot that the
  Cloud Run Job writes to a public-read GCS bucket at the end of each run (CORS
  allows the custom domain). There is no API server and no live DB access from the
  browser — the former read-proxy was deleted.
- **External providers (keys in Secret Manager, read at runtime):** OHLC market
  data (FCS, Twelve Data, Massive — a fallback chain), a third-party reference
  signal (FCS), and Google Vertex AI (Gemini) for the display-only LLM layer. All
  are **data/LLM inputs only** — never scoring inputs.

---

## 3. Architecture at a glance

The system is a **deterministic compute core** wrapped by **I/O adapters** and a
**read-only serving path**. Data flows one direction: candles in → deterministic
evaluation → persisted rows → a published JSON snapshot → the SPA.

```
                          ┌─────────────────────── Cloud Run Job (daily) ───────────────────────┐
  OHLC providers ──fetch──▶ Candle_Freshness_Stage ──▶ runDailyPipeline (×5 pairs) ──▶ dailyRun  │
  (FCS→TwelveData→Massive)        │ idempotent upsert        │ deterministic core     │ firing   │
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
  inputs are `Deterministic<T>`. A `ScoringInputGuard` + a standing import-boundary
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
   **FCS → Twelve Data → Massive** (`src/ingestion/ohlcFeed/`), writing through the
   idempotent, Look_Ahead_Safe `OhlcIngestion` path. A one-day top-up uses
   `fetchLatest`; a multi-day gap uses `fetchRange` (FCS is latest-only, so ranges
   route past it). Fail-safe with a bounded retry (default 3×120s); if pairs are
   still behind it logs a high-severity `candle_freshness.degraded` event and
   proceeds on existing history (the run never crashes on a provider hiccup).
3. **`runDailyPipeline`** (`src/pipeline/dailyPipeline.ts`) evaluates all five
   pairs (see §5) → `PairEvaluation[]`.
4. **`dailyRun`** (`src/dashboard/dashboard.ts`) applies the firing rule and
   produces the `DashboardView` (the firing cards). Persisted to `firing_setups`.
5. **Realized-outcome journal** + **signal scorecard**: reconcile prior
   predictions whose horizon has now matured, and record today's per-signal
   directions (see §6, §8).
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

Because `k` is fixed, a thin neighborhood (small `n`) is pulled hard toward the
neutral prior 0.5 and **cannot cross the 0.55 firing threshold on sample size
alone** — the 30-analogue floor is enforced by the math, not a special case.

**Direction** (`dominantDirection`): tally UP vs DOWN at the selected horizon; ties
and all-FLAT resolve to **FLAT** (so the pair does not fire).

**Horizon selection** (`selectHorizon`): pick the horizon (1, 2, or 3) with the
highest raw resolution rate; ties break toward the **shorter** horizon.

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

Validates (out-of-sample) whether the pattern signal beats the baseline. Two
stages, evaluated over walk-forward folds (a fold with < 30 firing dates is
skipped):

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
| `evaluation_reports` | Human-read kill-gate evaluation reports (no verdict column). |

Additive, offline/ops-only tables (code-complete, fail-safe adapters, not yet
driving anything live): `trade_ledger` (path-aware trade simulation ledger),
`frozen_baselines` (walk-forward frozen Parameter_Sets). Legacy/dormant tables from
earlier phases (`gate_verdicts`, `signal_rationale`, `external_reference_comparison`,
etc.) survive in migration history but are superseded — treat the list above as the
live set and check `docs/state/CODE-MAP.md` before relying on any other.

**The published artifact** is `dashboard.json` (schema **v7**), assembled by
`src/scheduled-run/snapshot.ts` from today's view plus history read back from the
rows above. Slices: `firingSetups`, `pairEvaluations`, `realizedOutcomes`,
`analogueOutcomes`, `candles`, `aiRationale`, `dailyCommentary`,
`externalComparison`, `evaluationReports`, `confluence` (v5), `trackRecord` (v6),
`signalScorecard` (v7), plus the offline-evidence slices (`tradeLedgerSummary`,
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
- *I/O & orchestration:* `ingestion/` (+ `ingestion/ohlcFeed/` provider chain),
  `scheduled-run/` (the Job entry + snapshot + slices), `storage/` (Supabase
  adapters), `csv-loader/`, `staged-runner/`.
- *AI (sole SDK-free LLM layer):* `llm/`, `rationale/`, `news-filter/`,
  `external-signal/`.
- *Ops entries (`src/ops/*`):* `candle-backfill/`, `freshness-verify/`,
  `edge-eval/`, `evaluation-run/`, `gate-run/`, `outcome-resolution/`,
  `secret-manager/`, `deploy-verify/`, `scheduler/`, `safety/`,
  `fx-writer-check/`, `confluence-calibration/`.
- *Guards & meta:* `version-policy/`, `living-docs/`.

**Frontend (`web/src/`):** `api/` (snapshot fetch + parse), `pure/` (the shapers —
pure view-model builders, the only place display values are derived),
`components/` (the single-window Master_Card UI), `state/`, `routing/`, `tabs/`,
`theme/`, `guards/` (structural purity + data-invariance tests).

**Other roots:** `supabase/migrations/` (schema), `ops/` + `ops.config.json`
(operational config + monitoring policies), `data/` (seed CSV candles),
`.github/workflows/` (CI + deploy), `scripts/` (version-policy).

---

## 8. Build, test, and CI/CD

- **Local gate:** `make check` ≡ `npm run check` ≡ `eslint . && tsc --noEmit &&
  vitest run`. The web app has its own gate (`cd web && npm run check` ≡ lint +
  `tsc --noEmit && vite build` + `vitest run`).
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
  `supabase-url`, `supabase-pooler-url`. **Frontend** → web gate →
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
  Scheduler at 17:00 NY. Each run is idempotent by Decision_Date (keyed upserts),
  so re-running a date overwrites rather than duplicates.
- **Observability:** structured JSON logs (`scheduled_run.start`,
  `candle_freshness.*`, `scheduled_run.snapshot_written`, `scheduled_run.complete`).
  A log-based Cloud Monitoring alert fires on `candle_freshness.degraded`
  (`ops/monitoring/`).
- **Manual run:** `gcloud run jobs execute scheduled-daily-run --region
  europe-west1 --wait` runs the deployed image to completion (operator-gated;
  used to self-heal a candle gap or verify end to end).
- **Operational-safety protocol:** live-cloud actions (manual Job runs, migrations,
  IAM/secret changes, backfills) are operator-approved, never autonomous. Secrets
  are referenced by name only and never logged.
- **Known live issue:** the Scheduler fires at the exact 17:00 NY candle close and
  the in-Job retry window (~6 min) can expire before OHLC providers publish the
  day's bar, producing a benign-but-noisy `candle_freshness.degraded` alert that
  the next run clears. Root-caused; fix (shift schedule to ~17:30 NY + widen
  retry) pending — see RISKS / NEXT-STEPS.

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
| `trader-edge-validation` (evidence layer: trade-sim/ledger/walk-forward/exposure) | Code-complete (Stages A–H), NOT deployed; no edge measured yet |
| Signal Scorecard (per-signal predicted-vs-actual, schema v7) | DEPLOYED + live-verified |

**Open threads right now** (see NEXT-STEPS for detail): confirm the first signal-
scorecard reconciliation and the web bundle rendering the "Recorded" line; the
candle-freshness schedule-timing fix; deploy/measure `trader-edge-validation`; the
analogue FLAT dead-band unit-mismatch decision.
