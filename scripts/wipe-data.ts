import "dotenv/config";
import { prisma } from "../src/lib/db";

// Clears all ingested data (e.g. to replace demo data with real data)
// while keeping the schema and migration history intact.
async function main() {
  await prisma.$executeRaw`TRUNCATE observations, metric_points, ingest_runs, series RESTART IDENTITY CASCADE`;
  console.log("All data cleared. Run `npm run backfill` (or `npm run seed:demo`) to reload.");
  process.exit(0);
}

main();
