# FX Daily Pattern Trading Assistant

A personal tool that, once per trading day, looks at the five major FX pairs (EURUSD, GBPUSD,
USDJPY, USDCHF, USDCAD) and surfaces **at most a few** directional setups - "a pattern like this
has historically been followed by a move in direction X, earned confidence C%" - and stays
**silent** otherwise. It is a decision aid, not a trading system: it places no orders, and its
numbers are deliberately labelled for what they are (see [what confidence means](PROJECT-STATE.md#121-what-earned_confidence-means---and-what-it-does-not)).

It is the successor to a forecasting system that failed instructively; the lessons are hard
constraints in [`LESSONS.md`](LESSONS.md).

## The two rules everything else follows

1. **Measure before believing.** The system is judged out-of-sample against a naive
   weekly-trend-follow baseline. The one recorded result is a small edge (+1.24pp), and the docs
   say so. Unvalidated numbers are labelled "unvalidated" in the UI.
2. **Deterministic code decides and scores; AI only explains.** An LLM (Gemini) writes the
   display rationale and a daily note. It can never compute the probability, the confidence, or
   whether a pair fires. This is enforced by types (`Deterministic<T>` vs `LlmTagged<T>`) and
   by guard tests.

## How it works (one paragraph)

At 17:30 New York on weekdays a Cloud Run Job builds the day's candles from hourly bars on
the 17:00 New York close (Twelve Data, falling back to Massive), encodes each pair's recent shape as a 70-number vector, finds the
most similar past shapes whose outcomes are fully known, and turns their outcomes into a
direction and a shrunk confidence. A pair "fires" only if its direction is not FLAT and its
confidence is at least 0.55. The result is written to Supabase and published as **one static
file, `dashboard.json`**, which a read-only React app on Firebase Hosting displays. A second Job
at 07:00 London the next morning checks the forming 4H candle against the original call.

```text
OHLC providers -> candle freshness -> per-pair evaluation x5 -> fires()? -> Supabase rows
                                                                  |
                                    Gemini rationale (display) <--+--> signal scorecard
                                                                  v
                                       dashboard.json (GCS) -> React SPA (read-only)
```

## Where to read next

| You want to... | Read |
| --- | --- |
| Understand the whole system, formulas and constants | [`PROJECT-STATE.md`](PROJECT-STATE.md) |
| Know what confidence means (and does not), the schedule, limitations, non-goals | [`PROJECT-STATE.md` section 12](PROJECT-STATE.md#12-reading-the-numbers-known-limitations-and-non-goals) |
| Know why something is the way it is | [`docs/state/DECISIONS.md`](docs/state/DECISIONS.md) (start at the Decision Index) |
| Find a module | [`docs/state/CODE-MAP.md`](docs/state/CODE-MAP.md) |
| Read or change the `dashboard.json` format | [`docs/DASHBOARD-SNAPSHOT-CONTRACT.md`](docs/DASHBOARD-SNAPSHOT-CONTRACT.md) |
| Run, deploy, schedule, or recover the system | [`docs/RUNBOOK.md`](docs/RUNBOOK.md) |
| Configure environment variables | [`.env.example`](.env.example) |
| See open risks / what is next | [`docs/state/RISKS.md`](docs/state/RISKS.md), [`docs/state/NEXT-STEPS.md`](docs/state/NEXT-STEPS.md) |
| Read the partner-facing explainer (historical) | [`docs/TRADING-PARTNER-BRIEF.md`](docs/TRADING-PARTNER-BRIEF.md) |

## Quick start

Requires Node 22 (see `.nvmrc`).

```bash
npm install            # backend
npm run check          # eslint + tsc + vitest  (backend gate)
cd web && npm install
npm run build && npm test   # SPA gate (also: `make check` runs both)
```

A local run needs a Supabase target and provider keys; copy `.env.example` to `.env` and see the
[runbook](docs/RUNBOOK.md#running-locally). The daily entry point is `src/scheduled-run/main.ts`
(`npm run build && npm run start:scheduled-run`).

## Repository layout

| Path | What is in it |
| --- | --- |
| `src/` | The TypeScript backend. Deterministic core (`pipeline`, `encoder`, `retrieval`, `confidence`, `dashboard`, `strategies`, `guard`), I/O adapters (`ingestion`, `storage`, `external-signal`, `llm`), the Jobs (`scheduled-run`), and operator tools (`ops/`). |
| `web/` | The React + Vite single-page app. It only reads `dashboard.json`; display values are derived in `web/src/pure/`. |
| `supabase/migrations/` | The database schema (applied out-of-band, never with `supabase db push`). |
| `ops/` | Committed operational config: Scheduler jobs, monitoring alert, required-resources keep-list. |
| `data/` | Seed candle CSVs for the operator backfill tools and tests (not shipped in the image). |
| `docs/` | Contract, runbook, architecture notes and the living `docs/state/` satellites. |
| `.github/workflows/` | CI (every push) and deploy (push to `main`, keyless via Workload Identity Federation). |

## Testing

Vitest with fast-check. The property tests encode the invariants that matter (shrinkage
monotonicity, encoder scale-invariance, UP/DOWN symmetry of confluence, look-ahead safety). The
tests that protect the most important boundaries:

- `src/strategies/firingUnchanged.test.ts`, `src/external-signal/boundary.property.test.ts`,
  `src/llm/property4-aiFreeScoring.test.ts`, `src/dashboard/realizedOutcomeJournal.test.ts` -
  adding confluence, a third-party reference, LLM output or journaling leaves firing,
  confidence and the evaluation report byte-identical.
- `src/dashboard/fires.test.ts` - the single firing predicate and every consumer of it.
- `src/retrieval/horizonContract.test.ts` - pins the horizon-1-only behaviour.
- `web/src/pure/purity.structural.test.ts` and `web/src/guards/` - the SPA derives display
  values only in pure shapers and never recomputes backend numbers.

## Conventions

- The delivery cadence is: develop on `dev`, the operator merges `dev` -> `main` to deploy.
  Live-cloud actions (manual Job runs, migrations, IAM, secrets) are operator-approved, never
  automatic.
- Never write a secret value into a file, log, or document - reference credentials by name.
- `docs/state/` is kept current as the work changes; `LESSONS.md` is hand-authored and never
  auto-edited.
