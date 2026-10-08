# PROJECT SIMPLICITY & COMPLEXITY AUDIT

> **Status:** Audit and challenge exercise. No code has been changed. This
> document reaches conclusions and proposes a path; it does not implement one.
>
> **Audit date:** 2026-10-07
> **Method:** Direct inspection of source, specs, migrations, deployment config,
> and living docs — not documentation alone. Line counts and file counts cited
> below are measured from the working tree.

---

## 1. Executive Summary

*(Written for a non-developer.)*

You asked a simple question: *"Look at the daily candles for five major
currency pairs, tell me whether a tradeable pattern seems to be forming over the
next couple of days, let me compare that against a third-party signal and a
second opinion from Gemini, and keep a history so I can see whether the
predictions actually came true."*

That is a modest personal research tool. One person, one screen, one question a
day.

**What has actually been built is a production-grade software platform.** It
contains roughly **18,500 lines of core code, another ~24,000 lines of tests, a
9,400-line web application, a second 3,200-line web service whose only job is to
read the database safely, 3,500 lines of cloud-operations tooling, 13 database
tables, six database migrations, two automated cloud-deployment pipelines, and a
full Google Cloud hosting setup** (scheduled jobs, secret storage, a container
registry, keyless machine-to-machine authentication, row-level database
security, scoped signing keys, and a hosted public website). There are **four
separate formal specifications** describing it.

Here is the uncomfortable finding. **The one thing the whole project exists to
answer has never been answered.** The research log that is supposed to record
"did the pattern idea actually beat a dumb baseline?" is empty — zero entries.
The project's own founding lesson, written at the top of its own documents, is
*"measure before believing — nothing is built on top of the idea until the idea
is proven."* In practice the team did the opposite: it built the entire
delivery, hosting, security, and user-interface stack **on top of an idea that
has not yet been shown to work.** That is, structurally, a louder repeat of the
mistake that sank the previous project — elaborate machinery wrapped around an
unproven signal.

The good news is that the part that matters — the actual analytical reasoning
(the baseline, the pattern comparison, the honesty checks that stop you fooling
yourself) — is small, clean, and sound. The excess is almost entirely in the
*plumbing around* it, not the thinking itself.

**Bottom line:** We have accidentally turned a one-person research notebook into
a hosted software product before confirming the notebook's central idea is even
true. The recommendation is to **keep the research rigour, aggressively strip
the software and cloud complexity, run the experiment that has never been run,
and only re-introduce infrastructure once the idea has earned it.**

---

## 2. Original Product Intent

From `PROJECT-PLAN.md` §1 and the original brief, the intended product is:

1. Obtain daily OHLC candles for **EURUSD, GBPUSD, USDJPY, USDCHF, USDCAD**.
2. Analyse recent candle/pattern behaviour.
3. Produce a daily observation per pair: direction, horizon (1–3 days),
   confidence/strength, reasoning — or **"no trade"** when nothing is
   interesting.
4. **Persist** the prediction.
5. After it matures, **persist the actual outcome**.
6. **Show** historical predictions vs actual outcomes.
7. Show a **third-party** trading/API signal alongside.
8. Get a **Gemini** qualitative second opinion.
9. Let one person **visually compare** pattern prediction vs actual outcome vs
   third-party signal vs Gemini opinion.

Explicit scope boundaries from the plan itself:

- *"No public API/website in v1."*
- *"Sole consumer: a local daily-decision dashboard."*
- *"Local-first for research/backtesting."*
- Cloud is *"not required for the research phase."*

And three hard constraints inherited from the prior failure (`LESSONS.md`),
which are genuinely worth honouring:

- **Measure before believing** — nothing drives a signal until it beats a
  baseline out-of-sample.
- **Dimensional minimalism** — start at one feature; each new one must earn
  inclusion.
- **AI explains and filters; deterministic code decides and scores.**

The intent is a **falsifiable personal experiment with a dashboard.** It is not
a product, not a service, and explicitly not a website in v1.

---

## 3. Current System Complexity

Measured from the working tree:

| Area | Scale | Notes |
| --- | --- | --- |
| Core TypeScript (`src/`, non-test) | **18,481 lines / 135 files / 26 modules** | The deterministic engine + a great deal of surrounding machinery |
| Tests (`src/`) | **23,989 lines / 138 files** | More test code than product code |
| Web SPA (`web/`) | **9,374 lines** | React + Vite + TS; `api/components/pure/routing/state/tabs/theme` |
| Read-proxy service (`services/read-proxy/`) | **3,247 lines (1,580 non-test)** | A *second* deployable service, Node `http`, allowlist, rate-limit, cache, security headers |
| Cloud-ops tooling (`src/ops/`) | **3,570 lines / 30 files / 9 submodules** | deploy-verify, gate-run, hosted-backfill, outcome-resolution, safety, scheduler, secret-manager, seed-run, write-credential |
| Dashboard logic (`src/dashboard/`) | **1,861 lines** | firing decision, concentration guard, choppiness guard, journal |
| Database | **13 tables / 6 migrations / 778 lines SQL** | pgvector, RLS, scoped roles, read views, diagnostic read path |
| CI/CD | **ci.yml 83 lines + deploy.yml 302 lines** | path-filtered dual-target keyless deploy |
| Specs | **4 formal specs** | fx-daily-pattern-assistant, operational-wiring, dashboard-ui, dashboard-data-activation |
| Python | isolated `pytest`/`hypothesis` cross-check | one formula |

**Infrastructure footprint actually stood up or wired:** Supabase Postgres +
pgvector; GCP Cloud Run **Job**; GCP Cloud Run **service** (read-proxy); Cloud
Scheduler; Secret Manager; Cloud Build; Artifact Registry; Workload Identity
Federation / OIDC keyless auth; Firebase Hosting; two GitHub Actions pipelines;
RLS with a scoped ES256 JWT `pipeline_writer` role; a diagnostic read path; two
external providers (Gemini via Vertex AI, FCS forex) behind swappable
interfaces.

**The decisive fact:** `RESEARCH-LOG.md` contains **zero** kill-gate verdicts
between its `BEGIN/END ENTRIES` markers. Every one of the above was built, wired,
secured, and partially deployed **before** the project recorded a single
measurement of whether shape-only daily pattern matching beats the
weekly-trend-follow baseline out-of-sample.

This is the headline of the audit: **the complexity is almost entirely in the
delivery and infrastructure layers, and almost none of it was gated on the idea
being proven.**

---

## 4. Complexity Inventory

Classification key: **Essential** (needed to answer the original question
reliably) · **Useful** (meaningful value, not strictly required) · **Premature**
(maybe later, solving a problem we don't yet have) · **Unnecessary** (adds
complexity without materially improving the original objective).

| Component | What it currently does | Why it exists | Required for original idea? | Complexity | Recommendation |
| --- | --- | --- | --- | --- | --- |
| **Daily OHLC ingestion** (`ingestion/`, `guard/`) | Validates, dedupes, session-normalizes candles; look-ahead guard | Clean input is the foundation | **Yes** | Low–Med | **KEEP** (Essential) |
| **Look-ahead guard** | Rejects future candles leaking into a decision date | Core anti-self-deception | **Yes** | Low | **PROTECT** (Essential) |
| **Shape-only pattern encoder** (`encoder/`) | 70-dim shape vector over 10/20/40d | The pattern representation itself | **Yes** | Low | **KEEP** (Essential) |
| **pgvector + ANN retrieval** (`retrieval/`, HNSW index) | Nearest-analogue search in Postgres | Chosen analogue-matching mechanism | **Partially** — the *concept* yes, *pgvector* no | Med | **SIMPLIFY** — a brute-force cosine scan over ~a few thousand rows is trivial and removes an extension dependency (Useful-but-overbuilt) |
| **Analogue retrieval + forward-outcome resolver** | Finds historical look-alikes, resolves 1/2/3d outcomes + MFE/MAE | This *is* the prediction method | **Yes** | Med | **KEEP** (Essential) |
| **Weekly-trend-follow baseline** (`baseline/`) | sign of 5-day ROC | The null hypothesis to beat | **Yes** | Trivial | **PROTECT** (Essential) |
| **Kill-gate — measurement engine** (`kill-gate/gate1.ts`, `gate2.ts`, walk-forward pooling) | Computes model vs baseline directional accuracy, delta, friction-adjusted MFE/MAE excursion margins, sample sizes | The actual research instrument | **Yes** | Med | **PROTECT** — but *as a report producer*, not a gate (see §3C and the focused review in §13) |
| **Kill-gate — PASS/CUT verdict + auto-block** (`composeGateVerdict`, `pipeline/gatePassingResolver.ts`, Req 12.3) | Collapses the metrics into a single `"PASS"\|"CUT"` and blocks any config that hasn't "passed" from the dashboard | Risk-control policy inherited from the predecessor | **No** — this is a decision rule, not evidence | Med | **SIMPLIFY → REMOVE the auto-block.** The `+3pp` / `margin≥0` thresholds are undocumented and arbitrary; the collapse discards information. Replace with a human-read evaluation report (see §13) |
| **Walk-forward windows** | Multi-fold rolling OOS evaluation | Regime-robust evaluation | **Useful**, not essential for v1 | Med | **SIMPLIFY** — one fixed chronological 70/30 split is enough to start (Useful) |
| **Confidence shrinkage** (`confidence/`) | Pulls thin-sample confidence to 0.5 | Prevents false precision | **Yes** (as *strength bucketing*) | Trivial | **KEEP** (Essential) — but see §3B on display |
| **ATR-scaled FLAT band** | Dead-band for "no move" | Avoids calling noise a direction | **Useful** | Low | **KEEP** (Useful) |
| **Feature registry + one-at-a-time gating** (`feature-registry/`) | Tracks candidate/included/cut features, ≤12 ceiling | Discipline for feature growth | **Premature** — there are no earned features yet | Med | **DEFER** — needed only *after* the base idea passes |
| **Candidate features** (`features/`: %B, RSI, vol proxy, dist-SMA, S/R, yield spread) | Extra inputs behind the gate | Future signal improvement | **Premature** — none proven; base signal unproven | Med | **DEFER** |
| **Yield ingestion** (`yields/`, `yields` table) | Sovereign 10Y feed for a yield-spread feature | One candidate feature's data | **Premature/Unnecessary now** | Med | **DEFER/REMOVE** — a feature's data feed built before the feature earned inclusion |
| **Risk boundaries** (`risk-boundaries/`) | Empirical SL/TP from neighborhood excursions | Trade sizing | **Useful** later | Low–Med | **DEFER** — nice once a signal exists |
| **Currency concentration guard** | Dedupes correlated same-currency setups | Portfolio hygiene | **Premature** — fires only when many setups fire; none fire yet | Low | **DEFER** |
| **Choppiness guard** (`dashboard/choppinessGuard.ts`) | Suppresses setups in thrashing regimes | Extra suppressor | **Premature** | Low–Med | **DEFER** |
| **News filter** (`news-filter/`) | Calendar ingest → LLM risk flag → deterministic suppression; suppress-all on feed failure | Don't trade into event risk | **Useful**, not essential for v1 | Med | **SIMPLIFY/DEFER** — start as *displayed context*, not a wired gate (see §3D) |
| **LLM interface + Gemini provider** (`llm/`) | Rationale, analogue labels; role-gated; AI-free scoring guard | Second opinion + explanations | **Yes** (Gemini is in the brief) | Med | **SIMPLIFY** — keep one Gemini call; drop the multi-role abstraction until needed |
| **Scoring-input guard** (`llm/scoringInputGuard.ts`) | Proves no LLM output reaches scoring | Anti-unfalsifiability | **Yes** (cheap, high-value) | Low | **PROTECT** |
| **Rationale module** (`rationale/`) | Plain-language "why" text | Dashboard explanation | **Useful** | Low | **KEEP/merge into the one Gemini call** |
| **Research assistant** (`research-assistant/`) | Human-gated feature proposals | Idea generation | **Unnecessary now** | Med | **REMOVE/DEFER** — a tool for a research program that hasn't started |
| **External signal** (`external-signal/` + FCS) | Third-party BUY/SELL/HOLD for comparison | In the brief | **Yes** | Med | **SIMPLIFY** — one adapter, no provider framework |
| **Dashboard** (`dashboard/`) | Firing decision, persistence, journal | The actual output | **Yes** | Med | **KEEP core; SIMPLIFY guards** |
| **Realized-outcome journal** | Pairs predictions with actual matured results | History + honesty | **Yes** | Low–Med | **PROTECT** (Essential) |
| **Strategy_Source attribution** | Tags signals `system`/`llm`/`algo` for future strategies | Multi-strategy future | **Premature** — only one strategy exists | Low | **DEFER** — reserve a column, don't build the abstraction |
| **CSV loader** (`csv-loader/`) | Seeds history from `data/*.csv` | One-time backfill | **Useful** | Low | **KEEP** (simple script) |
| **Staged runner** (`staged-runner/`) | backfill→backtest→forward-look orchestration | End-to-end wiring | **Useful**, overbuilt | Med | **SIMPLIFY** — three plain scripts, not a framework |
| **Pipeline** (`pipeline/`) | Deterministic daily-run wiring | Orchestration | **Yes** | Med | **KEEP/SIMPLIFY** |
| **Scheduled run** (`scheduled-run/`) | Unattended daily entry + weekday gating | Daily automation | **Yes** (the *trigger*), not the cloud wrapper | Med | **SIMPLIFY** — a local cron / single scheduled task |
| **Supabase storage adapters** (`storage/`) | Candle/vector/analogue/gate/registry/display stores + REST client | Persistence | **Yes** (persistence); **No** (the port-per-table abstraction) | Med–High | **SIMPLIFY** — direct SQL/one client; drop per-store ports |
| **Scoped ES256 JWT write credential** (`ops/write-credential/`, migration 002) | Signed-JWT `pipeline_writer` role, no DELETE | Least-privilege prod writes | **Unnecessary for one local user** | High | **REMOVE** (for v1) — single-user local DB doesn't need a scoped signing key |
| **RLS + pipeline_writer role + read views + diagnostic read path** (migrations 002–005) | Row-level security, scoped grants, read-only views, count path | Multi-tenant/hostile-serving posture | **Unnecessary for one local user** | High | **REMOVE/DEFER** — security model for a public service, not a personal tool |
| **Read-proxy service** (`services/read-proxy/`) | Second deployed service: allowlist, rate-limit, cache, headers, SELECT-only | Shield a public SPA from the DB | **Unnecessary for one local user** | High | **REMOVE/DEFER** — exists only because there's a public website |
| **Firebase-hosted React SPA** (`web/`) | Public hosted dashboard | The UI | **UI yes; public hosting no** (v1 says local-only) | High | **SIMPLIFY** — run the SPA locally against the DB; drop hosting until needed |
| **Cloud Run Job + Scheduler + Secret Manager + Artifact Registry + Cloud Build** | Scheduled unattended cloud execution | "Cloud-ready" daily runs | **Premature** — plan says cloud not needed for research | High | **DEFER** — a laptop/cron runs a daily job fine for one person |
| **WIF / OIDC keyless auth** | Keyless CI→GCP identity | Secretless deploys | **Premature** | High | **DEFER** — follows the cloud, which is deferred |
| **Dual-target path-filtered CI/CD** (`deploy.yml`) | Routes backend/frontend deploys | Automated multi-service delivery | **Premature** | High | **DEFER** — nothing to deploy if it runs locally |
| **Operational safety framework** (`ops/safety/`, GcloudRunner) | Reconcile project/account, approval prompts, stdin-only secrets | Guardrails for live cloud ops | **Consequence of cloud** | High | **DEFER with the cloud** — valuable *if* cloud returns |
| **Living-docs writer + hooks** (`living-docs/`) | Auto-updates STATE block, appends verdicts | Keep docs live across resets | **Useful** | Med | **SIMPLIFY** — plain Markdown edited by hand is fine for one person |
| **Version-policy audit** (`version-policy/`, `scripts/`) | Guards dependency version drift | Supply-chain discipline | **Useful**, overbuilt for zero-dep core | Low–Med | **SIMPLIFY/KEEP** (cheap) |
| **Architecture guard** (`architecture/servingLayerGuard`) | Enforces compute/storage/serving boundary | Protects a boundary that exists only because of the serving layer | **Premature** | Low | **DEFER** — the boundary it guards is itself deferred |
| **Python cross-check** (`python/`) | Re-derives one shrinkage formula in Python | Independent check | **Unnecessary** for a one-line formula | Low | **REMOVE/DEFER** — a whole toolchain for one closed-form equation |

---

## 5. Research vs Software Complexity

This split is the single most important lens in the audit, because it tells us
**what to protect and what to cut.**

### Research complexity (makes the experiment trustworthy — KEEP/PROTECT)

- **Look-ahead safety.** No future candle informs a past decision. Non-negotiable.
- **Recording predictions before outcomes are known.** The realized-outcome
  journal is the heart of an honest experiment.
- **Out-of-sample evaluation.** Train on the past, judge on the unseen.
- **A baseline to beat.** Weekly-trend-follow is the null hypothesis; without it
  "it works" is unfalsifiable.
- **Honest measurement with friction.** The spread/slippage deduction and the
  MFE/MAE path check stop "right direction, untradeable path" from counting.
  (Note: this is the *measurement*, not the PASS/CUT verdict built on top of it —
  see the focused review in §13.)
- **Sample-size humility.** Shrinkage toward neutral when evidence is thin.
- **AI-free scoring.** The guard that proves no LLM touches the score keeps the
  result reproducible and falsifiable.

**All of the above is cheap.** It is a few hundred lines of pure functions. It
is not where the complexity lives, and it must survive any simplification.

### Software complexity (challenge aggressively — SIMPLIFY/REMOVE/DEFER)

- Two deployable services (job + read-proxy) and a hosted SPA for **one user**.
- Full GCP estate (Cloud Run, Scheduler, Secret Manager, Artifact Registry,
  Cloud Build) + keyless WIF for a tool the plan says doesn't need cloud yet.
- RLS, scoped ES256 JWT signing, pipeline_writer role, read views, diagnostic
  read path — a hostile-multi-tenant security model for a personal SQLite-grade
  workload.
- Per-table storage *ports*, provider *frameworks* (LLM + external signal),
  Strategy_Source attribution — abstractions for variation that does not exist.
- A Python toolchain to cross-check one closed-form equation.
- 4 formal specs and a living-docs *writer* with agent hooks.
- **A PASS/CUT "kill" verdict that auto-blocks the dashboard** on undocumented,
  inherited thresholds (`+3pp`, `margin≥0`) — a risk-control *decision rule*
  masquerading as research. The measurement underneath it is research; the
  verdict and the auto-block are software/policy. See the focused review in §13.

**This is where ~80% of the lines and ~100% of the operational burden live, and
almost none of it improves the answer to the original question.**

The goal is not less rigour. It is **the same rigour with far less software.**

---

## 6. Premature Abstractions

For each, the test is: *do we have an actual requirement for this today?*

| Abstraction | Designed for | Real requirement today? | Verdict |
| --- | --- | --- | --- |
| `LlmProvider` interface + role framework | Multiple future LLM providers / 4 sanctioned roles | No — one provider (Gemini), two uses (rationale, labels) | **Premature** |
| `ExternalSignalProvider` interface | Multiple future signal vendors | No — one vendor (FCS) | **Premature** |
| Per-table storage ports (`candle/vector/analogue/gate/registry/display` stores) | Swappable storage backends | No — one backend (Supabase) | **Premature** |
| `Strategy_Source` (`system`/`llm`/`algo`) | Multiple future strategies compared side by side | No — one strategy exists | **Premature** (reserve a column, not a framework) |
| Feature registry + ≤12 gating | A feature-discovery program | No — zero features earned; base signal unproven | **Premature** |
| Walk-forward multi-fold | Regime-robust evaluation across many assets/years | Partially — a single split proves the premise first | **Premature for v1** |
| Compute/storage/serving boundary guard | A public serving layer | No — v1 is local-only by the plan | **Premature** |
| RLS / scoped JWT / read-proxy | Multi-user, hostile, public access | No — one trusted local user | **Premature** |
| Cloud Run Job / Scheduler / WIF / dual CI-CD | Unattended, scalable, team deployment | No — one laptop, one cron | **Premature** |
| Living-docs *writer* + hooks | Large team / frequent context resets | Marginal — one person can edit Markdown | **Premature-ish** |
| Python cross-check harness | Heavy statistical tooling | No — one one-line formula | **Premature** |

Pattern: the system is consistently designed for **multiple future providers,
strategies, assets, users, and environments** that do not exist and are not on
any committed roadmap. This is textbook speculative generality.

---

## 7. What Is Actually Essential

The smallest set that credibly answers the original question:

**Data & integrity**
- Daily OHLC for the five pairs (CSV seed + a simple fetch to keep current).
- Look-ahead guard. Session-normalized, validated candles.

**Analysis**
- Shape-only pattern encoder.
- Analogue retrieval (brute-force cosine is fine) + forward-outcome resolver
  (1/2/3d, MFE/MAE, matured-only).
- Weekly-trend-follow baseline.

**Honesty (the anti-self-deception layer — PROTECT)**
- One fixed chronological out-of-sample split.
- The measurement engine: Gate 1 (directional vs baseline) + Gate 2
  (risk-adjusted after friction) **as a report, not an auto-blocking verdict**
  (§13). This is the mechanism that answers *"is the idea real?"*
- Sample-size shrinkage; a strength bucket (weak/moderate/strong) rather than
  false-precision percentages until evidence exists.
- Realized-outcome journal: predictions written before outcomes, outcomes filled
  in on maturity.
- AI-never-scores guard.

**Comparison & opinion**
- One external-signal adapter (display only).
- One Gemini call for a qualitative second opinion + plain-language rationale
  (display only).

**Output**
- One read-only dashboard showing: today's observation (or "no trade"), history
  of prediction vs actual, the third-party signal, the Gemini opinion — side by
  side.

**Repeatability**
- One daily scheduled execution. *(Originally "local cron is sufficient." Under
  the operator's binding constraints this is now a Cloud Run Job + Cloud
  Scheduler — see §14.)*

Everything outside this list must *earn* its place by solving a problem we have
actually hit.

> **Note:** §7 and §8 below describe the *local-first* V2 from the first audit.
> They are retained for the reasoning trail. The operator has since confirmed
> binding constraints — **cloud execution, mobile access, public data, keep
> GitHub deploy** — that change *where it runs and how it's served* (not the
> analysis). The authoritative, constraint-adjusted architecture is **§14**.
> Where §7/§8 say "local" or "no hosting," read §14 instead.

---

## 8. Simplified Architecture (V2 — local-first draft; superseded by §14)

A deliberately small, local-first design that satisfies every item in the
original brief. **Superseded by §14** for the "where it runs / how it's served"
layer after the operator confirmed cloud + mobile + public-data constraints;
the analysis layer (encoder, retrieval, baseline, measurement engine, journal)
is identical in both.

### 8.1 Components

1. **One analysis process** (TypeScript, reusing the existing pure core:
   guard + encoder + retrieval + baseline + confidence + the measurement engine
   — *not* the PASS/CUT verdict; see §13).
2. **One datastore** — Postgres (local Supabase/Docker, or even SQLite for pure
   research). pgvector optional; brute-force cosine over a few thousand vectors
   is instant.
3. **One external-signal adapter** (FCS) — display only.
4. **One Gemini call** — second opinion + rationale, display only, fail-safe.
5. **One read-only dashboard** (the existing `web/` SPA, run locally against the
   DB — no read-proxy, no hosting).
6. **One scheduler** — a local cron / scheduled task invoking the daily process.

### 8.2 Data flow

```
                 (once)              (daily)
 CSV seed ─▶ ingestion ─▶ candles
                              │
  daily fetch ───────────────┘
                              ▼
                    encoder → pattern vectors
                              ▼
            retrieval (cosine) → analogues + forward outcomes
                              ▼
     baseline + confidence + FLAT band → today's observation per pair
                              ▼
              observation ─▶ predictions table (written now)

   (separately, OFFLINE and periodic — not in the daily path:)
     measurement engine over the OOS split → evaluation report → RESEARCH-LOG
     (human reads it and judges whether the evidence supports the approach)
                              │
      external signal (FCS) ──┤  Gemini opinion ──┐
                              ▼                    ▼
                         dashboard (read-only, local)
                              ▲
   realized outcomes (filled when horizon matures) ──┘
```

### 8.3 Database tables (5, down from 13)

| Table | Purpose |
| --- | --- |
| `candles` | validated daily OHLC per `(asset, date)` |
| `pattern_vectors` | shape vectors (+ weekly trend sign) |
| `predictions` | the daily observation written *before* the outcome is known (pair, date, direction, horizon, strength, rationale, external signal, Gemini opinion) |
| `realized_outcomes` | actual matured result joined back to a prediction |
| `evaluation_reports` | offline measurement runs: metrics (accuracy, delta-vs-baseline, friction-adjusted return, MFE/MAE, sample size, uncertainty) — a report, **not** a PASS/CUT verdict |

Dropped vs today: `yields`, `data_splits` + `walk_forward_folds` (fold into one
recorded split row or config), `gate_fold_verdicts`, `feature_registry`,
`calendar_events` + `news_risk_flags` (deferred with news), `version_ledger`,
and the RLS/read-view/diagnostic apparatus. The `gate_verdicts` /
`gate_fold_verdicts` tables are replaced by `evaluation_reports`: the stored
object is the measured evidence, with no `verdict ∈ {PASS, CUT}` column (§13).

### 8.4 Daily execution flow

1. Fetch/append latest candles for the five pairs.
2. Encode today's pattern vector per pair.
3. Retrieve analogues; resolve matured forward outcomes.
4. Compute direction, horizon, strength (shrunk).
5. Display the observation. Whether you *act* on it is informed by the latest
   offline evaluation report (which you have read), not by an automated gate in
   the live path. The dashboard may annotate an observation with "current
   evidence: weak / unproven / supportive" drawn from that report, but it does
   not silently block.
6. Write the prediction row (even "no trade").
7. Attach FCS signal + Gemini opinion (both fail-safe, display only).
8. Backfill any now-matured realized outcomes.

### 8.5 Dashboard requirements

- Read-only, local.
- Today: per-pair observation or an explicit "no trade".
- History: prediction vs actual outcome over time (the honesty view).
- Side-by-side columns: **pattern prediction · actual outcome · third-party
  signal · Gemini opinion.**
- Each observation is annotated with the current evidence strength from the
  latest offline evaluation report (e.g. "weak / unproven / supportive"), so you
  see *how much to trust it* without the software hiding anything from you. No
  silent PASS/CUT suppression.

### 8.6 Evaluation process (the rigour that stays)

> **Revised after the focused kill-gate review (§13).** V2 keeps the *measurement*
> and drops the automated PASS/CUT "kill" verdict. The software measures and
> reports; the human interprets.

- One fixed chronological 70/30 split, dates recorded once.
- Run the measurement engine offline and **append an evaluation report to
  `RESEARCH-LOG.md`** containing: predictions, sample size, directional
  accuracy, return, baseline performance, delta-vs-baseline, friction-adjusted
  performance, MFE/MAE, strength breakdown, and a note on statistical
  uncertainty for the sample size (e.g. a rough confidence interval on the
  accuracy delta). No `PASS`/`CUT`/`KILL` field.
- Read the report yourself. The decision "the evidence does / does not currently
  support this approach" is a human judgement, recorded in prose — not a boolean
  the software emits.
- Shape-only first (answer the premise). Then — *if you judge the evidence
  supportive* — add features one at a time and re-read the report each time.
- The flow is **Prediction → Outcome → Measurement → Comparison → Human
  interpretation**, not Prediction → Gate → Allowed/Blocked.
- Walk-forward can be re-introduced later as a robustness upgrade to the
  *report*, still with no auto-kill.

### 8.7 What gets removed (v1)

Read-proxy service; Firebase hosting; Cloud Run Job/Scheduler/Secret
Manager/Artifact Registry/WIF; dual CI/CD; RLS + scoped JWT + pipeline_writer +
read views + diagnostic path; Python cross-check; research-assistant;
operational-safety framework; architecture serving-guard; version-ledger.

### 8.8 What gets deferred (returns only when earned)

Feature registry + candidate features + yields; walk-forward multi-fold;
risk boundaries; concentration + choppiness guards; news as a wired filter;
Strategy_Source multi-strategy; cloud hosting + public serving layer (and *then*
its security model and ops safety come back justified).

### 8.9 What absolutely must remain

Look-ahead guard; ingestion/validation; encoder; retrieval + outcome resolver;
baseline; **the measurement engine (Gate 1 + Gate 2 math) — reframed as a report
producer, with the PASS/CUT verdict and the auto-block removed (§13)**;
confidence shrinkage; realized-outcome journal; RESEARCH-LOG; AI-never-scores
guard; one Gemini call; one external adapter; one local read-only dashboard.

---

## 9. KEEP / SIMPLIFY / REMOVE / DEFER / PROTECT

> **Constraint note (see §14).** This list was written for a *local-first,
> single-user* v1. The operator has since set binding constraints — **cloud
> execution, mobile access, public data, keep GitHub deploy** — that move a few
> items between buckets. Flipped items are annotated inline below; §14 is the
> consolidated, authoritative version.
- **Look-ahead guard** — the foundation of a non-fooled experiment.
- **Weekly-trend baseline** — the null hypothesis; without it nothing is
  falsifiable.
- **The kill-gate's *measurement engine* (Gate 1 + Gate 2 math)** — model vs
  baseline accuracy, delta, friction-adjusted MFE/MAE. This is the instrument
  that produces the evidence; it must actually be *run*. **Protect the
  measurement, not the verdict** (see SIMPLIFY below and §13).
- **Realized-outcome journal** — predictions recorded before outcomes.
- **AI-never-scores guard** — cheap, decisive anti-unfalsifiability.
- **RESEARCH-LOG discipline** — and it must finally get its first entry.

### KEEP (already simple enough)
- Ingestion + validation + session normalization.
- Shape-only encoder.
- Analogue retrieval + forward-outcome resolver.
- Confidence shrinkage + ATR FLAT band.
- CSV loader (as a plain seed script).
- The SPA as a read-only UI — **hosted and mobile-reachable per §14** (the first
  audit said "local"; the constraint changes where it's served, not the SPA).

### SIMPLIFY (useful but overbuilt)
- **Kill-gate PASS/CUT verdict → human-read evaluation report.** Keep the Gate 1
  / Gate 2 *math*; drop the `composeGateVerdict` collapse to `"PASS"|"CUT"` and
  the `gatePassingResolver` auto-block (Req 12.3). Emit the metrics as a report;
  let the human judge. The `+3pp` / `margin≥0` thresholds are undocumented and
  inherited — if retained at all, keep them only as *annotations* on the report
  ("edge exceeds 3pp"), never as a switch that hides data. (See §13.)
- **pgvector → brute-force cosine** (or keep pgvector only if it's genuinely
  free to run locally; drop the HNSW ceremony).
- **Storage ports → one client + direct SQL.**
- **LLM/external provider frameworks → one concrete call each.**
- **Staged runner → three plain scripts** (seed / backtest / daily).
- **Walk-forward multi-fold → one fixed split** for v1.
- **Living-docs writer + hooks → hand-edited Markdown.**
- ~~**Scheduled-run cloud wrapper → local cron.**~~ **→ KEEP (§14):** cloud
  execution is a binding constraint, so the Cloud Run Job + Cloud Scheduler
  *is* the scheduler. Trim only incidental complexity, don't localize it.
- **GitHub Actions deploy → KEEP, trim ceremony (§14).** The operator wants it;
  it's convenient and consistent with mandatory cloud. Keep keyless-WIF *or* a
  stored key — whichever already works — without further investment.

### REMOVE (does not justify its complexity for a single-user, public-data tool)
- **Read-proxy service.** Reinforced by the public-data decision: with nothing
  to protect, the SPA (or a job-written JSON snapshot) reads the DB directly.
- ~~Firebase hosting + public serving layer.~~ **→ KEEP (§14):** mobile access
  is a binding constraint, so a hosted public dashboard is required. (The
  *read-proxy* in front of it is still removed; hosting itself stays.)
- **RLS + scoped ES256 JWT + pipeline_writer role + read views + diagnostic read
  path.** Reinforced by the public-data decision — there is no read threat model.
  Only the single write credential + API keys stay secret, and the write path
  must simply not be publicly writable.
- ~~Cloud Run Job + Scheduler + Secret Manager + Artifact Registry + WIF + dual
  CI/CD **(for v1)**.~~ **→ KEEP the execution/hosting/secrets/deploy spine
  (§14):** cloud execution + GitHub deploy are binding constraints. Cloud Run
  Job, Cloud Scheduler, Secret Manager (API keys + write cred), Artifact
  Registry, and the GitHub deploy pipeline are now justified. *Trim* the dual
  path-filter / keyless-WIF ceremony to taste; don't remove the spine.
- Operational-safety framework + architecture serving-guard **(for v1)** — the
  serving-guard protected a compute/storage/serving boundary that collapses once
  the read-proxy is gone; the ops-safety framework can shrink to the few live
  commands the deploy actually runs.
- Python cross-check of a one-line formula.
- Research-assistant module.
- **Choppiness guard and currency-concentration guard — REMOVE as suppressors.**
  Per the operator (and the §13 logic): don't let software silently decide what
  you may see. Keep the choppiness/efficiency metric only as a **displayed
  field** so *you* choose to stay out of a thrashing market.

### DEFER (premature, re-introduce when earned)
- Feature registry + candidate features + yield ingestion.
- Risk boundaries.
- News as a wired deterministic filter (start as displayed context).
- Strategy_Source multi-strategy comparison.
- Walk-forward robustness (a later upgrade to the evaluation *report*).

*(Previously here: "concentration guard; choppiness guard" — moved to REMOVE as
suppressors per the operator; "cloud hosting + its security/ops stack" — split
in §14 into KEEP execution/hosting/deploy vs REMOVE the read-side security.)*

---

## 10. Proposed Simplification Path

Ordered so the **experiment is run first** and nothing is deleted recklessly.

1. **Run the experiment that was never run.** Before touching architecture,
   execute the existing measurement engine on the backfilled history (shape-only,
   one fixed split) and **append the first evaluation report to
   `RESEARCH-LOG.md`** — the metrics (accuracy, delta-vs-baseline,
   friction-adjusted return, MFE/MAE, sample size, uncertainty), read as
   evidence rather than as a `PASS`/`CUT` verdict (§13). This single step is more
   valuable than any refactor: it tells you whether the idea has predictive
   value. *(The math exists; only the output framing changes — see §13.)*
2. **Freeze the cloud.** Stop deploying/maintaining Cloud Run, Scheduler, read-
   proxy, Firebase, and the dual CI/CD. Run everything locally. (Keep the code
   on a branch; don't delete yet.)
3. **Collapse persistence.** Point the pipeline at a local Postgres with no RLS,
   no scoped JWT, one client. Drop the read-proxy; let the local SPA read the DB
   (or a trivial local read endpoint).
4. **Collapse abstractions.** Replace provider frameworks and per-table ports
   with one concrete call / one client each. Reduce 13 tables toward the 5 in
   §8.3.
5. **Quarantine deferred subsystems.** Move feature-registry, yields, risk-
   boundaries, concentration/choppiness guards, research-assistant, and news-as-
   filter behind a clearly-labelled "not in v1" boundary (or a branch), so the
   live path is the §7 essential set.
6. **Verify the loop end-to-end locally:** seed → daily observation → prediction
   persisted → matured outcome persisted → dashboard shows prediction vs actual
   vs FCS vs Gemini.
7. **Only then** reconsider cloud/hosting — and bring back RLS, scoped
   credentials, read-proxy, and ops-safety *together with* the public serving
   layer that actually requires them.

Note: this ordering means **step 1 may change everything.** If shape-only does
not beat the baseline, most of §8 onward is moot — you iterate on the *signal*,
not the plumbing.

---

## 11. Risks of Simplifying

Honest counter-arguments, so this isn't a one-sided demolition:

- **Throwing away working, tested code feels wasteful.** Mitigation: *defer on a
  branch, don't delete.* The infra is well-built; it's just premature. It can
  return when earned. Nothing here says the work was bad — only early.
- **Re-introducing cloud later costs rework.** True, but cheaper than
  maintaining an unused platform now, and far cheaper than the risk of never
  running the experiment because effort went into plumbing.
- **RLS/scoped credentials are genuinely good practice.** Yes — *for a shared or
  public system.* For one local user they guard against a threat model that
  doesn't exist. Keep the migrations in the repo; just don't let them gate v1.
- **Walk-forward is more honest than a single split.** Agreed, and it's a good
  *upgrade*. But a single fixed OOS split already prevents the specific
  self-deception that matters, and it's enough to get the first verdict.
- **The dashboard/SPA is real value.** Keep it — just run it locally. The UI is
  not the problem; the hosting/proxy/security scaffolding around it is.
- **Removing the Python cross-check reduces independent verification.** For one
  closed-form equation, the property test in TS already covers it; the second
  toolchain's cost outweighs its marginal assurance.
- **Removing the PASS/CUT verdict could reduce discipline.** The fear is that
  without an automatic "CUT" a weak signal lingers forever. But the discipline
  was never in the boolean — it's in *looking at the numbers honestly*. A report
  that plainly shows "+0.4pp over baseline, n=41, CI straddles zero" ends an
  approach just as decisively, and more honestly, than a hidden threshold. The
  risk runs the other way: an arbitrary `+3pp` cutoff can *kill a real signal*
  that happens to sit at 2.8pp, or *bless* a 3.1pp fluke on a thin sample. A
  human reading uncertainty-aware metrics avoids both. (See §13.)
- **Risk of losing rigour while cutting.** This is the real danger, and it's why
  §9 PROTECT exists and why step 1 runs *before* any cutting. The explicit rule:
  **simplify software, never the research integrity layer** — and note that the
  PASS/CUT verdict is *software/policy*, not the integrity layer (§13).

---

## 12. Final Recommendation

### Would you build the current architecture again from scratch today?

**PARTIALLY — and mostly NO for the infrastructure.**

- **YES** to the research core: the look-ahead guard, the weekly-trend baseline,
  the Gate 1 / Gate 2 **measurement math**, sample-size shrinkage, the
  realized-outcome journal, and the AI-never-scores rule. That thinking is
  correct, small, and clean. It is the project's genuine achievement and it
  directly honours the hard-won lessons.
- **NO** to the automated **PASS/CUT "kill" verdict and its dashboard
  auto-block.** On reflection (§13) that is a risk-control *decision rule* built
  on undocumented, inherited thresholds — not research. Build the measurement;
  let a human read it and decide whether the evidence supports the approach.
- **NO** to the surrounding platform: two deployable services, a full GCP
  estate, keyless WIF, RLS + scoped signing keys + read-proxy + read views, a
  Python cross-check for one equation, provider/strategy/storage frameworks for
  variation that doesn't exist, and four specs — **all built before a single
  kill-gate verdict was recorded.** Building that again would repeat the
  project's defining error: elaborate machinery around an unproven idea.

### What is the simplest system that could answer the original question credibly?

> **Updated by §14.** The description below is the *local-first ideal*. The
> operator's binding constraints (cloud execution, mobile access) mean the
> simplest *viable* system is the same analysis core running as a Cloud Run Job
> on Scheduler, writing to a hosted Postgres, with a hosted mobile dashboard —
> still one process, one datastore, one dashboard, no read-proxy, no
> scoped-credential security model (public data). See §14.

A **single local TypeScript process** on a **local Postgres**, reusing the
existing pure core, that each day: ingests candles → encodes shape → retrieves
analogues → scores direction/horizon/strength → writes a prediction → attaches
an FCS signal and one Gemini opinion → later records the actual outcome. A
**local read-only dashboard** shows prediction vs actual vs third-party vs
Gemini, annotated with the current evidence strength. Rigour is preserved by
**one fixed OOS split run through the measurement engine, producing an
evaluation report (metrics + uncertainty) in the research log that *you*
interpret** — not an automated PASS/CUT verdict. Roughly five tables, no cloud,
no second service, no scoped-credential security model. That is enough to
credibly answer *"does the evidence suggest this idea has predictive value, and
is it worth trading?"* — which is the question you actually asked.

### What have we built that is solving problems we do not yet have?

- ~~Scalable unattended **cloud** execution~~ — *reclassified by §14: cloud
  execution is now a binding operator constraint, so Cloud Run Job + Scheduler +
  Secret Manager + Artifact Registry + GitHub deploy are justified, not excess.*
- The **read-side security layer** (read-proxy + RLS + scoped JWT + read views +
  diagnostic path) — for data the operator has confirmed is **public** and needs
  no protection. The *hosted dashboard itself* is justified (mobile access);
  only the protection apparatus around public data is excess. (§14)
- **Multi-provider / multi-strategy / swappable-storage** abstractions — for one
  LLM, one signal vendor, one strategy, one database.
- A **feature-discovery program** (registry, candidate features, yield feed) —
  before the base signal has beaten the baseline even once.
- Extra **suppressors and guards** (concentration, choppiness, news-as-filter) —
  software silently deciding what you may see. Per the operator, show the metric
  and let the human stay out; don't suppress. (§14)
- A **second language toolchain** — to cross-check a single closed-form formula.

- An automated **"kill" verdict** that decides whether the research is alive or
  dead on a hardcoded `+3pp` threshold — before a single observation has been
  recorded. We do not yet have the problem that mechanism solves (a validated,
  capital-deployed strategy that needs an automatic circuit-breaker). See §13.

**The core idea has not yet been measured.** Until `RESEARCH-LOG.md` has its
first honest evaluation report, every layer above the research core is
complexity spent on a premise we have not yet confirmed is true. **Run the
experiment first; let the result — read by a human — decide how much software the
idea deserves.**

---

## 13. Focused Review — Does the Project Need a "Kill Gate"?

> Added in response to a direct challenge to the first audit's claim that the
> two-stage kill-gate must be "protected." That claim was **too coarse**. This
> section separates the two things the kill-gate actually is and corrects the
> recommendation.

### 13.1 The kill-gate is two things, not one

Reading the implementation (`src/kill-gate/gate1.ts`, `gate2.ts`,
`verdict.ts`, `types.ts`, and the enforcement in
`src/pipeline/gatePassingResolver.ts` + Requirement 12.3):

1. **A measurement engine** — computes model vs baseline directional accuracy on
   the matched firing subset, the delta, the friction-adjusted MFE/MAE excursion
   margins, pooled across walk-forward folds, with sample sizes. This is genuine
   research instrumentation.
2. **A verdict + control layer** — `composeGateVerdict` collapses all of that
   into a single `verdict: "PASS" | "CUT"` using the constants
   `GATE1_MIN_DELTA = 0.03` and Gate 2 `margin >= 0`; the pipeline then forbids
   any config that didn't "pass" from driving a displayed signal (Req 12.3).

The first is research. The second is a **policy/decision mechanism** — and it is
the piece under challenge.

### 13.2 Answering the specific questions

1. **What does the gate provide that measurement alone doesn't?** Nothing
   informational. Every input to the verdict is computed before the collapse:
   predictions recorded before outcomes, actual outcomes, matched-subset
   baseline comparison, friction-adjusted return, MFE/MAE, sample size. The
   PASS/CUT step *adds no evidence* — it only applies a cutoff and, in doing so,
   discards information (a 2.9pp and a 3.1pp edge become "opposite" conclusions).

2. **Research requirement or policy on top of results?** Policy. The research
   requirement is the measurement. The verdict is a management rule about what to
   *do* with the measurement.

3. **Could a plain evaluation report achieve the same integrity?** Yes,
   completely. A report with predictions, sample size, directional accuracy,
   return, baseline, delta-vs-baseline, friction-adjusted performance, MFE/MAE,
   strength breakdown, and statistical uncertainty preserves every
   anti-self-deception property. All the guards that actually prevent fooling
   yourself live *upstream* of the verdict and are untouched by removing it.

4. **Is "kill" a premature assumption?** Yes. "Kill" assumes the software should
   autonomously decide whether a strategy may operate — a trading-desk
   risk-control concept inherited from a system that was running capital. For a
   tool whose job is to *inform you*, it transfers judgement from you to a
   hardcoded constant.

5. **"Evidence doesn't currently support this" vs "the system has killed it."**
   Genuinely different. The first is a provisional, human reading of accumulating
   data — appropriate when the research log has *zero* entries. The second is a
   terminal automated verdict implying a finality the evidence cannot support.
   With an empty log, a "CUT" would be the software declaring dead something it
   has never measured — the prior project's failure mode in a lab coat.

6. **Are +3pp and margin≥0 justified or inherited?** Inherited and effectively
   arbitrary. There is **no derivation** anywhere — not in the requirements
   glossary, the design, or a code comment. `GATE1_MIN_DELTA = 0.03` is simply
   asserted. Nothing ties 3 percentage points to a power analysis, an expected
   effect size, or a transaction-cost breakeven for these five pairs. Gate 2's
   `margin >= 0` is a defensible *direction* ("don't be worse than baseline after
   friction") but as a hard binary cutoff it is still a policy choice. Neither
   threshold carries a sample-size / confidence qualifier, so a 3pp edge on 30
   trades and on 3,000 trades are treated identically — statistically wrong.

7. **If justified, where from and why appropriate?** They are not justified for
   this research question; they came from the predecessor's risk framing. There
   is no derivation to explain, which is itself the finding.

8. **Simpler flow?** Yes — **Prediction → Outcome → Measurement → Comparison →
   Human interpretation.** The gate-in-the-middle flow is also *backwards*: you
   cannot gate on out-of-sample results before the out-of-sample outcomes exist,
   so the gate already runs as an offline batch. Putting "Allowed/Blocked" in the
   live path is the control mindset leaking into a research tool.

9. **Classification.** Split it:
   - **Measurement engine → PROTECT** (reframed as a report producer).
   - **PASS/CUT verdict → SIMPLIFY** (into report annotations at most).
   - **Dashboard auto-block (Req 12.3) → REMOVE** for v1.
   - **Walk-forward multi-fold → DEFER** (a later robustness upgrade to the
     report).

10. **Removing the gate ≠ removing rigour.** Correct. The rigour is in the
    upstream guards and the honest, uncertainty-aware measurement. The verdict is
    the one piece that is *not* rigour — it is an opinion encoded as a constant.

### 13.3 Direct answer to the operator's concern

> *"I want the system to tell me whether the evidence suggests the pattern
> approach has predictive value. I am not sure I want the software itself
> deciding whether the research is alive or dead."*

That is the right line, and the code lets you draw it cleanly. **Keep the
measurement engine; delete the `PASS/CUT` collapse and the `gatePassingResolver`
block; surface the metrics (with uncertainty) in a report you read.** You retain
100% of the anti-self-deception machinery and give up only a hardcoded,
undocumented decision rule. The software measures and reports; you decide whether
the research is alive.

### 13.4 Net effect on the audit

- §4 inventory: the single "Kill-gate — PROTECT core; SIMPLIFY edges" row is
  split into **measurement (PROTECT)** and **verdict/auto-block (SIMPLIFY →
  REMOVE)**.
- §8 V2: the daily path no longer contains a gate; evaluation is an **offline
  report** (`evaluation_reports`, no `verdict` column) that a human interprets.
- §9: PROTECT now reads "measurement engine," and SIMPLIFY gains the
  verdict-to-report reframing.
- §12: the headline answer is unchanged (PARTIALLY / mostly-NO), with the
  automated kill verdict explicitly added to the "NO" list and to "problems we
  do not yet have."
---

## 14. Revised Under Operator Constraints (Cloud + Mobile + Public Data + GitHub Deploy)

> This section is **authoritative** for the "where it runs / how it's served /
> what's protected" layer and supersedes the local-first assumptions in §7–§9
> and §12. The *analysis* layer (encoder, retrieval, baseline, measurement
> engine, confidence, journal, Gemini/FCS display, §13 kill-gate reframing) is
> unchanged — these constraints touch delivery, not research.

### 14.1 The four binding constraints (operator-stated)

1. **Cloud execution** — the daily run must execute as a Cloud Run Job triggered
   by Cloud Scheduler. Local/laptop cron is not an option.
2. **Mobile access** — the dashboard must be reachable from a phone, i.e. a
   hosted public URL, not localhost.
3. **Public data** — the data does not need protecting; it is fine for the
   public to see it.
4. **Keep GitHub deployment** — GitHub Actions deploy is convenient and is to be
   retained.

### 14.2 What the constraints justify (moves toward KEEP)

| Component | Why it is now justified |
| --- | --- |
| **Cloud Run Job** | Constraint 1 — unattended cloud execution of the daily run |
| **Cloud Scheduler** | Constraint 1 — the daily trigger |
| **Hosted dashboard** (Firebase Hosting or any static host) | Constraint 2 — mobile-reachable public URL |
| **Secret Manager** | Holds the API keys (Gemini, FCS) and the single DB write credential the Job reads at runtime — still secret even though the *data* is public |
| **Artifact Registry + image build** | The Job must be packaged and deployed |
| **GitHub Actions deploy** | Constraint 4 — keep it; trim ceremony to taste |

### 14.3 What the constraints do NOT justify (stays REMOVE / SIMPLIFY)

The over-build the audit flagged was driven by **how many people and how hostile
the access is**, not by *where it runs*. One trusted user with public data is
not a hostile multi-tenant system. These stay cut:

- **Separate read-proxy service — REMOVE.** It exists to shield a protected DB
  from an untrusted public SPA. With public data, the SPA reads the DB directly,
  or (simpler and cheaper) the Job writes a static JSON snapshot that the hosted
  SPA fetches. One whole deployable service eliminated.
- **RLS + scoped ES256 JWT `pipeline_writer` role + read views + diagnostic read
  path — REMOVE.** These are a read/write *protection* model. Public read means
  no read threat model; a single write credential held by the Job is enough.
- **Public-URL auth gate — NOT NEEDED (concern withdrawn).** An earlier revision
  raised the need for a login (Firebase Auth / shared token / IAP). The
  public-data decision removes it: the dashboard can simply be public.
- **Dual-target path-filtered CI/CD + keyless-WIF ceremony — SIMPLIFY, don't
  remove.** Keep whichever deploy identity already works (WIF *or* a stored
  service-account key). Don't invest further in the ceremony; it buys little for
  a single-user public-data tool.
- **Choppiness guard + currency-concentration guard — REMOVE as suppressors.**
  Same principle as §13: software must not silently decide what you may see.
  Compute the choppiness/efficiency number and **display it**; you decide to
  stay out of a thrashing market. Showing a "same-currency" note is fine;
  silently dropping a setup is not.

### 14.4 The one real residual concern

With public data the only things that still must be handled carefully are narrow
and ordinary:

- **Secrets stay secret.** API keys and the DB **write** credential live in
  Secret Manager, never in the repo or the client.
- **The write path must not be publicly writable.** Public *read* is fine;
  public *write* is not. The Job writes with its credential; the dashboard and
  anonymous visitors read only.

This replaces the entire RLS / scoped-JWT / read-proxy apparatus with two
sentences of discipline.

### 14.5 Consolidated V2 (constraint-adjusted)

**Components**
1. **Cloud Run Job** — the daily analysis process (the existing pure core:
   guard + encoder + retrieval + baseline + confidence + measurement engine;
   **no** PASS/CUT auto-block, §13).
2. **Cloud Scheduler** — daily trigger (Session_Close cadence).
3. **Hosted Postgres** (Supabase) — public-readable; **no RLS**. One write
   credential for the Job.
4. **Hosted dashboard** (SPA on Firebase Hosting) — public URL, mobile-friendly,
   **no auth gate, no read-proxy**. Reads the DB directly or a Job-written JSON
   snapshot.
5. **One external-signal adapter** (FCS) + **one Gemini call** — display only,
   fail-safe.
6. **Secret Manager** — API keys + the single write credential.
7. **GitHub Actions** — deploy the Job (and publish the SPA).

**Data flow**

```
 Cloud Scheduler (daily)
        ▼
 Cloud Run Job ── ingest candles ─▶ encode ─▶ retrieve analogues ─▶ outcomes
        │                                        ▼
        │              baseline + confidence + FLAT band ─▶ observation
        │                                        ▼
        │        write predictions + (matured) realized outcomes + a JSON
        │        snapshot ─────────────────────────────────▶ hosted Postgres
        │        (+ FCS signal, Gemini opinion, choppiness metric as fields)
        ▼
 (periodic, offline) measurement engine over the OOS split
        ▼
 evaluation report ─▶ RESEARCH-LOG  (human reads, judges the evidence)

 hosted SPA (phone) ◀── reads public Postgres / JSON snapshot (read-only)
```

**Database tables** — the five from §8.3 (`candles`, `pattern_vectors`,
`predictions`, `realized_outcomes`, `evaluation_reports`), **minus** all RLS /
scoped-role objects. `predictions` carries the displayed context fields
(direction, horizon, strength, rationale, FCS signal, Gemini opinion, and the
choppiness/efficiency metric as a *shown* value, not a suppressor).

**Removed vs today:** read-proxy service; RLS + scoped JWT + pipeline_writer +
read views + diagnostic read path; the auth gate (never built; now explicitly
unneeded); choppiness + concentration *suppression*; plus everything already in
§8.7 (Python cross-check, research-assistant, serving-guard, version-ledger) and
§8.8 DEFER (yields, feature registry, risk boundaries, news-as-filter,
Strategy_Source, walk-forward multi-fold).

**Kept:** Cloud Run Job + Scheduler + Secret Manager + Artifact Registry +
hosted Postgres + hosted mobile dashboard + GitHub Actions deploy — the minimal
cloud spine the constraints require.

### 14.6 Net effect on earlier sections

- **§7 Essential:** "one daily scheduled execution" is now a Cloud Run Job +
  Scheduler; the dashboard is hosted + mobile, not local.
- **§8 V2:** superseded here for the delivery layer; the analysis layer stands.
- **§9 buckets:** `scheduled-run`, hosting, Cloud Run Job/Scheduler/Secret
  Manager/Artifact Registry, and GitHub deploy move to **KEEP** (trim ceremony);
  read-proxy, RLS/scoped-JWT/read-views/diagnostic path move firmly to
  **REMOVE** (public data); choppiness + concentration guards move from DEFER to
  **REMOVE as suppressors** (metric displayed only).
- **§12:** the "simplest viable system" is the §14.5 cloud spine, not a laptop;
  the headline verdict (PARTIALLY / mostly-NO) is unchanged — the "NO" now
  targets the read-side security/serving over-build and the auto-deciding
  guards, not cloud execution or hosting, which the constraints justify.
