import "dotenv/config";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { prisma } from "../src/lib/db";

// Dumps the database to CSVs under ml/data/ for the local Python jobs.
// Python never needs cloud credentials — this bridge is the only DB reader.
// Run against prod like the backfill:  DATABASE_URL=<prod> npm run ml:export
const OUT_DIR = join(__dirname, "..", "ml", "data");

function toCsv(header: string[], rows: (string | number)[][]): string {
  return [header.join(","), ...rows.map((r) => r.join(","))].join("\n") + "\n";
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const series = await prisma.series.findMany({ select: { id: true, code: true } });
  const codeById = new Map(series.map((s) => [s.id, s.code]));
  const observations = await prisma.observation.findMany({
    select: { seriesId: true, date: true, value: true },
    orderBy: { date: "asc" },
  });
  writeFileSync(
    join(OUT_DIR, "observations.csv"),
    toCsv(
      ["code", "date", "value"],
      observations.map((o) => [codeById.get(o.seriesId) ?? "?", o.date.toISOString().slice(0, 10), o.value]),
    ),
  );

  const points = await prisma.metricPoint.findMany({
    select: { metricKey: true, date: true, value: true },
    orderBy: { date: "asc" },
  });
  writeFileSync(
    join(OUT_DIR, "metric_points.csv"),
    toCsv(
      ["metric_key", "date", "value"],
      points.map((p) => [p.metricKey, p.date.toISOString().slice(0, 10), p.value]),
    ),
  );

  console.log(`exported ${observations.length} observations, ${points.length} metric points -> ml/data/`);
  process.exit(0);
}

main();
