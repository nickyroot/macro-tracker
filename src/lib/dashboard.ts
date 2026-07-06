import { prisma } from "@/lib/db";
import type { SeriesPoint } from "@/lib/fred";
import { METRICS, type MetricDef } from "@/lib/metrics";
import { computePortfolio, QUADRANTS, type PortfolioResult } from "@/lib/portfolio";
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

export type DashboardData = {
  metrics: MetricView[];
  portfolio: PortfolioView | null;
  timeline: TimelineData;
  dataThrough: string | null;
  lastRun: { finishedAt: string | null; status: string } | null;
};

const SPARK_MAX_POINTS = 120;
const SPARK_HISTORY_POINTS = 300; // ~25y of monthly data

const round4 = (v: number) => Math.round(v * 10000) / 10000;

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
    timeline: buildTimeline(byKey),
    dataThrough,
    lastRun: lastRun
      ? { finishedAt: lastRun.finishedAt?.toISOString() ?? null, status: lastRun.status }
      : null,
  };
}
