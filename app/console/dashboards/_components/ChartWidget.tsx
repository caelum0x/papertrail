import type { ChartValue } from "./types";

interface ChartWidgetProps {
  data: ChartValue;
}

// Dependency-free horizontal bar chart. Bars are scaled to the max value so the
// widget renders without a charting library (keeps the bundle lean).
export function ChartWidget({ data }: ChartWidgetProps) {
  if (data.series.length === 0) {
    return <p className="py-6 text-center text-sm text-ink/40">No data yet.</p>;
  }
  const max = Math.max(1, ...data.series.map((p) => p.value));
  return (
    <div className="space-y-2">
      {data.series.map((point) => {
        const pct = Math.round((point.value / max) * 100);
        return (
          <div key={point.label} className="flex items-center gap-2">
            <span
              className="w-24 shrink-0 truncate text-xs text-ink/50"
              title={point.label}
            >
              {point.label}
            </span>
            <div className="h-3 flex-1 overflow-hidden rounded bg-ink/5">
              <div
                className="h-full rounded bg-accent/70"
                style={{ width: `${pct}%` }}
                aria-hidden
              />
            </div>
            <span className="w-10 shrink-0 text-right text-xs tabular-nums text-ink/60">
              {point.value}
            </span>
          </div>
        );
      })}
    </div>
  );
}
