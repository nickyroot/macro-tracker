import type { MlView } from "@/lib/dashboard";
import { formatDate } from "@/lib/format";

const W = 720;
const H = 240;
const M = { top: 12, right: 44, bottom: 22, left: 6 };

function yearTicks(minIdx: number, maxIdx: number): number[] {
  const spanYears = (maxIdx - minIdx) / 12;
  const every = spanYears > 45 ? 10 : spanYears > 18 ? 5 : 2;
  const ticks: number[] = [];
  for (let y = Math.ceil(minIdx / 12 / every) * every; y * 12 <= maxIdx; y += every) ticks.push(y * 12);
  return ticks;
}

// Server-rendered: the local ML job's walk-forward recession probability.
export function RecessionPanel({ ml, recessions }: { ml: MlView; recessions: [number, number][] }) {
  const { points } = ml;
  const minIdx = points[0][0];
  const maxIdx = points[points.length - 1][0];
  const innerW = W - M.left - M.right;
  const innerH = H - M.top - M.bottom;
  const x = (idx: number) => M.left + ((idx - minIdx) / (maxIdx - minIdx || 1)) * innerW;
  const y = (v: number) => M.top + innerH - (v / 100) * innerH;
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join("");
  const last = points[points.length - 1];

  const fmt2 = (v: number | null) => (v == null ? "—" : v.toFixed(2));

  return (
    <section className="mb-10">
      <div className="mb-3 flex items-baseline gap-2">
        <h2 className="text-base font-medium">Recession probability</h2>
        <span className="text-sm text-neutral-500">
          local ML job · out-of-sample since {ml.oosStartYear}
        </span>
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat
            label={`P(recession by ${formatDate(ml.current.date)} + 12m)`}
            value={`${Math.round(ml.current.prob)}%`}
            accent
            big
          />
          <Stat label="Walk-forward AUC" value={fmt2(ml.auc)} />
          <Stat label="Curve-only AUC" value={fmt2(ml.aucCurveOnly)} muted />
          <Stat
            label="Recession base rate"
            value={ml.baseRate == null ? "—" : `${Math.round(ml.baseRate)}%`}
            muted
          />
        </div>

        <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 w-full" role="img"
          aria-label="Out-of-sample probability of a US recession within the next 12 months, with NBER recessions shaded">
          {recessions.map(([s, e]) =>
            e >= minIdx && s <= maxIdx ? (
              <rect
                key={s}
                x={x(Math.max(s, minIdx))}
                y={M.top}
                width={Math.max(x(Math.min(e + 1, maxIdx)) - x(Math.max(s, minIdx)), 1)}
                height={innerH}
                className="fill-neutral-500/10"
              />
            ) : null,
          )}
          {[0, 25, 50, 75, 100].map((t) => (
            <g key={t}>
              <line
                x1={M.left} x2={M.left + innerW} y1={y(t)} y2={y(t)}
                className="stroke-neutral-200 dark:stroke-neutral-800"
                strokeWidth="0.5"
                strokeDasharray={t === 50 ? "3 4" : undefined}
              />
              <text x={M.left + innerW + 6} y={y(t) + 3.5} className="fill-neutral-400 text-[10px] tabular-nums">
                {t}%
              </text>
            </g>
          ))}
          {yearTicks(minIdx, maxIdx).map((idx) => (
            <text key={idx} x={x(idx)} y={H - 6} textAnchor="middle"
              className="fill-neutral-400 text-[10px] tabular-nums">
              {Math.floor(idx / 12)}
            </text>
          ))}
          <path d={path} fill="none"
            className="stroke-violet-600 dark:stroke-violet-400"
            strokeWidth="1.5" strokeLinejoin="round" />
          <circle cx={x(last[0])} cy={y(last[1])} r="3.5" className="fill-violet-600 dark:fill-violet-400" />
        </svg>

        <p className="mt-3 rounded-lg bg-neutral-50 p-3 text-xs leading-relaxed text-neutral-500 dark:bg-neutral-800/40">
          P(an NBER recession starts or continues within the next 12 months),
          from a regularised logit on the yield curve (10y − fed funds), the
          12-month change in the fed funds rate, the Sahm rule, and industrial
          production as first published. Trained by this project&apos;s local
          ML job and refit monthly: every point above is an out-of-sample
          forecast made with only the data an observer had at the time,
          including a 24-month label embargo for NBER&apos;s announcement
          delay. It ranks risk better than the yield curve alone (AUC{" "}
          {fmt2(ml.auc)} vs {fmt2(ml.aucCurveOnly)}) but its tails run hot —
          readings above 75% have come true only about half the time, most
          recently the 2022–25 inversion false alarm. Shaded bands are NBER
          recessions. Not investment advice.
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
        accent ? "text-violet-600 dark:text-violet-400" : muted ? "text-neutral-500" : "",
      ].join(" ")}>
        {value}
      </div>
    </div>
  );
}
