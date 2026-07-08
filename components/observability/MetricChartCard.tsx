"use client";

import type { MetricSeries } from "@/lib/observability/types";
import { Sparkline } from "@/components/observability/Sparkline";

// A single metric card: name, latest value, sample count, and a sparkline of
// the bucketed averages over the selected window.

function formatValue(v: number | null): string {
  if (v === null) return "—";
  if (Number.isInteger(v)) return v.toLocaleString();
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function MetricChartCard({ series }: { series: MetricSeries }) {
  const last = series.points[series.points.length - 1];
  return (
    <div className="rounded-lg border border-ink/10 bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-medium text-ink" title={series.metric}>
            {series.metric}
          </h3>
          <p className="text-xs text-ink/40">
            {series.total.toLocaleString()} samples
          </p>
        </div>
        <div className="text-right">
          <p className="tabular-nums text-lg font-semibold text-ink">
            {formatValue(series.latest)}
          </p>
          <p className="text-[11px] text-ink/40">latest</p>
        </div>
      </div>
      <div className="mt-3">
        <Sparkline points={series.points} />
      </div>
      {last && (
        <div className="mt-2 flex justify-between text-[11px] text-ink/40">
          <span>min {formatValue(Math.min(...series.points.map((p) => p.min)))}</span>
          <span>max {formatValue(Math.max(...series.points.map((p) => p.max)))}</span>
        </div>
      )}
    </div>
  );
}
