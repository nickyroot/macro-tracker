import type { PortfolioView } from "@/lib/dashboard";
import { formatDate } from "@/lib/format";

const BAR_SCALE = 50; // weights are drawn relative to a 50% full bar

const QUADRANT_COLORS: Record<string, string> = {
  goldilocks: "hsl(160 55% 42%)",
  reflation: "hsl(38 75% 45%)",
  stagflation: "hsl(12 65% 48%)",
  bust: "hsl(217 65% 50%)",
};

export function PortfolioPanel({ portfolio }: { portfolio: PortfolioView }) {
  const quadrants = [...portfolio.quadrants].sort((a, b) => b.prob - a.prob);

  return (
    <section className="mb-10">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <h2 className="text-base font-medium">Suggested mix</h2>
          <span className="text-sm text-neutral-500">
            dynamic All Weather — model output, not investment advice
          </span>
        </div>
        <span className="text-xs text-neutral-500 tabular-nums">
          signals as of {formatDate(portfolio.asOf)}
        </span>
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex flex-wrap gap-8">
          <div className="min-w-60 flex-1">
            <p className="mb-2 text-xs text-neutral-500">
              Regime probabilities (3-month smoothed)
            </p>
            <div className="flex flex-col gap-1.5">
              {quadrants.map((q) => (
                <div key={q.key} className="flex items-center gap-2 text-sm" title={q.describe}>
                  <span className="w-32 shrink-0">{q.name}</span>
                  <div className="h-2 flex-1 rounded-full bg-neutral-100 dark:bg-neutral-800">
                    <div
                      className="h-2 rounded-full"
                      style={{
                        width: `${Math.round(q.prob * 100)}%`,
                        background: QUADRANT_COLORS[q.key],
                      }}
                    />
                  </div>
                  <span className="w-9 text-right text-neutral-500 tabular-nums">
                    {Math.round(q.prob * 100)}%
                  </span>
                </div>
              ))}
            </div>
            <ul className="mt-4 space-y-1 text-xs leading-relaxed text-neutral-500">
              {portfolio.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </div>

          <div className="min-w-72 flex-[1.3]">
            <div className="mb-2 flex justify-between text-xs text-neutral-500">
              <span>Asset</span>
              <span>baseline → suggested</span>
            </div>
            <div className="flex flex-col gap-2">
              {portfolio.weights.map((w) => (
                <div key={w.key} className="flex items-center gap-2 text-sm">
                  <span className="w-44 shrink-0 truncate" title={`${w.name} (${w.etf})`}>
                    {w.name}{" "}
                    <span className="text-xs text-neutral-500">{w.etf}</span>
                  </span>
                  <div className="relative h-2.5 flex-1 rounded-full bg-neutral-100 dark:bg-neutral-800">
                    <div
                      className="h-2.5 rounded-full bg-neutral-400 dark:bg-neutral-500"
                      style={{ width: `${Math.min(100, (w.weight / BAR_SCALE) * 100)}%` }}
                    />
                    <div
                      className="absolute -top-0.5 h-3.5 w-0.5 bg-neutral-600 dark:bg-neutral-300"
                      style={{ left: `${Math.min(100, (w.baseline / BAR_SCALE) * 100)}%` }}
                      title={`baseline ${w.baseline}%`}
                    />
                  </div>
                  <span className="w-36 shrink-0 text-right text-neutral-500 tabular-nums">
                    {w.baseline}% → {w.weight.toFixed(1)}%{" "}
                    {Math.abs(w.delta) >= 0.05 && (
                      <span
                        className={
                          w.delta > 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-red-600 dark:text-red-400"
                        }
                      >
                        {w.delta > 0 ? "+" : "−"}
                        {Math.abs(w.delta).toFixed(1)}
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-neutral-400 dark:text-neutral-500">
              tick = All Weather baseline · active share{" "}
              {portfolio.activeShare.toFixed(1)}pp of 20pp budget
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
