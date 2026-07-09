# Macro tracker

A macroeconomic dashboard that ingests free FRED data daily, derives the
metrics Ray Dalio and Warren Buffett watch, and shows each one against its
full historical distribution (percentile rank, z-score, trend sparkline).

**Panels**

- **Debt cycle & regime (Dalio)** — federal debt/GDP, household debt service,
  yield curve, real 10y yield, Fed balance sheet YoY, M2 YoY, CPI & core PCE
  inflation, high-yield spread, dollar index, unemployment, Sahm rule, fed funds.
- **Valuation & rates (Buffett)** — Buffett indicator (corporate equities/GDP,
  Z.1 based), corporate profits/GDP, Shiller CAPE, earnings yield vs the 10y
  Treasury (equity risk premium), 10y Treasury, 30y mortgage, home prices YoY,
  consumer sentiment.
- **Suggested mix** — a dynamic All Weather model portfolio: quadrant regime
  probabilities (growth × inflation direction) tilt a static All Weather
  baseline, with Buffett-style valuation and real-rate overlays. Model
  output for decision support, not investment advice.
- **Master timeline** — any metric's full history on one large chart
  (median + 10–90th percentile context, NBER recession shading) with the
  regime-probability stack on the same time axis. Click a metric card to
  load it.
- **Global debt cycle** — a cross-country heatmap (credit-to-GDP gap & ratio,
  debt-service ratio, policy rate for 8 major economies) from BIS, each cell
  colored by where that country sits in its own history — "who's late in
  their debt cycle right now."

## Stack

Next.js (App Router) · TypeScript · Tailwind · Prisma 7 + Postgres · Vercel Cron

Designed to fit the **free Prisma Postgres tier** (100K ops/month, 500MB):

- Daily/weekly FRED series are aggregated to monthly at the API, so the whole
  dataset is ~20k rows.
- Ingest writes multi-row `INSERT ... ON CONFLICT` batches — roughly 60 queries
  per daily run, not one per observation.
- The dashboard page is ISR-cached (1h + revalidated after each ingest), so
  page views never touch the database.

Typical budget: ~3–5K operations/month against the 100K cap.

## Local setup

```bash
npm install

# 1. Start a local Prisma Postgres server (keep it running)
npx prisma dev -n macro-tracker

# 2. Copy the DATABASE_URL and SHADOW_DATABASE_URL it prints into .env
cp .env.example .env

# 3. Apply the schema
npx prisma migrate deploy   # if this fails locally, see "Local migration note"

# 4. Load data — either real (needs FRED_API_KEY in .env) or synthetic
npm run backfill    # real: full history from FRED
npm run seed:demo   # or: fake-but-plausible demo data, no key needed

npm run dev
```

`npm run db:wipe` clears all data (e.g. to swap demo data for real data).

### Local migration note

The local `prisma dev` server (PGlite-based) currently rejects the schema
engine's prepared statements during `migrate deploy`/`migrate dev`
("prepared statement s3 already exists"). Against hosted Prisma Postgres this
does not happen. Locally, apply migrations by hand if needed:

```bash
npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script
# run the SQL via any pg client, or use `npx prisma db push` for iteration
```

## Deploying to Vercel

1. Create the project on Vercel; add the **Prisma Postgres** marketplace
   integration (free plan) — it sets `DATABASE_URL`.
2. Set env vars: `FRED_API_KEY` ([free key](https://fred.stlouisfed.org/docs/api/api_key.html))
   and `CRON_SECRET` (any random string).
3. Run migrations against the production DB from your machine:
   `DATABASE_URL="<prod tcp url>" npx prisma migrate deploy`
   (use the direct `postgres://` connection string from the Prisma dashboard).
4. Deploy. `vercel.json` schedules `/api/ingest` daily at 13:00 UTC (after most
   US morning releases).
5. First backfill: `curl -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/ingest?full=1`

## How it works

```
FRED API ──> /api/ingest (daily cron)
               ├─ upsert raw observations (batched ON CONFLICT)
               ├─ recompute derived metrics (yoy / ratio transforms in memory)
               └─ revalidatePath("/")
Postgres ──> / (ISR, revalidate 3600) ──> percentile cards + sparklines
```

- Series and metric definitions live in `src/lib/metrics.ts` — adding a metric
  is a config change; ingest and dashboard pick it up automatically.
- Transforms + stats: `src/lib/stats.ts`. Ingest: `src/lib/ingest.ts`.
- FRED revises history; each ingest refetches a 2-year window and the upsert
  overwrites revised values. `?full=1` refetches everything.
- ETF closes (VTI/TLT/IEF/SCHP/GLD/PDBC/BIL) come from Yahoo Finance's public
  chart API as adjusted monthly closes, no key needed — `src/lib/yahoo.ts`.
- Shiller CAPE is scraped from multpl.com's monthly table (`src/lib/multpl.ts`),
  keyless and current — Shiller's own spreadsheet is only served as stale
  mirrors. From CAPE we derive the earnings yield vs the 10y Treasury (the
  equity risk premium) via `invert` / `inv_spread` transforms.
- Global debt-cycle data comes from the BIS SDMX API (`src/lib/bis.ts`,
  keyless; one request per metric returns every country). Config in
  `src/lib/global.ts`; stored as `global:<metric>:<country>` metric points
  and rendered read-only, separate from the US series/transforms pipeline.

### Portfolio engine (`src/lib/portfolio.ts`)

Deterministic and fully explainable — every weight traces to a named signal:

1. Growth and inflation composites: weighted z-scores of configured signals
   (Sahm rule, payrolls YoY, yield curve, CPI momentum, breakevens, …).
2. Sigmoid → P(growth rising), P(inflation rising) → four quadrant
   probabilities (goldilocks / reflation / stagflation / deflationary bust),
   smoothed over 3 months. Full monthly history is persisted as `regime_*`
   metric points.
3. Weights = All Weather baseline + Σ (quadrant prob × tilt vector)
   + valuation overlay (Buffett indicator percentile, contrarian)
   + real-rate overlay (real 10y percentile → duration), then guardrails:
   no shorts, 20pp active-share cap, renormalize to 100%.
4. Each month's suggested weights are logged to the `allocations` table —
   the model's forward track record vs the static baseline.

Caveats by design: the historical regime series uses full-sample z-scores
(fine for charts, lookahead-biased for backtests — phase 3 uses ALFRED
vintages), and tilt sizes are illustrative starting points to be validated
by backtesting, not truths.

## Roadmap

- **Phase 2 (remaining)** — Treasury FiscalData, composite gauges; global
  expansion (IMF COFER reserve shares, per-country dashboards).
- **Phase 3** — local ML jobs (trained on your machine, results pushed back):
  recession probability (yield-curve probit), regime classification (HMM),
  historical-analogue search, covariance-based risk parity as the portfolio
  baseline, and a vintage-correct (ALFRED) backtest of the tilt rules.
