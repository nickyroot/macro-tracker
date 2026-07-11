import "dotenv/config";
import { readFileSync } from "fs";
import { join } from "path";
import { prisma } from "../src/lib/db";

// Writes local ML outputs back to the database. Reads ml/out/metric_points.csv
// (metric_key,date,value); every key MUST start with "ml:" so local jobs can
// never clobber the ingest pipeline's own series. Each ml: key is replaced
// wholesale (delete + createMany), same pattern as recomputeMetrics.
async function main() {
  const csv = readFileSync(join(__dirname, "..", "ml", "out", "metric_points.csv"), "utf8");
  const lines = csv.trim().split("\n").slice(1);
  const byKey = new Map<string, { date: Date; value: number }[]>();
  for (const line of lines) {
    const [key, date, value] = line.split(",");
    if (!key.startsWith("ml:")) throw new Error(`refusing non-ml key: ${key}`);
    const v = Number(value);
    if (!Number.isFinite(v)) continue;
    let arr = byKey.get(key);
    if (!arr) byKey.set(key, (arr = []));
    arr.push({ date: new Date(`${date}T00:00:00Z`), value: v });
  }

  let rows = 0;
  for (const [metricKey, points] of byKey) {
    await prisma.metricPoint.deleteMany({ where: { metricKey } });
    await prisma.metricPoint.createMany({
      data: points.map((p) => ({ metricKey, date: p.date, value: p.value })),
    });
    rows += points.length;
  }
  console.log(`imported ${byKey.size} ml: series (${rows} rows)`);
  process.exit(0);
}

main();
