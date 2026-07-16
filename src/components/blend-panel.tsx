import type { BlendMixView } from "@/lib/dashboard";
import { formatDate } from "@/lib/format";

const BAR_SCALE = 50; // weights are drawn relative to a 50% full bar

// Server-rendered: the M3 Black-Litterman blend. Its whole point is the
// budget headline — the mix may deviate from baseline only as far as the
// walk-forward evidence allows.
export function BlendPanel({ mix }: { mix: BlendMixView }) {
  const fmt = (v: number | null, dp = 2, suffix = "") => (v == null ? "—" : `${v.toFixed(dp)}${suffix}`);

  return (
    <section className="mb-10">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <h2 className="text-base font-medium">ML suggested mix</h2>
          <span className="text-sm text-neutral-500">
            Black-Litterman blend · budget earned from walk-forward evidence
          </span>
        </div>
        <span className="text-xs text-neutral-500 tabular-nums">signals as of {formatDate(mix.date)}</span>
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-neutral-100 p-2.5 dark:border-neutral-800">
            <div className="text-xs text-neutral-500">Earned tilt budget</div>
            <div className="text-xl font-semibold tabular-nums tracking-tight text-violet-600 dark:text-violet-400">
              {mix.budget.toFixed(1)}pp <span className="text-sm font-normal text-neutral-500">of 10</span>
            </div>
          </div>
          <Stat label="Information ratio" value={fmt(mix.ir)} />
          <Stat label="Excess CAGR vs static" value={mix.excessCagr == null ? "—" : `${mix.excessCagr >= 0 ? "+" : ""}${mix.excessCagr.toFixed(2)}pp/yr`} />
          <Stat label="Tracking error" value={fmt(mix.te, 2, "%/yr")} muted />
        </div>

        <div className="mt-4">
          <div className="mb-2 flex justify-between text-xs text-neutral-500">
            <span>Asset</span>
            <span>baseline → published · E[12m excess]</span>
          </div>
          <div className="flex flex-col gap-2">
            {mix.assets.map((a) => (
              <div key={a.key} className="flex items-center gap-2 text-sm">
                <span className="w-44 shrink-0 truncate" title={`${a.name} (${a.etf})`}>
                  {a.name} <span className="text-xs text-neutral-500">{a.etf}</span>
                </span>
                <div className="relative h-2.5 flex-1 rounded-full bg-neutral-100 dark:bg-neutral-800">
                  <div
                    className="h-2.5 rounded-full bg-violet-400 dark:bg-violet-500"
                    style={{ width: `${Math.min(100, (a.weight / BAR_SCALE) * 100)}%` }}
                  />
                  <div
                    className="absolute -top-0.5 h-3.5 w-0.5 bg-neutral-600 dark:bg-neutral-300"
                    style={{ left: `${Math.min(100, (a.baseline / BAR_SCALE) * 100)}%` }}
                    title={`baseline ${a.baseline}%`}
                  />
                </div>
                <span className="w-32 shrink-0 text-right text-neutral-500 tabular-nums">
                  {a.baseline}% → {a.weight.toFixed(1)}%{" "}
                  {Math.abs(a.delta) >= 0.05 && (
                    <span className={a.delta > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>
                      {a.delta > 0 ? "+" : "−"}{Math.abs(a.delta).toFixed(1)}
                    </span>
                  )}
                </span>
                <span
                  className="w-14 shrink-0 text-right text-xs tabular-nums text-neutral-400"
                  title="expected 12-month excess return (regime view)"
                >
                  {a.view == null ? "—" : `${a.view >= 0 ? "+" : ""}${a.view.toFixed(1)}%`}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-neutral-400 dark:text-neutral-500">
            tick = All Weather baseline · active share {mix.activeShare.toFixed(1)}pp of the{" "}
            {mix.budget.toFixed(1)}pp earned budget
          </p>
        </div>

        <p className="mt-3 rounded-lg bg-neutral-50 p-3 text-xs leading-relaxed text-neutral-500 dark:bg-neutral-800/40">
          Two predeclared views feed a Black-Litterman blend around the All
          Weather baseline: quadrant-conditional mean returns weighted by the
          regime forecast above, and a CAPE-percentile valuation view for
          equities validated on S&amp;P data back to 1871. The mix may deviate
          from baseline only by budget earned out-of-sample — 10pp times the
          blend&apos;s walk-forward information ratio against the static
          baseline{mix.evalStartYear != null && mix.evalMonths != null && (
            <> (since {mix.evalStartYear}, {mix.evalMonths} months)</>
          )} — and the budget is re-earned on every weekly run, shrinking
          automatically if the edge decays. That evidence window is a single
          decade dominated by one inflation cycle, so treat the edge as
          provisional. The deterministic engine&apos;s mix at the top of the
          page remains the headline recommendation. Not investment advice.
        </p>
      </div>
    </section>
  );
}

function Stat({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="rounded-lg border border-neutral-100 p-2.5 dark:border-neutral-800">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className={["text-lg font-semibold tabular-nums tracking-tight", muted ? "text-neutral-500" : ""].join(" ")}>
        {value}
      </div>
    </div>
  );
}
