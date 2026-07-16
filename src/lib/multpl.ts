import type { SeriesPoint } from "@/lib/fred";

const MONTHS: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

// Monthly tables scraped from multpl.com (keyless; Shiller's own spreadsheet
// is only served as stale mirrors, multpl tracks the same data live).
// Value cells need aggressive cleaning: an &#x2002; en-space entity whose
// digits ("2002") corrupt naive parses, comma thousands separators, a %
// suffix, and a dagger estimate marker on recent dividend-yield rows.
// Each series gets a plausible-range guard against parse garbage.
const TABLES: Record<string, { path: string; min: number; max: number }> = {
  SHILLER_CAPE: { path: "shiller-pe", min: 1, max: 100 },
  SP500_PRICE: { path: "s-p-500-historical-prices", min: 1, max: 100000 },
  SP500_DIVYIELD: { path: "s-p-500-dividend-yield", min: 0.1, max: 20 },
};

// Rows are one per month; row dates vary (first, last, or mid-month for the
// live estimate), so every date is normalized to the month's first day.
export async function fetchMultpl(code: string): Promise<SeriesPoint[]> {
  const table = TABLES[code];
  if (!table) throw new Error(`multpl: no table configured for ${code}`);
  const res = await fetch(`https://www.multpl.com/${table.path}/table/by-month`, {
    cache: "no-store",
    headers: { "user-agent": "Mozilla/5.0 (macro-tracker)" },
  });
  if (!res.ok) throw new Error(`multpl ${code}: HTTP ${res.status}`);
  const html = await res.text();

  const rowRe = /<tr[^>]*>\s*<td[^>]*>([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/g;
  const byMonth = new Map<string, number>();
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html))) {
    const dm = m[1].match(/^([A-Z][a-z]{2})\s+\d{1,2},\s+(\d{4})$/);
    if (!dm) continue;
    const month = MONTHS[dm[1]];
    if (!month) continue;
    const value = Number(
      m[2]
        .replace(/&#[^;]+;/g, " ")
        .replace(/<[^>]*>/g, "")
        .replace(/[,%†]/g, "")
        .trim(),
    );
    if (Number.isFinite(value) && value > table.min && value < table.max) {
      byMonth.set(`${dm[2]}-${month}-01`, value);
    }
  }
  if (byMonth.size === 0) throw new Error(`multpl ${code}: no rows parsed (page layout may have changed)`);
  return [...byMonth.entries()]
    .map(([date, value]) => ({ date, value }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
