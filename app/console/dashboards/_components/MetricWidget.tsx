import type { MetricValue } from "./types";
import { formatMetric } from "./shared";

interface MetricWidgetProps {
  data: MetricValue;
}

// Single big-number KPI tile.
export function MetricWidget({ data }: MetricWidgetProps) {
  return (
    <div className="flex h-full flex-col justify-center">
      <div className="text-3xl font-semibold text-ink/80">
        {formatMetric(data.value, data.format)}
      </div>
      <div className="mt-1 text-xs uppercase tracking-wide text-ink/40">
        {data.label}
      </div>
    </div>
  );
}
