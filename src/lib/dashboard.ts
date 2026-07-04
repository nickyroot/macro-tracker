import { prisma } from "@/lib/db";
import { METRICS, type MetricDef } from "@/lib/metrics";
import { median, percentileRank, zScore } from "@/lib/stats";

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

export type DashboardData = {
  metrics: MetricView[];
  dataThrough: string | null;
  lastRun: { finishedAt: string | null; status: string } | null;
};

const SPARK_MAX_POINTS = 120;
const SPARK_HISTORY_POINTS = 300; // ~25y of monthly data

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

  return {
    metrics,
    dataThrough,
    lastRun: lastRun
      ? { finishedAt: lastRun.finishedAt?.toISOString() ?? null, status: lastRun.status }
      : null,
  };
}
