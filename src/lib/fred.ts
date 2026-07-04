const FRED_BASE = "https://api.stlouisfed.org/fred/series/observations";

export type SeriesPoint = { date: string; value: number };

// FRED marks missing values with "." — filter those out. For daily/weekly
// series we ask FRED to aggregate to monthly averages server-side, which
// keeps the observations table small and matches the dashboard cadence.
export async function fetchFredSeries(
  code: string,
  opts: { aggregateMonthly?: boolean; observationStart?: string } = {},
): Promise<SeriesPoint[]> {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) throw new Error("FRED_API_KEY is not set — get a free key at https://fred.stlouisfed.org/docs/api/api_key.html");

  const params = new URLSearchParams({
    series_id: code,
    api_key: apiKey,
    file_type: "json",
  });
  if (opts.aggregateMonthly) {
    params.set("frequency", "m");
    params.set("aggregation_method", "avg");
  }
  if (opts.observationStart) params.set("observation_start", opts.observationStart);

  const res = await fetch(`${FRED_BASE}?${params}`, { cache: "no-store" });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 200);
    throw new Error(`FRED ${code}: HTTP ${res.status} ${body}`);
  }
  const json = (await res.json()) as {
    observations?: { date: string; value: string }[];
  };
  return (json.observations ?? [])
    .filter((o) => o.value !== ".")
    .map((o) => ({ date: o.date, value: Number(o.value) }))
    .filter((o) => Number.isFinite(o.value));
}
