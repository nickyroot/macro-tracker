import { prisma } from "@/lib/db";
import type { SeriesPoint } from "@/lib/fred";
import { GLOBAL_COUNTRIES, GLOBAL_METRICS, globalKey } from "@/lib/global";
import { EXPLAINERS, METRICS, type MetricDef } from "@/lib/metrics";
import { ASSETS, computePortfolio, QUADRANTS, type PortfolioResult } from "@/lib/portfolio";
import { median, percentileRank, zScore } from "@/lib/stats";
import { monthIdxFromDate, type TimelineData, type TimelinePoint } from "@/lib/timeline";

export type MetricView = Omit<MetricDef, "transform"> & {
  latest: { date: string; value: number };
  percentile: number;
  z: number;
  min: number;
  med: number;
  max: number;
  sinceYear: number;
  spark: number[];
  sparkStartYear: number;
};

export type PortfolioView = Omit<PortfolioResult, "regimeHistory">;

export type TrackStats = { cagr: number; totalReturn: number; maxDrawdown: number };
export type TrackRecordView = {
  startYear: number;
  months: number;
  dynamic: TrackStats;
  static: TrackStats;
  excessCagr: number;
  points: { dynamic: TimelinePoint[]; static: TimelinePoint[] };
};

// Local-ML output (phase 3): the walk-forward recession probability plus the
// honesty stats the Mac job publishes alongside it. Values are percents.
export type MlView = {
  current: { date: string; prob: number };
  points: TimelinePoint[];
  oosStartYear: number;
  auc: number | null;
  aucCurveOnly: number | null;
  brier: number | null;
  baseRate: number | null;
  regimeNext: RegimeForecast | null;
  mix: BlendMixView | null;
};

// M3: the Black-Litterman blend's published mix. Its deviation from the
// baseline is capped at the budget the walk-forward evidence earned.
export type BlendMixView = {
  date: string;
  budget: number; // pp of the 10pp reference cap
  ir: number | null;
  te: number | null; // %/yr
  excessCagr: number | null; // pp/yr vs static
  evalStartYear: number | null;
  evalMonths: number | null;
  activeShare: number;
  assets: {
    key: string; name: string; etf: string; baseline: number;
    weight: number; delta: number; view: number | null;
  }[];
};

// M2: the regime forecast (published forecaster: walk-forward-validated
// transition matrix). now/next are percents from the job's as-of engine.
export type RegimeForecast = {
  horizonMonths: number;
  date: string;
  quadrants: { key: string; name: string; now: number; next: number }[];
  topKey: string;
  accuracy: number | null;
  accuracyPersistence: number | null;
  brier: number | null;
  brierPersistence: number | null;
};

export type GlobalCell = { value: number; percentile: number; date: string };
export type GlobalView = {
  countries: { code: string; name: string }[];
  metrics: { key: string; name: string; unit: string; decimals: number; describe: string }[];
  cells: Record<string, Record<string, GlobalCell | null>>; // [country][metric]
  dataThrough: string | null;
};

export type DashboardData = {
  metrics: MetricView[];
  portfolio: PortfolioView | null;
  trackRecord: TrackRecordView | null;
  ml: MlView | null;
  global: GlobalView | null;
  timeline: TimelineData;
  dataThrough: string | null;
  lastRun: { finishedAt: string | null; status: string } | null;
};

const SPARK_MAX_POINTS = 120;
const SPARK_HISTORY_POINTS = 300; // ~25y of monthly data

const round4 = (v: number) => Math.round(v * 10000) / 10000;

// Cumulative-growth stats from an index series that starts at 100.
function trackStats(series: { date: Date; value: number }[]): TrackStats {
  const months = series.length - 1;
  const last = series[series.length - 1].value;
  let peak = -Infinity;
  let maxDrawdown = 0;
  for (const p of series) {
    peak = Math.max(peak, p.value);
    maxDrawdown = Math.min(maxDrawdown, p.value / peak - 1);
  }
  return {
    totalReturn: last / 100 - 1,
    cagr: (last / 100) ** (12 / months) - 1,
    maxDrawdown,
  };
}

function buildTrackRecord(
  byKey: Map<string, { date: Date; value: number }[]>,
): TrackRecordView | null {
  const dyn = byKey.get("track_dynamic");
  const sta = byKey.get("track_static");
  if (!dyn || !sta || dyn.length < 13 || sta.length < 13) return null;

  const dynamic = trackStats(dyn);
  const staticStats = trackStats(sta);
  return {
    startYear: dyn[0].date.getUTCFullYear(),
    months: dyn.length - 1,
    dynamic,
    static: staticStats,
    excessCagr: dynamic.cagr - staticStats.cagr,
    points: {
      dynamic: dyn.map((p) => [monthIdxFromDate(p.date), round4(p.value)]),
      static: sta.map((p) => [monthIdxFromDate(p.date), round4(p.value)]),
    },
  };
}

function buildRegimeForecast(
  byKey: Map<string, { date: Date; value: number }[]>,
  stat: (key: string) => number | null,
): RegimeForecast | null {
  const quadrants = [];
  let date = "";
  for (const q of QUADRANTS) {
    const nextHist = byKey.get(`ml:regime_next_${q.key}`);
    const now = stat(`ml:regime_now_${q.key}`);
    if (!nextHist || nextHist.length < 24 || now == null) return null;
    const latest = nextHist[nextHist.length - 1];
    date = latest.date.toISOString().slice(0, 10);
    quadrants.push({ key: q.key, name: q.name, now, next: latest.value });
  }
  const top = [...quadrants].sort((a, b) => b.next - a.next)[0];
  return {
    horizonMonths: 3, // keep in sync with ml/src/macroml/regime.py HORIZON
    date,
    quadrants,
    topKey: top.key,
    accuracy: stat("ml:regime_next_acc"),
    accuracyPersistence: stat("ml:regime_next_acc_persist"),
    brier: stat("ml:regime_next_brier"),
    brierPersistence: stat("ml:regime_next_brier_persist"),
  };
}

function buildBlendMix(
  byKey: Map<string, { date: Date; value: number }[]>,
  stat: (key: string) => number | null,
): BlendMixView | null {
  const budget = stat("ml:blend_budget");
  if (budget == null) return null;
  const assets = [];
  let date = "";
  let active = 0;
  for (const a of ASSETS) {
    const w = byKey.get(`ml:blend_w_${a.key}`)?.at(-1);
    if (!w) return null;
    date = w.date.toISOString().slice(0, 10);
    const delta = w.value - a.baseline;
    active += Math.abs(delta);
    assets.push({
      key: a.key, name: a.name, etf: a.etf, baseline: a.baseline,
      weight: w.value, delta, view: stat(`ml:view_${a.key}`),
    });
  }
  const bt = byKey.get("ml:bt_blend");
  return {
    date, budget, assets,
    ir: stat("ml:blend_ir"),
    te: stat("ml:blend_te"),
    excessCagr: stat("ml:blend_excess_cagr"),
    evalStartYear: bt?.length ? bt[0].date.getUTCFullYear() : null,
    evalMonths: bt?.length ? bt.length - 1 : null,
    activeShare: active / 2,
  };
}

function buildMl(byKey: Map<string, { date: Date; value: number }[]>): MlView | null {
  const hist = byKey.get("ml:recession_prob");
  if (!hist || hist.length < 24) return null;
  const stat = (key: string) => byKey.get(key)?.at(-1)?.value ?? null;
  const latest = hist[hist.length - 1];
  return {
    current: { date: latest.date.toISOString().slice(0, 10), prob: latest.value },
    points: hist.map((p) => [monthIdxFromDate(p.date), round4(p.value)]),
    oosStartYear: hist[0].date.getUTCFullYear(),
    auc: stat("ml:recession_auc"),
    aucCurveOnly: stat("ml:recession_auc_curve"),
    brier: stat("ml:recession_brier"),
    baseRate: stat("ml:recession_base"),
    regimeNext: buildRegimeForecast(byKey, stat),
    mix: buildBlendMix(byKey, stat),
  };
}

// Cross-country debt-cycle heatmap: each country×metric cell is the latest
// value plus where it sits in that country's own history (percentile), read
// from the "global:<metric>:<country>" points BIS ingest wrote.
function buildGlobal(byKey: Map<string, { date: Date; value: number }[]>): GlobalView | null {
  const cells: Record<string, Record<string, GlobalCell | null>> = {};
  const presentCountries: { code: string; name: string }[] = [];
  let anyData = false;
  let latestDate = "";

  for (const c of GLOBAL_COUNTRIES) {
    const row: Record<string, GlobalCell | null> = {};
    let countryHasData = false;
    for (const m of GLOBAL_METRICS) {
      const hist = byKey.get(globalKey(m.key, c.code));
      if (!hist || hist.length < 8) {
        row[m.key] = null;
        continue;
      }
      const values = hist.map((h) => h.value);
      const latest = hist[hist.length - 1];
      const date = latest.date.toISOString().slice(0, 10);
      row[m.key] = {
        value: latest.value,
        percentile: percentileRank(values, latest.value),
        date,
      };
      countryHasData = true;
      anyData = true;
      if (date > latestDate) latestDate = date;
    }
    if (countryHasData) {
      cells[c.code] = row;
      presentCountries.push({ code: c.code, name: c.name });
    }
  }

  if (!anyData) return null;
  return {
    countries: presentCountries,
    metrics: GLOBAL_METRICS.map((m) => ({
      key: m.key, name: m.name, unit: m.unit, decimals: m.decimals, describe: m.describe,
    })),
    cells,
    dataThrough: latestDate || null,
  };
}

// Full monthly history for the master timeline, as compact [monthIdx, value]
// pairs (~15k pairs total — fine for a static, ISR-cached page).
function buildTimeline(byKey: Map<string, { date: Date; value: number }[]>): TimelineData {
  const toPoints = (hist: { date: Date; value: number }[] | undefined): TimelinePoint[] =>
    (hist ?? []).map((h) => [monthIdxFromDate(h.date), round4(h.value)]);

  // Consecutive months where USREC >= 0.5 collapse into [start, end] spans.
  const recessions: [number, number][] = [];
  for (const p of byKey.get("usrec") ?? []) {
    if (p.value < 0.5) continue;
    const idx = monthIdxFromDate(p.date);
    const last = recessions[recessions.length - 1];
    if (last && idx <= last[1] + 1) last[1] = idx;
    else recessions.push([idx, idx]);
  }

  return {
    metrics: METRICS.flatMap((def) => {
      if (def.panel === "internal") return [];
      const points = toPoints(byKey.get(def.key));
      if (points.length < 2) return [];
      return [{
        key: def.key,
        name: def.name,
        panel: def.panel,
        unit: def.unit,
        decimals: def.decimals,
        explain: EXPLAINERS[def.key] ?? def.describe,
        points,
      }];
    }),
    regimes: QUADRANTS.map((q) => ({
      key: q.key,
      name: q.name,
      points: toPoints(byKey.get(`regime_${q.key}`)),
    })),
    recessions,
  };
}

function downsample(values: number[], max: number): number[] {
  if (values.length <= max) return values;
  const stride = Math.ceil(values.length / max);
  const out = values.filter((_, i) => i % stride === 0);
  if (out[out.length - 1] !== values[values.length - 1]) out.push(values[values.length - 1]);
  return out;
}

// Two queries per render, and the page itself is ISR-cached (revalidate
// 3600 + revalidatePath after ingest), so human traffic never adds load.
export async function getDashboardData(): Promise<DashboardData> {
  const [points, lastRun] = await Promise.all([
    prisma.metricPoint.findMany({
      select: { metricKey: true, date: true, value: true },
      orderBy: { date: "asc" },
    }),
    prisma.ingestRun.findFirst({ orderBy: { id: "desc" } }),
  ]);

  const byKey = new Map<string, { date: Date; value: number }[]>();
  for (const p of points) {
    let arr = byKey.get(p.metricKey);
    if (!arr) byKey.set(p.metricKey, (arr = []));
    arr.push({ date: p.date, value: p.value });
  }

  const metrics: MetricView[] = [];
  for (const def of METRICS) {
    if (def.panel === "internal") continue;
    const hist = byKey.get(def.key);
    if (!hist || hist.length === 0) continue;
    const values = hist.map((h) => h.value);
    const latest = hist[hist.length - 1];
    const sparkWindow = hist.slice(-SPARK_HISTORY_POINTS);
    metrics.push({
      key: def.key,
      name: def.name,
      panel: def.panel,
      unit: def.unit,
      decimals: def.decimals,
      describe: def.describe,
      latest: { date: latest.date.toISOString().slice(0, 10), value: latest.value },
      percentile: percentileRank(values, latest.value),
      z: zScore(values, latest.value),
      min: Math.min(...values),
      med: median(values),
      max: Math.max(...values),
      sinceYear: hist[0].date.getUTCFullYear(),
      spark: downsample(sparkWindow.map((h) => h.value), SPARK_MAX_POINTS),
      sparkStartYear: sparkWindow[0].date.getUTCFullYear(),
    });
  }

  const dataThrough = metrics.length
    ? metrics.map((m) => m.latest.date).sort().at(-1)!
    : null;

  // Recompute the portfolio live from the same metric points (identical
  // math to what ingest persisted) so the panel always matches the data.
  const metricSeries = new Map<string, SeriesPoint[]>();
  for (const [key, hist] of byKey) {
    metricSeries.set(
      key,
      hist.map((h) => ({ date: h.date.toISOString().slice(0, 10), value: h.value })),
    );
  }
  const full = computePortfolio(metricSeries);
  let portfolio: PortfolioView | null = null;
  if (full) {
    const { regimeHistory: _history, ...view } = full;
    void _history;
    portfolio = view;
  }

  return {
    metrics,
    portfolio,
    trackRecord: buildTrackRecord(byKey),
    ml: buildMl(byKey),
    global: buildGlobal(byKey),
    timeline: buildTimeline(byKey),
    dataThrough,
    lastRun: lastRun
      ? { finishedAt: lastRun.finishedAt?.toISOString() ?? null, status: lastRun.status }
      : null,
  };
}
