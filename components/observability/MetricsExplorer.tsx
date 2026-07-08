"use client";

import { useCallback, useEffect, useState } from "react";
import type { MetricSeries } from "@/lib/observability/types";
import { fetchMetrics } from "@/components/observability/api";
import { MetricChartCard } from "@/components/observability/MetricChartCard";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/observability/ui";

// Full metrics explorer with a window selector and optional single-metric
// focus. Used on the dedicated metrics page.

const WINDOWS: { value: string; label: string }[] = [
  { value: "1h", label: "1h" },
  { value: "6h", label: "6h" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
];

export function MetricsExplorer() {
  const [window, setWindow] = useState("24h");
  const [metric, setMetric] = useState<string>("");
  const [names, setNames] = useState<string[]>([]);
  const [series, setSeries] = useState<MetricSeries[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetchMetrics({
      metric: metric || undefined,
      window,
      buckets: 64,
    });
    if (!res.success || !res.data) {
      setError(res.error ?? "Failed to load metrics.");
      setLoading(false);
      return;
    }
    setSeries(res.data.series);
    // Only refresh the selector options on the unfiltered fetch.
    if (!metric) {
      setNames(res.data.metrics);
    }
    setLoading(false);
  }, [window, metric]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={metric}
          onChange={(e) => setMetric(e.target.value)}
          className="rounded-md border border-ink/10 bg-white px-3 py-1.5 text-sm text-ink focus:border-accent focus:outline-none"
        >
          <option value="">All metrics</option>
          {names.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <div className="inline-flex overflow-hidden rounded-md border border-ink/10">
          {WINDOWS.map((w) => (
            <button
              key={w.value}
              onClick={() => setWindow(w.value)}
              className={`px-3 py-1.5 text-sm ${
                window === w.value
                  ? "bg-accent/10 text-accent"
                  : "bg-white text-ink/60 hover:bg-paper"
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => void load()}
          className="rounded border border-ink/10 px-2.5 py-1.5 text-xs text-ink/60 hover:bg-paper"
        >
          Refresh
        </button>
      </div>

      {loading ? (
        <LoadingState label="Loading metrics…" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : series.length === 0 ? (
        <EmptyState
          title="No metrics for this window"
          hint="Try a wider window or wait for new samples."
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {series.map((s) => (
            <MetricChartCard key={s.metric} series={s} />
          ))}
        </div>
      )}
    </div>
  );
}
