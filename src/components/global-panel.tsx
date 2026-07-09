import type { GlobalView } from "@/lib/dashboard";
import { formatDate, formatValue, ordinal, percentileColor } from "@/lib/format";

// Cross-country debt-cycle heatmap. Rows = economies, columns = BIS metrics.
// Each cell is colored by where that country sits in its OWN history, so red
// = historically elevated (late-cycle / stretched), blue = historically low.
export function GlobalPanel({ global }: { global: GlobalView }) {
  return (
    <section className="mb-10">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <h2 className="text-base font-medium">Global debt cycle</h2>
          <span className="text-sm text-neutral-500">where each economy sits vs its own history</span>
        </div>
        {global.dataThrough && (
          <span className="text-xs text-neutral-500 tabular-nums">
            latest {formatDate(global.dataThrough)} · BIS
          </span>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white p-2 dark:border-neutral-800 dark:bg-neutral-900">
        <table className="w-full border-separate border-spacing-1 text-sm">
          <thead>
            <tr>
              <th className="px-2 py-1 text-left font-medium text-neutral-500" />
              {global.metrics.map((m) => (
                <th
                  key={m.key}
                  className="px-2 py-1 text-right font-medium text-neutral-600 dark:text-neutral-300"
                  title={m.describe}
                >
                  {m.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {global.countries.map((c) => (
              <tr key={c.code}>
                <td className="whitespace-nowrap px-2 py-1 font-medium text-neutral-700 dark:text-neutral-300">
                  {c.name}
                </td>
                {global.metrics.map((m) => {
                  const cell = global.cells[c.code]?.[m.key];
                  if (!cell) {
                    return (
                      <td key={m.key} className="px-1 py-1 text-right text-xs text-neutral-300 dark:text-neutral-700">
                        —
                      </td>
                    );
                  }
                  return (
                    <td key={m.key} className="px-1 py-1">
                      <div
                        className="rounded-lg px-2 py-1.5 text-right tabular-nums"
                        style={percentileColor(cell.percentile)}
                        title={`${ordinal(cell.percentile)} percentile of ${c.name}'s history`}
                      >
                        <div className="font-medium">{formatValue(cell.value, m.unit, m.decimals)}</div>
                        <div className="text-[11px] opacity-70">{ordinal(cell.percentile)}</div>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-xs leading-relaxed text-neutral-500">
        Color shows each figure vs that country&apos;s own history: red = historically elevated
        (later in the debt cycle / more stretched), blue = historically low. Credit/GDP gap is the
        Basel deviation from trend; debt service is the private non-financial sector&apos;s. Source: BIS.
      </p>
    </section>
  );
}
