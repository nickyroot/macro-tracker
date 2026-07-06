import { MetricCard } from "@/components/metric-card";
import { PortfolioPanel } from "@/components/portfolio-panel";
import { TrackRecordPanel } from "@/components/track-record-panel";
import { TimelinePanel } from "@/components/timeline-panel";
import { getDashboardData } from "@/lib/dashboard";
import { formatDate } from "@/lib/format";
import { PANELS } from "@/lib/metrics";

// ISR keeps this page static: data changes once a day after the ingest run
// (which calls revalidatePath), so page views never hit the database.
export const revalidate = 3600;

export default async function Home() {
  const { metrics, portfolio, trackRecord, timeline, dataThrough, lastRun } = await getDashboardData();

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <header className="mb-8 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Macro tracker</h1>
          <p className="text-sm text-neutral-500">
            Key macro metrics vs their full history — percentile, z-score, trend
          </p>
        </div>
        {dataThrough && (
          <p className="text-xs text-neutral-500 tabular-nums">
            Data through {formatDate(dataThrough)}
            {lastRun?.finishedAt &&
              ` · ingested ${new Date(lastRun.finishedAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })}`}
          </p>
        )}
      </header>

      {metrics.length === 0 && <EmptyState />}

      {portfolio && <PortfolioPanel portfolio={portfolio} />}

      {trackRecord && <TrackRecordPanel track={trackRecord} />}

      {timeline.metrics.length > 0 && <TimelinePanel timeline={timeline} />}

      {PANELS.map((panel) => {
        const panelMetrics = metrics.filter((m) => m.panel === panel.id);
        if (panelMetrics.length === 0) return null;
        return (
          <section key={panel.id} className="mb-10">
            <div className="mb-3 flex items-baseline gap-2">
              <h2 className="text-base font-medium">{panel.title}</h2>
              <span className="text-sm text-neutral-500">{panel.subtitle}</span>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {panelMetrics.map((m) => (
                <MetricCard key={m.key} metric={m} />
              ))}
            </div>
          </section>
        );
      })}

      <footer className="mt-4 border-t border-neutral-200 pt-4 text-xs text-neutral-500 dark:border-neutral-800">
        Sources: FRED (St. Louis Fed). Percentiles are computed against each
        metric&apos;s full available history. Not investment advice.
      </footer>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-neutral-300 p-8 text-sm text-neutral-600 dark:border-neutral-700 dark:text-neutral-400">
      <p className="font-medium text-neutral-800 dark:text-neutral-200">No data yet</p>
      <ol className="mt-2 list-decimal space-y-1 pl-5">
        <li>
          Get a free FRED API key and set <code>FRED_API_KEY</code> in <code>.env</code>
        </li>
        <li>
          Run <code>npm run backfill</code> to load full history (or{" "}
          <code>npm run seed:demo</code> for synthetic demo data)
        </li>
        <li>Reload this page</li>
      </ol>
    </div>
  );
}
