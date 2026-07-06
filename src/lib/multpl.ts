import type { SeriesPoint } from "@/lib/fred";

const MONTHS: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

// Shiller CAPE (cyclically adjusted P/E) from multpl.com's monthly table.
// Shiller's own spreadsheet is only served as stale mirrors; multpl tracks
// it live and keyless. The value cell looks like "&#x2002; 41.60" — the
// en-space entity contains the digits "2002", so entities must be stripped
// before parsing the number. Rows are one per month; the current month is
// dated mid-month, so we normalize every date to the month's first day.
export async function fetchMultplCape(): Promise<SeriesPoint[]> {
  const res = await fetch("https://www.multpl.com/shiller-pe/table/by-month", {
    cache: "no-store",
    headers: { "user-agent": "Mozilla/5.0 (macro-tracker)" },
  });
  if (!res.ok) throw new Error(`multpl CAPE: HTTP ${res.status}`);
  const html = await res.text();

  const rowRe = /<tr[^>]*>\s*<td[^>]*>([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/g;
  const byMonth = new Map<string, number>();
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html))) {
    const dm = m[1].match(/^([A-Z][a-z]{2})\s+\d{1,2},\s+(\d{4})$/);
    if (!dm) continue;
    const month = MONTHS[dm[1]];
    if (!month) continue;
    // Strip HTML entities (e.g. &#x2002;) before reading the number.
    const value = Number(m[2].replace(/&#[^;]+;/g, " ").replace(/<[^>]*>/g, "").trim());
    // CAPE has ranged ~5–45 historically; guard against parse garbage.
    if (Number.isFinite(value) && value > 1 && value < 100) {
      byMonth.set(`${dm[2]}-${month}-01`, value);
    }
  }
  if (byMonth.size === 0) throw new Error("multpl CAPE: no rows parsed (page layout may have changed)");
  return [...byMonth.entries()]
    .map(([date, value]) => ({ date, value }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
