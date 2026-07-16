import type { RegimeForecast } from "@/lib/dashboard";
import { formatDate } from "@/lib/format";

// Same palette as the regime strip / portfolio panel.
const COLORS: Record<string, string> = {
  goldilocks: "hsl(160 55% 42%)",
  reflation: "hsl(38 75% 45%)",
  stagflation: "hsl(12 65% 48%)",
  bust: "hsl(217 65% 50%)",
};

// Server-rendered: the local ML job's 3-month-ahead regime forecast.
export function RegimeForecastPanel({ forecast }: { forecast: RegimeForecast }) {
  const top = forecast.quadrants.find((q) => q.key === forecast.topKey)!;
  const persists = top.key === [...forecast.quadrants].sort((a, b) => b.now - a.now)[0].key;
  const fmt2 = (v: number | null) => (v == null ? "—" : v.toFixed(2));
  const pct = (v: number | null) => (v == null ? "—" : `${Math.round(v)}%`);

  return (
    <section className="mb-10">
      <div className="mb-3 flex items-baseline gap-2">
        <h2 className="text-base font-medium">Regime forecast</h2>
        <span className="text-sm text-neutral-500">
          local ML job · {forecast.horizonMonths} months ahead · signals as of {formatDate(forecast.date)}
        </span>
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-neutral-100 p-2.5 dark:border-neutral-800">
            <div className="text-xs text-neutral-500">Most likely in {forecast.horizonMonths}m</div>
            <div className="flex items-center gap-2 text-xl font-semibold tracking-tight">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: COLORS[top.key] }} />
              {top.name}
            </div>
            <div className="text-xs text-neutral-500">
              {Math.round(top.next)}% · {persists ? "regime persists" : "regime change"}
            </div>
          </div>
          <Stat label="Hit rate (walk-forward)" value={pct(forecast.accuracy)} />
          <Stat label="Persistence hit rate" value={pct(forecast.accuracyPersistence)} muted />
          <Stat label="Brier vs persistence" value={`${fmt2(forecast.brier)} vs ${fmt2(forecast.brierPersistence)}`} />
        </div>

        <div className="mt-4 space-y-2.5">
          {forecast.quadrants.map((q) => (
            <div key={q.key} className="flex items-center gap-3">
              <div className="w-36 shrink-0 text-sm text-neutral-700 dark:text-neutral-300">{q.name}</div>
              <div className="relative h-3.5 flex-1 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
                <div
                  className="absolute inset-y-0 left-0 rounded-full"
                  style={{ width: `${q.next}%`, background: COLORS[q.key], opacity: 0.85 }}
                />
                <div
                  className="absolute inset-y-0 w-0.5 bg-neutral-900/70 dark:bg-white/80"
                  style={{ left: `${q.now}%` }}
                  title={`now: ${Math.round(q.now)}%`}
                />
              </div>
              <div className="w-28 shrink-0 text-right text-sm tabular-nums text-neutral-500">
                {Math.round(q.now)}% <span className="text-neutral-400">→</span>{" "}
                <span className="font-medium text-neutral-800 dark:text-neutral-200">{Math.round(q.next)}%</span>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-500">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2 w-4 rounded-full bg-neutral-400/70" /> forecast (+{forecast.horizonMonths}m)
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-0.5 bg-neutral-900/70 dark:bg-white/80" /> today&apos;s reading
          </span>
        </div>

        <p className="mt-3 rounded-lg bg-neutral-50 p-3 text-xs leading-relaxed text-neutral-500 dark:bg-neutral-800/40">
          Forecasts where the regime engine&apos;s own quadrant reading will be
          in {`${forecast.horizonMonths} months`}. The published forecaster is an
          expanding-window transition matrix — &ldquo;from today&apos;s
          quadrant, where did history actually go?&rdquo; — which beat
          persistence on calibration and a machine-learned challenger on every
          score in the walk-forward, so per this project&apos;s rules it gets
          the panel. This job re-reads the regime from initial-release data
          without smoothing, so today&apos;s reading here can differ from the
          smoothed headline in the portfolio panel above. Regime labels are
          soft — a ~{pct(forecast.accuracy)} hit rate sits near their noise
          ceiling, and the real value over just assuming persistence is better
          calibration, not more correct calls. Not investment advice.
        </p>
      </div>
    </section>
  );
}

function Stat({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="rounded-lg border border-neutral-100 p-2.5 dark:border-neutral-800">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className={[
        "text-lg font-semibold tabular-nums tracking-tight",
        muted ? "text-neutral-500" : "",
      ].join(" ")}>
        {value}
      </div>
    </div>
  );
}
