import type { MetricView } from "@/lib/dashboard";
import { formatDate, formatValue, ordinal, percentileColor } from "@/lib/format";
import { Sparkline } from "@/components/sparkline";

export function MetricCard({ metric }: { metric: MetricView }) {
  const { latest, percentile, z } = metric;

  return (
    <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <h3
          className="text-sm font-medium text-neutral-700 dark:text-neutral-300 leading-snug"
          title={metric.describe}
        >
          {metric.name}
        </h3>
        <span
          className="shrink-0 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums"
          style={percentileColor(percentile)}
          title={`${ordinal(percentile)} percentile of history since ${metric.sinceYear}`}
        >
          {ordinal(percentile)} pct
        </span>
      </div>

      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-semibold tabular-nums tracking-tight">
          {formatValue(latest.value, metric.unit, metric.decimals)}
        </span>
        <span className="text-xs text-neutral-500">{formatDate(latest.date)}</span>
      </div>

      <Sparkline values={metric.spark} />

      <div className="flex items-center justify-between text-xs text-neutral-500 tabular-nums">
        <span title="Standard deviations from the historical mean">
          z {z >= 0 ? "+" : ""}
          {z.toFixed(1)}
        </span>
        <span title={`Historical range since ${metric.sinceYear}`}>
          {formatValue(metric.min, metric.unit, metric.decimals)} ·{" "}
          {formatValue(metric.med, metric.unit, metric.decimals)} ·{" "}
          {formatValue(metric.max, metric.unit, metric.decimals)}
        </span>
      </div>
    </div>
  );
}
