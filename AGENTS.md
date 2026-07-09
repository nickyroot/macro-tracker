<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Macro tracker

Macroeconomic dashboard: FRED data in, Dalio/Buffett metrics vs historical
percentiles out. See README.md for setup and architecture.

## Commands

- `npm run dev` — dev server (needs `npx prisma dev -n macro-tracker` running)
- `npm run build` / `npm run lint`
- `npm run backfill` — full FRED history (needs FRED_API_KEY)
- `npm run seed:demo` — synthetic demo data, no key needed
- `npm run db:wipe` — clear all ingested data
- `npx prisma generate` — after schema changes (client output: src/generated/prisma)

## Hard constraints

- **Database operation budget**: free Prisma Postgres = 100K queries/month.
  Never write per-row loops against the DB — batch with `createMany` or
  multi-row `INSERT ... ON CONFLICT` (see `upsertObservations`). Keep the
  dashboard on ISR (`revalidate`) so page views don't query the DB.
- Local `prisma dev` (PGlite) breaks `migrate dev`/`migrate deploy`
  ("prepared statement s3 already exists"). Use `prisma db push` for local
  iteration and `prisma migrate diff --script` to record migrations
  (README "Local migration note"). Hosted Prisma Postgres is unaffected.
- Prisma 7: client connects via `accelerateUrl` for `prisma+postgres://` URLs,
  `@prisma/adapter-pg` otherwise — handled in `src/lib/db.ts`; don't
  instantiate PrismaClient elsewhere.

## Conventions

- Metrics/series are config in `src/lib/metrics.ts`; transforms in
  `src/lib/stats.ts`. Adding a metric = config entry only. Add a plain-English
  EXPLAINERS entry too (shown under the master timeline).
- Data sources: FRED (default), Yahoo chart API (ETF prices, `yahoo.ts`),
  multpl.com scrape (Shiller CAPE, `multpl.ts`), BIS SDMX API (global
  debt-cycle, `bis.ts` + config `global.ts`). Scraped/external sources are
  best-effort — a fetch failure logs an error but doesn't abort the run.
- Global data lives OUTSIDE the SERIES/METRICS/transform pipeline: it's
  written straight to metric_points as `global:<metric>:<country>` by
  `ingestGlobal`, read by `buildGlobal`, and rendered by the (server) global
  panel. Don't route it through METRICS — it's terminal display data.
- Observation values are `Float` on purpose (analytics, not accounting).
- Server components by default. The master timeline (`timeline-panel`,
  `time-series-chart`, `regime-strip`) is the only client island — keep new
  interactivity inside it; everything else stays server-rendered.
- Charts are hand-rolled SVG (no chart libraries) — keep it that way for
  bundle size and design consistency.

## Portfolio engine

`src/lib/portfolio.ts` is deterministic config + math: signal defs → growth/
inflation composite z-scores → sigmoid → quadrant probabilities → baseline +
tilts + overlays → guardrails. It must stay explainable — every weight change
needs a traceable signal; no opaque models in this layer (ML belongs in the
phase-3 local jobs). It runs twice by design: persisted during ingest
(regime_* metric points + allocations log) and recomputed live in
`getDashboardData` — keep the math identical in both paths (it's the same
function; don't fork it). Invariants: weights sum to 100, no negative
weights, quadrant probs sum to 1, active share ≤ 20pp.
