import type { SeriesPoint } from "@/lib/fred";
import { mean, percentileRank, zScore } from "@/lib/stats";

// Dynamic All Weather engine. Deterministic and fully explainable:
//   weights = baseline + Σ (quadrant probability × quadrant tilt)
//           + valuation overlay + real-rate overlay, then guardrails.
// Every number in the output traces back to a named signal.

export type QuadrantKey = "goldilocks" | "reflation" | "bust" | "stagflation";

export const QUADRANTS: { key: QuadrantKey; name: string; describe: string }[] = [
  { key: "goldilocks", name: "Goldilocks", describe: "growth rising, inflation falling" },
  { key: "reflation", name: "Reflation", describe: "growth rising, inflation rising" },
  { key: "stagflation", name: "Stagflation", describe: "growth falling, inflation rising" },
  { key: "bust", name: "Deflationary bust", describe: "growth falling, inflation falling" },
];

export const ASSETS = [
  { key: "equities", name: "Equities", etf: "VTI", baseline: 30 },
  { key: "long_treasuries", name: "Long Treasuries", etf: "TLT", baseline: 40 },
  { key: "intermediate_treasuries", name: "Intermediate Treasuries", etf: "IEF", baseline: 15 },
  { key: "tips", name: "TIPS", etf: "SCHP", baseline: 0 },
  { key: "gold", name: "Gold", etf: "GLD", baseline: 7.5 },
  { key: "commodities", name: "Commodities", etf: "PDBC", baseline: 7.5 },
  { key: "cash", name: "Cash (T-bills)", etf: "BIL", baseline: 0 },
] as const;

export type AssetKey = (typeof ASSETS)[number]["key"];

// Percentage-point tilts per quadrant, applied in proportion to that
// quadrant's probability. Each vector sums to zero.
const TILTS: Record<QuadrantKey, Partial<Record<AssetKey, number>>> = {
  goldilocks: { equities: 10, long_treasuries: -5, commodities: -5 },
  reflation: { commodities: 8, tips: 5, gold: 2, equities: -5, long_treasuries: -10 },
  bust: { long_treasuries: 10, cash: 5, intermediate_treasuries: 3, equities: -10, commodities: -5, gold: -3 },
  stagflation: { gold: 8, tips: 8, cash: 4, equities: -10, long_treasuries: -10 },
};

const ACTIVE_SHARE_CAP = 20; // total tilt budget in percentage points
const SIGMOID_K = 1.25; // composite z → probability sensitivity
const SMOOTH_MONTHS = 3; // average probabilities over the last n months
const FFILL_MONTHS = 2; // tolerate publication lag on the month grid

type SignalDef = {
  name: string;
  metricKey: string;
  // level: use the metric as-is; delta: change over n months;
  // momentum: level minus its own trailing n-month average
  kind: "level" | "delta" | "momentum";
  months?: number;
  invert?: boolean;
  weight: number;
};

const GROWTH_SIGNALS: SignalDef[] = [
  { name: "Sahm rule", metricKey: "sahm_rule", kind: "level", invert: true, weight: 1.25 },
  { name: "unemployment 12m change", metricKey: "unemployment", kind: "delta", months: 12, invert: true, weight: 1 },
  { name: "yield curve", metricKey: "yield_curve", kind: "level", weight: 1 },
  { name: "HY spread 6m change", metricKey: "hy_spread", kind: "delta", months: 6, invert: true, weight: 1 },
  { name: "industrial production YoY", metricKey: "indpro_yoy", kind: "level", weight: 1.25 },
  { name: "payrolls YoY", metricKey: "payems_yoy", kind: "level", weight: 1.25 },
  { name: "sentiment 6m change", metricKey: "consumer_sentiment", kind: "delta", months: 6, weight: 0.75 },
];

const INFLATION_SIGNALS: SignalDef[] = [
  { name: "CPI momentum", metricKey: "cpi_yoy", kind: "momentum", months: 12, weight: 1.25 },
  { name: "core PCE level", metricKey: "core_pce_yoy", kind: "level", weight: 1.25 },
  { name: "M2 growth", metricKey: "m2_yoy", kind: "level", weight: 0.75 },
  { name: "breakeven 6m change", metricKey: "breakeven_10y", kind: "delta", months: 6, weight: 1 },
  { name: "breakeven level", metricKey: "breakeven_10y", kind: "level", weight: 0.75 },
];

const MIN_SIGNALS = { growth: 3, inflation: 2 };

export type PortfolioWeight = {
  key: AssetKey;
  name: string;
  etf: string;
  baseline: number;
  weight: number;
  delta: number;
};

export type PortfolioResult = {
  asOf: string; // YYYY-MM-01 of the latest signal month
  pGrowthUp: number;
  pInflationUp: number;
  quadrants: { key: QuadrantKey; name: string; describe: string; prob: number }[];
  weights: PortfolioWeight[];
  activeShare: number;
  notes: string[];
  // full monthly history of quadrant probabilities, for persistence/charts
  regimeHistory: Record<QuadrantKey, SeriesPoint[]>;
};

const monthIdx = (date: string) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
const idxToDate = (idx: number) =>
  `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}-01`;
const sigmoid = (z: number) => 1 / (1 + Math.exp(-SIGMOID_K * z));

// Turn a metric series into a z-scored signal series keyed by month index.
function buildSignal(points: SeriesPoint[], def: SignalDef): Map<number, number> {
  const byIdx = new Map(points.map((p) => [monthIdx(p.date), p.value]));
  const raw = new Map<number, number>();
  for (const [idx, v] of byIdx) {
    if (def.kind === "level") {
      raw.set(idx, v);
    } else if (def.kind === "delta") {
      const prev = byIdx.get(idx - (def.months ?? 12));
      if (prev !== undefined) raw.set(idx, v - prev);
    } else {
      const window: number[] = [];
      for (let k = 1; k <= (def.months ?? 12); k++) {
        const w = byIdx.get(idx - k);
        if (w !== undefined) window.push(w);
      }
      if (window.length >= (def.months ?? 12) * 0.75) raw.set(idx, v - mean(window));
    }
  }
  const values = [...raw.values()];
  if (values.length < 24) return new Map();
  const out = new Map<number, number>();
  for (const [idx, v] of raw) {
    const z = zScore(values, v);
    out.set(idx, def.invert ? -z : z);
  }
  return out;
}

// Weighted-average composite z per month, forward-filling each signal by up
// to FFILL_MONTHS to bridge publication lags.
function composite(
  signals: SignalDef[],
  seriesByKey: Map<string, SeriesPoint[]>,
  minSignals: number,
): { z: Map<number, number>; latestSignalZ: { name: string; z: number }[] } {
  const built = signals
    .map((def) => ({ def, z: buildSignal(seriesByKey.get(def.metricKey) ?? [], def) }))
    .filter((s) => s.z.size > 0);

  let minIdx = Infinity;
  let maxIdx = -Infinity;
  for (const s of built) {
    for (const idx of s.z.keys()) {
      if (idx < minIdx) minIdx = idx;
      if (idx > maxIdx) maxIdx = idx;
    }
  }
  const out = new Map<number, number>();
  const latestSignalZ: { name: string; z: number }[] = [];
  if (built.length === 0 || !Number.isFinite(minIdx)) return { z: out, latestSignalZ };

  for (let t = minIdx; t <= maxIdx; t++) {
    let sumWZ = 0;
    let sumW = 0;
    let count = 0;
    for (const s of built) {
      let z: number | undefined;
      for (let back = 0; back <= FFILL_MONTHS; back++) {
        z = s.z.get(t - back);
        if (z !== undefined) break;
      }
      if (z !== undefined) {
        sumWZ += s.def.weight * z;
        sumW += s.def.weight;
        count++;
      }
    }
    if (count >= minSignals) out.set(t, sumWZ / sumW);
  }

  for (const s of built) {
    for (let back = 0; back <= FFILL_MONTHS; back++) {
      const z = s.z.get(maxIdx - back);
      if (z !== undefined) {
        latestSignalZ.push({ name: s.def.name, z });
        break;
      }
    }
  }
  return { z: out, latestSignalZ };
}

function quadrantProbs(pG: number, pI: number): Record<QuadrantKey, number> {
  return {
    goldilocks: pG * (1 - pI),
    reflation: pG * pI,
    stagflation: (1 - pG) * pI,
    bust: (1 - pG) * (1 - pI),
  };
}

function latestPercentile(points: SeriesPoint[] | undefined): number | null {
  if (!points || points.length < 24) return null;
  const values = points.map((p) => p.value);
  return percentileRank(values, values[values.length - 1]);
}

function baselineWeights(): Record<AssetKey, number> {
  return Object.fromEntries(ASSETS.map((a) => [a.key, a.baseline])) as Record<AssetKey, number>;
}

// Baseline + probability-weighted quadrant tilts (before overlays/guardrails).
function applyQuadrantTilts(probs: Record<QuadrantKey, number>): Record<AssetKey, number> {
  const w = baselineWeights();
  for (const q of QUADRANTS) {
    for (const [asset, tilt] of Object.entries(TILTS[q.key])) {
      w[asset as AssetKey] += probs[q.key] * tilt;
    }
  }
  return w;
}

// Guardrails, in place: no shorts, cap total active share at the tilt budget,
// renormalize to 100. Returns the resulting active share.
function guardrail(w: Record<AssetKey, number>): number {
  for (const a of ASSETS) w[a.key] = Math.max(0, w[a.key]);
  const activeShare = ASSETS.reduce((s, a) => s + Math.abs(w[a.key] - a.baseline), 0) / 2;
  if (activeShare > ACTIVE_SHARE_CAP) {
    const scale = ACTIVE_SHARE_CAP / activeShare;
    for (const a of ASSETS) w[a.key] = a.baseline + (w[a.key] - a.baseline) * scale;
  }
  const total = ASSETS.reduce((s, a) => s + w[a.key], 0);
  for (const a of ASSETS) w[a.key] = (w[a.key] / total) * 100;
  return ASSETS.reduce((s, a) => s + Math.abs(w[a.key] - a.baseline), 0) / 2;
}

export function computePortfolio(
  seriesByKey: Map<string, SeriesPoint[]>,
): PortfolioResult | null {
  const growth = composite(GROWTH_SIGNALS, seriesByKey, MIN_SIGNALS.growth);
  const inflation = composite(INFLATION_SIGNALS, seriesByKey, MIN_SIGNALS.inflation);
  if (growth.z.size === 0 || inflation.z.size === 0) return null;

  // Month grid where both composites exist -> quadrant probability history.
  const commonIdx = [...growth.z.keys()].filter((t) => inflation.z.has(t)).sort((a, b) => a - b);
  if (commonIdx.length < SMOOTH_MONTHS) return null;

  const regimeHistory: Record<QuadrantKey, SeriesPoint[]> = {
    goldilocks: [], reflation: [], stagflation: [], bust: [],
  };
  for (const t of commonIdx) {
    const probs = quadrantProbs(sigmoid(growth.z.get(t)!), sigmoid(inflation.z.get(t)!));
    for (const q of QUADRANTS) {
      regimeHistory[q.key].push({ date: idxToDate(t), value: probs[q.key] });
    }
  }

  // Current regime = average of the last SMOOTH_MONTHS months.
  const tail = commonIdx.slice(-SMOOTH_MONTHS);
  const gz = mean(tail.map((t) => growth.z.get(t)!));
  const iz = mean(tail.map((t) => inflation.z.get(t)!));
  const pGrowthUp = sigmoid(gz);
  const pInflationUp = sigmoid(iz);
  const probs = quadrantProbs(pGrowthUp, pInflationUp);
  const asOf = idxToDate(commonIdx[commonIdx.length - 1]);

  // Baseline + probability-weighted quadrant tilts.
  const w = applyQuadrantTilts(probs);

  const notes: string[] = [];
  const dominant = [...QUADRANTS].sort((a, b) => probs[b.key] - probs[a.key])[0];
  notes.push(
    `Dominant regime: ${dominant.name.toLowerCase()} (${Math.round(probs[dominant.key] * 100)}% — ${dominant.describe})`,
  );
  const fmtZ = (z: number) => `${z >= 0 ? "+" : ""}${z.toFixed(1)}`;
  const topG = [...growth.latestSignalZ].sort((a, b) => Math.abs(b.z) - Math.abs(a.z))[0];
  const topI = [...inflation.latestSignalZ].sort((a, b) => Math.abs(b.z) - Math.abs(a.z))[0];
  if (topG) notes.push(`Growth composite z ${fmtZ(gz)}; strongest signal: ${topG.name} (z ${fmtZ(topG.z)})`);
  if (topI) notes.push(`Inflation composite z ${fmtZ(iz)}; strongest signal: ${topI.name} (z ${fmtZ(topI.z)})`);

  // Valuation overlay (Buffett): trim equities when historically expensive,
  // add when historically cheap; offset against cash.
  const buffettPct = latestPercentile(seriesByKey.get("buffett_indicator"));
  if (buffettPct !== null) {
    let eqAdj = 0;
    if (buffettPct > 75) eqAdj = (-5 * (buffettPct - 75)) / 25;
    else if (buffettPct < 25) eqAdj = (5 * (25 - buffettPct)) / 25;
    if (Math.abs(eqAdj) >= 0.05) {
      w.equities += eqAdj;
      w.cash -= eqAdj;
      notes.push(
        `Buffett indicator at ${Math.round(buffettPct)}th pctile → equities ${eqAdj > 0 ? "+" : ""}${eqAdj.toFixed(1)}pp`,
      );
    }
  }

  // Real-rate overlay: duration is more attractive when real yields are
  // historically high; offset against cash.
  const realPct = latestPercentile(seriesByKey.get("real_10y"));
  if (realPct !== null) {
    const durAdj = (4 * (realPct - 50)) / 50;
    if (Math.abs(durAdj) >= 0.05) {
      w.long_treasuries += durAdj;
      w.cash -= durAdj;
      notes.push(
        `Real 10y at ${Math.round(realPct)}th pctile → long Treasuries ${durAdj > 0 ? "+" : ""}${durAdj.toFixed(1)}pp`,
      );
    }
  }

  // Guardrails: no shorts; cap total active share; renormalize to 100.
  const activeShare = guardrail(w);

  return {
    asOf,
    pGrowthUp,
    pInflationUp,
    quadrants: QUADRANTS.map((q) => ({ ...q, prob: probs[q.key] })),
    weights: ASSETS.map((a) => ({
      key: a.key,
      name: a.name,
      etf: a.etf,
      baseline: a.baseline,
      weight: w[a.key],
      delta: w[a.key] - a.baseline,
    })),
    activeShare,
    notes,
    regimeHistory,
  };
}

export type TrackRecord = {
  dynamic: SeriesPoint[]; // cumulative growth index (start 100)
  static: SeriesPoint[];
};

// Reconstruct the model's historical track record from the stored regime
// probabilities and ETF prices. For each month, the dynamic weights are the
// deterministic quadrant tilts applied to that month's regime probabilities
// (the valuation/real-rate overlays are NOT replayed — they need
// point-in-time percentiles, which belongs in the phase-3 backtest). Both
// portfolios are rebalanced monthly on adjusted closes over the window where
// every ETF has prices. This reuses full-sample regime z-scores, so it is
// illustrative, not a lookahead-free backtest.
export function computeTrackRecord(
  regimeHistory: Record<QuadrantKey, SeriesPoint[]>,
  etfPrices: Map<string, SeriesPoint[]>,
): TrackRecord | null {
  const probsByDate = new Map<string, Record<QuadrantKey, number>>();
  for (const q of QUADRANTS) {
    for (const p of regimeHistory[q.key]) {
      const r = probsByDate.get(p.date) ?? { goldilocks: 0, reflation: 0, stagflation: 0, bust: 0 };
      r[q.key] = p.value;
      probsByDate.set(p.date, r);
    }
  }

  // Price lookup per asset, and the set of dates where every ETF has a price.
  const priceByAsset = new Map<AssetKey, Map<string, number>>();
  for (const a of ASSETS) {
    const pts = etfPrices.get(a.etf);
    if (!pts || pts.length === 0) return null;
    priceByAsset.set(a.key, new Map(pts.map((p) => [p.date, p.value])));
  }
  const firstAsset = priceByAsset.get(ASSETS[0].key)!;
  const dates = [...firstAsset.keys()]
    .filter((d) => ASSETS.every((a) => priceByAsset.get(a.key)!.has(d)))
    .sort();
  if (dates.length < 13) return null; // need at least a year

  const baseFrac = Object.fromEntries(ASSETS.map((a) => [a.key, a.baseline / 100])) as Record<AssetKey, number>;

  let dynIdx = 100;
  let staIdx = 100;
  const dynamic: SeriesPoint[] = [{ date: dates[0], value: 100 }];
  const staticSeries: SeriesPoint[] = [{ date: dates[0], value: 100 }];

  for (let i = 1; i < dates.length; i++) {
    const d0 = dates[i - 1];
    const d1 = dates[i];
    // Weights held over the month are set at its start (d0).
    const probs = probsByDate.get(d0);
    let dynFrac: Record<AssetKey, number>;
    if (probs) {
      const w = applyQuadrantTilts(probs);
      guardrail(w); // mutates to percent weights summing to 100
      dynFrac = Object.fromEntries(ASSETS.map((a) => [a.key, w[a.key] / 100])) as Record<AssetKey, number>;
    } else {
      dynFrac = baseFrac;
    }
    let dynR = 0;
    let staR = 0;
    for (const a of ASSETS) {
      const p0 = priceByAsset.get(a.key)!.get(d0)!;
      const p1 = priceByAsset.get(a.key)!.get(d1)!;
      const ret = p1 / p0 - 1;
      dynR += dynFrac[a.key] * ret;
      staR += baseFrac[a.key] * ret;
    }
    dynIdx *= 1 + dynR;
    staIdx *= 1 + staR;
    dynamic.push({ date: d1, value: dynIdx });
    staticSeries.push({ date: d1, value: staIdx });
  }

  return { dynamic, static: staticSeries };
}
