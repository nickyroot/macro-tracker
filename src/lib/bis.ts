import type { SeriesPoint } from "@/lib/fred";

// Normalize a BIS TIME_PERIOD to a first-of-month ISO date.
// Handles "2024-Q3" (quarterly), "2024-07" (monthly), "2024-07-15" (daily).
function normalizeDate(period: string): string | null {
  const q = period.match(/^(\d{4})-Q([1-4])$/);
  if (q) return `${q[1]}-${String((Number(q[2]) - 1) * 3 + 1).padStart(2, "0")}-01`;
  const m = period.match(/^(\d{4})-(\d{2})/); // monthly or daily → month start
  if (m) return `${m[1]}-${m[2]}-01`;
  return null;
}

// Fetch one BIS SDMX dataflow as CSV and return per-country series. The
// server-side key (e.g. "Q..P.A.C") filters dimensions so the download stays
// small; detail=dataonly drops free-text columns so the CSV is comma-safe.
// Country lives in BORROWERS_CTY (credit/DSR) or REF_AREA (policy rate).
export async function fetchBisByCountry(
  dataflow: string,
  key: string,
): Promise<Map<string, SeriesPoint[]>> {
  const url = `https://stats.bis.org/api/v1/data/${dataflow}/${key}/?detail=dataonly&format=csv`;
  const res = await fetch(url, {
    cache: "no-store",
    headers: { "user-agent": "Mozilla/5.0 (macro-tracker)" },
  });
  if (!res.ok) throw new Error(`BIS ${dataflow}: HTTP ${res.status}`);
  const text = await res.text();
  const lines = text.trim().split("\n");
  const header = lines[0].split(",");
  const ctyCol = header.findIndex((h) => h === "BORROWERS_CTY" || h === "REF_AREA");
  const timeCol = header.indexOf("TIME_PERIOD");
  const valCol = header.indexOf("OBS_VALUE");
  if (ctyCol < 0 || timeCol < 0 || valCol < 0) {
    throw new Error(`BIS ${dataflow}: unexpected columns ${header.join("|")}`);
  }

  // Collect raw (date, value) per country, then dedupe by month keeping the
  // chronologically last observation (matters if daily data slips through).
  const raw = new Map<string, Map<string, number>>();
  for (const line of lines.slice(1)) {
    const cells = line.split(",");
    const country = cells[ctyCol];
    const date = normalizeDate(cells[timeCol]);
    const value = Number(cells[valCol]);
    if (!country || !date || !Number.isFinite(value)) continue;
    let byMonth = raw.get(country);
    if (!byMonth) raw.set(country, (byMonth = new Map()));
    byMonth.set(date, value); // later rows (newer periods) overwrite
  }

  const out = new Map<string, SeriesPoint[]>();
  for (const [country, byMonth] of raw) {
    out.set(
      country,
      [...byMonth.entries()]
        .map(([date, value]) => ({ date, value }))
        .sort((a, b) => a.date.localeCompare(b.date)),
    );
  }
  return out;
}
