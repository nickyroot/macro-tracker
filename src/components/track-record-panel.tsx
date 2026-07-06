import type { TrackRecordView } from "@/lib/dashboard";
import type { TimelinePoint } from "@/lib/timeline";

const W = 720;
const H = 260;
const M = { top: 12, right: 48, bottom: 22, left: 6 };

const pct = (v: number, dp = 1) => `${v >= 0 ? "" : "−"}${Math.abs(v * 100).toFixed(dp)}%`;

function yearTicks(minIdx: number, maxIdx: number): number[] {
  const span = (maxIdx - minIdx) / 12;
  const every = span > 18 ? 5 : span > 7 ? 2 : 1;
  const ticks: number[] = [];
  for (let y = Math.ceil(minIdx / 12 / every) * every; y * 12 <= maxIdx; y += every) ticks.push(y * 12);
  return ticks;
}

function line(points: TimelinePoint[], x: (i: number) => number, y: (v: number) => number): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join("");
}

// Server-rendered: a static comparison chart, no interactivity needed.
export function TrackRecordPanel({ track }: { track: TrackRecordView }) {
  const { dynamic, static: stat, points } = track;
  const all = [...points.dynamic, ...points.static].map((p) => p[1]);
  const minIdx = points.dynamic[0][0];
  const maxIdx = points.dynamic[points.dynamic.length - 1][0];
  const vMin = Math.min(...all);
  const vMax = Math.max(...all);
  const pad = (vMax - vMin || 1) * 0.05;

  const innerW = W - M.left - M.right;
  const innerH = H - M.top - M.bottom;
  const x = (idx: number) => M.left + ((idx - minIdx) / (maxIdx - minIdx || 1)) * innerW;
  const y = (v: number) => M.top + innerH - ((v - (vMin - pad)) / (vMax - vMin + 2 * pad)) * innerH;

  const yTicks = [vMin, (vMin + vMax) / 2, vMax].map((v) => Math.round(v));

  return (
    <section className="mb-10">
      <div className="mb-3 flex items-baseline gap-2">
        <h2 className="text-base font-medium">Track record</h2>
        <span className="text-sm text-neutral-500">dynamic mix vs static All Weather</span>
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Excess CAGR" value={pct(track.excessCagr, 1)} accent big />
          <Stat label="Dynamic CAGR" value={pct(dynamic.cagr, 1)} />
          <Stat label="Static CAGR" value={pct(stat.cagr, 1)} muted />
          <Stat label="Since" value={`${track.startYear}`} muted />
        </div>

        <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 w-full" role="img"
          aria-label="Cumulative growth of the dynamic mix versus static All Weather since inception">
          {yTicks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={M.left + innerW} y1={y(t)} y2={y(t)}
                className="stroke-neutral-200 dark:stroke-neutral-800" strokeWidth="0.5" />
              <text x={M.left + innerW + 6} y={y(t) + 3.5} className="fill-neutral-400 text-[10px] tabular-nums">{t}</text>
            </g>
          ))}
          {yearTicks(minIdx, maxIdx).map((idx) => (
            <text key={idx} x={x(idx)} y={H - 6} textAnchor="middle" className="fill-neutral-400 text-[10px] tabular-nums">
              {Math.floor(idx / 12)}
            </text>
          ))}
          <path d={line(points.static, x, y)} fill="none"
            className="stroke-neutral-400 dark:stroke-neutral-500" strokeWidth="1.5" strokeLinejoin="round" />
          <path d={line(points.dynamic, x, y)} fill="none"
            className="stroke-blue-600 dark:stroke-blue-400" strokeWidth="1.75" strokeLinejoin="round" />
        </svg>

        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-500">
          <Legend className="bg-blue-600 dark:bg-blue-400" label={`Dynamic mix · ${pct(dynamic.totalReturn, 0)} total, ${pct(dynamic.maxDrawdown, 0)} max drawdown`} />
          <Legend className="bg-neutral-400 dark:bg-neutral-500" label={`Static All Weather · ${pct(stat.totalReturn, 0)} total, ${pct(stat.maxDrawdown, 0)} max drawdown`} />
        </div>

        <p className="mt-3 rounded-lg bg-neutral-50 p-3 text-xs leading-relaxed text-neutral-500 dark:bg-neutral-800/40">
          Growth of 100, rebalanced monthly on ETF total returns. The dynamic
          mix applies the quadrant tilts to each month&apos;s regime
          probabilities; the valuation and real-rate overlays are not replayed
          here. Illustrative only — it reuses full-sample regime estimates (some
          lookahead), so the rigorous vintage-correct backtest is still to come.
          Not investment advice; past performance does not indicate future results.
        </p>
      </div>
    </section>
  );
}

function Stat({ label, value, accent, muted, big }: {
  label: string; value: string; accent?: boolean; muted?: boolean; big?: boolean;
}) {
  return (
    <div className="rounded-lg border border-neutral-100 p-2.5 dark:border-neutral-800">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className={[
        big ? "text-xl" : "text-lg", "font-semibold tabular-nums tracking-tight",
        accent ? "text-blue-600 dark:text-blue-400" : muted ? "text-neutral-500" : "",
      ].join(" ")}>
        {value}
      </div>
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block h-2 w-4 rounded-full ${className}`} />
      {label}
    </span>
  );
}
