"use client";

import { useEffect, useRef, useState } from "react";
import { RegimeStrip } from "@/components/regime-strip";
import { TimeSeriesChart } from "@/components/time-series-chart";
import { formatValue } from "@/lib/format";
import { labelOfIdx, yearOfIdx, type TimelineData } from "@/lib/timeline";

const DEFAULT_KEY = "buffett_indicator";

// The master timeline: one full-history chart for any metric (selected via
// the dropdown or by clicking a metric card, which sets #timeline=<key>),
// with NBER recession shading and the regime stack on the same time axis.
export function TimelinePanel({ timeline }: { timeline: TimelineData }) {
  const sectionRef = useRef<HTMLElement>(null);
  const [selectedKey, setSelectedKey] = useState(
    timeline.metrics.some((m) => m.key === DEFAULT_KEY) ? DEFAULT_KEY : timeline.metrics[0]?.key,
  );

  useEffect(() => {
    function applyHash(scroll: boolean) {
      const match = window.location.hash.match(/^#timeline=(.+)$/);
      if (!match) return;
      const key = decodeURIComponent(match[1]);
      if (timeline.metrics.some((m) => m.key === key)) {
        setSelectedKey(key);
        if (scroll) sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
    applyHash(false);
    const onHash = () => applyHash(true);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [timeline.metrics]);

  const metric = timeline.metrics.find((m) => m.key === selectedKey);
  if (!metric) return null;

  const domain: [number, number] = [metric.points[0][0], metric.points[metric.points.length - 1][0]];
  const latest = metric.points[metric.points.length - 1];
  const panels = [
    { id: "dalio", label: "Dalio — debt cycle & regime" },
    { id: "buffett", label: "Buffett — valuation & rates" },
  ] as const;

  return (
    <section ref={sectionRef} className="mb-10 scroll-mt-4" id="timeline">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <h2 className="text-base font-medium">Master timeline</h2>
          <span className="text-sm text-neutral-500">where today sits in the full history</span>
        </div>
        <select
          value={selectedKey}
          onChange={(e) => setSelectedKey(e.target.value)}
          className="rounded-lg border border-neutral-200 bg-white px-2 py-1 text-sm dark:border-neutral-800 dark:bg-neutral-900"
          aria-label="Select metric for the timeline"
        >
          {panels.map((p) => (
            <optgroup key={p.id} label={p.label}>
              {timeline.metrics
                .filter((m) => m.panel === p.id)
                .map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.name}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2 text-sm">
          <span className="font-medium">
            {metric.name}{" "}
            <span className="font-normal text-neutral-500">
              · {labelOfIdx(latest[0])}: {formatValue(latest[1], metric.unit, metric.decimals)}
            </span>
          </span>
          <span className="text-xs text-neutral-500">
            dashed = median · shaded band = 10–90th pctile since {yearOfIdx(domain[0])} · gray = NBER recessions
          </span>
        </div>
        <TimeSeriesChart
          points={metric.points}
          recessions={timeline.recessions}
          domain={domain}
          unit={metric.unit}
          decimals={metric.decimals}
        />
        <div className="mt-2 border-t border-neutral-100 pt-2 dark:border-neutral-800">
          <RegimeStrip regimes={timeline.regimes} recessions={timeline.recessions} domain={domain} />
        </div>
        <p className="mt-3 rounded-lg bg-neutral-50 p-3 text-sm leading-relaxed text-neutral-600 dark:bg-neutral-800/40 dark:text-neutral-300">
          {metric.explain}
        </p>
      </div>
    </section>
  );
}
