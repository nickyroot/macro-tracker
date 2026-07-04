import "dotenv/config";
import { runIngest } from "../src/lib/ingest";

// Full-history backfill. Run once after setting FRED_API_KEY + DATABASE_URL:
//   npm run backfill
async function main() {
  console.log("Backfilling full history from FRED…");
  const result = await runIngest({ full: true });
  console.log(
    `${result.status}: ${result.seriesCount} series, ${result.rowsUpserted} rows, ` +
      `${result.metricsComputed} metrics, ${(result.durationMs / 1000).toFixed(1)}s`,
  );
  for (const err of result.errors) console.error(`  error: ${err}`);
  process.exit(result.status === "ok" ? 0 : 1);
}

main();
