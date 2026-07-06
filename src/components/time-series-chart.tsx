"use client";

import { useEffect, useRef, useState } from "react";
import { formatValue } from "@/lib/format";
import { labelOfIdx, type TimelinePoint } from "@/lib/timeline";

const MARGIN = { top: 14, right: 64, bottom: 26, left: 10 };
const HEIGHT = 300;

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

// 3-8 "nice" y-axis tick values covering [min, max].
function niceTicks(min: number, max: number): number[] {
  const span = max - min || 1;
  const step = 10 ** Math.floor(Math.log10(span / 4));
  const candidates = [step, step * 2, step * 2.5, step * 5, step * 10];
  const chosen = candidates.find((s) => span / s <= 6) ?? step * 10;
  const ticks: number[] = [];
  for (let v = Math.ceil(min / chosen) * chosen; v <= max + 1e-9; v += chosen) {
    ticks.push(Math.round(v * 1e6) / 1e6);
  }
  return ticks;
}

// Measures its container so the SVG renders at 1:1 pixels (no stretched text).
export function useMeasuredWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((entries) => setWidth(entries[0].contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}

export function xTickIdxs(minIdx: number, maxIdx: number): number[] {
  const spanYears = (maxIdx - minIdx) / 12;
  const everyYears = spanYears > 45 ? 10 : spanYears > 18 ? 5 : spanYears > 7 ? 2 : 1;
  const ticks: number[] = [];
  const firstYear = Math.ceil(minIdx / 12 / everyYears) * everyYears;
  for (let y = firstYear; y * 12 <= maxIdx; y += everyYears) ticks.push(y * 12);
  return ticks;
}

export function TimeSeriesChart({
  points,
  recessions,
  domain,
  unit,
  decimals,
}: {
  points: TimelinePoint[];
  recessions: [number, number][];
  domain: [number, number];
  unit: string;
  decimals: number;
}) {
  const { ref, width } = useMeasuredWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null); // index into points

  if (points.length < 2) return <div ref={ref} className="h-[300px]" />;

  const [minIdx, maxIdx] = domain;
  const values = points.map((p) => p[1]);
  const sorted = [...values].sort((a, b) => a - b);
  const p10 = quantile(sorted, 0.1);
  const p90 = quantile(sorted, 0.9);
  const med = quantile(sorted, 0.5);
  const vMin = sorted[0];
  const vMax = sorted[sorted.length - 1];
  const pad = (vMax - vMin || 1) * 0.06;

  const innerW = Math.max(width - MARGIN.left - MARGIN.right, 50);
  const innerH = HEIGHT - MARGIN.top - MARGIN.bottom;
  const x = (idx: number) => MARGIN.left + ((idx - minIdx) / (maxIdx - minIdx || 1)) * innerW;
  const y = (v: number) => MARGIN.top + innerH - ((v - (vMin - pad)) / (vMax - vMin + 2 * pad)) * innerH;

  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join("");
  const last = points[points.length - 1];
  const yTicks = niceTicks(vMin - pad, vMax + pad);
  const hoverPt = hover !== null ? points[hover] : null;

  const fmt = (v: number) => formatValue(v, unit, decimals);

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const idxAt = minIdx + ((e.clientX - rect.left - MARGIN.left) / innerW) * (maxIdx - minIdx);
    let best = 0;
    let bestDist = Infinity;
    points.forEach((p, i) => {
      const d = Math.abs(p[0] - idxAt);
      if (d < bestDist) { bestDist = d; best = i; }
    });
    setHover(best);
  }

  return (
    <div ref={ref} className="w-full">
      {width > 0 && (
        <svg
          width={width}
          height={HEIGHT}
          className="block select-none"
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
          role="img"
          aria-label="Full-history chart of the selected metric with recession shading"
        >
          {recessions.map(([s, e]) =>
            e >= minIdx && s <= maxIdx ? (
              <rect
                key={s}
                x={x(Math.max(s, minIdx))}
                y={MARGIN.top}
                width={Math.max(x(Math.min(e + 1, maxIdx)) - x(Math.max(s, minIdx)), 1)}
                height={innerH}
                className="fill-neutral-500/10"
              />
            ) : null,
          )}
          <rect
            x={MARGIN.left}
            y={y(p90)}
            width={innerW}
            height={Math.max(y(p10) - y(p90), 0)}
            className="fill-blue-500/[0.07]"
          />
          <line
            x1={MARGIN.left} x2={MARGIN.left + innerW} y1={y(med)} y2={y(med)}
            className="stroke-neutral-400 dark:stroke-neutral-600"
            strokeDasharray="3 4"
            strokeWidth="1"
          />
          {yTicks.map((t) => (
            <g key={t}>
              <line
                x1={MARGIN.left} x2={MARGIN.left + innerW} y1={y(t)} y2={y(t)}
                className="stroke-neutral-200 dark:stroke-neutral-800"
                strokeWidth="0.5"
              />
              <text
                x={MARGIN.left + innerW + 6} y={y(t) + 3.5}
                className="fill-neutral-400 text-[10px] tabular-nums"
              >
                {fmt(t)}
              </text>
            </g>
          ))}
          {xTickIdxs(minIdx, maxIdx).map((idx) => (
            <text
              key={idx}
              x={x(idx)} y={HEIGHT - 8}
              textAnchor="middle"
              className="fill-neutral-400 text-[10px] tabular-nums"
            >
              {Math.floor(idx / 12)}
            </text>
          ))}
          <path
            d={path}
            fill="none"
            className="stroke-neutral-800 dark:stroke-neutral-200"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <circle cx={x(last[0])} cy={y(last[1])} r="3.5" className="fill-blue-600 dark:fill-blue-400" />
          {hoverPt && (
            <g>
              <line
                x1={x(hoverPt[0])} x2={x(hoverPt[0])} y1={MARGIN.top} y2={MARGIN.top + innerH}
                className="stroke-neutral-400 dark:stroke-neutral-500"
                strokeWidth="0.75"
              />
              <circle cx={x(hoverPt[0])} cy={y(hoverPt[1])} r="3" className="fill-neutral-700 dark:fill-neutral-300" />
              <g transform={`translate(${Math.min(Math.max(x(hoverPt[0]) - 55, MARGIN.left), MARGIN.left + innerW - 110)}, 0)`}>
                <rect width="110" height="16" rx="3" className="fill-neutral-800 dark:fill-neutral-200" />
                <text x="55" y="11.5" textAnchor="middle" className="fill-white dark:fill-neutral-900 text-[10px] tabular-nums">
                  {labelOfIdx(hoverPt[0])} · {fmt(hoverPt[1])}
                </text>
              </g>
            </g>
          )}
        </svg>
      )}
    </div>
  );
}
