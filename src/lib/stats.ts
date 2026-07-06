import type { SeriesPoint } from "@/lib/fred";
import type { MetricTransform } from "@/lib/metrics";

// Share of history at or below the current value, as 0–100.
export function percentileRank(history: number[], current: number): number {
  if (history.length === 0) return 50;
  const below = history.filter((v) => v <= current).length;
  return (below / history.length) * 100;
}

export function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function zScore(history: number[], current: number): number {
  if (history.length < 2) return 0;
  const m = mean(history);
  const sd = Math.sqrt(mean(history.map((v) => (v - m) ** 2)));
  return sd === 0 ? 0 : (current - m) / sd;
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// % change vs the observation exactly one year earlier. FRED dates are
// period starts (YYYY-MM-01), so the lagged date is the same month/day with
// year − 1 — this works uniformly for monthly and quarterly series.
export function yoy(points: SeriesPoint[]): SeriesPoint[] {
  const byDate = new Map(points.map((p) => [p.date, p.value]));
  const out: SeriesPoint[] = [];
  for (const p of points) {
    const prev = byDate.get(`${Number(p.date.slice(0, 4)) - 1}${p.date.slice(4)}`);
    if (prev !== undefined && prev !== 0) {
      out.push({ date: p.date, value: (p.value / prev - 1) * 100 });
    }
  }
  return out;
}

// num/den × scale, joined on exact date (both series must share a calendar,
// e.g. two quarterly FRED series with period-start dates).
export function ratio(num: SeriesPoint[], den: SeriesPoint[], scale: number): SeriesPoint[] {
  const denByDate = new Map(den.map((p) => [p.date, p.value]));
  const out: SeriesPoint[] = [];
  for (const p of num) {
    const d = denByDate.get(p.date);
    if (d !== undefined && d !== 0) {
      out.push({ date: p.date, value: (p.value / d) * scale });
    }
  }
  return out;
}

// scale / value — e.g. 100 / CAPE turns a P/E multiple into an earnings yield.
export function invert(points: SeriesPoint[], scale: number): SeriesPoint[] {
  return points
    .filter((p) => p.value !== 0)
    .map((p) => ({ date: p.date, value: scale / p.value }));
}

// (scale / num) − den, joined on exact date — e.g. (100 / CAPE) − 10y yield
// gives the equity risk premium (earnings yield minus the bond yield).
export function invSpread(
  num: SeriesPoint[],
  den: SeriesPoint[],
  scale: number,
): SeriesPoint[] {
  const denByDate = new Map(den.map((p) => [p.date, p.value]));
  const out: SeriesPoint[] = [];
  for (const p of num) {
    const d = denByDate.get(p.date);
    if (p.value !== 0 && d !== undefined) {
      out.push({ date: p.date, value: scale / p.value - d });
    }
  }
  return out;
}

export function applyTransform(
  transform: MetricTransform,
  seriesByCode: Map<string, SeriesPoint[]>,
): SeriesPoint[] {
  switch (transform.type) {
    case "direct":
      return seriesByCode.get(transform.series) ?? [];
    case "yoy":
      return yoy(seriesByCode.get(transform.series) ?? []);
    case "ratio":
      return ratio(
        seriesByCode.get(transform.num) ?? [],
        seriesByCode.get(transform.den) ?? [],
        transform.scale,
      );
    case "invert":
      return invert(seriesByCode.get(transform.series) ?? [], transform.scale);
    case "inv_spread":
      return invSpread(
        seriesByCode.get(transform.num) ?? [],
        seriesByCode.get(transform.den) ?? [],
        transform.scale,
      );
  }
}
