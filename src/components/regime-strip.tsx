"use client";

import { useMeasuredWidth, xTickIdxs } from "@/components/time-series-chart";
import type { TimelineData } from "@/lib/timeline";

const MARGIN = { top: 6, right: 64, bottom: 20, left: 10 };
const HEIGHT = 120;

// Same palette as the portfolio panel's regime bars.
const COLORS: Record<string, string> = {
  goldilocks: "hsl(160 55% 42%)",
  reflation: "hsl(38 75% 45%)",
  stagflation: "hsl(12 65% 48%)",
  bust: "hsl(217 65% 50%)",
};

// Stacked area of the four quadrant probabilities (they sum to 1), on the
// same x-domain as the main chart above so recessions and regimes line up.
export function RegimeStrip({
  regimes,
  recessions,
  domain,
}: {
  regimes: TimelineData["regimes"];
  recessions: [number, number][];
  domain: [number, number];
}) {
  const { ref, width } = useMeasuredWidth<HTMLDivElement>();
  const [minIdx, maxIdx] = domain;

  const byIdx = new Map<number, number[]>(); // idx -> prob per regime (ordered)
  regimes.forEach((r, ri) => {
    for (const [idx, v] of r.points) {
      if (idx < minIdx || idx > maxIdx) continue;
      let arr = byIdx.get(idx);
      if (!arr) byIdx.set(idx, (arr = new Array(regimes.length).fill(0)));
      arr[ri] = v;
    }
  });
  const idxs = [...byIdx.keys()].sort((a, b) => a - b);

  const innerW = Math.max(width - MARGIN.left - MARGIN.right, 50);
  const innerH = HEIGHT - MARGIN.top - MARGIN.bottom;
  const x = (idx: number) => MARGIN.left + ((idx - minIdx) / (maxIdx - minIdx || 1)) * innerW;
  const y = (frac: number) => MARGIN.top + innerH - frac * innerH;

  // Cumulative stack: band ri spans [sum(0..ri-1), sum(0..ri)].
  const bands = regimes.map((r, ri) => {
    const top: string[] = [];
    const bottom: string[] = [];
    for (const idx of idxs) {
      const probs = byIdx.get(idx)!;
      const lo = probs.slice(0, ri).reduce((a, b) => a + b, 0);
      const hi = lo + probs[ri];
      top.push(`${x(idx).toFixed(1)},${y(hi).toFixed(1)}`);
      bottom.unshift(`${x(idx).toFixed(1)},${y(lo).toFixed(1)}`);
    }
    return { key: r.key, name: r.name, d: `M${top.join("L")}L${bottom.join("L")}Z` };
  });

  return (
    <div ref={ref} className="w-full">
      {width > 0 && idxs.length > 1 && (
        <>
          <svg
            width={width}
            height={HEIGHT}
            className="block"
            role="img"
            aria-label="Stacked area chart of regime probabilities through history"
          >
            {bands.map((b) => (
              <path key={b.key} d={b.d} fill={COLORS[b.key]} opacity="0.75" />
            ))}
            {recessions.map(([s, e]) =>
              e >= minIdx && s <= maxIdx ? (
                <rect
                  key={s}
                  x={x(Math.max(s, minIdx))}
                  y={MARGIN.top}
                  width={Math.max(x(Math.min(e + 1, maxIdx)) - x(Math.max(s, minIdx)), 1)}
                  height={innerH}
                  className="fill-neutral-900/20 dark:fill-black/40"
                />
              ) : null,
            )}
            {xTickIdxs(minIdx, maxIdx).map((idx) => (
              <text
                key={idx}
                x={x(idx)} y={HEIGHT - 6}
                textAnchor="middle"
                className="fill-neutral-400 text-[10px] tabular-nums"
              >
                {Math.floor(idx / 12)}
              </text>
            ))}
            <text
              x={MARGIN.left + innerW + 6} y={y(1) + 8}
              className="fill-neutral-400 text-[10px]"
            >
              regime
            </text>
          </svg>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-500">
            {regimes.map((r) => (
              <span key={r.key} className="inline-flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: COLORS[r.key] }} />
                {r.name}
              </span>
            ))}
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-sm bg-neutral-500/30" />
              NBER recession
            </span>
          </div>
        </>
      )}
    </div>
  );
}
