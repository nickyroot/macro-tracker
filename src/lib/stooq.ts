import type { SeriesPoint } from "@/lib/fred";

// Stooq serves free historical prices as CSV, no API key. Monthly rows are
// dated at month end; we normalize to first-of-month to match the FRED
// period-start convention used everywhere else.
export async function fetchStooqMonthly(symbol: string): Promise<SeriesPoint[]> {
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol.toLowerCase())}&i=m`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Stooq ${symbol}: HTTP ${res.status}`);
  const csv = await res.text();
  const lines = csv.trim().split("\n");
  if (lines.length < 2 || !lines[0].startsWith("Date")) {
    throw new Error(`Stooq ${symbol}: unexpected response ${csv.slice(0, 80)}`);
  }
  const points: SeriesPoint[] = [];
  for (const line of lines.slice(1)) {
    const [date, , , , close] = line.split(",");
    const value = Number(close);
    if (date?.length === 10 && Number.isFinite(value)) {
      points.push({ date: `${date.slice(0, 8)}01`, value });
    }
  }
  return points;
}
