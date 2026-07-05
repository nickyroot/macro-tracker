import type { SeriesPoint } from "@/lib/fred";

type YahooChart = {
  chart: {
    result?: {
      timestamp?: number[];
      indicators: {
        quote: { close: (number | null)[] }[];
        adjclose?: { adjclose: (number | null)[] }[];
      };
    }[];
    error?: { description?: string } | null;
  };
};

// Monthly closes from Yahoo Finance's public chart API (no key needed).
// Adjusted close when available (splits/dividends), so long histories are
// comparable. Bars are stamped at the month's first trading day; we
// normalize to YYYY-MM-01 and dedupe by month — the in-progress month
// shows as a trailing partial bar that daily ingests keep overwriting.
export async function fetchYahooMonthly(symbol: string): Promise<SeriesPoint[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1mo&range=max`;
  const res = await fetch(url, {
    cache: "no-store",
    headers: { "user-agent": "Mozilla/5.0 (macro-tracker)" },
  });
  if (!res.ok) throw new Error(`Yahoo ${symbol}: HTTP ${res.status}`);
  const json = (await res.json()) as YahooChart;
  const result = json.chart.result?.[0];
  if (!result?.timestamp) {
    throw new Error(`Yahoo ${symbol}: ${json.chart.error?.description ?? "no data"}`);
  }
  const closes =
    result.indicators.adjclose?.[0]?.adjclose ?? result.indicators.quote[0]?.close ?? [];
  const byMonth = new Map<string, number>();
  result.timestamp.forEach((ts, i) => {
    const close = closes[i];
    if (close == null || !Number.isFinite(close)) return;
    byMonth.set(`${new Date(ts * 1000).toISOString().slice(0, 7)}-01`, close);
  });
  return [...byMonth.entries()]
    .map(([date, value]) => ({ date, value: Number(value.toFixed(4)) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
