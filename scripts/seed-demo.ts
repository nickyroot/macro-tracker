import "dotenv/config";
import type { SeriesPoint } from "../src/lib/fred";
import { ensureSeries, persistPortfolio, recomputeMetrics, upsertObservations } from "../src/lib/ingest";
import { SERIES } from "../src/lib/metrics";

// Seeds SYNTHETIC data so the dashboard renders without a FRED key.
// Shapes are plausible, values are fake. Wipe before loading real data:
//   npm run db:wipe && npm run backfill

type DemoParams =
  | { kind: "level"; start: number; initial: number; driftPct: number; volPct: number }
  | { kind: "rate"; start: number; initial: number; mean: number; reversion: number; vol: number; floor?: number }
  | { kind: "binary"; start: number };

const DEMO: Record<string, DemoParams> = {
  GFDEGDQ188S: { kind: "rate", start: 1966, initial: 40, mean: 95, reversion: 0.004, vol: 1.0, floor: 25 },
  TDSP: { kind: "rate", start: 1980, initial: 10.5, mean: 11, reversion: 0.02, vol: 0.12, floor: 8 },
  T10Y3M: { kind: "rate", start: 1982, initial: 1.5, mean: 1.4, reversion: 0.05, vol: 0.3 },
  DFII10: { kind: "rate", start: 2003, initial: 2.0, mean: 1.0, reversion: 0.03, vol: 0.18 },
  WALCL: { kind: "level", start: 2003, initial: 700_000, driftPct: 0.9, volPct: 1.6 },
  M2SL: { kind: "level", start: 1959, initial: 290, driftPct: 0.55, volPct: 0.35 },
  CPIAUCSL: { kind: "level", start: 1947, initial: 21, driftPct: 0.29, volPct: 0.25 },
  PCEPILFE: { kind: "level", start: 1959, initial: 15, driftPct: 0.27, volPct: 0.12 },
  BAMLH0A0HYM2: { kind: "rate", start: 1997, initial: 3.5, mean: 5, reversion: 0.05, vol: 0.45, floor: 2.4 },
  DTWEXBGS: { kind: "rate", start: 2006, initial: 100, mean: 110, reversion: 0.01, vol: 1.1, floor: 85 },
  UNRATE: { kind: "rate", start: 1948, initial: 4, mean: 5.7, reversion: 0.02, vol: 0.22, floor: 2.5 },
  SAHMREALTIME: { kind: "rate", start: 1960, initial: 0.1, mean: 0.15, reversion: 0.08, vol: 0.11, floor: 0 },
  FEDFUNDS: { kind: "rate", start: 1954, initial: 1, mean: 4.5, reversion: 0.015, vol: 0.35, floor: 0.05 },
  NCBEILQ027S: { kind: "level", start: 1952, initial: 120_000, driftPct: 2.0, volPct: 4.5 },
  GDP: { kind: "level", start: 1947, initial: 243, driftPct: 1.55, volPct: 0.7 },
  CP: { kind: "level", start: 1947, initial: 20, driftPct: 1.65, volPct: 2.6 },
  DGS10: { kind: "rate", start: 1962, initial: 4, mean: 5.5, reversion: 0.01, vol: 0.28, floor: 0.5 },
  MORTGAGE30US: { kind: "rate", start: 1971, initial: 7.5, mean: 7.5, reversion: 0.01, vol: 0.26, floor: 2.6 },
  CSUSHPINSA: { kind: "level", start: 1987, initial: 64, driftPct: 0.38, volPct: 0.55 },
  UMCSENT: { kind: "rate", start: 1978, initial: 85, mean: 87, reversion: 0.03, vol: 2.6, floor: 50 },
  INDPRO: { kind: "level", start: 1948, initial: 14, driftPct: 0.2, volPct: 0.8 },
  PAYEMS: { kind: "level", start: 1948, initial: 44_000, driftPct: 0.15, volPct: 0.25 },
  T10YIE: { kind: "rate", start: 2003, initial: 2.4, mean: 2.2, reversion: 0.03, vol: 0.12, floor: 0 },
  USREC: { kind: "binary", start: 1948 },
  "VTI.US": { kind: "level", start: 2001, initial: 50, driftPct: 0.6, volPct: 4.2 },
  "TLT.US": { kind: "level", start: 2002, initial: 85, driftPct: 0.15, volPct: 3.4 },
  "IEF.US": { kind: "level", start: 2002, initial: 80, driftPct: 0.1, volPct: 1.8 },
  "SCHP.US": { kind: "level", start: 2010, initial: 50, driftPct: 0.1, volPct: 1.2 },
  "GLD.US": { kind: "level", start: 2004, initial: 45, driftPct: 0.5, volPct: 4.5 },
  "PDBC.US": { kind: "level", start: 2014, initial: 20, driftPct: 0.1, volPct: 4.5 },
  "BIL.US": { kind: "level", start: 2007, initial: 45.7, driftPct: 0.02, volPct: 0.05 },
};

// Deterministic RNG so re-runs produce identical data.
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand: () => number): number {
  const u = Math.max(rand(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

function monthDates(startYear: number, stepMonths: number): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let y = startYear, m = 0; y < now.getUTCFullYear() || (y === now.getUTCFullYear() && m <= now.getUTCMonth()); ) {
    out.push(`${y}-${String(m + 1).padStart(2, "0")}-01`);
    m += stepMonths;
    if (m >= 12) { y += Math.floor(m / 12); m %= 12; }
  }
  return out;
}

function generate(code: string, params: DemoParams, stepMonths: number, rand: () => number): SeriesPoint[] {
  const dates = monthDates(params.start, stepMonths);
  const points: SeriesPoint[] = [];
  if (params.kind === "binary") {
    let inRecession = false;
    for (const date of dates) {
      if (inRecession) { if (rand() < 0.09) inRecession = false; }
      else if (rand() < 0.012) inRecession = true;
      points.push({ date, value: inRecession ? 1 : 0 });
    }
    return points;
  }
  let v = params.initial;
  for (const date of dates) {
    if (params.kind === "level") {
      v *= 1 + (params.driftPct + params.volPct * gaussian(rand)) / 100;
    } else {
      v += params.reversion * (params.mean - v) + params.vol * gaussian(rand);
      if (params.floor !== undefined) v = Math.max(params.floor, v);
    }
    points.push({ date, value: Number(v.toFixed(4)) });
  }
  return points;
}

async function main() {
  console.log("Seeding synthetic demo data (NOT real economic data)…");
  const idByCode = await ensureSeries();
  let rows = 0;
  let seedOffset = 0;
  for (const def of SERIES) {
    const params = DEMO[def.code];
    const id = idByCode.get(def.code);
    if (!params || id === undefined) continue;
    const rand = mulberry32(42 + seedOffset++);
    const points = generate(def.code, params, def.frequency === "q" ? 3 : 1, rand);
    rows += await upsertObservations(id, points);
  }
  const { computed, metricSeries } = await recomputeMetrics();
  const portfolio = await persistPortfolio(metricSeries);
  console.log(
    `Seeded ${rows} observations across ${SERIES.length} series; ${computed} metrics computed; ` +
      `portfolio ${portfolio ? "computed" : "skipped (insufficient data)"}.`,
  );
  process.exit(0);
}

main();
