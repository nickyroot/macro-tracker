export function formatValue(value: number, unit: string, decimals: number): string {
  const n = value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  if (unit === "%") return `${n}%`;
  if (unit === "pp") return `${n}pp`;
  return n;
}

export function ordinal(n: number): string {
  const r = Math.round(n);
  const suffix =
    r % 100 >= 11 && r % 100 <= 13 ? "th" : { 1: "st", 2: "nd", 3: "rd" }[r % 10] ?? "th";
  return `${r}${suffix}`;
}

// Percentile → color. 50th = neutral gray; toward 0 = deeper blue; toward
// 100 = deeper red. Encodes "unusually low/high vs history", not good/bad.
// light-dark() keeps text legible in both color schemes.
export function percentileColor(p: number): { background: string; color: string } {
  const t = Math.min(Math.abs(p - 50) / 50, 1);
  const hue = p >= 50 ? 12 : 217;
  const sat = Math.round(10 + 75 * t);
  return {
    background: `light-dark(hsl(${hue} ${sat}% 45% / 0.14), hsl(${hue} ${sat}% 55% / 0.22))`,
    color: `light-dark(hsl(${hue} ${sat}% 32%), hsl(${hue} ${sat}% 72%))`,
  };
}

export function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
