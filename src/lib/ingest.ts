import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { fetchFredSeries, type SeriesPoint } from "@/lib/fred";
import { METRICS, SERIES } from "@/lib/metrics";
import { applyTransform } from "@/lib/stats";

export type IngestResult = {
  status: "ok" | "error";
  seriesCount: number;
  rowsUpserted: number;
  metricsComputed: number;
  durationMs: number;
  errors: string[];
};

const UPSERT_CHUNK = 5000;

function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// The whole operation budget hinges on this: one multi-row INSERT ... ON
// CONFLICT per chunk (5000 rows) instead of one query per observation.
// ON CONFLICT DO UPDATE also picks up FRED's revisions to past values.
export async function upsertObservations(
  seriesId: number,
  points: SeriesPoint[],
): Promise<number> {
  let n = 0;
  for (const chunk of chunks(points, UPSERT_CHUNK)) {
    const values = Prisma.join(
      chunk.map((p) => Prisma.sql`(${seriesId}, ${p.date}::date, ${p.value})`),
    );
    await prisma.$executeRaw`
      INSERT INTO observations (series_id, date, value)
      VALUES ${values}
      ON CONFLICT (series_id, date) DO UPDATE SET value = EXCLUDED.value
    `;
    n += chunk.length;
  }
  return n;
}

// Make sure a Series row exists for every configured series; returns
// code -> id. Two queries total regardless of how many series there are.
export async function ensureSeries(): Promise<Map<string, number>> {
  const existing = await prisma.series.findMany({ select: { id: true, code: true } });
  const known = new Map(existing.map((s) => [s.code, s.id]));
  const missing = SERIES.filter((s) => !known.has(s.code));
  if (missing.length > 0) {
    await prisma.series.createMany({
      data: missing.map((s) => ({
        code: s.code,
        name: s.name,
        frequency: s.frequency,
        units: s.units,
      })),
      skipDuplicates: true,
    });
    const refreshed = await prisma.series.findMany({ select: { id: true, code: true } });
    return new Map(refreshed.map((s) => [s.code, s.id]));
  }
  return known;
}

// Rebuild every derived metric from raw observations. All raw data is
// loaded in a single query (the full table is ~20k rows), transforms run
// in memory, and each metric is written back as delete + createMany.
export async function recomputeMetrics(): Promise<number> {
  const seriesMeta = await prisma.series.findMany({ select: { id: true, code: true } });
  const codeById = new Map(seriesMeta.map((s) => [s.id, s.code]));

  const rows = await prisma.observation.findMany({
    select: { seriesId: true, date: true, value: true },
    orderBy: { date: "asc" },
  });
  const seriesByCode = new Map<string, SeriesPoint[]>();
  for (const row of rows) {
    const code = codeById.get(row.seriesId);
    if (!code) continue;
    let arr = seriesByCode.get(code);
    if (!arr) seriesByCode.set(code, (arr = []));
    arr.push({ date: row.date.toISOString().slice(0, 10), value: row.value });
  }

  let computed = 0;
  for (const metric of METRICS) {
    const points = applyTransform(metric.transform, seriesByCode);
    if (points.length === 0) continue;
    await prisma.metricPoint.deleteMany({ where: { metricKey: metric.key } });
    await prisma.metricPoint.createMany({
      data: points.map((p) => ({
        metricKey: metric.key,
        date: new Date(`${p.date}T00:00:00Z`),
        value: p.value,
      })),
    });
    computed++;
  }
  return computed;
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
}

// full=true fetches each series' complete history (first run / backfill);
// otherwise only the last two years, which is enough to capture revisions.
export async function runIngest({ full = false }: { full?: boolean } = {}): Promise<IngestResult> {
  const startedAt = new Date();
  const errors: string[] = [];
  let rowsUpserted = 0;
  let seriesCount = 0;

  const idByCode = await ensureSeries();
  const observationStart = full ? undefined : isoDaysAgo(730);

  for (const def of SERIES) {
    try {
      const points = await fetchFredSeries(def.code, {
        aggregateMonthly: def.aggregateMonthly,
        observationStart,
      });
      const seriesId = idByCode.get(def.code);
      if (seriesId === undefined) throw new Error(`series row missing for ${def.code}`);
      rowsUpserted += await upsertObservations(seriesId, points);
      seriesCount++;
      // Stay well under FRED's 120 requests/minute limit.
      await new Promise((r) => setTimeout(r, 100));
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }

  const metricsComputed = seriesCount > 0 ? await recomputeMetrics() : 0;
  const status: IngestResult["status"] = errors.length === 0 ? "ok" : "error";

  await prisma.ingestRun.create({
    data: {
      startedAt,
      finishedAt: new Date(),
      status,
      seriesCount,
      rowsUpserted,
      error: errors.length > 0 ? errors.join("; ").slice(0, 1000) : null,
    },
  });

  return {
    status,
    seriesCount,
    rowsUpserted,
    metricsComputed,
    durationMs: Date.now() - startedAt.getTime(),
    errors,
  };
}
