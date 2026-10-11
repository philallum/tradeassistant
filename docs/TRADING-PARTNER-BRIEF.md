# Trading Assistant — Partner Brief

A plain-language walkthrough of what this platform is, how it finds signals, what it produces each day, and what you'll see on the dashboard. Written for a trader coming on board to help shape the signal and the UI. No code or architecture here — just how it behaves and what it shows.

---

## 1. The core idea in one line

For each of 5 forex pairs, every trading day the system asks: **"When this pair's recent price shape looked like it does right now, what tended to happen over the next 1–3 days?"** It finds the closest historical look-alikes, measures what they did next, and only surfaces a trade when enough of those look-alikes agreed on a direction.

It is a **historical analogue engine**, not an indicator and not a black-box prediction model. "Confidence" is a real, countable thing: the share of past look-alikes that resolved in the same direction.

**The universe**
- Pairs: EURUSD, GBPUSD, USDCAD, USDCHF, USDJPY
- Timeframe: daily candles (D1) only
- Forecast horizon: 1, 2, or 3 trading days forward

---

## 2. The pattern recognition and signal system

### What counts as a "pattern"
A pattern is the **recent shape** of a pair's closing prices — not its price level. The system looks at the trailing ~60 trading days of closes and turns that into a fingerprint.

A few things to know about that fingerprint:
- It's **shape only**. The system strips out the actual price and the volatility, so a move from 1.0800 to 1.1000 and a proportionally identical move on USDJPY around 150 produce the same shape. We only care about the *form* of the move, not the numbers.
- It looks at **three zoom levels at once**: roughly the last 10, 20, and 40 days. That way a pattern has to look similar on the short, medium, and longer view — not just one of them.
- It also tags the broader **weekly trend direction** (is price higher or lower than 5 days ago?), and only ever compares patterns that share the same weekly trend. Up-regimes are matched to up-regimes, down to down.

### How a signal gets built, step by step
1. **Build today's fingerprint** from the recent closing-price shape.
2. **Find the look-alikes** — past dates across the history whose fingerprint is closest to today's. Only genuinely similar ones are kept (anything too dissimilar is thrown out), and only ones from *before* today, in the *same* weekly trend.
3. **Only use look-alikes whose outcome is already known** — i.e. the 1–3 days after them have fully played out. We never guess; we only count what actually happened.
4. **Score the agreement.** Of those look-alikes, what fraction moved in the same dominant direction (up or down)? Cases that went nowhere (flat) count *against* the signal.
5. **Pick the best horizon** (1, 2, or 3 days) — whichever one the look-alikes resolved most cleanly on.
6. **Set risk levels from history** (see below).

### Confidence — and why small samples can't fool it
The agreement rate is the starting point, but it gets pulled toward a neutral 50/50 based on how many look-alikes we found. If there are only a handful of matches, the score is dragged hard toward 50% and simply can't reach the firing bar on luck. The more look-alikes agree, the closer the score stays to the raw agreement rate. There's a working floor of about **30 look-alikes** before a setup is treated as actionable.

### What a signal actually says
Each pair ends up in one of three states:
- **Long** (the look-alikes mostly went up)
- **Short** (mostly went down)
- **No trade** (they were split, went nowhere, or confidence was too low)

A pair **fires** — becomes a real card on the dashboard — only when **both** are true:
1. It has a direction (not flat), and
2. Its confidence is at or above the firing threshold (currently **0.55**, i.e. 55%).

This threshold is adjustable — that's exactly the kind of dial your input will help tune.

### Risk levels come from the look-alikes, not a formula
Stop-loss and take-profit are **empirical** — read off what the matching historical cases actually did, in pips:
- **Stop-loss** = the 75th percentile of how far those cases moved *against* the position before resolving (so the stop sits beyond most of the adverse wiggle).
- **Take-profit** = the median (50th percentile) of how far they moved *in favour*.

If there aren't enough look-alikes to trust these numbers, the setup is marked not-actionable rather than showing made-up levels.

### Two things worth flagging
- **Silent by default.** Most days, most or all pairs will *not* fire. That is the intended behaviour, not a fault. The system is meant to stay quiet until a genuinely similar, agreeing setup appears.
- **The AI never touches the trade.** There's an AI commentary layer (plain-language notes), but it is strictly for reading. It does **not** affect direction, confidence, risk levels, or whether a pair fires. Every trading number is mechanical and reproducible.

---

## 3. The daily run — what happens each day

A scheduled job runs automatically **after the US session close, around 5pm New York time, Monday to Friday**. It does the same work for all 5 pairs, in a fixed order, and in the same way every time (two runs on the same data produce the same result).

For each pair it:
1. **Loads** the recent daily candles up to (but not including) today.
2. **Builds the fingerprint** of the recent price shape, and measures a "choppiness" reading for context.
3. **Finds the matured look-alikes** from history.
4. **Scores** direction, confidence, and best horizon from those look-alikes.
5. **Derives** the stop-loss and take-profit from the look-alikes' real behaviour.
6. **Decides firing** — does this pair clear the direction + confidence bar?
7. **Saves the results** and **publishes the dashboard** so the web app shows the latest picture.

An important safety point: the "what happened next" outcomes for historical cases are worked out **ahead of time**, offline. The daily run only *reads* outcomes that have already fully matured. That's what guarantees a signal can never secretly peek at future prices.

---

## 4. The daily data that gets created and kept

Each run saves a record of the day and refreshes a single bundle that feeds the dashboard. The things captured:

- **Firing setups** — one entry per pair, whether it fired or not. If it fired: direction, horizon, confidence, stop-loss and take-profit pips. If it didn't: the reason (either "didn't meet the bar" or "not enough history to be actionable").
- **Run summary (all 5 pairs)** — every pair's direction, confidence, and choppiness for the day, *even on a day nothing fires*. This is so a quiet day still shows "yes, we scanned all five pairs and here's where they stood," rather than a blank screen.
- **Analogue outcomes** — the matured historical cases and how far they ran for and against (the raw material behind the signals).
- **Prediction-vs-actual journal** — what the system predicted on a given day, and once enough days pass, what actually happened. This is the running track record. The "actual" half fills in only after the horizon matures.
- **Price candles** — the OHLC data used for charts.
- **AI notes** — the plain-language rationale per pair and a short whole-day commentary. Display-only.
- **Third-party comparison** — an external provider's view next to ours, tagged agree / diverge / neutral / unavailable. Research-only.
- **Evaluation report** — how the system's directional accuracy compares to a simple trend-following benchmark on out-of-sample data (more on this below).

Re-running the same day **replaces** that day's records rather than duplicating them, and a history of past days is kept so you can browse back through previous dates on the dashboard.

---

## 5. The dashboard — tab by tab

The dashboard is a web app with a **dark theme**. At the top you pick a **pair** and a **date** (you can browse back through history). Along the bottom are **five tabs**:

### Tab 1 — Setups *(the default, the day's headline view)*
The "what's live today" screen.
- A short **AI note of the day** at the top.
- A **card for each firing pair**: the pair, long or short, the horizon, the confidence, the expected favourable-vs-adverse move in pips, and the stop-loss / take-profit — plus a plain-language rationale.
- On a **quiet day** (nothing fired), a **run summary** of all five pairs (direction, confidence, choppiness each) so you can see the scan ran, or a simple "no setups fired" message.
- A **suppression list** showing which pairs didn't fire and why — this stays visible across all pairs regardless of which pair you've selected.

### Tab 2 — Pattern & Outcomes *(per pair)*
The deeper history for one chosen pair, as charts (each with a readable text/table version too):
- **Confidence over time** — how the pair's confidence has trended.
- **Favourable vs adverse move profile** — the typical reward-vs-risk shape in pips.
- **Prediction vs actual** — did past predictions pan out.
- **Price chart** — the OHLC history.

### Tab 3 — Gate (Evaluation)
The "is this thing actually any good?" readout. It shows the system's **directional accuracy versus a simple trend-following benchmark** on out-of-sample data: sample size, number of predictions, model accuracy, benchmark accuracy, and the gap between them. Deliberately **no pass/fail verdict** — it's a measurement for you to judge whether the edge is real.

### Tab 4 — AI
Clearly-labelled, **display-only** AI content: the signal rationale, qualitative descriptions of the matched patterns, and any advisory research notes. Framed explicitly as advisory and non-scoring — it never feeds the trade decision.

### Tab 5 — Third-party
A **research-only** side-by-side of our direction vs an external provider's view, tagged agree / diverge / neutral, or "unavailable" when there's no reference. Also never an input to any decision.

---

## 6. The vocabulary (quick reference)

| Term | What it means for you |
|------|----------------------|
| **Pattern / fingerprint** | The shape of recent closes (price and size stripped out). |
| **Analogue / look-alike** | A past date whose fingerprint matched today's. |
| **Horizon** | How far forward the signal looks: 1, 2, or 3 days. |
| **Confidence** | Share of look-alikes that agreed on direction, adjusted down for small samples. Fires at ≥ 0.55. |
| **Firing** | A pair cleared the direction + confidence bar and shows as a card. |
| **Silent / suppressed** | A pair that didn't fire; the dashboard tells you why. |
| **MFE / MAE** | How far cases ran *in favour* (MFE) vs *against* (MAE) — these set take-profit and stop-loss. |
| **Choppiness** | A 0–1 reading of how clean the recent trend is (1 = clean trend, 0 = chop). Shown for context only; it never hides a setup. |
| **Baseline / Gate** | A simple trend-following benchmark the system is measured against. |

---

## 7. Where your input is most valuable

A few open dials and judgement calls where a trader's eye matters most:
- **The firing threshold** (currently 0.55) — too low and it's noisy, too high and it rarely speaks.
- **The stop-loss / take-profit percentiles** — whether 75th / 50th gives sensible, tradeable levels.
- **The horizon mix** — whether 1–3 days is the right window, or if it should lean shorter/longer.
- **What a trader actually wants to see first** on the Setups and Pattern & Outcomes tabs, and what's noise.
- **How to read a quiet day** — making "nothing fired" feel informative rather than broken.
- **The track record view** — what framing of prediction-vs-actual would make you trust (or distrust) the signal.
